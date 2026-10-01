// Ce que partagent les essais : un service démarré pour de vrai sur un port
// libre, des comptes inscrits par les parcours du socle, et des doubles aux
// frontières (outils système au seul point d'appel, serveurs HTTP locaux).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { demarrer } from '../src/main.js';
import { Executeur } from '../src/executeur.js';
import { Client } from '../socle/essai/client.js';
import { adminComplet, membreInvite, codeTotp, MDP_ESSAI } from '../socle/essai/inscription.js';

export const SILENCE = { info() {}, warn() {}, error() {} };
export const JETON_INSTALLATION = 'jeton-installation-mapmylan-essai-0123';
export { MDP_ESSAI };

// Les dossiers de données des essais disparaissent avec le processus.
const temporaires = [];
process.on('exit', () => { for (const d of temporaires) fs.rmSync(d, { recursive: true, force: true }); });
export const dossierTemporaire = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'mml-essai-')); temporaires.push(d); return d; };

export async function lancer(extra = {}, options = {}) {
  const dossier = extra.DATA_DIR || dossierTemporaire();
  const env = { PORT: '0', HOTE: '127.0.0.1', DATA_DIR: dossier, SOCLE_JETON_INSTALLATION: JETON_INSTALLATION, SCAN_INTERVAL: '0', ...extra };
  const o = await demarrer(env, { log: SILENCE, options: { planifier: false, ...options } });
  return { ...o, port: o.serveur.address().port, dossier, env };
}

export async function administrateur(o) {
  const c = new Client(o.port);
  const { auth, secret } = await adminComplet(c, { jeton: JETON_INSTALLATION });
  Object.assign(c, { auth, secret, motDePasse: MDP_ESSAI });
  return c;
}

// Le socle exige le facteur le plus fort du compte : la clé d'accès pour
// l'administrateur, l'application TOTP pour les autres.
export async function renforcer(c) {
  let r;
  if (c.auth) {
    const options = await c.post('/api/compte/renfort/options');
    r = await c.post('/api/compte/renfort', { methode: 'cle', reponse: c.auth.signer(options.json, c.origine) });
  } else {
    r = await c.post('/api/compte/renfort', { methode: 'totp', code: codeTotp(c.secret, Date.now(), 1) });
  }
  if (r.status !== 200) throw new Error(`renfort : ${r.status} ${JSON.stringify(r.json)}`);
}

export async function inviter(admin, identifiant, role) {
  await renforcer(admin);
  const { client, compteId, secret } = await membreInvite(admin, () => new Client(admin.port), { identifiant, role });
  return Object.assign(client, { motDePasse: `${MDP_ESSAI} ${identifiant}`, compteId, secret });
}

// Un serveur HTTP local qui note ce qu'il reçoit.
export async function serveurLocal(gestionnaire) {
  const recues = [];
  const serveur = http.createServer(async (req, res) => {
    const morceaux = [];
    for await (const m of req) morceaux.push(m);
    const corps = Buffer.concat(morceaux).toString('utf8');
    recues.push({ methode: req.method, url: req.url, entetes: req.headers, corps });
    gestionnaire(req, res, corps);
  });
  await new Promise(r => serveur.listen(0, '127.0.0.1', r));
  const port = serveur.address().port;
  return { port, url: `http://127.0.0.1:${port}`, recues, fermer: () => new Promise(r => { serveur.closeAllConnections(); serveur.close(r); }) };
}

