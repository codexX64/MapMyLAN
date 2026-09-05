// Comptes.
//
// Trois rôles, avec ce que chacun peut faire :
//
//   admin     — tout, y compris cette page
//   operator  — piloter l'équipement et lancer des commandes SSH
//   viewer    — regarder, rien d'autre
//
// Deux garde-fous tiennent tout le reste : on ne supprime jamais le dernier
// administrateur, et on ne se supprime pas soi-même. Sans eux, une fausse
// manœuvre ferme la porte de l'extérieur, et il ne reste que la base de
// données pour rentrer.

import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { prisma } from "../db";
import { authRequired, requireRole, AuthedRequest } from "../middleware/auth";
import { hacher } from "../services/password";
import { verifyTotp } from "../services/totp";
import { logEvent } from "../services/logger";
import {
  moyensDe, clesDe, exigerA2f, supprimerToutesLesCles, definirChatTelegram,
  botTelegramPret,
} from "../services/mfa";

const router = Router();
router.use(authRequired);
router.use(requireRole("admin"));

const ROLES = ["admin", "operator", "viewer"] as const;

/** Identifiant : ni espace, ni accent, ni ponctuation exotique. */
const IDENTIFIANT = /^[a-zA-Z0-9](?:[a-zA-Z0-9._-]{1,30}[a-zA-Z0-9])?$/;

const CLE_VERROU = "users.creationLocked";

/**
 * Le compte fondateur : le premier créé, celui de l'installation.
 *
 * Son rôle est figé. Un administrateur peut en nommer d'autres, mais pas
 * retirer ses droits à celui qui a monté l'instance — c'est la garantie qu'il
 * reste toujours quelqu'un pour rentrer, quelles que soient les manœuvres des
 * comptes créés ensuite. Son identifiant et son mot de passe, eux, se changent
 * normalement.
 */
async function idFondateur(): Promise<string | null> {
  const premier = await prisma.user.findFirst({
    orderBy: { createdAt: "asc" }, select: { id: true },
  });
  return premier?.id || null;
}

const publiable = (u: any, fondateur?: string | null) => ({
  fondateur: !!fondateur && u.id === fondateur,
  id: u.id,
  username: u.username,
  role: u.role,
  createdAt: u.createdAt,
  lastLogin: u.lastLogin,
  totpEnabled: !!u.totpEnabled,
  // L'adresse à laquelle part le lien de réinitialisation. Sans elle, ce
  // compte ne peut pas réinitialiser son mot de passe — l'écran doit pouvoir
  // le dire plutôt que de le laisser découvrir le jour où c'est urgent.
  email: u.email || null,
  mustChangePassword: !!u.mustChangePassword,
  verrouilleJusqua: u.lockedUntil,
});

async function compteAdmins(saufId?: string): Promise<number> {
  return prisma.user.count({
    where: { role: "admin", ...(saufId ? { id: { not: saufId } } : {}) },
  });
}

async function creationVerrouillee(): Promise<boolean> {
  const r = await prisma.setting.findUnique({ where: { key: CLE_VERROU } }).catch(() => null);
  return r?.value === true;
}

// ── Liste ───────────────────────────────────────────────────────────────────

router.get("/", async (_req, res) => {
  const users = await prisma.user.findMany({ orderBy: { createdAt: "asc" } });
  const fondateur = users[0]?.id || null;
  const facteurs = await Promise.all(users.map(u => moyensDe(u)));
  res.json({
    comptes: users.map((u, i) => ({ ...publiable(u, fondateur), a2f: facteurs[i] })),
    creationVerrouillee: await creationVerrouillee(),
    roles: ROLES,
  });
});

// ── Création ────────────────────────────────────────────────────────────────

const schemaCreation = z.object({
  username: z.string(),
  password: z.string(),
  role: z.enum(ROLES).default("viewer"),
  email: z.string().trim().max(254).optional(),
  mustChangePassword: z.boolean().optional(),
});

