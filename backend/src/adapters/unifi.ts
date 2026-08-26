// Adaptateur UniFi.
//
// UniFi ne se pilote pas correctement en SSH : le contrôleur réécrit ses règles
// et efface ce qu'on injecte à la main. On passe donc par son API locale, celle
// que l'interface web utilise elle-même. Deux dialectes coexistent :
//
//   UniFi OS (UDM, UDM-SE, UDR, Cloud Key Gen2+)  → /api/auth/login puis
//                                                    /proxy/network/api/s/{site}/…
//   Contrôleur autonome (paquet Debian, docker)   → /api/login puis /api/s/{site}/…
//
// On tente le premier, et on retombe sur le second si l'hôte répond 404.

import {
  RouterAdapter, AdapterContext, Target, ClientEntry, InfraEntry, ReseauEntry, Reservation,
} from "./types";
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

  // Contrôleur autonome
  res = await http.request(`${base}/api/login`, {
    method: "POST",
    body: { username: c.username, password: c.password || "" },
    verifyTls,
  });
  if (res.status === 200) return { http, base, site, verifyTls };

  throw new Error(
    res.status === 401
      ? "Identifiants refusés par le contrôleur"
      : `Le contrôleur a répondu ${res.status}`,
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
  if (r.status !== 200) throw new Error(`Commande ${cmd} refusée (${r.status})`);
  return `${cmd} → ${mac}`;
}

// L'API travaille par MAC. Si l'appel arrive avec une IP seule, on résout la
// MAC depuis la liste des clients connus du contrôleur.
async function macOf(s: Session, t: Target): Promise<string> {
  if (t.mac) return t.mac;
  const list = await apiGet(s, "/stat/sta");
  const hit = list.find((c: any) => c.ip === t.ip);
  if (!hit?.mac) throw new Error(`Aucune adresse MAC connue pour ${t.ip} côté contrôleur`);
  return hit.mac;
}

