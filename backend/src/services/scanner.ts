// Multi-source network scanner.
// Combines: arp-scan + nmap (ping sweep + service detect + OS) + mDNS (avahi-browse)
// + NetBIOS (nmblookup) + SNMP (snmpget) for richest possible fingerprinting.
//
// Each host record is enriched as data flows in. Vendor lookup falls back to OUI table.

import { exec } from "child_process";
import { promisify } from "util";
import { prisma } from "../db";
import { config } from "../config";
import { nettoyerNom, nettoyerTexte, estIP, estMAC, estCIDR } from "./valider";
import { logEvent } from "./logger";
import { eventBus } from "../ws/realtime";
import { lookupMacExtended } from "../lib/oui";

const execAsync = promisify(exec);

// ── Anti-injection guard ────────────────────────────────────────────────────
//
// Scan commands are built by string interpolation and then executed by a shell
// (`exec`). An address or a range isn't typed into a form: it may come from a
// device created by hand, or from a value advertised on the network. An `ip`
// equal to `1.2.3.4; rm -rf /` would allow arbitrary command execution on the
// server host.
//
// We refuse by format: an IP must be an IP, a range must be a range. Nothing
// else reaches the shell. An SNMP community name is reduced to a safe
// character set.
function ipSur(ip: unknown): string {
  if (!estIP(ip)) throw new Error(`IP address refused (scan): ${JSON.stringify(String(ip)).slice(0, 60)}`);
  return ip as string;
}

function plageSure(subnet: unknown): string {
  if (typeof subnet === "string" && (estCIDR(subnet) || estIP(subnet))) return subnet;
  throw new Error(`Range refused (scan): ${JSON.stringify(String(subnet)).slice(0, 60)}`);
}

function communauteSure(c: unknown): string {
  const s = String(c ?? "public");
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(s)) throw new Error("SNMP community refused");
  return s;
}

async function run(cmd: string, timeoutMs = 120_000): Promise<string> {
  try {
    const { stdout } = await execAsync(cmd, { timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024 });
    return stdout;
  } catch (err: any) {
    // some tools exit nonzero but print useful output
    if (err.stdout) return err.stdout;
    throw err;
  }
}

import { classify } from "./classify";

export interface ScannedHost {
  ip: string;
  mac?: string;
  hostname?: string;
  vendor?: string;
  os?: string;
  netbios?: string;
  mdnsName?: string;
  mdnsServices?: string[];
  ports: { port: number; protocol: string; state: string; service?: string; product?: string; version?: string }[];
  /** Other MACs seen for the same IP (multi-NIC machine, bridge) — informational. */
  altMacs?: string[];
}

// ─── Layer 2 discovery ───────────────────────────────────────────────────────
//
// arp-scan failed systematically: without an explicit interface, --localnet
// doesn't know which one to pick on a host that carries a dozen Docker bridges.
// So we derive the interface that actually owns the targeted subnet, and we
// provide two fallbacks: the kernel's neighbor table, then the ARP table of the
// network equipment itself, which sees the silent devices we miss.

let cachedIface: string | null = null;

async function ifaceForSubnet(subnet: string): Promise<string | null> {
  if (config.scan.iface) return config.scan.iface;
  if (cachedIface) return cachedIface;
  try {
    const out = await run("ip -4 -o addr show", 8_000);
    for (const line of out.split("\n")) {
      const m = line.match(/^\d+:\s+(\S+)\s+inet\s+(\d{1,3}(?:\.\d{1,3}){3})/);
      if (m && ipInSubnet(m[2], subnet) && !/^(lo|docker|br-|veth)/.test(m[1])) {
        cachedIface = m[1];
        return cachedIface;
      }
    }
  } catch { /* we'll try without an interface */ }
  return null;
}

// Tests whether an IP belongs to the CIDR subnet. A three-octet filter
// ("10.0.2.") missed any /22 or /19 that spilled over the third octet.
function ipInSubnet(ip: string, subnet: string): boolean {
  const [net, bitsStr] = subnet.split("/");
  const bits = Number(bitsStr) || 24;
  const toInt = (a: string) => a.split(".").reduce((acc, o) => (acc << 8) + (Number(o) & 255), 0) >>> 0;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (toInt(ip) & mask) === (toInt(net) & mask);
}