router.post("/", async (req: AuthedRequest, res) => {
  if (await creationVerrouillee()) {
    return res.status(423).json({
      error: "La création de comptes est verrouillée. Déverrouille-la avec un code du second facteur.",
    });
  }

  const parsed = schemaCreation.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Champs invalides" });
  const { username, password, role } = parsed.data;

  const nom = username.trim();
  if (!IDENTIFIANT.test(nom)) {
    return res.status(400).json({
      error: "Identifiant : 3 à 32 caractères, lettres, chiffres, point, tiret ou souligné.",
    });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: "Le mot de passe doit faire au moins 8 caractères." });
  }
  // La comparaison est insensible à la casse : « Dupont » et « dupont » qui
  // cohabitent, c'est une confusion garantie au moment de se connecter.
  const existe = await prisma.user.findFirst({
    where: { username: { equals: nom, mode: "insensitive" } },
  });
  if (existe) return res.status(409).json({ error: "Cet identifiant est déjà pris." });

  const u = await prisma.user.create({
    data: {
      username: nom,
      password: await hacher(password),
      role,
      email: (parsed.data.email || "").trim() || null,
      // Par défaut le compte change son mot de passe à la première connexion :
      // celui que tu viens de saisir a transité par ton écran et ta mémoire.
      mustChangePassword: parsed.data.mustChangePassword ?? true,
    },
  });
  // Le second facteur est exigé sur tout compte, pas seulement le premier :
  // un compte créé plus tard garde les mêmes droits sur le réseau.
  await exigerA2f(u.id, true).catch(() => {});

  await logEvent("info", "users", `Compte créé : ${nom} (${role}) par ${req.user?.username}`);
  res.json(publiable(u, await idFondateur()));
});

// ── Modification ────────────────────────────────────────────────────────────

const ADRESSE = z.string().trim().max(254).refine(
  (v) => v === "" || (v.includes("@") && v.indexOf("@") > 0 && v.lastIndexOf(".") > v.indexOf("@")),
  { message: "Adresse invalide." },
);

const schemaMaj = z.object({
  username: z.string().optional(),
  role: z.enum(ROLES).optional(),
  email: ADRESSE.optional(),
  mustChangePassword: z.boolean().optional(),
  deverrouiller: z.boolean().optional(),   // lève le blocage après échecs
});

router.patch("/:id", async (req: AuthedRequest, res) => {
  const parsed = schemaMaj.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Champs invalides" });

  const cible = await prisma.user.findUnique({ where: { id: req.params.id } });
  if (!cible) return res.status(404).json({ error: "Compte introuvable" });

  const data: any = {};

  // Vider le champ retire l'adresse — et donc la possibilité de réinitialiser.
  if (parsed.data.email !== undefined) data.email = parsed.data.email.trim() || null;

  if (parsed.data.username !== undefined) {
    const nom = parsed.data.username.trim();
    if (!IDENTIFIANT.test(nom)) {
      return res.status(400).json({
        error: "Identifiant : 3 à 32 caractères, lettres, chiffres, point, tiret ou souligné.",
      });
    }
    if (nom.toLowerCase() !== cible.username.toLowerCase()) {
      const pris = await prisma.user.findFirst({
        where: { username: { equals: nom, mode: "insensitive" } },
      });
      if (pris) return res.status(409).json({ error: "Cet identifiant est déjà pris." });
    }
    data.username = nom;
  }

  if (parsed.data.role !== undefined && parsed.data.role !== cible.role) {
    // Le compte fondateur garde ses droits, quoi qu'il arrive.
    if (cible.id === await idFondateur()) {
      return res.status(409).json({
        error: "Le compte d'installation reste administrateur. Son identifiant et son mot de passe se changent, pas son rôle.",
      });
    }
    // Rétrograder le dernier administrateur revient à fermer la porte de
    // l'extérieur : plus personne ne peut revenir sur cette page.
    if (cible.role === "admin" && parsed.data.role !== "admin" && (await compteAdmins(cible.id)) === 0) {
      return res.status(409).json({ error: "C'est le dernier administrateur : son rôle ne peut pas changer." });
    }
    data.role = parsed.data.role;
  }

  if (parsed.data.mustChangePassword !== undefined) {
    data.mustChangePassword = parsed.data.mustChangePassword;
  }
  if (parsed.data.deverrouiller) {
    data.failedLogins = 0;
    data.lockedUntil = null;
  }

  const fondateur = await idFondateur();
  if (Object.keys(data).length === 0) return res.json(publiable(cible, fondateur));

  // Un changement d'identifiant ou de rôle doit invalider les jetons déjà
  // émis : sinon le compte garde ses anciens droits jusqu'à expiration.
  if (data.username || data.role) data.tokenVersion = { increment: 1 };

  const u = await prisma.user.update({ where: { id: cible.id }, data });
  await logEvent("info", "users",
    `Compte modifié : ${cible.username}${data.username ? ` → ${data.username}` : ""}` +
    `${data.role ? ` · rôle ${data.role}` : ""} par ${req.user?.username}`);
  res.json(publiable(u, fondateur));
});

