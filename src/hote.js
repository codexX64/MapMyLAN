// Supervision de la machine : /proc et /sys de l'hôte (montés en lecture
// seule), l'espace disque, et la liste des conteneurs lue par le proxy de
// socket Docker — jamais le socket lui-même, et seulement en lecture.
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import { nouvelId } from './db.js';
import { dansLeReseau } from './cibles.js';

const TAILLE_MAX_DOCKER = 2 * 1048576;
const CARTES_MAX = 32;
const PONTS = /^(docker|br-|veth|virbr|cni|flannel)/;

export class Hote {
  // plages : les plages balayées, pour reconnaître la carte qui les porte ;
  // cartes : os.networkInterfaces, que les essais remplacent.
  constructor({ cfg, db, plages = () => [], cartes = os.networkInterfaces }) {
    this.cfg = cfg; this.db = db; this.plages = plages; this.cartes = cartes;
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

  // Les lignes « cpuN » du /proc de l'hôte : ses cœurs, pas la part que le
  // conteneur en reçoit.
  coeurs() {
    return this.lire(`${this.cfg.proc}/stat`).split('\n').filter(l => /^cpu\d+\s/.test(l)).length || null;
  }

  // Le système de fichiers racine, comme le « df / » de la 1.4.1 ; l'espace
  // libre est celui qu'un processus non privilégié peut encore écrire.
  disque() {
    try {
      const s = fs.statfsSync('/');
      return { pct: s.blocks ? Math.round(((s.blocks - s.bfree) / s.blocks) * 100) : 0, libresGo: Math.round((s.bavail * s.bsize) / 2 ** 30 * 10) / 10 };
    } catch { return { pct: 0, libresGo: null }; }
  }

  // Le conteneur est en réseau hôte : ses cartes sont celles de la machine.
  // Une carte sans IPv4 ni IPv6 routable (un veth, par exemple) n'apprend rien.
  interfaces() {
    let cartes;
    try { cartes = this.cartes(); } catch { return []; }
    const plages = this.plages();
    const out = [];
    for (const [name, adresses] of Object.entries(cartes || {})) {
      const v4 = adresses.find(a => a.family === 'IPv4');
      const retenue = v4 || adresses.find(a => a.family === 'IPv6' && !/^fe80:/i.test(a.address));
      if (!retenue) continue;
      const internal = !!retenue.internal;
      const balaye = !internal && (name === this.cfg.interfaceScan || (!!v4 && plages.some(c => dansLeReseau(v4.address, c))));
      out.push({ name, address: retenue.cidr || retenue.address, internal, role: internal ? 'boucle locale' : balaye ? 'balayage' : PONTS.test(name) ? 'pont de conteneurs' : 'autre' });
      if (out.length >= CARTES_MAX) break;
    }
    return out;
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
    const cpu = this.processeur(), mem = this.memoire(), net = this.debit(), disque = this.disque();
    const charge = parseFloat(this.lire(`${this.cfg.proc}/loadavg`).split(' ')[0]) || 0;
    return {
      cpuPct: Math.round(cpu * 10) / 10, cores: this.coeurs(), memPct: Math.round(mem.pct * 10) / 10, memUsedMB: mem.usedMB, memTotalMB: mem.totalMB,
      diskPct: disque.pct, diskFreeGB: disque.libresGo, tempC: this.temperature(), loadAvg: charge,
      netRxKBs: Math.round(net.rxKBs * 10) / 10, netTxKBs: Math.round(net.txKBs * 10) / 10,
      uptimeSec: parseInt(this.lire(`${this.cfg.proc}/uptime`).split(' ')[0], 10) || 0,
      interfaces: this.interfaces(), containers: await this.conteneurs(),
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
