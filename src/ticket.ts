// Emitting alerts as structured tickets.
//
// A human-readable alert and a machine-actionable ticket don't ask for the same
// thing. The sentence "unknown-c8f2 appeared on the network" reads well but
// forces the recipient to interpret it: extract the host, guess the severity,
// decide whether it's a duplicate. The structured format delivers those
// elements separately, and the ticketing system just has to file them away.
//
// The schema follows the "ticket/v1" specification: only the title is required,
// everything else carries a default value. Two transports carry it — email,
// where the JSON travels in the body, and a direct HTTP call. Ticket
// construction is shared between the two: only the sending differs.

import { createHash } from "crypto";

// ── Vocabulary ──────────────────────────────────────────────────────────────
export type Urgence = "p1" | "p2" | "p3" | "p4";
export type Impact = "bloquant" | "degrade" | "mineur";
export type Portee = "site" | "service" | "groupe" | "utilisateur";
export type TypeTicket = "incident" | "demande" | "maintenance" | "projet" | "info";

/**
 * Criticality matrix.
 *
 * Urgency isn't a judgment but a consequence: what is blocking at site scale
 * takes precedence over what is degraded for a single user. Deriving it keeps
 * an automated emitter from arbitrarily declaring itself top priority.
 */
const MATRICE: Record<Impact, Record<Portee, Urgence>> = {
  bloquant: { site: "p1", service: "p1", groupe: "p2", utilisateur: "p3" },
  degrade:  { site: "p2", service: "p2", groupe: "p3", utilisateur: "p3" },
  mineur:   { site: "p3", service: "p3", groupe: "p4", utilisateur: "p4" },
};

export function urgenceDe(impact: Impact, portee: Portee): Urgence {
  return MATRICE[impact][portee];
}

// ── The events MapMyLAN knows how to produce ────────────────────────────────
export type Evenement =
  | "hote_inconnu"        // a never-before-seen device responds
  | "port_ouvert"         // a port has opened on a known host
  | "risque_eleve"        // the risk score exceeds the threshold
  | "isolement"           // a rule has isolated a device
  | "vulnerabilite"       // a known flaw matches an exposed service
  | "equipement_injoignable"  // the gateway no longer responds
  | "balayage_echec"      // the scan did not complete
  | "resume";             // periodic summary

interface Profil {
  type: TypeTicket;
  impact: Impact;
  portee: Portee;
  titre: (c: Contexte) => string;
}

/**
 * Each event carries its own intrinsic severity.
 *
 * An unreachable gateway cuts everyone off: blocking at site scale. A port
 * opening on a machine concerns that machine: minor, user scope. This table is
 * what avoids having to decide case by case at emission time.
 */
const PROFILS: Record<Evenement, Profil> = {
  hote_inconnu: {
    type: "incident", impact: "mineur", portee: "utilisateur",
    titre: c => `Unknown device on the network — ${c.hote || c.ip}`,
  },
  port_ouvert: {
    type: "incident", impact: "mineur", portee: "utilisateur",
    titre: c => `New open port on ${c.hote || c.ip}`,
  },
  risque_eleve: {
    type: "incident", impact: "degrade", portee: "groupe",
    titre: c => `High risk — ${c.hote || c.ip}`,
  },
  isolement: {
    type: "incident", impact: "degrade", portee: "utilisateur",
    titre: c => `Device isolated — ${c.hote || c.ip}`,
  },
  vulnerabilite: {
    type: "incident", impact: "degrade", portee: "service",
    titre: c => `Exposed vulnerability on ${c.hote || c.ip}`,
  },
  equipement_injoignable: {
    type: "incident", impact: "bloquant", portee: "site",
    titre: () => "Network device unreachable",
  },
  balayage_echec: {
    type: "incident", impact: "degrade", portee: "service",
    titre: () => "Network scan failed",
  },
  resume: {
    type: "info", impact: "mineur", portee: "site",
    titre: c => `Summary — ${c.hotes ?? 0} hosts, ${c.alertes ?? 0} alerts`,
  },
};

// ── Context provided by the caller ──────────────────────────────────────────
export interface Contexte {
  hote?: string;
  ip?: string;
  mac?: string;
  vlan?: number | null;
  fabricant?: string;
  ports?: number[];
  risque?: number;
  cve?: string;
  service?: string;
  description?: string;
  symptomes?: string[];
  attendu?: string;
  constate?: string;
  actionsFaites?: string[];
  logs?: string;
  hotes?: number;
  alertes?: number;
  /** Forces the urgency. To be used only if the matrix is plainly wrong. */
  urgence?: Urgence;
}

