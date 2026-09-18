// Les règles de la réinitialisation de mot de passe, isolées de l'HTTP.
//
// Elles vivent ici plutôt que dans la route parce que ce sont les décisions de
// sécurité du parcours, et qu'une décision de sécurité doit pouvoir être
// vérifiée sans monter un serveur. La route se contente de les appliquer.

import crypto from "node:crypto";

/**
 * Ce qu'on garde d'un lien envoyé par courrier : son empreinte, jamais le
 * secret. Une base lue ne donne donc aucun lien utilisable — il faudrait
 * inverser SHA-256.
 */
export function empreinte(secret: string): string {
  return crypto.createHash("sha256").update(secret).digest("hex");
}

/** Un secret de 32 octets, sûr et sans caractère à échapper dans une URL. */
export function nouveauSecret(): string {
  return crypto.randomBytes(32).toString("base64url");
}

export interface DemandeLien {
  consumed: boolean;
  expiresAt: Date;
  lienUtiliseLe?: Date | null;
}

/**
 * Le lien est-il encore utilisable ?
 *
 * Trois refus, et un seul message côté route : distinguer « inconnu » de
 * « déjà utilisé » de « expiré » renseignerait sur ce qui existe.
 *
 * Le cas qui compte est le troisième : un lien déjà ouvert ne se rouvre pas,
 * même si la preuve demandée derrière a échoué. Sans cela, un lien retrouvé
 * dans l'historique ou dans le journal d'un mandataire resterait une porte
 * ouverte pendant tout son délai de validité.
 */
export function lienUtilisable(
  demande: DemandeLien | null | undefined,
  maintenant: Date = new Date(),
): boolean {
  if (!demande) return false;
  if (demande.consumed) return false;
  if (demande.lienUtiliseLe) return false;
  return demande.expiresAt.getTime() > maintenant.getTime();
}

/**
 * Où part le lien : l'adresse DU COMPTE, et rien d'autre.
 *
 * Deux adresses ne jouent pas le même rôle et ne doivent pas se confondre.
 * L'adresse commune configurée à la mise en route est celle qui **envoie** —
 * le « no-reply » de l'installation. L'adresse du compte est celle qui
 * **reçoit**. Prendre la première comme destinataire de repli enverrait les
 * liens de tous les comptes dans la même boîte : qui la lit les prend tous.
 *
 * Et jamais une adresse fournie par la requête : sinon il suffirait de demander
 * un lien vers sa propre boîte pour prendre n'importe quel compte.
 *
 * Pas d'adresse sur le compte ⇒ pas de réinitialisation. C'est un choix
 * assumé : mieux vaut une porte absente qu'une porte qui s'ouvre au mauvais
 * endroit. La reprise par le `.env` reste la sortie de secours.
 */
export function destinataire(
  user: { email?: string | null } | null | undefined,
): string | null {
  const perso = String(user?.email || "").trim();
  return perso || null;
}

/**
 * Les moyens à demander pour prouver son identité.
 *
 * C'est le correctif central : on renvoie ceux qui sont RÉELLEMENT inscrits sur
 * le compte. L'ancienne version exigeait l'application ET Telegram, écrits en
 * dur ; un compte sans Telegram configuré voyait donc l'écran réclamer un code
 * qui ne pouvait pas arriver, et la procédure ne pouvait pas aboutir.
 *
 * L'ordre suit la solidité : une clé d'accès ne se recopie ni ne s'intercepte,
 * le code d'application vit hors ligne sur l'appareil, celui de Telegram
 * traverse un service tiers.
 */
const ORDRE = ["trousseau", "application", "telegram"] as const;

export function moyensAExiger(moyens: string[]): string[] {
  return ORDRE.filter((m) => moyens.includes(m));
}

/**
 * Combien de preuves selon ce qu'on fait.
 *
 * **Connexion : une.** Le mot de passe a déjà été donné ; la preuve s'ajoute à
 * lui. En exiger deux à chaque ouverture serait pénible sans gagner grand-chose.
 *
 * **Réinitialisation : toutes.** Il n'y a pas de mot de passe à opposer — c'est
 * lui qu'on remplace. Les moyens inscrits sont alors la seule chose qui protège
 * encore le compte, et on les demande donc tous.
 *
 * Conséquence assumée : avec deux moyens inscrits, en perdre un empêche la
 * réinitialisation. La reprise par le `.env` reste la sortie.
 */
export function exigenceDe(but: "connexion" | "reinit", moyens: string[]): string[] {
  const dispo = moyensAExiger(moyens);
  if (but === "reinit") return dispo;
  return dispo.length ? [dispo[0]] : [];
}
