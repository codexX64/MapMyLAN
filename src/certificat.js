// Certificats des équipements administrés en HTTPS (API UniFi).
//
// Un équipement local présente presque toujours un certificat auto-signé.
// La 1.4.1 désactivait alors la vérification ; ici, jamais. À l'enregistrement,
// on lit le certificat présenté (sans rien échanger d'autre avec l'hôte) pour
// montrer son empreinte à l'administrateur ; une fois confirmée, ce certificat
// devient la seule autorité admise pour cet hôte, et son empreinte est
// revérifiée à chaque connexion.
import crypto from 'node:crypto';
import tls from 'node:tls';
import { ErreurHttp } from '../socle/src/index.js';

const enPem = der => `-----BEGIN CERTIFICATE-----\n${der.toString('base64').match(/.{1,64}/g).join('\n')}\n-----END CERTIFICATE-----\n`;
export const empreinteDer = der => crypto.createHash('sha256').update(der).digest('hex').toUpperCase().match(/../g).join(':');

/**
 * Le certificat que l'hôte présente. `reconnu` : la chaîne est valide pour les
 * autorités du système. L'événement interne « secure » est le seul moment où
 * le certificat est lisible avant que la vérification ne ferme la connexion ;
 * aucune donnée applicative ne passe par cette connexion.
 */
export function lireCertificat({ host, port, adresse = host, delaiMs = 8000 }) {
  return new Promise((resolve, reject) => {
    let vu = null;
    const s = tls.connect({ host: adresse, port, servername: /^[\d.]+$|:/.test(host) ? undefined : host, rejectUnauthorized: true, timeout: delaiMs });
    s.prependListener('secure', () => {
      const c = s.getPeerCertificate(true);
      if (c?.raw) vu = { der: c.raw, sujet: c.subject?.CN || null, emetteur: c.issuer?.CN || null };
    });
    const fin = reconnu => {
      s.destroy();
      if (!vu) return reject(new ErreurHttp(502, 'Aucun certificat lisible sur cet hôte.'));
      resolve({ pem: enPem(vu.der), empreinte: empreinteDer(vu.der), sujet: vu.sujet, emetteur: vu.emetteur, reconnu });
    };
    s.once('secureConnect', () => fin(true));
    s.once('timeout', () => { s.destroy(); reject(new ErreurHttp(502, 'L’hôte n’a pas répondu en TLS à temps.')); });
    s.once('error', e => (vu ? fin(false) : reject(new ErreurHttp(502, `TLS : ${e.code || e.message}`))));
  });
}

// Options d'une connexion vers un hôte au certificat épinglé : ce certificat
// comme seule autorité, et son empreinte à la place du nom (un équipement
// joint par son adresse porte rarement un certificat à son nom).
export function tlsEpingle({ pem, empreinte }) {
  return {
    ca: [pem],
    checkServerIdentity: (_hote, cert) => (cert?.raw && empreinteDer(cert.raw) === empreinte
      ? undefined
      : new Error('Certificat différent de celui épinglé à l’enregistrement.')),
  };
}
