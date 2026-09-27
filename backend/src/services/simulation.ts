// Le mode simulation : un réseau qui vit tout seul, pour la VM de test.
//
// Des appareils arrivent et repartent, s'éteignent et reviennent, ouvrent un
// port telnet, se découvrent une CVE ; des balayages passent ; parfois un
// appareil se met à balayer ses voisins. Chaque événement passe par les
// mêmes chemins que le vrai réseau (appareils, ports, alertes, scores), donc
// l'interface, l'assistant et SYNAPSE le voient comme le reste.
//
// Garde-fous :
//   - désactivé par défaut (SIMULATION=off) ; seul le Hub l'allume, par un
//     réglage de MapMyLAN, sur une machine de test ;
//   - il ne touche QUE ses propres appareils, étiquetés « simulation » :
//     un appareil réel n'est jamais modifié ;
//   - chaque alerte simulée a pour source « simulation », et tout ce qui part
//     vers SYNAPSE porte l'étiquette « simulation » (purgeable d'un coup).

import { prisma } from "../db";
import { config } from "../config";
import { createAlert, logEvent } from "./logger";
import { scoreDevice } from "./scoring";
import { eventBus } from "../ws/realtime";

export type Vitesse = "off" | "normal" | "rapide";

export function vitesse(brut = process.env.SIMULATION): Vitesse {
  const v = String(brut || "off").trim().toLowerCase();
  if (v === "rapide" || v === "fast") return "rapide";
  if (["normal", "on", "1", "true", "oui"].includes(v)) return "normal";
  return "off";
}

export const ETIQUETTE = "simulation";
const MAX_APPAREILS = 24;

/* ───────────── le catalogue des faux appareils ───────────── */

type Service = [number, string];
export interface Modele { type: string; vendeur: string; nom: string; os: string; ports: Service[]; risques: Service[]; cves: [string, number, string, string][] }

export const MODELES: Modele[] = [
  { type: "camera", vendeur: "Hikvision", nom: "camera", os: "Linux embarqué", ports: [[80, "http"], [554, "rtsp"]], risques: [[23, "telnet"], [8000, "hikvision-sdk"]],
    cves: [["CVE-2021-36260", 9.8, "critical", "Injection de commande dans le serveur web"], ["CVE-2017-7921", 10, "critical", "Contournement d'authentification"]] },
  { type: "nas", vendeur: "Synology", nom: "nas", os: "DSM 7", ports: [[5000, "http"], [5001, "https"]], risques: [[445, "microsoft-ds"], [21, "ftp"]],
    cves: [["CVE-2022-27624", 8.1, "high", "Dépassement de tampon dans le service réseau"]] },
  { type: "phone", vendeur: "Apple", nom: "iphone", os: "iOS", ports: [[62078, "iphone-sync"]], risques: [], cves: [] },
  { type: "tv", vendeur: "Samsung", nom: "tv-salon", os: "Tizen", ports: [[8001, "http"], [9197, "dial"]], risques: [[5555, "adb"]],
    cves: [["CVE-2023-39297", 6.5, "medium", "Accès non authentifié à l'API de contrôle"]] },
  { type: "pi", vendeur: "Raspberry Pi", nom: "raspberry", os: "Debian", ports: [[22, "ssh"]], risques: [[5900, "vnc"], [1883, "mqtt"]],
    cves: [["CVE-2023-38408", 9.8, "critical", "Exécution de code via l'agent SSH"]] },
  { type: "printer", vendeur: "Brother", nom: "imprimante-bureau", os: "Micrologiciel Brother", ports: [[80, "http"], [631, "ipp"], [9100, "jetdirect"]], risques: [[23, "telnet"]],
    cves: [["CVE-2024-51978", 9.8, "critical", "Mot de passe administrateur par défaut déductible du numéro de série"]] },
  { type: "iot", vendeur: "Philips", nom: "pont-hue", os: "Hue Bridge", ports: [[80, "http"], [443, "https"]], risques: [[1883, "mqtt"]], cves: [] },
  { type: "ap", vendeur: "Ubiquiti", nom: "borne-wifi", os: "UniFi", ports: [[22, "ssh"], [443, "https"]], risques: [[8080, "http-proxy"]],
    cves: [["CVE-2021-22909", 7.8, "high", "Élévation de privilèges au micrologiciel"]] },
  { type: "laptop", vendeur: "Dell", nom: "portable", os: "Windows 11", ports: [[135, "msrpc"]], risques: [[3389, "ms-wbt-server"], [445, "microsoft-ds"]],
    cves: [["CVE-2019-0708", 9.8, "critical", "BlueKeep : exécution de code via le bureau à distance"]] },
  { type: "iot", vendeur: "Espressif", nom: "esp32", os: "ESP-IDF", ports: [[80, "http"]], risques: [[23, "telnet"]], cves: [] },
  { type: "tv", vendeur: "Sonos", nom: "enceinte", os: "Sonos OS", ports: [[1400, "http"]], risques: [], cves: [] },
  { type: "iot", vendeur: "TP-Link", nom: "prise-connectee", os: "Kasa", ports: [[9999, "kasa"]], risques: [[80, "http"]],
    cves: [["CVE-2023-1389", 8.8, "high", "Injection de commande dans l'interface web"]] },
];

