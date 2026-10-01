// Sauvegarde chiffrée : relue seulement avec la clé privée, jamais altérée sans que ça se voie.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { sauvegarder, dechiffrer } from '../src/sauvegarde.js';

const paire = bits => crypto.generateKeyPairSync('rsa', { modulusLength: bits, publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });

test('sauvegarde : chiffrée pour une clé publique, relue avec la clé privée seule, intègre', async () => {
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'socle-sauv-'));
  const db = new DatabaseSync(path.join(dossier, 'base.db'));
  db.exec("CREATE TABLE t (v TEXT); INSERT INTO t VALUES ('ligne gardée')");
  const { publicKey, privateKey } = paire(3072);
  const sauv = await sauvegarder(db, publicKey, { service: 'essai', version: '1.2.3' });
  assert.ok(!sauv.includes(Buffer.from('ligne gardée')), 'rien en clair');
  const { entete, base } = dechiffrer(sauv, privateKey);
  assert.deepEqual([entete.service, entete.version], ['essai', '1.2.3']);
  const restauree = path.join(dossier, 'restauree.db');
  fs.writeFileSync(restauree, base);
  assert.equal(new DatabaseSync(restauree).prepare('SELECT v FROM t').get().v, 'ligne gardée');
  const alteree = Buffer.from(sauv); alteree[alteree.length - 40] ^= 1;
  assert.throws(() => dechiffrer(alteree, privateKey));
  const entete2 = Buffer.from(sauv.toString('latin1').replace('"essai"', '"autre"'), 'latin1');
  assert.throws(() => dechiffrer(entete2, privateKey), 'en-tête authentifié');
  assert.throws(() => dechiffrer(sauv, paire(3072).privateKey), 'autre clé privée');
  await assert.rejects(sauvegarder(db, paire(2048).publicKey, { service: 'essai' }), /3072 bits/);
  db.close();
});
