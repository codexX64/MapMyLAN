// Device-type identification.
//
// The old version was a cascade of regexes that stopped at the first match: a
// Synology NAS exposing a web port ended up as "server", a camera as "iot", an
// Android TV box as "phone". No nuance, no notion of certainty.
//
// Here each signal (OUI vendor, mDNS service, open port, nmap banner, OS,
// NetBIOS) votes for one or more types with a weight. The type that collects
// the most points wins, and we keep the score to expose a confidence level.
// Strong, unambiguous signals — an mDNS `_hap` service announces a HomeKit
// accessory, an SNMP "ProCurve" banner announces an HP switch — weigh heavily;
// weak signals — "an open port 80" — weigh little.

export interface ClassifyInput {
  /** The device is the network gateway (DB flag or gateway IP). */
  isGateway?: boolean;
  /** Address, to recognize a gateway at .1 / .254 when no flag is set. */
  ip?: string;
  vendor?: string;
  os?: string;
  hostname?: string;
  netbios?: string;
  mdnsName?: string;
  mdnsServices?: string[];
  ports: { port: number; service?: string; product?: string; version?: string }[];
}

export interface ClassifyResult {
  type: string;
  confidence: number;      // 0..1
  runnerUp?: string;       // second most likely type, if close
  reasons: string[];       // signals that weighed in, for inspection
}

// Recognized types. The frontend's deviceIcon() already knows how to display them all.
export type DeviceType =
  | "router" | "firewall" | "switch" | "ap"
  | "server" | "nas" | "hypervisor" | "docker"
  | "pc" | "laptop" | "phone" | "tablet"
  | "printer" | "camera" | "tv" | "console"
  | "pi" | "iot" | "voip" | "unknown";

type Vote = { type: DeviceType; w: number; why: string };

// ── Signal table ────────────────────────────────────────────────────────────
// Each rule looks at one facet and pushes votes. We keep them separated by
// source so that adding a signal stays local and readable.

function voteVendor(v: string, out: Vote[]) {
  const push = (type: DeviceType, w: number, why: string) => out.push({ type, w, why });
  if (/\bmikrotik|routeros|edgerouter|ubnt\s*edge|draytek|zyxel\s*(usg|zywall)/.test(v)) push("router", 6, `vendor "${v}"`);
  if (/tp-link|tplink|archer|freebox|livebox|bbox|sfr\s*box|technicolor|sagemcom|arcadyan|askey/.test(v)
      && !/tl-sg|tl-sf|omada|eap\d/.test(v)) push("router", 5, `router or box "${v}"`);
  if (/pfsense|opnsense|fortinet|fortigate|sophos|palo\s*alto|watchguard|stormshield/.test(v)) push("firewall", 7, `firewall vendor "${v}"`);
  if (/\bunifi|ubiquiti\b/.test(v)) {
    // A Ubiquiti gateway (UDM, UXG) exposes 8443; an access point (UAP) doesn't.
    push("router", 4, "Ubiquiti gateway"); push("ap", 2, "Ubiquiti");
  }
  if (/aruba|ruckus|aerohive|meraki\s*mr|tp-link.*eap|engenius/.test(v)) push("ap", 5, `Wi-Fi access point "${v}"`);
  if (/cisco\s*catalyst|procurve|aruba\s*\d|netgear.*(gs|xs)|d-link.*(dgs|dxs)|juniper\s*ex/.test(v)) push("switch", 6, `switch "${v}"`);
  // Zyxel makes both firewalls and switches: we distinguish the product lines.
  // GS/XGS/XS/MG are switches, USG/ZyWALL are firewalls.
  if (/zyxel/.test(v) && !/usg|zywall/.test(v)) push("switch", 5, `Zyxel switch "${v}"`);
  if (/tp-link.*(tl-sg|tl-sf)|netgear.*(fs|jgs)|ubiquiti.*(usw|unifi switch)/.test(v)) push("switch", 5, `switch "${v}"`);
  if (/synology|qnap|truenas|ixsystems|asustor|terramaster|drobo/.test(v)) push("nas", 7, `NAS "${v}"`);
  if (/vmware|proxmox|nutanix|xenserver|hyper-v/.test(v)) push("hypervisor", 6, `hypervisor "${v}"`);
  if (/raspberry/.test(v)) push("pi", 7, "Raspberry Pi");
  if (/espressif|esp32|esp8266|sonoff|tuya|shelly|tasmota|nodemcu/.test(v)) push("iot", 6, `IoT chip "${v}"`);
  if (/nest|ring|wyze|reolink|hikvision|dahua|axis\s*comm|amcrest|ubiquiti.*cam/.test(v)) push("camera", 6, `camera "${v}"`);
  if (/sonos|denon|yamaha.*av|bose|harman/.test(v)) push("iot", 4, "connected audio");
  if (/roku|chromecast|nvidia\s*shield|apple\s*tv|firetv|fire\s*tv|lg\s*electronics|samsung.*(tv|display)|vizio/.test(v)) push("tv", 5, `TV "${v}"`);
  if (/sony.*(playstation|interactive)|nintendo|microsoft.*xbox/.test(v)) push("console", 7, `console "${v}"`);
  if (/apple/.test(v)) { push("laptop", 2, "Apple"); push("phone", 2, "Apple"); }
  if (/intel|dell|lenovo|asustek|asus\b|gigabyte|msi|hewlett|hp\s*inc|micro-star/.test(v)) push("pc", 3, `PC vendor "${v}"`);
  if (/brother|canon|epson|lexmark|kyocera|xerox|ricoh|hp.*(laserjet|officejet|deskjet)/.test(v)) push("printer", 6, `printer "${v}"`);
  if (/samsung.*(galaxy|sm-)|xiaomi|redmi|oneplus|oppo|vivo|huawei.*(p\d|mate)|google.*pixel|motorola/.test(v)) push("phone", 5, `phone "${v}"`);
}

