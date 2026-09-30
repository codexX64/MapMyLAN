// MapMyLAN en marche, sur de vrais serveurs locaux : droits de chaque route,
// objets d'autrui, corps invalides, sorties gardées, arguments d'outils,
// clés d'hôte épinglées, flux temps réel, assistant plafonné, export et
// effacement d'un compte.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import https from 'node:https';
import { Client } from '../socle/essai/client.js';
import { certificatEssai } from '../socle/essai/smtp.js';
import { entetesSecurite } from '../socle/src/index.js';
import { lancer, administrateur, inviter, renforcer, serveurLocal, ouvrirFlux, ReseauSimule } from './aides.js';

const GRAINE_HUB = 'hub_' + 'e'.repeat(40);
const JETON_BOT = '123456789:' + 'A'.repeat(35);
let o, reseau, admin, membre, lecteur, telegram, ollama;

before(async () => {
  reseau = new ReseauSimule();
  telegram = await serveurLocal((req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end('{"ok":true,"result":{}}');
  });
  ollama = await serveurLocal((req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ message: { content: 'Réponse du modèle d’essai.' }, done_reason: 'stop' }));
  });
  // SOCLE_PROXYS : le balayage des droits se présente depuis plusieurs adresses,
  // pour ne pas épuiser le débit de la seule 127.0.0.1.
  o = await lancer({ IA_URL: ollama.url, IA_MODELE: 'modele-essai', MAPMYLAN_IA_JOUR: '2', INTEGRATION_TOKEN_SEED: GRAINE_HUB, SOCLE_PROXYS: '127.0.0.1' },
    { executeur: reseau.executeur, telegramBase: telegram.url, fluxControleMs: 150 });
  admin = await administrateur(o);
  membre = await inviter(admin, 'bruno', 'membre');
  lecteur = await inviter(admin, 'chloe', 'lecture');
});

after(async () => {
  await o.arreter();
  await telegram.fermer();
  await ollama.fermer();
});

