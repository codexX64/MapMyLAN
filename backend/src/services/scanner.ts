// Multi-source network scanner.
// Combines: arp-scan + nmap (ping sweep + service detect + OS) + mDNS (avahi-browse)
// + NetBIOS (nmblookup) + SNMP (snmpget) for richest possible fingerprinting.
//
// Each host record is enriched as data flows in. Vendor lookup falls back to OUI table.

import { exec } from "child_process";
import { promisify } from "util";
import { prisma } from "../db";
import { config } from "../config";
import { adressesDePasserelle, purgerPasserelles } from "./vlanReleve";
import { logEvent } from "./logger";
import { eventBus } from "../ws/realtime";
import { lookupMacExtended } from "../lib/oui";

const execAsync = promisify(exec);

async function run(cmd: string, timeoutMs = 120_000): Promise<string> {
  try {
    // killSignal explicite : par defaut Node envoie SIGTERM, qu'arp-scan
    // ignore pendant un balayage. Le processus survivait au delai depasse et
    // continuait a consommer de la memoire indefiniment.
    const { stdout } = await execAsync(cmd, {
      timeout: timeoutMs,
      killSignal: "SIGKILL",
      maxBuffer: 32 * 1024 * 1024,
    });
    return stdout;
  } catch (err: any) {
    if (err?.killed || err?.signal === "SIGKILL") {
      const e: any = new Error(`delai depasse apres ${Math.round(timeoutMs / 1000)}s`);
      e.timedOut = true;
      throw e;
    }
    // some tools exit nonzero but print useful output
    if (err.stdout) return err.stdout;
    throw err;
  }
}

import { classify } from "./classify";

export interface ScannedHost {
  ip: string;
  mac?: string;
  hostname?: string;
  vendor?: string;
  os?: string;
  netbios?: string;
  mdnsName?: string;
  mdnsServices?: string[];
  ports: { port: number; protocol: string; state: string; service?: string; product?: string; version?: string }[];
  /** Autres MAC vues pour la même IP (machine multi-cartes, pont) — informatif. */
  altMacs?: string[];
}

// ─── Découverte couche 2 ─────────────────────────────────────────────────────
//
// arp-scan échouait systématiquement : sans interface explicite, --localnet ne
// sait pas laquelle choisir sur un hôte qui porte une douzaine de ponts Docker.
// On déduit donc l'interface qui possède réellement le sous-réseau visé, et on
// prévoit deux replis : la table de voisinage du noyau, puis la table ARP de
// l'équipement réseau lui-même, qui voit les appareils muets que nous ratons.

let cachedIface: string | null = null;

async function ifaceForSubnet(subnet: string): Promise<string | null> {
  if (config.scan.iface) return config.scan.iface;
  if (cachedIface) return cachedIface;
  try {
    const out = await run("ip -4 -o addr show", 8_000);
    for (const line of out.split("\n")) {
      const m = line.match(/^\d+:\s+(\S+)\s+inet\s+(\d{1,3}(?:\.\d{1,3}){3})/);
      if (m && ipInSubnet(m[2], subnet) && !/^(lo|docker|br-|veth)/.test(m[1])) {
        cachedIface = m[1];
        return cachedIface;
      }
    }
  } catch { /* on tentera sans interface */ }
  return null;
}

// Teste si une IP appartient au sous-réseau CIDR. Un filtre à trois octets
// (« 198.51.100. ») ratait tout /22 ou /19 qui débordait du troisième octet.
function ipInSubnet(ip: string, subnet: string): boolean {
  const [net, bitsStr] = subnet.split("/");
  const bits = Number(bitsStr) || 24;
  const toInt = (a: string) => a.split(".").reduce((acc, o) => (acc << 8) + (Number(o) & 255), 0) >>> 0;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (toInt(ip) & mask) === (toInt(net) & mask);
}