/* ───────────── le choix de l'événement ─────────────
   Une fonction pure : l'état du faux réseau et un tirage au sort entrent,
   un événement sort. C'est elle que les tests vérifient. */

export interface AppareilSimule { id: string; nom: string; ip: string; type: string; vendeur: string; etat: string; ports: number[]; cves: string[]; horsLigneDepuis?: number }
export type Evenement =
  | { type: "arrivee"; modele: Modele }
  | { type: "depart"; appareil: AppareilSimule }
  | { type: "retour"; appareil: AppareilSimule }
  | { type: "port_ouvert"; appareil: AppareilSimule; service: Service }
  | { type: "port_ferme"; appareil: AppareilSimule; port: number }
  | { type: "cve"; appareil: AppareilSimule; cve: [string, number, string, string] }
  | { type: "balayage" }
  | { type: "intrusion"; appareil: AppareilSimule }
  | { type: "retrait"; appareil: AppareilSimule };

const modeleDe = (a: AppareilSimule) => MODELES.find(m => m.vendeur === a.vendeur && m.type === a.type);

export function choisir(appareils: AppareilSimule[], rnd: () => number = Math.random): Evenement {
  const pick = <T>(l: T[]) => l[Math.floor(rnd() * l.length)];
  const enLigne = appareils.filter(a => a.etat === "online");
  const horsLigne = appareils.filter(a => a.etat === "offline");

  // Un réseau trop plein se vide : les absents de longue date s'en vont.
  const vieux = horsLigne.filter(a => a.horsLigneDepuis && Date.now() - a.horsLigneDepuis > 6 * 3600_000);
  if (appareils.length >= MAX_APPAREILS && vieux.length) return { type: "retrait", appareil: pick(vieux) };
  if (appareils.length < 4) return { type: "arrivee", modele: pick(MODELES) };

  const candidats: [number, () => Evenement | null][] = [
    [appareils.length < MAX_APPAREILS ? 14 : 0, () => ({ type: "arrivee", modele: pick(MODELES) })],
    [16, () => (enLigne.length > 2 ? { type: "depart", appareil: pick(enLigne) } : null)],
    [16, () => (horsLigne.length ? { type: "retour", appareil: pick(horsLigne) } : null)],
    [14, () => {
      const cibles = enLigne.map(a => ({ a, libres: (modeleDe(a)?.risques || []).filter(([p]) => !a.ports.includes(p)) })).filter(x => x.libres.length);
      if (!cibles.length) return null;
      const c = pick(cibles);
      return { type: "port_ouvert", appareil: c.a, service: pick(c.libres) };
    }],
    [10, () => {
      const cibles = enLigne.map(a => ({ a, ouverts: (modeleDe(a)?.risques || []).map(([p]) => p).filter(p => a.ports.includes(p)) })).filter(x => x.ouverts.length);
      if (!cibles.length) return null;
      const c = pick(cibles);
      return { type: "port_ferme", appareil: c.a, port: pick(c.ouverts) };
    }],
    [10, () => {
      const cibles = appareils.map(a => ({ a, cves: (modeleDe(a)?.cves || []).filter(([id]) => !a.cves.includes(id)) })).filter(x => x.cves.length);
      if (!cibles.length) return null;
      const c = pick(cibles);
      return { type: "cve", appareil: c.a, cve: pick(c.cves) };
    }],
    [14, () => ({ type: "balayage" })],
    [6, () => (enLigne.length ? { type: "intrusion", appareil: pick(enLigne) } : null)],
  ];
  for (let essai = 0; essai < 10; essai++) {
    const total = candidats.reduce((n, [p]) => n + p, 0);
    let t = rnd() * total;
    for (const [poids, f] of candidats) {
      if ((t -= poids) > 0) continue;
      const e = f();
      if (e) return e;
      break;
    }
  }
  return { type: "balayage" };
}

