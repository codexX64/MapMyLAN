// Aiguillage des alertes.
//
// Une alerte part vers les canaux activés, dans le format que chacun réclame.
// Le format lisible est celui par défaut : c'est ce qu'attend quelqu'un qui
// ouvre son courrier ou regarde son téléphone. Le format structuré ne sert que
// si une billetterie est branchée à l'autre bout — sans elle, envoyer du JSON
// à un humain serait une régression.
//
// Rien n'est obligatoire. Aucun canal activé, aucune billetterie configurée :
// l'alerte est simplement journalisée, et l'application fonctionne.

import {
  construireTicket, preparerCourriel, rendreLisible, envoyerApi,
  type Evenement, type Contexte, type Reglages, type Ticket, type Resultat,
} from "./ticket";

export type Format = "lisible" | "structure";

export interface ConfigCanal {
  actif: boolean;
  /** Format attendu par le destinataire. Lisible par défaut. */
  format?: Format;
}

export interface ConfigAlertes {
  courriel: ConfigCanal & { adresse?: string };
  bot: ConfigCanal & { jeton?: string; destinataire?: string };
  /**
   * Billetterie. Facultative : sans elle, les alertes partent quand même par
   * les autres canaux, dans leur format habituel.
   */
  billetterie?: {
    actif: boolean;
    url?: string;
    cle?: string;
    /** Nom de l'en-tête portant la clé, selon la billetterie employée. */
    entete?: string;
    /**
     * Nom du champ marqueur en tête du document. Les billetteries s'en servent
     * pour reconnaître leur propre format ; il diffère de l'une à l'autre.
     */
    marqueur?: string;
  };
  /** Seuil d'urgence en dessous duquel on n'alerte pas. p4 = tout passe. */
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
  /** Le ticket construit, quel que soit le format finalement expédié. */
  ticket: Ticket;
  /** Vrai si l'urgence n'atteint pas le seuil : rien n'a été envoyé. */
  ignoree: boolean;
  envois: Envoi[];
}

/** Fonctions d'envoi fournies par l'appelant : ce module ne les implémente pas. */
export interface Transports {
  courriel?: (o: { a: string; objet: string; corps: string; entetes: Record<string, string> }) => Promise<void>;
  bot?: (o: { destinataire: string; texte: string }) => Promise<void>;
  journal?: (niveau: "info" | "warn" | "error", message: string) => void;
}

/**
 * Émet une alerte.
 *
 * Le ticket est construit une seule fois puis rendu dans le format de chaque
 * canal. Construire deux objets distincts pour la même alerte ouvrirait la
 * porte à des divergences — un titre ici, un autre là.
 */
export async function alerter(
  ev: Evenement,
  ctx: Contexte,
  cfg: ConfigAlertes,
  tr: Transports = {},
): Promise<Sortie> {
  const t = construireTicket(ev, ctx, cfg.reglages || {});
  const envois: Envoi[] = [];

  // Le seuil se compare sur le rang, pas sur la chaîne : « p4 » n'est pas
  // supérieur à « p1 » alphabétiquement.
  const seuil = cfg.seuil || "p4";
  if (RANG[t.urgence] > RANG[seuil]) {
    tr.journal?.("info", `Alerte ${t.urgence} sous le seuil ${seuil} : ${t.titre}`);
    return { ticket: t, ignoree: true, envois };
  }

  // ── Billetterie ──────────────────────────────────────────────────────────
  // Interrogée en premier : sa réponse porte une référence de ticket, qu'on
  // peut alors citer dans les messages destinés aux humains.
  let reference = "";
  const b = cfg.billetterie;
  if (b?.actif && b.url) {
    const doc = marquer(t, b.marqueur);
    const r: Resultat = await envoyerApi(doc, { url: b.url, cle: b.cle, entete: b.entete });
    envois.push({
      canal: "billetterie", ok: r.ok, format: "structure",
      detail: r.ok
        ? (r.regroupe ? `${r.ref} — occurrence supplémentaire` : r.ref)
        : r.erreur,
    });
    if (r.ok && r.ref) reference = r.ref;
    if (!r.ok) tr.journal?.("warn", `Billetterie : ${r.erreur}`);
  }

  // ── Courriel ─────────────────────────────────────────────────────────────
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
      envois.push({ canal: "courriel", ok: false, detail: e?.message || "échec d'envoi" });
      tr.journal?.("warn", `Courriel : ${e?.message || "échec"}`);
    }
  }

  // ── Bot ──────────────────────────────────────────────────────────────────
  // Toujours lisible : personne ne lit du JSON sur son téléphone.
  if (cfg.bot?.actif && cfg.bot.destinataire && tr.bot) {
    try {
      await tr.bot({
        destinataire: cfg.bot.destinataire,
        texte: rendreLisible(t) + (reference ? `\n\nTicket ${reference}` : ""),
      });
      envois.push({ canal: "bot", ok: true, format: "lisible" });
    } catch (e: any) {
      envois.push({ canal: "bot", ok: false, detail: e?.message || "échec d'envoi" });
      tr.journal?.("warn", `Bot : ${e?.message || "échec"}`);
    }
  }

  if (!envois.length) {
    tr.journal?.("info", `Aucun canal actif — alerte journalisée seulement : ${t.titre}`);
  }
  return { ticket: t, ignoree: false, envois };
}

/**
 * Pose le champ marqueur attendu par la billetterie.
 *
 * Le schéma en prévoit un en tête de document pour que le destinataire
 * reconnaisse son format. Son nom varie d'une billetterie à l'autre, d'où ce
 * réglage plutôt qu'une valeur figée dans le code.
 */
function marquer(t: Ticket, nom?: string): Ticket {
  const cle = (nom || "ticket").replace(/[^a-z0-9_]/gi, "").slice(0, 32) || "ticket";
  const { ticket, ...reste } = t as any;
  return { [cle]: 1, ...reste } as Ticket;
}

/** Réglages par défaut : rien d'activé, format lisible partout. */
export function configParDefaut(): ConfigAlertes {
  return {
    courriel: { actif: false, format: "lisible" },
    bot: { actif: false, format: "lisible" },
    billetterie: { actif: false, marqueur: "ticket" },
    seuil: "p4",
  };
}