export interface Ticket {
  /** Version marker. Its name is set by the router according to the
   *  destination ticketing system, which uses it to recognize its format. */
  ticket: 1;
  type: TypeTicket;
  titre: string;
  urgence: Urgence;
  impact: Impact;
  portee: Portee;
  service: string;
  composant: string;
  zone: { site: string; vlan: number | null; host: string; ip: string; url: string };
  description: string;
  symptomes: string[];
  attendu: string;
  constate: string;
  actions_faites: string[];
  logs: string;
  detecte_le: string;
  projet: string;
  labels: string[];
  metriques: { label: string; valeur: string; seuil?: string; etat: "ok" | "warn" | "ko" }[];
  liens: { label: string; url: string }[];
  dedup_key: string;
  source: { systeme: string; ref: string };
}

// Sanitizes a string destined for a ticket or an email.
//
// `titre` and the like are built from hostnames announced on the network. These
// values end up in the email subject (see preparerCourriel) and in headers: a
// `\r\n` slipped into a hostname would inject an extra `Bcc:` header. So we
// strip control characters and invisible marks before any truncation.
const S = (v: unknown, max = 512) =>
  typeof v === "string"
    ? v
        // Control characters (including CR/LF/TAB): header-injection vector.
        .replace(/[\u0000-\u001f\u007f]/g, " ")
        // Invisible spaces and bidirectional marks (name spoofing).
        .replace(/[\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/g, "")
        .trim()
        .slice(0, max)
    : "";

/**
 * Grouping key.
 *
 * The same incident recurring must not produce a hundred tickets. The key
 * combines the nature of the event and its subject — not the timestamp, since
 * otherwise every occurrence would be unique and grouping would be pointless.
 */
export function cleRegroupement(ev: Evenement, c: Contexte): string {
  const sujet = c.mac || c.ip || c.hote || "global";
  const detail = ev === "port_ouvert" ? (c.ports || []).sort((a, b) => a - b).join("-")
               : ev === "vulnerabilite" ? (c.cve || "")
               : "";
  const brut = [ev, sujet, detail].filter(Boolean).join(":");
  // A short digest keeps the key readable while bounding its size.
  return brut.length <= 128 ? brut
       : ev + ":" + createHash("sha256").update(brut).digest("hex").slice(0, 24);
}

export interface Reglages {
  /** Site name, as it will appear in the ticket's zone. */
  site?: string;
  /** Project the tickets should be attached to. */
  projet?: string;
  /** Name of the emitting system. */
  systeme?: string;
  /** Address of the interface, for building the links. */
  baseUrl?: string;
}

/** Builds the ticket. Shared by both transports. */
export function construireTicket(
  ev: Evenement,
  c: Contexte,
  r: Reglages = {},
): Ticket {
  const p = PROFILS[ev];
  // The urgency override serves only to correct the matrix downward. Letting it
  // raise the level would let any emitter (or a context influenced by network
  // data) declare itself P1 and bypass the alerting thresholds. So we keep the
  // override only if it is less urgent than the computed value (higher numeric
  // rank = less urgent).
  const calc = urgenceDe(p.impact, p.portee);
  const RANG: Record<Urgence, number> = { p1: 1, p2: 2, p3: 3, p4: 4 };
  const urgence: Urgence = c.urgence && RANG[c.urgence] >= RANG[calc] ? c.urgence : calc;

  const metriques: Ticket["metriques"] = [];
  if (typeof c.risque === "number") {
    metriques.push({
      label: "Risk", valeur: String(c.risque), seuil: "70",
      etat: c.risque >= 70 ? "ko" : c.risque >= 40 ? "warn" : "ok",
    });
  }
  if (c.ports && c.ports.length) {
    metriques.push({ label: "Open ports", valeur: String(c.ports.length), etat: "warn" });
  }

  const liens: Ticket["liens"] = [];
  if (r.baseUrl && c.ip) {
    liens.push({ label: "Device details", url: `${r.baseUrl.replace(/\/+$/, "")}/devices?ip=${encodeURIComponent(c.ip)}` });
  }

  return {
    ticket: 1,
    type: p.type,
    titre: S(p.titre(c), 200) || "Network alert",
    urgence, impact: p.impact, portee: p.portee,
    service: S(c.service || "network", 64),
    composant: S(c.fabricant, 64),
    zone: {
      site: S(r.site, 64),
      vlan: Number.isInteger(c.vlan as number) ? (c.vlan as number) : null,
      host: S(c.hote, 64),
      ip: S(c.ip, 45),
      url: "",
    },
    description: S(c.description, 20000),
    symptomes: (c.symptomes || []).map(x => S(x)).filter(Boolean).slice(0, 20),
    attendu: S(c.attendu, 1000),
    constate: S(c.constate, 1000),
    actions_faites: (c.actionsFaites || []).map(x => S(x)).filter(Boolean).slice(0, 20),
    logs: S(c.logs, 8000),
    detecte_le: new Date().toISOString(),
    projet: S(r.projet, 64),
    labels: ["network", ev.replace(/_/g, "-")],
    metriques,
    liens,
    dedup_key: cleRegroupement(ev, c),
    source: { systeme: S(r.systeme || "mapmylan", 48), ref: "" },
  };
}

// ── Transports ──────────────────────────────────────────────────────────────
export interface Destination {
  /** Ticketing API address. Empty = email transport. */
  url?: string;
  /** Access key, sent in the agreed-upon header. */
  cle?: string;
  /** Name of the header carrying the key. Configurable per ticketing system. */
  entete?: string;
}

export interface Resultat {
  ok: boolean;
  id?: number;
  ref?: string;
  regroupe?: boolean;
  erreur?: string;
}

/**
 * Sends the ticket to the API.
 *
 * Errors are distinguished rather than reduced to a single failure: a rejected
 * key, an exceeded quota, and a server outage call for three different
 * reactions.
 */
// Checks that a ticketing API address is safe to contact.
//
// The URL and the key are set in the settings: without a check, they turn the
// backend into an SSRF relay (`http://169.254.169.254/…`, internal services)
// that, on top of it, hands the key over in the clear on plain HTTP. We require
// HTTPS, except toward a plainly private/local host, and we reject credentials
// in the URL.
function estHotePrive(h: string): boolean {
  const host = h.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) return true;
  if (!host.includes(".")) return true; // Docker service name (no dot)
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  // Private ranges and loopback only. 169.254.0.0/16 (link-local) is EXCLUDED
  // on purpose: that's where the hosting provider's metadata service lives
  // (169.254.169.254), a classic SSRF target.
  return a === 10 || a === 127 || (a === 192 && b === 168) ||
         (a === 172 && b >= 16 && b <= 31);
}

