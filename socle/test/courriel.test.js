// Le canal des alertes : chiffré ou rien, adresse vérifiée ou rien, et le lien
// « ce n'était pas moi » qui ferme toutes les sessions, une seule fois.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Postier, adresseValide, composer } from '../src/courriel.js';
import { certificatEssai, relaisEssai } from '../essai/smtp.js';
import { monterBanc } from './banc.js';
import { adminComplet } from '../essai/inscription.js';

let certificat;
before(() => { certificat = certificatEssai(); });

const postier = (relais, reglages = {}) => new Postier({ hote: '127.0.0.1', port: relais.port, securite: 'starttls', utilisateur: 'relais', motDePasse: 'mot-de-passe-du-relais', de: 'alertes@exemple.org', nom: 'Essai', autorite: certificat.cert, ...reglages });

test('SMTP : STARTTLS exigé, certificat vérifié, authentification, message décodable', async () => {
  const relais = await relaisEssai({ certificat });
  try {
    await postier(relais).envoyer({ a: 'ana@exemple.org', sujet: 'Essai : alerte', texte: 'Première ligne\n.point en tête\nfin' });
    const [m] = await relais.attendre(1);
    assert.equal(m.de, 'alertes@exemple.org');
    assert.equal(m.a, 'ana@exemple.org');
    assert.equal(m.sujet, 'Essai : alerte');
    assert.equal(m.texte, 'Première ligne\r\n.point en tête\r\nfin');
    assert.deepEqual(relais.auths.at(-1), ['relais', 'mot-de-passe-du-relais']);
    await assert.rejects(postier(relais, { autorite: null }).envoyer({ a: 'ana@exemple.org', sujet: 's', texte: 't' }), /certificate|self.signed/i, 'certificat inconnu refusé');
    await assert.rejects(postier(relais, { motDePasse: 'faux-mot-de-passe' }).envoyer({ a: 'ana@exemple.org', sujet: 's', texte: 't' }), /authentification refusé/);
  } finally { await relais.fermer(); }
  const enClair = await relaisEssai({ certificat, sansStarttls: true });
  try {
    await assert.rejects(postier(enClair).envoyer({ a: 'ana@exemple.org', sujet: 's', texte: 't' }), /STARTTLS/);
    assert.equal(enClair.boite.length, 0);
    assert.equal(enClair.auths.length, 0, 'aucun secret envoyé en clair');
  } finally { await enClair.fermer(); }
  const implicite = await relaisEssai({ certificat, mode: 'tls' });
  try {
    await postier(implicite, { securite: 'tls' }).envoyer({ a: 'ana@exemple.org', sujet: 's', texte: 't' });
    assert.equal((await implicite.attendre(1)).length, 1);
  } finally { await implicite.fermer(); }
});

test('SMTP : aucune injection d’en-tête par l’adresse', () => {
  for (const a of ['ana@exemple.org\r\nBcc: x@y.z', 'ana@exemple.org>', '<ana@exemple.org', 'ana', 'a b@exemple.org', 'x'.repeat(65) + '@exemple.org']) assert.equal(adresseValide(a), false, a);
  assert.throws(() => composer({ de: 'alertes@exemple.org', nom: 'Essai', a: 'ana@exemple.org\nBcc: x@y.z', sujet: 's', texte: 't' }));
  const m = composer({ de: 'alertes@exemple.org', nom: 'Essai', a: 'ana@exemple.org', sujet: 'Sujet\r\nBcc: x@y.z', texte: 't' });
  assert.ok(!/^Bcc:/m.test(m), 'le sujet est encodé, jamais recopié tel quel');
});

test('configuration : relais sans adresse publique ni expéditeur, refusé au démarrage', async () => {
  await assert.rejects(monterBanc({ env: { SOCLE_SMTP_HOTE: '127.0.0.1' } }), /SOCLE_SMTP_DE[\s\S]*SOCLE_URL_PUBLIQUE/);
  await assert.rejects(monterBanc({ env: { SOCLE_SMTP_HOTE: '127.0.0.1', SOCLE_SMTP_DE: 'a@exemple.org', SOCLE_URL_PUBLIQUE: 'http://essai.exemple.org' } }), /https/);
});

let s, relais;
before(async () => {
  relais = await relaisEssai({ certificat });
  s = await monterBanc({ env: {
    SOCLE_SMTP_HOTE: '127.0.0.1', SOCLE_SMTP_PORT: String(relais.port), SOCLE_SMTP_SECURITE: 'starttls', SOCLE_SMTP_AUTORITE: certificat.cert,
    SOCLE_SMTP_UTILISATEUR: 'relais', SOCLE_SMTP_MOTDEPASSE: 'mot-de-passe-du-relais', SOCLE_SMTP_DE: 'alertes@exemple.org', SOCLE_URL_PUBLIQUE: 'https://essai.exemple.org',
  } });
});
after(async () => { await s?.fermer(); await relais?.fermer(); });

