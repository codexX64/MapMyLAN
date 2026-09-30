// Sauvegarde chiffrée de la base (REQ-DATA-003) : un instantané cohérent,
// chiffré pour une clé publique RSA dont la clé privée ne vit pas sur la
// machine du service. Le service sait écrire une sauvegarde, il ne sait pas la
// relire : qui prend la machine ne prend pas l'historique.
//
// Format : « SOCLE-SAUV1 », une ligne d'en-tête JSON (lue comme données
// authentifiées : service, version, date, clé AES chiffrée), puis le chiffré
// AES-256-GCM suivi de son étiquette.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { backup } from 'node:sqlite';

const MAGIE = 'SOCLE-SAUV1\n';
const BITS_MIN = 3072;
const OAEP = { padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' };

function clePublique(pem) {
  const cle = crypto.createPublicKey(pem);
  if (cle.asymmetricKeyType !== 'rsa' || cle.asymmetricKeyDetails.modulusLength < BITS_MIN) throw new Error(`Clé de sauvegarde : RSA de ${BITS_MIN} bits au moins.`);
  return cle;
}

// L'instantané chiffré de la base ouverte `db`.
export async function sauvegarder(db, pem, { service, version = '', maintenant = new Date() }) {
  const cle = clePublique(pem);
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'sauvegarde-'));
  try {
    const fichier = path.join(dossier, 'base.db');
    await backup(db, fichier);
    const clair = fs.readFileSync(fichier);
    const aes = crypto.randomBytes(32), iv = crypto.randomBytes(12);
    const entete = JSON.stringify({ format: 1, service, version, date: maintenant.toISOString(), algo: 'RSA-OAEP-256+AES-256-GCM',
      cle: crypto.publicEncrypt({ key: cle, ...OAEP }, aes).toString('base64'), iv: iv.toString('base64') }) + '\n';
    const c = crypto.createCipheriv('aes-256-gcm', aes, iv);
    c.setAAD(Buffer.from(entete));
    const chiffre = Buffer.concat([c.update(clair), c.final()]);
    clair.fill(0);
    return Buffer.concat([Buffer.from(MAGIE + entete), chiffre, c.getAuthTag()]);
  } finally {
    fs.rmSync(dossier, { recursive: true, force: true });
  }
}

// La base en clair, depuis une sauvegarde et la clé privée, sur une autre machine.
export function dechiffrer(donnees, pemPrive) {
  if (!donnees.subarray(0, MAGIE.length).equals(Buffer.from(MAGIE))) throw new Error('Pas une sauvegarde du socle.');
  const fin = donnees.indexOf(0x0a, MAGIE.length);
  const ligne = donnees.subarray(MAGIE.length, fin + 1);
  const entete = JSON.parse(ligne.toString('utf8'));
  if (entete.format !== 1) throw new Error(`Format de sauvegarde inconnu : ${entete.format}`);
  const aes = crypto.privateDecrypt({ key: pemPrive, ...OAEP }, Buffer.from(entete.cle, 'base64'));
  const d = crypto.createDecipheriv('aes-256-gcm', aes, Buffer.from(entete.iv, 'base64'));
  d.setAAD(ligne);
  d.setAuthTag(donnees.subarray(donnees.length - 16));
  return { entete, base: Buffer.concat([d.update(donnees.subarray(fin + 1, donnees.length - 16)), d.final()]) };
}
