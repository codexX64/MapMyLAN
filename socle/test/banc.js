// Banc d'essai : un service minimal monté sur le socle, et un client HTTP avec
// sa boîte à cookies, pour rejouer les parcours d'un navigateur.
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { Client } from '../essai/client.js';
import { DatabaseSync } from 'node:sqlite';
import { demarrerSocle, envelopper, repondreErreur, repondreJson } from '../src/index.js';

// dossier : celui d'un banc précédent, pour redémarrer sur la même base.
export async function monterBanc({ env = {}, log = { info() {}, warn() {}, error() {} }, contactSecurite = null, dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'socle-')) } = {}) {
  const db = new DatabaseSync(path.join(dossier, 'base.db'));
  db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
  const horloge = { t: Date.now() };
  const jeton = crypto.randomBytes(24).toString('base64url');
  const socle = await demarrerSocle({
    service: { id: 'essai', nom: 'Essai', contactSecurite }, db, dossier,
    env: { SOCLE_JETON_INSTALLATION: jeton, ...env },
    log, maintenant: () => horloge.t,
  });
  const serveur = http.createServer(envelopper(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://x');
      const ctx = socle.portail.contexte(req, res);
      if (await socle.portail.traiter(req, res, url, ctx)) return;
      if (url.pathname === '/api/lecture') { socle.portail.exiger(ctx); return repondreJson(res, 200, { ok: true }); }
      if (url.pathname === '/api/admin') { socle.portail.exiger(ctx, { role: 'admin' }); return repondreJson(res, 200, { ok: true }); }
      if (url.pathname === '/api/dangereux') { socle.portail.exiger(ctx, { role: 'admin', renfort: true }); return repondreJson(res, 200, { ok: true }); }
      if (url.pathname === '/api/panne') { socle.portail.exiger(ctx); throw new Error('panne simulée'); }
      repondreJson(res, 404, { error: 'inconnu' });
    } catch (e) { repondreErreur(res, e, { journal: { error() {} } }); }
  }));
  await new Promise(r => serveur.listen(0, '127.0.0.1', r));
  const port = serveur.address().port;
  return {
    socle, db, horloge, jeton, port, dossier, origine: `http://localhost:${port}`,
    client: () => new Client(port),
    fermer: () => new Promise(r => { socle.arreter(); serveur.close(() => { db.close(); r(); }); }),
  };
}
