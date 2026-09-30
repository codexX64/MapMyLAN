// Courriel sortant, sans dépendance : le canal des alertes de sécurité
// (REQ-AUTH-014) et de la vérification d'adresse (REQ-AUTH-012).
//
// Toujours chiffré : TLS dès la connexion (465) ou STARTTLS exigé (587, 25) ;
// un relais qui ne propose pas STARTTLS est refusé, jamais contourné en clair.
// Le certificat du relais est vérifié, par les autorités du système ou par
// celle fournie (SOCLE_SMTP_AUTORITE).
import net from 'node:net';
import tls from 'node:tls';
import crypto from 'node:crypto';

const ADRESSE = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;

export const adresseValide = a => typeof a === 'string' && a.length <= 254 && ADRESSE.test(a);

// Lecteur de réponses SMTP : une réponse peut tenir sur plusieurs lignes
// (« 250-… » puis « 250 … »).
class Canal {
  constructor(socket) {
    this.socket = socket;
    this.tampon = '';
    this.lignes = [];
    this.attente = [];
    this.erreur = null;
    socket.setEncoding('utf8');
    socket.on('data', d => {
      this.tampon += d;
      let i;
      while ((i = this.tampon.indexOf('\n')) >= 0) {
        this.lignes.push(this.tampon.slice(0, i).replace(/\r$/, ''));
        this.tampon = this.tampon.slice(i + 1);
      }
      if (this.tampon.length > 16384) socket.destroy(new Error('Réponse SMTP démesurée.'));
      this.reveiller();
    });
    socket.on('error', e => { this.erreur = e; this.reveiller(); });
    socket.on('close', () => { this.erreur ??= new Error('Le relais SMTP a fermé la connexion.'); this.reveiller(); });
  }

  reveiller() { for (const f of this.attente.splice(0)) f(); }

  detacher() { this.socket.removeAllListeners('data'); this.socket.removeAllListeners('error'); this.socket.removeAllListeners('close'); }

  async reponse() {
    const texte = [];
    for (;;) {
      while (!this.lignes.length) {
        if (this.erreur) throw this.erreur;
        await new Promise(r => this.attente.push(r));
      }
      const l = this.lignes.shift();
      texte.push(l);
      if (!/^\d{3}-/.test(l)) return { code: Number(l.slice(0, 3)), texte: texte.join('\n') };
    }
  }

  async commande(ligne, attendus, secret = false) {
    if (ligne !== null) this.socket.write(ligne + '\r\n');
    const r = await this.reponse();
    if (!attendus.includes(r.code)) throw new Error(`Relais SMTP : ${secret ? 'authentification' : ligne?.split(' ')[0] || 'accueil'} refusé (${r.code}).`);
    return r;
  }
}

const motEncode = s => /^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s).toString('base64')}?=`;

function dateCourriel(d) {
  const j = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getUTCDay()];
  const m = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()];
  const p = n => String(n).padStart(2, '0');
  return `${j}, ${p(d.getUTCDate())} ${m} ${d.getUTCFullYear()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())} +0000`;
}

export function composer({ de, nom, a, sujet, texte, maintenant = new Date() }) {
  if (!adresseValide(de) || !adresseValide(a)) throw new Error('Adresse de courriel invalide.');
  const domaine = de.split('@')[1];
  const corps = Buffer.from(texte.replace(/\r?\n/g, '\r\n')).toString('base64').replace(/.{76}/g, '$&\r\n');
  return [
    `From: ${motEncode(nom)} <${de}>`,
    `To: <${a}>`,
    `Subject: ${motEncode(sujet)}`,
    `Date: ${dateCourriel(maintenant)}`,
    `Message-ID: <${crypto.randomBytes(16).toString('hex')}@${domaine}>`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    'Auto-Submitted: auto-generated',
    '',
    corps,
  ].join('\r\n');
}

export class Postier {
  constructor({ hote, port, securite = 'tls', utilisateur = null, motDePasse = null, de, nom, autorite = null, delaiMs = 20_000 }) {
    if (!['tls', 'starttls'].includes(securite)) throw new Error('SMTP : sécurité « tls » ou « starttls » attendue.');
    Object.assign(this, { hote, port: port || (securite === 'tls' ? 465 : 587), securite, utilisateur, motDePasse, de, nom, autorite, delaiMs });
  }

  optionsTls(socket) {
    return { host: this.hote, servername: net.isIP(this.hote) ? undefined : this.hote, minVersion: 'TLSv1.2', ...(this.autorite ? { ca: this.autorite } : {}), ...(socket ? { socket } : {}) };
  }

  connecter() {
    return new Promise((resolve, reject) => {
      const s = this.securite === 'tls' ? tls.connect({ ...this.optionsTls(), port: this.port }) : net.connect({ host: this.hote, port: this.port });
      s.setTimeout(this.delaiMs, () => s.destroy(new Error('Relais SMTP muet.')));
      s.once(this.securite === 'tls' ? 'secureConnect' : 'connect', () => { s.removeListener('error', reject); resolve(s); });
      s.once('error', reject);
    });
  }

  async envoyer({ a, sujet, texte }) {
    const message = composer({ de: this.de, nom: this.nom, a, sujet, texte });
    let socket = await this.connecter();
    let canal = new Canal(socket);
    const helo = this.de.split('@')[1];
    try {
      await canal.commande(null, [220]);
      let ehlo = await canal.commande(`EHLO ${helo}`, [250]);
      if (this.securite === 'starttls') {
        if (!/^250[- ]STARTTLS\b/im.test(ehlo.texte)) throw new Error('Le relais SMTP ne propose pas STARTTLS : envoi refusé.');
        await canal.commande('STARTTLS', [220]);
        canal.detacher();
        socket = await new Promise((resolve, reject) => {
          const t = tls.connect(this.optionsTls(socket), () => resolve(t));
          t.once('error', reject);
        });
        socket.setTimeout(this.delaiMs, () => socket.destroy(new Error('Relais SMTP muet.')));
        canal = new Canal(socket);
        ehlo = await canal.commande(`EHLO ${helo}`, [250]);
      }
      if (this.utilisateur) {
        if (/^250[- ]AUTH\b.*\bPLAIN\b/im.test(ehlo.texte)) {
          await canal.commande(`AUTH PLAIN ${Buffer.from(`\0${this.utilisateur}\0${this.motDePasse || ''}`).toString('base64')}`, [235], true);
        } else {
          await canal.commande('AUTH LOGIN', [334], true);
          await canal.commande(Buffer.from(this.utilisateur).toString('base64'), [334], true);
          await canal.commande(Buffer.from(this.motDePasse || '').toString('base64'), [235], true);
        }
      }
      await canal.commande(`MAIL FROM:<${this.de}>`, [250]);
      await canal.commande(`RCPT TO:<${a}>`, [250, 251]);
      await canal.commande('DATA', [354]);
      await canal.commande(message.replace(/^\./gm, '..') + '\r\n.', [250]);
      socket.write('QUIT\r\n');
    } finally {
      socket.end();
    }
  }
}