function parseArpScan(out: string): ScannedHost[] {
  // Une IP qui répond avec plusieurs MAC (lignes « DUP: n ») n'est PAS plusieurs
  // appareils : c'est une machine à plusieurs cartes, ou un pont qui renvoie
  // l'écho. On regroupe donc par IP et on ne garde qu'une entrée. La MAC
  // retenue est celle dont le fabricant est identifié en priorité — plus
  // parlante qu'une OUI inconnue — et à défaut la première vue.
  const byIp = new Map<string, { mac: string; vendor?: string; alt: string[] }>();

  for (const line of out.split("\n")) {
    const m = line.match(/^(\d{1,3}(?:\.\d{1,3}){3})\s+([0-9a-fA-F:]{17})(?:\s+(.+))?/);
    if (!m) continue;
    const ip = m[1];
    const mac = m[2].toUpperCase();
    // On retire l'étiquette « (DUP: n) » que arp-scan colle après le fabricant.
    const vendorRaw = (m[3] || "").replace(/\s*\(DUP:\s*\d+\)\s*$/i, "").trim();
    const vendor = vendorRaw && !/^\(unknown\)$/i.test(vendorRaw) ? vendorRaw : undefined;

    const cur = byIp.get(ip);
    if (!cur) {
      byIp.set(ip, { mac, vendor, alt: [] });
    } else {
      cur.alt.push(mac);
      // On remplace la MAC retenue seulement si la nouvelle a un fabricant
      // connu là où l'actuelle n'en avait pas.
      if (vendor && !cur.vendor) { cur.mac = mac; cur.vendor = vendor; }
    }
  }

  return [...byIp.entries()].map(([ip, e]) => ({
    ip, mac: e.mac, vendor: e.vendor, ports: [],
    // Les autres MAC de la même IP sont conservées pour information : ce sont
    // des cartes secondaires du même appareil, pas des machines à part.
    altMacs: e.alt.length ? [...new Set(e.alt)] : undefined,
  }));
}

// Table de voisinage du noyau : ne provoque pas de découverte mais restitue
// tout ce que l'hôte a appris récemment.
async function neighbourTable(subnet: string): Promise<ScannedHost[]> {
  try {
    const out = await run("ip neigh show", 8_000);
    return out.split("\n").map(l => {
      const m = l.match(/^(\d{1,3}(?:\.\d{1,3}){3})\s+.*lladdr\s+([0-9a-fA-F:]{17})/);
      if (!m || !ipInSubnet(m[1], subnet)) return null;
      if (/FAILED|INCOMPLETE/.test(l)) return null;
      return { ip: m[1], mac: m[2].toUpperCase(), ports: [] } as ScannedHost;
    }).filter(Boolean) as ScannedHost[];
  } catch { return []; }
}

// Dernier recours : demander à l'équipement réseau ce qu'il voit.
async function routerArpTable(): Promise<ScannedHost[]> {
  try {
    const { mainRouter } = await import("../adapters");
    const { adapter, ctx } = await mainRouter();
    if (!adapter.arp) return [];
    const entries = await adapter.arp(ctx);
    return entries.filter(e => e.ip && e.mac).map(e => ({
      ip: e.ip!, mac: e.mac!.toUpperCase(), vendor: e.vendor, ports: [],
    }));
  } catch { return []; }
}


// L'équipement réseau connu est une source de découverte à part entière, au
// même titre que le balayage : il connaît des appareils que le scan ne verra
// jamais — endormis, filtrants, ou sur un segment qu'on ne balaie pas — et il
// est le seul à savoir sur quel port physique et derrière quelle borne chacun
// se trouve. On l'interroge donc en parallèle du scan, pas en dernier recours.
export interface TopologieVue {
  swPort?: number;
  swMac?: string;
  apMac?: string;
  essid?: string;
  radio?: string;
  rssi?: number;
  medium?: "wired" | "wireless";
  blocked?: boolean;
  // ── Équipements d'infrastructure rapportés par le contrôleur ──
  /** Rôle déclaré par le constructeur : router, switch ou ap. */
  infraKind?: "router" | "switch" | "ap";
  /** MAC de l'équipement amont, telle que le contrôleur la rapporte. */
  uplinkMac?: string;
  uplinkPort?: number;
  uplinkMedium?: "wired" | "wireless";
  /** Vrai pour un équipement du constructeur, pas un client. */
  infra?: boolean;
  /** Vrai pour la box de l'opérateur, vue depuis le WAN de la passerelle. */
  operateur?: boolean;
  /** MAC de la passerelle dont cette adresse est une interface de VLAN. */
  passerelleDe?: string;
  vlanDeclare?: number;
  nomReseau?: string;
  /** Adresse WAN d'une passerelle — informative, jamais son adresse LAN. */
  wanIp?: string;
  modele?: string;
}