function voteMdns(services: string[], out: Vote[]) {
  const s = services.join(" ").toLowerCase();
  const has = (re: RegExp) => re.test(s);
  if (has(/_hap\._tcp/)) out.push({ type: "iot", w: 6, why: "HomeKit accessory (_hap)" });
  if (has(/_airplay\._tcp|_raop\._tcp/)) out.push({ type: "tv", w: 4, why: "AirPlay" });
  if (has(/_googlecast\._tcp/)) out.push({ type: "tv", w: 5, why: "Chromecast" });
  if (has(/_ipp\._tcp|_printer\._tcp|_pdl-datastream/)) out.push({ type: "printer", w: 7, why: "print service (IPP)" });
  if (has(/_scanner\._tcp|_uscan/)) out.push({ type: "printer", w: 5, why: "network scanner" });
  if (has(/_smb\._tcp|_afpovertcp|_nfs\._tcp/)) out.push({ type: "nas", w: 4, why: "file sharing" });
  if (has(/_ssh\._tcp/)) out.push({ type: "server", w: 2, why: "SSH advertised" });
  if (has(/_rfb\._tcp/)) out.push({ type: "pc", w: 3, why: "remote desktop (VNC)" });
  if (has(/_sonos|_spotify-connect/)) out.push({ type: "iot", w: 4, why: "connected speaker" });
  if (has(/_companion-link|_apple-mobdev/)) out.push({ type: "phone", w: 3, why: "Apple mobile device" });
  if (has(/_esphome|_shelly|_tasmota/)) out.push({ type: "iot", w: 6, why: "home-automation firmware" });
  if (has(/_axis-video|_rtsp\._tcp|_onvif/)) out.push({ type: "camera", w: 6, why: "video stream (RTSP/ONVIF)" });
}

function votePorts(
  ports: { port: number; service?: string; product?: string; version?: string }[],
  out: Vote[],
) {
  const set = new Set(ports.map(p => p.port));
  const prod = ports.map(p => `${p.service || ""} ${p.product || ""}`.toLowerCase()).join(" ");
  const has = (...ns: number[]) => ns.every(n => set.has(n));
  const any = (...ns: number[]) => ns.some(n => set.has(n));

  // nmap banners: very telling when present.
  if (/mikrotik|routeros/.test(prod)) out.push({ type: "router", w: 6, why: "RouterOS banner" });
  if (/pfsense|opnsense|fortigate|pan-os/.test(prod)) out.push({ type: "firewall", w: 6, why: "firewall banner" });
  if (/dsm|synology|qts|quts/.test(prod)) out.push({ type: "nas", w: 6, why: "NAS banner" });
  if (/cups|ipp|jetdirect|printer/.test(prod)) out.push({ type: "printer", w: 5, why: "print service" });
  if (/rtsp|hikvision|dahua|onvif/.test(prod)) out.push({ type: "camera", w: 5, why: "camera service" });
  if (/esxi|vsphere|proxmox/.test(prod)) out.push({ type: "hypervisor", w: 6, why: "hypervisor banner" });
  if (/asterisk|freepbx|sip/.test(prod)) out.push({ type: "voip", w: 5, why: "SIP telephony" });

  // Port fingerprints.
  if (has(631) || any(9100, 515)) out.push({ type: "printer", w: 4, why: "printing ports" });
  if (any(554, 8554, 37777)) out.push({ type: "camera", w: 4, why: "RTSP/camera ports" });
  if (any(5060, 5061)) out.push({ type: "voip", w: 4, why: "SIP ports" });
  if (has(2375) || has(2376)) out.push({ type: "docker", w: 5, why: "Docker API exposed" });
  if (any(5000, 5001) && /synology|dsm/.test(prod)) out.push({ type: "nas", w: 3, why: "DSM interface" });
  if (has(445, 139)) out.push({ type: "pc", w: 2, why: "Windows sharing (SMB)" });
  if (has(3389)) out.push({ type: "pc", w: 3, why: "remote desktop (RDP)" });
  if (any(8006)) out.push({ type: "hypervisor", w: 4, why: "Proxmox interface" });
  if (any(902, 903)) out.push({ type: "hypervisor", w: 3, why: "VMware ports" });
  if (any(11434)) out.push({ type: "server", w: 3, why: "Ollama" });
  if (any(32400)) out.push({ type: "nas", w: 3, why: "Plex media server" });

  // Many services + SSH = general-purpose machine rather than a gadget.
  if (set.has(22) && ports.length >= 4) out.push({ type: "server", w: 2, why: "SSH + several services" });
}

