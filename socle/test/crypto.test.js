import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { hacher, verifier, aRehacher, reglerArgon, PLANCHER } from '../src/argon.js';
import * as totp from '../src/totp.js';
import { refus } from '../src/motdepasse.js';
import { Coffre } from '../src/chiffre.js';
import { decodeCbor, encodeCbor } from '../src/cbor.js';
import * as wa from '../src/webauthn.js';
import { aleatoire } from '../src/outils.js';
import { lireConfig } from '../src/config.js';
import { SPEC_SOCLE } from '../src/index.js';
import { Authentificateur } from '../essai/authentificateur.js';

// Paramètres de production (64 Mio, 3 passes, parallélisme 4) : les essais ne
// les abaissent jamais.
reglerArgon();

test('Argon2id : chaîne PHC, vérification, rehachage quand les paramètres montent', async () => {
  const h = await hacher('une phrase de passe correcte');
  assert.match(h, /^\$argon2id\$v=19\$m=65536,t=3,p=4\$[A-Za-z0-9+/]{22}\$[A-Za-z0-9+/]{43}$/);
  assert.deepEqual(await verifier('une phrase de passe correcte', h), { ok: true });
  assert.deepEqual(await verifier('une phrase de passe fausse', h), { ok: false });
  reglerArgon({ t: 4 });
  assert.equal(aRehacher(h), true);
  const r = await verifier('une phrase de passe correcte', h);
  assert.equal(r.ok, true);
  assert.match(r.nouvelle, /m=65536,t=4,p=4/);
  reglerArgon();
});

test('poivre : rotation, chaque mot de passe passe au nouveau à la connexion', async () => {
  const A = crypto.randomBytes(32).toString('base64'), B = crypto.randomBytes(32).toString('base64');
  try {
    reglerArgon({ poivre: A });
    const h = await hacher('phrase poivrée par A');
    reglerArgon({ poivre: B });
    assert.deepEqual(await verifier('phrase poivrée par A', h), { ok: false }, 'sans l’ancien poivre, l’empreinte ne se vérifie plus');
    reglerArgon({ poivre: B, poivreAncien: A });
    const r = await verifier('phrase poivrée par A', h);
    assert.equal(r.ok, true);
    assert.ok(r.nouvelle, 'réécrite sous le nouveau poivre');
    assert.deepEqual(await verifier('mauvaise phrase', h), { ok: false });
    reglerArgon({ poivre: B });
    assert.deepEqual(await verifier('phrase poivrée par A', r.nouvelle), { ok: true });
    // Premier poivre sur des empreintes qui n'en avaient pas.
    reglerArgon();
    const nu = await hacher('phrase sans poivre');
    reglerArgon({ poivre: A, poivreAncien: 'aucun' });
    assert.equal((await verifier('phrase sans poivre', nu)).ok, true);
    assert.throws(() => reglerArgon({ poivre: A, poivreAncien: A }), /poivre actuel/);
  } finally { reglerArgon(); }
});

test('Argon2id : sous le plancher du manuel, refus de démarrer', () => {
  assert.throws(() => reglerArgon({ m: PLANCHER.m - 1 }), /plancher/);
  assert.throws(() => reglerArgon({ m: 65536, t: 1 }), /plancher/);
});

test('Argon2id : une empreinte argon2-cffi (Oracle) se vérifie sans conversion', async (t) => {
  let h;
  try {
    h = execFileSync('python3', ['-c', 'from argon2 import PasswordHasher,Type;print(PasswordHasher(time_cost=3,memory_cost=65536,parallelism=4,hash_len=32,salt_len=16,type=Type.ID).hash("mot de passe oracle 42"))'], { encoding: 'utf8' }).trim();
  } catch { t.skip('argon2-cffi absent'); return; }
  assert.equal((await verifier('mot de passe oracle 42', h)).ok, true);
  assert.equal((await verifier('mot de passe oracle 43', h)).ok, false);
});

