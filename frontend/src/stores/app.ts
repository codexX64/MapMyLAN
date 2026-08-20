import { create } from "zustand";
import { api, setCsrfToken } from "../api/client";
import { connectWS, disconnectWS } from "../api/ws";

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
  selectedDeviceId: string | null;

  setPage: (p: string) => void;
  setTheme: (t: string) => void;
  selectDevice: (id: string | null) => void;

  login: (username: string, password: string) => Promise<void>;
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
  selectedDeviceId: null,

  setPage: (p) => set({ currentPage: p }),
  setTheme: (t) => { localStorage.setItem("mapmylan_theme", t); set({ themeKey: t }); },
  selectDevice: (id) => set({ selectedDeviceId: id }),

  setSetupComplete: (v) => set({ setupComplete: v }),

  login: async (username, password) => {
    const res = await api.login(username, password);
    // The session token is in an HttpOnly cookie; here we only keep the
    // anti-CSRF token (non-secret) for requests that mutate state.
    setCsrfToken(res.csrfToken);
    set({ user: res.user, setupComplete: res.setupComplete, authLoading: false });
    await get().loadInitialData();
  },

  logout: () => {
    // The server clears the cookie; we have nothing to remove from the browser ourselves.
    api.logout().catch(() => {});
    setCsrfToken(null);
    disconnectWS();
    set({ user: null });
    location.reload();
  },

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

// An expired or missing session (401) cleanly returns to the login screen,
// without reloading in a loop.
if (typeof window !== "undefined") {
  window.addEventListener("mapmylan:unauthorized", () => {
    setCsrfToken(null);
    disconnectWS();
    useStore.setState({ user: null, authLoading: false });
  });
}

// Bootstrap: the session cookie (if present) authenticates the probe. If it
// succeeds, we are logged in; otherwise, we show the login. No more token read
// from localStorage.
api.setupStatus().then((status) => {
  useStore.setState({
    authLoading: false,
    user: { username: "(loading)" },
    setupComplete: status.complete,
  });
  useStore.getState().loadInitialData();
}).catch(() => {
  useStore.setState({ authLoading: false, user: null });
});
