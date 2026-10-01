// Vérification d'une boîte mail : ouvrir l'IMAP, puis le SMTP, s'authentifier,
// et ne rien garder. Le message d'erreur distingue le nom qui ne résout pas,
// le port fermé, la négociation TLS et les identifiants refusés : quatre
// corrections différentes.
//
// Certificat toujours vérifié (autorités du système, ou celle fournie pour un
// serveur interne) ; jamais d'identifiants en clair. La connexion part vers
// l'adresse validée par la garde de sortie, le certificat est vérifié pour le
// nom du serveur.
import net from 'node:net';
import tls from 'node:tls';

const DELAI_MS = 10_000;

function decrire(e, cote, hote, port) {
  const code = e?.code || '';
  if (e?.name === 'DestinationRefusee') return `${cote} : ${e.message}`;
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return `${cote} : le nom « ${hote} » ne résout pas (DNS).`;
  if (code === 'ECONNREFUSED') return `${cote} : le port ${port} est fermé sur ${hote}.`;
  if (code === 'ETIMEDOUT' || e?.delai) return `${cote} : ${hote}:${port} ne répond pas (délai dépassé).`;
  if (String(code).startsWith('ERR_TLS') || /certificate|self.signed|handshake|CERT/i.test(`${code} ${e?.message}`)) return `${cote} : la négociation TLS a échoué (${code || e?.message}).`;
  return `${cote} : ${e?.message || code || 'échec inconnu'}`;
}

// Un échange ligne à ligne : on écrit, on attend la réponse qui satisfait un prédicat.
class Dialogue {
  constructor(socket) {
    this.socket = socket; this.tampon = ''; this.attente = null; this.mort = null;
    socket.setEncoding('utf8');
    socket.on('data', d => {
      this.tampon += d;
      if (this.tampon.length > 65536) socket.destroy(new Error('réponse démesurée'));
      if (this.attente?.test(this.tampon)) { const a = this.attente, t = this.tampon; this.attente = null; this.tampon = ''; a.ok(t); }
    });
    const casse = e => { this.mort = e; if (this.attente) { const a = this.attente; this.attente = null; a.ko(e); } };
    socket.on('error', casse);
    socket.on('close', () => casse(new Error('connexion fermée par le serveur')));
  }

  attendre(test) {
    if (this.tampon && test(this.tampon)) { const t = this.tampon; this.tampon = ''; return Promise.resolve(t); }
    if (this.mort) return Promise.reject(this.mort);
    return new Promise((ok, ko) => {
      const m = setTimeout(() => { this.attente = null; ko(Object.assign(new Error('délai dépassé'), { delai: true })); }, DELAI_MS);
      this.attente = { test, ok: t => { clearTimeout(m); ok(t); }, ko: e => { clearTimeout(m); ko(e); } };
    });
  }

  ecrire(ligne) { this.socket.write(ligne + '\r\n'); }
  fermer() { this.socket.destroy(); }
}

const optionsTls = (hote, autorite) => ({ servername: net.isIP(hote) ? undefined : hote, minVersion: 'TLSv1.2', ...(autorite ? { ca: autorite } : {}) });

function connecter({ adresse, hote, port, security, autorite }) {
  return new Promise((ok, ko) => {
    const s = security === 'ssl'
      ? tls.connect({ host: adresse, port, ...optionsTls(hote, autorite), checkServerIdentity: (_h, cert) => tls.checkServerIdentity(hote, cert) })
      : net.connect({ host: adresse, port });
    const m = setTimeout(() => { s.destroy(); ko(Object.assign(new Error('délai dépassé'), { delai: true })); }, DELAI_MS);
    s.once(security === 'ssl' ? 'secureConnect' : 'connect', () => { clearTimeout(m); ok(s); });
    s.once('error', e => { clearTimeout(m); ko(e); });
  });
}

function passerEnTls(socket, hote, autorite) {
  socket.removeAllListeners('data'); socket.removeAllListeners('error'); socket.removeAllListeners('close');
  return new Promise((ok, ko) => {
    const s = tls.connect({ socket, ...optionsTls(hote, autorite), checkServerIdentity: (_h, cert) => tls.checkServerIdentity(hote, cert) }, () => ok(s));
    s.once('error', ko);
  });
}

// Le mot de passe ne contient ni retour à la ligne ni caractère nul : sinon
// il écrirait une seconde commande dans le dialogue.
const secretPropre = v => !/[\r\n\0]/.test(v);

