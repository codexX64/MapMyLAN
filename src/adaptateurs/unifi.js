// Adaptateur UniFi, par l'API locale du contrôleur (celle de son interface
// web) : le contrôleur réécrit ses règles et efface ce qu'on injecterait en
// SSH. Deux dialectes coexistent :
//
//   UniFi OS (consoles et Cloud Key 2+) → /api/auth/login puis /proxy/network/api/s/{site}/…
//   contrôleur autonome              → /api/login puis /api/s/{site}/…
//
// Toutes les requêtes passent par ctx.http (session.js) : garde de sortie,
// certificat épinglé ou vérifié, jamais de vérification désactivée.
import { ErreurHttp } from '../../socle/src/index.js';

const SITE = /^[A-Za-z0-9_-]{1,64}$/;

async function ouvrir(ctx) {
  const c = ctx.creds;
  const base = (c.apiBaseUrl || `https://${c.host}`).replace(/\/+$/, '');
  const site = c.site || 'default';
  if (!SITE.test(site)) throw new ErreurHttp(400, 'Site UniFi invalide.');
  const http = ctx.http();
  let r = await http.requete(`${base}/api/auth/login`, { methode: 'POST', corps: { username: c.username, password: c.password || '' } });
  if (r.status === 200) {
    const csrf = r.entetes.get('x-csrf-token') || r.entetes.get('x-updated-csrf-token');
    if (csrf) http.poserEntete('X-CSRF-Token', csrf);
    return { http, base: `${base}/proxy/network`, site };
  }
  r = await http.requete(`${base}/api/login`, { methode: 'POST', corps: { username: c.username, password: c.password || '' } });
  if (r.status === 200) return { http, base, site };
  throw new ErreurHttp(502, r.status === 401 || r.status === 400 ? 'Identifiants refusés par le contrôleur.' : `Le contrôleur a répondu ${r.status}.`);
}

async function lire(s, chemin) {
  const r = await s.http.requete(`${s.base}/api/s/${s.site}${chemin}`);
  const j = r.json();
  return Array.isArray(j?.data) ? j.data : [];
}

async function stamgr(s, cmd, mac) {
  const r = await s.http.requete(`${s.base}/api/s/${s.site}/cmd/stamgr`, { methode: 'POST', corps: { cmd, mac: mac.toLowerCase() } });
  if (r.status !== 200) throw new ErreurHttp(502, `Commande ${cmd} refusée par le contrôleur (${r.status}).`);
  return `${cmd} → ${mac}`;
}

// L'API travaille par MAC ; une adresse seule est résolue par la liste des
// clients que le contrôleur connaît.
async function macDe(s, t) {
  if (t.mac) return t.mac;
  const hit = (await lire(s, '/stat/sta')).find(c => c.ip === t.ip);
  if (!/^[0-9a-f:]{17}$/i.test(hit?.mac || '')) throw new ErreurHttp(409, `Aucune adresse MAC connue pour ${t.ip} côté contrôleur.`);
  return hit.mac;
}

const entier = v => (typeof v === 'number' && Number.isInteger(v) ? v : undefined);

// Le bouclier de VIGIE : deux groupes d'adresses que VIGIE remplit, et que
// deux règles du pare-feu (posées une fois dans UniFi) refusent. Rien d'autre
// n'est écrit sur le contrôleur.
export const GROUPES_BOUCLIER = { 4: 'VIGIE bloquees IPv4', 6: 'VIGIE bloquees IPv6' };
const TYPE_GROUPE = { 4: 'address-group', 6: 'ipv6-address-group' };
// UniFi refuse un groupe vide : une adresse de documentation le tient ouvert.
const VIDE = { 4: '192.0.2.1', 6: '2001:db8::1' };

async function ecrireGroupe(s, existant, v, membres) {
  const corps = existant
    ? { ...existant, group_members: membres }
    : { name: GROUPES_BOUCLIER[v], group_type: TYPE_GROUPE[v], group_members: membres };
  const url = `${s.base}/api/s/${s.site}/rest/firewallgroup${existant ? `/${existant._id}` : ''}`;
  const r = await s.http.requete(url, { methode: existant ? 'PUT' : 'POST', corps });
  const j = r.json();
  if (r.status !== 200 || (j?.meta?.rc && j.meta.rc !== 'ok')) throw new ErreurHttp(502, `Le contrôleur a refusé le groupe ${GROUPES_BOUCLIER[v]} : ${j?.meta?.msg || `HTTP ${r.status}`}.`);
  return existant?._id || j?.data?.[0]?._id || null;
}