test('scrypt hérité (Hub, Sentinel, SYNAPSE) : relu puis remplacé par Argon2id', async () => {
  const sel = crypto.randomBytes(16);
  const hub = `scrypt$32768$${sel.toString('base64')}$${crypto.scryptSync('ancien mot de passe', sel, 32, { N: 32768, r: 8, p: 1, maxmem: 128 << 20 }).toString('base64')}`;
  const sentinel = `scrypt$${sel.toString('hex')}$${crypto.scryptSync('ancien mot de passe', sel, 32, { N: 16384, r: 8, p: 1 }).toString('hex')}`;
  const synapse = `${sel.toString('hex')}:${crypto.scryptSync('ancien mot de passe', sel, 32, { N: 32768, r: 8, p: 1, maxmem: 128 << 20 }).toString('hex')}`;
  for (const h of [hub, sentinel, synapse]) {
    const r = await verifier('ancien mot de passe', h);
    assert.equal(r.ok, true, h.slice(0, 12));
    assert.match(r.nouvelle, /^\$argon2id\$/);
    assert.equal((await verifier('autre chose', h)).ok, false);
  }
});

test('Compte inconnu ou empreinte illisible : refus, sans exception', async () => {
  assert.deepEqual(await verifier('x', null), { ok: false });
  assert.deepEqual(await verifier('x', '$2b$12$abcdefghijklmnopqrstuv'), { ok: false });
  assert.deepEqual(await verifier('x', '$argon2id$v=19$m=19456,t=2,p=1$AAAA$BBBB'), { ok: false });
});

test('Politique de mot de passe : longueur, fuites, variantes paresseuses', () => {
  assert.match(refus('court'), /12/);
  assert.match(refus('Password123!'), /fuites/);
  assert.match(refus('P@ssw0rd2024!!'), /fuites/);
  assert.match(refus('azertyuiopqsd'), /prévisible|fuites/);
  assert.match(refus('aaaaaaaaaaaaaaaa'), /prévisible/);
  assert.match(refus('123456789012'), /prévisible/);
  assert.match(refus('oracleoracle1', { service: 'oracleoracle' }), /identifiant|service|fuites/);
  assert.equal(refus('cheval correct agrafe batterie'), null);
  assert.equal(refus('🦊 renard de feu 🔥 nuit'), null);
  assert.match(refus('x'.repeat(1025)), /1024|prévisible/);
});

test('TOTP : vecteurs RFC 6238, dérive d’un pas, rejeu refusé', () => {
  const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'; // vecteur publié de la RFC 6238, « 12345678901234567890 » en base32 — gitleaks:allow
  assert.equal(totp.code(secret, Math.floor(59 / 30)), '287082');
  assert.equal(totp.code(secret, Math.floor(1111111109 / 30)), '081804');
  assert.equal(totp.code(secret, Math.floor(1234567890 / 30)), '005924');
  const t = 1_700_000_000_000;
  const pas = totp.pasCourant(t);
  const c = totp.code(secret, pas);
  assert.equal(totp.verifier(secret, c, { t }), pas);
  assert.equal(totp.verifier(secret, c, { t, dernierPas: pas }), null, 'rejeu');
  assert.equal(totp.verifier(secret, totp.code(secret, pas - 1), { t }), pas - 1);
  assert.equal(totp.verifier(secret, totp.code(secret, pas - 3), { t }), null, 'trois pas en arrière');
  assert.equal(totp.verifier(secret, totp.code(secret, pas + 2), { t }), null);
  assert.equal(totp.verifier(secret, '12345', { t }), null);
  assert.match(totp.uriOtpauth({ emetteur: 'Oracle', compte: 'ana', secret }), /^otpauth:\/\/totp\/Oracle:ana\?secret=/);
});

test('Coffre : scellé lié à son propriétaire, altération détectée', () => {
  const coffre = new Coffre({ cle: crypto.randomBytes(32).toString('base64') });
  const s = coffre.scelle('totp', 'SECRET', 'u1');
  assert.equal(coffre.ouvre('totp', s, 'u1'), 'SECRET');
  assert.throws(() => coffre.ouvre('totp', s, 'u2'));
  const [v, iv, c] = s.split('.');
  const abime = Buffer.from(c, 'base64url'); abime[0] ^= 1;
  assert.throws(() => coffre.ouvre('totp', `${v}.${iv}.${abime.toString('base64url')}`, 'u1'));
  assert.throws(() => new Coffre({ cle: 'trop-court' }));
});

