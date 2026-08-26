import { create } from "zustand";
import { api } from "../api/client";
import { connectWS } from "../api/ws";

interface AppState {
  user: any | null;
  authLoading: boolean;
  setupComplete: boolean;

  devices: any[];
  vlans: any[];
  alerts: any[];
  logs: any[];
  stats: any;
  scanRunning: boolean;
  healthScore: number;
  topology: { links: any[]; zones: any[] };
  hostStats: any;

  // UI
  currentPage: string;
  themeKey: string;
  shell: "reading" | "workshop";
  needsSetup: boolean;
  selectedDeviceId: string | null;

  setPage: (p: string) => void;
  setTheme: (t: string) => void;
  setShell: (k: "reading" | "workshop") => void;
  clearMustChange: () => void;
  bootstrap: (username: string, password: string) => Promise<void>;
  selectDevice: (id: string | null) => void;

  login: (username: string, password: string) => Promise<any>;
  ouvrirSession: (res: any) => Promise<void>;
  logout: () => void;
  loadInitialData: () => Promise<void>;
  setSetupComplete: (v: boolean) => void;

  refreshDevices: () => Promise<void>;
  refreshAlerts: () => Promise<void>;
  refreshLogs: () => Promise<void>;
  refreshStats: () => Promise<void>;
  refreshTopology: () => Promise<void>;

  triggerScan: (subnet?: string) => Promise<void>;
}

export const useStore = create<AppState>((set, get) => ({
  user: null,
  authLoading: true,
  setupComplete: false,

  devices: [],
  vlans: [],
  alerts: [],
  logs: [],
  stats: { total: 0, online: 0, offline: 0, suspect: 0, banned: 0, quarantined: 0, vlans: 0, alerts: 0 },
  scanRunning: false,
  healthScore: 100,
  topology: { links: [], zones: [] },
  hostStats: null,

  currentPage: "dashboard",
  themeKey: localStorage.getItem("mapmylan_theme") || "light",
  // Disposition : « reading » aérée, une page à la fois ; « workshop » dense,
  // tout visible en même temps. Mémorisée par navigateur.
  shell: (localStorage.getItem("mapmylan_shell") as any) || "reading",
  needsSetup: false,
  selectedDeviceId: null,

  setPage: (p) => set({ currentPage: p }),
  setTheme: (t) => { localStorage.setItem("mapmylan_theme", t); set({ themeKey: t }); },
  setShell: (k) => { localStorage.setItem("mapmylan_shell", k); set({ shell: k }); },
  clearMustChange: () => set(st => ({ user: { ...st.user, mustChangePassword: false } })),
  selectDevice: (id) => set({ selectedDeviceId: id }),

  setSetupComplete: (v) => set({ setupComplete: v }),

  bootstrap: async (username, password) => {
    const res = await api.bootstrap(username, password);
    localStorage.setItem("mapmylan_token", res.token);
    set({ user: res.user, setupComplete: res.setupComplete, needsSetup: false, authLoading: false });
  },

  login: async (username, password) => {
    const res: any = await api.login(username, password);
    // Le compte a un second facteur : pas de session encore, un défi à relever.
    // On le rend à l'appelant plutôt que de le garder ici — c'est l'écran de
    // connexion qui mène la seconde étape.
    if (res?.etape === "second-facteur") return res;
    await get().ouvrirSession(res);
    return null;
  },

  /** Pose la session à partir d'une réponse de connexion complète. */
  ouvrirSession: async (res: any) => {
    localStorage.setItem("mapmylan_token", res.token);
    set({ user: res.user, setupComplete: res.setupComplete, authLoading: false });
    await get().loadInitialData();
  },

  logout: () => { localStorage.removeItem("mapmylan_token"); set({ user: null }); location.reload(); },

  loadInitialData: async () => {
    try {
      const [devices, vlans, alerts, stats, healthRes, topology] = await Promise.all([
        api.listDevices(), api.listVlans(), api.alerts(50), api.stats(), api.healthScore(), api.getTopology(),
      ]);
      set({ devices, vlans, alerts, stats, healthScore: healthRes.score, topology });
      api.logs(undefined, 100).then((logs) => set({ logs })).catch(() => {});
      api.hostStats().then(hostStats => set({ hostStats })).catch(() => {});

      const ws = connectWS();
      ws.on("devices:updated", () => get().refreshDevices());
      ws.on("device:updated", () => get().refreshDevices());
      ws.on("alert:new", (alert) => set((s) => ({ alerts: [alert, ...s.alerts].slice(0, 100) })));
      ws.on("log:new", (log) => set((s) => ({ logs: [log, ...s.logs].slice(0, 200) })));
      ws.on("scan:started", () => set({ scanRunning: true }));
      ws.on("scan:complete", () => { set({ scanRunning: false }); get().refreshDevices(); get().refreshStats(); });
      ws.on("topology:updated", () => get().refreshTopology());
      ws.on("host:metrics", (hostStats) => set({ hostStats }));
    } catch (err) { console.error("Initial load failed:", err); }
  },

  refreshDevices: async () => {
    const devices = await api.listDevices();
    const healthRes = await api.healthScore();
    set({ devices, healthScore: healthRes.score });
  },
  refreshAlerts: async () => set({ alerts: await api.alerts(50) }),
  refreshLogs: async () => set({ logs: await api.logs(undefined, 200) }),
  refreshStats: async () => set({ stats: await api.stats() }),
  refreshTopology: async () => set({ topology: await api.getTopology() }),

  triggerScan: async (subnet) => { set({ scanRunning: true }); await api.scan(subnet); },
}));

// Bootstrap if token present
const token = localStorage.getItem("mapmylan_token");
if (token) {
  // Au rechargement, on redemande qui porte ce jeton. L'utilisateur factice
  // d'avant n'avait ni identifiant, ni rôle, ni l'indicateur de mot de passe à
  // changer : le changement imposé sautait au moindre rafraîchissement.
  Promise.all([api.setupStatus(), api.me().catch(() => null)]).then(([status, moi]) => {
    useStore.setState({
      authLoading: false,
      user: moi || { username: "(loading)" },
      setupComplete: status.complete,
    });
    useStore.getState().loadInitialData();
  }).catch(() => {
    localStorage.removeItem("mapmylan_token");
    useStore.setState({ authLoading: false });
  });
} else {
  // Aucun jeton : on demande au serveur s'il existe au moins un compte, sinon
  // l'interface propose d'en créer un au lieu d'afficher une connexion vide.
  api.needsSetup()
    .then(r => useStore.setState({ needsSetup: r.needsSetup, authLoading: false }))
    .catch(() => useStore.setState({ authLoading: false }));
}
