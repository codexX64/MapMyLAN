// Identification du type de matériel par classement pondéré.
//
// Chaque signal (fabricant, service mDNS, port ouvert, bannière nmap, système,
// nom) vote pour un ou plusieurs types avec un poids. Le type qui récolte le
// plus de points gagne, et le score donne une confiance. Un signal fort et
// non ambigu (un service mDNS « _hap » annonce un accessoire HomeKit) pèse
// lourd ; un signal faible (un port 80 ouvert) pèse peu.

function voterFabricant(v, votes) {
  const pousser = (type, w, why) => votes.push({ type, w, why });
  if (/\bmikrotik|routeros|edgerouter|ubnt\s*edge|draytek|zyxel\s*(usg|zywall)/.test(v)) pousser('router', 6, `fabricant « ${v} »`);
  if (/tp-link|tplink|archer|freebox|livebox|bbox|sfr\s*box|technicolor|sagemcom|arcadyan|askey/.test(v) && !/tl-sg|tl-sf|omada|eap\d/.test(v)) pousser('router', 5, `box ou routeur « ${v} »`);
  if (/pfsense|opnsense|fortinet|fortigate|sophos|palo\s*alto|watchguard|stormshield/.test(v)) pousser('firewall', 7, `fabricant pare-feu « ${v} »`);
  // Une passerelle Ubiquiti (UDM, UXG) expose 8443 ; une borne (UAP) non.
  if (/\bunifi|ubiquiti\b/.test(v)) { pousser('router', 4, 'passerelle Ubiquiti'); pousser('ap', 2, 'Ubiquiti'); }
  if (/aruba|ruckus|aerohive|meraki\s*mr|tp-link.*eap|engenius/.test(v)) pousser('ap', 5, `borne Wi-Fi « ${v} »`);
  if (/cisco\s*catalyst|procurve|aruba\s*\d|netgear.*(gs|xs)|d-link.*(dgs|dxs)|juniper\s*ex/.test(v)) pousser('switch', 6, `switch « ${v} »`);
  // Zyxel fait des pare-feu et des commutateurs : GS/XGS/XS/MG sont des
  // commutateurs, USG/ZyWALL des pare-feu.
  if (/zyxel/.test(v) && !/usg|zywall/.test(v)) pousser('switch', 5, `switch Zyxel « ${v} »`);
  if (/tp-link.*(tl-sg|tl-sf)|netgear.*(fs|jgs)|ubiquiti.*(usw|unifi switch)/.test(v)) pousser('switch', 5, `switch « ${v} »`);
  if (/synology|qnap|truenas|ixsystems|asustor|terramaster|drobo/.test(v)) pousser('nas', 7, `NAS « ${v} »`);
  if (/vmware|\bpve\b|nutanix|xenserver|hyper-v/.test(v)) pousser('hypervisor', 6, `hyperviseur « ${v} »`);
  if (/raspberry/.test(v)) pousser('pi', 7, 'Raspberry Pi');
  if (/espressif|esp32|esp8266|sonoff|tuya|shelly|tasmota|nodemcu/.test(v)) pousser('iot', 6, `puce IoT « ${v} »`);
  if (/nest|ring|wyze|reolink|hikvision|dahua|axis\s*comm|amcrest|ubiquiti.*cam/.test(v)) pousser('camera', 6, `caméra « ${v} »`);
  if (/sonos|denon|yamaha.*av|bose|harman/.test(v)) pousser('iot', 4, 'audio connecté');
  if (/roku|chromecast|nvidia\s*shield|apple\s*tv|firetv|fire\s*tv|lg\s*electronics|samsung.*(tv|display)|vizio/.test(v)) pousser('tv', 5, `téléviseur « ${v} »`);
  if (/sony.*(playstation|interactive)|nintendo|microsoft.*xbox/.test(v)) pousser('console', 7, `console « ${v} »`);
  if (/apple/.test(v)) { pousser('laptop', 2, 'Apple'); pousser('phone', 2, 'Apple'); }
  if (/intel|dell|lenovo|asustek|asus\b|gigabyte|msi|hewlett|hp\s*inc|micro-star/.test(v)) pousser('pc', 3, `fabricant PC « ${v} »`);
  if (/brother|canon|epson|lexmark|kyocera|xerox|ricoh|hp.*(laserjet|officejet|deskjet)/.test(v)) pousser('printer', 6, `imprimante « ${v} »`);
  if (/samsung.*(galaxy|sm-)|xiaomi|redmi|oneplus|oppo|vivo|huawei.*(p\d|mate)|google.*pixel|motorola/.test(v)) pousser('phone', 5, `mobile « ${v} »`);
}

