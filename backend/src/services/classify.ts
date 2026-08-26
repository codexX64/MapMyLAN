// Identification du type de matériel.
//
// L'ancienne version était une cascade de regex qui s'arrêtait au premier
// match : un NAS Synology qui exposait un port web tombait en « server », une
// caméra en « iot », une box Android TV en « phone ». Aucune nuance, aucune
// notion de certitude.
//
// Ici chaque signal (fabricant OUI, service mDNS, port ouvert, bannière nmap,
// OS, NetBIOS) vote pour un ou plusieurs types avec un poids. Le type qui
// récolte le plus de points gagne, et on garde le score pour exposer une
// confiance. Les signaux forts et non ambigus — un service mDNS `_hap` annonce
// un accessoire HomeKit, une bannière SNMP « ProCurve » annonce un switch HP —
// pèsent lourd ; les signaux faibles — « un port 80 ouvert » — pèsent peu.

export interface ClassifyInput {
  /** L'appareil est la passerelle du réseau (drapeau base ou IP de gateway). */
  isGateway?: boolean;
  /** Adresse, pour reconnaître une passerelle en .1 / .254 à défaut de drapeau. */
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
  runnerUp?: string;       // deuxième type le plus probable, si proche
  reasons: string[];       // signaux qui ont pesé, pour l'inspection
}

// Types reconnus. deviceIcon() côté frontend sait déjà tous les afficher.
export type DeviceType =
  | "router" | "firewall" | "switch" | "ap"
  | "server" | "nas" | "hypervisor" | "docker"
  | "pc" | "laptop" | "phone" | "tablet"
  | "printer" | "camera" | "tv" | "console"
  | "pi" | "iot" | "voip" | "unknown";

type Vote = { type: DeviceType; w: number; why: string };

// ── Table de signaux ────────────────────────────────────────────────────────
// Chaque règle regarde une facette et pousse des votes. On les tient séparées
// par source pour que l'ajout d'un signal reste local et lisible.

function voteVendor(v: string, out: Vote[]) {
  const push = (type: DeviceType, w: number, why: string) => out.push({ type, w, why });
  if (/\bmikrotik|routeros|edgerouter|ubnt\s*edge|draytek|zyxel\s*(usg|zywall)/.test(v)) push("router", 6, `fabricant « ${v} »`);
  if (/tp-link|tplink|archer|freebox|livebox|bbox|sfr\s*box|technicolor|sagemcom|arcadyan|askey/.test(v)
      && !/tl-sg|tl-sf|omada|eap\d/.test(v)) push("router", 5, `box ou routeur « ${v} »`);
  if (/pfsense|opnsense|fortinet|fortigate|sophos|palo\s*alto|watchguard|stormshield/.test(v)) push("firewall", 7, `fabricant pare-feu « ${v} »`);
  if (/\bunifi|ubiquiti\b/.test(v)) {
    // Une passerelle Ubiquiti (UDM, UXG) expose 8443 ; une borne (UAP) non.
    push("router", 4, "passerelle Ubiquiti"); push("ap", 2, "Ubiquiti");
  }
  if (/aruba|ruckus|aerohive|meraki\s*mr|tp-link.*eap|engenius/.test(v)) push("ap", 5, `borne Wi-Fi « ${v} »`);
  if (/cisco\s*catalyst|procurve|aruba\s*\d|netgear.*(gs|xs)|d-link.*(dgs|dxs)|juniper\s*ex/.test(v)) push("switch", 6, `switch « ${v} »`);
  // Zyxel fabrique aussi bien des pare-feu que des switchs : on distingue les
  // gammes. GS/XGS/XS/MG sont des commutateurs, USG/ZyWALL des pare-feu.
  if (/zyxel/.test(v) && !/usg|zywall/.test(v)) push("switch", 5, `switch Zyxel « ${v} »`);
  if (/tp-link.*(tl-sg|tl-sf)|netgear.*(fs|jgs)|ubiquiti.*(usw|unifi switch)/.test(v)) push("switch", 5, `switch « ${v} »`);
  if (/synology|qnap|truenas|ixsystems|asustor|terramaster|drobo/.test(v)) push("nas", 7, `NAS « ${v} »`);
  if (/vmware|proxmox|nutanix|xenserver|hyper-v/.test(v)) push("hypervisor", 6, `hyperviseur « ${v} »`);
  if (/raspberry/.test(v)) push("pi", 7, "Raspberry Pi");
  if (/espressif|esp32|esp8266|sonoff|tuya|shelly|tasmota|nodemcu/.test(v)) push("iot", 6, `puce IoT « ${v} »`);
  if (/nest|ring|wyze|reolink|hikvision|dahua|axis\s*comm|amcrest|ubiquiti.*cam/.test(v)) push("camera", 6, `caméra « ${v} »`);
  if (/sonos|denon|yamaha.*av|bose|harman/.test(v)) push("iot", 4, "audio connecté");
  if (/roku|chromecast|nvidia\s*shield|apple\s*tv|firetv|fire\s*tv|lg\s*electronics|samsung.*(tv|display)|vizio/.test(v)) push("tv", 5, `téléviseur « ${v} »`);
  if (/sony.*(playstation|interactive)|nintendo|microsoft.*xbox/.test(v)) push("console", 7, `console « ${v} »`);
  if (/apple/.test(v)) { push("laptop", 2, "Apple"); push("phone", 2, "Apple"); }
  if (/intel|dell|lenovo|asustek|asus\b|gigabyte|msi|hewlett|hp\s*inc|micro-star/.test(v)) push("pc", 3, `fabricant PC « ${v} »`);
  if (/brother|canon|epson|lexmark|kyocera|xerox|ricoh|hp.*(laserjet|officejet|deskjet)/.test(v)) push("printer", 6, `imprimante « ${v} »`);
  if (/samsung.*(galaxy|sm-)|xiaomi|redmi|oneplus|oppo|vivo|huawei.*(p\d|mate)|google.*pixel|motorola/.test(v)) push("phone", 5, `mobile « ${v} »`);
}

