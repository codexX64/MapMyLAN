// QR code local : matrices comparées à une implémentation de référence
// (python-qrcode, mêmes version, correction et masque), puis figées ici.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { matrice, svg } from '../web/qr.js';

const empreinte = m => crypto.createHash('sha256').update(m.map(r => r.map(b => b ? '1' : '0').join('')).join('\n')).digest('hex');
const OTP = 'otpauth://totp/SYNAPSE:alice?secret=JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP&issuer=SYNAPSE';

test('QR : identique à la référence, octet pour octet', () => {
  for (const [texte, version, masque, attendu] of [
    ['hello', 1, 0, '52a7aa67e7296ede539d6be86579c7180e3b6d417445712ae8bd314c1818458a'],
    [OTP, 5, 3, 'd6d8ee7f21eaa4f7e34d7b29da7536498393548b0f73c3aeefc2fe4f33ac451c'],
    ['é'.repeat(120), 11, 6, '4f54f3ffeaf82a702279b6c77d98b9d976d9f3148801e4c298c0d8513df75160'],
  ]) {
    const m = matrice(texte, { masque });
    assert.equal(m.length, version * 4 + 17, `version de « ${texte.slice(0, 12)} »`);
    assert.equal(empreinte(m), attendu, `matrice de « ${texte.slice(0, 12)} »`);
  }
});

test('QR : SVG autonome, marge blanche, aucun appel réseau', () => {
  const s = svg(OTP, { taille: 188 });
  assert.match(s, /^<svg [^>]*viewBox="0 0 45 45"/);
  assert.match(s, /width="188"/);
  assert.ok(!/https?:\/\/(?!www\.w3\.org\/2000\/svg)/.test(s), 'aucune ressource externe');
  assert.throws(() => matrice('x'.repeat(3000)), /trop long/);
});
