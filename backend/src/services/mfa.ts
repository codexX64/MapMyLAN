// Second facteur.
//
// État des lieux avant ce module : « Double authentification : Active » ne
// gardait que la réinitialisation de mot de passe. La connexion, elle, ne
// demandait jamais rien de plus que le mot de passe. L'étiquette promettait
// donc davantage que ce que le produit faisait.
//
// Ici, le second facteur devient une vraie étape de connexion, et chacun
// choisit le sien :
//
//   trousseau — une clé d'accès (WebAuthn). Touch ID, Face ID, clé USB,
//               trousseau iCloud. Rien à taper, rien à recopier, rien à
//               intercepter : la preuve est une signature liée au domaine ;
//   application — le code à six chiffres, celui qui existait déjà ;
//   telegram   — un code envoyé dans la discussion privée du compte avec le
//                bot. Moins fort que les deux autres — il transite par un
//                service tiers — mais il ne demande aucun matériel et aucune
//                application à installer, et c'est déjà bien plus qu'un mot de
//                passe seul.
//
// Deux règles tiennent le reste :
//
//   1. on ne s'inscrit jamais à la place de quelqu'un. Un administrateur peut
//      exiger un second facteur, ou en révoquer un ; il ne peut pas en poser
//      un — sans quoi le secret serait connu de deux personnes et ce ne serait
//      plus un second facteur ;
//   2. exiger sans avoir inscrit ne verrouille personne dehors : la connexion
//      passe, et l'inscription est réclamée juste après.

import { prisma } from "../db";
import { randomUUID, randomInt, timingSafeEqual } from "node:crypto";
import { getConfig, sendTelegram } from "./notifier";

// Les deux tables sont déclarées dans prisma/schema.prisma — c'est le point
// important, et je l'avais raté. Le conteneur lance « prisma db push » au
// démarrage, et db push considère toute table absente du schéma comme une
// dérive à effacer : vide il la supprime sans rien dire, pleine il refuse et
// sort en erreur. La clé d'accès enregistrée a suffi à mettre le backend en
// boucle de redémarrage. Une table créée ici sans être déclarée là-bas est
// donc une panne à retardement, pas un raccourci.
//
// Le CREATE IF NOT EXISTS reste : db push a déjà créé les tables, l'ordre est
// sans effet, et il garde le module autonome si quelqu'un pointe une base
// montée autrement.
//
// La préparation est **paresseuse** : chaque fonction de ce module l'attend
// avant de toucher la base. Un appel à poser au démarrage, c'est un appel qu'on
// peut oublier — et c'est exactement ce qui s'est produit : la ligne visait
// « await verifierSecrets() » là où le fichier écrit « verifierSecrets() »,
// elle n'a jamais été posée, et les erreurs étaient avalées en silence.
let preparation: Promise<void> | null = null;

export function preparerTables(): Promise<void> {
  if (!preparation) preparation = creerTables();
  return preparation;
}

