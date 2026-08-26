// Boîtes mail : catalogue, vérification, et gestion.
//
// Le catalogue vient de `mail-providers.js`, le fichier partagé entre tous les
// projets. Il est chargé tel quel, sans être réécrit en TypeScript : le back et
// le front lisent ainsi rigoureusement la même table.
//
// Le mot de passe ne ressort jamais de l'API : les lectures renvoient
// `hasPassword`, jamais la valeur ni un masque de la bonne longueur.

import { Router } from "express";
import path from "path";
import { prisma } from "../db";
import { encrypt, decrypt } from "../services/crypto";
import { verifierBoite } from "../services/mailbox";
import { authRequired, requireRole } from "../middleware/auth";
import { logEvent } from "../services/logger";

// Chargement du module partagé. Le back est en CommonJS, le wrapper UMD du
// fichier expose donc directement module.exports. Le fichier vit à la racine
// du projet et non dans src/, parce que tsc n'émet que du TypeScript : il ne
// recopierait pas un .js dans dist/.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const MP = require(path.resolve(process.cwd(), "mail-providers.js"));

const router = Router();
router.use(authRequired);

/** Forme publique : tout sauf le secret. */
function publique(m: any) {
  return {
    id: m.id,
    email: m.email,
    provider: m.provider,
    role: m.role,
    imap: m.imapHost ? { host: m.imapHost, port: m.imapPort, security: m.imapSecurity } : null,
    smtp: m.smtpHost ? { host: m.smtpHost, port: m.smtpPort, security: m.smtpSecurity } : null,
    active: m.active,
    hasPassword: !!m.passwordEnc,
    lastTestAt: m.lastTestAt,
    lastTestOk: m.lastTestOk,
    lastTestInfo: m.lastTestInfo,
  };
}

// ── Catalogue ───────────────────────────────────────────────────────────────
router.get("/providers", (_req, res) => {
  res.json(MP.list());
});

// Réglages déduits d'un fournisseur et d'une adresse. `needs` dit ce qui
// manque encore — le numéro de serveur chez OVH Pro, par exemple.
router.post("/resolve", (req, res) => {
  const { provider, email, n } = req.body || {};
  const out = MP.resolve(String(provider || ""), String(email || ""), { n });
  if (!out) return res.status(400).json({ error: "Fournisseur inconnu" });
  res.json(out);
});

router.post("/detect", (req, res) => {
  res.json({ provider: MP.detect(String(req.body?.email || "")) });
});

// ── Vérification ────────────────────────────────────────────────────────────
// Reçoit la configuration complète avec le mot de passe, ouvre les connexions,
// ne garde rien. Si le mot de passe est absent mais que la boîte existe déjà,
// on réutilise celui qui est en base — c'est le cas « je teste sans retaper ».
router.post("/verify", requireRole("admin"), async (req, res) => {
  const cfg = req.body || {};

  const verdict = MP.validate({
    email: cfg.email, role: cfg.role, imap: cfg.imap, smtp: cfg.smtp,
  });
  if (!verdict.ok) {
    return res.status(400).json({ ok: false, error: verdict.errors[0], details: verdict.errors });
  }

  let motDePasse = String(cfg.password || "");
  if (!motDePasse && cfg.email) {
    const exist = await prisma.mailbox.findUnique({ where: { email: String(cfg.email) } });
    if (exist?.passwordEnc) {
      try { motDePasse = decrypt(exist.passwordEnc); } catch { /* clé changée */ }
    }
  }
  if (!motDePasse) {
    return res.status(400).json({ ok: false, error: "Mot de passe manquant." });
  }

  const r = await verifierBoite({
    email: String(cfg.email),
    password: motDePasse,
    role: cfg.role || "both",
    imap: cfg.imap,
    smtp: cfg.smtp,
  });

  // On garde la trace du dernier test si la boîte est déjà enregistrée.
  await prisma.mailbox.updateMany({
    where: { email: String(cfg.email) },
    data: { lastTestAt: new Date(), lastTestOk: r.ok, lastTestInfo: r.ok ? r.inbox : r.error },
  }).catch(() => {});

  res.status(r.ok ? 200 : 502).json(r);
});

// ── Gestion ─────────────────────────────────────────────────────────────────
router.get("/mailboxes", async (_req, res) => {
  const rows = await prisma.mailbox.findMany({ orderBy: { createdAt: "asc" } });
  res.json(rows.map(publique));
});

router.post("/mailboxes", requireRole("admin"), async (req, res) => {
  const cfg = req.body || {};

  const verdict = MP.validate({
    email: cfg.email, role: cfg.role, imap: cfg.imap, smtp: cfg.smtp,
  });
  if (!verdict.ok) return res.status(400).json({ error: verdict.errors[0], details: verdict.errors });

  const email = String(cfg.email).trim().toLowerCase();
  const exist = await prisma.mailbox.findUnique({ where: { email } });

  // Champ vide en modification = on conserve le secret enregistré.
  const passwordEnc = cfg.password
    ? encrypt(String(cfg.password))
    : exist?.passwordEnc ?? null;
  if (!passwordEnc) return res.status(400).json({ error: "Mot de passe manquant." });

  const data: any = {
    email,
    provider: String(cfg.provider || "other"),
    role: String(cfg.role || "both"),
    imapHost: cfg.imap?.host || null,
    imapPort: cfg.imap?.port ? Number(cfg.imap.port) : null,
    imapSecurity: cfg.imap?.security || null,
    smtpHost: cfg.smtp?.host || null,
    smtpPort: cfg.smtp?.port ? Number(cfg.smtp.port) : null,
    smtpSecurity: cfg.smtp?.security || null,
    passwordEnc,
    active: cfg.active !== false,
  };

  const row = exist
    ? await prisma.mailbox.update({ where: { email }, data })
    : await prisma.mailbox.create({ data });

  await logEvent("info", "mail", `Boîte ${exist ? "modifiée" : "ajoutée"} : ${email}`);
  res.json(publique(row));
});

router.delete("/mailboxes/:id", requireRole("admin"), async (req, res) => {
  const row = await prisma.mailbox.findUnique({ where: { id: req.params.id } });
  if (!row) return res.status(404).json({ error: "Boîte introuvable" });
  await prisma.mailbox.delete({ where: { id: req.params.id } });
  await logEvent("warn", "mail", `Boîte supprimée : ${row.email}`);
  res.json({ ok: true });
});

export default router;
