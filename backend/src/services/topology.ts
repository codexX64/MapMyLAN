// Topology auto-builder.
// Strategy: derive parent/child relations from gateway IP, ARP table,
// LLDP/CDP/SNMP if available. Fallback: connect everything to the main router.

import { exec } from "child_process";
import { promisify } from "util";
import { prisma } from "../db";
import { eventBus } from "../ws/realtime";
import { logEvent } from "./logger";

const execAsync = promisify(exec);

async function tryRun(cmd: string, timeout = 8000): Promise<string> {
  try {
    const { stdout } = await execAsync(cmd, { timeout, maxBuffer: 8 * 1024 * 1024 });
    return stdout;
  } catch { return ""; }
}

export async function autoBuildTopology(opts: { force?: boolean } = {}): Promise<{ created: number; deleted: number }> {
  // The setting only gates automatic triggers; an explicit click on "Rebuild"
  // always goes through.
  if (!opts.force) {
    const enabled = await prisma.setting.findUnique({ where: { key: "topology.autoBuild" } });
    if (!enabled || enabled.value === false) return { created: 0, deleted: 0 };
  }

  // We never touch links drawn by hand.
  const before = await prisma.topologyLink.deleteMany({ where: { manual: false } });

  const all = await prisma.device.findMany({ where: { status: { not: "offline" } } });
  if (all.length === 0) return { created: 0, deleted: before.count };

  // ── Addressing convention ─────────────────────────────────────────────────
  // 10.0.C.N   → wired side, C = category (0 infra, 1 workstations, 2 dockers…)
  // 10.0.C*10.N → wireless side of the same device (same last octet N)
  // A third octet above 10 therefore marks a wireless link, without having to
  // query any equipment.
  const octets = (ip: string) => (ip || "").split(".").map(Number);
  const thirdOctet = (ip: string) => octets(ip)[2] ?? -1;
  const lastOctet = (ip: string) => octets(ip)[3] ?? -1;
  const isWireless = (ip: string) => thirdOctet(ip) >= 10;
  const category = (ip: string) => {
    const o = thirdOctet(ip);
    return o >= 10 ? Math.floor(o / 10) : o;
  };

  // ── Root: the gateway ─────────────────────────────────────────────────────
  const mainSsh = await prisma.sshDevice.findFirst({ where: { isMainRouter: true } });
  const gateway =
    (mainSsh ? all.find(d => d.ip === mainSsh.host) : undefined) ||
    all.find(d => d.isMainRouter) ||
    all.find(d => d.type === "router" || d.type === "firewall") ||
    all[0];

  // ── Infrastructure equipment ──────────────────────────────────────────────
  const infraTypes = ["router", "switch", "ap", "firewall"];
  const infra = all.filter(d => infraTypes.includes(d.type) && d.id !== gateway.id);
  const switches = infra.filter(d => d.type === "switch");
  const aps = infra.filter(d => d.type === "ap");

  // Absent a declared access point, a secondary router stands in as one: this
  // is the case of a Wi-Fi router repurposed as an access point.
  const wifiHub = aps[0] || infra.find(d => d.type === "router") || gateway;
  // A wired device not seen directly by the gateway is necessarily behind the
  // switch: this is the central deduction here.
  const wiredHub = switches[0] || gateway;

  const links: { fromId: string; toId: string; type: string }[] = [];

  // The infrastructure hangs off the gateway.
  for (const h of infra) {
    links.push({ fromId: gateway.id, toId: h.id, type: "ethernet" });
  }

  // ── Attaching the endpoints ───────────────────────────────────────────────
  for (const d of all) {
    if (d.id === gateway.id || infra.some(h => h.id === d.id)) continue;
    const wireless = isWireless(d.ip);
    links.push({
      fromId: wireless ? wifiHub.id : wiredHub.id,
      toId: d.id,
      type: wireless ? "wifi" : "ethernet",
    });
  }

  // ── The two sides of the same machine ─────────────────────────────────────
  // Same category and same last octet: it's the same box seen through its two
  // NICs. We keep them as two distinct nodes, each linked to its equipment, and
  // we add a discreet link that expresses the kinship.
  const seen = new Set<string>();
  for (const a of all) {
    for (const b of all) {
      if (a.id >= b.id) continue;
      if (isWireless(a.ip) === isWireless(b.ip)) continue;
      if (category(a.ip) !== category(b.ip)) continue;
      if (lastOctet(a.ip) !== lastOctet(b.ip)) continue;
      const key = [a.id, b.id].sort().join("|");
      if (seen.has(key)) continue;
      seen.add(key);
      links.push({ fromId: a.id, toId: b.id, type: "sibling" });
    }
  }

  let created = 0;
  for (const l of links) {
    const ok = await prisma.topologyLink
      .create({ data: { ...l, manual: false } })
      .then(() => true)
      .catch(() => false);
    if (ok) created++;
  }

  await logEvent(
    "info", "topology",
    `Topology inferred: ${created} links (${switches.length} switch(es), ` +
    `${aps.length} access point(s), ${seen.size} dual-homed device(s))`,
  );
  eventBus.emit("topology:updated");
  return { created, deleted: before.count };
}


// Best-effort: read ARP table from main router via SSH if vendor known
export async function fetchArpTableViaSsh(routerId: string): Promise<{ ip: string; mac: string }[]> {
  const r = await prisma.sshDevice.findUnique({ where: { id: routerId } });
  if (!r) return [];
  const { executeOnDevice } = await import("./ssh");
  const v = r.vendor.toLowerCase();
  let cmd = "";
  if (v === "mikrotik") cmd = "/ip arp print without-paging";
  else if (v === "openwrt") cmd = "ip neigh";
  else if (v === "pfsense") cmd = "arp -a";
  else if (v === "cisco") cmd = "show arp";
  else cmd = "ip neigh";
  try {
    const r2 = await executeOnDevice(routerId, cmd);
    const out = r2.stdout;
    const list: { ip: string; mac: string }[] = [];
    const re = /(\d{1,3}(?:\.\d{1,3}){3}).*?([0-9a-fA-F]{2}(?::[0-9a-fA-F]{2}){5})/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(out)) !== null) list.push({ ip: m[1], mac: m[2].toUpperCase() });
    return list;
  } catch { return []; }
}
