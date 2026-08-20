// Alert routing.
//
// An alert goes out to the enabled channels, in the format each one demands.
// The readable format is the default: it's what someone opening their mail or
// glancing at their phone expects. The structured format only serves when a
// ticketing system is plugged in at the other end — without it, sending JSON to
// a human would be a regression.
//
// Nothing is mandatory. No channel enabled, no ticketing system configured: the
// alert is simply logged, and the application works.

import {
  construireTicket, preparerCourriel, rendreLisible, envoyerApi,
  type Evenement, type Contexte, type Reglages, type Ticket, type Resultat,
} from "./ticket";

export type Format = "lisible" | "structure";

export interface ConfigCanal {
  actif: boolean;
  /** Format expected by the recipient. Readable by default. */
  format?: Format;
}

export interface ConfigAlertes {
  courriel: ConfigCanal & { adresse?: string };
  bot: ConfigCanal & { jeton?: string; destinataire?: string };
  /**
   * Ticketing system. Optional: without it, alerts still go out through the
   * other channels, in their usual format.
   */
  billetterie?: {
    actif: boolean;
    url?: string;
    cle?: string;
    /** Name of the header carrying the key, per the ticketing system used. */
    entete?: string;
    /**
     * Name of the marker field at the head of the document. Ticketing systems
     * use it to recognize their own format; it differs from one to another.
     */
    marqueur?: string;
  };
  /** Urgency threshold below which we don't alert. p4 = everything passes. */
  seuil?: "p1" | "p2" | "p3" | "p4";
  reglages?: Reglages;
}

const RANG = { p1: 1, p2: 2, p3: 3, p4: 4 };

export interface Envoi {
  canal: "courriel" | "bot" | "billetterie";
  ok: boolean;
  format?: Format;
  detail?: string;
}

export interface Sortie {
  /** The built ticket, whatever format was ultimately sent. */
  ticket: Ticket;
  /** True if the urgency doesn't reach the threshold: nothing was sent. */
  ignoree: boolean;
  envois: Envoi[];
}

/** Sending functions provided by the caller: this module does not implement them. */
export interface Transports {
  courriel?: (o: { a: string; objet: string; corps: string; entetes: Record<string, string> }) => Promise<void>;
  bot?: (o: { destinataire: string; texte: string }) => Promise<void>;
  journal?: (niveau: "info" | "warn" | "error", message: string) => void;
}

/**
 * Emits an alert.
 *
 * The ticket is built once, then rendered in each channel's format. Building
 * two separate objects for the same alert would open the door to divergences —
 * one title here, another there.
 */
export async function alerter(
  ev: Evenement,
  ctx: Contexte,
  cfg: ConfigAlertes,
  tr: Transports = {},
): Promise<Sortie> {
  const t = construireTicket(ev, ctx, cfg.reglages || {});
  const envois: Envoi[] = [];

  // The threshold is compared on rank, not on the string: "p4" is not greater
  // than "p1" alphabetically.
  const seuil = cfg.seuil || "p4";
  if (RANG[t.urgence] > RANG[seuil]) {
    tr.journal?.("info", `Alert ${t.urgence} below threshold ${seuil}: ${t.titre}`);
    return { ticket: t, ignoree: true, envois };
  }

  // ── Ticketing system ───────────────────────────────────────────────────────
  // Queried first: its response carries a ticket reference, which we can then
  // cite in the messages meant for humans.
  let reference = "";
  const b = cfg.billetterie;
  if (b?.actif && b.url) {
    const doc = marquer(t, b.marqueur);
    const r: Resultat = await envoyerApi(doc, { url: b.url, cle: b.cle, entete: b.entete });
    envois.push({
      canal: "billetterie", ok: r.ok, format: "structure",
      detail: r.ok
        ? (r.regroupe ? `${r.ref} — additional occurrence` : r.ref)
        : r.erreur,
    });
    if (r.ok && r.ref) reference = r.ref;
    if (!r.ok) tr.journal?.("warn", `Ticketing system: ${r.erreur}`);
  }

  // ── Email ────────────────────────────────────────────────────────────────
  if (cfg.courriel?.actif && cfg.courriel.adresse && tr.courriel) {
    const structure = cfg.courriel.format === "structure";
    try {
      if (structure) {
        const m = preparerCourriel(marquer(t, b?.marqueur));
        await tr.courriel({ a: cfg.courriel.adresse, objet: m.objet, corps: m.corps, entetes: m.entetes });
      } else {
        await tr.courriel({
          a: cfg.courriel.adresse,
          objet: `[${t.urgence.toUpperCase()}] ${t.titre}`,
          corps: rendreLisible(t) + (reference ? `\n\nTicket ${reference}` : ""),
          entetes: {},
        });
      }
      envois.push({ canal: "courriel", ok: true, format: structure ? "structure" : "lisible" });
    } catch (e: any) {
      envois.push({ canal: "courriel", ok: false, detail: e?.message || "send failure" });
      tr.journal?.("warn", `Email: ${e?.message || "failure"}`);
    }
  }

  // ── Bot ──────────────────────────────────────────────────────────────────
  // Always readable: nobody reads JSON on their phone.
  if (cfg.bot?.actif && cfg.bot.destinataire && tr.bot) {
    try {
      await tr.bot({
        destinataire: cfg.bot.destinataire,
        texte: rendreLisible(t) + (reference ? `\n\nTicket ${reference}` : ""),
      });
      envois.push({ canal: "bot", ok: true, format: "lisible" });
    } catch (e: any) {
      envois.push({ canal: "bot", ok: false, detail: e?.message || "send failure" });
      tr.journal?.("warn", `Bot: ${e?.message || "failure"}`);
    }
  }

  if (!envois.length) {
    tr.journal?.("info", `No active channel — alert logged only: ${t.titre}`);
  }
  return { ticket: t, ignoree: false, envois };
}

/**
 * Sets the marker field expected by the ticketing system.
 *
 * The schema provides for one at the head of the document so the recipient
 * recognizes its format. Its name varies from one ticketing system to another,
 * hence this setting rather than a value hardcoded in the code.
 */
function marquer(t: Ticket, nom?: string): Ticket {
  const cle = (nom || "ticket").replace(/[^a-z0-9_]/gi, "").slice(0, 32) || "ticket";
  const { ticket, ...reste } = t as any;
  return { [cle]: 1, ...reste } as Ticket;
}

/** Default settings: nothing enabled, readable format everywhere. */
export function configParDefaut(): ConfigAlertes {
  return {
    courriel: { actif: false, format: "lisible" },
    bot: { actif: false, format: "lisible" },
    billetterie: { actif: false, marqueur: "ticket" },
    seuil: "p4",
  };
}
