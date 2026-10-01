// SSH vers les équipements, par le client ssh du système.
//
// Trois règles, qui remplacent ce que node-ssh faisait sans rien vérifier :
//   1. la clé d'hôte est épinglée par équipement : lue à l'enregistrement
//      (ssh-keyscan), montrée à l'administrateur qui confirme son empreinte,
//      puis seule admise (StrictHostKeyChecking=yes, fichier known_hosts
//      propre à l'appel). Une clé qui change fait échouer la connexion ;
//   2. le mot de passe et la phrase de clé ne sont jamais des arguments : ils
//      passent par SSH_ASKPASS (demande-secret.js), depuis des fichiers 0600
//      d'un dossier 0700 effacés à la première lecture, et le dossier entier
//      disparaît à la fin de l'appel ;
//   3. aucune configuration ne vient de l'extérieur (-F /dev/null), ni agent,
//      ni transfert, ni commande locale.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ErreurHttp } from '../socle/src/index.js';
import { estHote, estPort } from './cibles.js';

const DEMANDE = path.join(path.dirname(new URL(import.meta.url).pathname), 'demande-secret.js');
export const UTILISATEUR = /^(?!-)[A-Za-z0-9._@+-]{1,64}$/;
const TYPES = { 'ssh-ed25519': 3, 'ecdsa-sha2-nistp256': 2, 'ecdsa-sha2-nistp384': 2, 'ecdsa-sha2-nistp521': 2, 'ssh-rsa': 1 };
const ALGOS = { 'ssh-rsa': 'rsa-sha2-512,rsa-sha2-256,ssh-rsa' };
const SORTIE_MAX = 1024 * 1024;

export const empreinteCle = b64 => 'SHA256:' + crypto.createHash('sha256').update(Buffer.from(b64, 'base64')).digest('base64').replace(/=+$/, '');

export class ErreurSsh extends ErreurHttp {
  constructor(message, { liaison = true, cleHote = false } = {}) { super(502, message); this.liaison = liaison; this.cleHote = cleHote; }
}

function verifierCible({ host, port, username }) {
  if (!estHote(host)) throw new ErreurHttp(400, 'Hôte invalide : une adresse IP ou un nom d’hôte.');
  if (!estPort(port)) throw new ErreurHttp(400, 'Port invalide.');
  if (username !== undefined && !UTILISATEUR.test(username)) throw new ErreurHttp(400, 'Identifiant SSH invalide.');
}

function traduire(stderr) {
  const s = String(stderr || '');
  if (/host key verification failed|remote host identification has changed|host key for .* has changed|no .*host key is known/i.test(s)) {
    return new ErreurSsh('Clé d’hôte différente de celle épinglée : connexion refusée. Si le changement est voulu, réenregistre l’équipement et confirme la nouvelle empreinte.', { cleHote: true });
  }
  if (/permission denied|authentication failed|too many authentication failures/i.test(s)) return new ErreurSsh('Identifiants refusés par l’équipement.');
  if (/connection refused/i.test(s)) return new ErreurSsh('Connexion refusée : le port SSH est fermé.');
  if (/timed out|no route to host|network is unreachable/i.test(s)) return new ErreurSsh('Équipement injoignable (délai dépassé).');
  if (/could not resolve hostname/i.test(s)) return new ErreurSsh('Nom d’hôte inconnu.');
  return new ErreurSsh(`SSH : ${s.trim().split('\n').pop()?.slice(0, 160) || 'échec de connexion'}`);
}

export class Ssh {
  constructor({ executeur }) { this.executeur = executeur; }

  // Les clés que l'hôte présente, la préférée d'abord, et sa bannière.
  async lireCles({ host, port = 22 }) {
    verifierCible({ host, port });
    let r;
    try {
      r = await this.executeur.executer('ssh-keyscan', ['-T', '5', '-p', String(port), '-t', 'ed25519,ecdsa,rsa', '--', host], { delaiMs: 12_000 });
    } catch (e) { throw new ErreurSsh(`Lecture de la clé d’hôte impossible : ${e.message}`); }
    const cles = [];
    for (const ligne of r.stdout.split('\n')) {
      const [, type, b64] = ligne.trim().split(/\s+/);
      if (TYPES[type] && /^[A-Za-z0-9+/]+={0,2}$/.test(b64 || '')) cles.push({ type, cle: b64, empreinte: empreinteCle(b64) });
    }
    cles.sort((a, b) => TYPES[b.type] - TYPES[a.type]);
    const banniere = /SSH-[\d.]+-\S+(?: [^\n]*)?/.exec(r.stderr)?.[0]?.slice(0, 200) || null;
    return { cles, banniere };
  }

