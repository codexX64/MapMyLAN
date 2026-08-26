// Relative URL — nginx proxies /api/ → backend:4000
const BASE = "/api";

function getToken() { return localStorage.getItem("mapmylan_token"); }
export function setToken(t: string | null) { t ? localStorage.setItem("mapmylan_token", t) : localStorage.removeItem("mapmylan_token"); }

/**
 * Le cookie anti-CSRF, seul cookie de session lisible par le JS.
 *
 * Le jeton, lui, vit dans un cookie `HttpOnly` que ce code ne peut pas lire —
 * c'est précisément ce qui le met hors de portée d'un XSS. Le navigateur
 * l'envoie tout seul, à condition que la requête porte `credentials`.
 */
function jetonAntiCsrf(): string | null {
  const m = document.cookie.match(/(?:^|;\s*)mapmylan_csrf=([^;]*)/);
  return m ? decodeURIComponent(m[1]) : null;
}

async function request<T = any>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = { "Content-Type": "application/json", ...(options.headers as any) };
  // L'en-tête reste envoyé : il fait vivre les clients qui n'ont pas de cookie,
  // et le serveur lit le cookie en priorité quand il y en a un.
  if (token) headers.Authorization = `Bearer ${token}`;
  // Double soumission : sur toute méthode qui modifie l'état, le serveur exige
  // que cet en-tête soit égal au cookie. Un site tiers ne peut lire ni l'un ni
  // l'autre, il ne peut donc pas forger la requête.
  const csrf = jetonAntiCsrf();
  const methode = String(options.method || "GET").toUpperCase();
  if (csrf && methode !== "GET" && methode !== "HEAD") headers["X-CSRF-Token"] = csrf;
  // `same-origin` : le cookie de session part avec la requête vers notre propre
  // origine, et nulle part ailleurs.
  const res = await fetch(`${BASE}${path}`, { credentials: "same-origin", ...options, headers });
  if (res.status === 401 && !path.startsWith("/auth/")) { setToken(null); location.reload(); throw new Error("Unauthorized"); }
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
  return data;
}

