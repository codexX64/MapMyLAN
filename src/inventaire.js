// Tenue de l'inventaire : doublons d'adresse, fusion de deux fiches, et
// regroupement des deux cartes d'une même machine.
import { ErreurHttp } from '../socle/src/index.js';
import { nouvelId, transaction } from './db.js';

// La fiche à garder quand plusieurs portent la même adresse : le routeur
// principal, puis ce qui est vivant, ce qui a une MAC, ce que l'utilisateur
// a nommé, le plus récemment vu.
const rang = d => [d.isMainRouter ? 0 : 1, { online: 0, suspect: 1, banned: 2 }[d.status] ?? 3, d.mac ? 0 : 1, d.customName ? 0 : 1, -d.lastSeen];
function meilleure(a, b) {
  const ra = rang(a), rb = rang(b);
  for (let i = 0; i < ra.length; i++) if (ra[i] !== rb[i]) return ra[i] < rb[i] ? a : b;
  return a;
}

// Rapatrie tout ce qui pend de `perdant` sur `gagnant`, puis efface `perdant`.
function absorber(db, gagnant, perdant) {
  // La MAC est unique en base : libérée d'abord, sinon la reprise échoue.
  db.prepare('UPDATE appareils SET mac = NULL WHERE id = ?').run(perdant.id);
  db.prepare('UPDATE OR IGNORE ports SET deviceId = ? WHERE deviceId = ?').run(gagnant.id, perdant.id);
  db.prepare('UPDATE OR IGNORE cves SET deviceId = ? WHERE deviceId = ?').run(gagnant.id, perdant.id);
  db.prepare('UPDATE historique SET deviceId = ? WHERE deviceId = ?').run(gagnant.id, perdant.id);
  db.prepare('UPDATE interfaces SET deviceId = ? WHERE deviceId = ?').run(gagnant.id, perdant.id);
  db.prepare('UPDATE OR IGNORE liens SET fromId = ? WHERE fromId = ? AND toId != ?').run(gagnant.id, perdant.id, gagnant.id);
  db.prepare('UPDATE OR IGNORE liens SET toId = ? WHERE toId = ? AND fromId != ?').run(gagnant.id, perdant.id, gagnant.id);
  db.prepare('DELETE FROM appareils WHERE id = ?').run(perdant.id);
}

export function dedoublonner(s) {
  const { db, evts } = s;
  const parIp = new Map();
  for (const d of db.prepare("SELECT * FROM appareils WHERE ip != '0.0.0.0'").all()) (parIp.get(d.ip) || parIp.set(d.ip, []).get(d.ip)).push(d);
  let groupes = 0, retires = 0;
  transaction(db, () => {
    for (const [ip, liste] of parIp) {
      if (liste.length < 2) continue;
      groupes++;
      const gagnant = liste.reduce(meilleure);
      const perdants = liste.filter(d => d.id !== gagnant.id);
      for (const p of perdants) {
        absorber(db, gagnant, p);
        // La MAC du doublon devient une interface de la fiche gardée.
        if (p.mac && p.mac !== gagnant.mac && !db.prepare('SELECT 1 FROM interfaces WHERE mac = ?').get(p.mac)) {
          db.prepare("INSERT INTO interfaces(id, deviceId, mac, ip, type, label, createdAt) VALUES(?,?,?,?, 'ethernet', 'reprise doublon', ?)").run(nouvelId(), gagnant.id, p.mac, p.ip, Date.now());
        }
        retires++;
      }
      s.appareils.noter(gagnant.id, 'action_taken', { action: 'dedupe', ip, absorbed: perdants.map(p => ({ id: p.id, mac: p.mac })) });
    }
  });
  if (retires) {
    evts.journaliser('info', 'dedupe', `${retires} doublon(s) fusionné(s) sur ${groupes} adresse(s)`);
    evts.emettre('devices:updated');
  }
  return { groups: groupes, removed: retires };
}

