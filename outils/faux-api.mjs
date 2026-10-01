// Faux serveur de MapMyLAN, pour regarder l'interface sans réseau ni équipement.
//
// Il sert web/ et le socle comme le vrai serveur (politique de contenu à
// nonce, en-têtes de sécurité du socle) et répond à chaque route du contrat
// (docs/API.md) avec des données inventées : appareils serveur-a, camera-7…,
// adresses de documentation 192.0.2.0/24 et 198.51.100.0/24, domaines
// exemple.org. Une session d'administrateur complète est simulée.
//
// Sur un second port, si on lui donne le dossier de l'interface 1.4.1
// construite (frontend/dist), il la sert devant les mêmes données, avec
// l'authentification de la 1.4 imitée : les deux versions se comparent écran
// par écran.
//
//   node outils/faux-api.mjs [port 2.0 = 8120] [port 1.4.1 = 8121] [dossier dist de la 1.4.1]
//
// Aucune dépendance. Les écritures sont acceptées et, pour la plupart,
// appliquées en mémoire ; rien n'est gardé d'un lancement à l'autre.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ICI = path.dirname(fileURLToPath(import.meta.url));
const RACINE = path.resolve(ICI, '..');
const WEB = path.join(RACINE, 'web');
const SOCLE = path.join(RACINE, 'socle');
const { nonceCsp, politiqueContenu, entetesSecurite, servirFichier, repondreJson } = await import(path.join(SOCLE, 'src', 'http.js'));
const { PERMISSIONS } = await import(path.join(RACINE, 'src', 'main.js'));

const [portNeuf = '8120', portAncien = '8121', DIST] = process.argv.slice(2);

const T0 = Date.now();
const il = (minutes) => new Date(T0 - minutes * 60_000).toISOString();
const ms = (minutes) => T0 - minutes * 60_000;
const mac = n => `00:00:5E:00:53:${n.toString(16).toUpperCase().padStart(2, '0')}`;
let compteur = 1000;
const nouvelId = () => `id${(compteur++).toString(36)}essai000000`.slice(0, 16);

// Le parc : quatorze appareils, trois segments, une carte.
const port = (deviceId, p, service, product = null, version = null) => ({ id: `${deviceId}-p${p}`, deviceId, port: p, protocol: 'tcp', state: 'open', service, product, version, detectedAt: il(90) });
const faille = (deviceId, cveId, cvss, description, service) => ({ id: `${deviceId}-${cveId}`, deviceId, cveId, cvss, severity: cvss >= 9 ? 'critical' : cvss >= 7 ? 'high' : cvss >= 4 ? 'medium' : 'low', description, service, detectedAt: il(300) });
const raisons = (confiance, danger) => ({
  trust: [{ reason: 'fabricant connu', delta: 10 }, { reason: 'vu depuis longtemps', delta: confiance > 70 ? 15 : 5 }],
  activity: [{ reason: 'trafic régulier', delta: 5 }],
  vuln: danger > 50 ? [{ reason: 'service web sans chiffrement', delta: 20 }, { reason: 'faille connue', delta: 25 }] : [],
});

function appareil(n, o) {
  const id = `app${String(n).padStart(2, '0')}essai00000`.slice(0, 16);
  const d = {
    id, ip: o.ip, mac: o.mac === undefined ? mac(n) : o.mac, hostname: o.hostname ?? null, customName: o.customName ?? null,
    vendor: o.vendor ?? null, model: o.model ?? null, os: o.os ?? null, type: o.type, customType: null,
    vlan: o.vlan ?? null, zone: o.zone ?? null, tags: o.tags || [], notes: o.notes ?? null, role: o.role ?? null,
    status: o.status || 'online', trustScore: o.trust ?? 80, activityScore: o.activite ?? 40, vulnScore: o.vuln ?? 10, dangerScore: o.danger ?? 10,
    scoreReasons: raisons(o.trust ?? 80, o.danger ?? 10), whitelisted: !!o.whitelisted, isMainRouter: !!o.principal,
    posX: null, posY: null, pinned: false, firstSeen: il(60 * 24 * 40 + n * 90), lastSeen: il(o.status === 'offline' ? 60 * 26 : n % 5),
    metadata: o.metadata || null, ports: [], cves: [], interfaces: [],
  };
  d.ports = (o.ports || []).map(([p, s, pr, v]) => port(id, p, s, pr, v));
  d.cves = (o.cves || []).map(([c, s, t, sv]) => faille(id, c, s, t, sv));
  d.interfaces = (o.interfaces || []).map((i, k) => ({ id: `${id}-i${k}`, deviceId: id, mac: i.mac, ip: i.ip, type: i.type, label: i.label, posX: null, posY: null, isPrimary: k === 0, createdAt: il(3000) }));
  return d;
}

const appareils = [
  appareil(1, { ip: '192.0.2.1', hostname: 'passerelle', vendor: 'Constructeur A', model: 'Passerelle P1', os: 'Linux 6', type: 'router', principal: true, trust: 96, danger: 12, whitelisted: true,
    ports: [[22, 'ssh', 'OpenSSH', '9.6'], [53, 'domain'], [80, 'http'], [443, 'https']], role: 'passerelle' }),
  appareil(2, { ip: '192.0.2.2', hostname: 'commutateur-1', vendor: 'Constructeur A', model: 'Commutateur 24', type: 'switch', trust: 90, danger: 8, zone: 'Baie' }),
  appareil(3, { ip: '192.0.2.3', hostname: 'borne-1', vendor: 'Constructeur A', model: 'Borne B2', type: 'ap', trust: 88, danger: 10, zone: 'Couloir' }),
  appareil(4, { ip: '192.0.2.10', hostname: 'serveur-a', vendor: 'Constructeur B', model: 'Serveur 1U', os: 'Linux 6', type: 'server', vlan: 10, trust: 85, danger: 35, zone: 'Baie', tags: ['production'],
    ports: [[22, 'ssh', 'OpenSSH', '9.6'], [80, 'http', 'nginx', '1.26'], [443, 'https', 'nginx', '1.26'], [5432, 'postgresql']] }),
  appareil(5, { ip: '192.0.2.11', hostname: 'serveur-b', vendor: 'Constructeur B', model: 'Stockage S4', type: 'nas', vlan: 10, trust: 78, danger: 48, zone: 'Baie',
    ports: [[22, 'ssh'], [445, 'microsoft-ds'], [5000, 'http']], cves: [['CVE-2024-0001', 6.5, 'Divulgation d’informations par l’interface web d’administration.', 'http']] }),
  appareil(6, { ip: '192.0.2.40', hostname: 'camera-7', vendor: 'Constructeur C', model: 'Caméra dôme', type: 'camera', vlan: 20, status: 'suspect', trust: 30, danger: 78, vuln: 70,
    ports: [[80, 'http'], [554, 'rtsp']], cves: [['CVE-2024-0002', 9.8, 'Exécution de commande sans authentification sur le service web.', 'http'], ['CVE-2024-0003', 7.5, 'Mot de passe par défaut accepté sur le flux vidéo.', 'rtsp']] }),
  appareil(7, { ip: '192.0.2.41', hostname: 'camera-8', vendor: 'Constructeur C', model: 'Caméra dôme', type: 'camera', vlan: 20, status: 'quarantined', trust: 35, danger: 72, ports: [[80, 'http']] }),
  appareil(8, { ip: '192.0.2.50', hostname: 'imprimante-2', vendor: 'Constructeur D', model: 'Imprimante laser', type: 'printer', trust: 70, danger: 22, ports: [[631, 'ipp'], [9100, 'jetdirect']] }),
  appareil(9, { ip: '192.0.2.60', hostname: 'poste-3', vendor: 'Constructeur E', os: 'Linux 6', type: 'computer', vlan: 10, trust: 82, danger: 18 }),
  appareil(10, { ip: '192.0.2.61', hostname: 'portable-5', customName: 'Portable de l’atelier', vendor: 'Constructeur E', type: 'laptop', vlan: 10, trust: 80, danger: 15,
    interfaces: [{ mac: mac(10), ip: '192.0.2.61', type: 'wifi', label: 'wlan0' }, { mac: mac(110), ip: '192.0.2.62', type: 'ethernet', label: 'eth0' }] }),
  appareil(11, { ip: '192.0.2.70', hostname: 'telephone-4', vendor: 'Constructeur F', type: 'phone', trust: 75, danger: 12, metadata: { apMac: mac(3), essid: 'reseau-essai', radio: '5 GHz', rssi: -58, medium: 'wireless' } }),
  appareil(12, { ip: '192.0.2.80', hostname: 'tele-1', vendor: 'Constructeur G', type: 'tv', status: 'offline', trust: 60, danger: 20 }),
  appareil(13, { ip: '198.51.100.20', hostname: 'capteur-9', vendor: 'Constructeur H', type: 'iot', vlan: 20, status: 'banned', trust: 20, danger: 85, vuln: 60 }),
  appareil(14, { ip: '198.51.100.21', mac: mac(14), type: 'unknown', vlan: 20, status: 'offline', trust: 40, danger: 30 }),
];
const parId = id => appareils.find(d => d.id === id);
const A = n => appareils[n - 1].id;

