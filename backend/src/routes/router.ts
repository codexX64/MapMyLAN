// Connexion à l'équipement réseau principal.
//
// Un seul écran côté interface, plusieurs voies côté machine : SSH pour la
// plupart des constructeurs, API locale pour UniFi. Les identifiants ne
// ressortent jamais de l'API : on ne renvoie que la présence d'un secret.

import { Router } from "express";
import { prisma } from "../db";
import { requireRole } from "../middleware/auth";
import { encrypt } from "../services/crypto";
import { logEvent } from "../services/logger";
import {
  ADAPTERS, getAdapter, detectAdapter, contextFor, contextForCreds,
  mainRouterRow, probeSsh, RouterCreds,
} from "../adapters";

const router = Router();

const publicShape = (row: any) => row && ({
  id: row.id,
  name: row.name,
  host: row.host,
  port: row.port,
  username: row.username,
  vendor: row.vendor,
  transport: row.transport || "ssh",
  apiBaseUrl: row.apiBaseUrl || null,
  site: row.site || null,
  verifyTls: !!row.verifyTls,
  hasPassword: !!row.passwordEnc,
  hasPrivateKey: !!row.privateKeyEnc,
  lastConnected: row.lastConnected,
  lastTestOk: row.lastTestOk ?? null,
  lastTestAt: row.lastTestAt ?? null,
  lastTestInfo: row.lastTestInfo ?? null,
  capabilities: getAdapter(row.vendor).capabilities,
});

// Catalogue des constructeurs pris en charge, avec ce que chacun sait faire.
router.get("/adapters", (_req, res) => {
  res.json(ADAPTERS.map(a => ({
    id: a.id, label: a.label, transport: a.transport,
    capabilities: a.capabilities, needs: a.needs || ["password"],
  })));
});

// Équipement principal actuellement enregistré.
router.get("/", async (_req, res) => {
  const row = await mainRouterRow();
  res.json(row ? publicShape(row) : null);
});

function credsFromBody(body: any): RouterCreds {
  return {
    host: body.host,
    port: Number(body.port) || (body.transport === "api" ? 443 : 22),
    username: body.username,
    password: body.password || undefined,
    privateKey: body.privateKey || undefined,
    passphrase: body.passphrase || undefined,
    transport: body.transport === "api" ? "api" : "ssh",
    apiBaseUrl: body.apiBaseUrl || undefined,
    site: body.site || undefined,
    verifyTls: body.verifyTls === true,
  };
}

// Reconnaissance : on demande à l'équipement qui il est, sans rien enregistrer.
router.post("/detect", requireRole("admin"), async (req, res) => {
  try {
    const creds = credsFromBody(req.body || {});
    if (creds.transport === "api") {
      const probe = await ADAPTERS.find(a => a.id === "unifi")!.test(contextForCreds(creds));
      return res.json({ ok: probe.ok, detected: probe.ok ? "unifi" : null, info: probe.info, error: probe.error });
    }
    const banner = await probeSsh(creds);
    const hit = detectAdapter(banner);
    res.json({ ok: !!banner, detected: hit?.id || null, info: banner.slice(0, 200) || null });
  } catch (err: any) { res.status(400).json({ ok: false, error: err.message }); }
});

// Test d'une configuration, enregistrée ou non.
router.post("/test", requireRole("admin"), async (req, res) => {
  try {
    let ctx, adapter;
    if (req.body?.useSaved) {
      const row = await mainRouterRow();
      if (!row) return res.status(404).json({ ok: false, error: "Aucun équipement enregistré" });
      ctx = contextFor(row); adapter = getAdapter(row.vendor);
    } else {
      const creds = credsFromBody(req.body || {});
      ctx = contextForCreds(creds); adapter = getAdapter(req.body?.vendor);
    }
    const result = await adapter.test(ctx);

    const row = await mainRouterRow();
    if (row) {
      await prisma.sshDevice.update({
        where: { id: row.id },
        data: {
          lastTestOk: result.ok, lastTestAt: new Date(),
          lastTestInfo: result.info || result.error || null,
        } as any,
      });
    }
    await logEvent(result.ok ? "info" : "warn", "router",
      `Test ${adapter.label} : ${result.ok ? "réussi" : "échec"} ${result.info || result.error || ""}`);
    res.json({ ...result, adapter: adapter.id, capabilities: adapter.capabilities });
  } catch (err: any) { res.status(400).json({ ok: false, error: err.message }); }
});

