// Envoi des alertes par courriel, par le client SMTP du socle (TLS dès la
// connexion ou STARTTLS exigé, certificat vérifié, jamais en clair).
//
// Le relais est choisi par un administrateur : la connexion part vers
// l'adresse que la garde de sortie a validée, et le certificat est vérifié
// pour le nom du relais — pas de seconde résolution entre les deux.
import net from 'node:net';
import tls from 'node:tls';
import { Postier } from '../socle/src/index.js';

export const PREREGLAGES = {
  gmail: { host: 'smtp.gmail.com', port: 465, secure: true },
  outlook: { host: 'smtp-mail.outlook.com', port: 587, secure: false },
  apple: { host: 'smtp.mail.me.com', port: 587, secure: false },
};

class PostierVerifie extends Postier {
  constructor({ adresse, ...o }) { super(o); this.adresse = adresse; }

  connecter() {
    return new Promise((resolve, reject) => {
      const s = this.securite === 'tls'
        ? tls.connect({ ...this.optionsTls(), host: this.adresse, servername: net.isIP(this.hote) ? undefined : this.hote, port: this.port })
        : net.connect({ host: this.adresse, port: this.port });
      s.setTimeout(this.delaiMs, () => s.destroy(new Error('Relais SMTP muet.')));
      s.once(this.securite === 'tls' ? 'secureConnect' : 'connect', () => { s.removeListener('error', reject); resolve(s); });
      s.once('error', reject);
    });
  }

  // Après STARTTLS, le nom vérifié reste celui du relais.
  optionsTls(socket) { return { ...super.optionsTls(socket), host: this.hote }; }
}

// Réglages effectifs d'un canal courriel : un préréglage de fournisseur ou
// l'hôte saisi. `secure` vrai : TLS dès la connexion ; faux : STARTTLS exigé.
export function relaisDe(c) {
  const p = PREREGLAGES[c.provider] || { host: c.host, port: c.port, secure: c.secure === undefined ? Number(c.port || 465) === 465 : c.secure };
  if (!p.host) throw new Error('Aucun relais SMTP configuré.');
  return { hote: p.host, port: p.port || (p.secure ? 465 : 587), securite: p.secure ? 'tls' : 'starttls' };
}

export async function envoyerCourriel({ config, sortie, a, sujet, texte }) {
  const relais = relaisDe(config);
  const adresse = await sortie.destinationTcp(relais.hote, { confiance: 'liste' });
  const postier = new PostierVerifie({
    ...relais, adresse, utilisateur: config.address, motDePasse: config.password, de: config.from || config.address,
    nom: 'MapMyLAN', autorite: config.autorite || null, delaiMs: 15_000,
  });
  await postier.envoyer({ a, sujet: String(sujet).replace(/[\r\n]+/g, ' ').slice(0, 200), texte });
}
