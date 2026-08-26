import { Router } from "express";
import jwt from "jsonwebtoken";
import crypto from "node:crypto";
import { z } from "zod";
import { prisma } from "../db";
import { hacher as hacherMotDePasse, verifier as verifierMotDePasse } from "../services/password";
import { config } from "../config";
import { logEvent } from "../services/logger";
import { authRequired } from "../middleware/auth";
import { sendTelegram, getConfig } from "../services/notifier";
import { generateSecret, verifyTotp, otpauthUri, numericCode } from "../services/totp";
import {
  generateAuthenticationOptions, verifyAuthenticationResponse,
} from "@simplewebauthn/server";
import {
  moyensDe, clesCompletes, cleParIdentifiant, majCompteur, origineDe, a2fExigee,
  chatTelegramDe, envoyerCodeTelegram, verifierCodeTelegram,
} from "../services/mfa";

const router = Router();


// ── Premier lancement ──────────────────────────────────────────────────────
// Tant qu'aucun compte n'existe, l'application propose de créer le sien depuis
// l'interface plutôt que d'imposer des identifiants venus du fichier .env.
// L'endpoint se referme dès qu'un compte existe : impossible de s'en servir
// pour ajouter un administrateur en douce sur une instance déjà installée.

router.get("/needs-setup", async (_req, res) => {
  const count = await prisma.user.count();
  res.json({ needsSetup: count === 0 });
});

router.post("/bootstrap", async (req, res) => {
  const count = await prisma.user.count();
  if (count > 0) return res.status(409).json({ error: "Un compte existe déjà" });

  const { username, password } = req.body || {};
  if (!username || String(username).trim().length < 3) {
    return res.status(400).json({ error: "L'identifiant doit faire au moins 3 caractères" });
  }
  if (!password || String(password).length < 8) {
    return res.status(400).json({ error: "Le mot de passe doit faire au moins 8 caractères" });
  }

  const hash = await hacherMotDePasse(String(password));
  const user = await prisma.user.create({
    data: { username: String(username).trim(), password: hash, role: "admin" },
  });

  const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, config.jwtSecret, { expiresIn: "7d" });
  const setup = await prisma.setting.findUnique({ where: { key: "setup.complete" } });

  res.json({
    token,
    user: {
      id: user.id, username: user.username, role: user.role,
      mustChangePassword: user.mustChangePassword,
    },
    setupComplete: setup?.value === true,
  });
});


// ── Second facteur : enrôlement ────────────────────────────────────────────
// L'utilisateur connecté demande un secret, le scanne dans son application,
// puis confirme avec un premier code. Tant que la confirmation n'a pas eu
// lieu, le second facteur reste inactif : on ne veut pas enfermer quelqu'un
// dehors à cause d'un QR mal scanné.

router.post("/totp/setup", authRequired, async (req: any, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.user.id } });
  if (!user) return res.status(404).json({ error: "Compte introuvable" });
  if (user.totpEnabled) return res.status(409).json({ error: "Le second facteur est déjà actif" });

  const secret = generateSecret();
  await prisma.user.update({ where: { id: user.id }, data: { totpSecret: secret } });

  res.json({ secret, uri: otpauthUri(secret, user.username) });
});

router.post("/totp/enable", authRequired, async (req: any, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.user.id } });
  if (!user?.totpSecret) return res.status(400).json({ error: "Commencez par générer un secret" });
  if (!verifyTotp(user.totpSecret, req.body?.code)) {
    return res.status(401).json({ error: "Code incorrect" });
  }
  await prisma.user.update({ where: { id: user.id }, data: { totpEnabled: true } });
  await logEvent("info", "auth", `Second facteur activé pour ${user.username}`);
  res.json({ ok: true });
});

