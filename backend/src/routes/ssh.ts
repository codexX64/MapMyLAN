import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { encrypt } from "../services/crypto";
import { testConnection, executeOnDevice } from "../services/ssh";
import { authRequired, requireRole } from "../middleware/auth";
import { logEvent } from "../services/logger";

const router = Router();
router.use(authRequired);

router.get("/", async (_req, res) => {
  const devs = await prisma.sshDevice.findMany({
    select: { id: true, name: true, host: true, port: true, username: true, vendor: true, isMainRouter: true, lastConnected: true, createdAt: true },
  });
  res.json(devs);
});

const sshSchema = z.object({
  name: z.string().min(1), host: z.string().min(1), port: z.number().int().default(22),
  username: z.string().min(1),
  password: z.string().optional(), privateKey: z.string().optional(), passphrase: z.string().optional(),
  vendor: z.string().default("generic"),
  isMainRouter: z.boolean().optional(),
});

router.post("/", requireRole("admin"), async (req, res) => {
  const parsed = sshSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.errors });
  const { password, privateKey, passphrase, isMainRouter, ...rest } = parsed.data;

  // Only one main router allowed
  if (isMainRouter) {
    await prisma.sshDevice.updateMany({ data: { isMainRouter: false } });
  }

  const dev = await prisma.sshDevice.create({
    data: {
      ...rest,
      isMainRouter: !!isMainRouter,
      passwordEnc: password ? encrypt(password) : null,
      privateKeyEnc: privateKey ? encrypt(privateKey) : null,
      passphraseEnc: passphrase ? encrypt(passphrase) : null,
    },
  });

  // If main router, also flag the matching Device
  if (isMainRouter) {
    const match = await prisma.device.findFirst({ where: { ip: rest.host } });
    if (match) {
      await prisma.device.update({ where: { id: match.id }, data: { isMainRouter: true, whitelisted: true } });
    }
  }

  await logEvent("info", "ssh", `SSH device added: ${dev.name}`);
  res.json({ id: dev.id, name: dev.name, host: dev.host, vendor: dev.vendor, isMainRouter: dev.isMainRouter });
});

router.post("/test", requireRole("admin"), async (req, res) => {
  const parsed = sshSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.errors });
  res.json(await testConnection(parsed.data));
});

router.delete("/:id", requireRole("admin"), async (req, res) => {
  await prisma.sshDevice.delete({ where: { id: req.params.id } });
  res.json({ ok: true });
});

router.post("/:id/exec", requireRole("admin", "operator"), async (req, res) => {
  const schema = z.object({ command: z.string().min(1) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid command" });
  try { res.json(await executeOnDevice(req.params.id, parsed.data.command)); }
  catch (err: any) { res.status(500).json({ error: err.message }); }
});

export default router;