const vlans = [
  { id: 10, name: 'Postes', subnet: '192.0.2.0/25', description: 'Machines de travail', color: '#1B2AFF', isolated: false, gateway: '192.0.2.1', networkId: null, createdAt: il(90000) },
  { id: 20, name: 'Objets connectés', subnet: '198.51.100.0/26', description: null, color: '#B7791F', isolated: true, gateway: '198.51.100.1', networkId: null, createdAt: il(80000) },
  { id: 30, name: 'Invités', subnet: '198.51.100.64/26', description: null, color: '#858B93', isolated: true, gateway: '198.51.100.65', networkId: null, createdAt: il(70000) },
];

const lien = (n, a, b, type = 'ethernet', extra = {}) => ({ id: `lien${n}essai0000000`.slice(0, 16), fromId: A(a), toId: A(b), fromIfaceId: null, toIfaceId: null, type, speed: type === 'ethernet' ? '1G' : null, vlan: null, manual: false, createdAt: il(5000), ...extra });
const topologie = {
  links: [lien(1, 1, 2), lien(2, 2, 3), lien(3, 2, 4), lien(4, 2, 5), lien(5, 2, 6), lien(6, 2, 7), lien(7, 2, 8), lien(8, 2, 9),
    lien(9, 3, 10, 'wifi'), lien(10, 3, 11, 'wifi'), lien(11, 3, 12, 'wifi'), lien(12, 1, 13, 'vpn'), lien(13, 2, 14)],
  zones: [{ id: 'zone1essai000000', name: 'Baie', color: '#1B2AFF', x: 80, y: 80, width: 420, height: 240, notes: JSON.stringify({ opacity: 0.08, strokeStyle: 'dashed', strokeWidth: 2 }), createdAt: il(4000) }],
};

const alertes = [
  ['critical', 'défense', 'camera-7 expose un service vulnérable (CVSS 9.8)', 6],
  ['high', 'défense', 'capteur-9 bloqué après une rafale de connexions', 5],
  ['high', 'ports', 'Nouveau port ouvert sur serveur-b : 5000/tcp', 11],
  ['medium', 'balayage', 'Appareil inconnu sur le segment Objets connectés', 14],
  ['medium', 'trafic', 'Destination signalée contactée par camera-7', 6],
  ['low', 'balayage', 'tele-1 ne répond plus depuis 26 h', 12],
  ['info', 'système', 'Balayage terminé : 14 appareils', null],
  ['info', 'topologie', 'Carte reconstruite : 13 liaisons', null],
].map(([severity, source, message, n], i) => ({
  id: `alerte${i}essai00000`.slice(0, 16), severity, source, message, deviceId: n ? A(n) : null, deviceIp: n ? appareils[n - 1].ip : null,
  deviceMac: n ? appareils[n - 1].mac : null, acknowledged: i >= 5, metadata: null, createdAt: il(i * 37 + 4),
}));

const journal = Array.from({ length: 48 }, (_, i) => {
  const modeles = [
    ['info', 'balayage', 'Balayage de 192.0.2.0/24 lancé'], ['success', 'balayage', 'Balayage terminé : 14 hôtes'],
    ['warn', 'défense', 'camera-7 isolée : score de danger 78'], ['error', 'trafic', 'Relevé impossible : délai dépassé'],
    ['info', 'topologie', 'Carte reconstruite'], ['success', 'notifications', 'Alerte envoyée sur Telegram'],
  ];
  const [level, source, message] = modeles[i % modeles.length];
  return { id: `log${i}essai000000000`.slice(0, 16), level, source, message, metadata: null, createdAt: il(i * 11 + 1) };
});

const reglages = {
  'setup.complete': true, 'scan.subnet': '192.0.2.0/24', 'scan.interval': 300,
  'scan.ranges': [{ cidr: '192.0.2.0/24', label: 'Réseau principal', enabled: true }, { cidr: '198.51.100.0/25', label: 'Objets et invités', enabled: true }],
  'topology.autoBuild': true, 'grouping.enabled': false, 'grouping.prefix': '192.0', 'grouping.wifiMultiplier': 10,
  'world.rdap': true, 'world.logos': false, 'world.retentionDays': 30, 'world.retentionMaxMb': 0,
  'sortie.autorisees': ['billetterie.exemple.org'],
};

const statsHote = () => ({
  cpuPct: 23.4, memPct: 41.2, memUsedMB: 3296, memTotalMB: 8000, diskPct: 57, tempC: 48, loadAvg: 0.62, netRxKBs: 120.5, netTxKBs: 38.2, uptimeSec: 864000 + Math.floor((Date.now() - T0) / 1000),
  containers: [{ id: 'c1', name: 'mapmylan', image: 'mapmylan:2.0.0', state: 'running', status: 'Up 10 days' }, { id: 'c2', name: 'vox', image: 'vox:1.2', state: 'exited', status: 'Exited (0) 2 days ago' }],
});
const histoHote = Array.from({ length: 60 }, (_, i) => ({ id: `h${i}`, cpuPct: 18 + 10 * Math.sin(i / 6) + (i % 7), memPct: 38 + 4 * Math.sin(i / 11), memUsedMB: 3100 + i * 3, memTotalMB: 8000, diskPct: 57, tempC: 47, loadAvg: 0.6, netRxKBs: 100, netTxKBs: 30, uptimeSec: 864000, createdAt: il(60 - i) }));

