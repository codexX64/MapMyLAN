// Parcours complets par HTTP, calqués sur les vérifications du manuel.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { monterBanc } from './banc.js';
import { Authentificateur } from '../essai/authentificateur.js';
import { connexion, resoudre } from '../essai/client.js';
import * as totp from '../src/totp.js';

let s, admin, cleAdmin, secretAdmin, codesAdmin;
const MDP = 'une longue phrase de passe pour l’essai';

before(async () => { s = await monterBanc(); });
after(async () => { await s.fermer(); });

const codeTotp = (secret, decalage = 0) => totp.code(secret, totp.pasCourant(s.horloge.t) + decalage);
const avance = ms => { s.horloge.t += ms; };

async function inscrireCle(client, auth, nom) {
  const o = await client.post('/api/compte/cles/options');
  assert.equal(o.status, 200, JSON.stringify(o.json));
  const r = await client.post('/api/compte/cles', { reponse: auth.creer(o.json, client.origine), nom });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  return r;
}

async function connexionCle(client, auth) {
  const o = await client.post('/api/compte/connexion/cle/options');
  assert.equal(o.status, 200, JSON.stringify(o.json));
  return client.post('/api/compte/connexion/cle', { reponse: auth.signer(o.json, client.origine) });
}

test('installation : jeton exigé, mot de passe contrôlé, session limitée à l’inscription', async () => {
  admin = s.client();
  assert.equal((await admin.etat()).installe, false);
  let r = await admin.post('/api/compte/installation', { jeton: 'faux'.repeat(8), identifiant: 'ana', motDePasse: MDP });
  assert.equal(r.status, 403);
  r = await admin.post('/api/compte/installation', { jeton: s.jeton, identifiant: 'ana', motDePasse: 'Password123!' });
  assert.equal(r.status, 400);
  assert.match(r.json.error, /fuites/);
  r = await admin.post('/api/compte/installation', { jeton: s.jeton, identifiant: 'ana', motDePasse: MDP, role: 'admin' });
  assert.equal(r.status, 400, 'champ inattendu refusé');
  r = await admin.post('/api/compte/installation', { jeton: s.jeton, identifiant: 'ana', motDePasse: MDP });
  assert.equal(r.status, 200);
  assert.equal(r.json.niveau, 'inscription');
  const e = await admin.etat();
  assert.deepEqual(e.session.compte.manquants, ['cle'], 'la clé couvre à la fois le second facteur et la règle admin');
  r = await admin.get('/api/lecture');
  assert.equal(r.status, 403, 'rien avant la fin de l’inscription');
  assert.ok(r.json.details.inscription.includes('cle'));
  r = await s.client().post('/api/compte/installation', { jeton: s.jeton, identifiant: 'bob', motDePasse: MDP });
  assert.equal(r.status, 409);
});

test('inscription : TOTP puis clé d’accès, sessions renouvelées, accès ouvert', async () => {
  const sidAvant = [...admin.cookies.values()][0];
  let r = await admin.post('/api/compte/totp');
  assert.equal(r.status, 200);
  assert.match(r.json.otpauth, /^otpauth:\/\/totp\/Essai:ana\?/);
  secretAdmin = r.json.secret;
  r = await admin.post('/api/compte/totp/confirmer', { code: '000000' });
  assert.equal(r.status, 400);
  r = await admin.post('/api/compte/totp/confirmer', { code: codeTotp(secretAdmin) });
  assert.equal(r.status, 200);
  assert.notEqual([...admin.cookies.values()][0], sidAvant, 'identifiant de session neuf');
  assert.equal(r.json.niveau, 'inscription', 'la clé manque encore');
  cleAdmin = new Authentificateur();
  r = await inscrireCle(admin, cleAdmin, 'Portable');
  assert.equal(r.json.niveau, 'complet');
  assert.equal((await admin.get('/api/admin')).status, 200);
  r = await admin.post('/api/compte/secours');
  assert.equal(r.json.codes.length, 10);
  assert.match(r.json.codes[0], /^[0-9A-Z]{4}(-[0-9A-Z]{4}){4}$/);
  codesAdmin = r.json.codes;
  const lignes = s.db.prepare('SELECT repere, empreinte FROM socle_secours').all();
  assert.equal(lignes.length, 10);
  assert.ok(lignes.every(l => l.empreinte.startsWith('$argon2id$') && !codesAdmin.some(c => l.repere.includes(c.replace(/-/g, '')))), 'codes illisibles en base');
  const brut = s.db.prepare('SELECT totp FROM socle_comptes').get().totp;
  assert.ok(brut.startsWith('v1.') && !brut.includes(secretAdmin), 'secret TOTP chiffré en base');
});