function parseArpScan(out: string): ScannedHost[] {
  // An IP that answers with several MACs ("DUP: n" lines) is NOT several
  // devices: it's a multi-NIC machine, or a bridge echoing back. So we group by
  // IP and keep only one entry. The MAC we retain is preferentially the one
  // whose vendor is identified — more telling than an unknown OUI — and
  // otherwise the first one seen.
  const byIp = new Map<string, { mac: string; vendor?: string; alt: string[] }>();

  for (const line of out.split("\n")) {
    const m = line.match(/^(\d{1,3}(?:\.\d{1,3}){3})\s+([0-9a-fA-F:]{17})(?:\s+(.+))?/);
    if (!m) continue;
    const ip = m[1];
    const mac = m[2].toUpperCase();
    // Strip the "(DUP: n)" label that arp-scan sticks after the vendor.
    const vendorRaw = (m[3] || "").replace(/\s*\(DUP:\s*\d+\)\s*$/i, "").trim();
    const vendor = vendorRaw && !/^\(unknown\)$/i.test(vendorRaw) ? vendorRaw : undefined;

    const cur = byIp.get(ip);
    if (!cur) {
      byIp.set(ip, { mac, vendor, alt: [] });
    } else {
      cur.alt.push(mac);
      // Replace the retained MAC only if the new one has a known vendor where
      // the current one didn't.
      if (vendor && !cur.vendor) { cur.mac = mac; cur.vendor = vendor; }
    }
  }

  return [...byIp.entries()].map(([ip, e]) => ({
    ip, mac: e.mac, vendor: e.vendor, ports: [],
    // The other MACs for the same IP are kept for information: they are
    // secondary NICs of the same device, not separate machines.
    altMacs: e.alt.length ? [...new Set(e.alt)] : undefined,
  }));
}

// Kernel neighbor table: doesn't trigger discovery but returns everything the
// host has learned recently.
async function neighbourTable(subnet: string): Promise<ScannedHost[]> {
  try {
    const out = await run("ip neigh show", 8_000);
    return out.split("\n").map(l => {
      const m = l.match(/^(\d{1,3}(?:\.\d{1,3}){3})\s+.*lladdr\s+([0-9a-fA-F:]{17})/);
      if (!m || !ipInSubnet(m[1], subnet)) return null;
      if (/FAILED|INCOMPLETE/.test(l)) return null;
      return { ip: m[1], mac: m[2].toUpperCase(), ports: [] } as ScannedHost;
    }).filter(Boolean) as ScannedHost[];
  } catch { return []; }
}

// Last resort: ask the network equipment what it sees.
async function routerArpTable(): Promise<ScannedHost[]> {
  try {
    const { mainRouter } = await import("../adapters");
    const { adapter, ctx } = await mainRouter();
    if (!adapter.arp) return [];
    const entries = await adapter.arp(ctx);
    return entries.filter(e => e.ip && e.mac).map(e => ({
      ip: e.ip!, mac: e.mac!.toUpperCase(), vendor: e.vendor, ports: [],
    }));
  } catch { return []; }
}

export async function arpScan(subnet: string = config.scan.subnet): Promise<ScannedHost[]> {
  subnet = plageSure(subnet);
  const iface = await ifaceForSubnet(subnet);
  const attempts = [
    iface ? `arp-scan -I ${iface} -q ${subnet}` : null,
    `arp-scan -q ${subnet}`,
    `arp-scan -q --localnet`,
  ].filter(Boolean) as string[];

  for (const cmd of attempts) {
    try {
      const hosts = parseArpScan(await run(cmd, 60_000));
      if (hosts.length) {
        if (cmd !== attempts[0]) await logEvent("info", "scanner", `arp-scan via repli : ${cmd}`);
        return hosts;
      }
    } catch { /* try the next variant */ }
  }

  const neigh = await neighbourTable(subnet);
  if (neigh.length) {
    await logEvent("info", "scanner", `arp-scan unavailable, ${neigh.length} neighbors read from the kernel`);
    return neigh;
  }

  const fromRouter = await routerArpTable();
  if (fromRouter.length) {
    await logEvent("info", "scanner", `arp-scan unavailable, ${fromRouter.length} entries read from the router`);
    return fromRouter;
  }

  await logEvent("warn", "scanner", "No layer 2 discovery: neither arp-scan, nor kernel neighbors, nor router");
  return [];
}

// ─── nmap ping sweep ─────────────────────────────────────────────────────────
export async function nmapPingSweep(subnet: string = config.scan.subnet): Promise<ScannedHost[]> {
  subnet = plageSure(subnet);
  const cmd = `nmap -sn -n -PE -PA80,443 -PS22,80,443 -T4 --max-retries 1 ${subnet} -oG -`;
  try {
    const out = await run(cmd, 60_000);
    const hosts: ScannedHost[] = [];
    for (const line of out.split("\n")) {
      const m = line.match(/^Host:\s+(\S+)\s+\(([^)]*)\)\s+Status:\s+Up/);
      if (m) hosts.push({ ip: m[1], hostname: m[2] || undefined, ports: [] });
    }
    return hosts;
  } catch (err: any) {
    await logEvent("warn", "scanner", `nmap ping sweep failed: ${err.message}`);
    return [];
  }
}