function voteMdns(services: string[], out: Vote[]) {
  const s = services.join(" ").toLowerCase();
  const has = (re: RegExp) => re.test(s);
  if (has(/_hap\._tcp/)) out.push({ type: "iot", w: 6, why: "accessoire HomeKit (_hap)" });
  if (has(/_airplay\._tcp|_raop\._tcp/)) out.push({ type: "tv", w: 4, why: "AirPlay" });
  if (has(/_googlecast\._tcp/)) out.push({ type: "tv", w: 5, why: "Chromecast" });
  if (has(/_ipp\._tcp|_printer\._tcp|_pdl-datastream/)) out.push({ type: "printer", w: 7, why: "service d'impression (IPP)" });
  if (has(/_scanner\._tcp|_uscan/)) out.push({ type: "printer", w: 5, why: "scanner réseau" });
  if (has(/_smb\._tcp|_afpovertcp|_nfs\._tcp/)) out.push({ type: "nas", w: 4, why: "partage de fichiers" });
  if (has(/_ssh\._tcp/)) out.push({ type: "server", w: 2, why: "SSH annoncé" });
  if (has(/_rfb\._tcp/)) out.push({ type: "pc", w: 3, why: "bureau à distance (VNC)" });
  if (has(/_sonos|_spotify-connect/)) out.push({ type: "iot", w: 4, why: "enceinte connectée" });
  if (has(/_companion-link|_apple-mobdev/)) out.push({ type: "phone", w: 3, why: "appareil Apple mobile" });
  if (has(/_esphome|_shelly|_tasmota/)) out.push({ type: "iot", w: 6, why: "firmware domotique" });
  if (has(/_axis-video|_rtsp\._tcp|_onvif/)) out.push({ type: "camera", w: 6, why: "flux vidéo (RTSP/ONVIF)" });
}