async function equipementClients(): Promise<{ hotes: ScannedHost[]; vues: Map<string, TopologieVue>; infra: number }> {
  const vues = new Map<string, TopologieVue>();
  let infra = 0;
  try {
    const { mainRouter } = await import("../adapters");
    const { adapter, ctx } = await mainRouter();
    if (!adapter.clients) return { hotes: [], vues, infra };

    const clients = await adapter.clients(ctx);
    const hotes: ScannedHost[] = [];

    // L'infrastructure du constructeur d'abord : la passerelle, les
    // commutateurs et les bornes ne sont pas des clients et n'apparaissent
    // nulle part ailleurs. Sans eux, la carte n'a pas de colonne vertébrale.
    if (adapter.infrastructure) {
      try {
        const equipements = await adapter.infrastructure(ctx);
        for (const e of equipements) {
          if (!e.ip) continue;
          hotes.push({
            ip: e.ip, mac: e.mac,
            hostname: e.name, vendor: "Ubiquiti", ports: [],
          });
          vues.set(e.ip, {
            infra: true, infraKind: e.kind, modele: e.model,
            uplinkMac: e.uplinkMac, uplinkPort: e.uplinkPort,
            uplinkMedium: e.uplinkMedium, wanIp: e.wanIp,
            medium: e.uplinkMedium,
          });
          infra++;
          // La box de l'opérateur est en amont de la passerelle. Le contrôleur
          // en donne l'adresse ; on la recense pour que la liaison montante
          // existe sur la carte au lieu de s'arrêter à la passerelle.
          const box = e.wanGateway;
          if (box && /^\d{1,3}(\.\d{1,3}){3}$/.test(box) && !vues.has(box)) {
            hotes.push({ ip: box, ports: [] });
            vues.set(box, { operateur: true, infraKind: "router", medium: "wired" });
          }
        }

        // Les adresses que la passerelle porte sur chaque VLAN.
        //
        // Elles étaient inscrites à l'inventaire comme des appareils à part
        // entière, rattachés à la passerelle. C'était déjà mieux que de les
        // laisser pendre au premier voisin venu, mais ça restait faux : ce ne
        // sont pas des machines, c'est le même boîtier vu depuis chaque
        // segment. Un routeur ne doit pas figurer quatre fois parce qu'il y a
        // quatre réseaux. On les lit — la carte a besoin de savoir que ces
        // adresses lui appartiennent — et on ne crée aucune fiche.
        if (adapter.networks) {
          const passerelle = equipements.find((e) => e.kind === "router");
          const reseaux = await adapter.networks(ctx).catch(() => []);
          for (const r of reseaux) {
            if (!r.passerelle) continue;
            const dejaLa = vues.get(r.passerelle);
            if (dejaLa?.infra) continue;          // c'est la fiche de l'équipement
            vues.set(r.passerelle, {
              ...(dejaLa || {}),
              passerelleDe: passerelle?.mac,
              vlanDeclare: r.vlan, nomReseau: r.nom,
              infraKind: "router", medium: "wired",
            });
          }
        }
      } catch {
        // Adaptateur muet sur ce point : on continue avec les seuls clients.
      }
    }

    for (const c of clients) {
      if (!c.ip) continue;
      const mac = c.mac ? c.mac.toUpperCase() : undefined;
      hotes.push({
        ip: c.ip, mac, hostname: c.hostname, vendor: c.vendor, ports: [],
      });
      vues.set(c.ip, {
        swPort: c.swPort, swMac: c.swMac ? c.swMac.toUpperCase() : undefined,
        apMac: c.apMac ? c.apMac.toUpperCase() : undefined,
        essid: c.essid, radio: c.radio, rssi: c.rssi,
        medium: c.medium, blocked: c.blocked,
      });
    }
    return { hotes, vues, infra };
  } catch {
    // Aucun équipement connecté, ou API muette : le scan se suffit à lui-même.
    return { hotes: [], vues, infra: 0 };
  }
}


// ── Plages balayées ─────────────────────────────────────────────────────────
// Un seul sous-réseau ne suffit pas dès que le réseau s'étale : le DHCP peut
// distribuer sur une plage, l'infrastructure vivre sur une autre, et un
// équipement resté sur son adressage d'usine sur une troisième. On tient donc
// une liste, balayée l'une après l'autre pour ménager le réseau.

export interface PlageScan {
  cidr: string;
  label?: string;
  enabled?: boolean;
}

