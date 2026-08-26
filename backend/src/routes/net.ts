// Identification des destinations publiques — entrée HTTP.
//
// Le travail est dans services/registre.ts ; cette route n'est que le guichet.
// Le navigateur ne peut pas interroger un service RDAP lui-même : il n'en a ni
// le droit (politique de contenu) ni les moyens (CORS).

import { Router } from "express";
import { z } from "zod";
import { authRequired } from "../middleware/auth";
import { logEvent } from "../services/logger";
import {
  ficheRegistre, registreActif, estIPPublique, estPriveeRdap,
  type FicheReseau,
} from "../services/registre";

const router = Router();
router.use(authRequired);

let dernierAvis = 0;

const schema = z.object({ ips: z.array(z.string()).max(64) });

router.post("/whois", async (req, res) => {
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Liste d'adresses invalide" });

  if (!(await registreActif())) return res.json({ actif: false, fiches: [] });

  const ips = [...new Set(parsed.data.ips)]
    .filter((ip) => estIPPublique(ip) && !estPriveeRdap(ip))
    .slice(0, 64);

  const fiches: FicheReseau[] = [];
  for (let i = 0; i < ips.length; i += 8) {
    fiches.push(...await Promise.all(ips.slice(i, i + 8).map(ficheRegistre)));
  }

  // Un backend sans accès sortant ne pourra jamais identifier personne : il
  // vaut mieux le dire dans le journal que laisser des adresses nues sans
  // explication. Une fois par heure suffit.
  const joignable = fiches.length === 0 || fiches.some((f) => !f.injoignable);
  if (!joignable && Date.now() - dernierAvis > 3600_000) {
    dernierAvis = Date.now();
    await logEvent("warn", "net",
      "Registres RDAP injoignables : les destinations resteront affichées par leur adresse.");
  }

  res.json({ actif: true, joignable, fiches });
});

export default router;