const adaptateurs = [
  { id: 'unifi', label: 'Ubiquiti · UniFi', transport: 'api', capabilities: ['clients', 'ban', 'unban', 'vlans'], needs: ['password'] },
  { id: 'openwrt', label: 'OpenWrt', transport: 'ssh', capabilities: ['ban', 'unban', 'quarantine', 'arp', 'leases', 'clients'], needs: ['password', 'privateKey'] },
  { id: 'routeros', label: 'MikroTik · RouterOS', transport: 'ssh', capabilities: ['ban', 'unban', 'arp', 'leases', 'vlans'], needs: ['password'] },
  { id: 'pfsense', label: 'pfSense / OPNsense', transport: 'ssh', capabilities: ['ban', 'unban', 'arp'], needs: ['password'] },
  { id: 'asus-merlin', label: 'Asus · Merlin', transport: 'ssh', capabilities: ['ban', 'unban', 'arp', 'leases'], needs: ['password'] },
  { id: 'generic', label: 'SSH générique', transport: 'ssh', capabilities: ['arp'], needs: ['password', 'privateKey'] },
];
const EMPREINTE = 'SHA256:QmVuY2hFc3NhaUVtcHJlaW50ZURlVGVzdA00000000';
let routeur = {
  id: 'routeur1essai000', name: 'Passerelle', host: '192.0.2.1', port: 22, username: 'exploitant', vendor: 'openwrt', transport: 'ssh', apiBaseUrl: null, site: null, verifyTls: false,
  hasPassword: true, hasPrivateKey: false, lastConnected: il(2), lastTestOk: true, lastTestAt: il(35), lastTestInfo: 'Linux passerelle 6.6 · 14 clients',
  capabilities: adaptateurs[1].capabilities, empreinteHote: EMPREINTE, empreinteTls: null,
};
const consoles = [
  { id: 'routeur1essai000', name: 'Passerelle', host: '192.0.2.1', port: 22, username: 'exploitant', vendor: 'openwrt', isMainRouter: true, lastConnected: il(2), createdAt: il(50000), empreinteHote: EMPREINTE },
  { id: 'console2essai000', name: 'serveur-a', host: '192.0.2.10', port: 22, username: 'exploitant', vendor: 'generic', isMainRouter: false, lastConnected: il(600), createdAt: il(20000), empreinteHote: EMPREINTE.replace('0000', '1111') },
];

let canaux = [
  { channel: 'telegram', enabled: true, lastTested: il(300), lastSuccess: il(300) },
  { channel: 'email', enabled: true, lastTested: il(3000), lastSuccess: null },
  { channel: 'billetterie', enabled: false, lastTested: null, lastSuccess: null },
];
const declencheurs = [
  { id: 'device.new', category: 'Appareils', label: 'Nouvel appareil', vars: ['name', 'ip', 'mac', 'vendor'] },
  { id: 'device.offline', category: 'Appareils', label: 'Appareil hors ligne', vars: ['name', 'ip'] },
  { id: 'device.danger', category: 'Défense', label: 'Score de danger élevé', vars: ['name', 'ip', 'score'] },
  { id: 'cve.found', category: 'Défense', label: 'Faille découverte', vars: ['name', 'cve', 'cvss'] },
  { id: 'host.cpu', category: 'Machine hôte', label: 'Processeur saturé', vars: ['pct'] },
];
const actionsCommandes = [
  { kind: 'notify', label: 'Prévenir', needs: ['channels'] }, { kind: 'log', label: 'Consigner', needs: [] },
  { kind: 'quarantine', label: 'Isoler', needs: [] }, { kind: 'ban', label: 'Bloquer', needs: [] }, { kind: 'exec_ssh', label: 'Commande SSH', needs: ['deviceId', 'cmd'] },
];
let commandes = [
  { id: 'cmd1essai0000000', name: 'Prévenir d’un nouvel appareil', enabled: true, trigger: 'device.new', filter: null, actions: [{ kind: 'notify', channels: ['telegram'] }], template: 'Nouvel appareil {{name}} ({{ip}})', cooldownSec: 0, lastFired: il(120), fireCount: 3, createdAt: il(9000), updatedAt: il(9000) },
  { id: 'cmd2essai0000000', name: 'Isoler ce qui devient dangereux', enabled: true, trigger: 'device.danger', filter: { minScore: 75 }, actions: [{ kind: 'quarantine' }, { kind: 'notify', channels: ['telegram', 'email'] }], template: null, cooldownSec: 600, lastFired: il(400), fireCount: 1, createdAt: il(8000), updatedAt: il(8000) },
];
const actionsBot = [
  { id: 'status', label: 'État du réseau', params: [], destructive: false },
  { id: 'ban', label: 'Bloquer une adresse', params: [{ name: 'ip', required: true }], destructive: true },
  { id: 'scan', label: 'Lancer un balayage', params: [], destructive: false },
];
let commandesBot = [
  { id: 'bot1essai0000000', trigger: '/etat', description: 'Résumé du réseau', action: 'status', params: null, enabled: true, confirm: false, allowedChatIds: [], cooldownSec: 0, lastFiredBy: null, lastFiredAt: il(50), fireCount: 12, createdAt: il(9000), updatedAt: il(9000) },
  { id: 'bot2essai0000000', trigger: '/bloquer', description: 'Bloque une adresse', action: 'ban', params: null, enabled: false, confirm: true, allowedChatIds: [], cooldownSec: 30, lastFiredBy: null, lastFiredAt: null, fireCount: 0, createdAt: il(9000), updatedAt: il(9000) },
];
let regles = [
  { id: 'regle1essai00000', name: 'Appareil inconnu', enabled: true, trigger: 'device.new', threshold: null, action: 'alert', exceptWhitelist: true, createdAt: il(90000) },
  { id: 'regle2essai00000', name: 'Danger élevé', enabled: true, trigger: 'device.danger', threshold: 75, action: 'quarantine', exceptWhitelist: true, createdAt: il(90000) },
  { id: 'regle3essai00000', name: 'Rafale de connexions', enabled: false, trigger: 'traffic.burst', threshold: 90, action: 'ban', exceptWhitelist: true, createdAt: il(90000) },
];
let jetons = [
  { id: 'jeton1essai00000', name: 'Supervision', prefix: 'mml_4f2a', role: 'lecture', createdAt: il(20000), lastUsedAt: il(3), expiresAt: null, revokedAt: null, etat: 'actif' },
  { id: 'jeton2essai00000', name: 'Ancien script', prefix: 'mml_91c0', role: 'membre', createdAt: il(90000), lastUsedAt: il(40000), expiresAt: null, revokedAt: il(30000), etat: 'revoque' },
];
const fournisseurs = [
  { id: 'gmail', nom: 'Gmail', besoins: [], note: 'Mot de passe d’application exigé.' },
  { id: 'outlook', nom: 'Outlook', besoins: [], note: null },
  { id: 'apple', nom: 'Apple', besoins: [], note: 'Mot de passe propre à l’application exigé.' },
  { id: 'autre', nom: 'Autre', besoins: ['imap', 'smtp'], note: null },
];
let boites = [
  { id: 'boite1essai00000', email: 'alertes@exemple.org', provider: 'autre', role: 'send', imap: null, smtp: { host: 'smtp.exemple.org', port: 465, security: 'ssl' }, active: true, hasPassword: true, lastTestAt: il(3000), lastTestOk: true, lastTestInfo: null },
];