test('Coffre : la clé posée hors du volume retire la copie du volume, une clé différente arrête tout', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coffre-'));
  const fichier = path.join(dir, 'cles', 'socle.key');
  const premier = new Coffre({ fichier });
  const s = premier.scelle('totp', 'SECRET', 'u1');
  const cle = fs.readFileSync(fichier, 'utf8').trim();
  assert.throws(() => new Coffre({ cle: crypto.randomBytes(32).toString('base64'), fichier }), /diffère de la clé du volume/);
  assert.ok(fs.existsSync(fichier), 'rien n’est retiré sur une clé différente');
  const second = new Coffre({ cle, fichier });
  assert.equal(second.ouvre('totp', s, 'u1'), 'SECRET');
  assert.ok(!fs.existsSync(fichier), 'la copie du volume est retirée');
  assert.equal(new Coffre({ cle, fichier }).ouvre('totp', s, 'u1'), 'SECRET');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('Coffre : clé précédente pour une rotation, depuis la clé du volume comme depuis SOCLE_CLE', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coffre-'));
  const fichier = path.join(dir, 'cles', 'socle.key');
  const s = new Coffre({ fichier }).scelle('totp', 'SECRET', 'u1');
  const duVolume = fs.readFileSync(fichier, 'utf8').trim(), neuve = crypto.randomBytes(32).toString('base64');
  const c = new Coffre({ cle: neuve, fichier, ancienne: duVolume });
  assert.ok(!fs.existsSync(fichier), 'la copie du volume est retirée');
  assert.throws(() => c.ouvre('totp', s, 'u1'), 'la clé neuve ne lit pas l’ancien scellé');
  assert.equal(c.precedente.ouvre('totp', s, 'u1'), 'SECRET');
  assert.notEqual(c.controle(), c.precedente.controle());
  assert.equal(c.controle(), new Coffre({ cle: neuve }).controle());
  assert.throws(() => new Coffre({ cle: neuve, ancienne: neuve }), /clé actuelle/);
  assert.throws(() => new Coffre({ fichier, ancienne: neuve }), /sans SOCLE_CLE/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('CBOR : aller-retour, et refus des formes hostiles', () => {
  const m = new Map([['a', 1], [-2, Buffer.from([1, 2])], ['l', [true, null, 'x']]]);
  assert.deepEqual(decodeCbor(encodeCbor(m)), m);
  assert.throws(() => decodeCbor(Buffer.from([0x9f, 0x01, 0xff])), /indéfinie/);
  let profond = Buffer.from([0x01]);
  for (let i = 0; i < 12; i++) profond = Buffer.concat([Buffer.from([0x81]), profond]);
  assert.throws(() => decodeCbor(profond), /profond/);
  assert.throws(() => decodeCbor(Buffer.from([0x5a, 0xff, 0xff, 0xff, 0xff])), /tronqué/);
  assert.throws(() => decodeCbor(Buffer.from([0xa2, 0x01, 0x01, 0x01, 0x02])), /dupliquée/);
  assert.throws(() => decodeCbor(Buffer.from([0x01, 0x02])), /en trop/);
});

const ORIGINE = 'https://oracle.exemple.test', RP = 'oracle.exemple.test';

for (const alg of [-7, -8, -257]) {
  test(`WebAuthn (${alg}) : inscription puis connexion valides`, () => {
    const a = new Authentificateur({ alg });
    const defi = aleatoire();
    const opts = wa.optionsCreation({ rp: { id: RP, nom: 'Oracle' }, utilisateur: { handle: aleatoire(16), nom: 'ana' }, defi });
    assert.equal(opts.authenticatorSelection.userVerification, 'required');
    const cle = wa.verifierCreation({ reponse: a.creer(opts, ORIGINE, { fmt: alg === -7 ? 'packed' : 'none' }), defi, origines: [ORIGINE], rpId: RP });
    assert.equal(cle.alg, alg);
    const d2 = aleatoire();
    const optsA = wa.optionsAuthentification({ rpId: RP, defi: d2 });
    const r = wa.verifierAuthentification({ reponse: a.signer(optsA, ORIGINE), defi: d2, origines: [ORIGINE], rpId: RP, cle: { ...cle, handle: opts.user.id } });
    assert.equal(r.compteur, 1);
  });
}

test('WebAuthn : chaque vérification échoue fermée', () => {
  const a = new Authentificateur();
  const defi = aleatoire();
  const opts = wa.optionsCreation({ rp: { id: RP, nom: 'Oracle' }, utilisateur: { handle: aleatoire(16), nom: 'ana' }, defi });
  const inscrire = (o = {}, d = defi, origines = [ORIGINE]) => wa.verifierCreation({ reponse: a.creer(opts, ORIGINE, o), defi: d, origines, rpId: RP });
  assert.throws(() => inscrire({}, aleatoire()), /défi/);
  assert.throws(() => inscrire({}, defi, ['https://ailleurs.test']), /origine/);
  assert.throws(() => inscrire({ rpId: 'ailleurs.test' }), /rpId/);
  assert.throws(() => inscrire({ uv: false }), /vérification/);
  assert.throws(() => inscrire({ up: false }), /présence/);
  assert.throws(() => inscrire({ type: 'webauthn.get' }), /type/);
  const cle = { ...inscrire(), handle: opts.user.id };

  const d2 = aleatoire();
  const optsA = wa.optionsAuthentification({ rpId: RP, defi: d2 });
  const auth = (rep, d = d2) => wa.verifierAuthentification({ reponse: rep, defi: d, origines: [ORIGINE], rpId: RP, cle });
  const valide = a.signer(optsA, ORIGINE);
  cle.compteur = auth(valide).compteur;
  assert.throws(() => auth(valide), /compteur/, 'rejeu d’une assertion capturée');
  assert.throws(() => auth(a.signer(optsA, ORIGINE), aleatoire()), /défi/);
  assert.throws(() => auth(a.signer(optsA, 'https://hameçon.test')), /origine/);
  assert.throws(() => auth(a.signer(optsA, ORIGINE, { uv: false })), /vérification/);
  assert.throws(() => auth(a.signer(optsA, ORIGINE, { handle: 'autre' })), /autre compte/);
  const falsifiee = a.signer(optsA, ORIGINE);
  const sig = Buffer.from(falsifiee.response.signature, 'base64url'); sig[sig.length - 1] ^= 1;
  falsifiee.response.signature = sig.toString('base64url');
  assert.throws(() => auth(falsifiee), /signature/);
  const autre = new Authentificateur(); autre.handle = cle.handle; autre.compteur = 50;
  const usurpee = autre.signer(optsA, ORIGINE);
  assert.throws(() => auth(usurpee), /signature/, 'une autre clé ne signe pas pour celle-ci');
  a.compteur = 0;
  assert.throws(() => auth(a.signer(optsA, ORIGINE)), /compteur/, 'compteur en recul');
});

test('Clé maîtresse : base64 ou base64url acceptés, tout autre format refusé', () => {
  const brute = crypto.randomBytes(32);
  for (const v of [brute.toString('base64'), brute.toString('base64url')]) {
    const cfg = lireConfig(SPEC_SOCLE, { SOCLE_CLE: v });
    const a = new Coffre({ cle: cfg.cle }), b = new Coffre({ cle: brute.toString('base64') });
    assert.equal(b.ouvre('totp', a.scelle('totp', 'x', 'u1'), 'u1'), 'x');
  }
  for (const v of ['trop-court', brute.toString('hex'), brute.toString('base64url') + '!']) assert.throws(() => lireConfig(SPEC_SOCLE, { SOCLE_CLE: v }), /SOCLE_CLE/);
});

test('schéma : champs inconnus refusés, nombres et JSON bornés, clés de prototype refusées', async () => {
  const { valider } = await import('../src/schema.js');
  const s = { n: { type: 'nombre', min: 0, max: 10 }, j: { type: 'json', profondeur: 3 }, t: { type: 'chaine', max: 5 } };
  assert.deepEqual(valider({ n: '2.5', j: { a: [1, { b: 2 }] }, t: 'abc' }, s), { n: 2.5, j: { a: [1, { b: 2 }] }, t: 'abc' });
  assert.throws(() => valider({ role: 'admin' }, s), /inattendu/);
  assert.throws(() => valider({ n: 11 }, s), /au plus 10/);
  assert.throws(() => valider({ n: 'NaN' }, s), /nombre attendu/);
  assert.throws(() => valider({ j: { a: { b: { c: { d: 1 } } } } }, s), /trop imbriqué/);
  assert.throws(() => valider({ j: JSON.parse('{"__proto__":{"x":1}}') }, s), /clé interdite/);
  assert.throws(() => valider({ t: 'abcdef' }, s), /au plus 5/);
});
