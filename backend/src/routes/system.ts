import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { config } from "../config";
import { setConfig, sendTelegram, sendEmail, sendSMS, startTelegramBot } from "../services/notifier";
import { authRequired, requireRole } from "../middleware/auth";
import { testerPoste } from "../services/poste";

const router = Router();
router.use(authRequired);

// ── Poste : essai de la liaison ──
// Renvoie la reponse brute du relais, sans reformulation, pour diagnostic.
router.post("/poste/test", requireRole("admin"), async (_req, res) => {
  const r = await testerPoste();
  res.status(r.ok ? 200 : 502).json(r);
});

// ── Notifications ──
router.get("/notifications", async (_req, res) => {
  res.json(await prisma.notificationConfig.findMany({
    select: { channel: true, enabled: true, lastTested: true, lastSuccess: true },
  }));
});

router.put("/notifications/:channel", requireRole("admin"), async (req, res) => {
  const schema = z.object({ enabled: z.boolean(), config: z.record(z.string(), z.any()).optional() });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.errors });
  await setConfig(req.params.channel, parsed.data.enabled, parsed.data.config);
  if (req.params.channel === "telegram" && parsed.data.enabled) startTelegramBot().catch(() => {});
  res.json({ ok: true });
});

router.post("/notifications/:channel/test", requireRole("admin"), async (req, res) => {
  const cfg = req.body?.config;
  const channel = req.params.channel;
  let result;
  if (channel === "telegram") result = await sendTelegram("MapMyLAN test message — if you see this, it works.", cfg);
  else if (channel === "email") result = await sendEmail({ subject: "MapMyLAN test", title: "Test message", severity: "info", body: "If you received this email, your SMTP setup works." }, cfg);
  else if (channel === "sms") result = await sendSMS("MapMyLAN: test message", cfg);
  else return res.status(400).json({ error: "Unknown channel" });
  res.json(result);
});

router.delete("/notifications/:channel", requireRole("admin"), async (req, res) => {
  await prisma.notificationConfig.deleteMany({ where: { channel: req.params.channel } });
  res.json({ ok: true });
});

// ── Alerts ──
router.get("/alerts", async (req, res) => {
  const limit = parseInt(String(req.query.limit || "50"));
  res.json(await prisma.alert.findMany({ orderBy: { createdAt: "desc" }, take: limit }));
});

router.post("/alerts/:id/ack", async (req, res) => {
  await prisma.alert.update({ where: { id: req.params.id }, data: { acknowledged: true } });
  res.json({ ok: true });
});

// ── Logs ──
router.get("/logs", async (req, res) => {
  const level = req.query.level as string | undefined;
  const limit = parseInt(String(req.query.limit || "200"));
  res.json(await prisma.logEntry.findMany({ where: level ? { level } : undefined, orderBy: { createdAt: "desc" }, take: limit }));
});

// ── Settings ──
router.get("/settings", async (_req, res) => {
  const settings = await prisma.setting.findMany();
  const out: Record<string, any> = {};
  for (const s of settings) out[s.key] = s.value;
  res.json(out);
});

router.put("/settings/:key", requireRole("admin"), async (req, res) => {
  await prisma.setting.upsert({
    where: { key: req.params.key },
    update: { value: req.body.value },
    create: { key: req.params.key, value: req.body.value },
  });
  res.json({ ok: true });
});

// ── Setup status & completion ──
router.get("/setup/status", async (_req, res) => {
  const setup = await prisma.setting.findUnique({ where: { key: "setup.complete" } });
  const mainRouter = await prisma.sshDevice.findFirst({ where: { isMainRouter: true }, select: { id: true, host: true, name: true, vendor: true } });
  res.json({ complete: setup?.value === true, mainRouter });
});

router.post("/setup/complete", requireRole("admin"), async (_req, res) => {
  await prisma.setting.upsert({
    where: { key: "setup.complete" },
    update: { value: true },
    create: { key: "setup.complete", value: true },
  });
  res.json({ ok: true });
});

// ── Dashboard stats ──
router.get("/stats", async (_req, res) => {
  const [total, online, offline, suspect, banned, quarantined, vlans, alerts] = await Promise.all([
    prisma.device.count(),
    prisma.device.count({ where: { status: "online" } }),
    prisma.device.count({ where: { status: "offline" } }),
    prisma.device.count({ where: { status: "suspect" } }),
    prisma.device.count({ where: { status: "banned" } }),
    prisma.device.count({ where: { status: "quarantined" } }),
    prisma.vlan.count(),
    prisma.alert.count({ where: { acknowledged: false } }),
  ]);
  // Alimentent le dock et la barre d'état de la disposition atelier.
  const openPorts = await prisma.port.count({ where: { state: "open" } }).catch(() => 0);
  res.json({
    total, online, offline, suspect, banned, quarantined, vlans, alerts,
    openPorts, subnet: config.scan.subnet,
  });
});

// ── Security rules ──
router.get("/rules", async (_req, res) => {
  res.json(await prisma.securityRule.findMany());
});

router.patch("/rules/:id", requireRole("admin"), async (req, res) => {
  res.json(await prisma.securityRule.update({ where: { id: req.params.id }, data: req.body }));
});

export default router;