// Trafic : destinations de documentation, nommées par des codes de grandes
// villes pour que le globe ait des arcs à tracer.
const destinations = [
  ['198.51.100.200', 'fra1.cdn.exemple.org', 'exemple.org', 'Opérateur A', 'DE'], ['198.51.100.201', 'iad2.api.exemple.net', 'exemple.net', 'Opérateur B', 'US'],
  ['198.51.100.202', 'sin1.media.exemple.com', 'exemple.com', 'Opérateur C', 'SG'], ['198.51.100.203', 'nrt1.jeux.exemple.org', 'exemple.org', 'Opérateur A', 'JP'],
  ['198.51.100.204', 'gru1.meteo.exemple.net', 'exemple.net', 'Opérateur D', 'BR'], ['198.51.100.205', null, null, 'Opérateur E', 'NL'],
  ['198.51.100.206', 'syd1.maj.exemple.com', 'exemple.com', 'Opérateur C', 'AU'], ['198.51.100.207', 'lhr2.video.exemple.org', 'exemple.org', 'Opérateur B', 'GB'],
];
const sources = ['192.0.2.10', '192.0.2.11', '192.0.2.40', '192.0.2.60', '192.0.2.61', '192.0.2.70'];
const flux = Array.from({ length: 90 }, (_, i) => {
  const [dst, nom, domaine, operateur, pays] = destinations[i % destinations.length];
  const src = sources[(i * 7) % sources.length];
  const suspect = src === '192.0.2.40' && i % 3 === 0;
  return {
    id: `flux${i}essai00000000`.slice(0, 16), src, dst, port: [443, 443, 80, 853, 123][i % 5], proto: i % 5 === 4 ? 'udp' : 'tcp',
    premier: ms(i * 9 + 30), dernier: ms(i * 9), octets: 2048 * ((i * 37) % 900 + 12), paquets: (i * 13) % 400 + 8, vues: (i % 6) + 1,
    ...(nom ? { nom } : {}), ...(domaine ? { domaine, logo: domaine } : {}), operateur, paysRegistre: pays,
    sens: i % 17 === 0 ? 'entrant' : 'sortant', suspect, ...(suspect ? { raison: 'Destination listée comme serveur de commande' } : {}),
  };
});
const etatTrafic = () => ({
  equipement: 'Passerelle', quand: Date.now() - 12_000, commande: 'conntrack -L -o extended | head', erreur: null, liaisonPerdue: false, fluxVus: 42,
  cible: { id: 'routeur1essai000', nom: 'Passerelle', hote: '192.0.2.1', port: 22 }, ecartees: [], total: flux.length, signales: flux.filter(f => f.suspect).length,
  entrants: flux.filter(f => f.sens === 'entrant').length, tailleMo: 1.42, plusAncien: flux.at(-1).premier, retentionJours: 30, retentionMaxMo: 0,
});
function aggregats(depuis) {
  const liste = flux.filter(f => !depuis || f.dernier >= depuis);
  const parDst = new Map(), parSrc = new Map();
  for (const f of liste) {
    const q = parDst.get(f.dst) || { dst: f.dst, nom: f.nom, domaine: f.domaine, operateur: f.operateur, logo: f.logo, paysRegistre: f.paysRegistre, sens: f.sens, suspect: f.suspect, octets: 0, dernier: 0 };
    q.octets += f.octets; q.dernier = Math.max(q.dernier, f.dernier); q.suspect ||= f.suspect;
    parDst.set(f.dst, q);
    parSrc.set(f.src, (parSrc.get(f.src) || 0) + f.octets);
  }
  return { connexions: liste.length, destinations: [...parDst.values()], appareils: [...parSrc].map(([src, octets]) => ({ src, octets })) };
}

// Assistant : un fil avec les quatre sortes de widgets.
const widgets = [
  { type: 'stats', titre: 'Le parc en ce moment', tuiles: [{ label: 'En ligne', valeur: 9, sous: 'sur 14' }, { label: 'Retenus', valeur: 2, etat: 'err' }, { label: 'Failles', valeur: 3 }, { label: 'Ports ouverts', valeur: 18 }] },
  { type: 'activite', titre: 'Alertes des sept derniers jours', ok: 23, err: 4, legende: { ok: 'Traitées', err: 'Ouvertes' },
    barres: ['lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.', 'dim.'].map((jour, i) => ({ jour, ok: [3, 5, 2, 4, 6, 1, 2][i], err: [0, 1, 0, 2, 0, 0, 1][i] })) },
  { type: 'rang', titre: 'Les plus exposés', lignes: [{ nom: 'capteur-9', valeur: 85, niveau: 'err', detail: 'bloqué · 0 port' }, { nom: 'camera-7', valeur: 78, niveau: 'err', detail: '2 failles' }, { nom: 'serveur-b', valeur: 48, niveau: 'warn', detail: '1 faille' }] },
  { type: 'liste', titre: 'Ce qui ne répond plus', vide: 'Tout répond.', lignes: [{ nom: 'tele-1', detail: 'hors ligne depuis 26 h', etat: 'warn' }, { nom: '198.51.100.21', detail: 'inconnu, vu une fois', etat: 'err' }], reste: 0 },
];
let fil = [
  { id: 'tour1essai000000', request: 'Qu’est-ce qui est exposé en ce moment ?', reply: '**Deux appareils demandent ton attention.**\n\n- **camera-7** expose un service web vulnérable (CVSS 9.8).\n- **capteur-9** est bloqué depuis une rafale de connexions.\n\nLe reste du parc est calme.', widgets: [widgets[2]], duree: 1800, modele: 'modele-local', voix: false, sources: ['inventaire', 'alertes'], le: il(30) },
  { id: 'tour2essai000000', request: 'Résume le parc', reply: '### État du parc\n\n| Segment | Appareils |\n|---|---|\n| Postes | 5 |\n| Objets connectés | 4 |\n\nNeuf appareils sur quatorze sont en ligne.', widgets: [widgets[0], widgets[1], widgets[3]], duree: 2400, modele: 'modele-local', voix: false, sources: ['inventaire'], le: il(12) },
];

// Comptes (socle) : une session d'administrateur complète.
const compte = { id: 'compte1essai0000', identifiant: 'exploitant', affichage: 'Exploitant', role: 'admin', actif: true, courriel: 'exploitant@exemple.org', facteurs: { motdepasse: true, totp: true, cles: 1, secours: 8 } };
// Pour regarder la porte de connexion : POST /api/_essai/session { ouverte: false }.
let sessionOuverte = true;
const etatCompte = () => ({ installe: true, service: 'MapMyLAN', session: sessionOuverte ? { niveau: 'complet', csrf: 'jeton-csrf-essai', compte } : null, politique: { motdepasse: 'requis', totp: 'facultatif', cle: 'requis_admin' } });

class Refus extends Error { constructor(status, message, details) { super(message); this.status = status; this.details = details; } }

// Ce que le contrat déclare pour quelques corps : un champ en trop, ou null
// là où une chaîne est attendue, est refusé comme le fera le vrai serveur.
const CORPS = {
  'PATCH /api/devices/:id': ['customName', 'customType', 'vendor', 'model', 'vlan', 'zone', 'tags', 'notes', 'role', 'whitelisted', 'isMainRouter', 'posX', 'posY', 'pinned', 'type'],
  'POST /api/devices/manual': ['ip', 'mac', 'hostname', 'customName', 'vendor', 'model', 'type', 'customType', 'posX', 'posY', 'notes'],
  'PATCH /api/vlans/:id': ['name', 'subnet', 'color', 'description', 'isolated'],
  'POST /api/vlans': ['id', 'name', 'subnet', 'color', 'description', 'isolated', 'pushToRouter'],
  'POST /api/ssh': ['name', 'host', 'port', 'username', 'password', 'privateKey', 'passphrase', 'vendor', 'isMainRouter', 'empreinteHote'],
  'POST /api/ssh/test': ['name', 'host', 'port', 'username', 'password', 'privateKey', 'passphrase', 'vendor', 'isMainRouter', 'empreinteHote', 'transport', 'apiBaseUrl', 'site', 'verifyTls', 'empreinteTls'],
  'PUT /api/router': ['vendor', 'transport', 'host', 'port', 'username', 'password', 'privateKey', 'passphrase', 'apiBaseUrl', 'site', 'verifyTls', 'empreinteHote', 'empreinteTls', 'name'],
  'POST /api/router/detect': ['vendor', 'transport', 'host', 'port', 'username', 'password', 'privateKey', 'passphrase', 'apiBaseUrl', 'site', 'verifyTls', 'empreinteHote', 'empreinteTls'],
  'POST /api/router/test': ['useSaved', 'vendor', 'transport', 'host', 'port', 'username', 'password', 'privateKey', 'passphrase', 'apiBaseUrl', 'site', 'verifyTls', 'empreinteHote', 'empreinteTls'],
  'PUT /api/notifications/:canal': ['enabled', 'config'],
  'POST /api/integrations': ['name', 'role', 'expiresAt'],
  'POST /api/topology/positions': ['positions'],
  'PATCH /api/topology/zones/:id': ['name', 'color', 'x', 'y', 'width', 'height', 'notes'],
  'POST /api/topology/zones': ['name', 'color', 'x', 'y', 'width', 'height', 'notes'],
  'POST /api/assistant/ask': ['text', 'voix'],
  'PUT /api/settings/:cle': ['value'],
};
function verifierCorps(cle, corps, strict) {
  const admis = CORPS[cle];
  if (!strict || !admis || !corps || typeof corps !== 'object') return;
  for (const [k, v] of Object.entries(corps)) {
    if (!admis.includes(k)) throw new Refus(400, `Champ inconnu : ${k}.`);
    if (v === null && !['vlan', 'posX', 'posY'].includes(k)) throw new Refus(400, `Champ ${k} : null refusé.`);
  }
}