test('connexion : mot de passe + TOTP, rejeu refusé, énumération impossible', async () => {
  const c = s.client();
  let r = await connexion(c, 'ana', 'mauvais mot de passe');
  const inconnu = await connexion(c, 'personne', 'mauvais mot de passe');
  assert.equal(r.status, 401); assert.equal(inconnu.status, 401);
  assert.equal(r.json.error, inconnu.json.error);
  r = await connexion(c, 'ANA', MDP);
  assert.equal(r.status, 200);
  assert.equal(r.json.etape, 'second');
  assert.deepEqual(r.json.methodes.sort(), ['cle', 'secours', 'totp']);
  assert.equal((await c.get('/api/lecture')).status, 401, 'session partielle : rien');
  avance(31_000);
  const code = codeTotp(secretAdmin);
  r = await c.post('/api/compte/connexion/totp', { code });
  assert.equal(r.status, 200);
  assert.equal(r.json.niveau, 'complet');
  const c2 = s.client();
  await connexion(c2, 'ana', MDP);
  r = await c2.post('/api/compte/connexion/totp', { code });
  assert.equal(r.status, 401, 'même code rejoué');
});

test('connexion par clé seule, puis par code de secours à usage unique', async () => {
  const c = s.client();
  let r = await connexionCle(c, cleAdmin);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.niveau, 'complet');
  assert.equal((await c.get('/api/admin')).status, 200);
  const d = s.client();
  await connexion(d, 'ana', MDP);
  r = await d.post('/api/compte/connexion/secours', { code: codesAdmin[0].toLowerCase() });
  assert.equal(r.status, 200);
  assert.equal(r.json.restants, 9);
  assert.equal((await c.get('/api/lecture')).status, 401, 'les autres sessions tombent');
  const e = s.client();
  await connexion(e, 'ana', MDP);
  r = await e.post('/api/compte/connexion/secours', { code: codesAdmin[0] });
  assert.equal(r.status, 401, 'code déjà consommé');
  admin = d;
});

test('renfort : exigé après cinq minutes, avec le facteur le plus fort', async () => {
  avance(6 * 60e3);
  let r = await admin.get('/api/dangereux');
  assert.equal(r.status, 403);
  assert.deepEqual(r.json.details.methodes, ['cle']);
  r = await admin.post('/api/compte/renfort', { methode: 'totp', code: codeTotp(secretAdmin) });
  assert.equal(r.status, 400, 'le TOTP ne suffit pas quand une clé existe');
  const o = await admin.post('/api/compte/renfort/options');
  r = await admin.post('/api/compte/renfort', { methode: 'cle', reponse: cleAdmin.signer(o.json, admin.origine) });
  assert.equal(r.status, 200);
  assert.equal((await admin.get('/api/dangereux')).status, 200);
});