function urlBilletterieSure(url: string): URL {
  const u = new URL(url); // throws if invalid
  if (u.username || u.password) throw new Error("API address: credentials in the URL are not allowed.");
  if (u.protocol === "https:") return u;
  if (u.protocol === "http:" && estHotePrive(u.hostname)) return u;
  throw new Error("API address: HTTPS required (HTTP tolerated only toward an internal host).");
}

export async function envoyerApi(t: Ticket, d: Destination): Promise<Resultat> {
  if (!d.url) return { ok: false, erreur: "No API address configured." };
  const entete = d.entete || "X-Ticket-Key";

  let cible: URL;
  try {
    cible = urlBilletterieSure(d.url);
  } catch (e: any) {
    return { ok: false, erreur: e?.message || "API address rejected." };
  }

  try {
    const rep = await fetch(cible.toString(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        [entete]: d.cle || "",
        // Replaying the same request must not create two tickets.
        "Idempotency-Key": createHash("sha256")
          .update(t.dedup_key + "|" + t.detecte_le.slice(0, 16))
          .digest("hex").slice(0, 32),
      },
      body: JSON.stringify(t),
      signal: AbortSignal.timeout(10_000),
    });

    const corps = await rep.json().catch(() => ({}));

    if (rep.status === 401) return { ok: false, erreur: "Key rejected by the ticketing system." };
    if (rep.status === 429) {
      const attente = rep.headers.get("Retry-After");
      return { ok: false, erreur: `Quota exceeded${attente ? `, retry in ${attente} s` : ""}.` };
    }
    if (rep.status === 400) {
      return { ok: false, erreur: `Ticket rejected: ${corps?.detail || corps?.erreur || "invalid format"}.` };
    }
    if (!rep.ok) return { ok: false, erreur: `The ticketing system responded ${rep.status}.` };

    return {
      ok: true,
      id: corps?.id,
      ref: corps?.ref,
      // Status 200 signals a grouping, 201 a creation.
      regroupe: rep.status === 200 || corps?.dedup === true,
    };
  } catch (e: any) {
    const nom = e?.name === "TimeoutError" ? "timed out" : (e?.message || "failure");
    return { ok: false, erreur: `Could not reach: ${nom}.` };
  }
}

/**
 * Prepares the equivalent email.
 *
 * The JSON travels in the body, preceded by nothing: the specification provides
 * that a body starting with a brace be recognized as structured. The subject
 * stays readable for a human who opens the message.
 */
export function preparerCourriel(t: Ticket): { objet: string; corps: string; entetes: Record<string, string> } {
  return {
    objet: `[${t.urgence.toUpperCase()}] ${t.titre}`,
    corps: JSON.stringify(t, null, 2),
    entetes: { "X-Ticket-Format": "json" },
  };
}

/** Human-readable rendering, for recipients who don't expect any structure. */
export function rendreLisible(t: Ticket): string {
  const l: string[] = [t.titre];
  if (t.description) l.push("", t.description);
  if (t.zone.host || t.zone.ip) {
    l.push("", `Device: ${[t.zone.host, t.zone.ip].filter(Boolean).join(" · ")}`);
  }
  if (t.metriques.length) {
    l.push("", ...t.metriques.map(m => `${m.label}: ${m.valeur}${m.seuil ? ` (threshold ${m.seuil})` : ""}`));
  }
  if (t.symptomes.length) l.push("", ...t.symptomes.map(s => `— ${s}`));
  return l.join("\n");
}
