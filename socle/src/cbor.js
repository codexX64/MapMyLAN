// Décodeur CBOR (RFC 8949) réduit à ce que WebAuthn transporte : entiers,
// chaînes d'octets et de texte, tableaux, tables, booléens, null.
//
// Il lit des données envoyées par le navigateur, donc par n'importe qui : la
// profondeur, le nombre d'éléments et les longueurs sont bornés, et toute forme
// inattendue (longueur indéfinie, flottant, étiquette) est refusée.
const PROFONDEUR = 8;
const ELEMENTS = 512;

export function decodeCbor(buf, { partiel = false } = {}) {
  const b = Buffer.from(buf);
  let pos = 0, compte = 0;

  const octet = () => { if (pos >= b.length) throw new Error('CBOR tronqué'); return b[pos++]; };
  function argument(info) {
    if (info < 24) return info;
    if (info === 24) return octet();
    if (info === 25) { if (pos + 2 > b.length) throw new Error('CBOR tronqué'); const v = b.readUInt16BE(pos); pos += 2; return v; }
    if (info === 26) { if (pos + 4 > b.length) throw new Error('CBOR tronqué'); const v = b.readUInt32BE(pos); pos += 4; return v; }
    if (info === 27) {
      if (pos + 8 > b.length) throw new Error('CBOR tronqué');
      const v = b.readBigUInt64BE(pos); pos += 8;
      if (v > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('CBOR : entier hors limites');
      return Number(v);
    }
    throw new Error('CBOR : longueur indéfinie ou réservée refusée');
  }
  function tranche(n) {
    if (n > b.length - pos) throw new Error('CBOR tronqué');
    const t = b.subarray(pos, pos + n); pos += n; return t;
  }
  function lire(profondeur) {
    if (profondeur > PROFONDEUR) throw new Error('CBOR trop profond');
    if (++compte > ELEMENTS) throw new Error('CBOR trop volumineux');
    const initial = octet();
    const type = initial >> 5, info = initial & 31;
    switch (type) {
      case 0: return argument(info);
      case 1: return -1 - argument(info);
      case 2: return Buffer.from(tranche(argument(info)));
      case 3: return tranche(argument(info)).toString('utf8');
      case 4: {
        const n = argument(info), t = [];
        for (let i = 0; i < n; i++) t.push(lire(profondeur + 1));
        return t;
      }
      case 5: {
        const n = argument(info), m = new Map();
        for (let i = 0; i < n; i++) {
          const k = lire(profondeur + 1);
          if (typeof k !== 'string' && typeof k !== 'number') throw new Error('CBOR : clé de table invalide');
          if (m.has(k)) throw new Error('CBOR : clé dupliquée');
          m.set(k, lire(profondeur + 1));
        }
        return m;
      }
      case 7:
        if (info === 20) return false;
        if (info === 21) return true;
        if (info === 22) return null;
        throw new Error('CBOR : valeur simple non prise en charge');
      default: throw new Error('CBOR : type non pris en charge');
    }
  }
  const valeur = lire(0);
  if (partiel) return { valeur, fin: pos };
  if (pos !== b.length) throw new Error('CBOR : octets en trop');
  return valeur;
}

// Encodeur minimal, pour les tests et les données fabriquées côté serveur.
export function encodeCbor(v) {
  const tete = (type, n) => {
    if (n < 24) return Buffer.from([(type << 5) | n]);
    if (n < 256) return Buffer.from([(type << 5) | 24, n]);
    if (n < 65536) { const x = Buffer.alloc(3); x[0] = (type << 5) | 25; x.writeUInt16BE(n, 1); return x; }
    const x = Buffer.alloc(5); x[0] = (type << 5) | 26; x.writeUInt32BE(n, 1); return x;
  };
  if (v === false) return Buffer.from([0xf4]);
  if (v === true) return Buffer.from([0xf5]);
  if (v === null) return Buffer.from([0xf6]);
  if (typeof v === 'number') return v >= 0 ? tete(0, v) : tete(1, -1 - v);
  if (typeof v === 'string') { const s = Buffer.from(v, 'utf8'); return Buffer.concat([tete(3, s.length), s]); }
  if (Buffer.isBuffer(v) || v instanceof Uint8Array) return Buffer.concat([tete(2, v.length), Buffer.from(v)]);
  if (Array.isArray(v)) return Buffer.concat([tete(4, v.length), ...v.map(encodeCbor)]);
  if (v instanceof Map) return Buffer.concat([tete(5, v.size), ...[...v].flatMap(([k, x]) => [encodeCbor(k), encodeCbor(x)])]);
  throw new Error('encodeCbor : type non pris en charge');
}
