// Clés d'accès (WebAuthn niveau 2) : cérémonies d'inscription et de connexion.
//
// Tout ce que le navigateur renvoie est vérifié ici, rien n'est cru sur parole :
// type de cérémonie, défi (usage unique, fourni par l'appelant depuis le
// serveur), origine exacte, empreinte de l'identifiant de partie (rpId),
// présence ET vérification de l'utilisateur, signature, et compteur qui ne
// recule jamais. La clé publique et le compte propriétaire viennent de la base,
// jamais de la réponse.
import crypto from 'node:crypto';
import { decodeCbor } from './cbor.js';
import { b64url, deB64url, sha256 } from './outils.js';

export const ALGOS = [-7, -8, -257]; // ES256, EdDSA, RS256
const UP = 0x01, UV = 0x04, BE = 0x08, BS = 0x10, AT = 0x40, ED = 0x80;
const DELAI_MS = 120_000;

export class ErreurWebauthn extends Error {}
const refuse = m => { throw new ErreurWebauthn(m); };

export function optionsCreation({ rp, utilisateur, defi, exclure = [] }) {
  return {
    challenge: defi,
    rp: { id: rp.id, name: rp.nom },
    user: { id: utilisateur.handle, name: utilisateur.nom, displayName: utilisateur.affichage || utilisateur.nom },
    pubKeyCredParams: ALGOS.map(alg => ({ type: 'public-key', alg })),
    authenticatorSelection: { residentKey: 'required', requireResidentKey: true, userVerification: 'required' },
    attestation: 'none',
    excludeCredentials: exclure.map(id => ({ type: 'public-key', id })),
    timeout: DELAI_MS,
  };
}

export function optionsAuthentification({ rpId, defi, autorises = [] }) {
  return {
    challenge: defi, rpId, userVerification: 'required', timeout: DELAI_MS,
    allowCredentials: autorises.map(id => ({ type: 'public-key', id })),
  };
}

function lireClientData(b64, typeAttendu, defi, origines) {
  let cd;
  try { cd = JSON.parse(deB64url(b64).toString('utf8')); } catch { refuse('clientDataJSON illisible'); }
  if (cd.type !== typeAttendu) refuse('type de cérémonie inattendu');
  const recu = Buffer.from(String(cd.challenge || ''));
  const attendu = Buffer.from(String(defi || ''));
  if (!defi || recu.length !== attendu.length || !crypto.timingSafeEqual(recu, attendu)) refuse('défi inconnu ou déjà utilisé');
  if (!origines.includes(cd.origin)) refuse('origine non autorisée');
  if (cd.crossOrigin === true) refuse('cérémonie inter-origines refusée');
  return cd;
}

export function lireAuthData(buf) {
  if (buf.length < 37) refuse('authenticatorData trop court');
  const d = { rpIdHash: buf.subarray(0, 32), flags: buf[32], compteur: buf.readUInt32BE(33) };
  let pos = 37;
  if (d.flags & AT) {
    if (buf.length < pos + 18) refuse('données de clé tronquées');
    d.aaguid = buf.subarray(pos, pos + 16).toString('hex'); pos += 16;
    const n = buf.readUInt16BE(pos); pos += 2;
    if (n < 16 || n > 1023 || buf.length < pos + n) refuse('identifiant de clé invalide');
    d.credId = buf.subarray(pos, pos + n); pos += n;
    const { valeur, fin } = decodeCbor(buf.subarray(pos), { partiel: true });
    d.cose = valeur; pos += fin;
  }
  if (d.flags & ED) { const { fin } = decodeCbor(buf.subarray(pos), { partiel: true }); pos += fin; }
  if (pos !== buf.length) refuse('authenticatorData : octets en trop');
  return d;
}

export function cleDepuisCose(cose) {
  if (!(cose instanceof Map)) refuse('clé COSE invalide');
  const kty = cose.get(1), alg = cose.get(3);
  if (!ALGOS.includes(alg)) refuse('algorithme non accepté');
  let jwk;
  if (kty === 2 && alg === -7 && cose.get(-1) === 1) {
    const x = cose.get(-2), y = cose.get(-3);
    if (!Buffer.isBuffer(x) || !Buffer.isBuffer(y) || x.length !== 32 || y.length !== 32) refuse('point EC invalide');
    jwk = { kty: 'EC', crv: 'P-256', x: b64url(x), y: b64url(y) };
  } else if (kty === 1 && alg === -8 && cose.get(-1) === 6) {
    const x = cose.get(-2);
    if (!Buffer.isBuffer(x) || x.length !== 32) refuse('clé Ed25519 invalide');
    jwk = { kty: 'OKP', crv: 'Ed25519', x: b64url(x) };
  } else if (kty === 3 && alg === -257) {
    const n = cose.get(-1), e = cose.get(-2);
    if (!Buffer.isBuffer(n) || !Buffer.isBuffer(e) || n.length < 256) refuse('clé RSA invalide');
    jwk = { kty: 'RSA', n: b64url(n), e: b64url(e) };
  } else refuse('type de clé non accepté');
  const cle = crypto.createPublicKey({ key: jwk, format: 'jwk' });
  return { alg, spki: cle.export({ type: 'spki', format: 'der' }) };
}