// ─── nmap deep scan: ports, service, OS guess ────────────────────────────────
export async function nmapDeepScan(ip: string): Promise<ScannedHost> {
  ip = ipSur(ip);
  const cmd = `nmap -F -sV -O --osscan-guess -T4 --max-retries 2 --host-timeout 60s -n ${ip}`;
  const out = await run(cmd, 90_000);
  const host: ScannedHost = { ip, ports: [] };

  const macMatch = out.match(/MAC Address:\s+([0-9A-F:]{17})\s*(?:\((.+?)\))?/i);
  if (macMatch) {
    host.mac = macMatch[1].toUpperCase();
    if (macMatch[2]) host.vendor = macMatch[2];
  }
  const osMatch = out.match(/OS details:\s+(.+)/);
  const runningMatch = out.match(/Running:\s+(.+)/);
  if (osMatch) host.os = osMatch[1].trim();
  else if (runningMatch) host.os = runningMatch[1].trim();

  const portRe = /^(\d+)\/(tcp|udp)\s+(\w+)\s+(\S+)(?:\s+(.+))?/gm;
  let pm: RegExpExecArray | null;
  while ((pm = portRe.exec(out)) !== null) {
    if (!pm[3].startsWith("open")) continue;
    const versionStr = (pm[5] || "").trim();
    const versionParts = versionStr.match(/^(\S+)\s*(.*)$/);
    host.ports.push({
      port: parseInt(pm[1]), protocol: pm[2], state: pm[3],
      service: pm[4],
      product: versionParts?.[1],
      version: versionParts?.[2],
    });
  }
  return host;
}

// ─── mDNS (Avahi) — discover Apple, IoT, printers ───────────────────────────
export async function mdnsBrowse(): Promise<Record<string, { name?: string; services: string[] }>> {
  try {
    // -p parsable, -t terminate, -r resolve
    const out = await run(`avahi-browse -p -t -r -a 2>/dev/null || true`, 15_000);
    const map: Record<string, { name?: string; services: string[] }> = {};
    for (const line of out.split("\n")) {
      // Format: =;eth0;IPv4;<service>;<type>;<domain>;<host>;<addr>;<port>;<txt>
      if (!line.startsWith("=;")) continue;
      const parts = line.split(";");
      const service = parts[3], host = parts[6], addr = parts[7];
      if (!addr) continue;
      if (!map[addr]) map[addr] = { name: host?.replace(/\.local$/, ""), services: [] };
      if (service) map[addr].services.push(service);
    }
    return map;
  } catch { return {}; }
}

// ─── NetBIOS — Windows machine names ────────────────────────────────────────
export async function netbiosLookup(ip: string): Promise<string | null> {
  try {
    ip = ipSur(ip);
    const out = await run(`nmblookup -A ${ip} 2>/dev/null || true`, 6_000);
    // Look for the NetBIOS name (00) <ACTIVE>
    const m = out.match(/(\S+)\s+<00>\s+-\s+\S?\s*<ACTIVE>/);
    return m ? m[1].trim() : null;
  } catch { return null; }
}

// ─── SNMP sysDescr ──────────────────────────────────────────────────────────
export async function snmpProbe(ip: string, community = "public"): Promise<{ sysDescr?: string; sysName?: string }> {
  try {
    ip = ipSur(ip);
    community = communauteSure(community);
    const out = await run(`snmpget -v 2c -c ${community} -t 2 -r 0 ${ip} 1.3.6.1.2.1.1.1.0 1.3.6.1.2.1.1.5.0 2>/dev/null || true`, 5_000);
    const sysDescr = out.match(/SNMPv2-MIB::sysDescr\.0 = STRING:\s+(.+)/)?.[1]?.trim();
    const sysName = out.match(/SNMPv2-MIB::sysName\.0 = STRING:\s+(.+)/)?.[1]?.trim();
    return { sysDescr, sysName };
  } catch { return {}; }
}

// ─── Heuristic device-type classifier ───────────────────────────────────────

