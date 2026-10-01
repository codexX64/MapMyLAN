// Reprise d'une 1.4.1 : un export fabriqué d'après le schéma Prisma de la
// 1.4.1 (tables, colonnes, formats de date, chiffrement MASTER_KEY, empreintes
// Argon2id poivrées et bcrypt), importé par la vraie ligne de commande dans
// une base neuve, puis relu par le service démarré dessus.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { Client, connexion } from '../socle/essai/client.js';
import { codeTotp } from '../socle/essai/inscription.js';
import { lancer, dossierTemporaire } from './aides.js';

const RACINE = path.resolve(import.meta.dirname, '..');
const POIVRE_V1 = 'poivre-de-la-version-1-pour-les-essais-0123456789';
const CLE_V1 = 'cle-maitresse-de-la-version-1-pour-les-essais';
const MDP_ANA = 'phrase de passe reprise de la version 1';
const TOTP_ANA = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
const JETON_LECTURE = 'mml_' + 'L'.repeat(43);
const JETON_OPERATEUR = 'mml_' + 'O'.repeat(43);
const JETON_COMPTES = 'hub_' + 'C'.repeat(43);

// Ce que produisait la 1.4.1 : Argon2id de @node-rs/argon2 sur le HMAC poivré.
function empreinteV1(mdp) {
  const sel = crypto.randomBytes(16);
  const message = crypto.createHmac('sha256', POIVRE_V1).update(mdp, 'utf8').digest('base64');
  const h = crypto.argon2Sync('argon2id', { message, nonce: sel, memory: 32768, passes: 3, parallelism: 1, tagLength: 32 });
  const b64 = b => b.toString('base64').replace(/=+$/, '');
  return `$argon2id$v=19$m=32768,t=3,p=1$${b64(sel)}$${b64(h)}`;
}
// Et services/crypto.ts : AES-256-GCM sous SHA-256(MASTER_KEY), iv 12 + étiquette 16.
function chiffreV1(clair) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', crypto.createHash('sha256').update(CLE_V1).digest(), iv);
  const enc = Buffer.concat([c.update(clair, 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), enc]).toString('base64');
}
const sha256 = t => crypto.createHash('sha256').update(t, 'utf8').digest('hex');
// json_agg d'une colonne « timestamp(3) » : sans fuseau, en UTC.
const date = iso => iso.replace('Z', '');