test('adresse d’alerte : vérifiée avant de recevoir, lien unique, puis « ce n’était pas moi » par courriel', async () => {
  const admin = s.client();
  const { auth } = await adminComplet(admin, { jeton: s.jeton, maintenant: () => s.horloge.t });
  s.horloge.t += 6 * 60e3;
  let r = await admin.post('/api/compte/courriel', { adresse: 'ana@exemple.org' });
  assert.equal(r.status, 403, 'renfort exigé');
  const o0 = await admin.post('/api/compte/renfort/options');
  assert.equal((await admin.post('/api/compte/renfort', { methode: 'cle', reponse: auth.signer(o0.json, admin.origine) })).status, 200);
  r = await admin.post('/api/compte/courriel', { adresse: 'ana@exemple.org' });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const [verif] = await relais.attendre(1);
  assert.equal(verif.a, 'ana@exemple.org');
  const jeton = /https:\/\/essai\.exemple\.org\/#courriel=([\w-]+)/.exec(verif.texte)[1];
  assert.equal((await admin.get('/api/compte/securite')).json.compte.courriel, null, 'pas encore vérifiée');

  const ailleurs = s.client();
  const firefox = { entetes: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Firefox/131.0' } };
  const o = await ailleurs.post('/api/compte/connexion/cle/options', {}, firefox);
  assert.equal((await ailleurs.post('/api/compte/connexion/cle', { reponse: auth.signer(o.json, ailleurs.origine) }, firefox)).status, 200);
  assert.ok((await admin.get('/api/compte/securite')).json.alertes.some(a => a.type === 'connexion.appareil'), 'alerte gardée dans le compte');
  await new Promise(f => setTimeout(f, 150));
  assert.equal(relais.boite.length, 1, 'une adresse non vérifiée ne reçoit rien');

  assert.equal((await s.client().post('/api/compte/courriel/verifier', { jeton })).status, 200);
  assert.equal((await s.client().post('/api/compte/courriel/verifier', { jeton })).status, 400, 'lien à usage unique');
  assert.equal((await admin.get('/api/compte/securite')).json.compte.courriel, 'ana@exemple.org');
  await relais.attendre(2);

  const tiers = s.client();
  const iphone = { entetes: { 'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari/604.1' } };
  const o2 = await tiers.post('/api/compte/connexion/cle/options', {}, iphone);
  assert.equal((await tiers.post('/api/compte/connexion/cle', { reponse: auth.signer(o2.json, tiers.origine) }, iphone)).status, 200);
  const boite = await relais.attendre(3);
  const alerte = boite.find(m => /nouvel appareil/.test(m.sujet));
  assert.ok(alerte, boite.map(m => m.sujet).join(' | '));
  assert.match(alerte.texte, /Appareil : Safari · iOS/);
  assert.match(alerte.texte, /Depuis : 127\.0\.0\.1/);
  const pasMoi = /https:\/\/essai\.exemple\.org\/#pas-moi=([\w-]+)/.exec(alerte.texte)[1];

  assert.equal((await tiers.get('/api/lecture')).status, 200);
  assert.equal((await s.client().post('/api/compte/pas-moi/lien', { jeton: pasMoi })).status, 200);
  for (const c of [admin, ailleurs, tiers]) assert.equal((await c.get('/api/lecture')).status, 401, 'toutes les sessions sont fermées');
  assert.equal((await s.client().post('/api/compte/pas-moi/lien', { jeton: pasMoi })).status, 400, 'lien à usage unique');
  assert.ok(s.db.prepare("SELECT COUNT(*) n FROM socle_jetons WHERE usage = 'pasmoi'").get().n >= 1, 'les autres liens restent valables');
  const lignes = JSON.stringify(s.db.prepare('SELECT * FROM socle_jetons').all());
  assert.ok(!lignes.includes(pasMoi) && !lignes.includes(jeton), 'jetons stockés hachés');

  const retour = s.client();
  const n0 = relais.boite.length;
  const o3 = await retour.post('/api/compte/connexion/cle/options');
  assert.equal((await retour.post('/api/compte/connexion/cle', { reponse: auth.signer(o3.json, retour.origine) })).status, 200);
  await relais.attendre(n0 + 1);
  const o4 = await retour.post('/api/compte/renfort/options');
  assert.equal((await retour.post('/api/compte/renfort', { methode: 'cle', reponse: auth.signer(o4.json, retour.origine) })).status, 200);
  const avant = relais.boite.length;
  assert.equal((await retour.post('/api/compte/courriel', { adresse: 'ana.bis@exemple.org' })).status, 200);
  const lien = /#courriel=([\w-]+)/.exec((await relais.attendre(avant + 1)).at(-1).texte)[1];
  assert.equal((await s.client().post('/api/compte/courriel/verifier', { jeton: lien })).status, 200);
  const changes = (await relais.attendre(avant + 3)).slice(avant + 1);
  assert.deepEqual(changes.map(m => m.a).sort(), ['ana.bis@exemple.org', 'ana@exemple.org'], 'l’ancienne adresse est prévenue du changement');
  assert.equal((await retour.del('/api/compte/courriel')).status, 200);
  const retrait = (await relais.attendre(avant + 4)).at(-1);
  assert.equal(retrait.a, 'ana.bis@exemple.org');
  assert.match(retrait.sujet, /adresse d’alerte retirée/);
  assert.equal((await retour.get('/api/compte/securite')).json.compte.courriel, null);
});

test('sans relais : l’adresse d’alerte est refusée, les alertes restent dans le compte', async () => {
  const sans = await monterBanc();
  try {
    const admin = sans.client();
    await adminComplet(admin, { jeton: sans.jeton, maintenant: () => sans.horloge.t });
    const r = await admin.post('/api/compte/courriel', { adresse: 'ana@exemple.org' });
    assert.equal(r.status, 409);
    assert.equal((await admin.get('/api/compte/securite')).json.envoiCourriel, false);
  } finally { await sans.fermer(); }
});
