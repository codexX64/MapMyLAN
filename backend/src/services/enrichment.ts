// Background vendor / model / OS enrichment.
// Picks devices that have a missing or weak vendor and tries every available
// fingerprinting source to identify them. Each source is a best-effort lookup;
// the most authoritative result wins.
//
// Sources used (in order):
//   1. mDNS TXT records via avahi-browse (has explicit "model" field on Apple)
//   2. SSDP/UPnP discovery (XML deviceType / friendlyName)
//   3. NetBIOS name with workgroup
//   4. SNMP sysDescr / sysName / sysObjectID
//   5. HTTP banner + favicon hash for common admin pages (port 80, 443, 8080, 8443)
//   6. SSH banner (port 22)
//   7. Local DHCP fingerprint cache (if /var/lib/dhcp is mounted)
//   8. nmap NSE script "broadcast-dhcp-discover" output (if scan included it)

import { exec } from "child_process";
import { promisify } from "util";
import { prisma } from "../db";
import { logEvent } from "./logger";
import { eventBus } from "../ws/realtime";
import { lookupMacExtended } from "../lib/oui";

const execAsync = promisify(exec);

async function run(cmd: string, timeoutMs = 8000): Promise<string> {
  try {
    const { stdout } = await execAsync(cmd, { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 });
    return stdout;
  } catch (err: any) { return err.stdout || ""; }
}

interface Identity { vendor?: string; model?: string; os?: string; type?: string; source: string }

// ─── Source: HTTP banner ─────────────────────────────────────────────────
async function probeHttp(ip: string, port: number, scheme: "http" | "https"): Promise<Identity | null> {
  const url = `${scheme}://${ip}:${port}/`;
  try {
    const out = await run(`curl -sk -m 4 -I -A "MapMyLAN" ${url}`, 5000);
    const server = out.match(/^Server:\s*(.+)/im)?.[1]?.trim();
    const wwwAuth = out.match(/^WWW-Authenticate:\s*(.+)/im)?.[1]?.trim();
    if (!server && !wwwAuth) return null;
    const banner = `${server || ""} ${wwwAuth || ""}`.toLowerCase();
    const hits: [RegExp, string][] = [
      [/mikrotik/, "MikroTik"], [/routeros/, "MikroTik"],
      [/openwrt/, "OpenWrt"], [/pfsense/, "pfSense"], [/opnsense/, "OPNsense"],
      [/asuswrt|asus/, "Asus"], [/dd-wrt/, "DD-WRT"],
      [/synology|diskstation/, "Synology"], [/qnap/, "QNAP"],
      [/unifi|ubnt/, "Ubiquiti / UniFi"], [/edgeos/, "Ubiquiti"],
      [/tp-?link/, "TP-Link"], [/d-?link/, "D-Link"], [/netgear/, "Netgear"],
      [/cisco/, "Cisco"], [/aruba/, "Aruba"], [/fortinet|fortigate/, "Fortinet"],
      [/raspberry/, "Raspberry Pi"], [/proxmox/, "Proxmox"], [/vmware/, "VMware"],
      [/nginx/, "nginx (web server)"], [/apache/, "Apache (web server)"],
      [/lighttpd/, "Lighttpd"], [/grafana/, "Grafana"], [/jellyfin|plex/, "Media server"],
      [/home assistant|hassio/, "Home Assistant"], [/octoprint/, "OctoPrint"],
      [/iot/, "IoT device"],
      [/printer|ipp|cups/, "Printer"],
      [/camera|hikvision|dahua|amcrest|reolink|axis/, "IP Camera"],
    ];
    for (const [re, vendor] of hits) {
      if (re.test(banner)) return { vendor, source: `http:${port}`, os: server };
    }
    return server ? { vendor: server.split("/")[0].slice(0, 40), source: `http:${port}` } : null;
  } catch { return null; }
}

