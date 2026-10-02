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

  assert.equal((await c.post('/api/compte/hub/comptes', { identifiant: 'roi', role: 'admin' }, hub())).status, 409, 'un administrateur seulement pour un service vide');
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

test('délégation : un service vide reçoit son premier administrateur par lien, sans jeton d’installation', async () => {
  const v = await monterBanc({ env: { SOCLE_JETON_ADMIN_HUB: JETON } });
  try {
    const c = v.client();
    assert.equal((await c.get('/api/compte/etat')).json.parHub, true, 'la porte sait que le Hub crée le compte');
    const r = await c.post('/api/compte/hub/comptes', { identifiant: 'eloise', role: 'admin' }, hub());
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.compte.role, 'admin');
    assert.match(r.json.lien, /^https:\/\/service\.exemple\/#invitation=/);
    const e = (await c.get('/api/compte/etat')).json;
    assert.equal(e.installe, true);
    assert.equal(e.parHub, undefined);
    assert.equal((await c.post('/api/compte/hub/comptes', { identifiant: 'second', role: 'admin' }, hub())).status, 409, 'un seul premier administrateur');
    assert.equal((await c.post('/api/compte/installation', { jeton: v.jeton, identifiant: 'intrus', motDePasse: 'une phrase assez longue' })).status, 409, 'le jeton d’installation ne sert plus');
    assert.ok(v.socle.journal.lire({ limite: 20 }).some(l => l.action === 'compte.premier_admin'));
  } finally { await v.fermer(); }
});

test('délégation : adresse e-mail, clé d’accès exigée, activation ; un administrateur garde sa clé en HTTPS', async () => {
  const c = s.client();
  const inv = await c.post('/api/compte/hub/comptes', { identifiant: 'dora', role: 'membre', courriel: 'dora@exemple.org' }, hub());
  assert.equal(inv.status, 200, JSON.stringify(inv.json));
  const id = inv.json.compte.id;
  const lire = async () => (await c.get('/api/compte/hub/comptes', hub())).json.find(x => x.id === id);
  assert.deepEqual([(await lire()).courriel, (await lire()).cle, (await lire()).actif], ['dora@exemple.org', 'facultative', true]);
  assert.equal((await c.post('/api/compte/hub/comptes', { identifiant: 'eve', courriel: 'pas-une-adresse' }, hub())).status, 400);
  assert.equal((await c.patch(`/api/compte/hub/comptes/${id}`, { courriel: 'dora@autre.org', cleExigee: true }, hub())).status, 200);
  let x = await lire();
  assert.deepEqual([x.courriel, x.cle], ['dora@autre.org', 'exigee']);
  assert.ok(x.manquants.includes('cle'), 'la clé exigée manque tant qu’elle n’est pas inscrite');
  assert.equal((await c.patch(`/api/compte/hub/comptes/${id}`, { cleExigee: false, actif: false }, hub())).status, 200);
  x = await lire();
  assert.deepEqual([x.cle, x.actif, x.manquants.includes('cle')], ['facultative', false, false]);
  assert.equal((await c.patch(`/api/compte/hub/comptes/${id}`, { retirerCourriel: true }, hub())).status, 200);
  assert.equal((await lire()).courriel, null);
  const admin = (await c.get('/api/compte/hub/comptes', hub())).json.find(y => y.role === 'admin');
  assert.equal(admin.cle, 'toujours');
  assert.equal((await c.patch(`/api/compte/hub/comptes/${admin.id}`, { cleExigee: false }, hub())).status, 409, 'REQ-AUTH-013');
  // Sans relais d'envoi : le lien se copie, il ne part pas.
  assert.equal((await c.post(`/api/compte/hub/comptes/${id}/reinit`, { envoyer: true }, hub())).status, 409);
  const journal = s.socle.journal.lire({ limite: 80 });
  assert.ok(journal.some(l => l.action === 'compte.cle_exigee') && journal.some(l => l.action === 'courriel.defini'));
});

test('délégation : invitation et réinitialisation envoyées par e-mail, lien vers l’adresse publique, jamais rendu au Hub', async () => {
  const { certificatEssai, relaisEssai } = await import('../essai/smtp.js');
  const certificat = certificatEssai();
  const relais = await relaisEssai({ certificat });
  const v = await monterBanc({ env: {
    SOCLE_JETON_ADMIN_HUB: JETON, SOCLE_SMTP_HOTE: '127.0.0.1', SOCLE_SMTP_PORT: String(relais.port), SOCLE_SMTP_SECURITE: 'starttls', SOCLE_SMTP_AUTORITE: certificat.cert,
    SOCLE_SMTP_UTILISATEUR: 'relais', SOCLE_SMTP_MOTDEPASSE: 'mot-de-passe-du-relais', SOCLE_SMTP_DE: 'alertes@exemple.org', SOCLE_URL_PUBLIQUE: 'https://essai.exemple.org',
  } });
  try {
    const c = v.client();
    const r = await c.post('/api/compte/hub/comptes', { identifiant: 'fleur', role: 'admin', courriel: 'fleur@exemple.org', envoyer: true }, hub());
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.envoye, true);
    assert.equal(r.json.lien, undefined, 'le lien n’est pas rendu au Hub');
    const [m1] = await relais.attendre(1);
    assert.equal(m1.a, 'fleur@exemple.org');
    assert.match(m1.texte, /https:\/\/essai\.exemple\.org\/#invitation=[\w-]+/);
    const id = r.json.compte.id;
    const re = await c.post(`/api/compte/hub/comptes/${id}/reinit`, { envoyer: true }, hub());
    assert.equal(re.status, 200, JSON.stringify(re.json));
    const recus = await relais.attendre(2);
    assert.match(recus[1].texte, /https:\/\/essai\.exemple\.org\/#reinit=[\w-]+/);
    assert.equal((await c.post('/api/compte/hub/comptes', { identifiant: 'gil', envoyer: true }, hub())).status, 400, 'pas d’envoi sans adresse');
  } finally { await v.fermer(); await relais.fermer(); }
});