// Les règles qui citent nos groupes : celles du pare-feu classique, et les
// politiques du pare-feu par zones (UniFi Network 9 et plus). Sans elles, un
// groupe ne bloque rien.
async function reglesBouclier(s, ids) {
  const liste = ids.filter(Boolean);
  const cite = (o, ...cles) => cles.some(k => liste.some(id => JSON.stringify(o?.[k] ?? '').includes(id)));
  const out = { entrant: false, sortant: false, regles: [] };
  const noter = (nom, actif, entrant, sortant) => {
    out.regles.push({ nom: String(nom || 'sans nom').slice(0, 80), actif });
    if (actif && entrant) out.entrant = true;
    if (actif && sortant) out.sortant = true;
  };
  for (const r of await lire(s, '/rest/firewallrule').catch(() => [])) {
    if (!/drop|reject/i.test(r.action || '') || !cite(r, 'src_firewallgroup_ids', 'dst_firewallgroup_ids')) continue;
    noter(r.name, r.enabled !== false, cite(r, 'src_firewallgroup_ids'), cite(r, 'dst_firewallgroup_ids'));
  }
  const p = await s.http.requete(`${s.base}/v2/api/site/${s.site}/firewall-policies`).catch(() => null);
  const politiques = p?.status === 200 ? p.json() : null;
  for (const r of Array.isArray(politiques) ? politiques : Array.isArray(politiques?.data) ? politiques.data : []) {
    if (!/block|reject/i.test(JSON.stringify(r.action ?? '')) || !cite(r, 'source', 'destination')) continue;
    noter(r.name, r.enabled !== false, cite(r, 'source'), cite(r, 'destination'));
  }
  return out;
}