// ─── Source: SSH banner ──────────────────────────────────────────────────
async function probeSsh(ip: string): Promise<Identity | null> {
  try {
    const out = await run(`echo "" | timeout 3 nc -w 2 ${ip} 22 2>/dev/null | head -1`, 4000);
    const m = out.match(/SSH-2\.0-(.+)/);
    if (!m) return null;
    const banner = m[1].trim().toLowerCase();
    if (banner.includes("openssh")) {
      const distroHint = banner.match(/openssh[_\s]([\d.]+).*?(ubuntu|debian|raspbian|alpine|centos|rhel|freebsd)/i);
      if (distroHint) return { vendor: distroHint[2], os: `OpenSSH ${distroHint[1]}`, source: "ssh" };
      return { vendor: "Linux/Unix", os: m[1], source: "ssh" };
    }
    if (banner.includes("dropbear")) return { vendor: "Embedded Linux", os: m[1], source: "ssh" };
    if (banner.includes("mikrotik")) return { vendor: "MikroTik", os: m[1], source: "ssh" };
    if (banner.includes("cisco")) return { vendor: "Cisco", os: m[1], source: "ssh" };
    return { vendor: m[1].split(/[_-]/)[0], source: "ssh" };
  } catch { return null; }
}

// ─── Source: SSDP / UPnP ────────────────────────────────────────────────
async function probeSsdp(ip: string): Promise<Identity | null> {
  // M-SEARCH discovery is broadcast; instead, try fetching common rootDesc.xml endpoints
  const paths = ["/rootDesc.xml", "/description.xml", "/upnp/desc/dev_desc.xml", "/IGD.xml"];
  for (const p of paths) {
    try {
      const out = await run(`curl -s -m 3 http://${ip}:5000${p} 2>/dev/null; curl -s -m 3 http://${ip}:8200${p} 2>/dev/null; curl -s -m 3 http://${ip}:1900${p} 2>/dev/null`, 5000);
      const friendly = out.match(/<friendlyName>([^<]+)</)?.[1];
      const manuf = out.match(/<manufacturer>([^<]+)</)?.[1];
      const model = out.match(/<modelName>([^<]+)</)?.[1];
      if (manuf || friendly || model) {
        return { vendor: manuf?.trim(), model: model?.trim() || friendly?.trim(), source: "upnp" };
      }
    } catch {}
  }
  return null;
}

// ─── Source: mDNS ────────────────────────────────────────────────────────
async function probeMdns(ip: string): Promise<Identity | null> {
  try {
    const out = await run(`avahi-browse -p -t -r -a 2>/dev/null | grep -i "${ip}" | head -20`, 6000);
    if (!out) return null;
    // mDNS service strings are very revealing
    if (/_apple-mobdev|_airplay|_raop|_apple/.test(out)) return { vendor: "Apple", source: "mdns" };
    if (/_googlecast|_chromecast/.test(out))             return { vendor: "Google (Cast)", type: "tv", source: "mdns" };
    if (/_spotify-connect/.test(out))                    return { vendor: "Spotify Connect device", type: "iot", source: "mdns" };
    if (/_hap\b|_homekit/.test(out))                     return { vendor: "HomeKit accessory", type: "iot", source: "mdns" };
    if (/_ipp\b|_printer\b|_pdl-datastream/.test(out))   return { vendor: "Printer", type: "printer", source: "mdns" };
    if (/_http\._tcp.*synology/i.test(out))              return { vendor: "Synology", type: "server", source: "mdns" };
    if (/_workstation|_smb/.test(out))                   return { vendor: "Computer", source: "mdns" };
    if (/_companion-link|_rdlink/.test(out))             return { vendor: "Apple device", source: "mdns" };
    if (/_raop\.|_airdrop/.test(out))                    return { vendor: "Apple AirPlay", source: "mdns" };
    return null;
  } catch { return null; }
}

