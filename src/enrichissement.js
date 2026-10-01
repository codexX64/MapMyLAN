// Enrichissement de fond : pour les appareils au fabricant ou au type
// inconnus, on interroge toutes les sources disponibles, et la plus fiable
// l'emporte : SNMP, bannière HTTP, UPnP, mDNS, bannière SSH, NetBIOS,
// préfixe MAC, nom d'hôte.
//
// Seules les adresses des plages déclarées sont sondées. HTTP en clair
// seulement : un certificat auto-signé ne se lit pas sans désactiver la
// vérification, et la bannière HTTPS vient déjà du balayage nmap.
import http from 'node:http';
import net from 'node:net';
import { fabricantDe } from './oui.js';
import { dansLeReseau, nettoyerTexte } from './cibles.js';
import { transaction } from './db.js';

const DELAI_MS = 4000;
const TAILLE_MAX = 64 * 1024;

function obtenir(ip, port, chemin, methode = 'GET') {
  return new Promise(resolve => {
    const req = http.request({ host: ip, port, path: chemin, method: methode, timeout: DELAI_MS, headers: { 'user-agent': 'MapMyLAN', accept: '*/*' } }, res => {
      let corps = '';
      res.setEncoding('utf8');
      res.on('data', c => { corps += c; if (corps.length > TAILLE_MAX) res.destroy(); });
      res.on('end', () => resolve({ statut: res.statusCode, entetes: res.headers, corps }));
      res.on('error', () => resolve(null));
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(null));
    req.end();
  });
}

const BANNIERES = [
  [/mikrotik|routeros/, 'MikroTik'], [/openwrt/, 'OpenWrt'], [/pfsense/, 'pfSense'], [/opnsense/, 'OPNsense'],
  [/asuswrt|asus/, 'Asus'], [/dd-wrt/, 'DD-WRT'], [/synology|diskstation/, 'Synology'], [/qnap/, 'QNAP'],
  [/unifi|ubnt/, 'Ubiquiti / UniFi'], [/edgeos/, 'Ubiquiti'], [/tp-?link/, 'TP-Link'], [/d-?link/, 'D-Link'], [/netgear/, 'Netgear'],
  [/cisco/, 'Cisco'], [/aruba/, 'Aruba'], [/fortinet|fortigate/, 'Fortinet'], [/raspberry/, 'Raspberry Pi'], [/pve-api|pve-manager/, 'Hyperviseur PVE'],
  [/vmware/, 'VMware'], [/nginx/, 'nginx (serveur web)'], [/apache/, 'Apache (serveur web)'], [/lighttpd/, 'Lighttpd'], [/grafana/, 'Grafana'],
  [/jellyfin|plex/, 'Serveur média'], [/home assistant|hassio/, 'Home Assistant'], [/octoprint/, 'OctoPrint'], [/printer|ipp|cups/, 'Imprimante'],
  [/camera|hikvision|dahua|amcrest|reolink|axis/, 'Caméra IP'],
];

async function sonderHttp(ip, port) {
  const r = await obtenir(ip, port, '/', 'HEAD');
  const serveur = nettoyerTexte(String(r?.entetes?.server || ''), 120);
  const auth = nettoyerTexte(String(r?.entetes?.['www-authenticate'] || ''), 120);
  if (!serveur && !auth) return null;
  const banniere = `${serveur} ${auth}`.toLowerCase();
  for (const [re, vendor] of BANNIERES) if (re.test(banniere)) return { vendor, source: `http:${port}`, os: serveur || undefined };
  return serveur ? { vendor: serveur.split('/')[0].slice(0, 40), source: `http:${port}` } : null;
}

function sonderSsh(ip) {
  return new Promise(resolve => {
    const s = net.connect({ host: ip, port: 22, timeout: 3000 });
    let tampon = '';
    const fin = v => { s.destroy(); resolve(v); };
    s.on('data', d => {
      tampon += d.toString('latin1');
      const i = tampon.indexOf('\n');
      if (i < 0 && tampon.length < 256) return;
      const m = /SSH-2\.0-(\S+(?: [^\r\n]*)?)/.exec(tampon.slice(0, i < 0 ? 256 : i));
      if (!m) return fin(null);
      const brut = nettoyerTexte(m[1], 120), b = brut.toLowerCase();
      if (b.includes('openssh')) {
        const d2 = /openssh[_\s]([\d.]+).*?(ubuntu|debian|raspbian|alpine|centos|rhel|freebsd)/i.exec(brut);
        return fin(d2 ? { vendor: d2[2], os: `OpenSSH ${d2[1]}`, source: 'ssh' } : { vendor: 'Linux/Unix', os: brut, source: 'ssh' });
      }
      if (b.includes('dropbear')) return fin({ vendor: 'Linux embarqué', os: brut, source: 'ssh' });
      if (b.includes('mikrotik') || b.includes('rosssh')) return fin({ vendor: 'MikroTik', os: brut, source: 'ssh' });
      if (b.includes('cisco')) return fin({ vendor: 'Cisco', os: brut, source: 'ssh' });
      return fin({ vendor: brut.split(/[_-]/)[0].slice(0, 40), source: 'ssh' });
    });
    s.on('timeout', () => fin(null));
    s.on('error', () => fin(null));
    s.on('end', () => fin(null));
  });
}

async function sonderUpnp(ip) {
  for (const port of [5000, 8200, 1900]) {
    for (const chemin of ['/rootDesc.xml', '/description.xml', '/upnp/desc/dev_desc.xml', '/IGD.xml']) {
      const r = await obtenir(ip, port, chemin);
      if (!r || r.statut !== 200) continue;
      const champ = n => nettoyerTexte(new RegExp(`<${n}>([^<]{1,200})<`).exec(r.corps)?.[1] || '', 80) || undefined;
      const fabricant = champ('manufacturer'), modele = champ('modelName'), nom = champ('friendlyName');
      if (fabricant || modele || nom) return { vendor: fabricant, model: modele || nom, source: 'upnp' };
    }
  }
  return null;
}

function depuisMdns(services) {
  const s = (services || []).join(' ');
  if (!s) return null;
  if (/_apple-mobdev|_airplay|_raop|_companion-link/.test(s)) return { vendor: 'Apple', source: 'mdns' };
  if (/_googlecast/.test(s)) return { vendor: 'Google (Cast)', type: 'tv', source: 'mdns' };
  if (/_spotify-connect/.test(s)) return { vendor: 'Appareil Spotify Connect', type: 'iot', source: 'mdns' };
  if (/_hap\b|_homekit/.test(s)) return { vendor: 'Accessoire HomeKit', type: 'iot', source: 'mdns' };
  if (/_ipp\b|_printer\b|_pdl-datastream/.test(s)) return { vendor: 'Imprimante', type: 'printer', source: 'mdns' };
  if (/_workstation|_smb/.test(s)) return { vendor: 'Ordinateur', source: 'mdns' };
  return null;
}

function depuisSnmp(descr) {
  if (!descr) return null;
  const d = descr.toLowerCase();
  for (const [re, vendor] of [[/mikrotik|routeros/, 'MikroTik'], [/cisco/, 'Cisco'], [/juniper/, 'Juniper'], [/hp |hewlett/, 'HP'], [/dell/, 'Dell'], [/ubnt|ubiquiti|unifi/, 'Ubiquiti / UniFi'], [/synology/, 'Synology'], [/qnap/, 'QNAP']]) {
    if (re.test(d)) return { vendor, os: descr, source: 'snmp' };
  }
  return { vendor: descr.split(/[, ]/)[0].slice(0, 40), os: descr, source: 'snmp' };
}

function depuisNom(nom) {
  if (!nom) return null;
  const h = nom.toLowerCase();
  const regles = [
    [/iphone|ipad|ipod|macbook|imac|mac\b/, { vendor: 'Apple', type: /phone|pad/.test(h) ? 'phone' : 'laptop' }],
    [/galaxy|samsung/, { vendor: 'Samsung', type: 'phone' }], [/pixel/, { vendor: 'Google Pixel', type: 'phone' }],
    [/echo|alexa/, { vendor: 'Amazon Echo', type: 'iot' }], [/chromecast|googlehome/, { vendor: 'Google', type: 'iot' }],
    [/synology|ds\d+/, { vendor: 'Synology', type: 'server' }], [/qnap|ts\d+/, { vendor: 'QNAP', type: 'server' }],
    [/raspberrypi|raspi/, { vendor: 'Raspberry Pi', type: 'server' }], [/printer|hpprinter|brother|epson|canon/, { type: 'printer' }],
    [/camera|cam\d+|ipcam|hik|dahua|reolink|amcrest/, { type: 'camera' }], [/sonos/, { vendor: 'Sonos', type: 'iot' }],
    [/sonoff|tasmota|esp\d+/, { vendor: 'Espressif (ESP32)', type: 'iot' }], [/shelly/, { vendor: 'Shelly', type: 'iot' }],
    [/hue\d|hue-bridge/, { vendor: 'Philips Hue', type: 'iot' }], [/nintendo|switch\b/, { vendor: 'Nintendo', type: 'console' }],
    [/playstation|ps[345]\b/, { vendor: 'Sony PlayStation', type: 'console' }], [/xbox/, { vendor: 'Microsoft Xbox', type: 'console' }],
    [/tv|smarttv|samsungtv|lgtv|roku|firetv/, { type: 'tv' }],
  ];
  for (const [re, champs] of regles) if (re.test(h)) return { ...champs, source: 'hostname' };
  return null;
}

const FIABILITE = { snmp: 100, http: 80, upnp: 75, mdns: 70, ssh: 65, netbios: 60, oui: 55, hostname: 40 };

export class Enrichissement {
  constructor(s) { this.s = s; this.enCours = false; }

  // Une adresse sondable : dans une plage déclarée, jamais le lien local.
  sondable(ip) { return this.s.scanner.adresseAutorisee(ip) && !dansLeReseau(ip, '169.254.0.0/16'); }

  async enrichir(id, { mdns = null } = {}) {
    const { appareils, scanner, evts } = this.s;
    const d = appareils.ligne(id);
    if (!d || !this.sondable(d.ip)) return null;
    const carte = mdns || await scanner.mdns();
    const [netbios, snmp, ssh, upnp, h80, h8080] = await Promise.all([
      scanner.netbios(d.ip), scanner.snmp(d.ip), sonderSsh(d.ip), sonderUpnp(d.ip), sonderHttp(d.ip, 80), sonderHttp(d.ip, 8080),
    ]);
    const resultats = [depuisNom(d.hostname), depuisMdns(carte[d.ip]?.services), netbios ? { vendor: 'Hôte Windows / SMB', os: netbios, source: 'netbios' } : null,
      depuisSnmp(snmp.sysDescr), ssh, upnp, h80, h8080];
    const oui = d.mac ? fabricantDe(d.mac) : null;
    if (oui) resultats.push({ vendor: oui, source: 'oui' });
    const utiles = resultats.filter(Boolean).sort((a, b) => (FIABILITE[b.source.split(':')[0]] || 0) - (FIABILITE[a.source.split(':')[0]] || 0));
    if (!utiles.length) return null;
    const retenu = {};
    for (const r of utiles) {
      if (r.vendor && (!retenu.vendor || /^unknown$/i.test(retenu.vendor))) retenu.vendor = nettoyerTexte(r.vendor, 80);
      if (r.model && !retenu.model) retenu.model = nettoyerTexte(r.model, 80);
      if (r.os && !retenu.os) retenu.os = nettoyerTexte(r.os, 200);
      if (r.type && !retenu.type) retenu.type = r.type;
    }
    const maj = {};
    if (retenu.vendor && (!d.vendor || d.vendor === 'Unknown' || d.vendor.length < 4)) maj.vendor = retenu.vendor;
    if (retenu.model && !d.model) maj.model = retenu.model;
    if (retenu.os && !d.os) maj.os = retenu.os;
    if (retenu.type && (!d.type || d.type === 'unknown')) maj.type = retenu.type;
    if (Object.keys(maj).length) {
      const sources = utiles.map(r => r.source);
      transaction(this.s.db, () => {
        appareils.modifier(id, maj);
        appareils.noter(id, 'enriched', { ...maj, sources });
      });
      evts.emettre('device:updated', { id, ...maj });
      evts.journaliser('info', 'enrichment', `Appareil ${d.ip} : ${Object.keys(maj).join(', ')} complété(s) par ${[...new Set(sources)].join('/')}`);
    }
    return retenu;
  }

  // Un lot d'appareils mal identifiés, les plus récemment vus d'abord.
  async tour() {
    if (this.enCours) return;
    this.enCours = true;
    try {
      const candidats = this.s.db.prepare(`SELECT id, ip FROM appareils WHERE status != 'offline'
        AND (vendor IS NULL OR vendor = '' OR vendor = 'Unknown' OR type = 'unknown') ORDER BY lastSeen DESC LIMIT 12`).all();
      if (!candidats.length) return;
      const mdns = await this.s.scanner.mdns();
      for (const c of candidats) {
        try { await this.enrichir(c.id, { mdns }); } catch (e) { this.s.evts.journaliser('warn', 'enrichment', `Échec pour ${c.ip} : ${e.message}`); }
      }
    } finally { this.enCours = false; }
  }
}
