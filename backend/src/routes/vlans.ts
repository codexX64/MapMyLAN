import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { authRequired } from "../middleware/auth";
import { provisionVlanOnRouter, deprovisionVlanOnRouter } from "../services/vlanProvision";

const router = Router();
router.use(authRequired);

router.get("/", async (_req, res) => {
  res.json(await prisma.vlan.findMany({ orderBy: { id: "asc" } }));
});

const vlanSchema = z.object({
  id: z.number().int().min(1).max(4094),
  name: z.string().min(1),
  subnet: z.string().min(1),
  color: z.string().optional(),
  description: z.string().optional(),
  isolated: z.boolean().optional(),
  pushToRouter: z.boolean().optional(),
});

router.post("/", async (req, res) => {
  const parsed = vlanSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.errors });
  const { pushToRouter, ...data } = parsed.data;

  const exists = await prisma.vlan.findUnique({ where: { id: data.id } });
  if (exists) return res.status(409).json({ error: `VLAN ${data.id} already exists` });

  const v = await prisma.vlan.create({ data });

  let provision: any = null;
  if (pushToRouter !== false) {
    provision = await provisionVlanOnRouter({ ...v, description: v.description ?? undefined });
  }
  res.json({ vlan: v, provision });
});

const updateSchema = z.object({
  name: z.string().optional(),
  subnet: z.string().optional(),
  color: z.string().optional(),
  description: z.string().optional(),
  isolated: z.boolean().optional(),
});

router.patch("/:id", async (req, res) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.errors });
  const updated = await prisma.vlan.update({ where: { id: parseInt(req.params.id) }, data: parsed.data });
  res.json(updated);
});

router.delete("/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  const removeFromRouter = String(req.query.removeFromRouter || "true") === "true";
  let provision: any = null;
  if (removeFromRouter) {
    provision = await deprovisionVlanOnRouter(id);
  }
  await prisma.vlan.delete({ where: { id } });
  res.json({ ok: true, provision });
});

export default router;