/** Le prochain délai : 1 à 5 min (10 à 40 s en rapide), trois fois plus lent la nuit. */
export function prochainDelai(v: Vitesse, heure = new Date().getHours(), rnd: () => number = Math.random): number {
  const [min, max] = v === "rapide" ? [10_000, 40_000] : [60_000, 300_000];
  const nuit = heure < 7 ? 3 : 1;
  return Math.round((min + rnd() * (max - min)) * nuit);
}

/* ───────────── appliquer un événement ───────────── */

function adresseLibre(prises: Set<string>, rnd: () => number): string {
  const base = (config.scan.subnet.split("/")[0] || "192.0.2.0").split(".").slice(0, 3).join(".");
  for (let i = 0; i < 200; i++) {
    const ip = `${base}.${100 + Math.floor(rnd() * 150)}`;
    if (!prises.has(ip)) return ip;
  }
  throw new Error("plus d'adresse libre pour un appareil simulé");
}
const macAleatoire = (rnd: () => number) => ["02", ...Array.from({ length: 5 }, () => Math.floor(rnd() * 256).toString(16).padStart(2, "0"))].join(":");

async function lireSimules(): Promise<AppareilSimule[]> {
  const l = await prisma.device.findMany({
    where: { tags: { has: ETIQUETTE } },
    select: { id: true, hostname: true, ip: true, type: true, vendor: true, status: true, metadata: true, ports: { select: { port: true } }, cves: { select: { cveId: true } } },
  });
  return l.map(d => ({
    id: d.id, nom: d.hostname || d.ip, ip: d.ip, type: d.type, vendeur: d.vendor || "", etat: d.status,
    ports: d.ports.map(p => p.port), cves: d.cves.map(c => c.cveId),
    horsLigneDepuis: (d.metadata as any)?.horsLigneDepuis,
  }));
}

const ALERTE = (appareil: AppareilSimule | null, extra: Record<string, unknown> = {}) =>
  ({ deviceId: appareil?.id, deviceIp: appareil?.ip, metadata: { simulation: true, ...extra } });

export async function appliquer(e: Evenement, rnd: () => number = Math.random): Promise<string> {
  switch (e.type) {
    case "arrivee": {
      const m = e.modele;
      const prises = new Set<string>((await prisma.device.findMany({ select: { ip: true } })).map((d: { ip: string }) => d.ip));
      const ip = adresseLibre(prises, rnd);
      const nom = `${m.nom}-${ip.split(".").pop()}`;
      const d = await prisma.device.create({
        data: {
          ip, mac: macAleatoire(rnd), hostname: nom, vendor: m.vendeur, os: m.os, type: m.type, status: "online", tags: [ETIQUETTE],
          notes: "Appareil simulé : le mode simulation de MapMyLAN l'a créé pour la VM de test.",
          ports: { create: m.ports.map(([port, service]) => ({ port, protocol: "tcp", state: "open", service })) },
        },
      });
      await createAlert("medium", "simulation", `Nouvel appareil : ${nom} (${ip}, ${m.vendeur})`, ALERTE({ id: d.id, ip } as AppareilSimule, { evenement: "arrivee" }));
      await scoreDevice(d.id).catch(() => {});
      return `arrivée de ${nom}`;
    }
    case "depart": {
      const a = e.appareil;
      await prisma.device.update({ where: { id: a.id }, data: { status: "offline", metadata: { horsLigneDepuis: Date.now() } } });
      if (["camera", "nas", "ap", "printer"].includes(a.type)) await createAlert("low", "simulation", `${a.nom} (${a.ip}) ne répond plus`, ALERTE(a, { evenement: "depart" }));
      return `${a.nom} hors ligne`;
    }
    case "retour": {
      const a = e.appareil;
      await prisma.device.update({ where: { id: a.id }, data: { status: "online", lastSeen: new Date(), metadata: {} } });
      return `${a.nom} de retour`;
    }
    case "port_ouvert": {
      const a = e.appareil, [port, service] = e.service;
      await prisma.port.upsert({
        where: { deviceId_port_protocol: { deviceId: a.id, port, protocol: "tcp" } },
        create: { deviceId: a.id, port, protocol: "tcp", state: "open", service }, update: { state: "open", service, detectedAt: new Date() },
      });
      const grave = [23, 445, 3389, 5900, 21].includes(port);
      await createAlert(grave ? "high" : "medium", "simulation", `Port ${port} (${service}) ouvert sur ${a.nom} (${a.ip})`, ALERTE(a, { evenement: "port_ouvert", port }));
      await scoreDevice(a.id).catch(() => {});
      return `port ${port} ouvert sur ${a.nom}`;
    }
    case "port_ferme": {
      const a = e.appareil;
      await prisma.port.deleteMany({ where: { deviceId: a.id, port: e.port } });
      await createAlert("info", "simulation", `Port ${e.port} refermé sur ${a.nom} (${a.ip})`, ALERTE(a, { evenement: "port_ferme", port: e.port }));
      await scoreDevice(a.id).catch(() => {});
      return `port ${e.port} fermé sur ${a.nom}`;
    }
    case "cve": {
      const a = e.appareil, [cveId, cvss, severity, description] = e.cve;
      await prisma.cveMatch.create({ data: { deviceId: a.id, cveId, cvss, severity, description } });
      await createAlert(severity === "critical" ? "critical" : "high", "simulation", `Vulnérabilité ${cveId} (CVSS ${cvss}) sur ${a.nom} : ${description}`, ALERTE(a, { evenement: "cve", cve: cveId }));
      await scoreDevice(a.id).catch(() => {});
      return `${cveId} sur ${a.nom}`;
    }
    case "balayage": {
      const enLigne = await prisma.device.count({ where: { status: "online" } });
      await prisma.scanRun.create({ data: { type: "simulation", subnet: config.scan.subnet, status: "done", hostsFound: enLigne, endedAt: new Date() } });
      eventBus.emit("scan:complete", { type: "simulation", hostsFound: enLigne, simulation: true });
      return `balayage : ${enLigne} appareils en ligne`;
    }
    case "intrusion": {
      const a = e.appareil;
      await prisma.device.update({ where: { id: a.id }, data: { status: "suspect" } });
      await createAlert("critical", "simulation", `${a.nom} (${a.ip}) balaye les ports de ses voisins`, ALERTE(a, { evenement: "intrusion" }));
      await scoreDevice(a.id).catch(() => {});
      return `${a.nom} suspect`;
    }
    case "retrait": {
      await prisma.device.delete({ where: { id: e.appareil.id } });
      return `${e.appareil.nom} retiré du réseau`;
    }
  }
}

