// Petits outils partagés : encodages, comparaison en temps constant, erreurs HTTP.
import crypto from 'node:crypto';

export class ErreurHttp extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    if (details) this.details = details;
  }
}

export const b64url = buf => Buffer.from(buf).toString('base64url');
export const deB64url = s => Buffer.from(String(s || ''), 'base64url');
export const sha256 = x => crypto.createHash('sha256').update(x).digest();
export const sha256hex = x => crypto.createHash('sha256').update(x).digest('hex');
export const aleatoire = (n = 32) => crypto.randomBytes(n).toString('base64url');

// Les deux côtés passent par un HMAC avant timingSafeEqual : les longueurs sont
// égalisées sans que la durée ne trahisse celle du secret attendu.
export function egal(a, b) {
  const ha = crypto.createHmac('sha256', 'egal').update(String(a ?? '')).digest();
  const hb = crypto.createHmac('sha256', 'egal').update(String(b ?? '')).digest();
  return crypto.timingSafeEqual(ha, hb);
}

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function base32(buf) {
  let bits = 0, reserve = 0, texte = '';
  for (const o of buf) {
    reserve = (reserve << 8) | o; bits += 8;
    while (bits >= 5) { texte += B32[(reserve >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) texte += B32[(reserve << (5 - bits)) & 31];
  return texte;
}
export function deBase32(s) {
  const propre = String(s).replace(/=+$/, '').replace(/\s/g, '').toUpperCase();
  let bits = 0, reserve = 0; const octets = [];
  for (const c of propre) {
    const i = B32.indexOf(c);
    if (i < 0) throw new Error('base32 invalide');
    reserve = (reserve << 5) | i; bits += 5;
    if (bits >= 8) { octets.push((reserve >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(octets);
}

// Base32 de Crockford pour ce qu'un humain recopie : ni I, ni L, ni O, ni U.
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export function crockford(nCar) {
  const octets = crypto.randomBytes(nCar);
  let s = '';
  for (let i = 0; i < nCar; i++) s += CROCKFORD[octets[i] & 31];
  return s;
}
export function normaliseCrockford(s) {
  return String(s || '').toUpperCase().replace(/[\s-]/g, '')
    .replace(/[IL]/g, '1').replace(/O/g, '0');
}