async function imap(cfg, utilisateur, mdp) {
  let socket = await connecter(cfg);
  if (cfg.security === 'starttls') {
    const d0 = new Dialogue(socket);
    await d0.attendre(s => /^\* OK/m.test(s));
    d0.ecrire('a0 STARTTLS');
    const r = await d0.attendre(s => /^a0 (OK|NO|BAD)/m.test(s));
    if (!/^a0 OK/m.test(r)) { d0.fermer(); throw Object.assign(new Error('IMAP : le serveur refuse STARTTLS.'), { propre: true }); }
    socket = await passerEnTls(socket, cfg.hote, cfg.autorite);
  }
  const d = new Dialogue(socket);
  if (cfg.security !== 'starttls') await d.attendre(s => /^\* (OK|PREAUTH|BYE)/m.test(s));
  const q = v => '"' + v.replace(/([\\"])/g, '\\$1') + '"';
  d.ecrire(`a1 LOGIN ${q(utilisateur)} ${q(mdp)}`);
  const rep = await d.attendre(s => /^a1 (OK|NO|BAD)/m.test(s));
  if (!/^a1 OK/m.test(rep)) { d.fermer(); throw Object.assign(new Error(`IMAP : ${(/^a1 (?:NO|BAD) (.+)$/m.exec(rep)?.[1] || 'identifiants refusés').trim().slice(0, 160)}`), { propre: true }); }
  d.ecrire('a2 SELECT INBOX');
  const sel = await d.attendre(s => /^a2 (OK|NO|BAD)/m.test(s));
  d.ecrire('a3 LOGOUT');
  d.fermer();
  const n = /^\* (\d+) EXISTS/m.exec(sel)?.[1];
  return n ? `INBOX · ${n} message${Number(n) > 1 ? 's' : ''}` : 'INBOX';
}

async function smtp(cfg, utilisateur, mdp) {
  let socket = await connecter(cfg);
  let d = new Dialogue(socket);
  await d.attendre(s => /^220[ -]/m.test(s));
  d.ecrire('EHLO mapmylan.invalid');
  await d.attendre(s => /^\d{3} /m.test(s));
  if (cfg.security === 'starttls') {
    d.ecrire('STARTTLS');
    const r = await d.attendre(s => /^\d{3}[ -]/m.test(s));
    if (!/^220/m.test(r)) { d.fermer(); throw Object.assign(new Error('SMTP : le serveur refuse STARTTLS.'), { propre: true }); }
    socket = await passerEnTls(socket, cfg.hote, cfg.autorite);
    d = new Dialogue(socket);
    d.ecrire('EHLO mapmylan.invalid');
    await d.attendre(s => /^\d{3} /m.test(s));
  }
  d.ecrire('AUTH LOGIN');
  const defi = await d.attendre(s => /^\d{3}[ -]/m.test(s));
  if (!/^334/m.test(defi)) { d.fermer(); throw Object.assign(new Error(`SMTP : authentification refusée (${defi.trim().split('\n')[0].slice(0, 120)})`), { propre: true }); }
  d.ecrire(Buffer.from(utilisateur).toString('base64'));
  await d.attendre(s => /^\d{3}[ -]/m.test(s));
  d.ecrire(Buffer.from(mdp).toString('base64'));
  const fin = await d.attendre(s => /^\d{3}[ -]/m.test(s));
  d.ecrire('QUIT');
  d.fermer();
  if (!/^235/m.test(fin)) throw Object.assign(new Error(`SMTP : identifiants refusés (${fin.trim().split('\n')[0].slice(0, 120)})`), { propre: true });
}

export async function verifierBoite({ sortie, email, password, role = 'both', imap: cImap, smtp: cSmtp, autorite = null }) {
  if (!secretPropre(password) || !secretPropre(email)) return { ok: false, error: 'Adresse ou mot de passe invalide.' };
  const details = [];
  let inbox;
  const cote = async (nom, c, fn) => {
    const cfg = { hote: c.host, port: c.port, security: c.security, autorite };
    try {
      cfg.adresse = await sortie.destinationTcp(c.host, { confiance: 'liste' });
      return await fn(cfg, email, password);
    } catch (e) { throw Object.assign(new Error(e.propre ? e.message : decrire(e, nom, c.host, c.port)), { propre: true }); }
  };
  try {
    if (role !== 'send') {
      if (!cImap) return { ok: false, error: 'Réglages IMAP manquants.' };
      inbox = await cote('IMAP', cImap, imap);
      details.push(`IMAP ${cImap.host}:${cImap.port} — ${inbox}`);
    }
    if (role !== 'receive') {
      if (!cSmtp) return { ok: false, error: 'Réglages SMTP manquants.', details };
      await cote('SMTP', cSmtp, smtp);
      details.push(`SMTP ${cSmtp.host}:${cSmtp.port} — authentification acceptée`);
    }
  } catch (e) { return { ok: false, error: e.message, details }; }
  return { ok: true, inbox: inbox || 'envoi seul', details };
}