router.post("/totp/disable", authRequired, async (req: any, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.user.id } });
  if (!user) return res.status(404).json({ error: "Compte introuvable" });
  // Désactiver exige le mot de passe ET un code valide : c'est une opération
  // qui affaiblit le compte, elle mérite les deux preuves.
  const okPass = (await verifierMotDePasse(String(req.body?.password || ""), user.password)).ok;
  if (!okPass) return res.status(401).json({ error: "Mot de passe incorrect" });
  if (!user.totpSecret || !verifyTotp(user.totpSecret, req.body?.code)) {
    return res.status(401).json({ error: "Code incorrect" });
  }
  await prisma.user.update({
    where: { id: user.id },
    data: { totpEnabled: false, totpSecret: null },
  });
  await logEvent("warn", "auth", `Second facteur désactivé pour ${user.username}`);
  res.json({ ok: true });
});

router.get("/totp/status", authRequired, async (req: any, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.user.id } });
  const tg = await getConfig("telegram");
  res.json({
    totpEnabled: !!user?.totpEnabled,
    // `getConfig` ne rend rien quand le canal est coupé : avoir un jeton et un
    // salon suffit à conclure. Tester `tg.enabled` ici revenait à interroger un
    // champ absent du blob chiffré, donc à répondre « pas prêt » quoi qu'il en
    // soit.
    telegramReady: !!(tg?.token && tg?.chatId),
  });
});

// ── Réinitialisation du mot de passe ───────────────────────────────────────
// Deux facteurs indépendants sont exigés : le code de l'application mobile et
// un code envoyé sur Telegram. Perdre l'un des deux suffit à bloquer la
// procédure — c'est le prix de la sécurité, et le .env reste la sortie de
// secours en cas de perte des deux.

const RESET_TTL_MIN = 10;
const MAX_ATTEMPTS = 5;

router.post("/reset/start", async (req, res) => {
  const username = String(req.body?.username || "").trim();

  // Réponse volontairement identique que le compte existe ou non : on ne
  // renseigne pas un attaquant sur les identifiants valides.
  const generic = { ok: true, ttlMinutes: RESET_TTL_MIN };

  const user = await prisma.user.findUnique({ where: { username } });
  if (!user || !user.totpEnabled || !user.totpSecret) return res.json(generic);

  const tg = await getConfig("telegram");
  // Même correction qu'au-dessus, et c'est celle qui faisait mal : la demande
  // partait, la réponse disait « c'est bon », et aucun code n'était jamais
  // envoyé. L'écran attendait un code qui ne pouvait pas venir.
  if (!tg?.token || !tg?.chatId) return res.json(generic);

  // On périme les demandes précédentes du même compte.
  await prisma.passwordReset.updateMany({
    where: { userId: user.id, consumed: false },
    data: { consumed: true },
  });

  const code = numericCode(6);
  const reset = await prisma.passwordReset.create({
    data: {
      userId: user.id,
      telegramCode: code,
      expiresAt: new Date(Date.now() + RESET_TTL_MIN * 60_000),
    },
  });

  const sent = await sendTelegram(
    `🔐 MapMyLAN — réinitialisation du mot de passe\n\n` +
    `Code de confirmation : ${code}\n` +
    `Valable ${RESET_TTL_MIN} minutes.\n\n` +
    `Si vous n'êtes pas à l'origine de cette demande, ignorez ce message ` +
    `et changez votre mot de passe.`,
  );
  await prisma.passwordReset.update({
    where: { id: reset.id },
    data: { telegramSent: sent.ok },
  });

  await logEvent("warn", "auth", `Réinitialisation demandée pour ${user.username}`);
  res.json({ ...generic, challengeId: reset.id });
});

