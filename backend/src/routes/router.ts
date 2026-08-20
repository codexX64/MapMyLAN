// Connection to the main network equipment.
//
// A single screen on the interface side, several paths on the machine side: SSH
// for most vendors, local API for UniFi. Credentials never come back out of the
// API: we only return whether a secret is present.

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

// Catalog of supported vendors, with what each one can do.
router.get("/adapters", (_req, res) => {
  res.json(ADAPTERS.map(a => ({
    id: a.id, label: a.label, transport: a.transport,
    capabilities: a.capabilities, needs: a.needs || ["password"],
  })));
});

// Main equipment currently registered.
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

// Discovery: we ask the equipment who it is, without registering anything.
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

// Test of a configuration, whether registered or not.
router.post("/test", requireRole("admin"), async (req, res) => {
  try {
    let ctx, adapter;
    if (req.body?.useSaved) {
      const row = await mainRouterRow();
      if (!row) return res.status(404).json({ ok: false, error: "No device registered" });
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
      `Test ${adapter.label}: ${result.ok ? "succeeded" : "failed"} ${result.info || result.error || ""}`);
    res.json({ ...result, adapter: adapter.id, capabilities: adapter.capabilities });
  } catch (err: any) { res.status(400).json({ ok: false, error: err.message }); }
});

// Registration. A secret left empty keeps the one already stored.
router.put("/", requireRole("admin"), async (req, res) => {
  try {
    const b = req.body || {};
    if (!b.host || !b.username) return res.status(400).json({ error: "Host and username required" });

    const data: any = {
      name: b.name || `Router ${b.host}`,
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

    const existing = await mainRouterRow();
    const row = existing
      ? await prisma.sshDevice.update({ where: { id: existing.id }, data })
      : await prisma.sshDevice.create({ data });

    await logEvent("info", "router", `Main device registered: ${data.vendor} on ${data.host}`);
    res.json(publicShape(row));
  } catch (err: any) { res.status(400).json({ error: err.message }); }
});

router.delete("/", requireRole("admin"), async (_req, res) => {
  const row = await mainRouterRow();
  if (row) await prisma.sshDevice.delete({ where: { id: row.id } });
  res.json({ ok: true });
});

// Who does the equipment see right now? Also used to compare with what the
// scan found on its side.
router.get("/clients", async (_req, res) => {
  try {
    const row = await mainRouterRow();
    if (!row) return res.status(404).json({ error: "No device registered" });
    const adapter = getAdapter(row.vendor);
    if (!adapter.clients) return res.json({ supported: false, clients: [] });
    const clients = await adapter.clients(contextFor(row));
    res.json({ supported: true, clients });
  } catch (err: any) { res.status(400).json({ error: err.message }); }
});

// ARP table as seen by the equipment: this is the most reliable source for
// finding the silent devices that the scan misses.
router.get("/arp", async (_req, res) => {
  try {
    const row = await mainRouterRow();
    if (!row) return res.status(404).json({ error: "No device registered" });
    const adapter = getAdapter(row.vendor);
    if (!adapter.arp) return res.json({ supported: false, entries: [] });
    res.json({ supported: true, entries: await adapter.arp(contextFor(row)) });
  } catch (err: any) { res.status(400).json({ error: err.message }); }
});

export default router;