test('facteurs : jamais sous la politique, retrait sous renfort, deux clés nommées', async () => {
  const listeAvant = (await admin.get('/api/compte/securite')).json.cles;
  let r = await admin.del(`/api/compte/cles/${listeAvant[0].id}`);
  assert.equal(r.status, 409, 'un administrateur garde une clé');
  const seconde = new Authentificateur({ alg: -8 });
  await inscrireCle(admin, seconde, 'Clé USB');
  const liste = (await admin.get('/api/compte/securite')).json.cles;
  assert.deepEqual(liste.map(k => k.nom), ['Portable', 'Clé USB']);
  r = await admin.patch(`/api/compte/cles/${liste[1].id}`, { nom: 'YubiKey bleue' });
  assert.equal(r.status, 200);
  r = await admin.del(`/api/compte/cles/${liste[0].id}`);
  assert.equal(r.status, 200);
  r = await connexionCle(s.client(), seconde);
  assert.equal(r.status, 200, 'la clé restante fonctionne');
  r = await connexionCle(s.client(), cleAdmin);
  assert.equal(r.status, 401, 'la clé retirée ne passe plus');
  cleAdmin = seconde;
  avance(6 * 60e3);
  assert.equal((await admin.del('/api/compte/totp')).status, 403, 'renfort requis');
});

test('limiteur : preuve de travail après trois échecs, 429 bien avant le trentième', async () => {
  const c = s.client();
  const statuts = [];
  let preuve = null;
  for (let i = 0; i < 30; i++) {
    const r = await c.post('/api/compte/connexion', { identifiant: 'cible', motDePasse: 'mauvais essai ' + i, ...(preuve ? { preuve } : {}) });
    statuts.push(r.status);
    preuve = r.status === 428 ? resoudre(r.json.details.preuve) : null;
    if (r.status === 429) break;
  }
  assert.ok(statuts.includes(428), statuts.join(','));
  assert.equal(statuts.at(-1), 429, statuts.join(','));
  assert.ok(statuts.length < 30);
  const r = await s.client().post('/api/compte/connexion', { identifiant: 'cible', motDePasse: 'autre', preuve: { id: 'x', nonce: '1' } });
  assert.equal(r.status, 429, 'le compte reste bloqué depuis une autre adresse');
  const bloque = s.db.prepare("SELECT bloque FROM socle_essais WHERE cle = 'compte:cible'").get().bloque;
  assert.ok(bloque > s.horloge.t, 'verrou persisté en base : un redémarrage ne l’efface pas');
  s.db.exec('DELETE FROM socle_essais');
});

test('CSRF : origine étrangère, origine absente, jeton manquant', async () => {
  let r = await admin.post('/api/compte/alertes/vues', {}, { origine: 'https://evil.example' });
  assert.equal(r.status, 403);
  r = await admin.post('/api/compte/alertes/vues', {}, { origine: null });
  assert.equal(r.status, 403);
  r = await admin.post('/api/compte/alertes/vues', {}, { sansCsrf: true });
  assert.equal(r.status, 403);
  r = await admin.req('POST', '/api/compte/alertes/vues', undefined, { entetes: { 'content-type': 'application/x-www-form-urlencoded' }, brut: 'a=1' });
  assert.equal(r.status, 415, 'corps de formulaire refusé');
  r = await s.client().post('/api/compte/connexion', { identifiant: 'ana', motDePasse: MDP }, { origine: 'https://evil.example' });
  assert.equal(r.status, 403, 'connexion forcée depuis un autre site : ' + JSON.stringify(r.json));
  const refus = s.socle.journal.lire({ limite: 50 }).filter(l => l.action === 'acces.refuse');
  assert.ok(refus.some(l => l.details?.cause === 'origine') && refus.some(l => l.details?.cause === 'csrf'), 'refus journalisés pour la vigie');
});