/** Les plages configurées, ou à défaut le sous-réseau historique du .env. */
export async function plagesActives(): Promise<PlageScan[]> {
  try {
    const reglage = await prisma.setting.findUnique({ where: { key: "scan.ranges" } });
    const brut = reglage?.value as any;
    if (Array.isArray(brut) && brut.length) {
      const retenues = brut
        .filter((p: any) => p && typeof p.cidr === "string" && p.enabled !== false)
        .map((p: any) => ({ cidr: p.cidr.trim(), label: p.label, enabled: true }))
        .filter((p: PlageScan) => /^\d{1,3}(\.\d{1,3}){3}\/\d{1,2}$/.test(p.cidr));
      if (retenues.length) return retenues;
    }
  } catch { /* base indisponible : on retombe sur le .env */ }
  return [{ cidr: config.scan.subnet, label: "Par défaut", enabled: true }];
}

/** Nombre de bits du prefixe, 24 par defaut si la notation est absente. */
function prefixLength(subnet: string): number {
  const p = parseInt(subnet.split("/")[1] || "24", 10);
  return Number.isFinite(p) ? p : 24;
}

export async function arpScan(subnet: string = config.scan.subnet): Promise<ScannedHost[]> {
  // Au-dela d'un /22, un balayage ARP emet des dizaines de milliers de trames
  // et met des heures. Les tables de voisinage donnent le meme resultat utile
  // — tout ce qui a communique recemment — sans emettre un seul paquet.
  const prefix = prefixLength(subnet);
  if (prefix < 22) {
    await logEvent(
      "warn",
      "scanner",
      `${subnet} est trop large pour un balayage ARP (/${prefix}). ` +
        "Lecture des tables de voisinage a la place.",
    );
    const neigh = await neighbourTable(subnet);
    if (neigh.length) return neigh;
    return await routerArpTable();
  }

  const iface = await ifaceForSubnet(subnet);
  const attempts = [
    iface ? `arp-scan -I ${iface} -q ${subnet}` : null,
    `arp-scan -q ${subnet}`,
    `arp-scan -q --localnet`,
  ].filter(Boolean) as string[];

  for (const cmd of attempts) {
    try {
      const hosts = parseArpScan(await run(cmd, 60_000));
      if (hosts.length) {
        if (cmd !== attempts[0]) await logEvent("info", "scanner", `arp-scan via repli : ${cmd}`);
        return hosts;
      }
    } catch (e: any) {
      // Un depassement de delai signale une cible trop large, pas une commande
      // invalide : reessayer une autre variante ne ferait qu'empiler les
      // processus sur la meme plage impossible.
      if (e?.timedOut) break;
    }
  }

  const neigh = await neighbourTable(subnet);
  if (neigh.length) {
    await logEvent("info", "scanner", `arp-scan indisponible, ${neigh.length} voisins lus dans le noyau`);
    return neigh;
  }

  const fromRouter = await routerArpTable();
  if (fromRouter.length) {
    await logEvent("info", "scanner", `arp-scan indisponible, ${fromRouter.length} entrées lues sur le routeur`);
    return fromRouter;
  }

  await logEvent("warn", "scanner", "Aucune découverte couche 2 : ni arp-scan, ni voisinage noyau, ni routeur");
  return [];
}

// ─── nmap ping sweep ─────────────────────────────────────────────────────────
export async function nmapPingSweep(subnet: string = config.scan.subnet): Promise<ScannedHost[]> {
  // Meme borne que pour l'ARP : un /8 represente 16 millions d'hotes.
  if (prefixLength(subnet) < 22) {
    await logEvent("warn", "scanner", `${subnet} trop large pour un ping sweep, ignore.`);
    return [];
  }
  const cmd = `nmap -sn -n -PE -PA80,443 -PS22,80,443 -T4 --max-retries 1 ${subnet} -oG -`;
  try {
    const out = await run(cmd, 60_000);
    const hosts: ScannedHost[] = [];
    for (const line of out.split("\n")) {
      const m = line.match(/^Host:\s+(\S+)\s+\(([^)]*)\)\s+Status:\s+Up/);
      if (m) hosts.push({ ip: m[1], hostname: m[2] || undefined, ports: [] });
    }
    return hosts;
  } catch (err: any) {
    await logEvent("warn", "scanner", `nmap ping sweep failed: ${err.message}`);
    return [];
  }
}

