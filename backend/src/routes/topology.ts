import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { authRequired } from "../middleware/auth";
import { autoBuildTopology } from "../services/topology";
import { eventBus } from "../ws/realtime";

const router = Router();
router.use(authRequired);

// ── Get full topology (links + zones + devices with positions) ──
router.get("/", async (_req, res) => {
  const [links, zones] = await Promise.all([
    prisma.topologyLink.findMany(),
    prisma.zone.findMany(),
  ]);
  res.json({ links, zones });
});

router.post("/auto-build", async (_req, res) => {
  // Manual user action — always runs regardless of the setting.
  res.json(await autoBuildTopology({ force: true }));
});

// ── Link CRUD ──
const linkSchema = z.object({
  fromId: z.string(), toId: z.string(),
  type: z.string().default("ethernet"),
  speed: z.string().optional(), vlan: z.string().optional(),
});

router.post("/links", async (req, res) => {
  const parsed = linkSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.errors });
  const link = await prisma.topologyLink.create({ data: { ...parsed.data, manual: true } });
  eventBus.emit("topology:updated");
  res.json(link);
});

router.patch("/links/:id", async (req, res) => {
  const link = await prisma.topologyLink.update({ where: { id: req.params.id }, data: req.body });
  eventBus.emit("topology:updated");
  res.json(link);
});

// Swap fromId / toId on a link to flip direction
router.post("/links/:id/reverse", async (req, res) => {
  try {
    const link = await prisma.topologyLink.findUnique({ where: { id: req.params.id } });
    if (!link) return res.status(404).json({ error: "Link not found" });
    // Delete + recreate to dodge the (fromId,toId,fromIfaceId,toIfaceId) unique constraint
    await prisma.topologyLink.delete({ where: { id: req.params.id } });
    const newLink = await prisma.topologyLink.create({
      data: {
        fromId: link.toId,
        toId: link.fromId,
        fromIfaceId: link.toIfaceId,
        toIfaceId: link.fromIfaceId,
        type: link.type,
        speed: link.speed,
        vlan: link.vlan,
        manual: true,
      },
    });
    eventBus.emit("topology:updated");
    res.json(newLink);
  } catch (err: any) { res.status(400).json({ error: err.message }); }
});

router.delete("/links/:id", async (req, res) => {
  await prisma.topologyLink.delete({ where: { id: req.params.id } });
  eventBus.emit("topology:updated");
  res.json({ ok: true });
});

// ── Zone CRUD ──
const zoneSchema = z.object({
  name: z.string(), color: z.string().optional(),
  x: z.number(), y: z.number(),
  width: z.number().default(200), height: z.number().default(150),
  notes: z.string().optional(),
});

router.post("/zones", async (req, res) => {
  const parsed = zoneSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.errors });
  const z = await prisma.zone.create({ data: parsed.data });
  eventBus.emit("topology:updated");
  res.json(z);
});

router.patch("/zones/:id", async (req, res) => {
  const z = await prisma.zone.update({ where: { id: req.params.id }, data: req.body });
  eventBus.emit("topology:updated");
  res.json(z);
});

router.delete("/zones/:id", async (req, res) => {
  await prisma.zone.delete({ where: { id: req.params.id } });
  eventBus.emit("topology:updated");
  res.json({ ok: true });
});

// ── Bulk position update (drag-saving) ──
router.post("/positions", async (req, res) => {
  const schema = z.object({ positions: z.array(z.object({ id: z.string(), x: z.number(), y: z.number() })) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.errors });
  for (const p of parsed.data.positions) {
    await prisma.device.update({ where: { id: p.id }, data: { posX: p.x, posY: p.y } }).catch(() => {});
  }
  res.json({ ok: true });
});

export default router;