function signatureValide(alg, spki, donnees, sig) {
  const key = crypto.createPublicKey({ key: Buffer.from(spki), format: 'der', type: 'spki' });
  try {
    if (alg === -7) return crypto.verify('sha256', donnees, { key, dsaEncoding: 'der' }, sig);
    if (alg === -257) return crypto.verify('sha256', donnees, key, sig);
    if (alg === -8) return crypto.verify(null, donnees, key, sig);
  } catch { return false; }
  return false;
}

function drapeaux(ad, rpId) {
  if (!crypto.timingSafeEqual(ad.rpIdHash, sha256(rpId))) refuse('rpId inattendu');
  if (!(ad.flags & UP)) refuse('présence de l’utilisateur non attestée');
  if (!(ad.flags & UV)) refuse('vérification de l’utilisateur absente (biométrie ou code requis)');
}

// Réponse d'inscription → ce qu'il faut enregistrer.
export function verifierCreation({ reponse, defi, origines, rpId }) {
  if (reponse?.type !== 'public-key') refuse('réponse inattendue');
  const r = reponse.response || {};
  lireClientData(r.clientDataJSON, 'webauthn.create', defi, origines);
  let att;
  try { att = decodeCbor(deB64url(r.attestationObject)); } catch { refuse('attestationObject illisible'); }
  if (!(att instanceof Map) || !Buffer.isBuffer(att.get('authData'))) refuse('attestationObject invalide');
  const authData = att.get('authData');
  const ad = lireAuthData(authData);
  drapeaux(ad, rpId);
  if (!(ad.flags & AT) || !ad.credId) refuse('aucune clé dans la réponse');
  if (b64url(ad.credId) !== reponse.id) refuse('identifiant de clé incohérent');
  const { alg, spki } = cleDepuisCose(ad.cose);

  // L'attestation n'est pas demandée (attestation: 'none') : aucune confiance
  // n'est accordée au fabricant. Quand un authentificateur en fournit une quand
  // même, sa signature est contrôlée pour les formats auto-signés courants.
  const fmt = att.get('fmt');
  const stmt = att.get('attStmt');
  if (fmt === 'packed' && stmt instanceof Map && !stmt.get('x5c')) {
    const donnees = Buffer.concat([authData, sha256(deB64url(r.clientDataJSON))]);
    if (stmt.get('alg') !== alg || !signatureValide(alg, spki, donnees, stmt.get('sig'))) refuse('auto-attestation invalide');
  } else if (typeof fmt !== 'string') refuse('format d’attestation absent');

  return {
    credId: b64url(ad.credId), spki: b64url(spki), alg, compteur: ad.compteur,
    aaguid: ad.aaguid, sauvegardable: !!(ad.flags & BE), sauvegardee: !!(ad.flags & BS),
    transports: Array.isArray(r.transports) ? r.transports.filter(t => typeof t === 'string').slice(0, 6) : [],
  };
}

// cle : la ligne enregistrée ({ spki, alg, compteur, handle }). Renvoie le
// nouveau compteur à écrire.
export function verifierAuthentification({ reponse, defi, origines, rpId, cle }) {
  if (reponse?.type !== 'public-key') refuse('réponse inattendue');
  const r = reponse.response || {};
  lireClientData(r.clientDataJSON, 'webauthn.get', defi, origines);
  const authData = deB64url(r.authenticatorData);
  const ad = lireAuthData(authData);
  drapeaux(ad, rpId);
  if (r.userHandle && cle.handle && r.userHandle !== cle.handle) refuse('clé présentée pour un autre compte');
  const donnees = Buffer.concat([authData, sha256(deB64url(r.clientDataJSON))]);
  if (!signatureValide(cle.alg, deB64url(cle.spki), donnees, deB64url(r.signature))) refuse('signature invalide');
  // Compteur à zéro des deux côtés : l'authentificateur n'en tient pas (clés
  // synchronisées). Sinon il doit progresser, faute de quoi la clé a été clonée.
  if ((ad.compteur !== 0 || cle.compteur !== 0) && ad.compteur <= cle.compteur) {
    refuse('compteur de signature en recul : clé possiblement clonée');
  }
  return { compteur: ad.compteur, sauvegardee: !!(ad.flags & BS) };
}
