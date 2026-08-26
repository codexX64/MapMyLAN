// Hachage des mots de passe.
//
// Argon2id, lauréat de la Password Hashing Competition et recommandation
// actuelle de l'OWASP. Il résiste à la fois aux attaques par canal auxiliaire
// (grâce à sa première passe indépendante des données) et aux attaques par
// matériel dédié (grâce à son coût mémoire), ce que bcrypt ne fait pas :
// bcrypt tient dans 4 Kio, ce qui le rend massivement parallélisable sur GPU.
//
// Trois principes gouvernent ce module :
//
//   1. Les empreintes bcrypt existantes restent vérifiables, et sont
//      silencieusement réencodées en Argon2id à la première connexion réussie.
//      Personne ne perd son accès, et le parc bascule tout seul.
//
//   2. La vérification prend un temps comparable que le compte existe ou non.
//      Sans cela, un attaquant distingue « identifiant inconnu » de « mot de
//      passe faux » au chronomètre, et énumère les comptes.
//
//   3. Un poivre facultatif, tiré de l'environnement, s'ajoute au sel. Une base
//      volée sans le poivre ne se casse pas hors ligne.

import { createHmac, timingSafeEqual } from "crypto";
import { hash as argonHash, verify as argonVerify, Algorithm, Version } from "@node-rs/argon2";
import bcrypt from "bcryptjs";

// ── Paramètres ─────────────────────────────────────────────────────────────
//
// Le coût mémoire est le levier principal contre les attaques matérielles.
// 32 Mio par vérification arrête net l'usage de GPU, tout en restant tenable
// sur une machine modeste : la connexion prend une fraction de seconde.
//
// Le monter davantage se retournerait contre nous : chaque tentative de
// connexion réserve cette mémoire, et un attaquant qui martèle l'endpoint
// épuiserait la machine. C'est le limiteur de tentatives qui rend ce choix
// sûr — les deux vont ensemble.
export const PARAMS = {
  algorithm: Algorithm.Argon2id,
  version: Version.V0x13,
  memoryCost: 32768,   // 32 Mio
  timeCost: 3,         // 3 passes
  parallelism: 1,      // un seul fil : la mémoire est déjà le facteur limitant
  outputLen: 32,
} as const;

/** Empreinte de référence, utilisée pour égaliser les temps de réponse. */
let LEURRE: string | null = null;

/**
 * Poivre facultatif.
 *
 * Contrairement au sel, qui est public et stocké avec l'empreinte, le poivre
 * vit hors de la base — dans une variable d'environnement, idéalement dans un
 * gestionnaire de secrets. Une base exfiltrée seule devient inexploitable.
 *
 * Il est appliqué en HMAC avant le hachage plutôt que concaténé, pour éviter
 * les attaques par extension de longueur et le plafond de 72 octets de bcrypt.
 */
function poivrer(motDePasse: string): string {
  const poivre = process.env.PASSWORD_PEPPER;
  if (!poivre) return motDePasse;
  return createHmac("sha256", poivre).update(motDePasse, "utf8").digest("base64");
}

/** Reconnaît une empreinte bcrypt à son préfixe. */
function estBcrypt(empreinte: string): boolean {
  return /^\$2[aby]\$/.test(empreinte);
}

/** Reconnaît une empreinte Argon2id. */
function estArgon2id(empreinte: string): boolean {
  return empreinte.startsWith("$argon2id$");
}

/**
 * L'empreinte est-elle en retard sur les paramètres courants ?
 *
 * Sert à réencoder progressivement le parc quand on durcit les réglages, sans
 * demander à personne de changer de mot de passe.
 */
export function aRechiffrer(empreinte: string): boolean {
  if (!empreinte) return true;
  if (!estArgon2id(empreinte)) return true;      // bcrypt, ou format inconnu

  const m = /\$argon2id\$v=(\d+)\$m=(\d+),t=(\d+),p=(\d+)\$/.exec(empreinte);
  if (!m) return true;
  const [, v, mem, t, p] = m.map(Number);
  return v < 19
      || mem < PARAMS.memoryCost
      || t < PARAMS.timeCost
      || p < PARAMS.parallelism;
}

