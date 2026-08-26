// CRUD des commandes définies par l'utilisateur (« quand X → faire Y »).
//
// ── Correctif de sécurité ───────────────────────────────────────────────────
// Ce routeur était monté **sans aucune authentification**. Tous les autres en
// posent une ; celui-ci avait été oublié, et son voisin bot-commands avec lui.
//
// Ce n'était pas un détail de confort : l'action `exec_ssh` de ce catalogue
// exécute une commande sur un équipement enregistré — le routeur, en root. La
// chaîne tenait en trois requêtes non authentifiées : lire les commandes
// existantes pour y trouver un identifiant d'équipement, en créer une nouvelle
// portant la commande voulue, la déclencher.
//
// Deux niveaux, parce qu'ils ne coûtent rien et qu'ils disent la bonne chose :
// lire demande une session, écrire et déclencher demandent d'être
// administrateur. Un « viewer » n'a aucune raison de fabriquer une action qui
// s'exécute sur la passerelle.
import { Router } from "express";
import { prisma } from "../db";
import { TRIGGERS, ACTIONS, fireCommand } from "../services/commands";
import { authRequired, requireRole } from "../middleware/auth";

const router = Router();
router.use(authRequired);

// Catalogue, lu par l'écran de construction.
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

// Déclenchement manuel, pour essai — passe par le déclencheur « manual ».
router.post("/:id/fire", requireRole("admin"), async (req, res) => {
  try {
    const cmd = await prisma.notificationCommand.findUnique({ where: { id: req.params.id } });
    if (!cmd) return res.status(404).json({ error: "Not found" });
    await fireCommand(cmd.trigger, req.body?.vars || { test: true });
    res.json({ ok: true });
  } catch (err: any) { res.status(400).json({ error: err.message }); }
});

export default router;