// ─── nmap deep scan: ports, service, OS guess ────────────────────────────────
export async function nmapDeepScan(ip: string): Promise<ScannedHost> {
  const cmd = `nmap -F -sV -O --osscan-guess -T4 --max-retries 2 --host-timeout 60s -n ${ip}`;
  const out = await run(cmd, 90_000);
  const host: ScannedHost = { ip, ports: [] };

  const macMatch = out.match(/MAC Address:\s+([0-9A-F:]{17})\s*(?:\((.+?)\))?/i);
  if (macMatch) {
    host.mac = macMatch[1].toUpperCase();
    if (macMatch[2]) host.vendor = macMatch[2];
  }
  const osMatch = out.match(/OS details:\s+(.+)/);
  const runningMatch = out.match(/Running:\s+(.+)/);
  if (osMatch) host.os = osMatch[1].trim();
  else if (runningMatch) host.os = runningMatch[1].trim();

  const portRe = /^(\d+)\/(tcp|udp)\s+(\w+)\s+(\S+)(?:\s+(.+))?/gm;
  let pm: RegExpExecArray | null;
  while ((pm = portRe.exec(out)) !== null) {
    if (!pm[3].startsWith("open")) continue;
    const versionStr = (pm[5] || "").trim();
    const versionParts = versionStr.match(/^(\S+)\s*(.*)$/);
    host.ports.push({
      port: parseInt(pm[1]), protocol: pm[2], state: pm[3],
      service: pm[4],
      product: versionParts?.[1],
      version: versionParts?.[2],
    });
  }
  return host;
}

// ─── mDNS (Avahi) — discover Apple, IoT, printers ───────────────────────────
export async function mdnsBrowse(): Promise<Record<string, { name?: string; services: string[] }>> {
  try {
    // -p parsable, -t terminate, -r resolve
    const out = await run(`avahi-browse -p -t -r -a 2>/dev/null || true`, 15_000);
    const map: Record<string, { name?: string; services: string[] }> = {};
    for (const line of out.split("\n")) {
      // Format: =;eth0;IPv4;<service>;<type>;<domain>;<host>;<addr>;<port>;<txt>
      if (!line.startsWith("=;")) continue;
      const parts = line.split(";");
      const service = parts[3], host = parts[6], addr = parts[7];
      if (!addr) continue;
      if (!map[addr]) map[addr] = { name: host?.replace(/\.local$/, ""), services: [] };
      if (service) map[addr].services.push(service);
    }
    return map;
  } catch { return {}; }
}

// ─── NetBIOS — Windows machine names ────────────────────────────────────────
export async function netbiosLookup(ip: string): Promise<string | null> {
  try {
    const out = await run(`nmblookup -A ${ip} 2>/dev/null || true`, 6_000);
    // Look for the NetBIOS name (00) <ACTIVE>
    const m = out.match(/(\S+)\s+<00>\s+-\s+\S?\s*<ACTIVE>/);
    return m ? m[1].trim() : null;
  } catch { return null; }
}

// ─── SNMP sysDescr ──────────────────────────────────────────────────────────
export async function snmpProbe(ip: string, community = "public"): Promise<{ sysDescr?: string; sysName?: string }> {
  try {
    const out = await run(`snmpget -v 2c -c ${community} -t 2 -r 0 ${ip} 1.3.6.1.2.1.1.1.0 1.3.6.1.2.1.1.5.0 2>/dev/null || true`, 5_000);
    const sysDescr = out.match(/SNMPv2-MIB::sysDescr\.0 = STRING:\s+(.+)/)?.[1]?.trim();
    const sysName = out.match(/SNMPv2-MIB::sysName\.0 = STRING:\s+(.+)/)?.[1]?.trim();
    return { sysDescr, sysName };
  } catch { return {}; }
}

// ─── Heuristic device-type classifier ───────────────────────────────────────

// Adresse de la passerelle par défaut du système. Sert à reconnaître le
// routeur même quand aucun appareil n'a encore été marqué comme tel en base.
let cachedGateway: string | null | undefined;
async function defaultGateway(): Promise<string | null> {
  if (cachedGateway !== undefined) return cachedGateway;
  try {
    const out = await run("ip route show default", 5_000);
    const m = out.match(/default\s+via\s+(\d{1,3}(?:\.\d{1,3}){3})/);
    cachedGateway = m ? m[1] : null;
  } catch { cachedGateway = null; }
  return cachedGateway;
}

