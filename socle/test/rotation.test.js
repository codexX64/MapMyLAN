// Rotation de la clé maîtresse : la base écrite sous l'ancienne clé passe sous
// la neuve au démarrage, sans réinscrire personne.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { monterBanc } from './banc.js';
import { Authentificateur } from '../essai/authentificateur.js';
import { connexion } from '../essai/client.js';
import * as totp from '../src/totp.js';

const MDP = 'une longue phrase de passe pour la rotation';
const cle = () => crypto.randomBytes(32).toString('base64');

test('rotation de SOCLE_CLE : TOTP rescellé, codes de secours toujours valables, clé inconnue refusée', async () => {
  const K1 = cle(), K2 = cle();
  let s = await monterBanc({ env: { SOCLE_CLE: K1 } });
  const dossier = s.dossier;
  const a = s.client();
  assert.equal((await a.post('/api/compte/installation', { jeton: s.jeton, identifiant: 'ana', motDePasse: MDP })).status, 200);
  const secret = (await a.post('/api/compte/totp')).json.secret;
  assert.equal((await a.post('/api/compte/totp/confirmer', { code: totp.code(secret, totp.pasCourant(s.horloge.t)) })).status, 200);
  const auth = new Authentificateur();
  const o = await a.post('/api/compte/cles/options');
  assert.equal((await a.post('/api/compte/cles', { reponse: auth.creer(o.json, a.origine), nom: 'Portable' })).json.niveau, 'complet');
  const codes = (await a.post('/api/compte/secours')).json.codes;
  const scelleAvant = s.db.prepare('SELECT totp FROM socle_comptes').get().totp;
  await s.fermer();

  // Une clé que la base ne connaît pas arrête le démarrage.
  await assert.rejects(monterBanc({ dossier, env: { SOCLE_CLE: K2 } }), /n’est pas la clé qui a écrit cette base/);

  const traces = [];
  s = await monterBanc({ dossier, env: { SOCLE_CLE: K2, SOCLE_CLE_ANCIENNE: K1 }, log: { info: m => traces.push(m), warn() {}, error() {} } });
  assert.ok(traces.some(m => /Clé tournée : 1 secret\(s\) TOTP rescellé\(s\), 10 code\(s\) de secours/.test(m)), traces.join('\n'));
  assert.notEqual(s.db.prepare('SELECT totp FROM socle_comptes').get().totp, scelleAvant);
  assert.equal(s.db.prepare("SELECT count(*) n FROM socle_secours WHERE repere LIKE 'ancienne:%'").get().n, 10);
  const journal = s.db.prepare("SELECT details FROM socle_journal WHERE action = 'coffre.tourne'").get();
  assert.deepEqual(JSON.parse(journal.details), { totp: 1, secours: 10 });
  s.horloge.t += 31_000;
  let c = s.client();
  assert.equal((await connexion(c, 'ana', MDP)).status, 200);
  let r = await c.post('/api/compte/connexion/totp', { code: totp.code(secret, totp.pasCourant(s.horloge.t)) });
  assert.equal(r.status, 200, 'le TOTP inscrit sous l’ancienne clé passe');
  c = s.client();
  await connexion(c, 'ana', MDP);
  assert.equal((await c.post('/api/compte/connexion/secours', { code: codes[3] })).json.restants, 9, 'code de secours d’avant la rotation');
  c = s.client();
  await connexion(c, 'ana', MDP);
  assert.equal((await c.post('/api/compte/connexion/secours', { code: codes[3] })).status, 401, 'et à usage unique');
  await s.fermer();

  // L'ancienne clé encore posée ne retouche rien ; retirée, tout tient.
  const avertis = [];
  s = await monterBanc({ dossier, env: { SOCLE_CLE: K2, SOCLE_CLE_ANCIENNE: K1 }, log: { info() {}, warn: m => avertis.push(m), error() {} } });
  assert.ok(avertis.some(m => /retire SOCLE_CLE_ANCIENNE/.test(m)));
  assert.equal(s.db.prepare("SELECT count(*) n FROM socle_secours WHERE repere LIKE 'ancienne:%'").get().n, 9);
  await s.fermer();
  s = await monterBanc({ dossier, env: { SOCLE_CLE: K2 } });
  s.horloge.t += 62_000;
  c = s.client();
  await connexion(c, 'ana', MDP);
  assert.equal((await c.post('/api/compte/connexion/totp', { code: totp.code(secret, totp.pasCourant(s.horloge.t)) })).status, 200);
  const neufs = (await c.post('/api/compte/secours')).json.codes;
  assert.equal(s.db.prepare("SELECT count(*) n FROM socle_secours WHERE repere LIKE 'ancienne:%'").get().n, 0, 'un nouveau jeu remplace l’ancien');
  const d = s.client();
  await connexion(d, 'ana', MDP);
  assert.equal((await d.post('/api/compte/connexion/secours', { code: neufs[0] })).status, 200);
  await s.fermer();
  // Revenir à l'ancienne clé seule est refusé aussi.
  await assert.rejects(monterBanc({ dossier, env: { SOCLE_CLE: K1 } }), /n’est pas la clé qui a écrit cette base/);
});