export const unifi: RouterAdapter = {
  id: "unifi",
  label: "Ubiquiti · UniFi",
  transport: "api",
  capabilities: ["ban", "unban", "clients", "arp", "ports", "vlans", "reservation"],
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
          d?.version ? `contrôleur ${d.version}` : null,
          `${clients.length} clients connectés`,
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
      // Le port de commutation et la borne sont deux informations distinctes :
      // c'est ce qui permet de reconstituer la topologie physique.
      swPort: typeof c.sw_port === "number" ? c.sw_port : undefined,
      swMac: c.sw_mac || undefined,
      apMac: c.ap_mac || undefined,
      essid: c.essid || undefined,
      radio: c.radio || undefined,
      rssi: typeof c.rssi === "number" ? c.rssi : undefined,
      uptimeSec: c.uptime,
      blocked: !!c.blocked,
    }));
  },

  // Les équipements UniFi eux-mêmes.
  //
  // /stat/sta ne contient que les clients : la passerelle, les commutateurs et
  // les bornes n'y figurent pas. Ils vivent dans /stat/device, avec un champ
  // « uplink » qui dit à quoi chacun est raccordé. C'est la hiérarchie réelle,
  // mesurée par le contrôleur — il n'y a rien à en déduire.
  infrastructure: async ctx => {
    const s = await login(ctx);
    const list = await apiGet(s, "/stat/device");
    return list.map((d: any): InfraEntry => {
      const t = String(d.type || "").toLowerCase();
      // ugw et udm : passerelle ; usw : commutateur ; uap : borne.
      const kind: InfraEntry["kind"] =
        t === "usw" ? "switch" : t === "uap" ? "ap" : "router";
      const up = d.uplink || {};
      const upMac = up.uplink_mac || up.mac;

      // Sur une passerelle, le champ « ip » de /stat/device est l'adresse
      // *WAN* : sur une UDM derrière une box, c'est un 192.168.x.x qui
      // n'existe pas sur le LAN. L'adresse utile est celle à laquelle
      // MapMyLAN la joint déjà — donc celle de sa fiche.
      const wan = d.wan1 || d.wan2 || {};
      const ipLan = kind === "router" ? (ctx.creds.host || d.ip) : d.ip;

      // La box de l'opérateur, telle que la passerelle la voit côté WAN.
      // Les modèles ne l'exposent pas tous au même endroit.
      const passerelleWan =
        wan.gateway ||
        (Array.isArray(up.gateways) ? up.gateways[0] : undefined) ||
        d.config_network?.gateway ||
        undefined;

      return {
        mac: String(d.mac || "").toUpperCase(),
        ip: ipLan || undefined,
        name: d.name || d.hostname || undefined,
        model: d.model || undefined,
        kind,
        uplinkMac: upMac ? String(upMac).toUpperCase() : undefined,
        uplinkPort: typeof up.uplink_remote_port === "number" ? up.uplink_remote_port : undefined,
        uplinkMedium: up.type === "wireless" ? "wireless" : upMac ? "wired" : undefined,
        wanIp: kind === "router" ? (wan.ip || d.ip || undefined) : undefined,
        wanGateway: kind === "router" ? passerelleWan : undefined,
        version: d.version || undefined,
        uptimeSec: typeof d.uptime === "number" ? d.uptime : undefined,
      };
    }).filter((e: InfraEntry) => e.mac);
  },

  // Les réseaux déclarés sur la passerelle.
  //
  // `ip_subnet` vaut « 198.51.100.1/24 » : la partie hôte est l'adresse que la
  // passerelle porte sur ce VLAN. C'est elle qui apparaissait sur la carte
  // comme un appareil séparé.
  networks: async ctx => {
    const s = await login(ctx);
    const list = await apiGet(s, "/rest/networkconf");
    // On ne filtre plus sur la présence d'une passerelle. La carte, elle,
    // continue de ne garder que les réseaux routés — c'est elle qui écarte le
    // reste — mais le relevé des VLAN a besoin de voir aussi ceux qui n'ont pas
    // de passerelle, ne serait-ce que pour pouvoir le signaler.
    return list.map((n: any): ReseauEntry => {
      const cidr = typeof n.ip_subnet === "string" ? n.ip_subnet : undefined;
      const passerelle = cidr?.split("/")[0];
      return {
        nom: n.name || undefined,
        id: typeof n._id === "string" ? n._id : undefined,
        vlan: typeof n.vlan === "number" ? n.vlan : Number(n.vlan) || undefined,
        cidr,
        passerelle: passerelle && /^\d{1,3}(\.\d{1,3}){3}$/.test(passerelle) ? passerelle : undefined,
        role: typeof n.purpose === "string" ? n.purpose : undefined,
      };
    });
  },

  // ── Réservation d'adresse ────────────────────────────────────────────────
  //
  // C'est la « Fixed IP » de l'interface UniFi, et c'est la seule façon
  // honnête de « changer l'adresse » d'une machine depuis un outil tiers :
  // on ne réécrit pas la configuration de l'appareil, on demande à la
  // passerelle de toujours lui servir la même adresse.
  //
  // Le contrôleur veut un client qu'il connaît déjà. Une machine jamais vue
  // n'a pas de fiche à modifier, et on le dit plutôt que d'en inventer une.
  reserver: async (ctx, r: Reservation) => {
    const s = await login(ctx);
    const mac = String(r.mac || "").toLowerCase();
    if (!mac) throw new Error("Réservation impossible sans adresse MAC.");

    const connus = await apiGet(s, "/rest/user");
    const fiche = connus.find((u: any) => String(u.mac || "").toLowerCase() === mac);
    if (!fiche?._id) {
      throw new Error(
        `Le contrôleur ne connaît pas encore ${mac}. Il faut qu'il l'ait vue se connecter au moins une fois.`);
    }

    const corps: any = r.ip
      ? { use_fixedip: true, fixed_ip: r.ip, ...(r.networkId ? { network_id: r.networkId } : {}) }
      : { use_fixedip: false };

    const res = await s.http.request(`${s.base}/api/s/${s.site}/rest/user/${fiche._id}`, {
      method: "PUT", body: corps, verifyTls: s.verifyTls,
    });
    if (res.status !== 200) {
      const j: any = res.json();
      const detail = j?.meta?.msg || `HTTP ${res.status}`;
      throw new Error(`Le contrôleur a refusé la réservation : ${detail}`);
    }
    return r.ip
      ? `Adresse ${r.ip} réservée pour ${mac}`
      : `Réservation retirée pour ${mac}`;
  },

  // Couper la session force un nouveau bail : sans ça, l'appareil garde son
  // adresse actuelle jusqu'à l'expiration de la sienne.
  relancerBail: async (ctx, t) => {
    const s = await login(ctx);
    return stamgr(s, "kick-sta", await macOf(s, t));
  },

  arp: async ctx => {
    const s = await login(ctx);
    const list = await apiGet(s, "/stat/sta");
    return list.filter((c: any) => c.ip).map((c: any): ClientEntry => ({
      ip: c.ip, mac: String(c.mac || "").toUpperCase(),
      medium: c.is_wired ? "wired" : "wireless", port: c.sw_port,
      swPort: typeof c.sw_port === "number" ? c.sw_port : undefined,
      swMac: c.sw_mac || undefined, apMac: c.ap_mac || undefined,
    }));
  },

  ban: async (ctx, t) => {
    const s = await login(ctx);
    return stamgr(s, "block-sta", await macOf(s, t));
  },

  // UniFi ne connaît pas l'isolement partiel par API : on bloque, et on le dit.
  quarantine: async (ctx, t) => {
    const s = await login(ctx);
    const out = await stamgr(s, "block-sta", await macOf(s, t));
    return `${out}\nNote : UniFi n'expose pas d'isolement partiel, l'appareil est bloqué complètement.`;
  },

  unban: async (ctx, t) => {
    const s = await login(ctx);
    return stamgr(s, "unblock-sta", await macOf(s, t));
  },
};
