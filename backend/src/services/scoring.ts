// 4-axis device scoring:
//   trustScore     — how well do we know this device, is it stable, validated?
//   activityScore  — recent suspicious behavior (port scans, brute force, anomalies)
//   vulnScore      — exposure: open ports, weak services, known CVEs
//   dangerScore    — final fused score, drives auto-quarantine/ban rules
//
// Higher = worse for activity/vuln/danger. Higher = better for trust.
// All scores clamped 0-100.

import { prisma } from "../db";
import { createAlert } from "./logger";
import { eventBus } from "../ws/realtime";

interface ScoreReasons {
  trust: { reason: string; delta: number }[];
  activity: { reason: string; delta: number }[];
  vuln: { reason: string; delta: number }[];
}

const RISKY_PORTS: Record<number, { points: number; reason: string }> = {
  21:    { points: 8,  reason: "FTP (cleartext)" },
  23:    { points: 18, reason: "Telnet (cleartext, deprecated)" },
  69:    { points: 8,  reason: "TFTP (no auth)" },
  111:   { points: 6,  reason: "Portmap/RPC exposed" },
  135:   { points: 8,  reason: "MS-RPC exposed" },
  139:   { points: 10, reason: "NetBIOS-SSN" },
  445:   { points: 14, reason: "SMB (verify v1 disabled)" },
  512:   { points: 16, reason: "rexec (deprecated)" },
  513:   { points: 16, reason: "rlogin (deprecated)" },
  514:   { points: 12, reason: "rsh / syslog UDP" },
  1433:  { points: 10, reason: "MSSQL exposed" },
  1900:  { points: 6,  reason: "UPnP/SSDP" },
  3306:  { points: 10, reason: "MySQL exposed" },
  3389:  { points: 14, reason: "RDP (brute-force target)" },
  5900:  { points: 14, reason: "VNC (often unencrypted)" },
  6379:  { points: 12, reason: "Redis (default no auth)" },
  9200:  { points: 8,  reason: "Elasticsearch" },
  27017: { points: 12, reason: "MongoDB" },
};

const KNOWN_VULNS = [
  { match: /OpenSSH 7\.[0-2]/i,         cve: "CVE-2016-0777",  cvss: 5.9, severity: "medium", description: "OpenSSH client info leak" },
  { match: /OpenSSH 8\.[0-3]/i,         cve: "CVE-2020-15778", cvss: 7.8, severity: "high",   description: "scp argument injection" },
  { match: /OpenSSH 8\.4/i,             cve: "CVE-2023-38408", cvss: 9.8, severity: "high",   description: "ssh-agent forwarding RCE" },
  { match: /Apache\/2\.4\.4[0-9]/i,     cve: "CVE-2021-41773", cvss: 7.5, severity: "high",   description: "Apache path traversal" },
  { match: /vsftpd\/2\.3\.4/i,          cve: "CVE-2011-2523",  cvss: 9.8, severity: "high",   description: "vsftpd backdoor" },
  { match: /Samba\s*3\./i,              cve: "CVE-2017-7494",  cvss: 9.8, severity: "high",   description: "SambaCry RCE" },
  { match: /microsoft.*iis\/[5-7]/i,    cve: "CVE-2017-7269",  cvss: 9.8, severity: "high",   description: "IIS WebDAV RCE" },
];

export interface DeviceScores { trustScore: number; activityScore: number; vulnScore: number; dangerScore: number; reasons: ScoreReasons }

