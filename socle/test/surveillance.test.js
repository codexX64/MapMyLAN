// Ce qui se passe quand personne ne regarde : journal relié aux requêtes et
// sorti du service, refus notés sans inonder, vigie qui prévient les
// administrateurs, export et suppression des données d'un compte.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { monterBanc } from './banc.js';
import { adminComplet, membreInvite, MDP_ESSAI } from '../essai/inscription.js';
import { connexion } from '../essai/client.js';

let s, admin, auth, membre, sortie;
const supprimes = [];

before(async () => {
  sortie = [];
  s = await monterBanc({ contactSecurite: 'https://exemple.org/securite', log: { info: l => sortie.push(l), warn() {}, error() {} } });
  s.socle.portail.exporteur = async compte => ({ notes: [`note de ${compte}`] });
  s.socle.comptes.apresSuppression.push(id => supprimes.push(id));
  admin = s.client();
  ({ auth } = await adminComplet(admin, { jeton: s.jeton, maintenant: () => s.horloge.t }));
  ({ client: membre } = await membreInvite(admin, () => s.client(), { identifiant: 'bruno', maintenant: () => s.horloge.t }));
});
after(async () => { await s.fermer(); });

test('security.txt : contact et échéance au format RFC 9116', async () => {
  const r = await s.client().get('/.well-known/security.txt');
  assert.equal(r.status, 200);
  assert.match(r.entetes['content-type'], /^text\/plain/);
  assert.match(r.texte, /^Contact: https:\/\/exemple\.org\/securite$/m);
  const expire = new Date(/^Expires: (.+)$/m.exec(r.texte)[1]);
  assert.ok(expire > Date.now() && expire - Date.now() < 366 * 86400e3);
});

test('journal : chaque ligne porte sa requête et part sur la sortie standard', async () => {
  const r = await s.client().post('/api/compte/connexion', { identifiant: 'ana', motDePasse: 'pas le bon mot de passe du tout' });
  assert.equal(r.status, 401);
  const [ligne] = s.socle.journal.lire({ limite: 1 });
  assert.match(ligne.action, /^connexion/);
  assert.match(ligne.requete, /^[0-9a-f]{12}$/);
  assert.ok(sortie.some(l => JSON.parse(l).requete === ligne.requete), 'recopiée sur la sortie standard');
  const panne = await membre.get('/api/panne');
  assert.equal(panne.status, 500);
  assert.match(panne.json.error, /réf\. [0-9a-f]{12}/, 'la référence donnée est celle de la requête');
  assert.ok(!JSON.stringify(sortie).includes(MDP_ESSAI));
});

test('refus : accès interdit et limite notés, une fois par minute', async () => {
  const avant = s.socle.journal.lire({ limite: 500 }).filter(l => l.action === 'acces.refuse').length;
  for (let i = 0; i < 3; i++) assert.equal((await membre.get('/api/admin')).status, 403);
  const refus = s.socle.journal.lire({ limite: 500 }).filter(l => l.action === 'acces.refuse');
  assert.equal(refus.length, avant + 1);
  assert.equal(refus[0].resultat, 'refus');
  const intrus = s.client();
  for (let i = 0; i < 12; i++) await connexion(intrus, 'bruno', `mauvais mot de passe numero ${i}`);
  const actions = s.socle.journal.lire({ limite: 500 }).map(l => l.action);
  assert.ok(actions.includes('limite.verrou'), 'verrouillage noté');
  assert.ok(actions.includes('limite.atteinte'), 'refus pour limite noté');
});

test('vigie : une rafale d’échecs prévient les administrateurs, une seule fois par heure', async () => {
  for (let i = 0; i < 20; i++) s.socle.journal.ecrire({ action: 'connexion.motdepasse', resultat: 'echec', ip: '192.0.2.10' });
  s.socle.vigie.tour();
  s.socle.vigie.tour();
  const alertes = (await admin.get('/api/compte/securite')).json.alertes.filter(a => a.type === 'vigie.connexions');
  assert.equal(alertes.length, 1);
  assert.ok(alertes[0].details.nombre >= 20);
  assert.equal((await membre.get('/api/compte/securite')).json.alertes.filter(a => a.type.startsWith('vigie.')).length, 0, 'réservé aux administrateurs');
});

test('export : sous renfort, sans aucun secret, avec les données du service', async () => {
  s.horloge.t += 6 * 60e3;
  assert.equal((await admin.get('/api/compte/export')).status, 403, 'renfort exigé');
  const o = await admin.post('/api/compte/renfort/options');
  assert.equal((await admin.post('/api/compte/renfort', { methode: 'cle', reponse: auth.signer(o.json, admin.origine) })).status, 200);
  const r = await admin.get('/api/compte/export');
  assert.equal(r.status, 200);
  assert.equal(r.json.compte.identifiant, 'ana');
  assert.equal(r.json.facteurs.cles.length, 1);
  assert.deepEqual(r.json.essai.notes.length, 1);
  const brut = r.texte;
  const ligne = s.db.prepare("SELECT mdp, totp FROM socle_comptes WHERE identifiant = 'ana'").get();
  assert.ok(!brut.includes(ligne.mdp) && !brut.includes(ligne.totp), 'ni empreinte ni secret');
  assert.ok(s.socle.journal.lire({ limite: 5 }).some(l => l.action === 'compte.export'));
});

test('renfort : la session renouvelée n’est pas prise pour un nouvel appareil', async () => {
  const n = (await admin.get('/api/compte/securite')).json.alertes.filter(a => a.type === 'connexion.appareil').length;
  assert.equal(n, 1, 'seule la première connexion est signalée');
});

test('suppression : le service efface ce qu’il garde du compte', async () => {
  const id = (await admin.get('/api/compte/admin/comptes')).json.comptes.find(c => c.identifiant === 'bruno').id;
  assert.equal((await admin.del(`/api/compte/admin/comptes/${id}`)).status, 200);
  assert.deepEqual(supprimes, [id]);
  assert.equal((await membre.get('/api/lecture')).status, 401);
});