const porteur = jeton => ({ entetes: { authorization: `Bearer ${jeton}` }, sansCsrf: true, origine: null });
const cheminDe = r => r.re.source.replace(/^\^|\$$/g, '').replace(/\\\//g, '/').replace(/\\\./g, '.').replace(/\(\[\^\/\]\+\)/g, 'x');

test('santé : l’anonyme apprend seulement que le service répond', async () => {
  const anonyme = new Client(o.port);
  const r = await anonyme.get('/api/health');
  assert.equal(r.status, 200);
  assert.deepEqual(r.json, { ok: true });
  const connu = await admin.get('/api/health');
  assert.equal(connu.json.version, '2.0.0');
  assert.equal((await anonyme.get('/api/health', porteur(GRAINE_HUB))).json.status, 'ok');
  assert.deepEqual((await anonyme.get('/api/health', porteur('mml_' + 'z'.repeat(40)))).json, { ok: true });
  assert.equal(r.entetes['cache-control'], 'no-store');
  assert.match(r.entetes['content-security-policy'], /frame-ancestors 'none'/);
});

test('autorisation : politique écrite ici, puis chaque route balayée sans session, en lecture et en membre', async () => {
  const routes = o.api.routeur.routes.map(r => ({ r, cle: `${r.methode} ${cheminDe(r)}`, o: r.options || {} }));
  const ADMIN = [
    'DELETE /api/devices/x', 'DELETE /api/vlans/x', 'POST /api/router/detect', 'POST /api/router/test', 'PUT /api/router', 'DELETE /api/router',
    'POST /api/ssh', 'POST /api/ssh/test', 'DELETE /api/ssh/x', 'POST /api/ssh/x/exec',
    'PUT /api/settings/x', 'POST /api/setup/complete', 'PATCH /api/rules/x', 'POST /api/poste/test',
    'GET /api/notifications/x', 'PUT /api/notifications/x', 'POST /api/notifications/x/test', 'DELETE /api/notifications/x',
    'POST /api/commands', 'PATCH /api/commands/x', 'DELETE /api/commands/x', 'POST /api/commands/x/fire',
    'POST /api/bot-commands', 'PATCH /api/bot-commands/x', 'DELETE /api/bot-commands/x', 'POST /api/bot-commands/x/run',
    'POST /api/traffic/purge', 'DELETE /api/traffic/flows', 'GET /api/integrations', 'POST /api/integrations', 'DELETE /api/integrations/x',
    'POST /api/mail/verify', 'POST /api/mail/mailboxes', 'DELETE /api/mail/mailboxes/x',
  ];
  const RENFORT = [
    'DELETE /api/devices/x', 'DELETE /api/vlans/x', 'PUT /api/router', 'DELETE /api/router', 'POST /api/ssh', 'DELETE /api/ssh/x', 'POST /api/ssh/x/exec',
    'PATCH /api/rules/x', 'PUT /api/notifications/x', 'DELETE /api/notifications/x', 'POST /api/commands', 'PATCH /api/commands/x', 'DELETE /api/commands/x',
    'POST /api/commands/x/fire', 'POST /api/bot-commands', 'PATCH /api/bot-commands/x', 'DELETE /api/bot-commands/x', 'POST /api/bot-commands/x/run',
    'DELETE /api/traffic/flows', 'POST /api/integrations', 'DELETE /api/integrations/x', 'POST /api/mail/mailboxes', 'DELETE /api/mail/mailboxes/x',
  ];
  const JETON = [
    'GET /api/devices', 'GET /api/devices/health/score', 'GET /api/devices/scans/latest', 'GET /api/devices/scan/ranges', 'POST /api/devices/scan',
    'GET /api/devices/x', 'GET /api/devices/x/ping', 'POST /api/devices/x/deep-scan', 'POST /api/devices/x/ban', 'POST /api/devices/x/quarantine', 'POST /api/devices/x/unban',
    'GET /api/vlans', 'GET /api/topology', 'POST /api/topology/auto-build', 'GET /api/stats', 'GET /api/alerts', 'POST /api/alerts/x/ack', 'GET /api/host/stats',
  ];
  const trie = l => [...l].sort();
  assert.deepEqual(trie(routes.filter(x => x.o.role === 'admin').map(x => x.cle)), trie(ADMIN));
  assert.deepEqual(trie(routes.filter(x => x.o.renfort).map(x => x.cle)), trie(RENFORT));
  assert.deepEqual(trie(routes.filter(x => x.o.jeton).map(x => x.cle)), trie(JETON));
  assert.deepEqual(routes.filter(x => x.o.public).map(x => x.cle), ['GET /api/health']);

  const anonyme = new Client(o.port);
  const ecarts = [];
  for (const { r, cle, o: opt } of routes) {
    if (opt.public) continue;
    const chemin = cheminDe(r);
    const lecture = ['GET', 'HEAD'].includes(r.methode);
    const corps = lecture || r.methode === 'DELETE' ? undefined : {};
    const attendus = [
      ['anonyme', anonyme, 401, '198.51.100.201'], ['jeton du Hub', anonyme, opt.jeton ? (opt.role === 'admin' ? 403 : null) : 401, '198.51.100.202'],
      ['lecture', lecteur, opt.role === 'lecture' ? null : 403, '198.51.100.203'], ['membre', membre, opt.role === 'admin' ? 403 : null, '198.51.100.204'],
    ];
    for (const [nom, c, attendu, adresse] of attendus) {
      if (attendu === null) continue;
      const o2 = nom === 'jeton du Hub' ? porteur(GRAINE_HUB) : {};
      const s = (await c.req(r.methode, chemin, corps, { ...o2, entetes: { ...o2.entetes, 'x-forwarded-for': adresse } })).status;
      if (s !== attendu) ecarts.push(`${nom} ${cle} → ${s} (attendu ${attendu})`);
    }
  }
  assert.deepEqual(ecarts, []);
  assert.ok(routes.length > 100, `${routes.length} routes`);
  // Les refus de droits sont au journal chaîné du socle.
  const journal = o.db.prepare("SELECT COUNT(*) n FROM socle_journal WHERE action = 'acces.refuse'").get().n;
  assert.ok(journal > 0);
});

test('renfort : une action sensible attend une confirmation d’identité récente', async () => {
  o.db.prepare('UPDATE socle_sessions SET renfort = 0').run();
  const r = await admin.del('/api/router');
  assert.equal(r.status, 403);
  assert.equal(r.json.details.renfort, true);
  await renforcer(admin);
  assert.equal((await admin.del('/api/router')).status, 200);
  await renforcer(membre);
  await renforcer(lecteur);
});

test('jetons d’intégration : créés sous renfort, montrés une fois, limités à leur rôle et aux routes marquées', async () => {
  const cree = await admin.post('/api/integrations', { name: 'script de relevé', role: 'lecture' });
  assert.equal(cree.status, 201);
  const jeton = cree.json.token;
  assert.match(jeton, /^mml_/);
  const liste = await admin.get('/api/integrations');
  assert.ok(!liste.texte.includes(jeton), 'le clair ne ressort jamais');
  assert.equal(liste.json.find(j => j.id === cree.json.id).prefix, jeton.slice(0, 8));
  const c = new Client(o.port);
  assert.equal((await c.get('/api/devices', porteur(jeton))).status, 200);
  assert.equal((await c.post('/api/devices/scan', {}, porteur(jeton))).status, 403, 'rôle lecture : pas de balayage');
  assert.equal((await c.get('/api/settings', porteur(jeton))).status, 401, 'route non marquée « jeton »');
  assert.equal((await c.get('/api/devices', { entetes: { authorization: `Basic ${jeton}` } })).status, 401);
  assert.equal((await admin.post('/api/integrations', { name: 'x', role: 'admin' })).status, 400, 'jamais admin');
  assert.equal((await admin.del(`/api/integrations/${cree.json.id}`)).json.etat, 'revoque');
  assert.equal((await c.get('/api/devices', porteur(jeton))).status, 401);
  assert.equal((await membre.get('/api/integrations')).status, 403);
});

test('inventaire : création, champ effacé, protections réservées, objets d’un autre appareil', async () => {
  const a = await membre.post('/api/devices/manual', { ip: '192.0.2.10', mac: 'aa-bb-cc-00-00-10', customName: 'serveur-a', notes: 'rangée 3' });
  assert.equal(a.status, 200);
  assert.equal(a.json.mac, 'AA:BB:CC:00:00:10');
  assert.match(a.json.id, /^[A-Za-z0-9_-]{16}$/, 'identifiant aléatoire');
  const b = await membre.post('/api/devices/manual', { ip: '192.0.2.11', customName: 'camera-7' });
  for (const type of ['vm', 'container']) {
    const r = await membre.post('/api/devices/manual', { customName: `${type}-3`, type, customType: type });
    assert.equal(r.status, 200, `${type} : ${JSON.stringify(r.json)}`);
    assert.equal(r.json.customType, type, 'le type choisi à l’ajout manuel est gardé tel quel');
  }
  assert.equal((await membre.patch(`/api/devices/${a.json.id}`, { notes: null, tags: ['baie', 'critique'] })).json.notes, null);
  assert.equal((await membre.patch(`/api/devices/${a.json.id}`, { whitelisted: true })).status, 403);
  assert.equal((await admin.patch(`/api/devices/${a.json.id}`, { whitelisted: true })).json.whitelisted, true);
  assert.equal((await membre.patch(`/api/devices/${a.json.id}`, { vlan: 4000 })).status, 400, 'VLAN inconnu');
  const i = await membre.post(`/api/devices/${a.json.id}/interfaces`, { mac: 'AA:BB:CC:00:01:10', type: 'wifi', label: 'wlan0' });
  assert.equal(i.status, 200);
  assert.equal((await membre.patch(`/api/devices/${b.json.id}/interfaces/${i.json.id}`, { label: 'volée' })).status, 404, 'l’interface d’un autre appareil');
  assert.equal((await membre.del(`/api/devices/${b.json.id}/interfaces/${i.json.id}`)).status, 404);
  assert.equal((await membre.get('/api/devices/inconnu-0000000000')).status, 404);
  assert.equal((await membre.get('/api/devices/..%2F..%2Fetc')).status, 404);
  const lien = await membre.post('/api/topology/links', { fromId: a.json.id, toId: b.json.id, type: 'ethernet' });
  assert.equal(lien.status, 200);
  assert.equal((await membre.post('/api/topology/links', { fromId: a.json.id, toId: b.json.id })).status, 409);
  assert.equal((await membre.patch(`/api/topology/links/${lien.json.id}`, { toIfaceId: i.json.id })).status, 400, 'interface qui n’est pas à l’appareil visé');
  assert.equal((await membre.patch(`/api/topology/links/${lien.json.id}`, { fromIfaceId: i.json.id, speed: '1G' })).json.fromIfaceId, i.json.id);
  assert.equal((await lecteur.post('/api/topology/positions', { positions: [{ id: a.json.id, x: 10, y: 20 }, { id: 'disparu-000000', x: 1, y: 1 }] })).status, 200);
  assert.equal((await admin.get(`/api/devices/${a.json.id}`)).json.posX, 10);
  assert.equal((await membre.del(`/api/devices/${b.json.id}`)).status, 403);
  assert.equal((await admin.del(`/api/devices/${b.json.id}`)).status, 200);
  assert.equal((await admin.get('/api/topology')).json.links.length, 0, 'les liens partent avec l’appareil');
});

test('notation : ports à risque et versions vulnérables expliqués, santé du réseau', async () => {
  const d = await membre.post('/api/devices/manual', { ip: '192.0.2.50', mac: 'AA:BB:CC:00:00:50', customName: 'serveur-b' });
  o.s.appareils.remplacerPorts(d.json.id, [
    { port: 23, protocol: 'tcp', state: 'open', service: 'telnet' },
    { port: 22, protocol: 'tcp', state: 'open', service: 'ssh', product: 'OpenSSH', version: '8.2p1 Debian' },
  ]);
  const r = await membre.post(`/api/devices/${d.json.id}/score`, {});
  assert.equal(r.status, 200);
  assert.ok(r.json.vulnScore >= 18 + 23, JSON.stringify(r.json));
  assert.ok(r.json.reasons.vuln.some(x => /Telnet/.test(x.reason)));
  assert.ok(r.json.reasons.vuln.some(x => /CVE-2020-15778/.test(x.reason)));
  const fiche = (await lecteur.get(`/api/devices/${d.json.id}`)).json;
  assert.deepEqual(fiche.cves.map(c => c.cveId), ['CVE-2020-15778']);
  assert.equal(fiche.dangerScore, r.json.dangerScore);
  assert.ok(fiche.history.some(h => h.event === 'first_seen'));
  const sante = (await lecteur.get('/api/devices/health/score')).json.score;
  assert.ok(sante >= 0 && sante <= 100);
});

test('corps invalides : champ inconnu, type, taille, liste, format', async () => {
  const cas = [
    [membre.post('/api/devices/manual', { ip: '192.0.2.12', admin: true }), 400, /Champ inattendu/],
    [membre.post('/api/devices/manual', { ip: 12 }), 400, /texte attendu/],
    [membre.post('/api/devices/manual', { customName: 'x'.repeat(81) }), 400, /au plus 80/],
    [membre.post('/api/devices/manual', { mac: 'AA:BB:CC:DD:EE' }), 400, /format invalide/],
    [membre.post('/api/devices/manual', {}), 400, /Au moins/],
    [lecteur.post('/api/topology/positions', { positions: Array.from({ length: 2001 }, () => ({ id: 'aaaaaaaa', x: 0, y: 0 })) }), 400, /au plus 2000/],
    [membre.patch('/api/devices/x', { tags: Array.from({ length: 21 }, (_, i) => `t${i}`) }), 400, /au plus 20/],
    [admin.put('/api/settings/jwt.secret', { value: 'x' }), 400, /Réglage inconnu/],
    [admin.put('/api/settings/scan.ranges', { value: [{ cidr: '198.51.0.0/8' }] }), 400, /CIDR/],
    [admin.put('/api/settings/world.origin', { value: '95,10' }), 400, /latitude/],
    [admin.post('/api/commands', { name: 'x', trigger: 'device.new', actions: [{ kind: 'exec_ssh', deviceId: 'inconnu-0000', cmd: 'reboot' }] }), 400, /Équipement SSH inconnu/],
    [admin.post('/api/commands', { name: 'x', trigger: 'device.new', actions: [{ kind: 'shell', cmd: 'id' }] }), 400, /valeur non admise/],
    [admin.put('/api/notifications/sms', { enabled: true }), 400, /SMS/],
    [admin.put('/api/notifications/telegram', { enabled: true, config: { token: 'faux', chatId: '1' } }), 400, /format invalide/],
    [lecteur.get('/api/alerts?limit=100000'), 400, /au plus 500/],
    [lecteur.get('/api/logs?level=debug'), 400, /valeur non admise/],
  ];
  for (const [promesse, statut, message] of cas) {
    const r = await promesse;
    assert.equal(r.status, statut, JSON.stringify(r.json));
    assert.match(r.json.error, message);
  }
  const texte = await membre.req('POST', '/api/devices/dedupe', undefined, { entetes: { 'content-type': 'text/plain' }, brut: 'x' });
  assert.equal(texte.status, 415);
  const casse = await membre.req('POST', '/api/devices/dedupe', undefined, { entetes: { 'content-type': 'application/json' }, brut: '{"a":' });
  assert.equal(casse.status, 400);
  const gros = await membre.req('POST', '/api/devices/manual', undefined, { entetes: { 'content-type': 'application/json' }, brut: JSON.stringify({ notes: 'x'.repeat(70 * 1024) }) });
  assert.equal(gros.status, 413);
});

test('balayage : plages déclarées seulement, arguments des outils jamais détournés', async () => {
  for (const subnet of ['-oG /tmp/x', '192.0.2.0/24; id', '192.0.2.0/24 --script=x', '$(reboot)']) {
    assert.equal((await membre.post('/api/devices/scan', { subnet })).status, 400, subnet);
  }
  assert.match((await membre.post('/api/devices/scan', { subnet: '203.0.113.0/24' })).json.error, /Plage non déclarée/);
  assert.equal((await admin.put('/api/settings/scan.ranges', { value: [{ cidr: '192.0.2.0/24', label: 'bureau' }] })).status, 200);
  reseau.sorties.ip = args => (args[0] === '-4' ? '2: eth0    inet 192.0.2.2/24 brd 192.0.2.255 scope global eth0\n' : args[0] === 'route' ? 'default via 192.0.2.1 dev eth0\n' : '');
  reseau.sorties['arp-scan'] = '192.0.2.21\tAA:BB:CC:00:11:22\tBrother Industries\n192.0.2.1\tAA:BB:CC:00:00:01\tExemple Réseaux\n';
  reseau.sorties.ping = '2 packets transmitted, 2 received\nrtt min/avg/max/mdev = 0.3/0.42/0.5/0.1 ms\n';
  const flux = await ouvrirFlux(admin);
  const fin = flux.attendre('scan:complete');
  assert.equal((await membre.post('/api/devices/scan', { subnet: '192.0.2.0/24' })).status, 200);
  const e = await fin;
  assert.equal(e.data.hostsFound, 2);
  assert.ok(flux.evenements.some(x => x.nom === 'scan:started' && x.data.subnet === '192.0.2.0/24'));
  flux.fermer();
  const appareils = (await lecteur.get('/api/devices')).json;
  assert.equal(appareils.find(d => d.ip === '192.0.2.21').type, 'printer');
  assert.equal(appareils.find(d => d.ip === '192.0.2.1').type, 'router', 'la passerelle est un routeur');
  for (const a of reseau.appels.filter(x => ['nmap', 'arp-scan', 'ping'].includes(x.programme) && x.args.includes('--'))) {
    const cible = a.args[a.args.indexOf('--') + 1];
    assert.ok(/^192\.0\.2\.\d+(\/24)?$/.test(cible), `${a.programme} ${a.args.join(' ')}`);
    assert.equal(a.shell, false);
  }
  assert.ok(reseau.appels.some(a => a.programme === 'arp-scan' && a.args.join(' ') === '-I eth0 -q -- 192.0.2.0/24'));
  const imprimante = appareils.find(d => d.ip === '192.0.2.21');
  const ping = await lecteur.get(`/api/devices/${imprimante.id}/ping`);
  assert.deepEqual(ping.json, { alive: true, latencyMs: 0.42 });
  assert.deepEqual(reseau.appels.at(-1).args.slice(-2), ['--', '192.0.2.21']);
  const dehors = await membre.post('/api/devices/manual', { ip: '198.51.100.10', customName: 'hors-plage' });
  assert.equal((await membre.post(`/api/devices/${dehors.json.id}/deep-scan`, {})).status, 409, 'hors des plages déclarées : pas de sonde');
  assert.equal((await membre.post('/api/devices/manual', { ip: '-oG' })).status, 400);
});

test('consoles SSH : clé d’hôte confirmée à l’enregistrement, secret jamais en argument, clé changée refusée', async () => {
  const base = { name: 'passerelle', host: '127.0.0.1', port: 22, username: 'admin', password: reseau.motDePasse, vendor: 'generic' };
  const essai = await admin.post('/api/ssh/test', base);
  assert.equal(essai.json.aConfirmer, true);
  const empreinte = essai.json.empreinteHote;
  assert.match(empreinte, /^SHA256:/);
  assert.equal((await admin.post('/api/ssh', base)).status, 400, 'l’empreinte confirmée est obligatoire');
  const mauvaise = await admin.post('/api/ssh', { ...base, empreinteHote: 'SHA256:' + 'A'.repeat(43) });
  assert.equal(mauvaise.status, 409);
  assert.equal(mauvaise.json.details.empreinteHote, empreinte);
  assert.equal((await admin.post('/api/ssh', { ...base, username: '-oProxyCommand=id', empreinteHote: empreinte })).status, 400);
  assert.equal((await admin.post('/api/ssh', { ...base, host: '-oProxyCommand=id', empreinteHote: empreinte })).status, 400);
  const cree = await admin.post('/api/ssh', { ...base, empreinteHote: empreinte, isMainRouter: true });
  assert.equal(cree.status, 200, JSON.stringify(cree.json));
  const ligne = o.db.prepare('SELECT * FROM equipements WHERE id = ?').get(cree.json.id);
  assert.ok(!JSON.stringify(ligne).includes(reseau.motDePasse), 'mot de passe scellé');
  assert.ok(!(await admin.get('/api/ssh')).texte.includes('password'), 'aucun secret vers le navigateur');
  assert.equal((await admin.get('/api/router')).json.hasPassword, true);
  assert.equal((await admin.post(`/api/ssh/${cree.json.id}/exec`, { command: 'uname -a; id' })).status, 400);
  assert.equal((await membre.post(`/api/ssh/${cree.json.id}/exec`, { command: 'uname -a' })).status, 403);
  const r = await admin.post(`/api/ssh/${cree.json.id}/exec`, { command: 'uname -a' });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.match(r.json.stdout, /^Linux passerelle-essai/);
  const appel = reseau.appels.filter(a => a.programme === 'ssh').at(-1);
  assert.ok(appel.args.every(a => !a.includes(reseau.motDePasse)), 'le mot de passe n’est pas un argument');
  assert.ok(appel.args.includes('StrictHostKeyChecking=yes'));
  assert.deepEqual(appel.args.slice(-3), ['--', '127.0.0.1', 'uname -a']);
  assert.match(appel.env.SSH_ASKPASS, /demande-secret\.js$/);
  assert.equal(appel.env.SSH_ASKPASS_REQUIRE, 'force');
  assert.deepEqual(reseau.dernierSecret, { lu: reseau.motDePasse, fichierRestant: false }, 'lu une fois par SSH_ASKPASS, puis effacé');
  // Défense par l'équipement enregistré : une commande écrite, une adresse validée.
  const cible = (await lecteur.get('/api/devices')).json.find(d => d.ip === '192.0.2.21');
  const bloque = await membre.post(`/api/devices/${cible.id}/ban`, { reason: 'essai' });
  assert.equal(bloque.status, 200, JSON.stringify(bloque.json));
  assert.match(reseau.appels.filter(a => a.programme === 'ssh').at(-1).args.at(-1), /192\.0\.2\.21/);
  // L'équipement présente une autre clé : plus rien ne passe.
  reseau.cleServeur = Buffer.from('une autre clé d’hôte, présentée plus tard').toString('base64');
  const refus = await admin.post(`/api/ssh/${cree.json.id}/exec`, { command: 'uname -a' });
  assert.equal(refus.status, 502);
  assert.match(refus.json.error, /Clé d’hôte différente/);
});

test('commandes : action SSH vérifiée, déclenchement d’une seule commande', async () => {
  const equipement = (await admin.get('/api/ssh')).json[0];
  const c = await admin.post('/api/commands', { name: 'journal des nouveaux', trigger: 'device.new', actions: [{ kind: 'log', level: 'warn' }], template: 'Nouveau : {{ip}}' });
  assert.equal(c.status, 200);
  assert.equal((await admin.post('/api/commands', { name: 'x', trigger: 'device.new', actions: [{ kind: 'exec_ssh', deviceId: equipement.id, cmd: 'reboot; id' }] })).status, 400);
  assert.equal((await admin.post(`/api/commands/${c.json.id}/fire`, { vars: { ip: '192.0.2.99' } })).status, 200);
  const logs = (await lecteur.get('/api/logs?level=warn')).json;
  assert.ok(logs.some(l => l.message === '[journal des nouveaux] Nouveau : 192.0.2.99'));
  assert.equal((await admin.get('/api/commands')).json[0].fireCount, 1);
  const bot = await admin.post('/api/bot-commands', { trigger: 'etat', action: 'status' });
  assert.equal(bot.json.trigger, '/etat');
  assert.equal((await admin.post('/api/bot-commands', { trigger: '/etat', action: 'status' })).status, 409);
  assert.match((await admin.post(`/api/bot-commands/${bot.json.id}/run`, {})).json.reply, /État du réseau/);
});

test('équipement en HTTPS : certificat auto-signé épinglé à la confirmation, puis seul admis', async () => {
  let certificat = certificatEssai('localhost');
  const reponses = (req, res) => {
    res.setHeader('content-type', 'application/json');
    if (req.url === '/api/auth/login') { res.setHeader('x-csrf-token', 'csrf-essai'); return res.end('{}'); }
    if (req.url.endsWith('/stat/sta')) return res.end(JSON.stringify({ data: [{ mac: 'aa:bb:cc:00:22:33', ip: '192.0.2.40', hostname: 'camera-7', is_wired: false, ap_mac: 'aa:bb:cc:00:00:02', rssi: -60 }] }));
    res.end('{"data":[]}');
  };
  let serveur = https.createServer({ key: certificat.cle, cert: certificat.cert }, reponses);
  await new Promise(r => serveur.listen(0, '127.0.0.1', r));
  const port = serveur.address().port;
  try {
    const ident = { vendor: 'unifi', transport: 'api', host: '127.0.0.1', port, username: 'admin', password: 'mot-de-passe-du-controleur', apiBaseUrl: `https://127.0.0.1:${port}`, site: 'default' };
    assert.equal((await admin.post('/api/router/detect', { ...ident, apiBaseUrl: 'https://169.254.169.254' })).status, 400, 'une API ailleurs que sur l’équipement');
    const vu = await admin.post('/api/router/detect', ident);
    assert.equal(vu.status, 200, JSON.stringify(vu.json));
    assert.equal(vu.json.certificatReconnu, false);
    assert.match(vu.json.empreinteTls, /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/);
    const sans = await admin.put('/api/router', ident);
    assert.equal(sans.status, 409);
    assert.equal(sans.json.details.empreinteTls, vu.json.empreinteTls);
    const r = await admin.put('/api/router', { ...ident, empreinteTls: vu.json.empreinteTls });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.empreinteTls, vu.json.empreinteTls);
    assert.equal(r.json.hasPassword, true);
    const clients = await lecteur.get('/api/router/clients');
    assert.equal(clients.status, 200, JSON.stringify(clients.json));
    assert.equal(clients.json.clients[0].hostname, 'camera-7');
    // Un autre certificat sur la même adresse : la connexion est refusée.
    await new Promise(res => { serveur.closeAllConnections(); serveur.close(res); });
    certificat = certificatEssai('localhost');
    serveur = https.createServer({ key: certificat.cle, cert: certificat.cert }, reponses);
    await new Promise(res => serveur.listen(port, '127.0.0.1', res));
    const refus = await lecteur.get('/api/router/clients');
    assert.equal(refus.status, 502);
    assert.match(refus.json.error, /Certificat de l’équipement refusé/);
    assert.ok(!refus.texte.includes('camera-7'));
  } finally {
    serveur.closeAllConnections();
    await new Promise(res => serveur.close(res));
    await admin.del('/api/router');
  }
});

