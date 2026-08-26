import { Router } from "express";
import { prisma } from "../db";
import { computeGroupingSuggestions } from "../services/grouping";
import { dedupeDevices } from "../services/dedupe";
import { fullScan, fullScanAll, plagesActives, pingHost, nmapDeepScan } from "../services/scanner";
import { scoreDevice, scoreAllDevices, globalHealthScore } from "../services/scoring";
import { banDevice, quarantineDevice, unbanDevice } from "../services/defense";
import { authRequired } from "../middleware/auth";
import { mainRouter } from "../adapters";
import { plageUtilisable, verifierAdresse } from "../services/vlanReleve";
import { logEvent } from "../services/logger";

const router = Router();
router.use(authRequired);

router.get("/", async (_req, res) => {
  const devices = await prisma.device.findMany({
    include: { ports: true, cves: true, interfaces: true },
    orderBy: { lastSeen: "desc" },
  });
  res.json(devices);
});

router.get("/health/score", async (_req, res) => {
  const score = await globalHealthScore();
  res.json({ score });
});

router.get("/scans/latest", async (_req, res) => {
  const run = await prisma.scanRun.findFirst({ orderBy: { startedAt: "desc" } });
  res.json(run);
});

// Plages configurées, pour affichage.
router.get("/scan/ranges", async (_req, res) => {
  res.json(await plagesActives());
});

router.post("/scan", async (req, res) => {
  const subnet = req.body?.subnet as string | undefined;
  // Sans plage précisée, on balaie toutes celles qui sont configurées.
  const lancement = subnet ? fullScan(subnet) : fullScanAll();
  lancement.then(() => scoreAllDevices()).catch(console.error);
  res.json({ ok: true });
});

// ── Manually create a device ─────────────────────────────────────────────
// For switches/APs with no IP, devices behind NAT, etc. The device starts
// as "manual" and is just like any other afterwards (editable, banishable, etc.).
router.post("/manual", async (req, res) => {
  try {
    const { ip, mac, hostname, customName, vendor, model, type, customType, posX, posY, notes } = req.body || {};
    if (!customName && !hostname && !ip && !mac) {
      return res.status(400).json({ error: "At least one of: name, hostname, IP, MAC required" });
    }
    const data: any = {
      ip: ip || "0.0.0.0",
      mac: mac ? String(mac).toUpperCase() : null,
      hostname: hostname || null,
      customName: customName || null,
      vendor: vendor || null,
      model: model || null,
      type: type || customType || "unknown",
      customType: customType || null,
      status: "online",
      posX, posY,
      notes: notes || null,
      metadata: { manual: true, createdBy: (req as any).user?.username },
    };
    const dev = await prisma.device.create({ data });
    await prisma.deviceHistory.create({
      data: { deviceId: dev.id, event: "first_seen", data: { manual: true, vendor: vendor || "Unknown" } },
    });
    res.json(dev);
  } catch (err: any) { res.status(400).json({ error: err.message }); }
});

router.get("/:id", async (req, res) => {
  const dev = await prisma.device.findUnique({
    where: { id: req.params.id },
    include: {
      ports: true, cves: true, interfaces: true,
      history: { take: 50, orderBy: { createdAt: "desc" } },
    },
  });
  if (!dev) return res.status(404).json({ error: "Not found" });
  res.json(dev);
});

router.patch("/:id", async (req, res) => {
  const allowed = ["customName", "customType", "vendor", "model", "vlan", "zone", "tags", "notes", "role", "whitelisted", "isMainRouter", "posX", "posY", "pinned", "type"];
  const data: any = {};
  for (const k of allowed) if (k in req.body) data[k] = req.body[k];
  const dev = await prisma.device.update({ where: { id: req.params.id }, data });

  if ("notes" in data || "customName" in data || "customType" in data || "tags" in data) {
    await prisma.deviceHistory.create({
      data: { deviceId: dev.id, event: "note_added", data: { changes: data } },
    });
  }
  res.json(dev);
});

// ── Réservation d'adresse ───────────────────────────────────────────────────
//
// Ce que cette route fait, et ce qu'elle ne fait pas, parce que la nuance
// décide de tout :
//
//   elle NE réécrit PAS l'adresse de l'appareil. Aucun outil ne peut aller
//   changer la configuration réseau d'une machine à distance sans y avoir un
//   agent ou un accès ;
//
//   elle demande à la passerelle de toujours servir cette adresse-là à cette
//   carte réseau. L'appareil la prendra à son prochain bail — tout de suite si
//   on coupe sa session, sinon à l'expiration du bail en cours.
//
// Le VLAN choisi ne déplace pas non plus l'appareil de segment : il dit de
// quel réseau l'adresse relève. Un appareil branché sur un port du VLAN 10 ne
// passera pas au VLAN 20 parce qu'on a réservé une adresse du VLAN 20 — c'est
// le profil du port, ou le SSID, qui décide de ça, et ça ne se règle pas d'ici.

