// CRUD des commandes du bot Telegram.
//
// ── Correctif de sécurité ───────────────────────────────────────────────────
// Ce routeur était monté **sans aucune authentification**, comme son voisin
// commands. Le « GET / » rendait les lignes complètes, params compris — donc
// l'identifiant d'équipement SSH et la commande d'une action exec_ssh déjà
// enregistrée. C'était la pièce manquante d'une chaîne qui menait à
// l'exécution d'une commande root sur la passerelle, sans identifiants.
//
// Lire demande une session ; écrire et déclencher demandent d'être
// administrateur. « POST /:id/run » en particulier exécute réellement
// l'action : il n'a rien d'un essai, du point de vue de la passerelle.
import { Router } from "express";
import { prisma } from "../db";
import { BOT_ACTIONS, runAction } from "../services/botCommands";
import { authRequired, requireRole } from "../middleware/auth";

const router = Router();
router.use(authRequired);

router.get("/actions", (_req, res) => res.json(BOT_ACTIONS));

router.get("/", async (_req, res) => {
  const list = await prisma.botCommand.findMany({ orderBy: { createdAt: "desc" } });
  res.json(list);
});

router.post("/", requireRole("admin"), async (req, res) => {
  try {
    const { trigger, description, action, params, enabled, confirm, allowedChatIds, cooldownSec } = req.body || {};
    if (!trigger || !action) return res.status(400).json({ error: "trigger and action are required" });
    let trig = String(trigger).trim().toLowerCase();
    if (!trig.startsWith("/")) trig = "/" + trig;
    const row = await prisma.botCommand.create({
      data: {
        trigger: trig,
        description: description || null,
        action,
        params: params || null,
        enabled: enabled !== false,
        confirm: confirm === true,
        allowedChatIds: Array.isArray(allowedChatIds) ? allowedChatIds.map(String) : [],
        cooldownSec: cooldownSec || 0,
      },
    });
    res.json(row);
  } catch (err: any) { res.status(400).json({ error: err.message }); }
});

router.patch("/:id", requireRole("admin"), async (req, res) => {
  try {
    const data: any = {};
    for (const k of ["trigger", "description", "action", "params", "enabled", "confirm", "allowedChatIds", "cooldownSec"]) {
      if (k in req.body) data[k] = req.body[k];
    }
    if (data.trigger) {
      let t = String(data.trigger).trim().toLowerCase();
      if (!t.startsWith("/")) t = "/" + t;
      data.trigger = t;
    }
    const row = await prisma.botCommand.update({ where: { id: req.params.id }, data });
    res.json(row);
  } catch (err: any) { res.status(400).json({ error: err.message }); }
});

router.delete("/:id", requireRole("admin"), async (req, res) => {
  try { await prisma.botCommand.delete({ where: { id: req.params.id } }); res.json({ ok: true }); }
  catch (err: any) { res.status(400).json({ error: err.message }); }
});

// Déclenchement depuis l'interface. Le nom d'origine parlait d'essai ;
// l'action part pour de bon sur l'équipement, d'où le rôle exigé.
router.post("/:id/run", requireRole("admin"), async (req, res) => {
  try {
    const cmd = await prisma.botCommand.findUnique({ where: { id: req.params.id } });
    if (!cmd) return res.status(404).json({ error: "Not found" });
    const args: string[] = Array.isArray(req.body?.args) ? req.body.args : [];
    const reply = await runAction(cmd.action, cmd.params || {}, { chatId: "ui-test", args });
    await prisma.botCommand.update({
      where: { id: cmd.id },
      data: { lastFiredAt: new Date(), lastFiredBy: "ui", fireCount: { increment: 1 } },
    });
    res.json({ reply });
  } catch (err: any) { res.status(400).json({ error: err.message }); }
});

export default router;
