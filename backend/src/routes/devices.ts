import { Router } from "express";
import { prisma } from "../db";
import { computeGroupingSuggestions } from "../services/grouping";
import { dedupeDevices } from "../services/dedupe";
import { fullScan, pingHost, nmapDeepScan } from "../services/scanner";
import { scoreDevice, scoreAllDevices, globalHealthScore } from "../services/scoring";
import { banDevice, quarantineDevice, unbanDevice } from "../services/defense";
import { authRequired } from "../middleware/auth";
import { estIP, estMAC, estCIDR } from "../services/valider";

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

router.post("/scan", async (req, res) => {
  const subnet = req.body?.subnet as string | undefined;
  // The range flows down into a shell command (arp-scan/nmap). We refuse
  // anything that is not CIDR notation or an IP before launching the scan.
  if (subnet !== undefined && subnet !== null && subnet !== "" && !estCIDR(subnet) && !estIP(subnet)) {
    return res.status(400).json({ error: "Invalid range (expected: CIDR, e.g. 192.168.1.0/24)." });
  }
  fullScan(subnet || undefined).then(() => scoreAllDevices()).catch(console.error);
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
    // A device's IP and MAC end up in the scan and defense commands. Here we
    // refuse anything that does not have the expected format, rather than
    // storing a value that would become an injection vector on the first scan.
    if (ip && !estIP(ip)) {
      return res.status(400).json({ error: "Invalid IP address." });
    }
    if (mac && !estMAC(mac)) {
      return res.status(400).json({ error: "Invalid MAC address." });
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

// Manual cleanup of duplicate addresses.
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