router.get("/:id/reservation", async (req, res) => {
  const dev = await prisma.device.findUnique({ where: { id: req.params.id } });
  if (!dev) return res.status(404).json({ error: "Appareil introuvable" });

  const vlans = await prisma.vlan.findMany({ orderBy: { id: "asc" } });
  res.json({
    mac: dev.mac,
    ip: dev.ip,
    vlan: dev.vlan,
    // Ce que l'interface a besoin de savoir pour composer une adresse valable.
    segments: vlans.map((v: any) => ({
      id: v.id, nom: v.name, sousReseau: v.subnet,
      passerelle: v.gateway, plage: plageUtilisable(v.subnet),
      pousseSurEquipement: !!v.networkId,
    })),
  });
});

router.post("/:id/reservation", async (req, res) => {
  const dev = await prisma.device.findUnique({ where: { id: req.params.id } });
  if (!dev) return res.status(404).json({ error: "Appareil introuvable" });
  if (!dev.mac) {
    return res.status(400).json({
      error: "Aucune adresse MAC relevée pour cet appareil : une réservation se pose sur une carte réseau, pas sur une adresse.",
    });
  }

  const retirer = req.body?.retirer === true;
  const ip = String(req.body?.ip || "").trim();
  const vlanId = req.body?.vlan == null || req.body?.vlan === "" ? null : Number(req.body.vlan);

  let vlan: any = null;
  if (!retirer) {
    if (vlanId == null || !Number.isInteger(vlanId)) {
      return res.status(400).json({ error: "Choisis le VLAN auquel l'adresse appartient." });
    }
    vlan = await prisma.vlan.findUnique({ where: { id: vlanId } });
    if (!vlan) return res.status(400).json({ error: `VLAN ${vlanId} inconnu.` });

    const v = verifierAdresse(ip, vlan.subnet, vlan.gateway);
    if (!v.ok) return res.status(400).json({ error: v.raison });

    // Deux machines sur la même adresse, c'est la panne garantie. On regarde
    // avant, plutôt que de laisser le réseau la découvrir.
    const occupant = await prisma.device.findFirst({
      where: { ip, NOT: { id: dev.id } },
      select: { id: true, ip: true, hostname: true, customName: true, mac: true },
    });
    if (occupant) {
      return res.status(409).json({
        error: `${ip} est déjà portée par ${occupant.customName || occupant.hostname || occupant.mac || occupant.ip}.`,
      });
    }
  }

  let adapter, ctx;
  try { ({ adapter, ctx } = await mainRouter()); }
  catch (e: any) { return res.status(400).json({ error: e?.message || "Aucun équipement principal." }); }

  if (!adapter.reserver) {
    return res.status(400).json({
      error: `${adapter.label} ne sait pas poser de réservation depuis MapMyLAN. ` +
             `Il faut la déclarer sur l'équipement lui-même.`,
    });
  }

  let sortie: string;
  try {
    sortie = await adapter.reserver(ctx, {
      mac: dev.mac,
      ip: retirer ? undefined : ip,
      networkId: vlan?.networkId || undefined,
    });
  } catch (e: any) {
    return res.status(502).json({ error: e?.message || "L'équipement a refusé." });
  }

  // On note le VLAN voulu, jamais l'adresse : tant que l'appareil n'a pas
  // repris de bail, il porte encore l'ancienne. L'écrire ici afficherait une
  // adresse à laquelle personne ne répond.
  if (!retirer && vlanId != null) {
    await prisma.device.update({ where: { id: dev.id }, data: { vlan: vlanId } });
  }
  await prisma.deviceHistory.create({
    data: {
      deviceId: dev.id,
      event: "note_added",
      data: { reservation: retirer ? null : ip, vlan: vlanId, sortie },
    },
  }).catch(() => {});
  await logEvent("info", "devices",
    retirer ? `Réservation retirée pour ${dev.mac}` : `Adresse ${ip} réservée pour ${dev.mac}`);

  res.json({
    ok: true,
    sortie,
    ipActuelle: dev.ip,
    ipReservee: retirer ? null : ip,
    // Dire les choses : rien n'a encore bougé côté machine.
    appliquee: retirer ? false : dev.ip === ip,
    message: retirer
      ? "Réservation retirée. L'appareil repassera en adresse dynamique à son prochain bail."
      : dev.ip === ip
        ? "L'appareil porte déjà cette adresse : elle est maintenant garantie."
        : `Réservation posée. L'appareil porte encore ${dev.ip} et prendra ${ip} à son prochain bail — ` +
          `« forcer la reprise de bail » l'y oblige tout de suite.`,
  });
});