export const api = {
  // Auth
  login: (username: string, password: string) =>
    request<{ token: string; user: any; setupComplete: boolean }>("/auth/login", { method: "POST", body: JSON.stringify({ username, password }) }),
  // Effacer le stockage local ne suffit plus : le cookie de session survivrait
  // à la déconnexion. C'est le serveur qui le retire.
  logout: () => request("/auth/logout", { method: "POST" }).catch(() => null),
  // L'identifiant n'est plus transmis : le serveur travaille sur le compte
  // porteur du jeton, ce qui ferme l'oracle de devinette qu'exposait
  // l'ancienne version non authentifiée.
  changePassword: (oldPassword: string, newPassword: string) =>
    request<any>("/auth/change-password", { method: "POST", body: JSON.stringify({ oldPassword, newPassword }) }),

  // Setup
  setupStatus: () => request<{ complete: boolean; mainRouter: any }>("/setup/status"),
  completeSetup: () => request("/setup/complete", { method: "POST" }),

  // Devices
  listDevices: () => request<any[]>("/devices"),
  getDevice: (id: string) => request<any>(`/devices/${id}`),
  scan: (subnet?: string) => request("/devices/scan", { method: "POST", body: JSON.stringify({ subnet }) }),
  createManualDevice: (data: any) => request<any>("/devices/manual", { method: "POST", body: JSON.stringify(data) }),
  deleteDevice: (id: string) => request(`/devices/${id}`, { method: "DELETE" }),
  // Réservation d'adresse : on ne réécrit pas la machine, on demande à la
  // passerelle de toujours lui servir la même adresse.
  deviceReservation: (id: string) => request<any>(`/devices/${id}/reservation`),
  poserReservation: (id: string, corps: { vlan?: number | null; ip?: string; retirer?: boolean }) =>
    request<any>(`/devices/${id}/reservation`, { method: "POST", body: JSON.stringify(corps) }),
  relancerBail: (id: string) => request<any>(`/devices/${id}/relancer-bail`, { method: "POST" }),
  pingDevice: (id: string) => request<{ alive: boolean; latencyMs?: number }>(`/devices/${id}/ping`),
  scoreDevice: (id: string) => request(`/devices/${id}/score`, { method: "POST" }),
  deepScan: (id: string) => request(`/devices/${id}/deep-scan`, { method: "POST" }),
  updateDevice: (id: string, data: any) => request(`/devices/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  deviceHistory: (id: string) => request<any[]>(`/devices/${id}/history`),
  banDevice: (id: string, reason?: string) => request<{ ok: boolean; output: string }>(`/devices/${id}/ban`, { method: "POST", body: JSON.stringify({ reason }) }),
  quarantineDevice: (id: string, reason?: string) => request<{ ok: boolean; output: string }>(`/devices/${id}/quarantine`, { method: "POST", body: JSON.stringify({ reason }) }),
  unbanDevice: (id: string) => request<{ ok: boolean; output: string }>(`/devices/${id}/unban`, { method: "POST" }),
  healthScore: () => request<{ score: number }>("/devices/health/score"),

  // Interfaces (NICs)
  addInterface: (deviceId: string, data: any) => request(`/devices/${deviceId}/interfaces`, { method: "POST", body: JSON.stringify(data) }),
  updateInterface: (deviceId: string, ifaceId: string, data: any) => request(`/devices/${deviceId}/interfaces/${ifaceId}`, { method: "PATCH", body: JSON.stringify(data) }),
  deleteInterface: (deviceId: string, ifaceId: string) => request(`/devices/${deviceId}/interfaces/${ifaceId}`, { method: "DELETE" }),
  mergeDevices: (targetId: string, sourceId: string, keepName?: "source" | "target") => request(`/devices/${targetId}/merge`, { method: "POST", body: JSON.stringify({ sourceId, keepName }) }),

  // VLANs
  listVlans: () => request<any[]>("/vlans"),
  // Sens lecture : on range ce que la passerelle déclare, on ne pousse rien.
  releverVlans: () => request<any>("/vlans/relever", { method: "POST" }),
  createVlan: (data: any) => request<{ vlan: any; provision: any }>("/vlans", { method: "POST", body: JSON.stringify(data) }),
  updateVlan: (id: number, data: any) => request(`/vlans/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  deleteVlan: (id: number, removeFromRouter = true) => request(`/vlans/${id}?removeFromRouter=${removeFromRouter}`, { method: "DELETE" }),

  // SSH
  listSsh: () => request<any[]>("/ssh"),
  addSsh: (data: any) => request("/ssh", { method: "POST", body: JSON.stringify(data) }),
  testSsh: (data: any) => request<{ ok: boolean; error?: string; banner?: string }>("/ssh/test", { method: "POST", body: JSON.stringify(data) }),
  deleteSsh: (id: string) => request(`/ssh/${id}`, { method: "DELETE" }),
  execSsh: (id: string, command: string) => request<{ stdout: string; stderr: string; code: number | null }>(`/ssh/${id}/exec`, { method: "POST", body: JSON.stringify({ command }) }),

  // Identification des destinations publiques auprès des registres (RDAP).
  whois: (ips: string[]) => request<{ actif: boolean; fiches: {
    ip: string; reseau?: string; organisation?: string; pays?: string; domaine?: string; registre?: string;
  }[] }>("/net/whois", { method: "POST", body: JSON.stringify({ ips }) }),

  // Historique du trafic, tenu par le serveur.
  trafficState: () => request<any>("/traffic/state"),
  trafficFlows: (o: { limite?: number; depuis?: number; avant?: number } = {}) => {
    const q = new URLSearchParams();
    if (o.limite) q.set("limite", String(o.limite));
    if (o.depuis) q.set("depuis", String(o.depuis));
    if (o.avant)  q.set("avant", String(o.avant));
    return request<any[]>(`/traffic/flows${q.toString() ? `?${q}` : ""}`);
  },
  trafficCollect: () => request<any>("/traffic/collect", { method: "POST" }),
  trafficPurge:   () => request<any>("/traffic/purge", { method: "POST" }),
  trafficClear:   () => request<any>("/traffic/flows", { method: "DELETE" }),

  // Comptes.
  // Second facteur.
  mfaEtat: () => request<any>("/mfa/etat"),
  mfaPasskeyOptions: () => request<any>("/mfa/passkey/options", { method: "POST", body: "{}" }),
  mfaPasskeyEnregistrer: (reponse: any, label: string) =>
    request<any>("/mfa/passkey", { method: "POST", body: JSON.stringify({ reponse, label }) }),
  mfaPasskeySupprimer: (id: string) => request<any>(`/mfa/passkey/${id}`, { method: "DELETE" }),
  // Telegram : on demande un code au chat annoncé, puis on le confirme. Rien
  // n'est enregistré tant que le code n'est pas revenu.
  mfaTelegramCode: (chatId: string) =>
    request<any>("/mfa/telegram/code", { method: "POST", body: JSON.stringify({ chatId }) }),
  mfaTelegramLier: (code: string) =>
    request<any>("/mfa/telegram", { method: "POST", body: JSON.stringify({ code }) }),
  mfaTelegramDelier: () => request<any>("/mfa/telegram", { method: "DELETE" }),
  userMfa: (id: string) => request<any>(`/users/${id}/mfa`),
  userMfaExiger: (id: string, valeur: boolean) =>
    request<any>(`/users/${id}/mfa/exiger`, { method: "POST", body: JSON.stringify({ valeur }) }),
  userMfaRevoquer: (id: string) => request<any>(`/users/${id}/mfa`, { method: "DELETE" }),

  // Seconde étape de connexion.
  deuxiemeApplication: (defi: string, code: string) =>
    request<any>("/auth/2fa/application", { method: "POST", body: JSON.stringify({ defi, code }) }),
  deuxiemeTrousseauOptions: (defi: string) =>
    request<any>("/auth/2fa/trousseau/options", { method: "POST", body: JSON.stringify({ defi }) }),
  deuxiemeTrousseau: (defi: string, reponse: any) =>
    request<any>("/auth/2fa/trousseau", { method: "POST", body: JSON.stringify({ defi, reponse }) }),
  deuxiemeTelegramEnvoyer: (defi: string) =>
    request<any>("/auth/2fa/telegram/envoyer", { method: "POST", body: JSON.stringify({ defi }) }),
  deuxiemeTelegram: (defi: string, code: string) =>
    request<any>("/auth/2fa/telegram", { method: "POST", body: JSON.stringify({ defi, code }) }),

  me: () => request<{
    id: string; username: string; role: string;
    mustChangePassword: boolean; totpEnabled: boolean;
  }>("/auth/me"),

  users: () => request<{
    comptes: any[]; creationVerrouillee: boolean; roles: string[];
  }>("/users"),
  userCreate: (d: { username: string; password: string; role: string }) =>
    request<any>("/users", { method: "POST", body: JSON.stringify(d) }),
  userUpdate: (id: string, d: Record<string, any>) =>
    request<any>(`/users/${id}`, { method: "PATCH", body: JSON.stringify(d) }),
  userPassword: (id: string, password: string) =>
    request<any>(`/users/${id}/password`, { method: "POST", body: JSON.stringify({ password }) }),
  userDelete: (id: string) => request<any>(`/users/${id}`, { method: "DELETE" }),
  usersLockState: () => request<{ verrouille: boolean; peutVerrouiller: boolean }>("/users/creation/etat"),
  usersLock: () => request<any>("/users/creation/lock", { method: "POST" }),
  usersUnlock: (code: string) =>
    request<any>("/users/creation/unlock", { method: "POST", body: JSON.stringify({ code }) }),

  // Topology
  getTopology: () => request<{ links: any[]; zones: any[] }>("/topology"),
  autoBuildTopology: () => request("/topology/auto-build", { method: "POST" }),
  createLink: (data: any) => request("/topology/links", { method: "POST", body: JSON.stringify(data) }),
  updateLink: (id: string, data: any) => request(`/topology/links/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  deleteLink: (id: string) => request(`/topology/links/${id}`, { method: "DELETE" }),
  reverseLink: (id: string) => request(`/topology/links/${id}/reverse`, { method: "POST" }),
  createZone: (data: any) => request("/topology/zones", { method: "POST", body: JSON.stringify(data) }),
  updateZone: (id: string, data: any) => request(`/topology/zones/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  deleteZone: (id: string) => request(`/topology/zones/${id}`, { method: "DELETE" }),
  savePositions: (positions: { id: string; x: number; y: number }[]) =>
    request("/topology/positions", { method: "POST", body: JSON.stringify({ positions }) }),

  // Host
  hostStats: () => request<any>("/host/stats"),
  hostHistory: (minutes = 60) => request<any[]>(`/host/history?minutes=${minutes}`),

  // System
  stats: () => request<any>("/stats"),
  alerts: (limit = 50) => request<any[]>(`/alerts?limit=${limit}`),
  ackAlert: (id: string) => request(`/alerts/${id}/ack`, { method: "POST" }),
  logs: (level?: string, limit = 200) => request<any[]>(`/logs?${level ? `level=${level}&` : ""}limit=${limit}`),
  settings: () => request<Record<string, any>>("/settings"),
  setSetting: (key: string, value: any) => request(`/settings/${key}`, { method: "PUT", body: JSON.stringify({ value }) }),
  listNotifications: () => request<any[]>("/notifications"),
  setNotification: (channel: string, enabled: boolean, config?: any) =>
    request(`/notifications/${channel}`, { method: "PUT", body: JSON.stringify({ enabled, config }) }),
  testNotification: (channel: string, config?: any) =>
    request<{ ok: boolean; error?: string }>(`/notifications/${channel}/test`, { method: "POST", body: JSON.stringify({ config }) }),
  deleteNotification: (channel: string) =>
    request(`/notifications/${channel}`, { method: "DELETE" }),
  listRules: () => request<any[]>("/rules"),
  updateRule: (id: string, data: any) => request(`/rules/${id}`, { method: "PATCH", body: JSON.stringify(data) }),

  // Notification commands
  listCommands: () => request<any[]>("/commands"),
  getTriggers: () => request<any[]>("/commands/triggers"),
  getActions:  () => request<any[]>("/commands/actions"),
  createCommand: (data: any) => request("/commands", { method: "POST", body: JSON.stringify(data) }),
  updateCommand: (id: string, data: any) => request(`/commands/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  deleteCommand: (id: string) => request(`/commands/${id}`, { method: "DELETE" }),
  fireCommand:   (id: string, vars?: any) => request(`/commands/${id}/fire`, { method: "POST", body: JSON.stringify({ vars: vars || {} }) }),

  // Bot commands (Telegram /xxx → server-side action)
  listBotCommands:   () => request<any[]>("/bot-commands"),
  getBotActions:     () => request<any[]>("/bot-commands/actions"),
  createBotCommand:  (data: any) => request("/bot-commands", { method: "POST", body: JSON.stringify(data) }),
  updateBotCommand:  (id: string, data: any) => request(`/bot-commands/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  deleteBotCommand:  (id: string) => request(`/bot-commands/${id}`, { method: "DELETE" }),
  runBotCommand:     (id: string, args?: string[]) => request<{ reply: string }>(`/bot-commands/${id}/run`, { method: "POST", body: JSON.stringify({ args: args || [] }) }),

  // Équipement réseau principal
  routerAdapters: () => request<any[]>("/router/adapters"),
  getRouter:      () => request<any>("/router"),
  saveRouter:     (data: any) => request("/router", { method: "PUT", body: JSON.stringify(data) }),
  deleteRouter:   () => request("/router", { method: "DELETE" }),
  detectRouter:   (data: any) => request<any>("/router/detect", { method: "POST", body: JSON.stringify(data) }),
  testRouter:     (data: any) => request<any>("/router/test", { method: "POST", body: JSON.stringify(data) }),
  routerClients:  () => request<{ supported: boolean; clients: any[] }>("/router/clients"),
  routerArp:      () => request<{ supported: boolean; entries: any[] }>("/router/arp"),

  // Maintenance
  dedupeDevices:  () => request<{ groups: number; removed: number }>("/devices/dedupe", { method: "POST" }),

  // Boites mail
  mailProviders: () => request<any[]>("/mail/providers"),
  mailboxes: () => request<any[]>("/mail/mailboxes"),
  verifyMailbox: (cfg: any) => request<any>("/mail/verify", { method: "POST", body: JSON.stringify(cfg) }),
  saveMailbox: (cfg: any) => request<any>("/mail/mailboxes", { method: "POST", body: JSON.stringify(cfg) }),
  deleteMailbox: (id: string) => request<any>(`/mail/mailboxes/${id}`, { method: "DELETE" }),

  // Premier lancement
  needsSetup: () => request<{ needsSetup: boolean }>("/auth/needs-setup"),
  bootstrap: (username: string, password: string) =>
    request<any>("/auth/bootstrap", { method: "POST", body: JSON.stringify({ username, password }) }),

  // Second facteur
  totpStatus: () => request<{ totpEnabled: boolean; telegramReady: boolean }>("/auth/totp/status"),
  totpSetup: () => request<{ secret: string; uri: string }>("/auth/totp/setup", { method: "POST" }),
  totpEnable: (code: string) => request<any>("/auth/totp/enable", { method: "POST", body: JSON.stringify({ code }) }),
  totpDisable: (password: string, code: string) =>
    request<any>("/auth/totp/disable", { method: "POST", body: JSON.stringify({ password, code }) }),

  // Réinitialisation du mot de passe
  resetStart: (username: string) =>
    request<{ ok: boolean; challengeId?: string; ttlMinutes: number }>("/auth/reset/start", { method: "POST", body: JSON.stringify({ username }) }),
  resetVerify: (challengeId: string, totpCode: string, telegramCode: string) =>
    request<{ resetToken: string }>("/auth/reset/verify", { method: "POST", body: JSON.stringify({ challengeId, totpCode, telegramCode }) }),
  resetComplete: (resetToken: string, password: string) =>
    request<any>("/auth/reset/complete", { method: "POST", body: JSON.stringify({ resetToken, password }) }),

  scanRanges: () => request<any[]>("/devices/scan/ranges"),

  health: () => request<{ status: string }>("/health"),
};

export { getToken };