function voterMdns(services, votes) {
  const s = services.join(' ').toLowerCase();
  const a = re => re.test(s);
  if (a(/_hap\._tcp/)) votes.push({ type: 'iot', w: 6, why: 'accessoire HomeKit (_hap)' });
  if (a(/_airplay\._tcp|_raop\._tcp/)) votes.push({ type: 'tv', w: 4, why: 'AirPlay' });
  if (a(/_googlecast\._tcp/)) votes.push({ type: 'tv', w: 5, why: 'Chromecast' });
  if (a(/_ipp\._tcp|_printer\._tcp|_pdl-datastream/)) votes.push({ type: 'printer', w: 7, why: 'service d’impression (IPP)' });
  if (a(/_scanner\._tcp|_uscan/)) votes.push({ type: 'printer', w: 5, why: 'scanner réseau' });
  if (a(/_smb\._tcp|_afpovertcp|_nfs\._tcp/)) votes.push({ type: 'nas', w: 4, why: 'partage de fichiers' });
  if (a(/_ssh\._tcp/)) votes.push({ type: 'server', w: 2, why: 'SSH annoncé' });
  if (a(/_rfb\._tcp/)) votes.push({ type: 'pc', w: 3, why: 'bureau à distance (VNC)' });
  if (a(/_sonos|_spotify-connect/)) votes.push({ type: 'iot', w: 4, why: 'enceinte connectée' });
  if (a(/_companion-link|_apple-mobdev/)) votes.push({ type: 'phone', w: 3, why: 'appareil Apple mobile' });
  if (a(/_esphome|_shelly|_tasmota/)) votes.push({ type: 'iot', w: 6, why: 'micrologiciel domotique' });
  if (a(/_axis-video|_rtsp\._tcp|_onvif/)) votes.push({ type: 'camera', w: 6, why: 'flux vidéo (RTSP/ONVIF)' });
}

function voterPorts(ports, votes) {
  const numeros = new Set(ports.map(p => p.port));
  const produits = ports.map(p => `${p.service || ''} ${p.product || ''}`.toLowerCase()).join(' ');
  const tous = (...ns) => ns.every(n => numeros.has(n));
  const un = (...ns) => ns.some(n => numeros.has(n));
  // Bannières nmap : très parlantes quand elles sont là.
  if (/mikrotik|routeros/.test(produits)) votes.push({ type: 'router', w: 6, why: 'bannière RouterOS' });
  if (/pfsense|opnsense|fortigate|pan-os/.test(produits)) votes.push({ type: 'firewall', w: 6, why: 'bannière pare-feu' });
  if (/dsm|synology|qts|quts/.test(produits)) votes.push({ type: 'nas', w: 6, why: 'bannière NAS' });
  if (/cups|ipp|jetdirect|printer/.test(produits)) votes.push({ type: 'printer', w: 5, why: 'service d’impression' });
  if (/rtsp|hikvision|dahua|onvif/.test(produits)) votes.push({ type: 'camera', w: 5, why: 'service caméra' });
  if (/esxi|vsphere|pve-api|pve-manager/.test(produits)) votes.push({ type: 'hypervisor', w: 6, why: 'bannière hyperviseur' });
  if (/asterisk|freepbx|sip/.test(produits)) votes.push({ type: 'voip', w: 5, why: 'téléphonie SIP' });
  // Empreintes de ports.
  if (tous(631) || un(9100, 515)) votes.push({ type: 'printer', w: 4, why: 'ports d’impression' });
  if (un(554, 8554, 37777)) votes.push({ type: 'camera', w: 4, why: 'ports RTSP/caméra' });
  if (un(5060, 5061)) votes.push({ type: 'voip', w: 4, why: 'ports SIP' });
  if (tous(2375) || tous(2376)) votes.push({ type: 'docker', w: 5, why: 'API Docker exposée' });
  if (un(5000, 5001) && /synology|dsm/.test(produits)) votes.push({ type: 'nas', w: 3, why: 'interface DSM' });
  if (tous(445, 139)) votes.push({ type: 'pc', w: 2, why: 'partage Windows (SMB)' });
  if (tous(3389)) votes.push({ type: 'pc', w: 3, why: 'bureau à distance (RDP)' });
  if (un(8006)) votes.push({ type: 'hypervisor', w: 4, why: 'interface de virtualisation (port 8006)' });
  if (un(902, 903)) votes.push({ type: 'hypervisor', w: 3, why: 'ports VMware' });
  if (un(11434)) votes.push({ type: 'server', w: 3, why: 'Ollama' });
  if (un(32400)) votes.push({ type: 'nas', w: 3, why: 'serveur média Plex' });
  // Beaucoup de services et SSH : une machine généraliste plutôt qu'un gadget.
  if (numeros.has(22) && ports.length >= 4) votes.push({ type: 'server', w: 2, why: 'SSH + plusieurs services' });
}