function lireCorps(req) {
  return new Promise((resolve) => {
    const morceaux = [];
    req.on('data', c => morceaux.push(c));
    req.on('end', () => {
      const buf = Buffer.concat(morceaux);
      if (!buf.length) return resolve({});
      if (!String(req.headers['content-type'] || '').includes('json')) return resolve({ brut: buf.length });
      try { resolve(JSON.parse(buf.toString('utf8'))); } catch { resolve({}); }
    });
  });
}

// Routeur minimal : [méthode, motif, action(params, corps, requête)].
const routes = [];
const route = (methode, motif, action) => {
  const cles = [];
  const re = new RegExp('^' + motif.replace(/:([a-zA-Z]+)/g, (_, k) => { cles.push(k); return '([^/]+)'; }) + '$');
  routes.push({ methode, motif, re, cles, action });
};

route('GET', '/api/health', () => ({ ok: true, status: 'ok', version: '2.0.0', time: new Date().toISOString() }));
route('GET', '/api/devices', () => appareils);
route('GET', '/api/devices/health/score', () => ({ score: 74 }));
route('GET', '/api/devices/scans/latest', () => ({ id: 'scan1', type: 'arp', subnet: '192.0.2.0/24', status: 'complete', hostsFound: 14, startedAt: il(6), endedAt: il(5), error: null }));
route('GET', '/api/devices/scan/ranges', () => reglages['scan.ranges']);
route('POST', '/api/devices/scan', () => { diffuser('scan:started', { runId: 'scan2', subnet: '192.0.2.0/24' }); setTimeout(() => diffuser('scan:complete', { runId: 'scan2', hostsFound: 14 }), 2500); return { ok: true }; });
route('POST', '/api/devices/manual', (_, c) => { const d = appareil(appareils.length + 1, { ip: c.ip || '192.0.2.99', hostname: c.hostname, customName: c.customName, vendor: c.vendor, model: c.model, type: c.type || 'unknown' }); appareils.push(d); return d; });
route('GET', '/api/devices/grouping/suggestions', () => []);
route('POST', '/api/devices/dedupe', () => ({ groups: 0, removed: 0 }));
route('GET', '/api/devices/:id', ({ id }) => { const d = parId(id); if (!d) throw new Refus(404, 'Appareil inconnu.'); return { ...d, history: historique(id).slice(0, 50) }; });
route('PATCH', '/api/devices/:id', ({ id }, c) => { const d = parId(id); if (!d) throw new Refus(404, 'Appareil inconnu.'); Object.assign(d, c); return d; });
route('DELETE', '/api/devices/:id', ({ id }) => { const i = appareils.findIndex(d => d.id === id); if (appareils[i]?.isMainRouter) throw new Refus(409, 'Le routeur principal ne se supprime pas.'); if (i >= 0) appareils.splice(i, 1); return { ok: true }; });
route('GET', '/api/devices/:id/reservation', ({ id }) => ({ mac: parId(id)?.mac, ip: parId(id)?.ip, vlan: parId(id)?.vlan ?? 10,
  segments: vlans.map(v => ({ id: v.id, nom: v.name, sousReseau: v.subnet, passerelle: v.gateway, pousseSurEquipement: true,
    plage: v.id === 10 ? { prefixe: '192.0.2', octetsFiges: 3, premiere: '192.0.2.2', derniere: '192.0.2.126' } : { prefixe: '198.51.100', octetsFiges: 3, premiere: v.id === 20 ? '198.51.100.2' : '198.51.100.66', derniere: v.id === 20 ? '198.51.100.62' : '198.51.100.126' } })) }));
route('POST', '/api/devices/:id/reservation', (_, c) => ({ ok: true, sortie: '', ipActuelle: '192.0.2.61', ipReservee: c.ip || null, appliquee: true, message: c.retirer ? 'Réservation retirée.' : `Adresse ${c.ip} réservée.` }));
route('POST', '/api/devices/:id/relancer-bail', () => ({ ok: true, sortie: '', message: 'Bail relancé.' }));
route('GET', '/api/devices/:id/ping', () => ({ alive: true, latencyMs: 2 }));
route('POST', '/api/devices/:id/score', ({ id }) => { const d = parId(id); return { trustScore: d.trustScore, activityScore: d.activityScore, vulnScore: d.vulnScore, dangerScore: d.dangerScore, reasons: d.scoreReasons }; });
route('POST', '/api/devices/:id/deep-scan', ({ id }) => ({ ip: parId(id)?.ip, ports: parId(id)?.ports || [] }));
route('GET', '/api/devices/:id/history', ({ id }) => historique(id));
for (const [action, etat] of [['ban', 'banned'], ['quarantine', 'quarantined'], ['unban', 'online']]) {
  route('POST', `/api/devices/:id/${action}`, ({ id }) => { const d = parId(id); if (d) d.status = etat; return { ok: true, output: `règle ${action} appliquée sur la passerelle` }; });
}
route('POST', '/api/devices/:id/interfaces', ({ id }, c) => { const d = parId(id); const i = { id: nouvelId(), deviceId: id, mac: c.mac || null, ip: c.ip || null, type: c.type || 'other', label: c.label || null, posX: null, posY: null, isPrimary: false, createdAt: new Date().toISOString() }; d?.interfaces.push(i); return i; });
route('PATCH', '/api/devices/:id/interfaces/:iface', ({ id, iface }, c) => Object.assign(parId(id)?.interfaces.find(i => i.id === iface) || {}, c));
route('DELETE', '/api/devices/:id/interfaces/:iface', ({ id, iface }) => { const d = parId(id); if (d) d.interfaces = d.interfaces.filter(i => i.id !== iface); return { ok: true }; });
route('POST', '/api/devices/:id/merge', ({ id }, c) => { const i = appareils.findIndex(d => d.id === c.sourceId); if (i >= 0) appareils.splice(i, 1); return parId(id); });

route('GET', '/api/vlans', () => vlans);
route('POST', '/api/vlans/relever', () => ({ lus: 3, ajoutes: 0, misAJour: 1, inchanges: 2, rattaches: 0, orphelins: [], ignores: [] }));
route('POST', '/api/vlans', (_, c) => { const v = { id: c.id, name: c.name, subnet: c.subnet, description: c.description ?? null, color: c.color || '#1B2AFF', isolated: !!c.isolated, gateway: null, networkId: null, createdAt: new Date().toISOString() }; vlans.push(v); return { vlan: v, provision: c.pushToRouter ? { pushed: true, output: '', vendor: 'openwrt' } : null }; });
route('PATCH', '/api/vlans/:id', ({ id }, c) => Object.assign(vlans.find(v => v.id === Number(id)) || {}, c));
route('DELETE', '/api/vlans/:id', ({ id }) => { const i = vlans.findIndex(v => v.id === Number(id)); if (i >= 0) vlans.splice(i, 1); return { ok: true, provision: null }; });