// ── Mot de passe imposé par un administrateur ───────────────────────────────

router.post("/:id/password", async (req: AuthedRequest, res) => {
  const mdp = String(req.body?.password || "");
  if (mdp.length < 8) return res.status(400).json({ error: "Huit caractères au minimum." });

  const cible = await prisma.user.findUnique({ where: { id: req.params.id } });
  if (!cible) return res.status(404).json({ error: "Compte introuvable" });

  await prisma.user.update({
    where: { id: cible.id },
    data: {
      password: await hacher(mdp),
      mustChangePassword: true,
      failedLogins: 0,
      lockedUntil: null,
      // Toutes les sessions de ce compte tombent : un mot de passe remis à
      // zéro doit couper l'accès de qui l'utilisait encore.
      tokenVersion: { increment: 1 },
    },
  });
  await logEvent("warn", "users", `Mot de passe réinitialisé pour ${cible.username} par ${req.user?.username}`);
  res.json({ ok: true });
});

// ── Suppression ─────────────────────────────────────────────────────────────

router.delete("/:id", async (req: AuthedRequest, res) => {
  const cible = await prisma.user.findUnique({ where: { id: req.params.id } });
  if (!cible) return res.status(404).json({ error: "Compte introuvable" });

  if (cible.id === req.user?.id) {
    return res.status(409).json({ error: "On ne supprime pas le compte avec lequel on est connecté." });
  }
  if (cible.id === await idFondateur()) {
    return res.status(409).json({ error: "Le compte d'installation ne peut pas être supprimé." });
  }
  if (cible.role === "admin" && (await compteAdmins(cible.id)) === 0) {
    return res.status(409).json({ error: "C'est le dernier administrateur : il ne peut pas être supprimé." });
  }

  await prisma.user.delete({ where: { id: cible.id } });
  await logEvent("warn", "users", `Compte supprimé : ${cible.username} par ${req.user?.username}`);
  res.json({ ok: true });
});

// ── Verrou de création ──────────────────────────────────────────────────────
//
// Poser le verrou est libre ; le lever exige un code du second facteur. C'est
// tout l'intérêt : quelqu'un qui obtiendrait une session d'administrateur ne
// peut pas se fabriquer un second compte pour revenir plus tard.
//
// Corollaire assumé : on refuse de poser le verrou tant que le compte n'a pas
// de second facteur, sinon il n'existerait plus aucun moyen de le lever.

router.get("/creation/etat", async (req: AuthedRequest, res) => {
  const moi = await prisma.user.findUnique({ where: { id: req.user!.id } });
  res.json({
    verrouille: await creationVerrouillee(),
    peutVerrouiller: !!moi?.totpEnabled,
  });
});

router.post("/creation/lock", async (req: AuthedRequest, res) => {
  const moi = await prisma.user.findUnique({ where: { id: req.user!.id } });
  if (!moi?.totpEnabled) {
    return res.status(409).json({
      error: "Active d'abord le second facteur sur ton compte : sans lui, le verrou ne pourrait plus être levé.",
    });
  }
  await prisma.setting.upsert({
    where: { key: CLE_VERROU }, update: { value: true }, create: { key: CLE_VERROU, value: true },
  });
  await logEvent("info", "users", `Création de comptes verrouillée par ${req.user?.username}`);
  res.json({ verrouille: true });
});

