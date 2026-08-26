// Inscription et usage du second facteur.
//
// Deux temps bien séparés :
//
//   inscription — un compte, connecté, ajoute une clé d'accès à son trousseau.
//                 Toujours pour lui-même : personne ne s'inscrit à la place
//                 d'un autre, sinon le secret est connu de deux personnes et
//                 ce n'est plus un second facteur ;
//   connexion   — après le mot de passe, l'étape suivante. Voir routes/auth.ts.

import { Router } from "express";
import {
  generateRegistrationOptions, verifyRegistrationResponse,
} from "@simplewebauthn/server";
import { prisma } from "../db";
import { authRequired, AuthedRequest } from "../middleware/auth";
import { logEvent } from "../services/logger";
import {
  clesDe, clesCompletes, enregistrerCle, supprimerCle, moyensDe, origineDe,
  botTelegramPret, definirChatTelegram, envoyerCodeTelegram, verifierCodeTelegram,
} from "../services/mfa";

const router = Router();
router.use(authRequired);

// Les défis d'inscription vivent en mémoire, deux minutes. Les écrire en base
// pour une valeur qui expire avant le prochain balayage n'apporterait rien.
const defis = new Map<string, { defi: string; expire: number }>();
setInterval(() => {
  const t = Date.now();
  for (const [k, v] of defis) if (v.expire < t) defis.delete(k);
}, 60_000).unref?.();

/** Ce que le compte connecté possède comme seconds facteurs. */
router.get("/etat", async (req: AuthedRequest, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
  if (!user) return res.status(401).json({ error: "Session expirée." });
  res.json({
    ...(await moyensDe(user)),
    listeCles: await clesDe(user.id),
    // Sans jeton de bot, l'écran n'a aucune raison de proposer Telegram.
    botTelegram: await botTelegramPret(),
  });
});

// ── Inscription d'une clé d'accès ───────────────────────────────────────────

router.post("/passkey/options", async (req: AuthedRequest, res) => {
  const lieu = origineDe(req);
  if (!lieu) {
    return res.status(400).json({
      error: "Les clés d'accès exigent une origine sûre : ouvre MapMyLAN en HTTPS, ou en local.",
    });
  }
  const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
  if (!user) return res.status(401).json({ error: "Session expirée." });

  const dejaLa = await clesCompletes(user.id);
  const options = await generateRegistrationOptions({
    rpName: "MapMyLAN",
    rpID: lieu.rpID,
    userName: user.username,
    userDisplayName: user.username,
    attestationType: "none",
    // On ne propose pas d'inscrire deux fois la même clé.
    excludeCredentials: dejaLa.map((c: any) => ({ id: c.credentialId })),
    authenticatorSelection: {
      residentKey: "preferred",
      userVerification: "preferred",
    },
  });
  defis.set(user.id, { defi: options.challenge, expire: Date.now() + 120_000 });
  res.json(options);
});

router.post("/passkey", async (req: AuthedRequest, res) => {
  const lieu = origineDe(req);
  if (!lieu) return res.status(400).json({ error: "Origine non sûre." });
  const attendu = defis.get(req.user!.id);
  if (!attendu || attendu.expire < Date.now()) {
    return res.status(408).json({ error: "Délai dépassé, recommence." });
  }

  try {
    const v = await verifyRegistrationResponse({
      response: req.body?.reponse,
      expectedChallenge: attendu.defi,
      expectedOrigin: lieu.origin,
      expectedRPID: lieu.rpID,
      requireUserVerification: false,
    });
    if (!v.verified || !v.registrationInfo) {
      return res.status(400).json({ error: "Clé refusée." });
    }
    const c = v.registrationInfo.credential;
    await enregistrerCle(
      req.user!.id,
      c.id,
      Buffer.from(c.publicKey).toString("base64"),
      c.counter,
      c.transports || [],
      String(req.body?.label || "").trim() || "Clé d'accès",
    );
    defis.delete(req.user!.id);
    await logEvent("info", "mfa", `Clé d'accès ajoutée par ${req.user?.username}`);
    res.json({ ok: true, listeCles: await clesDe(req.user!.id) });
  } catch (e: any) {
    res.status(400).json({ error: e?.message || "Clé refusée." });
  }
});

router.delete("/passkey/:id", async (req: AuthedRequest, res) => {
  const n = await supprimerCle(req.user!.id, req.params.id);
  if (n) await logEvent("warn", "mfa", `Clé d'accès retirée par ${req.user?.username}`);
  res.json({ ok: true, listeCles: await clesDe(req.user!.id) });
});

// ── Telegram ────────────────────────────────────────────────────────────────
//
// Deux temps, et le second prouve le premier : on envoie un code au chat
// annoncé, et on n'enregistre l'identifiant que si le code revient. Sans cette
// preuve, taper l'identifiant d'un tiers suffirait à lui faire recevoir ses
// codes de connexion — ce qui est exactement l'inverse du but.

const CLE_LIEN = (id: string) => `lien:${id}`;

router.post("/telegram/code", async (req: AuthedRequest, res) => {
  const chat = String(req.body?.chatId || "").trim();
  // Un identifiant de discussion Telegram est un entier, négatif pour les
  // groupes. Tout le reste est une faute de frappe, pas une cible.
  if (!/^-?\d{5,20}$/.test(chat)) {
    return res.status(400).json({ error: "Identifiant de discussion invalide : c'est un nombre." });
  }
  const r = await envoyerCodeTelegram(
    CLE_LIEN(req.user!.id), chat,
    `Confirmation de ce compte comme second facteur de « ${req.user!.username} ».`,
  );
  if (!r.ok) return res.status(r.attendre ? 429 : 400).json({ error: r.error });
  res.json({ ok: true });
});

router.post("/telegram", async (req: AuthedRequest, res) => {
  const v = verifierCodeTelegram(CLE_LIEN(req.user!.id), String(req.body?.code || ""));
  if (v.etat === "expire") return res.status(408).json({ error: "Code expiré. Redemandes-en un." });
  if (v.etat === "epuise") return res.status(429).json({ error: "Trop d'essais. Redemande un code." });
  if (v.etat !== "ok" || !v.chat) return res.status(401).json({ error: "Code refusé." });

  await definirChatTelegram(req.user!.id, v.chat);
  await logEvent("info", "mfa", `Second facteur Telegram lié par ${req.user?.username}`);
  const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
  res.json({ ok: true, ...(await moyensDe(user!)) });
});

router.delete("/telegram", async (req: AuthedRequest, res) => {
  await definirChatTelegram(req.user!.id, null);
  await logEvent("warn", "mfa", `Second facteur Telegram retiré par ${req.user?.username}`);
  const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
  res.json({ ok: true, ...(await moyensDe(user!)) });
});

export default router;