function voterSysteme(os, votes) {
  if (/windows\s*server/.test(os)) votes.push({ type: 'server', w: 4, why: 'Windows Server' });
  else if (/windows/.test(os)) votes.push({ type: 'pc', w: 4, why: 'Windows' });
  if (/android/.test(os)) votes.push({ type: 'phone', w: 3, why: 'Android' });
  if (/\bios\b|iphone os/.test(os)) votes.push({ type: 'phone', w: 4, why: 'iOS' });
  if (/ipados/.test(os)) votes.push({ type: 'tablet', w: 5, why: 'iPadOS' });
  if (/mac\s*os|macos|darwin/.test(os)) votes.push({ type: 'laptop', w: 3, why: 'macOS' });
  if (/linux|ubuntu|debian|centos|alpine|raspbian/.test(os)) votes.push({ type: 'server', w: 2, why: 'Linux' });
  if (/raspbian|raspberry/.test(os)) votes.push({ type: 'pi', w: 5, why: 'Raspberry Pi OS' });
  if (/vmware|esxi/.test(os)) votes.push({ type: 'hypervisor', w: 5, why: 'ESXi' });
}

function voterNom(nom, votes) {
  if (!nom) return;
  const n = nom.toLowerCase();
  const pousser = (type, w) => votes.push({ type, w, why: `nom « ${nom} »` });
  if (/router|gateway|gw-|\brt-/.test(n)) pousser('router', 2);
  if (/switch|\bsw-/.test(n)) pousser('switch', 2);
  if (/\bap-|accesspoint|wifi/.test(n)) pousser('ap', 2);
  if (/\bnas\b|synology|diskstation|truenas/.test(n)) pousser('nas', 3);
  if (/docker|container/.test(n)) pousser('docker', 3);
  if (/\bpi\b|raspberry|rpi/.test(n)) pousser('pi', 3);
  if (/printer|imprimante|hp[-_]?[lo]j/.test(n)) pousser('printer', 3);
  if (/cam|camera|ipcam|reolink/.test(n)) pousser('camera', 3);
  if (/\btv\b|chromecast|firestick|appletv/.test(n)) pousser('tv', 3);
  if (/iphone|ipad|galaxy|pixel|oneplus/.test(n)) pousser('phone', 3);
  if (/macbook|laptop|thinkpad|portable/.test(n)) pousser('laptop', 3);
  if (/desktop|pc-|workstation|bureau/.test(n)) pousser('pc', 2);
}

/**
 * { type, confidence (0..1), runnerUp?, reasons }.
 * entree : { isGateway, vendor, os, hostname, netbios, mdnsName, mdnsServices, ports }.
 */
export function classer(h) {
  // La passerelle est un routeur, quoi qu'elle expose : beaucoup de box
  // ouvrent SMB ou un serveur web qui feraient pencher vers « PC ».
  if (h.isGateway) return { type: 'router', confidence: 0.97, reasons: ['passerelle du réseau'] };
  const votes = [];
  voterFabricant((h.vendor || '').toLowerCase(), votes);
  voterMdns(h.mdnsServices || [], votes);
  voterPorts(h.ports || [], votes);
  voterSysteme((h.os || '').toLowerCase(), votes);
  voterNom(h.hostname || h.mdnsName || h.netbios || '', votes);
  if (!votes.length) return { type: 'unknown', confidence: 0, reasons: [] };
  const score = new Map(), pourquoi = new Map();
  for (const v of votes) {
    score.set(v.type, (score.get(v.type) || 0) + v.w);
    pourquoi.set(v.type, [...(pourquoi.get(v.type) || []), v.why]);
  }
  const classes = [...score.entries()].sort((a, b) => b[1] - a[1]);
  const [premier, points] = classes[0];
  const second = classes[1];
  const total = classes.reduce((s, [, w]) => s + w, 0);
  // Part du gagnant, marge sur le second, et quantité de preuves : peu de
  // signaux bride la confiance même quand le gagnant est seul en lice.
  const part = points / total;
  const marge = second ? (points - second[1]) / points : 1;
  const preuves = Math.min(1, total / 8);
  const confiance = Math.round(Math.min(1, part * 0.55 + marge * 0.25 + preuves * 0.2) * 100) / 100;
  return {
    type: premier, confidence: confiance,
    runnerUp: second && second[1] >= points * 0.7 ? second[0] : undefined,
    reasons: pourquoi.get(premier) || [],
  };
}