// Absorbe la fiche `sourceId` dans `cibleId` : la source devient une ou
// plusieurs interfaces de la cible (Wi-Fi et Ethernet d'une même machine).
export function fusionner(s, cibleId, { sourceId, keepName, ifaceType }) {
  const { db, appareils } = s;
  if (sourceId === cibleId) throw new ErreurHttp(400, 'Un appareil ne se fusionne pas avec lui-même.');
  const cible = appareils.ligne(cibleId), source = appareils.ligne(sourceId);
  if (!cible || !source) throw new ErreurHttp(404, 'Appareil introuvable.');
  if (source.isMainRouter) throw new ErreurHttp(409, 'Le routeur principal ne se fusionne pas dans un autre appareil.');
  transaction(db, () => {
    const t = Date.now();
    if (cible.mac && !db.prepare('SELECT 1 FROM interfaces WHERE mac = ?').get(cible.mac)) {
      db.prepare("INSERT INTO interfaces(id, deviceId, mac, ip, type, label, isPrimary, posX, posY, createdAt) VALUES(?,?,?,?, 'ethernet', 'primary', 1, ?, ?, ?)")
        .run(nouvelId(), cible.id, cible.mac, cible.ip, cible.posX, cible.posY, t);
    }
    if (source.mac && !db.prepare('SELECT 1 FROM interfaces WHERE mac = ?').get(source.mac)) {
      const wifi = ifaceType ? ifaceType === 'wifi' : /wi-?fi|wireless|wlan/i.test(`${source.hostname || ''} ${source.vendor || ''}`);
      db.prepare('UPDATE appareils SET mac = NULL WHERE id = ?').run(source.id);
      db.prepare('INSERT INTO interfaces(id, deviceId, mac, ip, type, label, posX, posY, createdAt) VALUES(?,?,?,?,?,?,?,?,?)')
        .run(nouvelId(), cible.id, source.mac, source.ip, wifi ? 'wifi' : 'ethernet', source.hostname || null, source.posX, source.posY, t);
    }
    const reprise = {};
    if (!cible.hostname && source.hostname) reprise.hostname = source.hostname;
    if (!cible.vendor && source.vendor) reprise.vendor = source.vendor;
    if (keepName === 'source' && source.customName) reprise.customName = source.customName;
    absorber(db, cible, source);
    if (Object.keys(reprise).length) appareils.modifier(cible.id, reprise);
    appareils.noter(cible.id, 'action_taken', { action: 'merge', absorbed: { id: source.id, mac: source.mac, hostname: source.hostname } });
  });
  s.evts.emettre('device:deleted', { id: sourceId });
  s.evts.emettre('devices:updated');
  return appareils.complet(cibleId);
}

// Regroupement par plan d'adressage : PREFIXE.C.N en Ethernet et
// PREFIXE.(C×MULT).N en Wi-Fi désignent la même machine N. Le préfixe dépend
// entièrement de l'installation : sans lui, rien n'est proposé.
export function suggestionsRegroupement(s) {
  if (s.reglages.lire('grouping.enabled') !== true) return [];
  const prefixe = s.reglages.lire('grouping.prefix') || s.cfg.prefixeRegroupement;
  if (!prefixe) return [];
  const mult = s.reglages.lire('grouping.wifiMultiplier') || 10;
  const groupes = new Map();
  for (const d of s.db.prepare('SELECT id, ip, hostname, customName FROM appareils').all()) {
    if (!d.ip?.startsWith(prefixe + '.')) continue;
    const reste = d.ip.slice(prefixe.length + 1).split('.');
    if (reste.length !== 2) continue;
    const [categorie, octet] = reste.map(Number);
    if (!Number.isInteger(categorie) || !Number.isInteger(octet)) continue;
    const wifi = categorie % mult === 0 && categorie >= mult;
    const cat = wifi ? categorie / mult : categorie;
    const cle = `${cat}:${octet}`;
    const g = groupes.get(cle) || groupes.set(cle, { key: cle, category: cat, octet }).get(cle);
    g[wifi ? 'wifi' : 'ethernet'] = { id: d.id, ip: d.ip, name: d.customName || d.hostname || d.ip };
  }
  return [...groupes.values()].filter(g => g.ethernet && g.wifi);
}