export async function scoreDevice(deviceId: string): Promise<DeviceScores> {
  const device = await prisma.device.findUnique({
    where: { id: deviceId },
    include: { ports: true, history: { take: 50, orderBy: { createdAt: "desc" } } },
  });
  if (!device) throw new Error("Device not found");

  const reasons: ScoreReasons = { trust: [], activity: [], vuln: [] };

  // ── TRUST score ─────────────────────────────────────────────────────────
  // Start at 50, adjust based on stability and identification quality
  let trust = 50;

  if (device.whitelisted) { trust += 30; reasons.trust.push({ reason: "Whitelisted", delta: +30 }); }
  if (device.isMainRouter) { trust += 30; reasons.trust.push({ reason: "Main router (protected)", delta: +30 }); }

  if (device.vendor && device.vendor !== "Unknown") {
    trust += 15; reasons.trust.push({ reason: `Vendor identified: ${device.vendor}`, delta: +15 });
  } else {
    trust -= 20; reasons.trust.push({ reason: "Unknown vendor", delta: -20 });
  }
  if (device.hostname || (device.metadata as any)?.netbios || (device.metadata as any)?.mdnsName) {
    trust += 10; reasons.trust.push({ reason: "Hostname identified", delta: +10 });
  }
  if (!device.mac) { trust -= 15; reasons.trust.push({ reason: "No MAC detected", delta: -15 }); }

  // Stability: how long has it been seen?
  const ageMs = Date.now() - new Date(device.firstSeen).getTime();
  if (ageMs > 7 * 86_400_000) { trust += 15; reasons.trust.push({ reason: "Known for >1 week", delta: +15 }); }
  else if (ageMs > 86_400_000) { trust += 5; reasons.trust.push({ reason: "Known for >1 day", delta: +5 }); }
  else { trust -= 5; reasons.trust.push({ reason: "Newly discovered", delta: -5 }); }

  // IP changes are slightly suspicious
  const ipChanges = device.history.filter((h) => h.event === "ip_change").length;
  if (ipChanges > 3) { trust -= 10; reasons.trust.push({ reason: `${ipChanges} IP changes recently`, delta: -10 }); }

  trust = Math.max(0, Math.min(100, trust));

  // ── ACTIVITY score ─────────────────────────────────────────────────────
  // Looks at recent alerts targeting this device.
  let activity = 0;
  const recentAlerts = await prisma.alert.findMany({
    where: {
      OR: [{ deviceId: device.id }, { deviceIp: device.ip }, { deviceMac: device.mac || "" }],
      createdAt: { gt: new Date(Date.now() - 24 * 3600_000) },
    },
  });

  for (const alert of recentAlerts) {
    const sev = alert.severity.toLowerCase();
    let pts = 0;
    if (sev === "critical") pts = 25;
    else if (sev === "high") pts = 15;
    else if (sev === "medium") pts = 8;
    else if (sev === "low") pts = 3;
    if (pts) {
      activity += pts;
      reasons.activity.push({ reason: `${alert.source}: ${alert.message.slice(0, 60)}`, delta: pts });
    }
    if (activity > 100) { activity = 100; break; }
  }
  activity = Math.min(100, activity);

  // ── VULN score ─────────────────────────────────────────────────────────
  let vuln = 0;
  for (const p of device.ports) {
    if (p.state !== "open") continue;
    const r = RISKY_PORTS[p.port];
    if (r) { vuln += r.points; reasons.vuln.push({ reason: `Port ${p.port} open: ${r.reason}`, delta: r.points }); }
  }
  const openCount = device.ports.filter((p) => p.state === "open").length;
  if (openCount > 10) {
    const extra = Math.min(20, (openCount - 10) * 2);
    vuln += extra;
    reasons.vuln.push({ reason: `${openCount} open ports (excessive)`, delta: extra });
  }

  // CVE matches
  for (const p of device.ports) {
    const v = `${p.product || ""} ${p.version || ""}`.trim();
    if (!v) continue;
    for (const k of KNOWN_VULNS) {
      if (k.match.test(v)) {
        const pts = Math.round(k.cvss * 3);
        vuln += pts;
        reasons.vuln.push({ reason: `${k.cve} (CVSS ${k.cvss})`, delta: pts });
        await prisma.cveMatch.upsert({
          where: { id: `${deviceId}-${k.cve}` },
          update: { detectedAt: new Date() },
          create: {
            id: `${deviceId}-${k.cve}`,
            deviceId, cveId: k.cve, cvss: k.cvss, severity: k.severity,
            description: k.description, service: p.service,
          },
        }).catch(() => {});
      }
    }
  }
  vuln = Math.min(100, vuln);

  // ── DANGER (final fused) ──────────────────────────────────────────────
  // Weighted: activity is highest signal, vuln matters, trust is inverse.
  // Whitelist/main router cap danger at very low values.
  let danger;
  if (device.isMainRouter || device.whitelisted) {
    danger = Math.min(30, Math.round(vuln * 0.3 + activity * 0.2));
  } else {
    danger = Math.round(activity * 0.5 + vuln * 0.35 + (100 - trust) * 0.15);
  }
  danger = Math.max(0, Math.min(100, danger));

  // Persist
  const previous = device.dangerScore;
  await prisma.device.update({
    where: { id: deviceId },
    data: {
      trustScore: trust,
      activityScore: activity,
      vulnScore: vuln,
      dangerScore: danger,
      scoreReasons: reasons as any,
    },
  });

  // Alert on big danger jump
  if (danger >= 70 && previous < 70 && !device.isMainRouter) {
    await createAlert("high", "scoring", `Device danger score ${danger}: ${device.hostname || device.ip}`, {
      deviceId: device.id, deviceIp: device.ip, deviceMac: device.mac || undefined,
    });
  }

  eventBus.emit("device:updated", { id: deviceId, trustScore: trust, activityScore: activity, vulnScore: vuln, dangerScore: danger });
  return { trustScore: trust, activityScore: activity, vulnScore: vuln, dangerScore: danger, reasons };
}

export async function scoreAllDevices() {
  const devices = await prisma.device.findMany({ where: { status: { not: "offline" } }, select: { id: true } });
  for (const d of devices) {
    try { await scoreDevice(d.id); } catch {}
  }
}

export async function globalHealthScore(): Promise<number> {
  const devices = await prisma.device.findMany({ where: { status: { not: "offline" } } });
  if (devices.length === 0) return 100;
  const avgDanger = devices.reduce((s, d) => s + d.dangerScore, 0) / devices.length;
  return Math.max(0, 100 - Math.round(avgDanger));
}