// The system's default gateway address. Used to recognize the router even when
// no device has yet been marked as such in the database.
let cachedGateway: string | null | undefined;
async function defaultGateway(): Promise<string | null> {
  if (cachedGateway !== undefined) return cachedGateway;
  try {
    const out = await run("ip route show default", 5_000);
    const m = out.match(/default\s+via\s+(\d{1,3}(?:\.\d{1,3}){3})/);
    cachedGateway = m ? m[1] : null;
  } catch { cachedGateway = null; }
  return cachedGateway;
}

function classifyType(h: ScannedHost, isGateway = false): { type: string; confidence: number; reasons: string[]; runnerUp?: string } {
  return classify({
    isGateway,
    ip: h.ip,
    vendor: h.vendor, os: h.os, hostname: h.hostname,
    netbios: h.netbios, mdnsName: h.mdnsName, mdnsServices: h.mdnsServices,
    ports: h.ports.map(p => ({ port: p.port, service: p.service, product: p.product, version: p.version })),
  });
}

// ─── Merge: combine all sources into final host record ──────────────────────
function mergeHost(base: ScannedHost, deep?: ScannedHost, mdns?: { name?: string; services: string[] }, netbios?: string | null, snmp?: { sysDescr?: string; sysName?: string }): ScannedHost {
  const merged: ScannedHost = {
    ...base,
    ...(deep || {}),
    mac: deep?.mac || base.mac,
    vendor: deep?.vendor || base.vendor,
    hostname: deep?.hostname || base.hostname || mdns?.name || netbios || snmp?.sysName,
    os: deep?.os || base.os || snmp?.sysDescr,
    ports: deep?.ports || base.ports || [],
    mdnsName: mdns?.name,
    mdnsServices: mdns?.services,
    netbios: netbios || undefined,
  };

  // OUI lookup if vendor still unknown
  if ((!merged.vendor || /^unknown$/i.test(merged.vendor)) && merged.mac) {
    const ouiHit = lookupMacExtended(merged.mac);
    if (ouiHit) merged.vendor = ouiHit.vendor;
  }
  return merged;
}

// ─── Persist to DB ──────────────────────────────────────────────────────────
async function persistHost(h: ScannedHost): Promise<string | null> {
  if (!h.mac && !h.ip) return null;

  // Match strategy: prefer MAC, but fall back to IP so that a host whose MAC
  // changed (USB-C adapter, failover, randomized MAC) updates the SAME device
  // instead of spawning a duplicate. One IP must map to one device.
  let existing = h.mac
    ? await prisma.device.findUnique({ where: { mac: h.mac } })
    : null;
  if (!existing && h.ip) {
    existing = await prisma.device.findFirst({ where: { ip: h.ip } });
  }

  // A device is the gateway if it carries the default-route address, or if it
  // has already been marked as the main router in the database.
  const gw = await defaultGateway();
  const flagged = await prisma.device.findFirst({
    where: { ip: h.ip, isMainRouter: true }, select: { id: true },
  }).catch(() => null);
  const isGateway = (!!gw && gw === h.ip) || !!flagged;

  const cls = classifyType(h, isGateway);
  const data: any = {
    ip: h.ip,
    mac: h.mac,
    hostname: h.hostname,
    vendor: h.vendor,
    os: h.os,
    type: cls.type,
    status: "online" as const,
    lastSeen: new Date(),
    metadata: {
      mdnsName: h.mdnsName,
      mdnsServices: h.mdnsServices,
      netbios: h.netbios,
      typeConfidence: cls.confidence,
      typeReasons: cls.reasons,
      typeRunnerUp: cls.runnerUp,
    },
  };

  let device;
  if (existing) {
    // History entry on IP change
    if (existing.ip !== h.ip) {
      await prisma.deviceHistory.create({
        data: { deviceId: existing.id, event: "ip_change", data: { from: existing.ip, to: h.ip } },
      });
    }
    // History entry on MAC change (and only overwrite MAC if we actually have one)
    if (h.mac && existing.mac && existing.mac !== h.mac) {
      await prisma.deviceHistory.create({
        data: { deviceId: existing.id, event: "mac_change", data: { from: existing.mac, to: h.mac } },
      });
    }
    // Don't blank an existing MAC with null if this scan didn't resolve one
    if (!h.mac) data.mac = existing.mac;
    device = await prisma.device.update({ where: { id: existing.id }, data });
  } else if (h.mac) {
    device = await prisma.device.create({ data });
    await prisma.deviceHistory.create({
      data: { deviceId: device.id, event: "first_seen", data: { ip: h.ip, vendor: h.vendor || "Unknown" } },
    });
    eventBus.emit("alert:new", { newDevice: true, device });
    // Fire user notification commands (best-effort, non-blocking)
    const { fireCommand } = await import("./commands");
    fireCommand("device.new", {
      deviceId: device.id, ip: device.ip, mac: device.mac,
      vendor: device.vendor || "Unknown", hostname: device.hostname || "",
      type: device.type,
    }).catch(() => {});
    if (!device.vendor || device.vendor === "Unknown") {
      fireCommand("device.unknown_vendor", { deviceId: device.id, ip: device.ip, mac: device.mac }).catch(() => {});
    }
    if (device.type === "iot") {
      fireCommand("device.iot", { deviceId: device.id, ip: device.ip, name: device.hostname || device.ip, vendor: device.vendor }).catch(() => {});
    }
  } else {
    return null;
  }

  if (h.ports.length > 0) {
    await prisma.port.deleteMany({ where: { deviceId: device.id } });
    await prisma.port.createMany({
      data: h.ports.map((p) => ({
        deviceId: device.id, port: p.port, protocol: p.protocol, state: p.state,
        service: p.service, product: p.product, version: p.version,
      })),
    });
  }
  return device.id;
}