async function creerTables(): Promise<void> {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "Passkey" (
      "id"           TEXT PRIMARY KEY,
      "userId"       TEXT NOT NULL,
      "credentialId" TEXT NOT NULL UNIQUE,
      "publicKey"    TEXT NOT NULL,
      "counter"      BIGINT NOT NULL DEFAULT 0,
      "transports"   TEXT,
      "label"        TEXT,
      "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "lastUsed"     TIMESTAMP(3)
    )`);
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "Passkey_userId_idx" ON "Passkey" ("userId")`);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "UserSecurity" (
      "userId"          TEXT PRIMARY KEY,
      "mfaRequired"     BOOLEAN NOT NULL DEFAULT false,
      "telegramChatId"  TEXT
    )`);
}

async function lignes(sql: string, ...p: any[]): Promise<any[]> {
  await preparerTables();
  return (await prisma.$queryRawUnsafe(sql, ...p)) as unknown as any[];
}

async function ecrire(sql: string, ...p: any[]): Promise<number> {
  await preparerTables();
  return Number(await prisma.$executeRawUnsafe(sql, ...p));
}

export interface Cle {
  id: string; label: string | null; createdAt: string; lastUsed: string | null;
}

export async function clesDe(userId: string): Promise<Cle[]> {
  const r = await lignes(
    `SELECT "id", "label", "createdAt", "lastUsed" FROM "Passkey"
      WHERE "userId" = $1 ORDER BY "createdAt" ASC`, userId).catch(() => []);
  return r as Cle[];
}

export async function clesCompletes(userId: string): Promise<any[]> {
  return lignes(`SELECT * FROM "Passkey" WHERE "userId" = $1`, userId).catch(() => []);
}

export async function cleParIdentifiant(credentialId: string): Promise<any | null> {
  const r = await lignes(`SELECT * FROM "Passkey" WHERE "credentialId" = $1`, credentialId)
    .catch(() => []);
  return r[0] || null;
}

export async function enregistrerCle(
  userId: string, credentialId: string, publicKey: string,
  counter: number, transports: string[], label: string,
): Promise<void> {
  await ecrire(
    `INSERT INTO "Passkey" ("id","userId","credentialId","publicKey","counter","transports","label")
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT ("credentialId") DO NOTHING`,
    randomUUID(), userId, credentialId, publicKey, counter, transports.join(","), label.slice(0, 60),
  );
}

export async function majCompteur(credentialId: string, counter: number): Promise<void> {
  await ecrire(
    `UPDATE "Passkey" SET "counter" = $1, "lastUsed" = now() WHERE "credentialId" = $2`,
    counter, credentialId,
  ).catch(() => {});
}

export async function supprimerCle(userId: string, id: string): Promise<number> {
  return ecrire(`DELETE FROM "Passkey" WHERE "id" = $1 AND "userId" = $2`, id, userId)
    .catch(() => 0);
}

export async function supprimerToutesLesCles(userId: string): Promise<number> {
  return ecrire(`DELETE FROM "Passkey" WHERE "userId" = $1`, userId).catch(() => 0);
}

export async function a2fExigee(userId: string): Promise<boolean> {
  return (await securiteDe(userId)).exigee;
}

/** La ligne UserSecurity, en une seule lecture plutôt qu'une par champ. */
async function securiteDe(userId: string): Promise<{ exigee: boolean; chat: string | null }> {
  const r = await lignes(
    `SELECT "mfaRequired", "telegramChatId" FROM "UserSecurity" WHERE "userId" = $1`, userId,
  ).catch(() => []);
  return { exigee: r[0]?.mfaRequired === true, chat: r[0]?.telegramChatId || null };
}

export async function exigerA2f(userId: string, valeur: boolean): Promise<void> {
  await ecrire(
    `INSERT INTO "UserSecurity" ("userId","mfaRequired") VALUES ($1,$2)
     ON CONFLICT ("userId") DO UPDATE SET "mfaRequired" = EXCLUDED."mfaRequired"`,
    userId, valeur,
  );
}

/** Ce dont un compte dispose réellement, pour l'interface comme pour la connexion. */
export async function moyensDe(user: { id: string; totpEnabled?: boolean }): Promise<{
  cles: number; application: boolean; telegram: boolean; chatMasque: string | null;
  exigee: boolean; moyens: string[];
}> {
  const [cles, s] = await Promise.all([clesDe(user.id), securiteDe(user.id)]);
  const moyens: string[] = [];
  if (cles.length) moyens.push("trousseau");
  if (user.totpEnabled) moyens.push("application");
  if (s.chat) moyens.push("telegram");
  return {
    cles: cles.length,
    application: !!user.totpEnabled,
    telegram: !!s.chat,
    // Jamais l'identifiant complet : il suffit à écrire au compte, et l'écran
    // n'a besoin que de le reconnaître.
    chatMasque: s.chat ? masquer(s.chat) : null,
    exigee: s.exigee,
    moyens,
  };
}

function masquer(chat: string): string {
  const c = String(chat);
  return c.length <= 4 ? "…" + c : "…" + c.slice(-4);
}

/**
 * L'origine et le domaine à qui la clé se lie.
 *
 * Une clé d'accès est attachée au domaine qui l'a créée : c'est ce qui la rend
 * inutilisable sur un site de hameçonnage. On les lit sur la requête plutôt que
 * de les figer dans une variable d'environnement — l'instance est jointe par un
 * nom, parfois deux, et une valeur écrite en dur casserait le second.
 */
export function origineDe(req: any): { rpID: string; origin: string } | null {
  const brut = String(req.headers?.origin || "");
  if (!brut) return null;
  try {
    const u = new URL(brut);
    if (u.protocol !== "https:" && u.hostname !== "localhost" && u.hostname !== "127.0.0.1") return null;
    return { rpID: u.hostname, origin: u.origin };
  } catch { return null; }
}

// ── Telegram ────────────────────────────────────────────────────────────────
//
// Le principe est le même que pour les deux autres moyens : personne n'inscrit
// à la place de personne. Un compte donne l'identifiant de sa discussion avec
// le bot, MapMyLAN y envoie un code, et le compte le recopie. Tant que le code
// n'est pas revenu, rien n'est enregistré — sans quoi il suffirait de taper
// l'identifiant d'un tiers pour lui envoyer ses propres codes de connexion.
//
// Ce facteur vaut moins qu'une clé d'accès : le code voyage par un service
// tiers, et qui prend la main sur le compte Telegram prend la main sur le
// facteur. Il est proposé parce qu'il ne demande rien à installer, pas parce
// qu'il est équivalent. L'interface le dit.

/** Le bot est-il configuré ? Sans jeton, inutile de proposer ce facteur. */
export async function botTelegramPret(): Promise<boolean> {
  const c = await getConfig("telegram").catch(() => null);
  return !!c?.token;
}

export async function chatTelegramDe(userId: string): Promise<string | null> {
  const r = await lignes(
    `SELECT "telegramChatId" FROM "UserSecurity" WHERE "userId" = $1`, userId).catch(() => []);
  return r[0]?.telegramChatId || null;
}

export async function definirChatTelegram(userId: string, chat: string | null): Promise<void> {
  await ecrire(
    `INSERT INTO "UserSecurity" ("userId","mfaRequired","telegramChatId") VALUES ($1, false, $2)
     ON CONFLICT ("userId") DO UPDATE SET "telegramChatId" = EXCLUDED."telegramChatId"`,
    userId, chat,
  );
}

// ── Codes à usage unique ────────────────────────────────────────────────────
//
// En mémoire, comme les défis : cinq minutes de vie, cinq essais, un seul
// usage. Les écrire en base pour une valeur qui meurt avant le prochain
// balayage n'apporterait qu'une trace de plus à protéger.

interface CodeEnCours {
  code: string;
  expire: number;
  essais: number;
  dernierEnvoi: number;
  /** Le chat visé, figé à l'envoi : le retour ne peut pas en désigner un autre. */
  chat: string;
}
const codes = new Map<string, CodeEnCours>();
setInterval(() => {
  const t = Date.now();
  for (const [k, v] of codes) if (v.expire < t) codes.delete(k);
}, 60_000).unref?.();

const VIE_CODE_MS = 5 * 60_000;
const ATTENTE_RENVOI_MS = 30_000;
const ESSAIS_MAX = 5;

/**
 * Envoie un code à un chat et le retient sous `cle`.
 *
 * `cle` vaut le défi de connexion, ou « lien:<compte> » pendant l'inscription :
 * deux usages qui ne doivent jamais partager un code.
 */
export async function envoyerCodeTelegram(
  cle: string, chat: string, raison: string,
): Promise<{ ok: boolean; error?: string; attendre?: number }> {
  const existant = codes.get(cle);
  const maintenant = Date.now();
  if (existant && maintenant - existant.dernierEnvoi < ATTENTE_RENVOI_MS) {
    const attendre = Math.ceil((ATTENTE_RENVOI_MS - (maintenant - existant.dernierEnvoi)) / 1000);
    return { ok: false, error: `Un code vient d'être envoyé. Attends ${attendre} s.`, attendre };
  }

  const c = await getConfig("telegram").catch(() => null);
  if (!c?.token) return { ok: false, error: "Le bot Telegram n'est pas configuré sur cette instance." };

  // randomInt plutôt que Math.random : c'est un secret, même s'il ne vit que
  // cinq minutes.
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const envoi = await sendTelegram(
    `<b>MapMyLAN</b>\n${raison}\n\nCode : <code>${code}</code>\n` +
    `Il expire dans 5 minutes. Si tu n'as rien demandé, ignore ce message et ` +
    `change ton mot de passe.`,
    { token: c.token, chatId: chat },
  );
  if (!envoi.ok) {
    return { ok: false, error: envoi.error || "Telegram n'a pas accepté le message." };
  }

  codes.set(cle, {
    code, chat, essais: 0,
    expire: maintenant + VIE_CODE_MS,
    dernierEnvoi: maintenant,
  });
  return { ok: true };
}

export type ResultatCode = "ok" | "faux" | "expire" | "epuise";

/**
 * Vérifie un code. Quel que soit le verdict, un code juste ne sert qu'une fois
 * et cinq erreurs le brûlent : sans cela, six chiffres se devinent.
 */
export function verifierCodeTelegram(cle: string, saisi: string): { etat: ResultatCode; chat?: string } {
  const c = codes.get(cle);
  if (!c || c.expire < Date.now()) { codes.delete(cle); return { etat: "expire" }; }

  const propre = String(saisi || "").replace(/\D/g, "");
  const a = Buffer.from(c.code);
  const b = Buffer.from(propre.padEnd(a.length, " ").slice(0, a.length));
  const juste = propre.length === a.length && timingSafeEqual(a, b);

  if (!juste) {
    c.essais += 1;
    if (c.essais >= ESSAIS_MAX) { codes.delete(cle); return { etat: "epuise" }; }
    return { etat: "faux" };
  }
  codes.delete(cle);
  return { etat: "ok", chat: c.chat };
}

export function oublierCodeTelegram(cle: string): void {
  codes.delete(cle);
}
