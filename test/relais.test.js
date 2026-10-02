// Le relais du Hub : transparent (méthode, chemin, corps, cookies, flux
// temps réel), l'adresse du client transmise, rien décidé à la place de l'API.
import { VERSION } from '../src/config.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { creerRelais } from '../src/relais.js';
import { Client } from '../socle/essai/client.js';
import { lancer, administrateur, serveurLocal, ouvrirFlux, SILENCE } from './aides.js';

async function relaisVers(cible) {
  const r = creerRelais({ cible, log: SILENCE });
  await new Promise(ok => r.listen(0, '127.0.0.1', ok));
  return { port: r.address().port, fermer: () => new Promise(ok => { r.closeAllConnections(); r.close(ok); }) };
}

test('relais : requête transmise telle quelle, adresse du client ajoutée, en-têtes de connexion retirés', async () => {
  const amont = await serveurLocal((req, res) => { res.writeHead(201, { 'x-reponse': 'oui', 'content-type': 'application/json' }); res.end('{"vu":true}'); });
  const relais = await relaisVers(amont.url);
  try {
    const c = new Client(relais.port);
    const r = await c.req('POST', '/api/devices/manual?x=1', { ip: '192.0.2.10' }, { entetes: { 'x-forwarded-for': '198.51.100.7', 'proxy-authorization': 'Basic secret', cookie: 'mapmylan-sid=abc' } });
    assert.equal(r.status, 201);
    assert.equal(r.entetes['x-reponse'], 'oui');
    const recue = amont.recues[0];
    assert.equal(recue.methode, 'POST');
    assert.equal(recue.url, '/api/devices/manual?x=1');
    assert.deepEqual(JSON.parse(recue.corps), { ip: '192.0.2.10' });
    assert.equal(recue.entetes['x-forwarded-for'], '198.51.100.7, 127.0.0.1');
    assert.equal(recue.entetes['proxy-authorization'], undefined);
    assert.equal(recue.entetes.cookie, 'mapmylan-sid=abc');
    assert.equal(recue.entetes.host, `localhost:${relais.port}`, 'l’hôte d’origine reste celui que le navigateur a demandé');
  } finally { await relais.fermer(); await amont.fermer(); }
  const mort = await relaisVers('http://127.0.0.1:9');
  try {
    const r = await new Client(mort.port).get('/api/health');
    assert.equal(r.status, 502);
    assert.deepEqual(r.json, { error: 'MapMyLAN injoignable.' });
    assert.equal(r.entetes['x-content-type-options'], 'nosniff');
    assert.equal(r.entetes['x-frame-options'], 'DENY');
    assert.equal(r.entetes['cache-control'], 'no-store');
  } finally { await mort.fermer(); }
});

test('relais devant MapMyLAN : connexion, anti-CSRF et flux temps réel traversent', async () => {
  const o = await lancer({ SOCLE_PROXYS: '127.0.0.1' });
  const relais = await relaisVers(`http://127.0.0.1:${o.port}`);
  try {
    const admin = await administrateur({ port: relais.port });
    assert.equal((await admin.get('/api/health')).json.version, VERSION);
    assert.equal((await admin.post('/api/devices/manual', { customName: 'serveur-a' })).status, 200);
    const f = await ouvrirFlux(admin);
    assert.equal(f.status, 200);
    const e = f.attendre('devices:updated');
    await admin.post('/api/devices/manual', { customName: 'serveur-b' });
    assert.equal((await e).nom, 'devices:updated');
    f.fermer();
    const ip = o.db.prepare("SELECT ip FROM socle_sessions ORDER BY cree DESC LIMIT 1").get().ip;
    assert.equal(ip, '127.0.0.1');
  } finally { await relais.fermer(); await o.arreter(); }
});
