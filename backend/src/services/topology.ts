// Construction automatique de la topologie.
//
// Ordre de confiance, du plus sûr au moins sûr :
//
//   1. la chaîne montante déclarée par le constructeur (chaque équipement dit
//      à quoi il est raccordé) ;
//   2. le port de commutation et la borne relevés par appareil ;
//   3. le média mesuré — filaire ou sans fil — qui interdit à lui seul les
//      rattachements impossibles ;
//   4. à défaut, un rattachement au réseau filaire, compté comme présumé.
//
// Ce qui n'est plus utilisé : la déduction du sans-fil à partir du plan
// d'adressage. Elle classait des machines filaires en Wi-Fi.

import { exec } from "child_process";
import { promisify } from "util";
import { prisma } from "../db";
import { eventBus } from "../ws/realtime";
import { logEvent } from "./logger";

const execAsync = promisify(exec);

async function tryRun(cmd: string, timeout = 8000): Promise<string> {
  try {
    const { stdout } = await execAsync(cmd, { timeout, maxBuffer: 8 * 1024 * 1024 });
    return stdout;
  } catch { return ""; }
}

export async function autoBuildTopology(opts: { force?: boolean } = {}): Promise<{ created: number; deleted: number }> {
  // Le réglage ne conditionne que les déclenchements automatiques ; un clic
  // explicite sur « Reconstruire » passe toujours.
  if (!opts.force) {
    const enabled = await prisma.setting.findUnique({ where: { key: "topology.autoBuild" } });
    if (!enabled || enabled.value === false) return { created: 0, deleted: 0 };
  }

  // On ne touche jamais aux liens tracés à la main.
  const before = await prisma.topologyLink.deleteMany({ where: { manual: false } });

  const all = await prisma.device.findMany({ where: { status: { not: "offline" } } });
  if (all.length === 0) return { created: 0, deleted: before.count };

  // ── Ce que l'équipement rapporte, et rien d'autre ────────────────────────
  //
  // La version précédente déduisait le sans-fil du plan d'adressage (troisième
  // octet ≥ 10). C'est une convention de laboratoire, pas une loi : sur un
  // réseau ordinaire elle classe des machines filaires en Wi-Fi et les accroche
  // à une borne, ce qui est physiquement impossible. On ne s'en sert plus. Une
  // liaison n'est tracée que sur ce que le contrôleur a mesuré, ou sur un
  // rattachement par défaut clairement identifié comme tel.
  const vue = (d: any) => (d.metadata || {}) as any;
  const octets = (ip: string) => (ip || "").split(".").map(Number);
  const lastOctet = (ip: string) => octets(ip)[3] ?? -1;
  const category = (ip: string) => octets(ip)[2] ?? -1;

  // ── Racine : la passerelle ────────────────────────────────────────────────
  // L'équipement principal enregistré d'abord ; à défaut, celui que le
  // constructeur déclare comme passerelle ; à défaut seulement, une déduction.
  const mainSsh = await prisma.sshDevice.findFirst({ where: { isMainRouter: true } });
  const gateway =
    (mainSsh ? all.find(d => d.ip === mainSsh.host) : undefined) ||
    all.find(d => vue(d).infra && vue(d).infraKind === "router") ||
    all.find(d => d.isMainRouter) ||
    all.find(d => d.type === "router" || d.type === "firewall") ||
    all[0];

  // ── Index par MAC ─────────────────────────────────────────────────────────
  const parMac = new Map<string, any>();
  for (const d of all) if (d.mac) parMac.set(String(d.mac).toUpperCase(), d);

  // ── Équipements d'infrastructure ──────────────────────────────────────────
  const infraTypes = ["router", "switch", "ap", "firewall"];
  // La box de l'opérateur est en amont : elle n'est pas de l'infrastructure interne.
  const infra = all.filter(d => infraTypes.includes(d.type) && d.id !== gateway.id
                            && !vue(d).operateur && !vue(d).passerelleDe);
  const switches = infra.filter(d => d.type === "switch");
  const aps = infra.filter(d => d.type === "ap");

  // Faute de borne déclarée, un routeur secondaire fait office de point
  // d'accès : c'est le cas d'un routeur Wi-Fi reconverti en borne.
  const wifiHub = aps[0] || infra.find(d => d.type === "router") || gateway;
  // Un appareil filaire qui n'est pas vu directement par la passerelle est
  // derrière le commutateur — s'il y en a un de recensé.
  const wiredHub = switches[0] || gateway;

  const links: { fromId: string; toId: string; type: string }[] = [];

  // ── Chaîne montante : box opérateur → passerelle → commutateurs → bornes ──
  // Chaque équipement du constructeur porte la MAC de son amont. C'est mesuré :
  // on le suit tel quel, sans supposer que tout pend de la passerelle.
  const rattache = new Set<string>();

  // Une passerelle de VLAN n'est pas une machine : c'est la même boîte, vue par
  // une autre de ses adresses. Le contrôleur déclare ces adresses ; on relie
  // donc ces fiches à la passerelle par un lien « même appareil » au lieu de
  // les faire pendre comme des clients.
  const interfaces = all.filter(d => vue(d).passerelleDe && d.id !== gateway.id);
  for (const d of interfaces) {
    const hote = parMac.get(String(vue(d).passerelleDe).toUpperCase()) || gateway;
    if (hote.id === d.id) continue;
    links.push({ fromId: hote.id, toId: d.id, type: "sibling" });
    rattache.add(d.id);
  }

  const box = all.find(d => vue(d).operateur);
  if (box && box.id !== gateway.id) {
    links.push({ fromId: box.id, toId: gateway.id, type: "wan" });
    rattache.add(gateway.id);
    rattache.add(box.id);
  }

  for (const h of infra) {
    const v = vue(h);
    // L'amont déclaré par le constructeur d'abord. Un équipement tiers — une
    // borne non adoptée, par exemple — n'en déclare pas : on se rabat alors sur
    // le port de commutation relevé, qui est mesuré lui aussi.
    const amont =
      (v.uplinkMac && parMac.get(String(v.uplinkMac).toUpperCase())) ||
      (v.swMac && parMac.get(String(v.swMac).toUpperCase())) ||
      undefined;
    const cible = amont && amont.id !== h.id ? amont : gateway;
    links.push({
      fromId: cible.id, toId: h.id,
      type: v.uplinkMedium === "wireless" || (!v.uplinkMac && v.medium === "wireless")
        ? "wifi" : "ethernet",
    });
    rattache.add(h.id);
  }

  // ── Commutateur non géré ──────────────────────────────────────────────────
  // Plusieurs MAC derrière un seul port : il y a une boîte entre les deux. On
  // insère un nœud à cet endroit plutôt que de rattacher tout le monde
  // directement au commutateur, ce qui serait faux.
  const mesures = all.filter(d => vue(d).swPort !== undefined || vue(d).apMac);
  const parPort = new Map<string, any[]>();
  for (const d of mesures) {
    const v = vue(d);
    if (v.swPort === undefined) continue;
    if (v.infra) continue;                      // un commutateur adopté n'est pas un client
    const cle = `${v.swMac || "gw"}:${v.swPort}`;
    parPort.set(cle, [...(parPort.get(cle) || []), d]);
  }

  const switchsDeduits = new Map<string, any>();
  for (const [cle, membres] of parPort) {
    if (membres.length < 3) continue;          // deux appareils ne font pas un switch
    const [swMac, port] = cle.split(":");
    const nom = `Commutateur déduit · port ${port}`;
    const existant = all.find(d => d.hostname === nom);
    const noeud = existant || await prisma.device.create({
      data: {
        ip: `0.0.0.${100 + switchsDeduits.size}`,   // repère interne, non routable
        hostname: nom,
        type: "switch",
        status: "online",
        vendor: "déduit",
        metadata: { deduit: true, swMac, swPort: Number(port), membres: membres.length },
      },
    }).catch(() => null);
    if (noeud) switchsDeduits.set(cle, noeud);
  }

  // ── Rattachement des appareils ────────────────────────────────────────────
  let presumes = 0;
  for (const d of all) {
    if (d.id === gateway.id || rattache.has(d.id)) continue;
    if (infra.some(h => h.id === d.id)) continue;
    if ([...switchsDeduits.values()].some(n => n.id === d.id)) continue;

    const v = vue(d);
    const filaire = v.medium === "wired";
    const sansFil = v.medium === "wireless";

    // 1. Sans fil, et seulement quand c'est **mesuré**.
    //
    //    La présence d'une MAC de borne ne suffit pas : plusieurs versions de
    //    micrologiciel UniFi renseignent `ap_mac` sur des clients filaires, où
    //    il désigne l'équipement amont et non une borne. S'en servir accrochait
    //    tout le parc filaire à la borne Wi-Fi — un rattachement physiquement
    //    impossible, et c'est ce qui se voyait sur la carte.
    if (sansFil) {
      const borne = v.apMac ? parMac.get(String(v.apMac).toUpperCase()) : undefined;
      links.push({ fromId: (borne || wifiHub).id, toId: d.id, type: "wifi" });
      if (!borne) presumes++;
      continue;
    }

    // 2. Filaire : jamais une borne, quoi qu'il arrive. Le commutateur qui
    //    porte le port si on le connaît, sinon le commutateur du parc, sinon
    //    la passerelle.
    if (v.swPort !== undefined) {
      const cle = `${v.swMac || "gw"}:${v.swPort}`;
      const cible = switchsDeduits.get(cle)
        || (v.swMac && parMac.get(String(v.swMac).toUpperCase()))
        || wiredHub;
      links.push({ fromId: cible.id, toId: d.id, type: "ethernet" });
      continue;
    }
    // 3. Filaire, ou média inconnu. Faute de port, on prend l'équipement amont
    //    quand le contrôleur en désigne un — `swMac` d'abord, `apMac` ensuite,
    //    qui vaut alors uplink et non borne — sinon le commutateur du parc.
    // `apMac` ne sert d'amont que s'il ne désigne pas une borne : un appareil
    // filaire ne se branche pas derrière un point d'accès.
    const parAp = v.apMac ? parMac.get(String(v.apMac).toUpperCase()) : undefined;
    const amont =
      (v.swMac && parMac.get(String(v.swMac).toUpperCase())) ||
      (parAp && parAp.type !== "ap" ? parAp : undefined);
    links.push({ fromId: (amont || wiredHub).id, toId: d.id, type: "ethernet" });
    if (!amont) presumes++;
  }

  // Les commutateurs déduits pendent du commutateur qui porte leur port.
  for (const [cle, n] of switchsDeduits) {
    const swMac = cle.split(":")[0];
    const amont = (swMac !== "gw" && parMac.get(swMac.toUpperCase())) || gateway;
    links.push({ fromId: amont.id, toId: n.id, type: "ethernet" });
  }

  // ── Les deux faces d'une même machine ─────────────────────────────────────
  // Un même boîtier peut apparaître deux fois, par sa carte filaire et par sa
  // carte sans fil. On ne le déclare que si les deux médias ont été *mesurés*
  // et diffèrent : sans mesure, deux adresses voisines ne prouvent rien.
  const seen = new Set<string>();
  for (const a of all) {
    for (const b of all) {
      if (a.id >= b.id) continue;
      const va = vue(a), vb = vue(b);
      if (!va.medium || !vb.medium || va.medium === vb.medium) continue;
      if (category(a.ip) === category(b.ip)) continue;
      if (lastOctet(a.ip) !== lastOctet(b.ip)) continue;
      const key = [a.id, b.id].sort().join("|");
      if (seen.has(key)) continue;
      seen.add(key);
      links.push({ fromId: a.id, toId: b.id, type: "sibling" });
    }
  }

  let created = 0;
  for (const l of links) {
    const ok = await prisma.topologyLink
      .create({ data: { ...l, manual: false } })
      .then(() => true)
      .catch(() => false);
    if (ok) created++;
  }

  await logEvent(
    "info", "topology",
    `Topologie : ${created} liens · racine ${gateway.hostname || gateway.ip} · ` +
    `${switches.length} commutateur(s), ${aps.length} borne(s) · ` +
    `${presumes} rattachement(s) présumé(s) sur ${created}`,
  );
  eventBus.emit("topology:updated");
  return { created, deleted: before.count };
}


// Best-effort: read ARP table from main router via SSH if vendor known
export async function fetchArpTableViaSsh(routerId: string): Promise<{ ip: string; mac: string }[]> {
  const r = await prisma.sshDevice.findUnique({ where: { id: routerId } });
  if (!r) return [];
  const { executeOnDevice } = await import("./ssh");
  const v = r.vendor.toLowerCase();
  let cmd = "";
  if (v === "mikrotik") cmd = "/ip arp print without-paging";
  else if (v === "openwrt") cmd = "ip neigh";
  else if (v === "pfsense") cmd = "arp -a";
  else if (v === "cisco") cmd = "show arp";
  else cmd = "ip neigh";
  try {
    const r2 = await executeOnDevice(routerId, cmd);
    const out = r2.stdout;
    const list: { ip: string; mac: string }[] = [];
    const re = /(\d{1,3}(?:\.\d{1,3}){3}).*?([0-9a-fA-F]{2}(?::[0-9a-fA-F]{2}){5})/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(out)) !== null) list.push({ ip: m[1], mac: m[2].toUpperCase() });
    return list;
  } catch { return []; }
}