router.post("/reset/verify", async (req, res) => {
  const { challengeId, totpCode, telegramCode } = req.body || {};
  if (!challengeId) return res.status(400).json({ error: "Demande introuvable" });

  const reset = await prisma.passwordReset.findUnique({ where: { id: String(challengeId) } });
  if (!reset || reset.consumed) return res.status(400).json({ error: "Demande introuvable ou déjà utilisée" });
  if (reset.expiresAt < new Date()) return res.status(400).json({ error: "Demande expirée" });
  if (reset.attempts >= MAX_ATTEMPTS) {
    await prisma.passwordReset.update({ where: { id: reset.id }, data: { consumed: true } });
    return res.status(429).json({ error: "Trop d'essais, demande annulée" });
  }

  await prisma.passwordReset.update({
    where: { id: reset.id },
    data: { attempts: { increment: 1 } },
  });

  const user = await prisma.user.findUnique({ where: { id: reset.userId } });
  if (!user?.totpSecret) return res.status(400).json({ error: "Second facteur absent" });

  const okApp = verifyTotp(user.totpSecret, String(totpCode || ""));
  const okTg = String(telegramCode || "").replace(/\D/g, "") === reset.telegramCode;

  // On ne dit pas lequel des deux est faux : ça éviterait à un attaquant de
  // n'avoir qu'un seul facteur à deviner.
  if (!okApp || !okTg) {
    return res.status(401).json({
      error: "Codes incorrects",
      remaining: Math.max(0, MAX_ATTEMPTS - reset.attempts - 1),
    });
  }

  const resetToken = jwt.sign(
    { purpose: "password-reset", resetId: reset.id, userId: user.id },
    config.jwtSecret,
    { expiresIn: "10m" },
  );
  res.json({ resetToken });
});

router.post("/reset/complete", async (req, res) => {
  const { resetToken, password } = req.body || {};
  if (!password || String(password).length < 8) {
    return res.status(400).json({ error: "Le mot de passe doit faire au moins 8 caractères" });
  }

  let payload: any;
  try { payload = jwt.verify(String(resetToken || ""), config.jwtSecret); }
  catch { return res.status(401).json({ error: "Jeton invalide ou expiré" }); }
  if (payload?.purpose !== "password-reset") {
    return res.status(401).json({ error: "Jeton invalide" });
  }

  const reset = await prisma.passwordReset.findUnique({ where: { id: payload.resetId } });
  if (!reset || reset.consumed || reset.expiresAt < new Date()) {
    return res.status(400).json({ error: "Demande expirée ou déjà utilisée" });
  }

  const hash = await hacherMotDePasse(String(password));
  await prisma.user.update({ where: { id: payload.userId }, data: { password: hash } });
  await prisma.passwordReset.update({ where: { id: reset.id }, data: { consumed: true } });

  const user = await prisma.user.findUnique({ where: { id: payload.userId } });
  await logEvent("warn", "auth", `Mot de passe réinitialisé pour ${user?.username}`);
  await sendTelegram(
    `✅ MapMyLAN — le mot de passe de « ${user?.username} » vient d'être modifié.\n` +
    `Si ce n'est pas vous, reprenez la main immédiatement.`,
  ).catch(() => {});

  res.json({ ok: true });
});

// Défis de seconde étape, en mémoire, cinq minutes. Un défi n'est pas un
// jeton de session : il porte `typ: "sfa"` et `middleware/auth` le refuse.
const secondsFacteurs = new Map<string,
  { userId: string; defi?: string; expire: number; envois?: number }>();
setInterval(() => {
  const t = Date.now();
  for (const [k, v] of secondsFacteurs) if (v.expire < t) secondsFacteurs.delete(k);
}, 60_000).unref?.();

function jetonDeSession(user: any): string {
  return jwt.sign(
    { id: user.id, username: user.username, role: user.role, tv: user.tokenVersion || 0 },
    config.jwtSecret, { expiresIn: "12h" });
}

async function reponseDeConnexion(user: any, res: any) {
  const setup = await prisma.setting.findUnique({ where: { key: "setup.complete" } });
  const exigee = await a2fExigee(user.id);
  const m = await moyensDe(user);
  res.json({
    token: jetonDeSession(user),
    user: {
      id: user.id, username: user.username, role: user.role,
      mustChangePassword: user.mustChangePassword,
      // Exigée mais rien d'inscrit : on laisse entrer et on réclame ensuite.
      // Bloquer ici enfermerait dehors quelqu'un qui n'a encore rien posé.
      doitInscrireA2f: exigee && m.moyens.length === 0,
    },
    setupComplete: setup?.value === true,
  });
}