/** Coupe la session du client pour qu'il redemande un bail immédiatement. */
router.post("/:id/relancer-bail", async (req, res) => {
  const dev = await prisma.device.findUnique({ where: { id: req.params.id } });
  if (!dev) return res.status(404).json({ error: "Appareil introuvable" });

  let adapter, ctx;
  try { ({ adapter, ctx } = await mainRouter()); }
  catch (e: any) { return res.status(400).json({ error: e?.message || "Aucun équipement principal." }); }
  if (!adapter.relancerBail) {
    return res.status(400).json({ error: `${adapter.label} ne sait pas faire ça depuis MapMyLAN.` });
  }
  try {
    const sortie = await adapter.relancerBail(ctx, { ip: dev.ip, mac: dev.mac || undefined });
    await logEvent("warn", "devices", `Bail relancé pour ${dev.mac || dev.ip}`);
    res.json({ ok: true, sortie, message: "Session coupée : l'appareil redemande un bail. Compte quelques secondes." });
  } catch (e: any) {
    res.status(502).json({ error: e?.message || "L'équipement a refusé." });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const dev = await prisma.device.findUnique({ where: { id: req.params.id } });
    if (!dev) return res.status(404).json({ error: "Not found" });
    if (dev.isMainRouter) return res.status(400).json({ error: "Cannot delete the main router" });
    await prisma.device.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (err: any) { res.status(400).json({ error: err.message }); }
});

router.get("/:id/ping", async (req, res) => {
  const dev = await prisma.device.findUnique({ where: { id: req.params.id } });
  if (!dev) return res.status(404).json({ error: "Not found" });
  res.json(await pingHost(dev.ip));
});

router.post("/:id/score", async (req, res) => {
  res.json(await scoreDevice(req.params.id));
});

router.post("/:id/deep-scan", async (req, res) => {
  const dev = await prisma.device.findUnique({ where: { id: req.params.id } });
  if (!dev) return res.status(404).json({ error: "Not found" });
  res.json(await nmapDeepScan(dev.ip));
});

router.get("/:id/history", async (req, res) => {
  const list = await prisma.deviceHistory.findMany({
    where: { deviceId: req.params.id },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  res.json(list);
});

// ── Defense actions ──
router.post("/:id/ban", async (req, res) => {
  try { res.json(await banDevice(req.params.id, { manual: true, reason: req.body?.reason })); }
  catch (err: any) { res.status(400).json({ error: err.message }); }
});

router.post("/:id/quarantine", async (req, res) => {
  try { res.json(await quarantineDevice(req.params.id, { manual: true, reason: req.body?.reason })); }
  catch (err: any) { res.status(400).json({ error: err.message }); }
});

router.post("/:id/unban", async (req, res) => {
  try { res.json(await unbanDevice(req.params.id)); }
  catch (err: any) { res.status(400).json({ error: err.message }); }
});

// ── Interfaces ──
// Add a new NIC to a device (Wi-Fi, Ethernet, virtual…)
router.post("/:id/interfaces", async (req, res) => {
  try {
    const { mac, ip, type, label, posX, posY } = req.body || {};
    const iface = await prisma.interface.create({
      data: {
        deviceId: req.params.id,
        mac: mac ? String(mac).toUpperCase() : null,
        ip, type: type || "ethernet", label, posX, posY,
      },
    });
    res.json(iface);
  } catch (err: any) { res.status(400).json({ error: err.message }); }
});

router.patch("/:id/interfaces/:ifaceId", async (req, res) => {
  try {
    const data: any = {};
    for (const k of ["mac", "ip", "type", "label", "posX", "posY", "isPrimary"]) {
      if (k in req.body) data[k] = k === "mac" && req.body.mac ? String(req.body.mac).toUpperCase() : req.body[k];
    }
    const iface = await prisma.interface.update({ where: { id: req.params.ifaceId }, data });
    res.json(iface);
  } catch (err: any) { res.status(400).json({ error: err.message }); }
});

router.delete("/:id/interfaces/:ifaceId", async (req, res) => {
  try {
    await prisma.interface.delete({ where: { id: req.params.ifaceId } });
    res.json({ ok: true });
  } catch (err: any) { res.status(400).json({ error: err.message }); }
});

// ── Merge: absorb device B into device A. B becomes one or more interfaces of A. ──
// ── Interface grouping (personal addressing convention) ──
router.get("/grouping/suggestions", async (_req, res) => {
  try {
    const suggestions = await computeGroupingSuggestions();
    res.json(suggestions);
  } catch (err: any) { res.status(400).json({ error: err.message }); }
});

// Nettoyage manuel des doublons d'adresse.
router.post("/dedupe", async (_req, res) => {
  try { res.json(await dedupeDevices()); }
  catch (err: any) { res.status(400).json({ error: err.message }); }
});

router.post("/:id/merge", async (req, res) => {
  try {
    const targetId = req.params.id;
    const { sourceId, keepName, ifaceType } = req.body || {};
    if (!sourceId) return res.status(400).json({ error: "sourceId required" });
    if (sourceId === targetId) return res.status(400).json({ error: "Cannot merge a device with itself" });

    const [target, source] = await Promise.all([
      prisma.device.findUnique({ where: { id: targetId }, include: { interfaces: true } }),
      prisma.device.findUnique({ where: { id: sourceId }, include: { interfaces: true } }),
    ]);
    if (!target || !source) return res.status(404).json({ error: "Device not found" });
    if (source.isMainRouter) return res.status(400).json({ error: "Cannot merge the main router" });

    // Make sure target has its primary interface registered
    if (target.mac && !target.interfaces.find(i => i.mac === target.mac)) {
      await prisma.interface.create({
        data: {
          deviceId: target.id, mac: target.mac, ip: target.ip,
          type: "ethernet", label: "primary", isPrimary: true,
          posX: target.posX, posY: target.posY,
        },
      });
    }

    // Add source's MAC as a new interface of target.
    // Heuristic: if source vendor mentions 'wifi', mark as wifi; Wi-Fi MACs often have
    // the locally-administered bit set (2nd hex char is 2/6/A/E) but that's not reliable.
    if (source.mac) {
      const wifiHint = ifaceType === "wifi" || ifaceType === "ethernet"
        ? ifaceType === "wifi"
        : /wi-?fi|wireless|wlan/i.test(`${source.hostname || ""} ${source.vendor || ""}`);
      // Avoid unique constraint clash: detach the MAC from source first
      await prisma.device.update({ where: { id: source.id }, data: { mac: null } });
      await prisma.interface.create({
        data: {
          deviceId: target.id,
          mac: source.mac, ip: source.ip,
          type: wifiHint ? "wifi" : "ethernet",
          label: source.hostname || null,
          posX: source.posX, posY: source.posY,
        },
      });
    }
    // Migrate any existing interfaces of source to target
    for (const iface of source.interfaces) {
      await prisma.interface.update({
        where: { id: iface.id },
        data: { deviceId: target.id },
      }).catch(() => {});
    }

    // Migrate history
    await prisma.deviceHistory.updateMany({ where: { deviceId: source.id }, data: { deviceId: target.id } });
    // Migrate ports + CVEs (keep them under the unified device)
    await prisma.port.updateMany({ where: { deviceId: source.id }, data: { deviceId: target.id } });
    await prisma.cveMatch.updateMany({ where: { deviceId: source.id }, data: { deviceId: target.id } });

    // Optionally adopt the source's hostname/vendor if target was missing them
    const merge: any = {};
    if (!target.hostname && source.hostname) merge.hostname = source.hostname;
    if (!target.vendor && source.vendor) merge.vendor = source.vendor;
    if (keepName === "source" && source.customName) merge.customName = source.customName;
    if (Object.keys(merge).length) await prisma.device.update({ where: { id: target.id }, data: merge });

    await prisma.deviceHistory.create({
      data: {
        deviceId: target.id, event: "action_taken",
        data: { action: "merge", absorbed: { id: source.id, mac: source.mac, hostname: source.hostname } },
      },
    });

    // Now delete the source (its interfaces have already been moved)
    await prisma.device.delete({ where: { id: source.id } });

    const fresh = await prisma.device.findUnique({
      where: { id: targetId },
      include: { interfaces: true, ports: true, cves: true },
    });
    res.json(fresh);
  } catch (err: any) { res.status(400).json({ error: err.message }); }
});

export default router;