// ─── Master orchestration ───────────────────────────────────────────────────
export async function fullScan(subnet?: string): Promise<{ hostsFound: number; runId: string }> {
  const target = subnet || config.scan.subnet;
  const run = await prisma.scanRun.create({ data: { type: "full", subnet: target, status: "running" } });
  await logEvent("info", "scanner", `Full scan started on ${target}`);
  eventBus.emit("scan:started", { runId: run.id, subnet: target });

  try {
    // Phase 1: ARP + ping in parallel
    const [arp, ping, mdnsMap] = await Promise.all([
      arpScan(target),
      nmapPingSweep(target),
      mdnsBrowse(),
    ]);

    // Merge unique IPs
    const byIp = new Map<string, ScannedHost>();
    for (const h of arp) byIp.set(h.ip, h);
    for (const h of ping) {
      if (byIp.has(h.ip)) Object.assign(byIp.get(h.ip)!, { hostname: h.hostname || byIp.get(h.ip)!.hostname });
      else byIp.set(h.ip, h);
    }
    const hosts = Array.from(byIp.values());

    eventBus.emit("scan:progress", { runId: run.id, phase: "discovery", hostsFound: hosts.length });

    // Phase 2: deep scan + NetBIOS + SNMP, in parallel batches
    const concurrency = 5;
    const enriched: ScannedHost[] = [];
    for (let i = 0; i < hosts.length; i += concurrency) {
      const batch = hosts.slice(i, i + concurrency);
      const results = await Promise.all(batch.map(async (h) => {
        const [deep, nb, snmp] = await Promise.all([
          nmapDeepScan(h.ip).catch(() => undefined),
          netbiosLookup(h.ip).catch(() => null),
          snmpProbe(h.ip).catch(() => ({})),
        ]);
        return mergeHost(h, deep, mdnsMap[h.ip], nb, snmp);
      }));
      enriched.push(...results);
      eventBus.emit("scan:progress", { runId: run.id, phase: "enriching", done: enriched.length, total: hosts.length });
    }

    // Persist
    const ids: string[] = [];
    for (const h of enriched) {
      const id = await persistHost(h);
      if (id) ids.push(id);
    }

    // Mark stale offline
    const cutoff = new Date(Date.now() - 10 * 60_000);
    await prisma.device.updateMany({
      where: { lastSeen: { lt: cutoff }, status: "online" },
      data: { status: "offline" },
    });

    await prisma.scanRun.update({
      where: { id: run.id },
      data: { status: "complete", hostsFound: enriched.length, endedAt: new Date() },
    });
    await logEvent("success", "scanner", `Full scan complete: ${enriched.length} hosts`);
    eventBus.emit("scan:complete", { runId: run.id, hostsFound: enriched.length });
    eventBus.emit("devices:updated");

    return { hostsFound: enriched.length, runId: run.id };
  } catch (err: any) {
    await prisma.scanRun.update({
      where: { id: run.id },
      data: { status: "failed", error: err.message, endedAt: new Date() },
    });
    await logEvent("error", "scanner", `Scan failed: ${err.message}`);
    throw err;
  }
}

export async function pingHost(ip: string): Promise<{ alive: boolean; latencyMs?: number }> {
  try {
    ip = ipSur(ip);
    const out = await run(`ping -c 2 -W 1 ${ip}`, 5_000);
    const m = out.match(/min\/avg\/max\/(?:mdev|stddev)\s*=\s*[\d.]+\/([\d.]+)/);
    return { alive: true, latencyMs: m ? parseFloat(m[1]) : undefined };
  } catch { return { alive: false }; }
}