function exportV1() {
  const cuid = n => `ckv1${String(n).padStart(21, '0')}`;
  const [ana, bruno, chloe] = [cuid(1), cuid(2), cuid(3)];
  const [dA, dB] = [cuid(10), cuid(11)];
  return {
    format: 'mapmylan-v1', version: '1.4.1',
    tables: {
      User: [
        { id: ana, username: 'Ana', password: empreinteV1(MDP_ANA), role: 'admin', createdAt: date('2025-03-01T10:00:00.000Z'), lastLogin: date('2026-09-01T08:00:00.000Z'), totpSecret: TOTP_ANA, totpEnabled: true, mustChangePassword: false, tokenVersion: 3, failedLogins: 0, lockedUntil: null, email: 'ana@exemple.org' },
        { id: bruno, username: 'bruno', password: '$2b$10$' + 'x'.repeat(53), role: 'operator', createdAt: date('2025-04-01T10:00:00.000Z'), lastLogin: null, totpSecret: null, totpEnabled: false, mustChangePassword: false, tokenVersion: 0, failedLogins: 0, lockedUntil: null, email: null },
        { id: chloe, username: 'x!', password: empreinteV1('une autre phrase'), role: 'viewer', createdAt: date('2025-05-01T10:00:00.000Z'), lastLogin: null, totpSecret: 'ABCDEF', totpEnabled: false, mustChangePassword: false, tokenVersion: 0, failedLogins: 0, lockedUntil: null, email: null },
      ],
      Device: [
        { id: dA, ip: '192.0.2.21', mac: 'AA:BB:CC:00:11:22', hostname: 'imprimante-2', customName: null, vendor: 'Brother', model: null, os: null, type: 'printer', customType: null, vlan: 10, zone: 'Bureau', tags: ['impression'], notes: null, role: null, status: 'online', trustScore: 60, activityScore: 0, vulnScore: 10, dangerScore: 12, scoreReasons: { trust: [{ reason: 'connu', delta: 10 }] }, whitelisted: false, isMainRouter: false, posX: 100.5, posY: 20, pinned: true, firstSeen: date('2025-06-01T10:00:00.000Z'), lastSeen: date('2026-09-20T10:00:00.000Z'), metadata: { medium: 'wired' } },
        { id: dB, ip: '192.0.2.1', mac: 'AA:BB:CC:00:00:01', hostname: 'passerelle', customName: 'serveur-a', vendor: null, model: null, os: 'Linux', type: 'router', customType: null, vlan: null, zone: null, tags: [], notes: 'note', role: 'gateway', status: 'online', trustScore: 90, activityScore: 0, vulnScore: 0, dangerScore: 0, scoreReasons: null, whitelisted: true, isMainRouter: true, posX: null, posY: null, pinned: false, firstSeen: date('2025-06-01T10:00:00.000Z'), lastSeen: date('2026-09-20T10:00:00.000Z'), metadata: null },
      ],
      Interface: [{ id: cuid(20), deviceId: dA, mac: 'AA:BB:CC:00:11:23', ip: null, type: 'wifi', label: 'wlan0', posX: null, posY: null, isPrimary: false, createdAt: date('2025-06-01T10:00:00.000Z') }],
      Port: [{ id: cuid(30), deviceId: dA, port: 631, protocol: 'tcp', state: 'open', service: 'ipp', product: null, version: null, detectedAt: date('2026-09-20T10:00:00.000Z') }],
      CveMatch: [
        { id: cuid(40), deviceId: dA, cveId: 'CVE-2024-0001', cvss: 7.5, severity: 'high', description: 'essai', service: 'ipp', detectedAt: date('2026-09-20T10:00:00.000Z') },
        { id: cuid(41), deviceId: dA, cveId: 'CVE-2024-0001', cvss: 7.5, severity: 'high', description: 'doublon', service: 'ipp', detectedAt: date('2026-09-20T10:00:00.000Z') },
      ],
      DeviceHistory: [{ id: cuid(50), deviceId: dA, event: 'first_seen', data: { vendor: 'Brother' }, createdAt: date('2025-06-01T10:00:00.000Z') }],
      TopologyLink: [{ id: cuid(60), fromId: dB, toId: dA, fromIfaceId: null, toIfaceId: null, type: 'ethernet', speed: '1G', vlan: null, manual: true, createdAt: date('2025-06-01T10:00:00.000Z') }],
      Zone: [{ id: cuid(70), name: 'Bureau', color: '#38bdf8', x: 0, y: 0, width: 200, height: 150, notes: null, createdAt: date('2025-06-01T10:00:00.000Z') }],
      Vlan: [
        { id: 10, name: 'Bureau', subnet: '192.0.2.0/24', description: null, color: '#1B2AFF', isolated: false, createdAt: date('2025-06-01T10:00:00.000Z'), gateway: '192.0.2.1', networkId: null },
        { id: 99999, name: 'hors bornes', subnet: '198.51.100.0/24', description: null, color: '#1B2AFF', isolated: false, createdAt: date('2025-06-01T10:00:00.000Z'), gateway: null, networkId: null },
      ],
      SshDevice: [{ id: cuid(80), name: 'passerelle', host: '192.0.2.1', port: 22, username: 'admin', passwordEnc: chiffreV1('mot-de-passe-ssh-v1'), privateKeyEnc: null, passphraseEnc: null, vendor: 'mikrotik', transport: 'ssh', apiBaseUrl: null, site: null, verifyTls: false, isMainRouter: true, lastConnected: null, lastTestOk: true, lastTestAt: null, lastTestInfo: 'RouterOS 7', createdAt: date('2025-06-01T10:00:00.000Z') }],
      Alert: [{ id: cuid(90), severity: 'high', source: 'scanner', message: 'Nouvel appareil', deviceId: dA, deviceIp: '192.0.2.21', deviceMac: 'AA:BB:CC:00:11:22', acknowledged: false, metadata: null, createdAt: date('2026-09-20T10:00:00.000Z') }],
      LogEntry: [{ id: cuid(91), level: 'info', source: 'scanner', message: 'Balayage', metadata: null, createdAt: date('2026-09-20T10:00:00.000Z') }],
      Setting: [
        { key: 'scan.ranges', value: [{ cidr: '192.0.2.0/24', label: 'bureau', enabled: true }], updatedAt: date('2026-09-20T10:00:00.000Z') },
        { key: 'setup.complete', value: true, updatedAt: date('2026-09-20T10:00:00.000Z') },
        { key: 'scan.interval', value: 5, updatedAt: date('2026-09-20T10:00:00.000Z') },
        { key: 'jwt.rotation', value: 'x', updatedAt: date('2026-09-20T10:00:00.000Z') },
        { key: `assistant.fil.${ana}`, value: [{ id: 't1', request: 'bonjour', reply: 'Salut', widgets: [], duree: 3, modele: null, voix: false, le: '2026-09-19T10:00:00.000Z' }, { id: 't2', request: 'état ?', reply: '2 appareils', widgets: [], duree: 4, modele: null, voix: false, le: '2026-09-19T10:01:00.000Z' }], updatedAt: date('2026-09-20T10:00:00.000Z') },
      ],
      NotificationConfig: [
        { id: cuid(100), channel: 'telegram', enabled: true, configEnc: chiffreV1(JSON.stringify({ token: '123456789:' + 'B'.repeat(35), chatId: '42', enabled: true })), lastTested: null, lastSuccess: null },
        { id: cuid(101), channel: 'email', enabled: true, configEnc: chiffreV1(JSON.stringify({ address: 'alertes@exemple.org', password: 'mdp-smtp-v1', provider: 'fournisseur-sans-hote' })), lastTested: null, lastSuccess: null },
        { id: cuid(102), channel: 'sms', enabled: true, configEnc: chiffreV1('{"sid":"x"}'), lastTested: null, lastSuccess: null },
      ],
      BotCommand: [{ id: cuid(110), trigger: '/Etat', description: null, action: 'status', params: null, enabled: true, confirm: false, allowedChatIds: ['42'], cooldownSec: 0, lastFiredBy: null, lastFiredAt: null, fireCount: 3, createdAt: date('2025-06-01T10:00:00.000Z'), updatedAt: date('2025-06-01T10:00:00.000Z') }],
      NotificationCommand: [{ id: cuid(120), name: 'nouveaux', enabled: true, trigger: 'device.new', filter: null, actions: [{ kind: 'notify', channels: ['telegram', 'sms'] }], template: null, cooldownSec: 0, lastFired: null, fireCount: 0, createdAt: date('2025-06-01T10:00:00.000Z'), updatedAt: date('2025-06-01T10:00:00.000Z') }],
      SecurityRule: [{ id: cuid(130), name: 'Auto-ban critical danger', enabled: false, trigger: 'dangerScore', threshold: 90, action: 'ban', exceptWhitelist: true, createdAt: date('2025-06-01T10:00:00.000Z') }],
      ScanRun: [{ id: cuid(140), type: 'full', subnet: '192.0.2.0/24', status: 'complete', hostsFound: 2, startedAt: date('2026-09-20T10:00:00.000Z'), endedAt: date('2026-09-20T10:02:00.000Z'), error: null }],
      HostMetric: [{ id: cuid(150), cpuPct: 12.5, memPct: 40, memUsedMB: 1000, memTotalMB: 2500, diskPct: 30, tempC: null, loadAvg: 0.4, netRxKBs: 1, netTxKBs: 2, uptimeSec: 100, createdAt: date('2026-09-20T10:00:00.000Z') }],
      Mailbox: [{ id: cuid(160), email: 'Rapports@exemple.org', provider: 'other', role: 'both', imapHost: 'imap.exemple.org', imapPort: 143, imapSecurity: 'none', smtpHost: 'smtp.exemple.org', smtpPort: 465, smtpSecurity: 'ssl', passwordEnc: chiffreV1('mdp-boite-v1'), active: true, lastTestAt: null, lastTestOk: null, lastTestInfo: null, createdAt: date('2025-06-01T10:00:00.000Z') }],
      TrafficFlow: [{ id: cuid(170), srcIp: '192.0.2.21', dstIp: '203.0.113.9', port: 443, proto: 'tcp', firstSeen: date('2026-09-20T10:00:00.000Z'), lastSeen: date('2026-09-20T10:05:00.000Z'), bytes: 1200, packets: 10, hits: 2, host: null, domain: null, operator: 'EXEMPLE-NET', logo: null, country: 'FR', direction: 'sortant', suspect: false, raison: null }],
      Passkey: [{ id: 'pk1' }, { id: 'pk2' }],
      IntegrationToken: [
        { id: cuid(180), name: 'script', prefix: JETON_LECTURE.slice(0, 8), hash: sha256(JETON_LECTURE), role: 'viewer', scope: 'service', createdById: ana, createdAt: date('2025-06-01T10:00:00.000Z'), lastUsedAt: null, expiresAt: null, revokedAt: null },
        { id: cuid(181), name: 'hub', prefix: JETON_OPERATEUR.slice(0, 8), hash: sha256(JETON_OPERATEUR), role: 'operator', scope: 'service', createdById: null, createdAt: date('2025-06-01T10:00:00.000Z'), lastUsedAt: null, expiresAt: null, revokedAt: null },
        { id: cuid(182), name: 'comptes', prefix: JETON_COMPTES.slice(0, 8), hash: sha256(JETON_COMPTES), role: 'operator', scope: 'accounts', createdById: ana, createdAt: date('2025-06-01T10:00:00.000Z'), lastUsedAt: null, expiresAt: null, revokedAt: null },
      ],
    },
  };
}