route('GET', '/api/router/adapters', () => adaptateurs);
route('GET', '/api/router', () => routeur);
route('POST', '/api/router/detect', (_, c) => (c.transport === 'api'
  ? { ok: true, detected: 'unifi', info: 'Contrôleur 8.1', empreinteTls: 'AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99', sujetTls: 'CN=unifi.exemple.org', certificatReconnu: false }
  : { ok: true, detected: c.vendor || 'openwrt', info: 'SSH-2.0-OpenSSH_9.6', empreinteHote: EMPREINTE, typeCle: 'ssh-ed25519' }));
route('POST', '/api/router/test', (_, c) => {
  if (c.useSaved) return { ok: true, info: 'Linux passerelle 6.6 · 14 clients', adapter: routeur.vendor, capabilities: routeur.capabilities };
  if (c.transport !== 'api' && !c.empreinteHote) throw new Refus(409, 'Empreinte de la clé d’hôte à confirmer.', { empreinteHote: EMPREINTE });
  return { ok: true, info: 'Connexion établie', adapter: c.vendor, capabilities: adaptateurs.find(a => a.id === c.vendor)?.capabilities || [] };
});
route('PUT', '/api/router', (_, c) => { routeur = { ...routeur, ...c, hasPassword: routeur.hasPassword || !!c.password }; delete routeur.password; delete routeur.privateKey; return routeur; });
route('DELETE', '/api/router', () => { routeur = null; return { ok: true }; });
route('GET', '/api/router/clients', () => ({ supported: true, clients: appareils.filter(d => d.status !== 'offline').map(d => ({ mac: d.mac, ip: d.ip, hostname: d.hostname, vendor: d.vendor, medium: d.type === 'phone' || d.type === 'laptop' || d.type === 'tv' ? 'wireless' : 'wired', blocked: d.status === 'banned' })) }));
route('GET', '/api/router/arp', () => ({ supported: true, entries: appareils.map(d => ({ mac: d.mac, ip: d.ip, hostname: d.hostname, vendor: d.vendor, medium: 'wired' })) }));

