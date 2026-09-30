/* QR code, généré dans le navigateur. Aucune dépendance, aucun appel réseau.

   Pourquoi pas un service en ligne : l'URL otpauth:// contient le secret
   du second facteur en clair. L'envoyer à un générateur d'images tiers,
   c'est lui confier la moitié de chaque compte créé.

   Mode octets, correction M, versions 1 à 40. L'algorithme suit la norme
   ISO/IEC 18004 : segment, blocs Reed-Solomon entrelacés, motifs fixes,
   placement en zigzag, masque au moindre coût.

   Fichier autonome, utilisable tel quel en <script> ou par
   `import './qr.js'` : il pose `globalThis.QR = { matrice, svg }`. */
(function () {
  'use strict';

  // Correction M : codewords de correction par bloc, et nombre de blocs.
  const ECC_PAR_BLOC = [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28];
  const NB_BLOCS = [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49];
  const FORMAT_M = 0;

  const bit = (x, i) => ((x >>> i) & 1) !== 0;

  function modulesBruts(v) {
    let r = (16 * v + 128) * v + 64;
    if (v >= 2) {
      const n = Math.floor(v / 7) + 2;
      r -= (25 * n - 10) * n - 55;
      if (v >= 7) r -= 36;
    }
    return r;
  }
  const codewordsDonnees = v => Math.floor(modulesBruts(v) / 8) - ECC_PAR_BLOC[v] * NB_BLOCS[v];

  function positionsAlignement(v) {
    if (v === 1) return [];
    const n = Math.floor(v / 7) + 2;
    const taille = v * 4 + 17;
    const pas = v === 32 ? 26 : Math.ceil((v * 4 + 4) / (n * 2 - 2)) * 2;
    const out = [6];
    for (let p = taille - 7; out.length < n; p -= pas) out.splice(1, 0, p);
    return out;
  }

  /* Reed-Solomon sur GF(2^8), polynôme 0x11D. */
  function mul(x, y) {
    let z = 0;
    for (let i = 7; i >= 0; i--) {
      z = (z << 1) ^ ((z >>> 7) * 0x11D);
      z ^= ((y >>> i) & 1) * x;
    }
    return z;
  }
  function diviseur(degre) {
    const r = new Array(degre).fill(0);
    r[degre - 1] = 1;
    let racine = 1;
    for (let i = 0; i < degre; i++) {
      for (let j = 0; j < r.length; j++) {
        r[j] = mul(r[j], racine);
        if (j + 1 < r.length) r[j] ^= r[j + 1];
      }
      racine = mul(racine, 0x02);
    }
    return r;
  }
  function reste(donnees, div) {
    const r = div.map(() => 0);
    for (const b of donnees) {
      const f = b ^ r.shift();
      r.push(0);
      div.forEach((c, i) => { r[i] ^= mul(c, f); });
    }
    return r;
  }

  function codewords(octets) {
    let v = 1;
    for (; v <= 40; v++) {
      const bitsCompte = v <= 9 ? 8 : 16;
      if (4 + bitsCompte + octets.length * 8 <= codewordsDonnees(v) * 8) break;
    }
    if (v > 40) throw new Error('QR : texte trop long');

    const bits = [];
    const pousse = (val, n) => { for (let i = n - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
    pousse(0b0100, 4);
    pousse(octets.length, v <= 9 ? 8 : 16);
    for (const o of octets) pousse(o, 8);
    const capacite = codewordsDonnees(v) * 8;
    pousse(0, Math.min(4, capacite - bits.length));
    pousse(0, (8 - bits.length % 8) % 8);
    for (let pad = 0xEC; bits.length < capacite; pad ^= 0xEC ^ 0x11) pousse(pad, 8);

    const donnees = [];
    for (let i = 0; i < bits.length; i += 8) {
      let o = 0;
      for (let j = 0; j < 8; j++) o = (o << 1) | bits[i + j];
      donnees.push(o);
    }

    // Blocs, correction, entrelacement.
    const nb = NB_BLOCS[v], lEcc = ECC_PAR_BLOC[v];
    const brut = Math.floor(modulesBruts(v) / 8);
    const courts = nb - brut % nb;
    const lCourt = Math.floor(brut / nb);
    const div = diviseur(lEcc);
    const blocs = [];
    for (let i = 0, k = 0; i < nb; i++) {
      const d = donnees.slice(k, k + lCourt - lEcc + (i < courts ? 0 : 1));
      k += d.length;
      const e = reste(d, div);
      if (i < courts) d.push(0);
      blocs.push(d.concat(e));
    }
    const out = [];
    for (let i = 0; i < blocs[0].length; i++) {
      blocs.forEach((b, j) => { if (i !== lCourt - lEcc || j >= courts) out.push(b[i]); });
    }
    return { v, out };
  }

  function construit(v, data, masque) {
    const n = v * 4 + 17;
    const m = Array.from({ length: n }, () => new Array(n).fill(false));
    const fixe = Array.from({ length: n }, () => new Array(n).fill(false));
    const pose = (x, y, noir) => { m[y][x] = noir; fixe[y][x] = true; };

    for (let i = 0; i < n; i++) { pose(6, i, i % 2 === 0); pose(i, 6, i % 2 === 0); }
    for (const [cx, cy] of [[3, 3], [n - 4, 3], [3, n - 4]]) {
      for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
        const d = Math.max(Math.abs(dx), Math.abs(dy)), x = cx + dx, y = cy + dy;
        if (x >= 0 && x < n && y >= 0 && y < n) pose(x, y, d !== 2 && d !== 4);
      }
    }
    const al = positionsAlignement(v), der = al.length - 1;
    al.forEach((ax, i) => al.forEach((ay, j) => {
      if ((i === 0 && j === 0) || (i === 0 && j === der) || (i === der && j === 0)) return;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++)
        pose(ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }));

    const format = () => {
      const d = FORMAT_M << 3 | masque;
      let r = d;
      for (let i = 0; i < 10; i++) r = (r << 1) ^ ((r >>> 9) * 0x537);
      const b = (d << 10 | r) ^ 0x5412;
      for (let i = 0; i <= 5; i++) pose(8, i, bit(b, i));
      pose(8, 7, bit(b, 6)); pose(8, 8, bit(b, 7)); pose(7, 8, bit(b, 8));
      for (let i = 9; i < 15; i++) pose(14 - i, 8, bit(b, i));
      for (let i = 0; i < 8; i++) pose(n - 1 - i, 8, bit(b, i));
      for (let i = 8; i < 15; i++) pose(8, n - 15 + i, bit(b, i));
      pose(8, n - 8, true);
    };
    format();
    if (v >= 7) {
      let r = v;
      for (let i = 0; i < 12; i++) r = (r << 1) ^ ((r >>> 11) * 0x1F25);
      const b = v << 12 | r;
      for (let i = 0; i < 18; i++) {
        const a = n - 11 + i % 3, c = Math.floor(i / 3);
        pose(a, c, bit(b, i)); pose(c, a, bit(b, i));
      }
    }

    let i = 0;
    for (let droite = n - 1; droite >= 1; droite -= 2) {
      if (droite === 6) droite = 5;
      for (let vert = 0; vert < n; vert++) for (let j = 0; j < 2; j++) {
        const x = droite - j, montee = ((droite + 1) & 2) === 0;
        const y = montee ? n - 1 - vert : vert;
        if (!fixe[y][x] && i < data.length * 8) { m[y][x] = bit(data[i >>> 3], 7 - (i & 7)); i++; }
      }
    }

    const inverse = [
      (x, y) => (x + y) % 2 === 0, (x, y) => y % 2 === 0, (x) => x % 3 === 0,
      (x, y) => (x + y) % 3 === 0, (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
      (x, y) => x * y % 2 + x * y % 3 === 0, (x, y) => (x * y % 2 + x * y % 3) % 2 === 0,
      (x, y) => ((x + y) % 2 + x * y % 3) % 2 === 0,
    ][masque];
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++)
      if (!fixe[y][x] && inverse(x, y)) m[y][x] = !m[y][x];
    return m;
  }

  /* Coût d'un masque : suites de même couleur, carrés 2×2, motifs qui
     imitent un repère, déséquilibre noir/blanc. Le plus bas se lit le
     mieux ; tous sont valides. */
  function cout(m) {
    const n = m.length;
    let p = 0, noirs = 0;
    const ligne = get => {
      let c = 0, prec = null, s = '';
      for (let i = 0; i < n; i++) {
        const b = get(i);
        s += b ? '1' : '0';
        if (b === prec) { c++; if (c === 5) p += 3; else if (c > 5) p++; }
        else { prec = b; c = 1; }
      }
      const re = /(?=(10111010000|00001011101))/g;
      while (re.exec(s)) { p += 40; re.lastIndex++; }
    };
    for (let y = 0; y < n; y++) ligne(x => m[y][x]);
    for (let x = 0; x < n; x++) ligne(y => m[y][x]);
    for (let y = 0; y < n - 1; y++) for (let x = 0; x < n - 1; x++) {
      const c = m[y][x];
      if (c === m[y][x + 1] && c === m[y + 1][x] && c === m[y + 1][x + 1]) p += 3;
    }
    for (const r of m) for (const b of r) if (b) noirs++;
    const k = Math.ceil(Math.abs(noirs * 20 - n * n * 10) / (n * n)) - 1;
    return p + Math.max(0, k) * 10;
  }

  function matrice(texte, { masque } = {}) {
    const octets = Array.from(new TextEncoder().encode(String(texte)));
    const { v, out } = codewords(octets);
    if (masque !== undefined) return construit(v, out, masque);
    let meilleure = null, min = Infinity;
    for (let k = 0; k < 8; k++) {
      const mm = construit(v, out, k);
      const c = cout(mm);
      if (c < min) { min = c; meilleure = mm; }
    }
    return meilleure;
  }

  /* SVG en une seule forme, avec la marge blanche de quatre modules que
     la norme exige : sans elle, un lecteur rate le repère sur fond sombre. */
  function svg(texte, { taille = 200, marge = 4 } = {}) {
    const m = matrice(texte), n = m.length, t = n + marge * 2;
    let d = '';
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++)
      if (m[y][x]) d += `M${x + marge} ${y + marge}h1v1h-1z`;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${t} ${t}" width="${taille}" height="${taille}" shape-rendering="crispEdges" role="img" aria-label="QR code"><rect width="${t}" height="${t}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
  }

  globalThis.QR = { matrice, svg };
})();

export const { matrice, svg } = globalThis.QR;