/**
 * Un code à six chiffres, c'est un million de possibilités : sans limite, une
 * session d'administrateur détournée les épuise en quelques minutes — et c'est
 * précisément contre elle que le verrou existe. Le compteur suit le compte, pas
 * l'adresse, qui peut changer ; un code juste ne consomme rien.
 */
const limiteurCode = rateLimit({
  windowMs: 15 * 60_000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  keyGenerator: (req: any) => req.user?.id || "inconnu",
  handler: (_req, res) => res.status(429).json({
    error: "Trop de codes refusés. Réessaie dans un quart d'heure.",
  }),
});

router.post("/creation/unlock", limiteurCode, async (req: AuthedRequest, res) => {
  const moi = await prisma.user.findUnique({ where: { id: req.user!.id } });
  if (!moi?.totpEnabled || !moi.totpSecret) {
    return res.status(409).json({ error: "Ce compte n'a pas de second facteur." });
  }
  const code = String(req.body?.code || "").replace(/\s/g, "");
  if (!verifyTotp(moi.totpSecret, code)) {
    await logEvent("warn", "users", `Code refusé pour lever le verrou (${req.user?.username})`);
    return res.status(401).json({ error: "Code refusé." });
  }
  await prisma.setting.upsert({
    where: { key: CLE_VERROU }, update: { value: false }, create: { key: CLE_VERROU, value: false },
  });
  await logEvent("info", "users", `Création de comptes déverrouillée par ${req.user?.username}`);
  res.json({ verrouille: false });
});

// ── Second facteur, vu du côté administrateur ───────────────────────────────
//
// Un administrateur peut **exiger** un second facteur et **révoquer** ceux qui
// existent. Il ne peut pas en poser un : le secret d'un second facteur vit sur
// l'appareil de son porteur, et deux personnes qui le connaissent, ce n'est
// plus un second facteur, c'est un mot de passe partagé.

router.get("/:id/mfa", async (req, res) => {
  const cible = await prisma.user.findUnique({ where: { id: req.params.id } });
  if (!cible) return res.status(404).json({ error: "Compte introuvable" });
  res.json({
    ...(await moyensDe(cible)),
    listeCles: await clesDe(cible.id),
    // Sans jeton de bot, la fiche n'a aucune raison de proposer Telegram.
    botTelegram: await botTelegramPret(),
  });
});

router.post("/:id/mfa/exiger", async (req: AuthedRequest, res) => {
  const cible = await prisma.user.findUnique({ where: { id: req.params.id } });
  if (!cible) return res.status(404).json({ error: "Compte introuvable" });
  const valeur = req.body?.valeur !== false;
  await exigerA2f(cible.id, valeur);
  await logEvent("info", "mfa",
    `Second facteur ${valeur ? "exigé" : "rendu facultatif"} pour ${cible.username} par ${req.user?.username}`);
  res.json(await moyensDe(cible));
});

router.delete("/:id/mfa", async (req: AuthedRequest, res) => {
  const cible = await prisma.user.findUnique({ where: { id: req.params.id } });
  if (!cible) return res.status(404).json({ error: "Compte introuvable" });

  const n = await supprimerToutesLesCles(cible.id);
  // Le lien Telegram part avec le reste : révoquer « les seconds facteurs » en
  // laissant celui-là debout serait un demi-mensonge.
  await definirChatTelegram(cible.id, null);
  await prisma.user.update({
    where: { id: cible.id },
    // Les sessions tombent : révoquer un facteur sans couper les sessions
    // laisserait ouvert ce qu'on vient de fermer.
    data: { totpEnabled: false, totpSecret: null, tokenVersion: { increment: 1 } },
  });
  await logEvent("warn", "mfa",
    `Seconds facteurs révoqués pour ${cible.username} (${n} clé(s)) par ${req.user?.username}`);
  res.json(await moyensDe({ ...cible, totpEnabled: false }));
});

export default router;