route('GET', '/api/ssh', () => consoles);
route('POST', '/api/ssh', (_, c) => { if (!c.empreinteHote) throw new Refus(400, 'Empreinte de la clé d’hôte requise.'); const e = { id: nouvelId(), name: c.name, host: c.host, port: c.port || 22, username: c.username, vendor: c.vendor || 'generic', isMainRouter: !!c.isMainRouter, lastConnected: null, createdAt: new Date().toISOString(), empreinteHote: c.empreinteHote }; consoles.push(e); return { id: e.id, name: e.name, host: e.host, vendor: e.vendor, isMainRouter: e.isMainRouter }; });
route('POST', '/api/ssh/test', (_, c) => (c.empreinteHote ? { ok: true, banner: 'SSH-2.0-OpenSSH_9.6' } : { ok: false, aConfirmer: true, empreinteHote: EMPREINTE, typeCle: 'ssh-ed25519', banner: 'SSH-2.0-OpenSSH_9.6' }));
route('DELETE', '/api/ssh/:id', ({ id }) => { const i = consoles.findIndex(x => x.id === id); if (i >= 0) consoles.splice(i, 1); return { ok: true }; });
route('POST', '/api/ssh/:id/exec', (_, c) => {
  if (/[;&|`\n]|\$\(|[<>]/.test(c.command || '')) throw new Refus(400, 'Commande refusée : un seul appel, sans enchaînement.');
  return { stdout: appareils.slice(0, 6).map(d => `${d.ip} dev br0 lladdr ${d.mac.toLowerCase()} REACHABLE`).join('\n'), stderr: '', code: 0 };
});

route('GET', '/api/topology', () => topologie);
route('POST', '/api/topology/auto-build', () => ({ created: 0, deleted: 0 }));
route('POST', '/api/topology/links', (_, c) => { const l = { id: nouvelId(), fromId: c.fromId, toId: c.toId, fromIfaceId: null, toIfaceId: null, type: c.type || 'ethernet', speed: null, vlan: null, manual: true, createdAt: new Date().toISOString() }; topologie.links.push(l); diffuser('topology:updated', null); return l; });
route('PATCH', '/api/topology/links/:id', ({ id }, c) => Object.assign(topologie.links.find(l => l.id === id) || {}, c));
route('POST', '/api/topology/links/:id/reverse', ({ id }) => { const l = topologie.links.find(x => x.id === id); if (l) [l.fromId, l.toId] = [l.toId, l.fromId]; return l; });
route('DELETE', '/api/topology/links/:id', ({ id }) => { topologie.links = topologie.links.filter(l => l.id !== id); return { ok: true }; });
route('POST', '/api/topology/zones', (_, c) => { const z = { id: nouvelId(), width: 200, height: 150, color: '#1B2AFF', notes: null, ...c, createdAt: new Date().toISOString() }; topologie.zones.push(z); return z; });
route('PATCH', '/api/topology/zones/:id', ({ id }, c) => Object.assign(topologie.zones.find(z => z.id === id) || {}, c));
route('DELETE', '/api/topology/zones/:id', ({ id }) => { topologie.zones = topologie.zones.filter(z => z.id !== id); return { ok: true }; });
route('POST', '/api/topology/positions', (_, c) => { for (const q of c.positions || []) { const d = parId(q.id); if (d) { d.posX = q.x; d.posY = q.y; } } return { ok: true }; });

route('GET', '/api/host/stats', () => statsHote());
route('GET', '/api/host/history', () => histoHote);

route('GET', '/api/stats', () => ({
  total: appareils.length, online: appareils.filter(d => d.status === 'online').length, offline: appareils.filter(d => d.status === 'offline').length,
  suspect: appareils.filter(d => d.status === 'suspect').length, banned: appareils.filter(d => d.status === 'banned').length, quarantined: appareils.filter(d => d.status === 'quarantined').length,
  vlans: vlans.length, alerts: alertes.filter(a => !a.acknowledged).length, openPorts: appareils.reduce((n, d) => n + d.ports.length, 0), subnet: '192.0.2.0/24',
}));
route('GET', '/api/alerts', () => alertes);
route('POST', '/api/alerts/:id/ack', ({ id }) => { const a = alertes.find(x => x.id === id); if (a) a.acknowledged = true; return { ok: true }; });
route('GET', '/api/logs', () => journal);
route('GET', '/api/settings', () => reglages);
route('PUT', '/api/settings/:cle', ({ cle }, c) => { if (!(cle in reglages)) throw new Refus(400, `Réglage inconnu : ${cle}.`); reglages[cle] = c.value; return { ok: true }; });
route('GET', '/api/setup/status', () => ({ complete: !!reglages['setup.complete'], mainRouter: routeur ? { id: routeur.id, host: routeur.host, name: routeur.name, vendor: routeur.vendor } : null }));
route('POST', '/api/setup/complete', () => { reglages['setup.complete'] = true; return { ok: true }; });
route('GET', '/api/rules', () => regles);
route('PATCH', '/api/rules/:id', ({ id }, c) => Object.assign(regles.find(r => r.id === id) || {}, c));
route('GET', '/api/memoire', () => ({ synapse: { envoyes: 0, echecs: 0, enAttente: 0, dernierEnvoi: null, erreur: null, perdus: 0, relie: false } }));
route('POST', '/api/poste/test', () => ({ ok: true, messageId: 'essai' }));

route('GET', '/api/notifications', () => canaux);
route('GET', '/api/notifications/:canal', ({ canal }) => ({
  channel: canal, enabled: !!canaux.find(x => x.channel === canal)?.enabled,
  config: canal === 'telegram' ? { chatId: '-1000000000' } : canal === 'email' ? { address: 'alertes@exemple.org', provider: 'autre', host: 'smtp.exemple.org', port: 465, secure: true } : {},
  secrets: canal === 'telegram' ? { token: true } : canal === 'email' ? { password: true } : {},
}));
route('PUT', '/api/notifications/:canal', ({ canal }, c) => { if (canal === 'sms') throw new Refus(400, 'Canal retiré.'); const x = canaux.find(y => y.channel === canal); if (x) x.enabled = !!c.enabled; return { ok: true }; });
route('POST', '/api/notifications/:canal/test', () => ({ ok: true }));
route('DELETE', '/api/notifications/:canal', () => ({ ok: true }));

route('GET', '/api/commands/triggers', () => declencheurs);
route('GET', '/api/commands/actions', () => actionsCommandes);
route('GET', '/api/commands', () => commandes);
route('POST', '/api/commands', (_, c) => { const x = { id: nouvelId(), filter: null, template: null, cooldownSec: 0, enabled: true, lastFired: null, fireCount: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), ...c }; commandes.push(x); return x; });
route('PATCH', '/api/commands/:id', ({ id }, c) => Object.assign(commandes.find(x => x.id === id) || {}, c));
route('DELETE', '/api/commands/:id', ({ id }) => { commandes = commandes.filter(x => x.id !== id); return { ok: true }; });
route('POST', '/api/commands/:id/fire', () => ({ ok: true }));
route('GET', '/api/bot-commands/actions', () => actionsBot);
route('GET', '/api/bot-commands', () => commandesBot);
route('POST', '/api/bot-commands', (_, c) => { const x = { id: nouvelId(), params: null, confirm: false, allowedChatIds: [], cooldownSec: 0, lastFiredBy: null, lastFiredAt: null, fireCount: 0, enabled: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), ...c }; commandesBot.push(x); return x; });
route('PATCH', '/api/bot-commands/:id', ({ id }, c) => Object.assign(commandesBot.find(x => x.id === id) || {}, c));
route('DELETE', '/api/bot-commands/:id', ({ id }) => { commandesBot = commandesBot.filter(x => x.id !== id); return { ok: true }; });
route('POST', '/api/bot-commands/:id/run', () => ({ reply: '<b>Réseau</b> : 14 appareils, <b>9</b> en ligne.\n<i>2 retenus</i> · <code>192.0.2.0/24</code>' }));

route('POST', '/api/net/whois', (_, c) => ({ actif: true, joignable: true, fiches: (c.ips || []).map(ip => ({ ip, reseau: '198.51.100.0/24', organisation: 'Opérateur A', pays: 'FR', registre: 'ripe' })) }));
route('GET', '/api/traffic/flows', (_, __, q) => {
  const limite = Number(q.get('limite') || 300), avant = Number(q.get('avant') || 0), depuis = Number(q.get('depuis') || 0);
  return flux.filter(f => (!avant || f.dernier < avant) && (!depuis || f.dernier >= depuis)).slice(0, limite);
});
route('GET', '/api/traffic/aggregats', (_, __, q) => aggregats(Number(q.get('depuis') || 0)));
route('GET', '/api/traffic/state', () => etatTrafic());
route('POST', '/api/traffic/collect', () => etatTrafic());
route('POST', '/api/traffic/purge', () => ({ parAge: 0, parTaille: 0, mo: 1.42 }));
route('DELETE', '/api/traffic/flows', () => ({ supprimes: flux.length }));

route('GET', '/api/integrations', () => jetons);
route('POST', '/api/integrations', (_, c) => { const j = { id: nouvelId(), name: c.name, prefix: 'mml_7e1b', role: c.role, createdAt: new Date().toISOString(), lastUsedAt: null, expiresAt: c.expiresAt || null, revokedAt: null, etat: 'actif' }; jetons.unshift(j); return { ...j, token: 'mml_7e1b_jeton-de-demonstration-affiche-une-seule-fois' }; });
route('DELETE', '/api/integrations/:id', ({ id }) => { const j = jetons.find(x => x.id === id); if (j) { j.revokedAt = new Date().toISOString(); j.etat = 'revoque'; } return j; });
route('GET', '/api/logos/:domaine', () => { throw new Refus(404, 'Logos éteints.'); });

route('GET', '/api/mail/providers', (_, __, ___, ancien) => (ancien ? fournisseurs.map(f => ({ ...f, label: f.nom })) : fournisseurs));
route('POST', '/api/mail/resolve', (_, c) => ({ provider: c.provider, nom: fournisseurs.find(f => f.id === c.provider)?.nom || 'Autre', note: fournisseurs.find(f => f.id === c.provider)?.note || null,
  imap: c.provider === 'autre' ? null : { host: `imap.${c.provider}.exemple.org`, port: 993, security: 'ssl' }, smtp: { host: `smtp.${c.provider}.exemple.org`, port: 465, security: 'ssl' }, needs: [] }));
route('POST', '/api/mail/detect', (_, c) => ({ provider: /@exemple\.org$/.test(c.email || '') ? 'autre' : null }));
route('POST', '/api/mail/verify', () => ({ ok: true, inbox: 'Boîte joignable : 3 messages non lus.' }));
route('GET', '/api/mail/mailboxes', () => boites);
route('POST', '/api/mail/mailboxes', (_, c) => { const b = { id: nouvelId(), email: c.email, provider: c.provider || 'autre', role: c.role || 'both', imap: c.imap || null, smtp: c.smtp || null, active: true, hasPassword: true, lastTestAt: new Date().toISOString(), lastTestOk: true, lastTestInfo: null }; boites.push(b); return b; });
route('DELETE', '/api/mail/mailboxes/:id', ({ id }) => { boites = boites.filter(b => b.id !== id); return { ok: true }; });

route('GET', '/api/assistant', () => ({ fil, encours: false, ia: { prete: true, modele: 'modele-local' }, voix: { disponible: false, raison: 'VOX n’est pas installé sur cette instance.' },
  cerveau: { synapse: false, nom: null }, relances: ['Quels appareils sont exposés ?', 'Qu’est-ce qui a changé depuis hier ?'], quota: { jour: 200, restant: 180 } }));
route('POST', '/api/assistant/ask', (_, c) => { const tour = { id: nouvelId(), request: c.text, reply: `Tu as demandé : **${c.text}**.\n\nRien d’inquiétant de ce côté.`, widgets: [], duree: 900, modele: 'modele-local', voix: !!c.voix, sources: ['inventaire'], le: new Date().toISOString() }; fil.push(tour); return tour; });
route('POST', '/api/assistant/stop', () => ({ arrete: false }));
route('POST', '/api/assistant/nouvelle', () => { fil = []; return { ok: true }; });
route('GET', '/api/assistant/voix', () => ({ disponible: false, raison: 'VOX n’est pas installé sur cette instance.' }));
route('POST', '/api/assistant/voix/transcrire', () => { throw new Refus(502, 'VOX injoignable.'); });
route('POST', '/api/assistant/voix/dire', () => { throw new Refus(502, 'VOX injoignable.'); });

// Socle : la session, la page Sécurité, la page Comptes.
route('GET', '/api/compte/etat', () => etatCompte());
route('POST', '/api/compte/deconnexion', () => { sessionOuverte = false; return { ok: true }; });
route('POST', '/api/_essai/session', (_, c) => { sessionOuverte = c.ouverte !== false; return { ok: true }; });
route('POST', '/api/compte/renfort', () => ({ ok: true }));
route('GET', '/api/compte/securite', () => ({
  compte, politique: { motdepasse: 'requis', totp: 'facultatif', cle: 'requis_admin' }, clesPossibles: true, envoiCourriel: true, modeHttp: true,
  cles: [{ id: 'cle1', nom: 'Clé de l’atelier', cree: ms(60 * 24 * 30), utilisee: ms(60 * 5), sauvegardee: false }],
  sessions: [{ id: 's1', appareil: 'Navigateur · Linux', ip: '192.0.2.60', vue: ms(0), courante: true }, { id: 's2', appareil: 'Navigateur · téléphone', ip: '192.0.2.70', vue: ms(60 * 3), courante: false }],
  alertes: [{ type: 'connexion', t: ms(60 * 3), details: { ip: '192.0.2.70', appareil: 'Navigateur · téléphone' }, vue: true }],
}));
route('GET', '/api/compte/admin/comptes', () => ({ comptes: [
  { ...compte, derniere: ms(1), manquants: [] },
  { id: 'compte2essai0000', identifiant: 'observateur', affichage: 'Observateur', role: 'lecture', actif: true, facteurs: { motdepasse: true, totp: true, cles: 0 }, manquants: [], derniere: ms(60 * 30) },
] }));
route('GET', '/api/compte/admin/politique', () => ({ motdepasse: 'requis', totp: 'facultatif', cle: 'requis_admin' }));
route('GET', '/api/compte/admin/journal', () => ({ integrite: { ok: true, lignes: 42 }, lignes: [{ t: ms(3), action: 'connexion', resultat: 'ok', ip: '192.0.2.60', acteur: compte.id }] }));

// La 1.4.1 : son authentification et ses pages de comptes, imitées.
const routesAnciennes = [];
const ancienne = (methode, motif, action) => { const avant = routes.length; route(methode, motif, action); routesAnciennes.push(routes.splice(avant, 1)[0]); };
const moiAncien = { id: 'compte1essai0000', username: 'exploitant', role: 'admin', mustChangePassword: false, totpEnabled: true, doitInscrireA2f: false };
ancienne('GET', '/api/auth/me', () => moiAncien);
ancienne('GET', '/api/auth/needs-setup', () => ({ needsSetup: false }));
ancienne('POST', '/api/auth/logout', () => ({ ok: true }));
ancienne('GET', '/api/auth/totp/status', () => ({ totpEnabled: true, telegramReady: false }));
ancienne('GET', '/api/mfa/etat', () => ({ passkeys: [], telegram: null, totp: true }));
ancienne('GET', '/api/users', () => ({ comptes: [{ id: moiAncien.id, username: 'exploitant', role: 'admin', createdAt: il(90000), lastLogin: il(1), totpEnabled: true }], creationVerrouillee: false, roles: ['admin', 'operator', 'viewer'] }));
ancienne('GET', '/api/users/creation/etat', () => ({ verrouille: false, peutVerrouiller: true }));
ancienne('GET', '/api/integrations', () => jetons.map(j => ({ ...j, role: j.role === 'lecture' ? 'viewer' : 'operator', scope: 'service' })));

function historique(id) {
  const d = parId(id);
  return [
    { id: `${id}-h1`, deviceId: id, event: 'status', data: { from: 'offline', to: d?.status || 'online' }, createdAt: il(40) },
    { id: `${id}-h2`, deviceId: id, event: 'scan', data: { ip: d?.ip, vendor: d?.vendor }, createdAt: il(300) },
    { id: `${id}-h3`, deviceId: id, event: 'edit', data: { changes: { zone: 'Baie' } }, createdAt: il(3000) },
  ];
}

// Temps réel (2.0) : un flux SSE par onglet.
const abonnes = new Set();
function diffuser(nom, donnees) {
  for (const res of abonnes) res.write(`event: ${nom}\ndata: ${JSON.stringify(donnees)}\n\n`);
}
setInterval(() => { for (const res of abonnes) res.write(': ping\n\n'); }, 25_000).unref();
setInterval(() => diffuser('host:metrics', statsHote()), 5_000).unref();

async function api(req, res, url, ancien) {
  const params = {};
  const liste = ancien ? [...routesAnciennes, ...routes] : routes;
  const r = liste.find(x => x.methode === req.method && x.re.test(url.pathname));
  if (!r) {
    if (liste.some(x => x.re.test(url.pathname))) return repondreJson(res, 405, { error: 'Méthode non admise.' });
    return repondreJson(res, 404, { error: 'Route inconnue.' });
  }
  const m = r.re.exec(url.pathname);
  r.cles.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
  const ecriture = !['GET', 'HEAD'].includes(req.method);
  // La 2.0 exige l'en-tête anti-falsification sur toute écriture : son
  // absence dit que l'interface a oublié de le poser.
  if (!ancien && ecriture && req.headers['x-csrf'] !== 'jeton-csrf-essai' && !/^\/api\/(compte|_essai)\//.test(url.pathname)) {
    console.error(`[faux-api] écriture sans X-CSRF : ${req.method} ${url.pathname}`);
    return repondreJson(res, 403, { error: 'Jeton anti-falsification absent.' });
  }
  const corps = ecriture ? await lireCorps(req) : {};
  try {
    verifierCorps(`${req.method} ${r.motif}`, corps, !ancien);
    const reponse = await r.action(params, corps, url.searchParams, ancien);
    repondreJson(res, 200, reponse ?? { ok: true });
  } catch (e) {
    if (!(e instanceof Refus)) console.error(e);
    else if (e.status === 400) console.error(`[faux-api] ${req.method} ${url.pathname} refusé : ${e.message}`);
    repondreJson(res, e.status || 500, { error: e.message, ...(e.details ? { details: e.details } : {}) });
  }
}

// La 2.0, derrière la politique de contenu du socle et la politique des
// permissions du service.
http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const nonce = nonceCsp();
  entetesSecurite(res, { secure: false, csp: politiqueContenu({ nonce, secure: false, img: ['blob:'] }), permissions: PERMISSIONS });
  if (url.pathname === '/api/flux') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
    res.write(': ouvert\n\n');
    abonnes.add(res);
    req.on('close', () => abonnes.delete(res));
    return;
  }
  if (url.pathname.startsWith('/api/')) return api(req, res, url, false);
  if (url.pathname.startsWith('/socle/')) {
    if (servirFichier(req, res, path.join(SOCLE, 'web'), url.pathname.slice('/socle'.length), { nonce })) return;
  } else if (servirFichier(req, res, WEB, url.pathname === '/' ? '/index.html' : url.pathname, { nonce })) return;
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Introuvable');
}).listen(Number(portNeuf), '127.0.0.1', () => console.log(`MapMyLAN 2.0 sur http://127.0.0.1:${portNeuf}/`));

// La 1.4.1 construite, telle qu'elle est livrée. Ses polices venaient d'un
// service tiers : on les remplace par celles du socle, les mêmes des deux
// côtés, pour que la comparaison ne mesure que l'interface. Un jeton factice
// ouvre la session, sauf si la clé mapmylan_essai_deconnecte est posée.
const POLICES = fs.readFileSync(path.join(SOCLE, 'web', 'soma.css'), 'utf8').split('\n').filter(l => l.startsWith('@font-face')).map(l => l.replaceAll('url(polices/', 'url(/socle/polices/')).join('\n');
if (DIST && fs.existsSync(DIST)) {
  http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/api/')) return api(req, res, url, true);
    if (url.pathname.startsWith('/socle/polices/')) { if (servirFichier(req, res, path.join(SOCLE, 'web'), url.pathname.slice('/socle'.length))) return; }
    if (url.pathname === '/' || url.pathname === '/index.html') {
      let html = fs.readFileSync(path.join(DIST, 'index.html'), 'utf8');
      html = html.replace(/<link[^>]+fonts\.(googleapis|gstatic)\.com[^>]*>\s*/g, '')
        .replace('</head>', `<style>${POLICES}</style><script>if(!localStorage.getItem('mapmylan_essai_deconnecte')&&!localStorage.getItem('mapmylan_token'))localStorage.setItem('mapmylan_token','jeton-essai')</script></head>`);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }).end(html);
      return;
    }
    if (servirFichier(req, res, DIST, url.pathname)) return;
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Introuvable');
  }).listen(Number(portAncien), '127.0.0.1', () => console.log(`MapMyLAN 1.4.1 sur http://127.0.0.1:${portAncien}/`));
}
