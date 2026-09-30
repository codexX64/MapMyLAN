// L'inventaire : appareils, leurs ports, CVE, interfaces et historique.
import { nouvelId } from './db.js';
import * as F from './formes.js';

const grouper = (lignes, cle = 'deviceId') => {
  const m = new Map();
  for (const l of lignes) (m.get(l[cle]) || m.set(l[cle], []).get(l[cle])).push(l);
  return m;
};

export class Appareils {
  constructor(db) { this.db = db; }

  ligne(id) { return this.db.prepare('SELECT * FROM appareils WHERE id = ?').get(id) || null; }
  parIp(ip) { return this.db.prepare('SELECT * FROM appareils WHERE ip = ? ORDER BY lastSeen DESC LIMIT 1').get(ip) || null; }
  parMac(mac) { return this.db.prepare('SELECT * FROM appareils WHERE mac = ?').get(mac) || null; }

  // Tout l'inventaire avec ses relations, en quatre lectures plutôt qu'une par appareil.
  lister({ limite = 10000 } = {}) {
    const lignes = this.db.prepare('SELECT * FROM appareils ORDER BY lastSeen DESC LIMIT ?').all(limite);
    const ports = grouper(this.db.prepare('SELECT * FROM ports ORDER BY port').all());
    const cves = grouper(this.db.prepare('SELECT * FROM cves ORDER BY cvss DESC').all());
    const interfaces = grouper(this.db.prepare('SELECT * FROM interfaces ORDER BY createdAt').all());
    return lignes.map(d => F.appareil(d, { ports: ports.get(d.id) || [], cves: cves.get(d.id) || [], interfaces: interfaces.get(d.id) || [] }));
  }

  complet(id, { historique = 0 } = {}) {
    const d = this.ligne(id);
    if (!d) return null;
    const forme = F.appareil(d, {
      ports: this.db.prepare('SELECT * FROM ports WHERE deviceId = ? ORDER BY port').all(id),
      cves: this.db.prepare('SELECT * FROM cves WHERE deviceId = ? ORDER BY cvss DESC').all(id),
      interfaces: this.db.prepare('SELECT * FROM interfaces WHERE deviceId = ? ORDER BY createdAt').all(id),
    });
    if (historique) forme.history = this.historique(id, historique);
    return forme;
  }

  historique(id, limite = 100) {
    return this.db.prepare('SELECT * FROM historique WHERE deviceId = ? ORDER BY createdAt DESC LIMIT ?').all(id, limite).map(F.evenementHistorique);
  }

  noter(deviceId, event, details = {}) {
    this.db.prepare('INSERT INTO historique(id, deviceId, event, data, createdAt) VALUES(?,?,?,?,?)').run(nouvelId(), deviceId, event, JSON.stringify(details), Date.now());
  }

  creer(champs) {
    const t = Date.now();
    const d = {
      id: nouvelId(), ip: '0.0.0.0', mac: null, hostname: null, customName: null, vendor: null, model: null, os: null, type: 'unknown',
      customType: null, vlan: null, zone: null, tags: '[]', notes: null, role: null, status: 'online', posX: null, posY: null,
      metadata: null, firstSeen: t, lastSeen: t, ...champs,
    };
    this.db.prepare(`INSERT INTO appareils(id, ip, mac, hostname, customName, vendor, model, os, type, customType, vlan, zone, tags, notes, role, status, posX, posY, metadata, firstSeen, lastSeen)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(d.id, d.ip, d.mac, d.hostname, d.customName, d.vendor, d.model, d.os, d.type, d.customType, d.vlan, d.zone,
      d.tags, d.notes, d.role, d.status, d.posX, d.posY, d.metadata, d.firstSeen, d.lastSeen);
    return this.ligne(d.id);
  }

  // Mise à jour d'une liste fermée de colonnes : le nom d'une colonne ne
  // vient jamais d'une requête.
  modifier(id, champs) {
    const COLONNES = ['ip', 'mac', 'hostname', 'customName', 'vendor', 'model', 'os', 'type', 'customType', 'vlan', 'zone', 'tags', 'notes', 'role', 'status',
      'trustScore', 'activityScore', 'vulnScore', 'dangerScore', 'scoreReasons', 'whitelisted', 'isMainRouter', 'posX', 'posY', 'pinned', 'lastSeen', 'metadata'];
    const cles = Object.keys(champs).filter(k => COLONNES.includes(k));
    if (!cles.length) return this.ligne(id);
    const valeur = (k, v) => (['tags', 'scoreReasons', 'metadata'].includes(k) && v !== null && typeof v === 'object' ? JSON.stringify(v)
      : typeof v === 'boolean' ? (v ? 1 : 0) : v);
    this.db.prepare(`UPDATE appareils SET ${cles.map(k => `${k} = ?`).join(', ')} WHERE id = ?`).run(...cles.map(k => valeur(k, champs[k])), id);
    return this.ligne(id);
  }

  supprimer(id) { return this.db.prepare('DELETE FROM appareils WHERE id = ?').run(id).changes > 0; }

  // Les ports relevés remplacent les précédents : un port fermé depuis disparaît.
  remplacerPorts(deviceId, ports) {
    this.db.prepare('DELETE FROM ports WHERE deviceId = ?').run(deviceId);
    const ins = this.db.prepare('INSERT OR IGNORE INTO ports(id, deviceId, port, protocol, state, service, product, version, detectedAt) VALUES(?,?,?,?,?,?,?,?,?)');
    const t = Date.now();
    for (const p of ports) ins.run(nouvelId(), deviceId, p.port, p.protocol, p.state, p.service || null, p.product || null, p.version || null, t);
  }
}
