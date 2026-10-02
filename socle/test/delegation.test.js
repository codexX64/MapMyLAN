// Administration des comptes déléguée au Hub : jeton à lui seul, liens au lieu
// de mots de passe, mêmes garde-fous que pour un administrateur, et rien sans
// SOCLE_JETON_ADMIN_HUB.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { monterBanc } from './banc.js';
import { adminComplet } from '../essai/inscription.js';

const JETON = 'jeton-admin-du-hub-' + 'x'.repeat(30);
let s, sans;
const hub = (jeton = JETON, en = {}) => ({ entetes: { authorization: `Bearer ${jeton}`, 'x-hub-adresse': 'https://service.exemple', 'x-hub-operateur': 'ana', ...en }, sansCsrf: true, origine: null });

before(async () => {
  s = await monterBanc({ env: { SOCLE_JETON_ADMIN_HUB: JETON } });
  await adminComplet(s.client(), { jeton: s.jeton });
  sans = await monterBanc();
});
after(async () => { await s.fermer(); await sans.fermer(); });

test('délégation : sans jeton configuré la route n’existe pas ; mauvais jeton refusé et journalisé', async () => {
  assert.equal((await sans.client().get('/api/compte/hub/comptes', hub())).status, 404);
  const c = s.client();
  assert.equal((await c.get('/api/compte/hub/comptes', hub('jeton-faux-' + 'y'.repeat(30)))).status, 401);
  assert.equal((await c.get('/api/compte/hub/comptes', { sansCsrf: true, origine: null })).status, 401);
  assert.ok(s.socle.journal.lire({ limite: 20 }).some(l => l.action === 'connexion.jeton_hub' && l.resultat === 'refus'));
});

test('délégation : lister, inviter (lien, jamais de mot de passe), réinitialiser, changer le rôle, supprimer', async () => {
  const c = s.client();
  const liste = await c.get('/api/compte/hub/comptes', hub());
  assert.equal(liste.status, 200);
  assert.ok(Array.isArray(liste.json) && liste.json.length === 1);
  assert.equal(liste.json[0].role, 'admin');
  assert.equal(liste.json[0].a2f, true);
  assert.ok(!JSON.stringify(liste.json).match(/empreinte|secret|motdepasse"\s*:\s*"/i), 'un secret sort de la liste');

  assert.equal((await c.post('/api/compte/hub/comptes', { identifiant: 'roi', role: 'admin' }, hub())).status, 400, 'jamais d’invitation administrateur');
  const inv = await c.post('/api/compte/hub/comptes', { identifiant: 'bruno', role: 'membre', motDePasse: 'x' }, hub());
  assert.equal(inv.status, 400, 'le Hub ne pose pas de mot de passe');
  const ok = await c.post('/api/compte/hub/comptes', { identifiant: 'bruno', role: 'membre' }, hub());
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.match(ok.json.lien, /^https:\/\/service\.exemple\/#invitation=/);
  const id = ok.json.compte.id;

  const re = await c.post(`/api/compte/hub/comptes/${id}/reinit`, {}, hub());
  assert.match(re.json.lien, /^https:\/\/service\.exemple\/#reinit=/);
  // Promu administrateur sans facteurs : refusé, comme pour un administrateur.
  assert.equal((await c.patch(`/api/compte/hub/comptes/${id}`, { role: 'admin' }, hub())).status, 409);
  assert.equal((await c.patch(`/api/compte/hub/comptes/${id}`, { role: 'lecture' }, hub())).status, 200);
  // Le dernier administrateur ne se supprime pas, même par le Hub.
  const adminId = liste.json[0].id;
  assert.equal((await c.del(`/api/compte/hub/comptes/${adminId}`, hub())).status, 409);
  assert.equal((await c.del(`/api/compte/hub/comptes/${id}`, hub())).status, 200);
  const journal = s.socle.journal.lire({ limite: 50 });
  assert.ok(journal.some(l => l.action === 'hub.compte_invite' && l.details?.operateur === 'ana'), 'l’opérateur du Hub n’est pas au journal');
});

test('délégation : sans adresse publique ni adresse donnée par le Hub, aucun lien n’est fabriqué', async () => {
  const r = await s.client().post('/api/compte/hub/comptes', { identifiant: 'chloe' }, hub(JETON, { 'x-hub-adresse': 'javascript:alert(1)' }));
  assert.equal(r.status, 409);
  assert.equal((await s.client().get('/api/compte/hub/comptes', hub())).json.some(c => c.identifiant === 'chloe'), false, 'compte créé malgré le refus');
});