const cli = (env, args, entree) => spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(RACINE, 'src', 'cli.js'), ...args], {
  input: entree, encoding: 'utf8', env: { PATH: process.env.PATH, ...env }, cwd: RACINE,
});

test('reprise de la 1.4.1 : tout entre, et le service le relit', async () => {
  const dossier = dossierTemporaire();
  const env = { DATA_DIR: dossier, SOCLE_POIVRE: POIVRE_V1, MAPMYLAN_V1_MASTER_KEY: CLE_V1 };
  // Une base déjà démarrée une fois : ses règles et réglages de départ cèdent la place.
  const premier = await lancer({ ...env });
  await premier.arreter();
  const r = cli(env, ['importer-v1'], JSON.stringify(exportV1()));
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /3 compte\(s\), 1 secret\(s\) TOTP scellé\(s\)/);
  assert.match(r.stdout, /sans mot de passe réutilisable \(empreinte bcrypt\) : bruno/);
  assert.match(r.stdout, /2 clé\(s\) d’accès non reprise\(s\)/);
  assert.match(r.stdout, /1 jeton\(s\) d’intégration non repris/);
  assert.match(r.stdout, /Réglages ignorés : scan\.interval, jwt\.rotation/);
  assert.match(r.stdout, /Canaux ignorés : sms/);

  const o = await lancer({ ...env });
  try {
    const { db, s } = o;
    const compte = ident => db.prepare('SELECT * FROM socle_comptes WHERE identifiant = ?').get(ident);
    assert.equal(compte('ana').role, 'admin');
    assert.equal(compte('bruno').role, 'membre');
    assert.equal(compte('bruno').mdp, null);
    assert.equal(compte('compte-3').role, 'lecture', 'un nom qui ne passe pas devient un identifiant neutre');
    assert.equal(compte('compte-3').totp, null, 'un TOTP non activé n’est pas repris');
    assert.equal(compte('ana').courriel_verifie, 0);

    // Le mot de passe de la 1.4.1 ouvre la session, et le TOTP repris la complète.
    const c = new Client(o.port);
    const l = await connexion(c, 'ana', MDP_ANA);
    assert.equal(l.status, 200, JSON.stringify(l.json));
    assert.equal(l.json.etape, 'second');
    const t = await c.post('/api/compte/connexion/totp', { code: codeTotp(TOTP_ANA) });
    assert.equal(t.status, 200, JSON.stringify(t.json));
    assert.doesNotMatch(compte('ana').mdp, /m=32768/, 'empreinte réécrite aux paramètres actuels dès la première connexion');
    assert.equal((await connexion(new Client(o.port), 'bruno', 'nimporte quoi du tout')).status, 401);

    // Le lien de réinitialisation, remis par la ligne de commande.
    const lien = cli(env, ['lien-reinit', 'bruno']);
    assert.equal(lien.status, 0, lien.stderr);
    const jeton = /#reinit=([\w-]+)/.exec(lien.stdout)[1];
    const nouveau = 'nouvelle phrase de passe de bruno';
    assert.equal((await new Client(o.port).post('/api/compte/jeton', { usage: 'reinit', jeton, motDePasse: nouveau })).status, 200);
    assert.equal((await connexion(new Client(o.port), 'bruno', nouveau)).status, 200);

    // Inventaire, carte, historique.
    const lecture = new Client(o.port);
    const appareils = (await lecture.get('/api/devices', { entetes: { authorization: `Bearer ${JETON_LECTURE}` }, origine: null })).json;
    assert.equal(appareils.length, 2);
    const imprimante = appareils.find(d => d.ip === '192.0.2.21');
    assert.deepEqual(imprimante.tags, ['impression']);
    assert.equal(imprimante.pinned, true);
    assert.equal(imprimante.firstSeen, '2025-06-01T10:00:00.000Z');
    assert.equal(imprimante.cves.length, 1, 'le doublon de CVE est écarté');
    assert.equal(imprimante.interfaces[0].label, 'wlan0');
    assert.equal(db.prepare('SELECT COUNT(*) n FROM liens').get().n, 1);
    assert.deepEqual(db.prepare('SELECT id FROM vlans').all().map(v => v.id), [10]);
    assert.equal((await lecture.post('/api/devices/scan', {}, { entetes: { authorization: `Bearer ${JETON_LECTURE}` }, origine: null })).status, 403);
    assert.equal((await lecture.get('/api/devices', { entetes: { authorization: `Bearer ${JETON_OPERATEUR}` }, origine: null })).status, 200);
    assert.equal((await lecture.get('/api/devices', { entetes: { authorization: `Bearer ${JETON_COMPTES}` }, origine: null })).status, 401);
    assert.equal(db.prepare('SELECT createdById FROM jetons_integration WHERE name = ?').get('script').createdById, compte('ana').id);

    // Secrets rouverts par MASTER_KEY, rescellés par le coffre du socle.
    const equipement = db.prepare('SELECT * FROM equipements').get();
    assert.equal(s.equipements.ouvrir(equipement, 'passwordEnc'), 'mot-de-passe-ssh-v1');
    assert.equal(equipement.cleHote, null, 'aucune clé d’hôte n’était épinglée : à confirmer');
    assert.equal(s.notifications.config('telegram').token, '123456789:' + 'B'.repeat(35));
    assert.equal(s.notifications.config('telegram').enabled, undefined);
    assert.equal(s.notifications.config('email').provider, 'apple', 'le préréglage sans hôte de la 1.4.1');
    assert.equal(db.prepare("SELECT COUNT(*) n FROM canaux WHERE channel = 'sms'").get().n, 0);
    const boite = db.prepare('SELECT * FROM boites').get();
    assert.equal(boite.email, 'rapports@exemple.org');
    assert.equal(boite.imapSecurity, 'starttls', 'plus d’identifiants en clair');
    assert.equal(s.coffre.ouvre('boite', boite.passwordEnc, `${boite.id}:password`), 'mdp-boite-v1');
    for (const table of ['equipements', 'canaux', 'boites']) {
      const brut = JSON.stringify(db.prepare(`SELECT * FROM ${table}`).all());
      for (const secret of ['mot-de-passe-ssh-v1', 'mdp-smtp-v1', 'mdp-boite-v1', 'B'.repeat(35)]) assert.ok(!brut.includes(secret), `${secret} en clair dans ${table}`);
    }

    // Réglages, règles, commandes, fil de l'assistant.
    assert.deepEqual(s.reglages.lire('scan.ranges'), [{ cidr: '192.0.2.0/24', label: 'bureau', enabled: true }]);
    assert.equal(s.reglages.lire('jwt.rotation'), undefined);
    assert.deepEqual(db.prepare('SELECT name, enabled FROM regles').all().map(l => ({ ...l })), [{ name: 'Auto-ban critical danger', enabled: 0 }], 'les règles de la 1.4.1 remplacent celles de départ');
    assert.deepEqual(JSON.parse(db.prepare('SELECT actions FROM commandes').get().actions), [{ kind: 'notify', channels: ['telegram'] }]);
    assert.equal(db.prepare('SELECT trigger FROM commandes_bot').get().trigger, '/etat');
    assert.deepEqual(s.assistant.fil(compte('ana').id).map(t => t.request), ['bonjour', 'état ?']);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM socle_journal WHERE action = 'migration.v1'").get().n, 1);

    // Une seconde reprise dans une base qui n'est plus neuve est refusée.
    const encore = cli(env, ['importer-v1'], JSON.stringify(exportV1()));
    assert.equal(encore.status, 1);
    assert.match(encore.stderr, /base neuve/);
  } finally { await o.arreter(); }
});

