import { Router } from "express";
import { authRequired } from "../middleware/auth";
import { readAllStats } from "../services/host";
import { prisma } from "../db";

const router = Router();
router.use(authRequired);

router.get("/stats", async (_req, res) => {
  res.json(await readAllStats());
});

router.get("/history", async (req, res) => {
  const minutes = parseInt(String(req.query.minutes || "60"));
  const since = new Date(Date.now() - minutes * 60_000);
  const list = await prisma.hostMetric.findMany({
    where: { createdAt: { gt: since } },
    orderBy: { createdAt: "asc" },
  });
  res.json(list);
});

export default router;