function classifyType(h: ScannedHost, isGateway = false): { type: string; confidence: number; reasons: string[]; runnerUp?: string } {
  return classify({
    isGateway,
    ip: h.ip,
    vendor: h.vendor, os: h.os, hostname: h.hostname,
    netbios: h.netbios, mdnsName: h.mdnsName, mdnsServices: h.mdnsServices,
    ports: h.ports.map(p => ({ port: p.port, service: p.service, product: p.product, version: p.version })),
  });
}

// ─── Merge: combine all sources into final host record ──────────────────────
function mergeHost(base: ScannedHost, deep?: ScannedHost, mdns?: { name?: string; services: string[] }, netbios?: string | null, snmp?: { sysDescr?: string; sysName?: string }): ScannedHost {
  const merged: ScannedHost = {
    ...base,
    ...(deep || {}),
    mac: deep?.mac || base.mac,
    vendor: deep?.vendor || base.vendor,
    hostname: deep?.hostname || base.hostname || mdns?.name || netbios || snmp?.sysName,
    os: deep?.os || base.os || snmp?.sysDescr,
    ports: deep?.ports || base.ports || [],
    mdnsName: mdns?.name,
    mdnsServices: mdns?.services,
    netbios: netbios || undefined,
  };

  // OUI lookup if vendor still unknown
  if ((!merged.vendor || /^unknown$/i.test(merged.vendor)) && merged.mac) {
    const ouiHit = lookupMacExtended(merged.mac);
    if (ouiHit) merged.vendor = ouiHit.vendor;
  }
  return merged;
}

// ─── Persist to DB ──────────────────────────────────────────────────────────
async function persistHost(h: ScannedHost, vue?: TopologieVue): Promise<string | null> {
  if (!h.mac && !h.ip) return null;

  // Match strategy: prefer MAC, but fall back to IP so that a host whose MAC
  // changed (USB-C adapter, failover, randomized MAC) updates the SAME device
  // instead of spawning a duplicate. One IP must map to one device.
  let existing = h.mac
    ? await prisma.device.findUnique({ where: { mac: h.mac } })
    : null;
  if (!existing && h.ip) {
    existing = await prisma.device.findFirst({ where: { ip: h.ip } });
  }

  // Un appareil est la passerelle s'il porte l'adresse de la route par défaut,
  // ou s'il a déjà été marqué comme routeur principal dans la base.
  const gw = await defaultGateway();
  const flagged = await prisma.device.findFirst({
    where: { ip: h.ip, isMainRouter: true }, select: { id: true },
  }).catch(() => null);
  const isGateway = (!!gw && gw === h.ip) || !!flagged;

  const cls = classifyType(h, isGateway);
  // Ce que le constructeur déclare l'emporte sur la reconnaissance par
  // empreinte : un contrôleur sait que sa boîte est un commutateur, la
  // reconnaissance ne fait que le supposer.
  const typeReel = vue?.infra || vue?.operateur || vue?.passerelleDe
    ? (vue.infraKind || cls.type)
    : cls.type;
  const data: any = {
    ip: h.ip,
    mac: h.mac,
    hostname: h.hostname,
    vendor: h.vendor,
    os: h.os,
    type: typeReel,
    status: "online" as const,
    lastSeen: new Date(),
    metadata: {
      mdnsName: h.mdnsName,
      mdnsServices: h.mdnsServices,
      netbios: h.netbios,
      // Ce que l'équipement réseau rapporte : port physique, borne, signal.
      // C'est la seule source de vérité sur le rattachement, et c'est ce qui
      // permet ensuite de déduire la présence d'un commutateur non géré.
      ...(vue ? {
        swPort: vue.swPort, swMac: vue.swMac, apMac: vue.apMac,
        essid: vue.essid, radio: vue.radio, rssi: vue.rssi,
        medium: vue.medium,
        // Équipements du constructeur : rôle et raccordement amont mesurés.
        infra: vue.infra, infraKind: vue.infraKind, modele: vue.modele,
        uplinkMac: vue.uplinkMac, uplinkPort: vue.uplinkPort,
        uplinkMedium: vue.uplinkMedium, operateur: vue.operateur,
        wanIp: vue.wanIp,
        passerelleDe: vue.passerelleDe, vlanDeclare: vue.vlanDeclare,
        nomReseau: vue.nomReseau,
      } : {}),
      typeConfidence: cls.confidence,
      typeReasons: cls.reasons,
      typeRunnerUp: cls.runnerUp,
    },
  };

  let device;
  if (existing) {
    // History entry on IP change
    if (existing.ip !== h.ip) {
      await prisma.deviceHistory.create({
        data: { deviceId: existing.id, event: "ip_change", data: { from: existing.ip, to: h.ip } },
      });
    }
    // History entry on MAC change (and only overwrite MAC if we actually have one)
    if (h.mac && existing.mac && existing.mac !== h.mac) {
      await prisma.deviceHistory.create({
        data: { deviceId: existing.id, event: "mac_change", data: { from: existing.mac, to: h.mac } },
      });
    }
    // Don't blank an existing MAC with null if this scan didn't resolve one
    if (!h.mac) data.mac = existing.mac;
    device = await prisma.device.update({ where: { id: existing.id }, data });
  } else if (h.mac) {
    device = await prisma.device.create({ data });
    await prisma.deviceHistory.create({
      data: { deviceId: device.id, event: "first_seen", data: { ip: h.ip, vendor: h.vendor || "Unknown" } },
    });
    eventBus.emit("alert:new", { newDevice: true, device });
    // Fire user notification commands (best-effort, non-blocking)
    const { fireCommand } = await import("./commands");
    fireCommand("device.new", {
      deviceId: device.id, ip: device.ip, mac: device.mac,
      vendor: device.vendor || "Unknown", hostname: device.hostname || "",
      type: device.type,
    }).catch(() => {});
    if (!device.vendor || device.vendor === "Unknown") {
      fireCommand("device.unknown_vendor", { deviceId: device.id, ip: device.ip, mac: device.mac }).catch(() => {});
    }
    if (device.type === "iot") {
      fireCommand("device.iot", { deviceId: device.id, ip: device.ip, name: device.hostname || device.ip, vendor: device.vendor }).catch(() => {});
    }
  } else {
    return null;
  }

  if (h.ports.length > 0) {
    await prisma.port.deleteMany({ where: { deviceId: device.id } });
    await prisma.port.createMany({
      data: h.ports.map((p) => ({
        deviceId: device.id, port: p.port, protocol: p.protocol, state: p.state,
        service: p.service, product: p.product, version: p.version,
      })),
    });
  }
  return device.id;
}

