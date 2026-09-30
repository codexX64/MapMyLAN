// TOTP (RFC 6238) : six chiffres, pas de trente secondes, dérive d'un pas au plus.
//
// Le rejeu est refusé : le dernier pas accepté est mémorisé par le compte, et
// aucun code d'un pas antérieur ou égal ne passe plus. Un code intercepté ne
// sert donc qu'une fois, même dans sa fenêtre de validité.
import crypto from 'node:crypto';
import { base32, deBase32 } from './outils.js';

export const PAS = 30;
const DERIVE = 1;

export const nouveauSecret = () => base32(crypto.randomBytes(20));
export const pasCourant = (t = Date.now()) => Math.floor(t / 1000 / PAS);

export function code(secret, pas) {
  const compteur = Buffer.alloc(8);
  compteur.writeBigUInt64BE(BigInt(pas));
  const h = crypto.createHmac('sha1', deBase32(secret)).update(compteur).digest();
  const o = h[h.length - 1] & 15;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1e6).padStart(6, '0');
}

// Renvoie le pas accepté, ou null. dernierPas : le pas du dernier code accepté
// pour ce compte (0 si aucun).
export function verifier(secret, saisi, { dernierPas = 0, t = Date.now() } = {}) {
  const c = String(saisi ?? '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(c)) return null;
  const courant = pasCourant(t);
  let trouve = null;
  // Toutes les fenêtres sont calculées, trouvées ou non : la durée ne dit pas
  // laquelle a correspondu.
  for (let d = -DERIVE; d <= DERIVE; d++) {
    const pas = courant + d;
    const attendu = Buffer.from(code(secret, pas));
    if (crypto.timingSafeEqual(attendu, Buffer.from(c)) && trouve === null) trouve = pas;
  }
  if (trouve === null || trouve <= dernierPas) return null;
  return trouve;
}

export function uriOtpauth({ emetteur, compte, secret }) {
  const e = encodeURIComponent(emetteur), c = encodeURIComponent(compte);
  return `otpauth://totp/${e}:${c}?secret=${secret}&issuer=${e}&algorithm=SHA1&digits=6&period=${PAS}`;
}
