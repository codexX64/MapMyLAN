// Le seul point par lequel MapMyLAN lance un programme : nmap, arp-scan,
// ping, ssh… Jamais de shell : un binaire fixe, des arguments en tableau,
// chacun validé par son appelant. Les essais remplacent `lancer` par un
// double, à ce seul endroit.
import { execFile } from 'node:child_process';

// Programmes admis : un nom qui n'est pas dans cette liste n'est jamais lancé,
// même si un appelant se trompe.
export const PROGRAMMES = new Set(['nmap', 'arp-scan', 'ping', 'ip', 'avahi-browse', 'nmblookup', 'snmpget', 'ssh', 'ssh-keyscan']);

// Environnement minimal : rien du processus parent (secrets compris) ne
// passe aux outils, sauf ce que l'appelant ajoute explicitement.
const ENV_BASE = { PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin', LANG: 'C.UTF-8' };

export class Executeur {
  constructor({ lancer = execFile } = {}) { this.lancer = lancer; }

  // { stdout, stderr, code }. Un outil qui sort en erreur rend quand même ce
  // qu'il a écrit (nmap, arp-scan le font) ; un délai dépassé lève.
  executer(programme, args, { delaiMs = 60_000, env = {}, maxOctets = 32 * 1024 * 1024 } = {}) {
    if (!PROGRAMMES.has(programme)) return Promise.reject(new Error(`programme non admis : ${programme}`));
    if (!Array.isArray(args) || args.some(a => typeof a !== 'string' || a.includes('\0'))) return Promise.reject(new Error('arguments invalides'));
    return new Promise((resolve, reject) => {
      // SIGKILL : arp-scan ignore SIGTERM pendant un balayage, et survivait au
      // délai dépassé en consommant de la mémoire indéfiniment.
      this.lancer(programme, args, { timeout: delaiMs, killSignal: 'SIGKILL', maxBuffer: maxOctets, env: { ...ENV_BASE, ...env }, windowsHide: true, shell: false }, (err, stdout, stderr) => {
        if (err && (err.killed || err.signal === 'SIGKILL')) return reject(Object.assign(new Error(`délai dépassé après ${Math.round(delaiMs / 1000)} s`), { delaiDepasse: true }));
        if (err && err.code === 'ENOENT') return reject(Object.assign(new Error(`${programme} absent de l'image`), { absent: true }));
        if (err && typeof err.code !== 'number') return reject(err);
        resolve({ stdout: String(stdout || ''), stderr: String(stderr || ''), code: err ? err.code : 0 });
      });
    });
  }
}