// Lit un flux SSE : rend les événements au fil de l'eau, et la fin du flux.
export function ouvrirFlux(client, chemin = '/api/flux', entetes = {}) {
  return new Promise((resolve, reject) => {
    const h = { host: `localhost:${client.port}`, ...entetes };
    if (client.cookies?.size) h.cookie = [...client.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
    const req = http.get({ host: '127.0.0.1', port: client.port, path: chemin, headers: h }, res => {
      const flux = { status: res.statusCode, evenements: [], fini: false, attendus: [], fermer: () => req.destroy() };
      let tampon = '';
      res.setEncoding('utf8');
      res.on('data', d => {
        tampon += d;
        let i;
        while ((i = tampon.indexOf('\n\n')) >= 0) {
          const bloc = tampon.slice(0, i); tampon = tampon.slice(i + 2);
          const nom = /^event: (.+)$/m.exec(bloc)?.[1];
          if (!nom) continue;
          const e = { nom, data: JSON.parse(/^data: (.*)$/m.exec(bloc)?.[1] ?? 'null') };
          flux.evenements.push(e);
          for (const a of flux.attendus.filter(x => x.nom === nom)) { flux.attendus.splice(flux.attendus.indexOf(a), 1); a.resolve(e); }
        }
      });
      flux.termine = new Promise(r => res.on('close', () => { flux.fini = true; r(); }));
      flux.attendre = nom => {
        const deja = flux.evenements.find(e => e.nom === nom);
        return deja ? Promise.resolve(deja) : new Promise(resolve => flux.attendus.push({ nom, resolve }));
      };
      flux.corps = async () => { let t = ''; for await (const m of res) t += m; return t; };
      resolve(flux);
    });
    req.on('error', reject);
  });
}

// Le réseau simulé, au seul point où MapMyLAN lance un programme : la
// fonction execFile de l'Executeur. Tout le reste (liste des programmes,
// arguments en tableau, environnement minimal, délais) tourne pour de vrai.
export class ReseauSimule {
  constructor() {
    this.appels = [];
    this.cleServeur = crypto.randomBytes(51).toString('base64');
    this.motDePasse = 'mot-de-passe-de-l-equipement';
    this.sorties = {};
  }

  get executeur() { return new Executeur({ lancer: (p, a, o, cb) => this.lancer(p, a, o, cb) }); }

  lancer(programme, args, options, cb) {
    const appel = { programme, args: [...args], env: { ...options.env }, shell: options.shell };
    this.appels.push(appel);
    const fin = (code, stdout = '', stderr = '') => setImmediate(() => cb(code ? Object.assign(new Error(`sortie ${code}`), { code }) : null, stdout, stderr));
    if (programme === 'ssh-keyscan') {
      const hote = args[args.indexOf('--') + 1];
      return fin(0, `${hote} ssh-ed25519 ${this.cleServeur}\n`, '# 127.0.0.1:22 SSH-2.0-OpenSSH_9.2p1 Essai\n');
    }
    if (programme === 'ssh') return this.ssh(appel, fin);
    // Une sortie simulée : un texte (code 0), ou une fonction des arguments
    // qui rend un texte ou [code, stdout, stderr].
    const sortie = typeof this.sorties[programme] === 'function' ? this.sorties[programme](args) : this.sorties[programme];
    return Array.isArray(sortie) ? fin(...sortie) : fin(0, sortie || '');
  }

  // Ce que fait le vrai client : la clé présentée doit être celle du fichier
  // known_hosts de l'appel, puis le mot de passe vient de SSH_ASKPASS.
  ssh({ args, env }, fin) {
    const option = nom => args.find((a, i) => args[i - 1] === '-o' && a.startsWith(`${nom}=`))?.slice(nom.length + 1);
    const connus = option('UserKnownHostsFile');
    const alias = option('HostKeyAlias');
    const ligne = fs.readFileSync(connus, 'utf8').trim().split(/\s+/);
    if (option('StrictHostKeyChecking') !== 'yes' || ligne[0] !== alias || ligne[2] !== this.cleServeur) {
      return fin(255, '', '@@@ WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED! @@@\nHost key verification failed.\n');
    }
    const lu = execFileSync(env.SSH_ASKPASS, ['essai@hote\'s password: '], { env: { ...env, PATH: process.env.PATH } }).toString().replace(/\n$/, '');
    this.dernierSecret = { lu, fichierRestant: env.MAPMYLAN_SECRET_MDP && fs.existsSync(env.MAPMYLAN_SECRET_MDP) };
    if (lu !== this.motDePasse) return fin(255, '', 'Permission denied (password).\n');
    const commande = args[args.length - 1];
    if (/^uname/.test(commande)) return fin(0, 'Linux passerelle-essai 6.1.0 #1 SMP x86_64 GNU/Linux\n');
    return fin(0, `exécuté : ${commande}\n`);
  }
}
