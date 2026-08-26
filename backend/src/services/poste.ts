// Envoi des alertes vers Poste, le relais maison.
//
// Aucun identifiant SMTP n'est stocké : le service ne connaît qu'une clé
// d'envoi à portée limitée, lue dans l'environnement. Sans elle, l'envoi est
// simplement désactivé et le reste de l'application continue de tourner.
//
// L'objet du message doit rester STABLE pour un même incident : Poste regroupe
// les alertes de même service, même machine et même objet sur trente minutes et
// incrémente un compteur au lieu d'ouvrir un second ticket. Tout ce qui varie —
// horodatage, valeurs mesurées, compteurs — appartient donc au corps.

import { logEvent } from "./logger";

// Rien n'est écrit en dur ici : le relais, l'expéditeur et l'alias sont propres
// à chaque installation. Sans POSTE_URL, l'envoi reste simplement inactif et le
// reste de l'application continue de tourner.
const POSTE_URL = process.env.POSTE_URL || "";
const EXPEDITEUR = process.env.POSTE_FROM || "";
const ALIAS = process.env.POSTE_ALIAS || EXPEDITEUR;   // urgence de base : normale
const TIMEOUT_MS = 10_000;
const TENTATIVES = 2;
const ATTENTE_MS = 3_000;

let signale = false;

/** La clé est lue à chaque appel : inutile de redémarrer pour l'activer. */
function cle(): string {
  // Le relais n'est joignable que si l'adresse ET la clé sont renseignées.
  return POSTE_URL && EXPEDITEUR ? process.env.POSTE_SEND_KEY || "" : "";
}

/** Signale une seule fois, au démarrage, que l'envoi est inactif. */
export function annoncerPoste(): void {
  if (cle()) {
    console.log("[poste] envoi actif vers " + ALIAS);
  } else if (!signale) {
    signale = true;
    console.log("[poste] POSTE_URL, POSTE_FROM ou POSTE_SEND_KEY absente — envoi desactive");
  }
}

const pause = (ms: number) => new Promise(r => setTimeout(r, ms));

export interface AlertePoste {
  /** Résumé court et stable du problème. Ni date, ni compteur. */
  objet: string;
  /** Corps en texte brut. */
  corps: string;
  /** Machine concernée : ajoute la ligne « Machine : … » attendue par Poste. */
  machine?: string;
  /** Détails complémentaires, rendus en « clé : valeur ». */
  details?: Record<string, string | number | undefined>;
}

function composerCorps(a: AlertePoste): string {
  const lignes: string[] = [];
  if (a.machine) lignes.push("Machine : " + a.machine);
  lignes.push("Service : MapMyLAN");
  lignes.push("Horodatage : " + new Date().toISOString());
  lignes.push("");
  lignes.push(a.corps.trim());
  if (a.details) {
    const utiles = Object.entries(a.details).filter(([, v]) => v !== undefined && v !== "");
    if (utiles.length) {
      lignes.push("");
      for (const [k, v] of utiles) lignes.push(k + " : " + String(v));
    }
  }
  return lignes.join("\n");
}

/**
 * Envoie une alerte. Ne lève jamais : un échec d'envoi ne doit pas interrompre
 * la tâche en cours. Les erreurs sont journalisées telles quelles.
 */
export async function envoyerPoste(a: AlertePoste): Promise<{ ok: boolean; error?: string; messageId?: string }> {
  const k = cle();
  if (!k) return { ok: false, error: "POSTE_SEND_KEY absente" };

  const charge = JSON.stringify({
    from: EXPEDITEUR,
    to: ALIAS,
    subject: a.objet,
    text: composerCorps(a),
  });

  let derniere = "";
  for (let essai = 1; essai <= TENTATIVES; essai++) {
    const arret = new AbortController();
    const minuteur = setTimeout(() => arret.abort(), TIMEOUT_MS);
    try {
      const rep = await fetch(POSTE_URL, {
        method: "POST",
        headers: { "x-poste-key": k, "content-type": "application/json" },
        body: charge,
        signal: arret.signal,
      });
      clearTimeout(minuteur);

      const brut = await rep.text();
      let data: any = null;
      try { data = JSON.parse(brut); } catch { /* réponse non JSON */ }

      if (rep.ok && data?.ok) {
        return { ok: true, messageId: data.messageId };
      }
      // Message d'erreur journalisé tel quel, sans reformulation.
      derniere = data?.error || brut || ("HTTP " + rep.status);
    } catch (e: any) {
      clearTimeout(minuteur);
      derniere = e?.name === "AbortError" ? "timeout " + TIMEOUT_MS + "ms" : String(e?.message || e);
    }
    if (essai < TENTATIVES) await pause(ATTENTE_MS);
  }

  await logEvent("error", "poste", derniere).catch(() => {});
  return { ok: false, error: derniere };
}

/** Retour à la normale : même objet que l'alerte d'origine, préfixé. */
export async function envoyerRetablissement(objetOrigine: string, corps: string, machine?: string) {
  return envoyerPoste({ objet: "RÉTABLI - " + objetOrigine, corps, machine });
}

/** Message de vérification, pour éprouver la chaîne de bout en bout. */
export async function testerPoste(): Promise<{ ok: boolean; error?: string; messageId?: string }> {
  return envoyerPoste({
    objet: "Test de la liaison Poste",
    corps: "Message de verification envoye depuis MapMyLAN. Aucune action requise.",
    machine: process.env.HOSTNAME || "mapmylan",
  });
}