export const unifi = {
  id: 'unifi', label: 'Ubiquiti · UniFi', transport: 'api',
  capabilities: ['ban', 'unban', 'clients', 'arp', 'ports', 'vlans', 'reservation', 'bouclier', 'ips'], needs: ['password', 'apiBaseUrl', 'site'],
  detect: p => /unifi|udm|ubiquiti/i.test(p),

  test: async ctx => {
    try {
      const s = await ouvrir(ctx);
      const info = (await lire(s, '/stat/sysinfo'))[0];
      const clients = await lire(s, '/stat/sta');
      return { ok: true, detected: 'unifi', info: [info?.version ? `contrôleur ${info.version}` : null, `${clients.length} clients connectés`].filter(Boolean).join(' · ') };
    } catch (e) { return { ok: false, error: e.message }; }
  },

  clients: async ctx => {
    const s = await ouvrir(ctx);
    return (await lire(s, '/stat/sta')).map(c => ({
      mac: String(c.mac || '').toUpperCase(), ip: c.ip, hostname: c.hostname || c.name, vendor: c.oui,
      medium: c.is_wired ? 'wired' : 'wireless', port: c.sw_port ?? c.ap_mac,
      swPort: entier(c.sw_port), swMac: c.sw_mac || undefined, apMac: c.ap_mac || undefined,
      essid: c.essid || undefined, radio: c.radio || undefined, rssi: entier(c.rssi), uptimeSec: c.uptime, blocked: !!c.blocked,
    }));
  },

  // La passerelle, les commutateurs et les bornes ne sont pas des clients :
  // /stat/device les donne, avec leur liaison amont mesurée par le contrôleur.
  infrastructure: async ctx => {
    const s = await ouvrir(ctx);
    return (await lire(s, '/stat/device')).map(d => {
      const t = String(d.type || '').toLowerCase();
      const kind = t === 'usw' ? 'switch' : t === 'uap' ? 'ap' : 'router';
      const up = d.uplink || {};
      const upMac = up.uplink_mac || up.mac;
      const wan = d.wan1 || d.wan2 || {};
      // Sur une passerelle, « ip » est l'adresse WAN : l'adresse utile est
      // celle à laquelle MapMyLAN la joint déjà.
      const ipLan = kind === 'router' ? (ctx.creds.host || d.ip) : d.ip;
      const passerelleWan = wan.gateway || (Array.isArray(up.gateways) ? up.gateways[0] : undefined) || d.config_network?.gateway || undefined;
      return {
        mac: String(d.mac || '').toUpperCase(), ip: ipLan || undefined, name: d.name || d.hostname || undefined, model: d.model || undefined, kind,
        uplinkMac: upMac ? String(upMac).toUpperCase() : undefined, uplinkPort: entier(up.uplink_remote_port),
        uplinkMedium: up.type === 'wireless' ? 'wireless' : upMac ? 'wired' : undefined,
        wanIp: kind === 'router' ? (wan.ip || d.ip || undefined) : undefined, wanGateway: kind === 'router' ? passerelleWan : undefined,
        version: d.version || undefined, uptimeSec: entier(d.uptime),
      };
    }).filter(e => e.mac);
  },

  // « ip_subnet » vaut « a.b.c.1/24 » : la partie hôte est l'adresse que la
  // passerelle porte sur ce VLAN.
  networks: async ctx => {
    const s = await ouvrir(ctx);
    return (await lire(s, '/rest/networkconf')).map(n => {
      const cidr = typeof n.ip_subnet === 'string' ? n.ip_subnet : undefined;
      const passerelle = cidr?.split('/')[0];
      return {
        nom: n.name || undefined, id: typeof n._id === 'string' ? n._id : undefined,
        vlan: typeof n.vlan === 'number' ? n.vlan : Number(n.vlan) || undefined, cidr,
        passerelle: passerelle && /^\d{1,3}(\.\d{1,3}){3}$/.test(passerelle) ? passerelle : undefined,
        role: typeof n.purpose === 'string' ? n.purpose : undefined,
      };
    });
  },

  // La « Fixed IP » de l'interface UniFi : la passerelle servira toujours la
  // même adresse à cette carte. Le contrôleur doit déjà connaître le client.
  reserver: async (ctx, r) => {
    const s = await ouvrir(ctx);
    const mac = String(r.mac || '').toLowerCase();
    const fiche = (await lire(s, '/rest/user')).find(u => String(u.mac || '').toLowerCase() === mac);
    if (!/^[0-9a-f]{24}$/i.test(fiche?._id || '')) throw new ErreurHttp(409, `Le contrôleur ne connaît pas encore ${mac} : il faut qu’il l’ait vue se connecter au moins une fois.`);
    const corps = r.ip ? { use_fixedip: true, fixed_ip: r.ip, ...(r.networkId ? { network_id: r.networkId } : {}) } : { use_fixedip: false };
    const rep = await s.http.requete(`${s.base}/api/s/${s.site}/rest/user/${fiche._id}`, { methode: 'PUT', corps });
    if (rep.status !== 200) throw new ErreurHttp(502, `Le contrôleur a refusé la réservation : ${rep.json()?.meta?.msg || `HTTP ${rep.status}`}.`);
    return r.ip ? `Adresse ${r.ip} réservée pour ${mac}` : `Réservation retirée pour ${mac}`;
  },

  relancerBail: async (ctx, t) => { const s = await ouvrir(ctx); return stamgr(s, 'kick-sta', await macDe(s, t)); },

  arp: async ctx => {
    const s = await ouvrir(ctx);
    return (await lire(s, '/stat/sta')).filter(c => c.ip).map(c => ({
      ip: c.ip, mac: String(c.mac || '').toUpperCase(), medium: c.is_wired ? 'wired' : 'wireless', port: c.sw_port,
      swPort: entier(c.sw_port), swMac: c.sw_mac || undefined, apMac: c.ap_mac || undefined,
    }));
  },

  ban: async (ctx, t) => { const s = await ouvrir(ctx); return stamgr(s, 'block-sta', await macDe(s, t)); },
  // UniFi n'expose pas d'isolement partiel par API : on bloque, et on le dit.
  quarantine: async (ctx, t) => {
    const s = await ouvrir(ctx);
    return `${await stamgr(s, 'block-sta', await macDe(s, t))}\nNote : UniFi n’expose pas d’isolement partiel, l’appareil est bloqué complètement.`;
  },
  unban: async (ctx, t) => { const s = await ouvrir(ctx); return stamgr(s, 'unblock-sta', await macDe(s, t)); },

  // Les deux groupes égaux à la liste reçue (adresses publiques déjà vérifiées par la route).
  bouclier: async (ctx, ips) => {
    const s = await ouvrir(ctx);
    const groupes = await lire(s, '/rest/firewallgroup');
    const out = {};
    for (const v of [4, 6]) {
      const miennes = ips.filter(ip => (v === 4 ? !ip.includes(':') : ip.includes(':')));
      const existant = groupes.find(g => g.name === GROUPES_BOUCLIER[v] && g.group_type === TYPE_GROUPE[v]);
      const id = await ecrireGroupe(s, existant, v, miennes.length ? miennes : [VIDE[v]]);
      out[v] = { id, nom: GROUPES_BOUCLIER[v], n: miennes.length };
    }
    return { groupes: out, regles: await reglesBouclier(s, [out[4].id, out[6].id]) };
  },

  // Les alertes de l'IPS de la passerelle (Suricata intégré) depuis une date.
  ips: async (ctx, { depuis, jusque = Date.now(), limite = 500 }) => {
    const s = await ouvrir(ctx);
    const r = await s.http.requete(`${s.base}/api/s/${s.site}/stat/ips/event`, { methode: 'POST', corps: { start: depuis, end: jusque, _limit: limite } });
    if (r.status !== 200) throw new ErreurHttp(502, `Le contrôleur n’a pas rendu ses alertes d’IPS (HTTP ${r.status}).`);
    const ms = t => (typeof t === 'number' ? (t < 1e12 ? t * 1000 : t) : Date.parse(t) || null);
    return (Array.isArray(r.json()?.data) ? r.json().data : []).slice(0, limite).map(e => ({
      id: typeof e._id === 'string' ? e._id.slice(0, 40) : undefined,
      quand: ms(e.timestamp ?? e.time ?? e.datetime),
      src: e.src_ip, sport: entier(e.src_port), dst: e.dest_ip ?? e.dst_ip, dport: entier(e.dest_port ?? e.dst_port), proto: e.proto,
      signature: String(e.inner_alert_signature ?? e.msg ?? '').slice(0, 200), sid: entier(e.inner_alert_signature_id),
      categorie: String(e.inner_alert_category ?? e.catname ?? '').slice(0, 80), gravite: entier(e.inner_alert_severity),
      action: String(e.inner_alert_action ?? '').slice(0, 20),
    }));
  },
};