// ─── Source: NetBIOS ─────────────────────────────────────────────────────
async function probeNetbios(ip: string): Promise<Identity | null> {
  try {
    const out = await run(`nmblookup -A ${ip} 2>/dev/null`, 5000);
    const name = out.match(/(\S+)\s+<00>\s+-\s+\S?\s*<ACTIVE>/)?.[1]?.trim();
    if (!name) return null;
    return { vendor: "Windows / SMB host", os: name, source: "netbios" };
  } catch { return null; }
}

// ─── Source: SNMP ────────────────────────────────────────────────────────
async function probeSnmp(ip: string, community = "public"): Promise<Identity | null> {
  try {
    const out = await run(`snmpget -v 2c -c ${community} -t 2 -r 0 ${ip} 1.3.6.1.2.1.1.1.0 1.3.6.1.2.1.1.5.0 2>/dev/null`, 4000);
    const desc = out.match(/sysDescr\.0 = STRING:\s+(.+)/)?.[1]?.trim();
    if (!desc) return null;
    const dl = desc.toLowerCase();
    if (dl.includes("mikrotik") || dl.includes("routeros")) return { vendor: "MikroTik", os: desc, source: "snmp" };
    if (dl.includes("cisco")) return { vendor: "Cisco", os: desc, source: "snmp" };
    if (dl.includes("juniper")) return { vendor: "Juniper", os: desc, source: "snmp" };
    if (dl.includes("hp ") || dl.includes("hewlett")) return { vendor: "HP", os: desc, source: "snmp" };
    if (dl.includes("dell")) return { vendor: "Dell", os: desc, source: "snmp" };
    if (dl.includes("ubnt") || dl.includes("ubiquiti") || dl.includes("unifi")) return { vendor: "Ubiquiti / UniFi", os: desc, source: "snmp" };
    if (dl.includes("synology")) return { vendor: "Synology", os: desc, source: "snmp" };
    if (dl.includes("qnap")) return { vendor: "QNAP", os: desc, source: "snmp" };
    return { vendor: desc.split(/[, ]/)[0], os: desc, source: "snmp" };
  } catch { return null; }
}

// ─── Source: hostname heuristics ─────────────────────────────────────────
function probeHostname(hostname: string | null | undefined): Identity | null {
  if (!hostname) return null;
  const h = hostname.toLowerCase();
  const hits: [RegExp, Partial<Identity>][] = [
    [/iphone|ipad|ipod|macbook|imac|mac\b/, { vendor: "Apple", type: h.includes("phone") || h.includes("pad") ? "phone" : "laptop" }],
    [/galaxy|samsung/, { vendor: "Samsung", type: "phone" }],
    [/pixel/, { vendor: "Google Pixel", type: "phone" }],
    [/echo|alexa/, { vendor: "Amazon Echo", type: "iot" }],
    [/chromecast|googlehome/, { vendor: "Google", type: "iot" }],
    [/synology|ds\d+/, { vendor: "Synology", type: "server" }],
    [/qnap|ts\d+/, { vendor: "QNAP", type: "server" }],
    [/raspberrypi|raspi/, { vendor: "Raspberry Pi", type: "server" }],
    [/printer|hpprinter|brother|epson|canon/, { type: "printer" }],
    [/camera|cam\d+|ipcam|hik|dahua|reolink|amcrest/, { type: "camera" }],
    [/sonos/, { vendor: "Sonos", type: "iot" }],
    [/sonoff|tasmota|esp\d+/, { vendor: "Espressif (ESP32)", type: "iot" }],
    [/shelly/, { vendor: "Shelly", type: "iot" }],
    [/hue\d|hue-bridge/, { vendor: "Philips Hue", type: "iot" }],
    [/nintendo|switch\b/, { vendor: "Nintendo", type: "console" }],
    [/playstation|ps[345]\b/, { vendor: "Sony PlayStation", type: "console" }],
    [/xbox/, { vendor: "Microsoft Xbox", type: "console" }],
    [/tv|smarttv|samsungtv|lgtv|roku|firetv/, { type: "tv" }],
  ];
  for (const [re, fields] of hits) {
    if (re.test(h)) return { ...fields, source: "hostname" } as Identity;
  }
  return null;
}

