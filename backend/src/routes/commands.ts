// CRUD for user-defined notification commands ("when X → do Y")
import { Router } from "express";
import { prisma } from "../db";
import { TRIGGERS, ACTIONS, fireCommand } from "../services/commands";
import { authRequired, requireRole } from "../middleware/auth";

const router = Router();

// These commands can trigger defense actions and SSH executions (the
// "exec_ssh" action). Without authentication, anyone on the network could
// therefore create a command, trigger it, and have anything executed on the
// registered equipment. The whole router requires a valid token; creation and
// modification are reserved for administrators.
router.use(authRequired);

// Catalog endpoints (used by the builder UI)
router.get("/triggers", (_req, res) => res.json(TRIGGERS));
router.get("/actions",  (_req, res) => res.json(ACTIONS));

// CRUD
router.get("/", async (_req, res) => {
  const cmds = await prisma.notificationCommand.findMany({ orderBy: { createdAt: "desc" } });
  res.json(cmds);
});

router.post("/", requireRole("admin"), async (req, res) => {
  try {
    const { name, trigger, filter, actions, template, cooldownSec, enabled } = req.body || {};
    if (!name || !trigger || !Array.isArray(actions) || actions.length === 0) {
      return res.status(400).json({ error: "name, trigger and at least one action are required" });
    }
    const cmd = await prisma.notificationCommand.create({
      data: {
        name, trigger,
        filter: filter || null,
        actions,
        template: template || null,
        cooldownSec: cooldownSec || 0,
        enabled: enabled !== false,
      },
    });
    res.json(cmd);
  } catch (err: any) { res.status(400).json({ error: err.message }); }
});

router.patch("/:id", requireRole("admin"), async (req, res) => {
  try {
    const data: any = {};
    for (const k of ["name", "trigger", "filter", "actions", "template", "cooldownSec", "enabled"]) {
      if (k in req.body) data[k] = req.body[k];
    }
    const cmd = await prisma.notificationCommand.update({ where: { id: req.params.id }, data });
    res.json(cmd);
  } catch (err: any) { res.status(400).json({ error: err.message }); }
});

router.delete("/:id", requireRole("admin"), async (req, res) => {
  try {
    await prisma.notificationCommand.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (err: any) { res.status(400).json({ error: err.message }); }
});

// Manually fire a command (for testing) — uses the "manual" trigger.
// Can execute destructive actions: reserved for administrators.
router.post("/:id/fire", requireRole("admin"), async (req, res) => {
  try {
    const cmd = await prisma.notificationCommand.findUnique({ where: { id: req.params.id } });
    if (!cmd) return res.status(404).json({ error: "Not found" });
    await fireCommand(cmd.trigger, req.body?.vars || { test: true });
    res.json({ ok: true });
  } catch (err: any) { res.status(400).json({ error: err.message }); }
});

export default router;