test('reprise de la 1.4.1 : tout ou rien, et un export d’une autre origine est refusé', async () => {
  const env = { DATA_DIR: dossierTemporaire(), MAPMYLAN_V1_MASTER_KEY: CLE_V1, SOCLE_POIVRE: POIVRE_V1 };
  const e = exportV1();
  e.tables.Device[1].ip = null;
  const r = cli(env, ['importer-v1'], JSON.stringify(e));
  assert.equal(r.status, 1);
  assert.match(r.stderr, /NOT NULL/);
  const o = await lancer(env);
  try {
    assert.equal(o.db.prepare('SELECT COUNT(*) n FROM socle_comptes').get().n, 0, 'aucun compte n’est resté de la tentative');
    assert.equal(o.db.prepare('SELECT COUNT(*) n FROM appareils').get().n, 0);
  } finally { await o.arreter(); }
  const autre = cli({ DATA_DIR: dossierTemporaire() }, ['importer-v1'], JSON.stringify({ tables: {} }));
  assert.equal(autre.status, 1);
  assert.match(autre.stderr, /exporter-v1\.sh/);
  const sansCle = cli({ DATA_DIR: dossierTemporaire(), SOCLE_POIVRE: POIVRE_V1 }, ['importer-v1'], JSON.stringify(exportV1()));
  assert.equal(sansCle.status, 0, sansCle.stderr);
  assert.match(sansCle.stdout, /secret\(s\) laissé\(s\) de côté faute de MAPMYLAN_V1_MASTER_KEY/);
});