// ─── Master orchestration ───────────────────────────────────────────────────
/**
 * Balaie toutes les plages configurées, l'une après l'autre.
 *
 * Le séquentiel est délibéré : lancer plusieurs balayages ARP simultanés sature
 * la carte réseau et fausse les résultats. Une plage à la fois, c'est plus long
 * mais c'est fiable, et le réseau ne s'en aperçoit pas.
 */
export async function fullScanAll(): Promise<{ hostsFound: number; runId: string }> {
  const plages = await plagesActives();
  let total = 0;
  let dernierRun = "";

  for (const p of plages) {
    const r = await fullScan(p.cidr);
    total += r.hostsFound;
    dernierRun = r.runId;
  }

  if (plages.length > 1) {
    await logEvent("info", "scanner",
      `${plages.length} plages balayées · ${total} hôte(s) au total`);
  }
  return { hostsFound: total, runId: dernierRun };
}

export async function fullScan(subnet?: string): Promise<{ hostsFound: number; runId: string }> {
  const target = subnet || config.scan.subnet;
  const run = await prisma.scanRun.create({ data: { type: "full", subnet: target, status: "running" } });
  await logEvent("info", "scanner", `Full scan started on ${target}`);
  eventBus.emit("scan:started", { runId: run.id, subnet: target });

  try {
    // Phase 1 — découverte. Trois sources interrogées en parallèle et traitées
    // au même rang : le balayage ARP, le balayage ping, et l'équipement réseau
    // lui-même. Aucune n'est un simple recours : l'ARP voit ce qui a parlé
    // récemment, le ping ce qui répond, et l'équipement ce qu'il porte — y
    // compris les appareils muets que les deux autres ratent.
    const [arp, ping, mdnsMap, equipement] = await Promise.all([
      arpScan(target),
      nmapPingSweep(target),
      mdnsBrowse(),
      equipementClients(),
    ]);

    const byIp = new Map<string, ScannedHost>();
    const fusionner = (h: ScannedHost) => {
      const exist = byIp.get(h.ip);
      if (!exist) { byIp.set(h.ip, { ...h }); return; }
      // On complète sans écraser : chaque source apporte ce qu'elle sait.
      exist.mac = exist.mac || h.mac;
      exist.hostname = exist.hostname || h.hostname;
      exist.vendor = exist.vendor || h.vendor;
    };
    for (const h of arp) fusionner(h);
    for (const h of ping) fusionner(h);
    for (const h of equipement.hotes) fusionner(h);

    // La racine de la carte : la fiche que le contrôleur rapporte pour la
    // passerelle, avec sa MAC et son modèle. À défaut — contrôleur injoignable,
    // équipement d'une autre marque — on retombe sur la passerelle du système,
    // qui vaut mieux qu'une carte sans racine.
    const racine = [...equipement.vues.entries()]
      .find(([, v]) => v.infra && v.infraKind === "router")?.[0];
    const passerelle = await defaultGateway();
    if (!racine && passerelle && !byIp.has(passerelle)) {
      byIp.set(passerelle, { ip: passerelle, ports: [] });
    }

    // Les autres adresses de la passerelle ne sont pas des appareils. Le
    // balayage ARP les trouve forcément — elles répondent, elles sont sur le
    // fil — donc il ne suffit pas de ne plus les ajouter : il faut les écarter
    // de ce qui a été découvert, et effacer les fiches déjà créées.
    const garder = racine || passerelle || null;
    const passerelles = await adressesDePasserelle();
    if (garder) passerelles.delete(garder);
    if (passerelles.size) {
      for (const ip of passerelles) byIp.delete(ip);
      await purgerPasserelles(garder);
    }

    const hosts = Array.from(byIp.values());
    if (equipement.hotes.length) {
      await logEvent("info", "scanner",
        `Équipement réseau : ${equipement.hotes.length - equipement.infra} client(s) ` +
        `et ${equipement.infra} équipement(s) d'infrastructure rapporté(s)`);
    }

    eventBus.emit("scan:progress", { runId: run.id, phase: "discovery", hostsFound: hosts.length });

    // Phase 2: deep scan + NetBIOS + SNMP, in parallel batches
    const concurrency = 5;
    const enriched: ScannedHost[] = [];
    for (let i = 0; i < hosts.length; i += concurrency) {
      const batch = hosts.slice(i, i + concurrency);
      const results = await Promise.all(batch.map(async (h) => {
        const [deep, nb, snmp] = await Promise.all([
          nmapDeepScan(h.ip).catch(() => undefined),
          netbiosLookup(h.ip).catch(() => null),
          snmpProbe(h.ip).catch(() => ({})),
        ]);
        return mergeHost(h, deep, mdnsMap[h.ip], nb, snmp);
      }));
      enriched.push(...results);
      eventBus.emit("scan:progress", { runId: run.id, phase: "enriching", done: enriched.length, total: hosts.length });
    }

    // Persist
    const ids: string[] = [];
    for (const h of enriched) {
      const id = await persistHost(h, equipement.vues.get(h.ip));
      if (id) ids.push(id);
    }

    // Mark stale offline
    const cutoff = new Date(Date.now() - 10 * 60_000);
    await prisma.device.updateMany({
      where: { lastSeen: { lt: cutoff }, status: "online" },
      data: { status: "offline" },
    });

    await prisma.scanRun.update({
      where: { id: run.id },
      data: { status: "complete", hostsFound: enriched.length, endedAt: new Date() },
    });
    await logEvent("success", "scanner", `Full scan complete: ${enriched.length} hosts`);
    eventBus.emit("scan:complete", { runId: run.id, hostsFound: enriched.length });
    eventBus.emit("devices:updated");

    return { hostsFound: enriched.length, runId: run.id };
  } catch (err: any) {
    await prisma.scanRun.update({
      where: { id: run.id },
      data: { status: "failed", error: err.message, endedAt: new Date() },
    });
    await logEvent("error", "scanner", `Scan failed: ${err.message}`);
    throw err;
  }
}

export async function pingHost(ip: string): Promise<{ alive: boolean; latencyMs?: number }> {
  try {
    const out = await run(`ping -c 2 -W 1 ${ip}`, 5_000);
    const m = out.match(/min\/avg\/max\/(?:mdev|stddev)\s*=\s*[\d.]+\/([\d.]+)/);
    return { alive: true, latencyMs: m ? parseFloat(m[1]) : undefined };
  } catch { return { alive: false }; }
}
