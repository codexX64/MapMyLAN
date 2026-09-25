// L'assistant, côté API. Ouvert à tout compte connecté : il lit, il ne
// modifie rien — un compte en lecture seule peut donc lui poser ses questions.

import express, { Router, type Response } from "express";
import rateLimit from "express-rate-limit";
import { authRequired, type AuthedRequest } from "../middleware/auth";
import { demander, lireFil, oublierFil, arreter, occupe, relances, ErreurAssistant } from "../services/assistant";
import { prendrePhoto } from "../services/assistant/photo";
import { iaPrete } from "../services/assistant/ia";
import { synapsePrete, nomCerveau } from "../services/assistant/synapse";
import { etatVoix, transcrire, dire, ErreurVoix } from "../services/assistant/voix";
import { config } from "../config";
import { logEvent } from "../services/logger";

const router = Router();
router.use(authRequired);

// Un modèle local coûte du temps de calcul, la voix un service tiers : de quoi
// converser, pas de quoi le marteler.
const limite = rateLimit({ windowMs: 60_000, max: 30, standardHeaders: true });

const qui = (req: AuthedRequest) => req.user!.id;
const echec = (res: Response, e: any) => {
  const status = e instanceof ErreurAssistant || e instanceof ErreurVoix ? e.status : 500;
  res.status(status).json({ error: e?.message || "Erreur de l'assistant" });
};

router.get("/", async (req: AuthedRequest, res) => {
  try {
    const [fil, photo, voix] = await Promise.all([lireFil(qui(req)), prendrePhoto(), etatVoix()]);
    res.json({
      fil,
      encours: occupe(qui(req)),
      ia: { prete: iaPrete(), modele: config.assistant.iaModele || null },
      voix,
      cerveau: { synapse: synapsePrete(), nom: nomCerveau() },
      relances: relances(photo, fil),
    });
  } catch (e) { echec(res, e); }
});

router.post("/ask", limite, async (req: AuthedRequest, res) => {
  try {
    const tour = await demander(qui(req), String(req.body?.text || ""), { voix: req.body?.voix === true });
    res.json(tour);
  } catch (e) { echec(res, e); }
});

router.post("/stop", (req: AuthedRequest, res) => res.json({ arrete: arreter(qui(req)) }));

router.post("/nouvelle", async (req: AuthedRequest, res) => {
  try { await oublierFil(qui(req)); res.json({ ok: true }); } catch (e) { echec(res, e); }
});

router.get("/voix", async (_req, res) => { res.json(await etatVoix()); });

router.post("/voix/transcrire", limite, express.raw({ type: ["audio/wav", "audio/*", "application/octet-stream"], limit: "12mb" }), async (req: AuthedRequest, res) => {
  try {
    const r = await transcrire(Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0));
    void logEvent("info", "assistant", "question vocale", { utilisateur: req.user?.username, caracteres: r.texte.length });
    res.json(r);
  } catch (e) { echec(res, e); }
});

router.post("/voix/dire", limite, async (req: AuthedRequest, res) => {
  try {
    const { son, type } = await dire(String(req.body?.text || ""));
    res.writeHead(200, { "Content-Type": type, "Content-Length": son.length, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
    res.end(son);
  } catch (e) { echec(res, e); }
});

export default router;
