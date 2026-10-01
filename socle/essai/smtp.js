// Relais SMTP d'essai : TLS implicite ou STARTTLS, authentification PLAIN et
// LOGIN, et une boîte aux lettres en mémoire. Le certificat est fabriqué à la
// volée par openssl, pour que le client vérifie un vrai certificat.
import net from 'node:net';
import tls from 'node:tls';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

export function certificatEssai(nom = 'localhost') {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'smtp-essai-'));
  execFileSync('openssl', ['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes', '-days', '1',
    '-subj', `/CN=${nom}`, '-addext', `subjectAltName=DNS:${nom},IP:127.0.0.1`, '-keyout', path.join(d, 'cle.pem'), '-out', path.join(d, 'cert.pem')], { stdio: 'ignore' });
  const r = { cle: fs.readFileSync(path.join(d, 'cle.pem'), 'utf8'), cert: fs.readFileSync(path.join(d, 'cert.pem'), 'utf8') };
  fs.rmSync(d, { recursive: true, force: true });
  return r;
}

function decoder(donnees) {
  const [tete, ...reste] = donnees.split('\r\n\r\n');
  const entete = n => new RegExp(`^${n}: (.*)$`, 'mi').exec(tete)?.[1] || '';
  const sujet = entete('Subject').replace(/=\?UTF-8\?B\?([^?]+)\?=/g, (_, b) => Buffer.from(b, 'base64').toString());
  return { entetes: tete, sujet, texte: Buffer.from(reste.join('\r\n\r\n').replace(/\s+/g, ''), 'base64').toString() };
}

export async function relaisEssai({ mode = 'starttls', certificat, utilisateur = 'relais', motDePasse = 'mot-de-passe-du-relais', sansStarttls = false } = {}) {
  const boite = [];
  const auths = [];
  const servir = (socket, chiffre) => {
    let tampon = '', enDonnees = false, donnees = [], env = {}, attenteLogin = 0, login = [];
    const dire = l => socket.write(l + '\r\n');
    const ehlo = () => [`250-essai`, ...(!chiffre && mode === 'starttls' && !sansStarttls ? ['250-STARTTLS'] : []), ...(chiffre ? ['250-AUTH PLAIN LOGIN'] : []), '250 8BITMIME'];
    socket.on('data', morceau => {
      tampon += morceau.toString('utf8');
      let i;
      while ((i = tampon.indexOf('\r\n')) >= 0) {
        const l = tampon.slice(0, i);
        tampon = tampon.slice(i + 2);
        if (enDonnees) {
          if (l === '.') { enDonnees = false; boite.push({ ...env, ...decoder(donnees.join('\r\n')) }); env = {}; donnees = []; dire('250 recu'); }
          else donnees.push(l.startsWith('..') ? l.slice(1) : l);
          continue;
        }
        if (attenteLogin) {
          login.push(Buffer.from(l, 'base64').toString());
          if (--attenteLogin) dire('334 UGFzc3dvcmQ6');
          else { auths.push(login); dire(login[0] === utilisateur && login[1] === motDePasse ? '235 ok' : '535 non'); }
          continue;
        }
        const [cmd] = l.split(' ');
        if (/^EHLO$/i.test(cmd)) for (const x of ehlo()) dire(x);
        else if (/^STARTTLS$/i.test(cmd) && !chiffre) {
          dire('220 go');
          socket.removeAllListeners('data');
          const t = new tls.TLSSocket(socket, { isServer: true, key: certificat.cle, cert: certificat.cert });
          servir(t, true);
          return;
        } else if (/^AUTH$/i.test(cmd) && /^AUTH PLAIN /i.test(l)) {
          const [, u, p] = Buffer.from(l.slice(11), 'base64').toString().split('\0');
          auths.push([u, p]);
          dire(u === utilisateur && p === motDePasse ? '235 ok' : '535 non');
        } else if (/^AUTH$/i.test(cmd)) { attenteLogin = 2; login = []; dire('334 VXNlcm5hbWU6'); }
        else if (/^MAIL$/i.test(cmd)) { env.de = /<([^>]*)>/.exec(l)?.[1]; dire('250 ok'); }
        else if (/^RCPT$/i.test(cmd)) { env.a = /<([^>]*)>/.exec(l)?.[1]; dire('250 ok'); }
        else if (/^DATA$/i.test(cmd)) { enDonnees = true; dire('354 go'); }
        else if (/^QUIT$/i.test(cmd)) { dire('221 bye'); socket.end(); }
        else dire('502 ?');
      }
    });
    socket.on('error', () => {});
  };
  const serveur = mode === 'tls'
    ? tls.createServer({ key: certificat.cle, cert: certificat.cert }, s => { s.write('220 essai\r\n'); servir(s, true); })
    : net.createServer(s => { s.write('220 essai\r\n'); servir(s, false); });
  await new Promise(r => serveur.listen(0, '127.0.0.1', r));
  return {
    port: serveur.address().port, boite, auths,
    attendre: async (n, delai = 5000) => {
      const fin = Date.now() + delai;
      while (boite.length < n) { if (Date.now() > fin) throw new Error(`boîte : ${boite.length} message(s) sur ${n}`); await new Promise(r => setTimeout(r, 20)); }
      return boite;
    },
    fermer: () => new Promise(r => serveur.close(r)),
  };
}