/** Produit une empreinte Argon2id. */
export async function hacher(motDePasse: string): Promise<string> {
  if (typeof motDePasse !== "string" || motDePasse.length === 0) {
    throw new Error("Mot de passe vide.");
  }
  // Argon2 n'a pas la limite de 72 octets de bcrypt, mais on borne tout de
  // même : une chaîne d'un mégaoctet servirait à saturer le processeur.
  if (Buffer.byteLength(motDePasse, "utf8") > 4096) {
    throw new Error("Mot de passe démesurément long.");
  }
  return argonHash(poivrer(motDePasse), PARAMS);
}

export interface ResultatVerification {
  /** Le mot de passe correspond. */
  ok: boolean;
  /** L'empreinte doit être réécrite : elle est en bcrypt, ou en retard. */
  aMettreAJour: boolean;
  /** Nouvelle empreinte à enregistrer, si une mise à jour est requise. */
  nouvelleEmpreinte?: string;
}

/**
 * Vérifie un mot de passe contre une empreinte, quel que soit son algorithme.
 *
 * Quand l'empreinte est en bcrypt et que le mot de passe est correct, une
 * empreinte Argon2id est calculée et renvoyée : l'appelant n'a plus qu'à
 * l'écrire en base. C'est ce qui permet la migration sans interruption.
 */
export async function verifier(
  motDePasse: string,
  empreinte: string | null | undefined,
): Promise<ResultatVerification> {
  // Compte inexistant ou sans empreinte : on effectue quand même un calcul de
  // coût équivalent, sinon la réponse revient instantanément et trahit
  // l'absence du compte.
  if (!empreinte) {
    await consommerTempsEquivalent();
    return { ok: false, aMettreAJour: false };
  }

  const poivre = poivrer(motDePasse);

  if (estArgon2id(empreinte)) {
    let ok = false;
    try {
      ok = await argonVerify(empreinte, poivre);
    } catch {
      ok = false;                                // empreinte corrompue
    }
    if (!ok) return { ok: false, aMettreAJour: false };
    if (aRechiffrer(empreinte)) {
      return { ok: true, aMettreAJour: true, nouvelleEmpreinte: await hacher(motDePasse) };
    }
    return { ok: true, aMettreAJour: false };
  }

  if (estBcrypt(empreinte)) {
    // Historique : bcrypt était appliqué au mot de passe brut, sans poivre.
    // On vérifie donc contre la valeur d'origine, puis on réencode avec.
    const ok = await bcrypt.compare(motDePasse, empreinte).catch(() => false);
    if (!ok) return { ok: false, aMettreAJour: false };
    return { ok: true, aMettreAJour: true, nouvelleEmpreinte: await hacher(motDePasse) };
  }

  // Format inconnu : on refuse plutôt que de deviner.
  await consommerTempsEquivalent();
  return { ok: false, aMettreAJour: false };
}

/**
 * Consomme un temps comparable à une vérification réelle.
 *
 * On calcule l'empreinte d'une valeur fixe une seule fois, puis on la vérifie
 * contre une valeur toujours fausse. Le coût est celui d'une vérification
 * authentique, ce qui aplanit la différence de temps entre un compte connu et
 * un compte inconnu.
 */
async function consommerTempsEquivalent(): Promise<void> {
  if (!LEURRE) LEURRE = await argonHash("00000000000000000000000000000000", PARAMS);
  try {
    await argonVerify(LEURRE, "valeur systematiquement fausse");
  } catch {
    /* sans effet : seul le temps écoulé compte */
  }
}

/**
 * Prépare le leurre au démarrage.
 *
 * Sans cette précaution, la toute première tentative sur un compte inexistant
 * serait plus lente que les suivantes, ce qui constituerait un signal.
 */
export async function prechauffer(): Promise<void> {
  await consommerTempsEquivalent();
}

/**
 * Compare deux chaînes en temps constant.
 *
 * Pour les jetons, clés d'accès et codes à usage unique : une comparaison par
 * `===` s'arrête au premier octet différent, ce qui laisse fuir le préfixe
 * correct au chronomètre.
 */
export function egalConstant(a: string, b: string): boolean {
  const ba = Buffer.from(String(a ?? ""), "utf8");
  const bb = Buffer.from(String(b ?? ""), "utf8");
  // timingSafeEqual exige des longueurs identiques. On hache d'abord, ce qui
  // uniformise la taille sans révéler la longueur réelle du secret.
  const ha = createHmac("sha256", "comparaison").update(ba).digest();
  const hb = createHmac("sha256", "comparaison").update(bb).digest();
  return timingSafeEqual(ha, hb);
}