test('sorties gardées : billetterie et boîtes mail ne joignent ni les métadonnées ni l’interne non autorisé', async () => {
  const billetterie = await serveurLocal((req, res) => {
    if (req.url === '/rebond') { res.writeHead(302, { location: 'http://169.254.169.254/latest/meta-data' }); return res.end(); }
    res.writeHead(201, { 'content-type': 'application/json' });
    res.end('{"id":"t1","ref":"TKT-412"}');
  });
  try {
    const poser = url => admin.put('/api/notifications/billetterie', { enabled: true, config: { url, cle: 'cle-de-billetterie-essai' } });
    assert.equal((await poser(`${billetterie.url}/tickets`)).status, 200);
    const pub = await admin.get('/api/notifications/billetterie');
    assert.deepEqual(pub.json.secrets, { cle: true });
    assert.ok(!pub.texte.includes('cle-de-billetterie-essai'));
    assert.match((await admin.post('/api/notifications/billetterie/test', {})).json.error, /destination interne non autorisée/);
    assert.equal(billetterie.recues.length, 0);
    assert.equal((await admin.put('/api/settings/sortie.autorisees', { value: ['127.0.0.1'] })).status, 200);
    const ok = await admin.post('/api/notifications/billetterie/test', {});
    assert.equal(ok.json.ok, true, JSON.stringify(ok.json));
    assert.equal(billetterie.recues[0].entetes['x-ticket-key'], 'cle-de-billetterie-essai');
    assert.equal(JSON.parse(billetterie.recues[0].corps).titre.startsWith('Récapitulatif'), true);
    await poser(`${billetterie.url}/rebond`);
    assert.match((await admin.post('/api/notifications/billetterie/test', {})).json.error, /redirection refusée/);
    await poser('http://169.254.169.254/latest/meta-data');
    assert.match((await admin.post('/api/notifications/billetterie/test', {})).json.error, /toujours refusée/);
    const boite = await admin.post('/api/mail/verify', { email: 'alertes@exemple.org', role: 'send', smtp: { host: '169.254.169.254', port: 465, security: 'ssl' }, password: 'x' });
    assert.equal(boite.status, 502);
    assert.match(boite.json.error, /toujours refusée/);
    assert.equal((await admin.post('/api/mail/verify', { email: 'alertes@exemple.org', role: 'send', smtp: { host: 'relais.exemple.org', port: 25, security: 'none' }, password: 'x' })).status, 400, 'jamais d’identifiants en clair');
  } finally {
    await admin.put('/api/settings/sortie.autorisees', { value: [] });
    await admin.del('/api/notifications/billetterie');
    await billetterie.fermer();
  }
});