/* ───────────── la boucle ───────────── */

const etat = { actif: false, vitesse: "off" as Vitesse, depuis: null as string | null, evenements: 0, dernier: null as string | null, erreur: null as string | null };
export const etatSimulation = () => ({ ...etat });

/** Mode éteint : les appareils et alertes simulés d'une session précédente
 *  s'en vont. Seul ce qui porte l'étiquette ou la source « simulation ». */
export async function nettoyerSimulation(): Promise<{ appareils: number; alertes: number }> {
  const a = await prisma.device.deleteMany({ where: { tags: { has: ETIQUETTE } } });
  const b = await prisma.alert.deleteMany({ where: { source: "simulation" } });
  if (a.count || b.count) logEvent("info", "simulation", `Mode simulation éteint : ${a.count} appareils et ${b.count} alertes simulés retirés.`).catch(() => {});
  return { appareils: a.count, alertes: b.count };
}

export function demarrerSimulation(): void {
  const v = vitesse();
  if (v === "off") { setTimeout(() => nettoyerSimulation().catch(() => {}), 10_000).unref(); return; }
  if (etat.actif) return;
  Object.assign(etat, { actif: true, vitesse: v, depuis: new Date().toISOString() });
  logEvent("warn", "simulation", `Mode simulation (${v}) : des appareils et des alertes FACTICES vont apparaître, étiquetés « simulation ».`).catch(() => {});
  const tour = async () => {
    try {
      const appareils = await lireSimules();
      // Au premier passage, un petit réseau d'un coup : sinon il faut une heure pour qu'il se passe quelque chose.
      const n = appareils.length < 6 ? 6 - appareils.length : 1;
      for (let i = 0; i < n; i++) {
        const e = n > 1 ? { type: "arrivee" as const, modele: MODELES[Math.floor(Math.random() * MODELES.length)] } : choisir(appareils);
        etat.dernier = await appliquer(e);
        etat.evenements++;
      }
      eventBus.emit("devices:updated", { simulation: true });
      eventBus.emit("topology:updated", { simulation: true });
      etat.erreur = null;
    } catch (err: any) {
      etat.erreur = String(err?.message || err).slice(0, 200);
    }
    setTimeout(tour, prochainDelai(v)).unref();
  };
  setTimeout(tour, 5_000).unref();
}