router.post("/login", async (req, res) => {
  const schema = z.object({ username: z.string().min(1), password: z.string().min(1) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid input" });
  const { username, password } = parsed.data;
  const user = await prisma.user.findUnique({ where: { username } });

  // Compte verrouillé : on ne vérifie même pas le mot de passe.
  if (user?.lockedUntil && user.lockedUntil > new Date()) {
    const reste = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 1000);
    await logEvent("warn", "auth", `Connexion refusée, compte verrouillé : ${username}`);
    return res.status(423).json({ error: `Compte temporairement verrouillé. Réessayez dans ${reste} s.` });
  }

  // La vérification prend un temps comparable que le compte existe ou non :
  // sans cela, on distingue « identifiant inconnu » de « mot de passe faux »
  // au chronomètre, et on énumère les comptes.
  const v = await verifierMotDePasse(password, user?.password);

  if (!user || !v.ok) {
    if (user) {
      // Le verrouillage s'allonge à chaque série : cinq échecs bloquent une
      // minute, dix en bloquent quinze. Se tromper deux fois ne gêne personne ;
      // un automate est arrêté.
      const echecs = (user.failedLogins || 0) + 1;
      const duree = echecs >= 10 ? 15 * 60 : echecs >= 5 ? 60 : 0;
      await prisma.user.update({
        where: { id: user.id },
        data: { failedLogins: echecs, lockedUntil: duree ? new Date(Date.now() + duree * 1000) : null },
      });
      if (duree) await logEvent("warn", "auth", `Compte verrouillé après ${echecs} échecs : ${username}`);
    }
    return res.status(401).json({ error: "Invalid credentials" });
  }

  // Empreinte bcrypt héritée : on la réécrit en Argon2id au passage, sans
  // rien demander à l'utilisateur.
  const maj: any = { lastLogin: new Date(), failedLogins: 0, lockedUntil: null };
  if (v.aMettreAJour && v.nouvelleEmpreinte) maj.password = v.nouvelleEmpreinte;
  await prisma.user.update({ where: { id: user.id }, data: maj });

  // Second facteur : la connexion s'arrête ici si le compte en a inscrit un.
  //
  // Avant, « Double authentification : Active » ne gardait que la
  // réinitialisation du mot de passe — la connexion, elle, ne demandait jamais
  // rien de plus. L'étiquette promettait davantage que ce que le produit
  // faisait.
  const m = await moyensDe(user);
  if (m.moyens.length > 0) {
    const defi = crypto.randomUUID();
    secondsFacteurs.set(defi, { userId: user.id, expire: Date.now() + 5 * 60_000 });
    await logEvent("info", "auth", `Mot de passe accepté, second facteur demandé : ${username}`);
    return res.json({ etape: "second-facteur", defi, moyens: m.moyens });
  }

  await logEvent("info", "auth", `Login: ${username}`);
  await reponseDeConnexion(user, res);
});

// ── Seconde étape ───────────────────────────────────────────────────────────
//
// Le défi est à usage unique : accepté ou refusé, il disparaît. Sans cela, une
// réponse interceptée serait rejouable tant que le défi vit.

async function compteDuDefi(defi: string) {
  const d = secondsFacteurs.get(String(defi || ""));
  if (!d || d.expire < Date.now()) return null;
  return prisma.user.findUnique({ where: { id: d.userId } });
}

router.post("/2fa/application", async (req, res) => {
  const { defi, code } = req.body || {};
  const user = await compteDuDefi(defi);
  if (!user) return res.status(408).json({ error: "Délai dépassé. Reprends la connexion." });
  if (!user.totpSecret || !verifyTotp(user.totpSecret, String(code || "").replace(/\s/g, ""))) {
    await logEvent("warn", "auth", `Second facteur refusé (application) : ${user.username}`);
    return res.status(401).json({ error: "Code refusé." });
  }
  secondsFacteurs.delete(defi);
  await prisma.user.update({ where: { id: user.id }, data: { lastLogin: new Date() } });
  await logEvent("info", "auth", `Login (application) : ${user.username}`);
  await reponseDeConnexion(user, res);
});

// ── Second facteur par Telegram ─────────────────────────────────────────────
//
// Le code part vers la discussion enregistrée par le compte lui-même, jamais
// vers une adresse fournie dans la requête : celui qui tient un mot de passe
// volé ne doit pas pouvoir se faire livrer le second facteur.
//
// Deux bornes, et elles comptent : cinq codes faux brûlent le défi, et un même
// défi ne donne droit qu'à trois envois. Sans elles, six chiffres se devinent
// à force de recommencer.

const ENVOIS_MAX = 3;

router.post("/2fa/telegram/envoyer", async (req, res) => {
  const cle = String(req.body?.defi || "");
  const d = secondsFacteurs.get(cle);
  const user = await compteDuDefi(cle);
  if (!d || !user) return res.status(408).json({ error: "Délai dépassé. Reprends la connexion." });

  if ((d.envois || 0) >= ENVOIS_MAX) {
    secondsFacteurs.delete(cle);
    await logEvent("warn", "auth", `Trop de codes Telegram demandés : ${user.username}`);
    return res.status(429).json({ error: "Trop de codes demandés. Reprends la connexion." });
  }

  const chat = await chatTelegramDe(user.id);
  if (!chat) return res.status(400).json({ error: "Aucune discussion Telegram liée à ce compte." });

  const r = await envoyerCodeTelegram(
    cle, chat, `Connexion demandée pour « ${user.username} ».`);
  if (!r.ok) return res.status(r.attendre ? 429 : 502).json({ error: r.error });

  d.envois = (d.envois || 0) + 1;
  await logEvent("info", "auth", `Code Telegram envoyé pour ${user.username}`);
  res.json({ ok: true });
});

router.post("/2fa/telegram", async (req, res) => {
  const cle = String(req.body?.defi || "");
  const user = await compteDuDefi(cle);
  if (!user) return res.status(408).json({ error: "Délai dépassé. Reprends la connexion." });

  const v = verifierCodeTelegram(cle, String(req.body?.code || ""));
  if (v.etat === "epuise") {
    // Le défi part avec le code : recommencer doit repasser par le mot de passe.
    secondsFacteurs.delete(cle);
    await logEvent("warn", "auth", `Second facteur Telegram épuisé : ${user.username}`);
    return res.status(429).json({ error: "Trop d'essais. Reprends la connexion." });
  }
  if (v.etat === "expire") return res.status(408).json({ error: "Code expiré. Redemandes-en un." });
  if (v.etat !== "ok") {
    await logEvent("warn", "auth", `Second facteur refusé (telegram) : ${user.username}`);
    return res.status(401).json({ error: "Code refusé." });
  }

  secondsFacteurs.delete(cle);
  await prisma.user.update({ where: { id: user.id }, data: { lastLogin: new Date() } });
  await logEvent("info", "auth", `Login (telegram) : ${user.username}`);
  await reponseDeConnexion(user, res);
});

router.post("/2fa/trousseau/options", async (req, res) => {
  const lieu = origineDe(req);
  if (!lieu) return res.status(400).json({ error: "Origine non sûre." });
  const d = secondsFacteurs.get(String(req.body?.defi || ""));
  const user = await compteDuDefi(req.body?.defi);
  if (!d || !user) return res.status(408).json({ error: "Délai dépassé. Reprends la connexion." });

  const cles = await clesCompletes(user.id);
  const options = await generateAuthenticationOptions({
    rpID: lieu.rpID,
    allowCredentials: cles.map((c: any) => ({ id: c.credentialId })),
    userVerification: "preferred",
  });
  d.defi = options.challenge;
  res.json(options);
});

router.post("/2fa/trousseau", async (req, res) => {
  const lieu = origineDe(req);
  if (!lieu) return res.status(400).json({ error: "Origine non sûre." });
  const cle = String(req.body?.defi || "");
  const d = secondsFacteurs.get(cle);
  const user = await compteDuDefi(cle);
  if (!d || !user || !d.defi) return res.status(408).json({ error: "Délai dépassé. Reprends la connexion." });

  try {
    const reponse = req.body?.reponse;
    const enregistree = await cleParIdentifiant(String(reponse?.id || ""));
    if (!enregistree || enregistree.userId !== user.id) {
      return res.status(401).json({ error: "Clé inconnue pour ce compte." });
    }
    const v = await verifyAuthenticationResponse({
      response: reponse,
      expectedChallenge: d.defi,
      expectedOrigin: lieu.origin,
      expectedRPID: lieu.rpID,
      requireUserVerification: false,
      credential: {
        id: enregistree.credentialId,
        publicKey: new Uint8Array(Buffer.from(enregistree.publicKey, "base64")),
        counter: Number(enregistree.counter) || 0,
        transports: enregistree.transports
          ? (String(enregistree.transports).split(",").filter(Boolean) as any)
          : undefined,
      },
    });
    if (!v.verified) {
      await logEvent("warn", "auth", `Second facteur refusé (trousseau) : ${user.username}`);
      return res.status(401).json({ error: "Clé refusée." });
    }
    secondsFacteurs.delete(cle);
    await majCompteur(enregistree.credentialId, v.authenticationInfo.newCounter);
    await prisma.user.update({ where: { id: user.id }, data: { lastLogin: new Date() } });
    await logEvent("info", "auth", `Login (trousseau) : ${user.username}`);
    await reponseDeConnexion(user, res);
  } catch (e: any) {
    res.status(401).json({ error: e?.message || "Clé refusée." });
  }
});

// Qui suis-je ?
//
// Au rechargement de la page, l'interface n'avait que le jeton et se
// contentait d'un utilisateur factice — sans identifiant, sans rôle, sans
// l'indicateur de mot de passe à changer. Résultat : le changement imposé
// sautait dès qu'on rafraîchissait, et l'interface ne savait plus quel compte
// était le sien.
router.get("/me", authRequired, async (req: any, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.user.id } });
  if (!user) return res.status(401).json({ error: "Session expirée." });
  res.json({
    id: user.id,
    username: user.username,
    role: user.role,
    mustChangePassword: user.mustChangePassword,
    totpEnabled: user.totpEnabled,
  });
});

// Changement de mot de passe.
//
// L'endpoint exige désormais un jeton valide et travaille sur le compte qui le
// porte : sans cela, n'importe qui pouvait éprouver des couples identifiant /
// mot de passe sans être authentifié, ce qui en faisait un oracle de devinette.
// L'identifiant n'est plus accepté depuis le corps de la requête.
router.post("/change-password", authRequired, async (req: any, res) => {
  const schema = z.object({ oldPassword: z.string(), newPassword: z.string().min(8) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Le nouveau mot de passe doit faire au moins 8 caractères." });
  }
  const { oldPassword, newPassword } = parsed.data;

  const user = await prisma.user.findUnique({ where: { id: req.user.id } });
  if (!user || !((await verifierMotDePasse(oldPassword, user.password)).ok)) {
    return res.status(401).json({ error: "Mot de passe actuel incorrect." });
  }
  if (oldPassword === newPassword) {
    return res.status(400).json({ error: "Le nouveau mot de passe doit être différent de l'ancien." });
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { password: await hacherMotDePasse(newPassword), mustChangePassword: false },
  });
  await logEvent("info", "auth", `Mot de passe changé : ${user.username}`);
  res.json({ ok: true });
});

export default router;
