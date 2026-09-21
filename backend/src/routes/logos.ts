// Logos des destinations, servis depuis notre propre origine.
//
// Lecture seule, et rien d'autre : un jeton d'intégration y a droit comme
// n'importe quel compte authentifié. La route ne prend qu'un nom de domaine,
// la liste des fournisseurs appelés est figée dans le service.

import { Router } from "express";
import { authRequired } from "../middleware/auth";
import { domaineValide, logoDe, logosActifs, CACHE_NAVIGATEUR_S } from "../services/logos";

const router = Router();
router.use(authRequired);

router.get("/:domaine", async (req, res) => {
  // Éteint par défaut : tant que le réglage n'est pas posé, rien ne sort de
  // l'installation, et la page affiche ses pastilles.
  if (!(await logosActifs())) return res.status(404).end();

  const domaine = String(req.params.domaine || "").toLowerCase();
  if (!domaineValide(domaine)) return res.status(400).end();

  const logo = await logoDe(domaine);
  if (!logo) return res.status(404).end();

  res.setHeader("Content-Type", logo.type);
  res.setHeader("Cache-Control", `private, max-age=${CACHE_NAVIGATEUR_S}`);
  // Le contenu vient d'un tiers : on interdit au navigateur de le réinterpréter.
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
  res.send(logo.corps);
});

export default router;
