// UniFi adapter.
//
// UniFi can't be driven properly over SSH: the controller rewrites its own
// rules and erases anything injected by hand. So we go through its local API,
// the same one the web interface uses itself. Two dialects coexist:
//
//   UniFi OS (UDM, UDM-SE, UDR, Cloud Key Gen2+)  → /api/auth/login then
//                                                    /proxy/network/api/s/{site}/…
//   Standalone controller (Debian package, docker) → /api/login then /api/s/{site}/…
//
// We try the first, and fall back to the second if the host responds with 404.

import { RouterAdapter, AdapterContext, Target, ClientEntry } from "./types";
import { HttpSession } from "./http";

interface Session { http: HttpSession; base: string; site: string; verifyTls: boolean }

async function login(ctx: AdapterContext): Promise<Session> {
  const c = ctx.creds;
  const base = (c.apiBaseUrl || `https://${c.host}`).replace(/\/+$/, "");
  const site = c.site || "default";
  const verifyTls = c.verifyTls === true;
  const http = new HttpSession();

  // UniFi OS
  let res = await http.request(`${base}/api/auth/login`, {
    method: "POST",
    body: { username: c.username, password: c.password || "" },
    verifyTls,
  });

  if (res.status === 200) {
    const csrf = res.headers["x-csrf-token"] || res.headers["x-updated-csrf-token"];
    if (csrf) http.setHeader("X-CSRF-Token", String(csrf));
    return { http, base: `${base}/proxy/network`, site, verifyTls };
  }

  // Standalone controller
  res = await http.request(`${base}/api/login`, {
    method: "POST",
    body: { username: c.username, password: c.password || "" },
    verifyTls,
  });
  if (res.status === 200) return { http, base, site, verifyTls };

  throw new Error(
    res.status === 401
      ? "Credentials refused by the controller"
      : `The controller responded ${res.status}`,
  );
}

async function apiGet(s: Session, path: string) {
  const r = await s.http.request(`${s.base}/api/s/${s.site}${path}`, { verifyTls: s.verifyTls });
  return r.json<{ data?: any[] }>()?.data || [];
}

async function stamgr(s: Session, cmd: string, mac: string): Promise<string> {
  const r = await s.http.request(`${s.base}/api/s/${s.site}/cmd/stamgr`, {
    method: "POST",
    body: { cmd, mac: mac.toLowerCase() },
    verifyTls: s.verifyTls,
  });
  if (r.status !== 200) throw new Error(`Command ${cmd} refused (${r.status})`);
  return `${cmd} → ${mac}`;
}

// The API works by MAC. If the call arrives with an IP only, we resolve the
// MAC from the controller's list of known clients.
async function macOf(s: Session, t: Target): Promise<string> {
  if (t.mac) return t.mac;
  const list = await apiGet(s, "/stat/sta");
  const hit = list.find((c: any) => c.ip === t.ip);
  if (!hit?.mac) throw new Error(`No MAC address known for ${t.ip} on the controller side`);
  return hit.mac;
}

export const unifi: RouterAdapter = {
  id: "unifi",
  label: "Ubiquiti · UniFi",
  transport: "api",
  capabilities: ["ban", "unban", "clients", "arp", "ports", "vlans"],
  needs: ["password", "apiBaseUrl", "site"],
  detect: p => /unifi|udm|ubiquiti/i.test(p),

  test: async ctx => {
    try {
      const s = await login(ctx);
      const info = await s.http.request(`${s.base}/api/s/${s.site}/stat/sysinfo`, { verifyTls: s.verifyTls });
      const d = info.json<{ data?: any[] }>()?.data?.[0];
      const clients = await apiGet(s, "/stat/sta");
      return {
        ok: true,
        detected: "unifi",
        info: [
          d?.version ? `controller ${d.version}` : null,
          `${clients.length} clients connected`,
        ].filter(Boolean).join(" · "),
      };
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  },

  clients: async ctx => {
    const s = await login(ctx);
    const list = await apiGet(s, "/stat/sta");
    return list.map((c: any): ClientEntry => ({
      mac: String(c.mac || "").toUpperCase(),
      ip: c.ip,
      hostname: c.hostname || c.name,
      vendor: c.oui,
      medium: c.is_wired ? "wired" : "wireless",
      port: c.sw_port ?? c.ap_mac,
      uptimeSec: c.uptime,
      blocked: !!c.blocked,
    }));
  },

  arp: async ctx => {
    const s = await login(ctx);
    const list = await apiGet(s, "/stat/sta");
    return list.filter((c: any) => c.ip).map((c: any): ClientEntry => ({
      ip: c.ip, mac: String(c.mac || "").toUpperCase(),
      medium: c.is_wired ? "wired" : "wireless", port: c.sw_port,
    }));
  },

  ban: async (ctx, t) => {
    const s = await login(ctx);
    return stamgr(s, "block-sta", await macOf(s, t));
  },

  // UniFi has no partial isolation via API: we block, and we say so.
  quarantine: async (ctx, t) => {
    const s = await login(ctx);
    const out = await stamgr(s, "block-sta", await macOf(s, t));
    return `${out}\nNote: UniFi does not expose partial isolation; the device is blocked completely.`;
  },

  unban: async (ctx, t) => {
    const s = await login(ctx);
    return stamgr(s, "unblock-sta", await macOf(s, t));
  },
};