let membre, secretMembre;
test('invitation : l’invité pose son mot de passe et son facteur, sans droits d’admin', async () => {
  avance(6 * 60e3);
  let r = await admin.post('/api/compte/admin/comptes', { identifiant: 'bruno', role: 'membre' });
  assert.equal(r.status, 403, 'renfort');
  const o = await admin.post('/api/compte/renfort/options');
  await admin.post('/api/compte/renfort', { methode: 'cle', reponse: cleAdmin.signer(o.json, admin.origine) });
  r = await admin.post('/api/compte/admin/comptes', { identifiant: 'bruno', role: 'membre' });
  assert.equal(r.status, 200);
  const jeton = r.json.lien.split('#invitation=')[1];
  membre = s.client();
  assert.deepEqual((await membre.post('/api/compte/jeton/verifier', { usage: 'invitation', jeton })).json, { valide: true, identifiant: 'bruno' });
  r = await membre.post('/api/compte/jeton', { usage: 'invitation', jeton, motDePasse: 'bruno a une phrase à lui' });
  assert.equal(r.status, 200);
  assert.equal(r.json.etape, 'inscription');
  assert.equal((await s.client().post('/api/compte/jeton', { usage: 'invitation', jeton, motDePasse: 'autre phrase assez longue' })).status, 400, 'jeton à usage unique');
  secretMembre = (await membre.post('/api/compte/totp')).json.secret;
  r = await membre.post('/api/compte/totp/confirmer', { code: codeTotp(secretMembre) });
  assert.equal(r.json.niveau, 'complet');
  assert.equal((await membre.get('/api/lecture')).status, 200);
  assert.equal((await membre.get('/api/admin')).status, 403);
  assert.equal((await membre.get('/api/compte/admin/comptes')).status, 403);
  const id = (await admin.get('/api/compte/admin/comptes')).json.comptes.find(x => x.identifiant === 'bruno').id;
  r = await admin.patch(`/api/compte/admin/comptes/${id}`, { role: 'admin' });
  assert.equal(r.status, 409, 'pas d’admin sans clé');
});

test('réinitialisation : le mot de passe seul, le TOTP reste exigé', async () => {
  const id = (await admin.get('/api/compte/admin/comptes')).json.comptes.find(x => x.identifiant === 'bruno').id;
  let r = await admin.post(`/api/compte/admin/comptes/${id}/reinit`);
  assert.equal(r.status, 200);
  const jeton = r.json.lien.split('#reinit=')[1];
  r = await s.client().post('/api/compte/jeton', { usage: 'reinit', jeton, motDePasse: 'nouvelle phrase de bruno' });
  assert.deepEqual(r.json, { etape: 'connexion' });
  assert.equal((await membre.get('/api/lecture')).status, 401, 'sessions fermées par la réinitialisation');
  membre = s.client();
  r = await connexion(membre, 'bruno', 'nouvelle phrase de bruno');
  assert.equal(r.json.etape, 'second');
  avance(31_000);
  r = await membre.post('/api/compte/connexion/totp', { code: codeTotp(secretMembre) });
  assert.equal(r.json.niveau, 'complet');
});

test('politique : TOTP requis pour tous, puis sessions et appareils', async () => {
  let r = await admin.put('/api/compte/admin/politique', { motdepasse: 'facultatif', totp: 'desactive', cle: 'desactive' });
  assert.equal(r.status, 400, 'au moins un second facteur possible');
  r = await admin.put('/api/compte/admin/politique', { motdepasse: 'requis', totp: 'requis', cle: 'requis_admin' });
  assert.equal(r.status, 200);
  const sec = await admin.get('/api/compte/securite');
  assert.ok(sec.json.sessions.length >= 1);
  const autre = s.client();
  await connexionCle(autre, cleAdmin);
  const liste = (await admin.get('/api/compte/securite')).json.sessions;
  const cible = liste.find(x => !x.courante);
  r = await admin.del(`/api/compte/sessions/${cible.id}`);
  assert.equal(r.status, 200);
  assert.equal((await autre.get('/api/lecture')).status, 401, 'révoquée à la requête suivante');
  const alertes = (await admin.get('/api/compte/securite')).json.alertes.map(a => a.type);
  assert.ok(alertes.includes('facteur.ajoute') && alertes.includes('secours.utilise'));
  const j = s.socle.journal.verifier();
  assert.equal(j.ok, true);
  const texte = JSON.stringify(s.db.prepare('SELECT * FROM socle_journal').all());
  assert.ok(!texte.includes(MDP) && !texte.includes(secretAdmin), 'ni mot de passe ni secret au journal');
});