function voteOs(os: string, out: Vote[]) {
  if (/windows\s*server/.test(os)) out.push({ type: "server", w: 4, why: "Windows Server" });
  else if (/windows/.test(os)) out.push({ type: "pc", w: 4, why: "Windows" });
  if (/android/.test(os)) out.push({ type: "phone", w: 3, why: "Android" });
  if (/\bios\b|iphone os/.test(os)) out.push({ type: "phone", w: 4, why: "iOS" });
  if (/ipados/.test(os)) out.push({ type: "tablet", w: 5, why: "iPadOS" });
  if (/mac\s*os|macos|darwin/.test(os)) out.push({ type: "laptop", w: 3, why: "macOS" });
  if (/linux|ubuntu|debian|centos|alpine|raspbian/.test(os)) out.push({ type: "server", w: 2, why: "Linux" });
  if (/raspbian|raspberry/.test(os)) out.push({ type: "pi", w: 5, why: "Raspberry Pi OS" });
  if (/vmware|esxi/.test(os)) out.push({ type: "hypervisor", w: 5, why: "ESXi" });
}

function voteHostname(name: string, out: Vote[]) {
  if (!name) return;
  const n = name.toLowerCase();
  if (/router|gateway|gw-|\brt-/.test(n)) out.push({ type: "router", w: 2, why: `name "${name}"` });
  if (/switch|\bsw-/.test(n)) out.push({ type: "switch", w: 2, why: `name "${name}"` });
  if (/\bap-|accesspoint|wifi/.test(n)) out.push({ type: "ap", w: 2, why: `name "${name}"` });
  if (/\bnas\b|synology|diskstation|truenas/.test(n)) out.push({ type: "nas", w: 3, why: `name "${name}"` });
  if (/docker|container/.test(n)) out.push({ type: "docker", w: 3, why: `name "${name}"` });
  if (/\bpi\b|raspberry|rpi/.test(n)) out.push({ type: "pi", w: 3, why: `name "${name}"` });
  if (/printer|imprimante|hp[-_]?[lo]j/.test(n)) out.push({ type: "printer", w: 3, why: `name "${name}"` });
  if (/cam|camera|ipcam|reolink/.test(n)) out.push({ type: "camera", w: 3, why: `name "${name}"` });
  if (/\btv\b|chromecast|firestick|appletv/.test(n)) out.push({ type: "tv", w: 3, why: `name "${name}"` });
  if (/iphone|ipad|galaxy|pixel|oneplus/.test(n)) out.push({ type: "phone", w: 3, why: `name "${name}"` });
  if (/macbook|laptop|thinkpad|portable/.test(n)) out.push({ type: "laptop", w: 3, why: `name "${name}"` });
  if (/desktop|pc-|workstation|bureau/.test(n)) out.push({ type: "pc", w: 2, why: `name "${name}"` });
}

export function classify(h: ClassifyInput): ClassifyResult {
  // Short-circuit: if the device is the gateway, it's a router, period. Many
  // consumer routers expose SMB, an admin web server or UPnP; without this
  // rule, those services tip the verdict toward "PC" or "server" even though
  // the device's function is beyond doubt.
  if (h.isGateway) {
    return {
      type: "router",
      confidence: 0.97,
      reasons: ["network gateway"],
    };
  }

  const votes: Vote[] = [];
  voteVendor((h.vendor || "").toLowerCase(), votes);
  voteMdns(h.mdnsServices || [], votes);
  votePorts(h.ports || [], votes);
  voteOs((h.os || "").toLowerCase(), votes);
  voteHostname(h.hostname || h.mdnsName || h.netbios || "", votes);

  if (votes.length === 0) {
    return { type: "unknown", confidence: 0, reasons: [] };
  }

  // Sum of weights per type.
  const score = new Map<string, number>();
  const why = new Map<string, string[]>();
  for (const v of votes) {
    score.set(v.type, (score.get(v.type) || 0) + v.w);
    why.set(v.type, [...(why.get(v.type) || []), v.why]);
  }

  const ranked = [...score.entries()].sort((a, b) => b[1] - a[1]);
  const [topType, topScore] = ranked[0];
  const runnerUp = ranked[1];
  const total = ranked.reduce((s, [, w]) => s + w, 0);

  // Confidence: the winner's share of the total, tempered by its margin over the runner-up.
  const share = topScore / total;
  const margin = runnerUp ? (topScore - runnerUp[1]) / topScore : 1;
  // A low total score = few signals: confidence is capped even if the winner
  // is the only contender. Evidence has to accumulate to be sure.
  const evidence = Math.min(1, total / 8);
  const raw = share * 0.55 + margin * 0.25 + evidence * 0.2;
  const confidence = Math.round(Math.min(1, raw) * 100) / 100;

  return {
    type: topType,
    confidence,
    runnerUp: runnerUp && runnerUp[1] >= topScore * 0.7 ? runnerUp[0] : undefined,
    reasons: why.get(topType) || [],
  };
}