test('Telegram : secret jamais rendu, texte échappé, SMS retiré', async () => {
  assert.equal((await admin.put('/api/notifications/telegram', { enabled: true, config: { token: JETON_BOT, chatId: '42' } })).status, 200);
  const pub = await admin.get('/api/notifications/telegram');
  assert.deepEqual(pub.json, { channel: 'telegram', enabled: true, config: { chatId: '42' }, secrets: { token: true } });
  assert.equal((await admin.put('/api/notifications/telegram', { enabled: true, config: { chatId: '43' } })).status, 200, 'un secret omis garde celui en place');
  await new Promise(r => setTimeout(r, 400));
  assert.equal(o.s.notifications.bot.actif, false, 'sans tâches de fond, le bot n’écoute pas');
  assert.ok(!telegram.recues.some(r => r.url.includes('/getUpdates')), 'aucune relève partie vers Telegram');
  // Contrat de docs/API.md : des chiffres, avec le « - » initial d'une discussion de groupe.
  for (const [chatId, statut] of [['-1001234567890', 200], ['1-2', 400], ['--5', 400], ['12a', 400], ['1'.repeat(21), 400]]) {
    assert.equal((await admin.put('/api/notifications/telegram', { enabled: true, config: { chatId } })).status, statut, chatId);
  }
  const groupe = await admin.post('/api/bot-commands', { trigger: 'groupe', action: 'status', allowedChatIds: ['-1001234567890'] });
  assert.equal(groupe.status, 200, JSON.stringify(groupe.json));
  assert.equal((await admin.post('/api/bot-commands', { trigger: 'groupe2', action: 'status', allowedChatIds: ['+33'] })).status, 400);
  await admin.del(`/api/bot-commands/${groupe.json.id}`);
  assert.equal((await admin.put('/api/notifications/telegram', { enabled: true, config: { chatId: '43' } })).status, 200);
  const essai = await admin.post('/api/notifications/telegram/test', {});
  assert.equal(essai.json.ok, true, JSON.stringify(essai.json));
  await o.s.notifications.diffuser('critical', 'Appareil <b>inconnu</b>', 'Nom annoncé : <a href="x">clic</a>', { IP: '192.0.2.66' });
  const envoi = telegram.recues.filter(r => r.url.endsWith('/sendMessage')).at(-1);
  assert.equal(envoi.url, `/bot${JETON_BOT}/sendMessage`);
  const texte = JSON.parse(envoi.corps).text;
  assert.equal(JSON.parse(envoi.corps).chat_id, '43');
  assert.ok(!texte.includes('<a href'), texte);
  assert.match(texte, /&#60;b&#62;inconnu&#60;\/b&#62;/);
  assert.equal((await admin.del('/api/notifications/telegram')).status, 200);
});

test('globe : le point d’observation se règle par un administrateur et se lit en lecture', async () => {
  assert.equal((await membre.put('/api/settings/world.origin', { value: '12.5,-45.25' })).status, 403);
  assert.equal((await admin.put('/api/settings/world.origin', { value: '12.5,-45.25,Observatoire' })).status, 200);
  assert.equal((await lecteur.get('/api/settings')).json['world.origin'], '12.5,-45.25,Observatoire');
});

test('flux temps réel : session exigée, événements, six onglets au plus, fermé à la déconnexion', async () => {
  const anonyme = await ouvrirFlux(new Client(o.port));
  assert.equal(anonyme.status, 401);
  const parJeton = await ouvrirFlux(new Client(o.port), '/api/flux', { authorization: `Bearer ${GRAINE_HUB}` });
  assert.equal(parJeton.status, 401, 'un jeton n’ouvre pas le flux');
  const f = await ouvrirFlux(admin);
  assert.equal(f.status, 200);
  const attendu = f.attendre('devices:updated');
  await membre.post('/api/devices/manual', { customName: 'tablette-3' });
  assert.equal((await attendu).data, null);
  const autres = [];
  for (let i = 0; i < 5; i++) autres.push(await ouvrirFlux(admin));
  assert.ok(autres.every(x => x.status === 200));
  assert.equal((await ouvrirFlux(admin)).status, 429);
  f.fermer(); for (const x of autres) x.fermer();
  const lui = await inviter(admin, 'dora', 'lecture');
  const sien = await ouvrirFlux(lui);
  assert.equal(sien.status, 200);
  await lui.post('/api/compte/deconnexion', {});
  await Promise.race([sien.termine, new Promise((_, ko) => setTimeout(() => ko(new Error('flux resté ouvert')), 3000))]);
  assert.equal(sien.fini, true);
});

test('assistant : fil propre au compte, plafond journalier, administrateurs prévenus', async () => {
  const etat = await lecteur.get('/api/assistant');
  assert.equal(etat.json.ia.prete, true);
  assert.deepEqual(etat.json.quota, { jour: 2, restant: 2 });
  const salut = await lecteur.post('/api/assistant/ask', { text: 'bonjour' });
  assert.equal(salut.status, 200);
  assert.equal(salut.json.modele, null, 'réponse directe, sans le modèle');
  const longue = 'Explique en détail pourquoi la santé du réseau a changé depuis hier et ce que je devrais vérifier en premier';
  assert.equal((await lecteur.post('/api/assistant/ask', { text: longue })).json.reply, 'Réponse du modèle d’essai.');
  assert.equal((await lecteur.get('/api/assistant')).json.quota.restant, 1);
  assert.equal((await membre.get('/api/assistant')).json.fil.length, 0, 'le fil d’un autre ne se lit pas');
  assert.equal((await lecteur.post('/api/assistant/ask', { text: longue })).status, 200);
  const refus = await lecteur.post('/api/assistant/ask', { text: longue });
  assert.equal(refus.status, 429);
  assert.match(refus.json.error, /Plafond journalier/);
  assert.equal(o.db.prepare("SELECT COUNT(*) n FROM socle_alertes WHERE type = 'service.depense'").get().n, 1, 'l’administrateur est prévenu, une fois');
  assert.equal((await lecteur.req('POST', '/api/assistant/voix/transcrire', undefined, { entetes: { 'content-type': 'text/plain' }, brut: 'x' })).status, 415);
  assert.equal((await lecteur.req('POST', '/api/assistant/voix/transcrire', undefined, { entetes: { 'content-type': 'audio/wav' }, brut: 'RIFF' })).status, 409, 'VOX absent');
});

test('données personnelles : export du compte, puis effacement de tout ce qui lui appartient', async () => {
  const export_ = await lecteur.get('/api/compte/export');
  assert.equal(export_.status, 200, JSON.stringify(export_.json));
  assert.ok(export_.json.mapmylan.assistant.length >= 3);
  assert.deepEqual(export_.json.mapmylan.jetonsCrees, []);
  assert.ok(!JSON.stringify(export_.json).includes('csrf'));
  const id = lecteur.compteId;
  assert.ok(o.db.prepare('SELECT COUNT(*) n FROM assistant_tours WHERE compte = ?').get(id).n > 0);
  await renforcer(admin);
  assert.equal((await admin.del(`/api/compte/admin/comptes/${id}`)).status, 200);
  assert.equal(o.db.prepare('SELECT COUNT(*) n FROM assistant_tours WHERE compte = ?').get(id).n, 0);
  assert.equal(o.db.prepare('SELECT COUNT(*) n FROM quotas_ia WHERE qui = ?').get(`compte:${id}`).n, 0);
  const jeton = await admin.post('/api/integrations', { name: 'du compte effacé', role: 'lecture' });
  const moi = (await admin.etat()).session.compte.id;
  assert.equal(o.db.prepare('SELECT createdById FROM jetons_integration WHERE id = ?').get(jeton.json.id).createdById, moi);
  assert.equal((await admin.get('/api/compte/export')).json.mapmylan.jetonsCrees.some(j => j.id === jeton.json.id), true);
});

test('machine hôte : cœurs, disque libre et cartes rendus, comme la page les affiche', async () => {
  for (const r of [await membre.get('/api/host/stats'), await new Client(o.port).get('/api/host/stats', porteur(GRAINE_HUB))]) {
    assert.equal(r.status, 200);
    assert.ok(Number.isInteger(r.json.cores) && r.json.cores >= 1, JSON.stringify(r.json.cores));
    assert.equal(typeof r.json.diskFreeGB, 'number');
    assert.ok(Array.isArray(r.json.interfaces));
    for (const c of r.json.interfaces) assert.deepEqual(Object.keys(c).sort(), ['address', 'internal', 'name', 'role']);
  }
});

test('fichiers statiques : interface et socle servis avec leur politique, rien hors des dossiers', async () => {
  const c = new Client(o.port);
  const page = await c.get('/');
  assert.equal(page.status, 200);
  assert.ok(!page.texte.includes('__NONCE__'));
  assert.equal((await c.get('/socle/compte.js')).status, 200);
  assert.equal((await c.get('/socle/../src/main.js')).status, 404);
  assert.equal((await c.get('/%2e%2e/package.json')).status, 404);
  assert.equal((await c.get('/api/inconnue')).status, 404);
  assert.equal((await c.get('/.well-known/security.txt')).status, 200);
});

test('segments cachés : 404, jamais l’interface à leur place', async () => {
  const c = new Client(o.port);
  for (const chemin of ['/.env', '/.git/config', '/%2eenv', '/carte/.cache', '/.well-known/inconnu']) {
    const r = await c.get(chemin);
    assert.equal(r.status, 404, chemin);
    assert.ok(!r.texte.includes('<html'), chemin);
  }
  // Une adresse de page gardée en favori mène toujours à l'interface.
  assert.equal((await c.get('/appareils')).status, 200);
});

test('permissions : le micro pour la page elle-même, le reste comme la politique du socle', async () => {
  const socle = {};
  entetesSecurite({ setHeader: (k, v) => { socle[k] = v; } }, {});
  const attendue = socle['Permissions-Policy'].replace('microphone=()', 'microphone=(self)');
  assert.notEqual(attendue, socle['Permissions-Policy']);
  for (const chemin of ['/', '/api/health', '/api/devices']) {
    assert.equal((await new Client(o.port).get(chemin)).entetes['permissions-policy'], attendue, chemin);
  }
});