  // La clé à épingler : celle que l'hôte présente maintenant et dont
  // l'empreinte est celle que l'administrateur a confirmée.
  async cleConfirmee({ host, port = 22 }, empreinte) {
    const { cles } = await this.lireCles({ host, port });
    if (!cles.length) throw new ErreurSsh('L’équipement ne présente aucune clé d’hôte lisible.');
    const retenue = cles.find(c => c.empreinte === empreinte);
    if (!retenue) throw new ErreurHttp(409, 'L’empreinte confirmée n’est pas celle que l’équipement présente : relis-la.', { empreinteHote: cles[0].empreinte, typeCle: cles[0].type });
    return retenue;
  }

  /**
   * Exécute une commande. cible : { host, port, username, password?,
   * privateKey?, passphrase?, cleHote: { type, cle }, alias }.
   * Rend { stdout, stderr, code } ; lève ErreurSsh si la liaison échoue.
   */
  async executer(cible, commande, { delaiMs = 30_000 } = {}) {
    verifierCible(cible);
    if (!cible.cleHote?.type || !TYPES[cible.cleHote.type]) throw new ErreurSsh('Aucune clé d’hôte épinglée pour cet équipement : enregistre-le à nouveau.', { cleHote: true });
    if (typeof commande !== 'string' || !commande || commande.length > 8192) throw new ErreurHttp(400, 'Commande invalide.');
    const alias = `mml-${String(cible.alias || 'essai').replace(/[^A-Za-z0-9_-]/g, '')}`;
    const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'mml-ssh-'));
    try {
      fs.chmodSync(dossier, 0o700);
      const ecrire = (nom, contenu) => { const f = path.join(dossier, nom); fs.writeFileSync(f, contenu, { mode: 0o600, flag: 'wx' }); return f; };
      const connus = ecrire('known_hosts', `${alias} ${cible.cleHote.type} ${cible.cleHote.cle}\n`);
      const env = { SSH_ASKPASS: DEMANDE, SSH_ASKPASS_REQUIRE: 'force', HOME: dossier };
      if (cible.password) env.MAPMYLAN_SECRET_MDP = ecrire('mdp', cible.password);
      if (cible.passphrase) env.MAPMYLAN_SECRET_PHRASE = ecrire('phrase', cible.passphrase);
      const cle = cible.privateKey ? ecrire('cle', String(cible.privateKey).replace(/\r\n/g, '\n').trimEnd() + '\n') : null;
      const args = [
        '-F', '/dev/null', '-T',
        '-o', 'BatchMode=no', '-o', 'StrictHostKeyChecking=yes', '-o', `UserKnownHostsFile=${connus}`, '-o', 'GlobalKnownHostsFile=/dev/null',
        '-o', `HostKeyAlias=${alias}`, '-o', `HostKeyAlgorithms=${ALGOS[cible.cleHote.type] || cible.cleHote.type}`,
        '-o', 'CheckHostIP=no', '-o', 'UpdateHostKeys=no', '-o', 'ConnectTimeout=10',
        '-o', 'ServerAliveInterval=10', '-o', 'ServerAliveCountMax=2', '-o', 'NumberOfPasswordPrompts=1',
        '-o', `PreferredAuthentications=${cle ? 'publickey,' : ''}keyboard-interactive,password`,
        '-o', 'IdentitiesOnly=yes', '-o', 'IdentityAgent=none', '-o', 'ForwardAgent=no', '-o', 'ForwardX11=no',
        '-o', 'ClearAllForwardings=yes', '-o', 'PermitLocalCommand=no', '-o', 'ControlMaster=no', '-o', 'ControlPath=none',
        '-o', 'LogLevel=ERROR',
        ...(cle ? ['-i', cle] : ['-o', 'PubkeyAuthentication=no']),
        '-p', String(cible.port), '-l', cible.username, '--', cible.host, commande,
      ];
      let r;
      try {
        r = await this.executeur.executer('ssh', args, { delaiMs, env, maxOctets: SORTIE_MAX });
      } catch (e) { throw new ErreurSsh(e.delaiDepasse ? 'L’équipement n’a pas répondu à temps.' : `SSH : ${e.message}`); }
      // 255 : ssh lui-même a échoué (liaison, clé d'hôte, identifiants) ; tout
      // autre code est celui de la commande distante.
      if (r.code === 255) throw traduire(r.stderr);
      return { stdout: r.stdout, stderr: r.stderr, code: r.code };
    } finally {
      fs.rmSync(dossier, { recursive: true, force: true });
    }
  }
}
