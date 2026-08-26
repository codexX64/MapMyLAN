// TOTP (RFC 6238) écrit à la main sur le module crypto de Node.
//
// Aucune dépendance : l'algorithme tient en quelques lignes et éviter une
// bibliothèque de plus pour ça garde le projet léger et auditable.
//
// Le code à six chiffres change toutes les trente secondes. On accepte une
// fenêtre de plus ou moins un intervalle pour tolérer les horloges légèrement
// décalées entre le téléphone et le serveur.

import crypto from "crypto";

const STEP = 30;        // secondes par intervalle
const DIGITS = 6;
const WINDOW = 1;       // ±1 intervalle accepté

// ── Base32 (RFC 4648), l'encodage attendu par les applications d'authentification
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buf: Buffer): string {
  let bits = 0, value = 0, out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(str: string): Buffer {
  const clean = str.toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0, value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = ALPHABET.indexOf(ch);
    if (idx < 0) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** Secret de 20 octets, la taille recommandée pour HMAC-SHA1. */
export function generateSecret(): string {
  return base32Encode(crypto.randomBytes(20));
}

/** Code attendu pour un intervalle donné. */
function codeFor(secret: string, counter: number): string {
  const key = base32Decode(secret);
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  buf.writeUInt32BE(counter >>> 0, 4);

  const hmac = crypto.createHmac("sha1", key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const bin =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);

  return String(bin % 10 ** DIGITS).padStart(DIGITS, "0");
}

/**
 * Vérifie un code saisi par l'utilisateur.
 * La comparaison passe par timingSafeEqual pour ne pas fuiter d'information
 * par le temps de réponse.
 */
export function verifyTotp(secret: string, token: string): boolean {
  const clean = String(token || "").replace(/\D/g, "");
  if (clean.length !== DIGITS) return false;

  const counter = Math.floor(Date.now() / 1000 / STEP);
  for (let w = -WINDOW; w <= WINDOW; w++) {
    const expected = codeFor(secret, counter + w);
    const a = Buffer.from(expected);
    const b = Buffer.from(clean);
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) return true;
  }
  return false;
}

/** URI otpauth:// à encoder en QR pour l'enrôlement. */
export function otpauthUri(secret: string, account: string, issuer = "MapMyLAN"): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: "SHA1",
    digits: String(DIGITS),
    period: String(STEP),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

/** Code numérique à usage unique, pour l'envoi par Telegram. */
export function numericCode(digits = 6): string {
  const max = 10 ** digits;
  return String(crypto.randomInt(0, max)).padStart(digits, "0");
}
