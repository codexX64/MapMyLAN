// Supervision de la machine : /proc et /sys de l'hôte (montés en lecture
// seule), l'espace disque, et la liste des conteneurs lue par le proxy de
// socket Docker — jamais le socket lui-même, et seulement en lecture.
import fs from 'node:fs';
import http from 'node:http';
import { nouvelId } from './db.js';

const TAILLE_MAX_DOCKER = 2 * 1048576;

export class Hote {
  constructor({ cfg, db }) {
    this.cfg = cfg; this.db = db;
    this.cpu = null; this.reseau = null;
    this.docker = cfg.docker ? (cfg.docker.startsWith('unix://') ? { socketPath: cfg.docker.slice(7) } : { host: cfg.docker.slice(6).split(':')[0], port: Number(cfg.docker.split(':').pop()) }) : null;
  }

  lire(chemin) { try { return fs.readFileSync(chemin, 'utf8'); } catch { return ''; } }

  processeur() {
    const champs = this.lire(`${this.cfg.proc}/stat`).split('\n')[0].trim().split(/\s+/).slice(1).map(Number);
    if (champs.length < 5 || champs.some(n => !Number.isFinite(n))) return 0;
    const inactif = champs[3] + champs[4], total = champs.reduce((a, b) => a + b, 0);
    const avant = this.cpu;
    this.cpu = { inactif, total };
    if (!avant || total === avant.total) return 0;
    return Math.max(0, Math.min(100, ((total - avant.total - (inactif - avant.inactif)) / (total - avant.total)) * 100));
  }

  memoire() {
    const m = this.lire(`${this.cfg.proc}/meminfo`);
    const total = Number(/MemTotal:\s+(\d+) kB/.exec(m)?.[1] || 0), dispo = Number(/MemAvailable:\s+(\d+) kB/.exec(m)?.[1] || 0);
    return { pct: total ? ((total - dispo) / total) * 100 : 0, usedMB: Math.round((total - dispo) / 1024), totalMB: Math.round(total / 1024) };
  }

  disque() {
    try {
      const s = fs.statfsSync('/');
      return s.blocks ? Math.round(((s.blocks - s.bfree) / s.blocks) * 100) : 0;
    } catch { return 0; }
  }

  temperature() {
    for (const chemin of ['class/thermal/thermal_zone0/temp', 'class/hwmon/hwmon0/temp1_input', 'class/hwmon/hwmon1/temp1_input', 'class/hwmon/hwmon2/temp1_input']) {
      const n = parseInt(this.lire(`${this.cfg.sys}/${chemin}`).trim(), 10);
      if (Number.isFinite(n) && n > 1000) return Math.round(n / 1000);
      if (Number.isFinite(n) && n > 0) return n;
    }
    return null;
  }

  debit() {
    let rx = 0, tx = 0;
    for (const ligne of this.lire(`${this.cfg.proc}/net/dev`).split('\n').slice(2)) {
      const m = /^\s*(\S+):\s+(\d+)(?:\s+\d+){7}\s+(\d+)/.exec(ligne);
      if (m && !['lo', 'docker0'].includes(m[1])) { rx += Number(m[2]); tx += Number(m[3]); }
    }
    const t = Date.now(), avant = this.reseau;
    this.reseau = { rx, tx, t };
    if (!avant || t === avant.t) return { rxKBs: 0, txKBs: 0 };
    const dt = (t - avant.t) / 1000;
    return { rxKBs: Math.max(0, (rx - avant.rx) / 1024 / dt), txKBs: Math.max(0, (tx - avant.tx) / 1024 / dt) };
  }

  conteneurs() {
    if (!this.docker) return Promise.resolve([]);
    return new Promise(resolve => {
      const req = http.request({ ...this.docker, method: 'GET', path: '/containers/json?all=1', timeout: 3000, headers: { host: 'docker' } }, res => {
        let corps = '';
        res.setEncoding('utf8');
        res.on('data', c => { corps += c; if (corps.length > TAILLE_MAX_DOCKER) res.destroy(); });
        res.on('end', () => {
          try {
            const l = JSON.parse(corps);
            resolve(Array.isArray(l) ? l.slice(0, 500).map(c => ({ id: String(c.Id || '').slice(0, 12), name: String(c.Names?.[0] || '').replace(/^\//, '').slice(0, 128), image: String(c.Image || '').slice(0, 200), state: String(c.State || '').slice(0, 20), status: String(c.Status || '').slice(0, 80) })) : []);
          } catch { resolve([]); }
        });
        res.on('error', () => resolve([]));
      });
      req.on('timeout', () => req.destroy());
      req.on('error', () => resolve([]));
      req.end();
    });
  }

  async mesures() {
    const cpu = this.processeur(), mem = this.memoire(), net = this.debit();
    const charge = parseFloat(this.lire(`${this.cfg.proc}/loadavg`).split(' ')[0]) || 0;
    return {
      cpuPct: Math.round(cpu * 10) / 10, memPct: Math.round(mem.pct * 10) / 10, memUsedMB: mem.usedMB, memTotalMB: mem.totalMB,
      diskPct: this.disque(), tempC: this.temperature(), loadAvg: charge,
      netRxKBs: Math.round(net.rxKBs * 10) / 10, netTxKBs: Math.round(net.txKBs * 10) / 10,
      uptimeSec: parseInt(this.lire(`${this.cfg.proc}/uptime`).split(' ')[0], 10) || 0,
      containers: await this.conteneurs(),
    };
  }

  // Une mesure par minute gardée vingt-quatre heures.
  garder(m) {
    const t = Date.now();
    this.db.prepare(`INSERT INTO mesures_hote(id, cpuPct, memPct, memUsedMB, memTotalMB, diskPct, tempC, loadAvg, netRxKBs, netTxKBs, uptimeSec, createdAt)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(nouvelId(), m.cpuPct, m.memPct, m.memUsedMB, m.memTotalMB, m.diskPct, m.tempC, m.loadAvg, m.netRxKBs, m.netTxKBs, m.uptimeSec, t);
    this.db.prepare('DELETE FROM mesures_hote WHERE createdAt < ?').run(t - 86400e3);
  }
}
