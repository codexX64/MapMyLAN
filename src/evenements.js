// Ce qui se passe dans MapMyLAN : le bus que lit le flux temps réel, le
// journal de service (ce que voit la page Journal) et les alertes.
//
// Le journal de service n'est pas le journal de sécurité du socle : il
// raconte le réseau (balayages, équipement, relevés), pas qui a fait quoi.
// Il n'y entre ni secret ni commande complète.
import { EventEmitter } from 'node:events';
import { nouvelId } from './db.js';
import * as F from './formes.js';

// Les noms émis vers le navigateur, ceux de la 1.4.1 (docs/API.md, section 3).
export const NOMS_FLUX = Object.freeze([
  'devices:updated', 'device:updated', 'device:deleted',
  'scan:started', 'scan:complete', 'scan:progress',
  'alert:new', 'log:new', 'topology:updated', 'host:metrics',
]);

const NIVEAUX = new Set(['info', 'warn', 'error', 'success']);
const RETENTION_JOURNAL_MS = 30 * 86400e3;
const RETENTION_ALERTES_MS = 180 * 86400e3;

export class Evenements {
  constructor({ db, log = console }) {
    this.db = db; this.log = log;
    this.bus = new EventEmitter();
    // Un flux par onglet et plusieurs services internes : la limite par
    // défaut (dix) signalerait une fuite qui n'en est pas une.
    this.bus.setMaxListeners(500);
    // Ce que d'autres modules veulent savoir d'une alerte (extensions,
    // notifications) : branché par main.js, jamais importé d'ici.
    this.surAlerte = [];
  }

  emettre(nom, donnees = null) { this.bus.emit(nom, donnees); }

  journaliser(level, source, message, metadata = null) {
    const niveau = NIVEAUX.has(level) ? level : 'info';
    const ligne = { id: nouvelId(), level: niveau, source: String(source).slice(0, 40), message: String(message).slice(0, 1000), metadata: metadata ? JSON.stringify(metadata) : null, createdAt: Date.now() };
    try {
      this.db.prepare('INSERT INTO journal_service(id, level, source, message, metadata, createdAt) VALUES(?,?,?,?,?,?)')
        .run(ligne.id, ligne.level, ligne.source, ligne.message, ligne.metadata, ligne.createdAt);
    } catch (e) {
      // Le journal ne doit jamais faire échouer ce qu'il raconte.
      this.log.error?.('[journal]', e.message);
      return null;
    }
    const forme = F.ligneJournal(ligne);
    this.emettre('log:new', forme);
    return forme;
  }

  alerter(severity, source, message, { deviceId = null, deviceIp = null, deviceMac = null, metadata = null } = {}) {
    const ligne = { id: nouvelId(), severity, source, message: String(message).slice(0, 1000), deviceId, deviceIp, deviceMac, metadata: metadata ? JSON.stringify(metadata) : null, createdAt: Date.now() };
    this.db.prepare('INSERT INTO alertes(id, severity, source, message, deviceId, deviceIp, deviceMac, acknowledged, metadata, createdAt) VALUES(?,?,?,?,?,?,?,0,?,?)')
      .run(ligne.id, ligne.severity, ligne.source, ligne.message, ligne.deviceId, ligne.deviceIp, ligne.deviceMac, ligne.metadata, ligne.createdAt);
    const forme = F.alerte(ligne);
    this.emettre('alert:new', forme);
    for (const f of this.surAlerte) {
      try { f(forme); } catch (e) { this.log.warn?.('[alerte]', e.message); }
    }
    this.journaliser(severity === 'info' ? 'info' : severity === 'low' ? 'warn' : 'error', source, message);
    return forme;
  }

  purger(maintenant = Date.now()) {
    this.db.prepare('DELETE FROM journal_service WHERE createdAt < ?').run(maintenant - RETENTION_JOURNAL_MS);
    this.db.prepare('DELETE FROM alertes WHERE createdAt < ? AND acknowledged = 1').run(maintenant - RETENTION_ALERTES_MS);
  }
}
