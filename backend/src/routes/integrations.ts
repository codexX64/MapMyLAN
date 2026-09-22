// Jetons d'intégration — création, liste, révocation.
//
// Réservé aux administrateurs, et fermé aux jetons d'intégration eux-mêmes :
// sans cela, un jeton `operator` s'en délivrerait un autre et la limite de rôle
// ne vaudrait rien. Le refus est posé dans le middleware, pas ici, pour qu'il
// tienne même si cette route change.
//
// Révoquer n'efface pas la ligne. Ce qui a existé reste lisible — quel nom,
// quel rôle, quand il a servi la dernière fois. Une ligne supprimée ne
// raconterait plus rien.

import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { authRequired, requireRole, AuthedRequest } from "../middleware/auth";
import { logEvent } from "../services/logger";
import { fabriquerJeton, ROLES, PORTEES } from "../services/integrations";

const router = Router();
router.use(authRequired);
router.use(requireRole("admin"));

/** Ce qui sort : jamais le hash, jamais le clair. */
const publiable = (j: any, maintenant = Date.now()) => ({
  id: j.id,
  name: j.name,
  prefix: j.prefix,
  role: j.role,
  // La portée décide de ce que le jeton ouvre ; la liste doit la montrer, sinon
  // deux lignes d'apparence identique n'ont pas du tout les mêmes pouvoirs.
  scope: j.scope || "service",
  createdAt: j.createdAt,
  lastUsedAt: j.lastUsedAt,
  expiresAt: j.expiresAt,
  revokedAt: j.revokedAt,
  etat: j.revokedAt
    ? "revoque"
    : j.expiresAt && new Date(j.expiresAt).getTime() <= maintenant
      ? "expire"
      : "actif",
});

router.get("/", async (_req, res) => {
  const lignes = await prisma.integrationToken.findMany({ orderBy: { createdAt: "desc" } });
  const maintenant = Date.now();
  res.json(lignes.map((l) => publiable(l, maintenant)));
});

const creation = z.object({
  name: z.string().trim().min(1).max(60),
  role: z.enum(ROLES),
  // Portée : « service » par défaut, c'est-à-dire ce que faisaient tous les
  // jetons jusqu'ici. Demander « accounts » se fait explicitement.
  scope: z.enum(PORTEES).default("service"),
  // Facultatif. Un jeton sans échéance est un jeton qu'on oublie ; on ne
  // l'interdit pas, on laisse le choix.
  expiresAt: z.string().datetime().optional(),
});

router.post("/", async (req: AuthedRequest, res) => {
  const parse = creation.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: "Requête invalide" });
  const { name, role, scope, expiresAt } = parse.data;

  const { clair, prefix, hash } = fabriquerJeton();
  const ligne = await prisma.integrationToken.create({
    data: {
      name, role, scope, prefix, hash,
      createdById: req.user?.id || null,
      expiresAt: expiresAt ? new Date(expiresAt) : null,
    },
  });

  await logEvent("info", "integrations",
    `Jeton d'intégration « ${name} » créé (${role}, portée ${scope})`, { prefix, id: ligne.id });

  // Le clair ne repassera jamais : il n'existe nulle part ailleurs qu'ici.
  res.status(201).json({ ...publiable(ligne), token: clair });
});

router.delete("/:id", async (req, res) => {
  const ligne = await prisma.integrationToken.findUnique({ where: { id: req.params.id } });
  if (!ligne) return res.status(404).json({ error: "Introuvable" });
  if (ligne.revokedAt) return res.json(publiable(ligne));

  const revoque = await prisma.integrationToken.update({
    where: { id: ligne.id }, data: { revokedAt: new Date() },
  });
  await logEvent("warn", "integrations",
    `Jeton d'intégration « ${ligne.name} » révoqué`, { prefix: ligne.prefix, id: ligne.id });
  res.json(publiable(revoque));
});

export default router;