function votePorts(
  ports: { port: number; service?: string; product?: string; version?: string }[],
  out: Vote[],
) {
  const set = new Set(ports.map(p => p.port));
  const prod = ports.map(p => `${p.service || ""} ${p.product || ""}`.toLowerCase()).join(" ");
  const has = (...ns: number[]) => ns.every(n => set.has(n));
  const any = (...ns: number[]) => ns.some(n => set.has(n));

  // Bannières nmap : très parlantes quand elles sont là.
  if (/mikrotik|routeros/.test(prod)) out.push({ type: "router", w: 6, why: "bannière RouterOS" });
  if (/pfsense|opnsense|fortigate|pan-os/.test(prod)) out.push({ type: "firewall", w: 6, why: "bannière pare-feu" });
  if (/dsm|synology|qts|quts/.test(prod)) out.push({ type: "nas", w: 6, why: "bannière NAS" });
  if (/cups|ipp|jetdirect|printer/.test(prod)) out.push({ type: "printer", w: 5, why: "service d'impression" });
  if (/rtsp|hikvision|dahua|onvif/.test(prod)) out.push({ type: "camera", w: 5, why: "service caméra" });
  if (/esxi|vsphere|proxmox/.test(prod)) out.push({ type: "hypervisor", w: 6, why: "bannière hyperviseur" });
  if (/asterisk|freepbx|sip/.test(prod)) out.push({ type: "voip", w: 5, why: "téléphonie SIP" });

  // Empreintes de ports.
  if (has(631) || any(9100, 515)) out.push({ type: "printer", w: 4, why: "ports d'impression" });
  if (any(554, 8554, 37777)) out.push({ type: "camera", w: 4, why: "ports RTSP/caméra" });
  if (any(5060, 5061)) out.push({ type: "voip", w: 4, why: "ports SIP" });
  if (has(2375) || has(2376)) out.push({ type: "docker", w: 5, why: "API Docker exposée" });
  if (any(5000, 5001) && /synology|dsm/.test(prod)) out.push({ type: "nas", w: 3, why: "interface DSM" });
  if (has(445, 139)) out.push({ type: "pc", w: 2, why: "partage Windows (SMB)" });
  if (has(3389)) out.push({ type: "pc", w: 3, why: "bureau à distance (RDP)" });
  if (any(8006)) out.push({ type: "hypervisor", w: 4, why: "interface Proxmox" });
  if (any(902, 903)) out.push({ type: "hypervisor", w: 3, why: "ports VMware" });
  if (any(11434)) out.push({ type: "server", w: 3, why: "Ollama" });
  if (any(32400)) out.push({ type: "nas", w: 3, why: "serveur média Plex" });

  // Beaucoup de services + SSH = machine généraliste plutôt que gadget.
  if (set.has(22) && ports.length >= 4) out.push({ type: "server", w: 2, why: "SSH + plusieurs services" });
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
  if (/router|gateway|gw-|\brt-/.test(n)) out.push({ type: "router", w: 2, why: `nom « ${name} »` });
  if (/switch|\bsw-/.test(n)) out.push({ type: "switch", w: 2, why: `nom « ${name} »` });
  if (/\bap-|accesspoint|wifi/.test(n)) out.push({ type: "ap", w: 2, why: `nom « ${name} »` });
  if (/\bnas\b|synology|diskstation|truenas/.test(n)) out.push({ type: "nas", w: 3, why: `nom « ${name} »` });
  if (/docker|dockeri|container/.test(n)) out.push({ type: "docker", w: 3, why: `nom « ${name} »` });
  if (/\bpi\b|raspberry|rpi/.test(n)) out.push({ type: "pi", w: 3, why: `nom « ${name} »` });
  if (/printer|imprimante|hp[-_]?[lo]j/.test(n)) out.push({ type: "printer", w: 3, why: `nom « ${name} »` });
  if (/cam|camera|ipcam|reolink/.test(n)) out.push({ type: "camera", w: 3, why: `nom « ${name} »` });
  if (/\btv\b|chromecast|firestick|appletv/.test(n)) out.push({ type: "tv", w: 3, why: `nom « ${name} »` });
  if (/iphone|ipad|galaxy|pixel|oneplus/.test(n)) out.push({ type: "phone", w: 3, why: `nom « ${name} »` });
  if (/macbook|laptop|thinkpad|portable/.test(n)) out.push({ type: "laptop", w: 3, why: `nom « ${name} »` });
  if (/desktop|pc-|workstation|bureau/.test(n)) out.push({ type: "pc", w: 2, why: `nom « ${name} »` });
}

export function classify(h: ClassifyInput): ClassifyResult {
  // Court-circuit : si l'appareil est la passerelle, c'est un routeur, point.
  // Beaucoup de box exposent SMB, un serveur web d'administration ou du UPnP ;
  // sans cette règle, ces services font basculer le verdict vers « PC » ou
  // « serveur » alors que la fonction de l'appareil ne fait aucun doute.
  if (h.isGateway) {
    return {
      type: "router",
      confidence: 0.97,
      reasons: ["passerelle du réseau"],
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

  // Somme des poids par type.
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

  // Confiance : part du gagnant dans le total, tempérée par la marge sur le second.
  const share = topScore / total;
  const margin = runnerUp ? (topScore - runnerUp[1]) / topScore : 1;
  // Un score total faible = peu de signaux : la confiance est bridée même si
  // le gagnant est seul en lice. Il faut accumuler des preuves pour être sûr.
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