test('flux ouvert : vérifier une session ne la prolonge pas, une révocation la coupe', async () => {
  const autre = s.client();
  await connexionCle(autre, cleAdmin);
  const jeton = [...autre.cookies].find(([k]) => k.endsWith('-sid'))[1];
  assert.equal(s.socle.comptes.sessionVivante(jeton), true);
  assert.equal(s.socle.comptes.sessionVivante('inconnu'), false);
  avance(40 * 60e3);
  assert.equal(s.socle.comptes.sessionVivante(jeton), true);
  avance(25 * 60e3);
  assert.equal(s.socle.comptes.sessionVivante(jeton), false, 'la vérification ne compte pas comme une activité');
  const neuf = s.client();
  await connexionCle(neuf, cleAdmin);
  const j2 = [...neuf.cookies].find(([k]) => k.endsWith('-sid'))[1];
  assert.equal(s.socle.comptes.sessionVivante(j2), true);
  assert.equal((await neuf.post('/api/compte/deconnexion')).status, 200);
  assert.equal(s.socle.comptes.sessionVivante(j2), false);
});

test('effacement : le compte se supprime lui-même, sous renfort, identifiant retapé ; le dernier administrateur reste', async () => {
  // La session de l'administrateur a expiré au parcours précédent : une neuve.
  admin = s.client();
  await connexionCle(admin, cleAdmin);
  const renforcerAdmin = async () => {
    const o = await admin.post('/api/compte/renfort/options');
    await admin.post('/api/compte/renfort', { methode: 'cle', reponse: cleAdmin.signer(o.json, admin.origine) });
  };
  avance(6 * 60e3);
  await renforcerAdmin();
  let r = await admin.post('/api/compte/admin/comptes', { identifiant: 'chloe', role: 'lecture' });
  const chloe = s.client();
  await chloe.post('/api/compte/jeton', { usage: 'invitation', jeton: r.json.lien.split('#invitation=')[1], motDePasse: 'chloe a sa propre phrase' });
  const secret = (await chloe.post('/api/compte/totp')).json.secret;
  assert.equal((await chloe.post('/api/compte/totp/confirmer', { code: codeTotp(secret) })).json.niveau, 'complet');
  avance(6 * 60e3);
  r = await chloe.post('/api/compte/supprimer', { identifiant: 'chloe' });
  assert.equal(r.status, 403);
  assert.ok(r.json.details.renfort, 'renfort exigé');
  avance(31_000);
  assert.equal((await chloe.post('/api/compte/renfort', { methode: 'totp', code: codeTotp(secret) })).status, 200);
  assert.equal((await chloe.post('/api/compte/supprimer', { identifiant: 'bruno' })).status, 400, 'identifiant retapé');
  assert.equal((await chloe.post('/api/compte/supprimer', { identifiant: ' Chloe ' })).status, 200);
  assert.equal((await chloe.get('/api/lecture')).status, 401, 'session partie avec le compte');
  assert.ok(!(await admin.get('/api/compte/admin/comptes')).json.comptes.some(x => x.identifiant === 'chloe'));
  assert.ok(s.socle.journal.lire({ limite: 20 }).some(l => l.action === 'compte.supprime' && l.details?.soi === true));
  await renforcerAdmin();
  r = await admin.post('/api/compte/supprimer', { identifiant: 'ana' });
  assert.equal(r.status, 409, 'dernier administrateur actif');
  assert.equal((await admin.get('/api/lecture')).status, 200);
});