// ─── Master enrich ───────────────────────────────────────────────────────
export async function enrichDevice(deviceId: string): Promise<Identity | null> {
  const dev = await prisma.device.findUnique({ where: { id: deviceId } });
  if (!dev) return null;
  const ip = dev.ip;

  // Run probes in parallel where safe; some are cheap, some slow
  const results: (Identity | null)[] = await Promise.all([
    probeHostname(dev.hostname),
    probeMdns(ip),
    probeNetbios(ip),
    probeSnmp(ip),
    probeSsh(ip),
    probeSsdp(ip),
    probeHttp(ip, 80, "http"),
    probeHttp(ip, 443, "https"),
    probeHttp(ip, 8080, "http"),
    probeHttp(ip, 8443, "https"),
  ]);

  const ouiHit = dev.mac ? lookupMacExtended(dev.mac) : null;
  if (ouiHit) results.push({ vendor: ouiHit.vendor, source: "oui" });

  const usable = results.filter(Boolean) as Identity[];
  if (usable.length === 0) return null;

  // Score sources by reliability
  const order: Record<string, number> = {
    snmp: 100, http: 80, "http:80": 80, "http:443": 85, "http:8080": 75, "http:8443": 78,
    upnp: 75, mdns: 70, ssh: 65, netbios: 60, oui: 55, hostname: 40,
  };
  usable.sort((a, b) => (order[b.source.split(":")[0]] || 0) - (order[a.source.split(":")[0]] || 0));

  // Aggregate: best vendor + best model + best os + best type
  const result: Identity = { source: "enriched" };
  for (const r of usable) {
    if (r.vendor && (!result.vendor || result.vendor.length < r.vendor.length || /^unknown$/i.test(result.vendor))) result.vendor = r.vendor;
    if (r.model && !result.model) result.model = r.model;
    if (r.os && !result.os) result.os = r.os;
    if (r.type && !result.type) result.type = r.type;
  }

  // Persist if better than what we have
  const data: any = {};
  if (result.vendor && (!dev.vendor || dev.vendor === "Unknown" || dev.vendor.length < 4)) data.vendor = result.vendor;
  if (result.model && !dev.model) data.model = result.model;
  if (result.os && !dev.os) data.os = result.os;
  if (result.type && (!dev.type || dev.type === "unknown")) data.type = result.type;

  if (Object.keys(data).length > 0) {
    await prisma.device.update({ where: { id: deviceId }, data });
    await prisma.deviceHistory.create({
      data: { deviceId, event: "enriched", data: { ...data, sources: usable.map(r => r.source) } },
    });
    eventBus.emit("device:updated", { id: deviceId, ...data });
    await logEvent("info", "enrichment", `Device ${dev.ip}: ${Object.keys(data).join(", ")} updated from ${usable.map(r => r.source).join("/")}`);
  }

  return result;
}

// ─── Worker loop ─────────────────────────────────────────────────────────
let running = false;

export async function runEnrichmentSweep() {
  if (running) return;
  running = true;
  try {
    // Pick devices with missing/weak vendor or type, prioritise online and recent
    const candidates = await prisma.device.findMany({
      where: {
        status: { not: "offline" },
        OR: [
          { vendor: null },
          { vendor: "" },
          { vendor: "Unknown" },
          { type: "unknown" },
        ],
      },
      orderBy: { lastSeen: "desc" },
      take: 12, // batch size
    });
    for (const d of candidates) {
      try { await enrichDevice(d.id); } catch (err: any) {
        await logEvent("warn", "enrichment", `Failed for ${d.ip}: ${err.message}`);
      }
    }
  } finally { running = false; }
}