// Enregistrement. Un secret laissé vide conserve celui déjà stocké.
router.put("/", requireRole("admin"), async (req, res) => {
  try {
    const b = req.body || {};
    if (!b.host || !b.username) return res.status(400).json({ error: "Hôte et identifiant requis" });

    const data: any = {
      name: b.name || `Routeur ${b.host}`,
      host: b.host,
      port: Number(b.port) || (b.transport === "api" ? 443 : 22),
      username: b.username,
      vendor: getAdapter(b.vendor).id,
      transport: b.transport === "api" ? "api" : "ssh",
      apiBaseUrl: b.apiBaseUrl || null,
      site: b.site || null,
      verifyTls: b.verifyTls === true,
      isMainRouter: true,
    };
    if (b.password)   data.passwordEnc   = encrypt(b.password);
    if (b.privateKey) data.privateKeyEnc = encrypt(b.privateKey);
    if (b.passphrase) data.passphraseEnc = encrypt(b.passphrase);

    // L'enregistrement se fait sur la ligne marquée « équipement principal ».
    // Si ce drapeau a été déplacé entre-temps — l'ajout d'une console SSH
    // cochée « équipement principal » le retire à tout le monde — la ligne
    // existante devient invisible ici, et une seconde était créée à côté.
    // On la retrouve donc aussi par son transport et son hôte.
    const existing =
      (await mainRouterRow()) ||
      (await prisma.sshDevice.findFirst({
        where: { transport: data.transport, host: data.host },
        orderBy: { createdAt: "asc" },
      }));
    const row = existing
      ? await prisma.sshDevice.update({ where: { id: existing.id }, data })
      : await prisma.sshDevice.create({ data });

    // Une ligne en transport « api » ne vient que d'ici : toute autre est un
    // doublon laissé par une version précédente. On nettoie, et on le dit.
    if (data.transport === "api") {
      const doublons = await prisma.sshDevice.deleteMany({
        where: { transport: "api", id: { not: row.id } },
      });
      if (doublons.count) {
        await logEvent("info", "router", `${doublons.count} fiche(s) en double supprimée(s)`);
      }
    }

    await logEvent("info", "router", `Équipement principal enregistré : ${data.vendor} sur ${data.host}`);
    res.json(publicShape(row));
  } catch (err: any) { res.status(400).json({ error: err.message }); }
});

// Supprimer l'équipement principal retire aussi ses doublons éventuels : une
// ligne en transport « api » ne peut venir que de cette page.
router.delete("/", requireRole("admin"), async (_req, res) => {
  const row = await mainRouterRow();
  if (row) await prisma.sshDevice.delete({ where: { id: row.id } });
  const restes = await prisma.sshDevice.deleteMany({ where: { transport: "api" } });
  await logEvent("info", "router", `Équipement principal supprimé${restes.count ? ` (+${restes.count} doublon(s))` : ""}`);
  res.json({ ok: true });
});

// Qui l'équipement voit-il en ce moment ? Sert aussi à comparer avec ce que le
// balayage a trouvé de son côté.
router.get("/clients", async (_req, res) => {
  try {
    const row = await mainRouterRow();
    if (!row) return res.status(404).json({ error: "Aucun équipement enregistré" });
    const adapter = getAdapter(row.vendor);
    if (!adapter.clients) return res.json({ supported: false, clients: [] });
    const clients = await adapter.clients(contextFor(row));
    res.json({ supported: true, clients });
  } catch (err: any) { res.status(400).json({ error: err.message }); }
});

// Table ARP vue par l'équipement : c'est la source la plus fiable pour
// retrouver les appareils muets que le balayage rate.
router.get("/arp", async (_req, res) => {
  try {
    const row = await mainRouterRow();
    if (!row) return res.status(404).json({ error: "Aucun équipement enregistré" });
    const adapter = getAdapter(row.vendor);
    if (!adapter.arp) return res.json({ supported: false, entries: [] });
    res.json({ supported: true, entries: await adapter.arp(contextFor(row)) });
  } catch (err: any) { res.status(400).json({ error: err.message }); }
});

export default router;
