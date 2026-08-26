import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { encrypt } from "../services/crypto";
import { getAdapter, contextForCreds, gardeCommande } from "../adapters";
import { testConnection, executeOnDevice } from "../services/ssh";
import { authRequired, requireRole } from "../middleware/auth";
import { logEvent } from "../services/logger";

const router = Router();
router.use(authRequired);

router.get("/", async (_req, res) => {
  const devs = await prisma.sshDevice.findMany({
    select: { id: true, name: true, host: true, port: true, username: true, vendor: true, isMainRouter: true, lastConnected: true, createdAt: true },
  });
  res.json(devs);
});

const sshSchema = z.object({
  name: z.string().min(1), host: z.string().min(1), port: z.number().int().default(22),
  username: z.string().min(1),
  password: z.string().optional(), privateKey: z.string().optional(), passphrase: z.string().optional(),
  vendor: z.string().default("generic"),
  isMainRouter: z.boolean().optional(),
});

router.post("/", requireRole("admin"), async (req, res) => {
  const parsed = sshSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.errors });
  const { password, privateKey, passphrase, isMainRouter, ...rest } = parsed.data;

  // Only one main router allowed
  if (isMainRouter) {
    await prisma.sshDevice.updateMany({ data: { isMainRouter: false } });
  }

  const dev = await prisma.sshDevice.create({
    data: {
      ...rest,
      isMainRouter: !!isMainRouter,
      passwordEnc: password ? encrypt(password) : null,
      privateKeyEnc: privateKey ? encrypt(privateKey) : null,
      passphraseEnc: passphrase ? encrypt(passphrase) : null,
    },
  });

  // If main router, also flag the matching Device
  if (isMainRouter) {
    const match = await prisma.device.findFirst({ where: { ip: rest.host } });
    if (match) {
      await prisma.device.update({ where: { id: match.id }, data: { isMainRouter: true, whitelisted: true } });
    }
  }

  await logEvent("info", "ssh", `SSH device added: ${dev.name}`);
  res.json({ id: dev.id, name: dev.name, host: dev.host, vendor: dev.vendor, isMainRouter: dev.isMainRouter });
});

// Test de connexion.
//
// L'aiguillage se fait sur le transport *demandé*, et sur lui seul.
//
// Il se faisait auparavant aussi sur le transport déclaré par l'adaptateur :
// choisir la marque « unifi » sur une console SSH suffisait alors à envoyer le
// test vers l'API locale du contrôleur, port 22 ou pas. Le compte root et son
// mot de passe SSH étaient présentés à l'API, qui les refusait — d'où un
// « Identifiants refusés par le contrôleur » sur une connexion SSH parfaitement
// valable. La marque décrit ce qu'on pilote ; elle ne décide pas par où.
router.post("/test", requireRole("admin"), async (req, res) => {
  const parsed = sshSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.errors });

  const b: any = req.body || {};
  const adaptateur = getAdapter(parsed.data.vendor);
  const parApi = b.transport === "api";

  if (parApi && adaptateur) {
    try {
      const ctx = contextForCreds({
        transport: "api" as const,
        host: parsed.data.host,
        port: parsed.data.port,
        username: parsed.data.username,
        password: parsed.data.password,
        apiBaseUrl: b.apiBaseUrl || `https://${parsed.data.host}`,
        site: b.site || "default",
        verifyTls: b.verifyTls === true,
      });
      const r = await adaptateur.test(ctx);
      return res.json(r);
    } catch (err: any) {
      return res.json({ ok: false, error: err?.message || String(err) });
    }
  }

  res.json(await testConnection(parsed.data));
});

// Suppression.
//
// Le routeur principal et les consoles SSH partagent la même table. Supprimer
// ici une entrée pilotée par API effacerait la configuration de la page
// Équipement réseau — identifiants compris — sans que rien ne l'annonce. On
// refuse, et on dit où se fait la suppression.
router.delete("/:id", requireRole("admin"), async (req, res) => {
  const dev = await prisma.sshDevice.findUnique({ where: { id: req.params.id } });
  if (!dev) return res.status(404).json({ error: "Équipement introuvable" });
  if (dev.transport === "api") {
    return res.status(409).json({
      error: "Cet équipement est piloté par son API locale. Il se supprime depuis la page Équipement réseau.",
    });
  }
  await prisma.sshDevice.delete({ where: { id: dev.id } });
  await logEvent("info", "ssh", `SSH device removed: ${dev.name}`);
  res.json({ ok: true });
});

/**
 * Console interactive.
 *
 * -- Correctif de securite --------------------------------------------------
 * L'ecran affiche depuis toujours « celles qui enchainent plusieurs
 * instructions sont refusees avant l'envoi ». C'etait faux : gardeCommande
 * n'etait appelee que dans la couche adaptateurs, jamais ici. Un operateur --
 * role intermediaire, pas administrateur -- pouvait envoyer une commande
 * enchainee et elle partait telle quelle sur la passerelle, en root.
 *
 * Le controle est pose ici, sur le seul chemin ou la commande est tapee par un
 * humain. Il n'est **pas** pose dans executeOnDevice : les appels internes de
 * MapMyLAN -- le releve conntrack, la resolution des noms inverses --
 * utilisent legitimement des tubes et des points-virgules. Les brider
 * casserait le produit sans rien proteger, puisque ces commandes sont ecrites
 * dans le code et non recues d'une requete.
 */
router.post("/:id/exec", requireRole("admin", "operator"), async (req, res) => {
  const schema = z.object({ command: z.string().min(1) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid command" });

  let commande: string;
  try { commande = gardeCommande(parsed.data.command); }
  catch {
    return res.status(400).json({
      error: "Commande refusee : une seule instruction a la fois, sans « ; », « | », "
           + "« && », redirection ni substitution.",
    });
  }

  try { res.json(await executeOnDevice(req.params.id, commande)); }
  catch (err: any) { res.status(500).json({ error: err.message }); }
});

export default router;
