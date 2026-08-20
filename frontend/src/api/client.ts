// Relative URL — nginx proxies /api/ → backend:4000
const BASE = "/api";

// The session token now lives in an HttpOnly cookie set by the server:
// it is never touched by JavaScript anymore, so an XSS can no longer steal it.
// The browser sends it on its own (same origin). This module now only handles
// the anti-CSRF token, which is not a secret.

const MUTATIONS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

// CSRF token: remembered from the login response, with a fallback to the
// readable `mapmylan_csrf` cookie (e.g. after a page reload).
let csrfToken: string | null = null;
export function setCsrfToken(t: string | null) { csrfToken = t; }

function lireCookie(nom: string): string | null {
  const m = document.cookie.match(new RegExp("(?:^|; )" + nom.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "=([^;]*)"));
  return m ? decodeURIComponent(m[1]) : null;
}

function jetonCsrf(): string | null {
  return csrfToken || lireCookie("mapmylan_csrf");
}

async function request<T = any>(path: string, options: RequestInit = {}): Promise<T> {
  const method = (options.method || "GET").toUpperCase();
  const headers: Record<string, string> = { "Content-Type": "application/json", ...(options.headers as any) };
  if (MUTATIONS.has(method)) {
    const c = jetonCsrf();
    if (c) headers["X-CSRF-Token"] = c;
  }
  // `same-origin`: sends the session cookie to our own origin.
  const res = await fetch(`${BASE}${path}`, { credentials: "same-origin", ...options, headers });
  if (res.status === 401) {
    // Session missing or expired. We notify the app (which will show the login
    // screen) rather than reloading in a loop.
    window.dispatchEvent(new CustomEvent("mapmylan:unauthorized"));
    throw new Error("Unauthorized");
  }
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
  return data;
}

export const api = {
  // Auth
  login: (username: string, password: string) =>
    request<{ user: any; setupComplete: boolean; csrfToken: string }>("/auth/login", { method: "POST", body: JSON.stringify({ username, password }) }),
  logout: () => request("/auth/logout", { method: "POST" }),
  changePassword: (username: string, oldPassword: string, newPassword: string) =>
    request<{ ok: boolean; csrfToken?: string }>("/auth/change-password", { method: "POST", body: JSON.stringify({ username, oldPassword, newPassword }) }),

  // Setup
  setupStatus: () => request<{ complete: boolean; mainRouter: any }>("/setup/status"),
  completeSetup: () => request("/setup/complete", { method: "POST" }),

  // Devices
  listDevices: () => request<any[]>("/devices"),
  getDevice: (id: string) => request<any>(`/devices/${id}`),
  scan: (subnet?: string) => request("/devices/scan", { method: "POST", body: JSON.stringify({ subnet }) }),
  createManualDevice: (data: any) => request<any>("/devices/manual", { method: "POST", body: JSON.stringify(data) }),
  deleteDevice: (id: string) => request(`/devices/${id}`, { method: "DELETE" }),
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
  createVlan: (data: any) => request<{ vlan: any; provision: any }>("/vlans", { method: "POST", body: JSON.stringify(data) }),
  updateVlan: (id: number, data: any) => request(`/vlans/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  deleteVlan: (id: number, removeFromRouter = true) => request(`/vlans/${id}?removeFromRouter=${removeFromRouter}`, { method: "DELETE" }),

  // SSH
  listSsh: () => request<any[]>("/ssh"),
  addSsh: (data: any) => request("/ssh", { method: "POST", body: JSON.stringify(data) }),
  testSsh: (data: any) => request<{ ok: boolean; error?: string; banner?: string }>("/ssh/test", { method: "POST", body: JSON.stringify(data) }),
  deleteSsh: (id: string) => request(`/ssh/${id}`, { method: "DELETE" }),
  execSsh: (id: string, command: string) => request<{ stdout: string; stderr: string; code: number | null }>(`/ssh/${id}/exec`, { method: "POST", body: JSON.stringify({ command }) }),

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

  // Main network gear
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

  health: () => request<{ status: string }>("/health"),
};
