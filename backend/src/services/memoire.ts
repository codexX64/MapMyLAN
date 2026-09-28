// Ce que MapMyLAN raconte à SYNAPSE, tout seul, au fil de l'eau.
//
//   - chaque alerte (nouvel appareil, port ouvert, CVE, intrusion…) ;
//   - chaque balayage dont le résultat change ;
//   - toutes les heures, un bilan du réseau, s'il a bougé.
//
// Les alertes sont lues dans la base toutes les 20 s, pas sur le bus
// d'événements : une alerte écrite par un autre processus (un import, un
// outil d'administration) part aussi. Les envois passent par une file :
// SYNAPSE absent ou lent, rien ne se perd tant que la file tient (500
// événements), et MapMyLAN ne ralentit jamais.

import { config } from "../config";
import { prisma } from "../db";
import { eventBus } from "../ws/realtime";

export interface Evenement {
  kind: string; title: string; body?: string; ref?: string; tags: string[];
  meta?: Record<string, unknown>; occurred_at?: string;
}

const FILE_MAX = 500, LOT = 50;
const etat = { envoyes: 0, echecs: 0, enAttente: 0, dernierEnvoi: null as string | null, erreur: null as string | null, perdus: 0 };
const file: Evenement[] = [];
let attente = 5_000, minuteur: ReturnType<typeof setTimeout> | null = null;

export const etatMemoire = () => ({ ...etat, enAttente: file.length, relie: pret() });
const pret = () => !!(config.assistant.synapseUrl && config.assistant.synapseJeton);

/** Met un événement en file. Au-delà de 500, les plus anciens tombent (comptés). */
export function raconter(e: Evenement): void {
  if (!pret()) return;
  file.push({ ...e, tags: [...new Set(["mapmylan", ...e.tags])], occurred_at: e.occurred_at || new Date().toISOString() });
  while (file.length > FILE_MAX) { file.shift(); etat.perdus++; }
  if (!minuteur) minuteur = setTimeout(vider, 2_000);
}

async function vider(): Promise<void> {
  minuteur = null;
  if (!file.length) return;
  const lot = file.slice(0, LOT);
  try {
    const r = await fetch(`${config.assistant.synapseUrl}/v1/ingest/batch`, {
      method: "POST", signal: AbortSignal.timeout(15_000),
      headers: { Authorization: `Bearer ${config.assistant.synapseJeton}`, "Content-Type": "application/json" },
      body: JSON.stringify({ events: lot }),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    file.splice(0, lot.length);
    etat.envoyes += lot.length; etat.dernierEnvoi = new Date().toISOString(); etat.erreur = null;
    attente = 5_000;
  } catch (e: any) {
    etat.echecs++; etat.erreur = String(e?.message || e).slice(0, 160);
    attente = Math.min(300_000, attente * 2);   // SYNAPSE absent : on réessaie de moins en moins souvent
  }
  if (file.length) minuteur = setTimeout(vider, file.length && !etat.erreur ? 500 : attente);
}

/* ───────────── traduire ce qui se passe ───────────── */

const GRAVITE: Record<string, string> = { critical: "critique", high: "élevée", medium: "moyenne", low: "faible", info: "info" };

/** Les étiquettes qu'une alerte demande de transmettre (metadata.etiquettes) : courtes, sûres, quatre au plus. */
export function etiquettesDe(meta: any): string[] {
  const l = Array.isArray(meta?.etiquettes) ? meta.etiquettes : [];
  return l.map((x: unknown) => String(x).toLowerCase()).filter((x: string) => /^[a-z0-9][a-z0-9-]{0,23}$/.test(x)).slice(0, 4);
}

/** Une alerte MapMyLAN devient un fait pour SYNAPSE. */
export function depuisAlerte(a: { id?: string; severity: string; source: string; message: string; deviceIp?: string | null; metadata?: any; createdAt?: Date | string }): Evenement {
  return {
    kind: /^(critical|high)$/.test(a.severity) ? "incident.network" : "network.alert",
    title: String(a.message).slice(0, 280),
    body: `Alerte MapMyLAN, gravité ${GRAVITE[a.severity] || a.severity}${a.deviceIp ? `, appareil ${a.deviceIp}` : ""}. Origine : ${a.source}.`,
    ref: a.id ? `alerte:${a.id}` : undefined,
    tags: ["alerte", a.severity, ...etiquettesDe(a.metadata)],
    meta: { severity: a.severity, source: a.source, deviceIp: a.deviceIp || null, evenement: a.metadata?.evenement || null },
    occurred_at: a.createdAt ? new Date(a.createdAt).toISOString() : undefined,
  };
}

let dernierBalayage: number | null = null;
let dernierBilan = "";

/* Le curseur des alertes : la date de la dernière lue, et les identifiants
   lus à cette date exacte (deux alertes peuvent tomber sur la même milliseconde). */
let curseur = new Date();
let auBord = new Set<string>();

/** Les alertes écrites depuis le dernier passage, dans l'ordre. Au démarrage, l'historique n'est pas rejoué. */
export async function lireAlertes(): Promise<number> {
  const l = await prisma.alert.findMany({ where: { createdAt: { gte: curseur } }, orderBy: { createdAt: "asc" }, take: 200 });
  let n = 0;
  for (const a of l) {
    if (auBord.has(a.id)) continue;
    raconter(depuisAlerte(a as any));
    n++;
    const t = new Date(a.createdAt);
    if (t.getTime() !== curseur.getTime()) { curseur = t; auBord = new Set(); }
    auBord.add(a.id);
  }
  return n;
}

/** Branche MapMyLAN sur SYNAPSE : alertes, balayages, bilan horaire. */
export function demarrerMemoire(bilan: () => Promise<{ titre: string; corps: string; empreinte: string }>): void {
  if (!pret()) return;
  let occupe = false;
  setInterval(async () => {
    if (occupe) return; occupe = true;
    try { await lireAlertes(); } catch { /* base indisponible : au prochain tour */ } finally { occupe = false; }
  }, 20_000).unref();
  eventBus.on("scan:complete", (s: any) => {
    // Un balayage qui trouve la même chose que le précédent n'apprend rien à personne.
    if (s?.hostsFound == null || s.hostsFound === dernierBalayage) return;
    const avant = dernierBalayage; dernierBalayage = s.hostsFound;
    raconter({
      kind: "network.scan", title: `Balayage du réseau : ${s.hostsFound} appareils trouvés${avant != null ? ` (${avant} au précédent)` : ""}`,
      tags: ["balayage"], meta: { hostsFound: s.hostsFound, avant, changed: true },
    });
  });
  const tourBilan = async () => {
    try {
      const b = await bilan();
      if (b.empreinte !== dernierBilan) {
        dernierBilan = b.empreinte;
        raconter({ kind: "network.snapshot", title: b.titre, body: b.corps, tags: ["bilan"], meta: { changed: true } });
      }
    } catch { /* base indisponible : au prochain tour */ }
  };
  setTimeout(tourBilan, 60_000).unref();
  setInterval(tourBilan, 3600_000).unref();
}
