// Reprise des données de MapMyLAN 1.4.1 (PostgreSQL) dans une base 2.0 neuve.
//
// L'export vient de outils/exporter-v1.sh : un objet JSON, une entrée par
// table Prisma. Tout entre en une seule transaction, ou rien.
//
// Comptes : les empreintes Argon2id de la 1.4.1 sont au format que le socle
// relit (poivre HMAC-SHA256 compris : SOCLE_POIVRE ou SOCLE_POIVRE_ANCIEN doit
// valoir l'ancien PASSWORD_PEPPER). Une empreinte bcrypt, plus ancienne, ne
// se relit pas : le compte arrive sans mot de passe et on lui remet un lien
// de réinitialisation (node src/cli.js lien-reinit <identifiant>). Les secrets
// TOTP, en clair en 1.4.1, sont scellés. Les clés d'accès ne sont pas reprises :
// elles étaient liées à l'origine de l'ancienne interface, chacun en recrée une.
//
// Secrets d'équipement, de boîte mail et de canaux : chiffrés en 1.4.1 par
// MASTER_KEY. Avec cette clé (MAPMYLAN_V1_MASTER_KEY), ils sont rouverts puis
// rescellés par le coffre du socle ; sans elle, ils sont laissés de côté.
// Aucune clé d'hôte SSH ni aucun certificat n'était épinglé en 1.4.1 : chaque
// équipement repris doit être réenregistré pour confirmer son empreinte.
import crypto from 'node:crypto';
import { normaliseIdentifiant } from '../socle/src/comptes.js';
import { CLES } from './reglages.js';
import { CANAUX } from './notifications.js';
import { valider } from '../socle/src/index.js';

const ROLES = { admin: 'admin', operator: 'membre', viewer: 'lecture' };
const IDENTIFIANT = /^[\p{L}\p{N}._@+-]{3,64}$/u;
const FIL = /^assistant\.fil\.(.+)$/;

// Les dates de Prisma sortent sans fuseau : elles sont en UTC.
const instant = v => {
  if (v === null || v === undefined || v === '') return null;
  const t = Date.parse(/[zZ]|[+-]\d{2}:?\d{2}$/.test(String(v)) ? v : `${v}Z`);
  return Number.isFinite(t) ? t : null;
};
const bool = v => (v === true || v === 't' || v === 1 ? 1 : 0);
const json = v => (v === null || v === undefined ? null : typeof v === 'string' ? v : JSON.stringify(v));
const texte = (v, max = 4000) => (v === null || v === undefined ? null : String(v).slice(0, max));

// Le chiffrement de la 1.4.1 : AES-256-GCM, clé = SHA-256(MASTER_KEY), iv 12 + étiquette 16.
export function dechiffreurV1(cle) {
  if (!cle) return null;
  const k = crypto.createHash('sha256').update(cle).digest();
  return enc => {
    if (!enc) return null;
    const b = Buffer.from(String(enc), 'base64');
    const d = crypto.createDecipheriv('aes-256-gcm', k, b.subarray(0, 12));
    d.setAuthTag(b.subarray(12, 28));
    return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8');
  };
}

export function lireExport(brut) {
  let e;
  try { e = JSON.parse(brut); } catch { throw new Error('Export illisible : JSON attendu (outils/exporter-v1.sh).'); }
  if (e?.format !== 'mapmylan-v1' || !e.tables || typeof e.tables !== 'object') throw new Error('Export inattendu : il ne vient pas de outils/exporter-v1.sh.');
  for (const [t, l] of Object.entries(e.tables)) if (l !== null && !Array.isArray(l)) throw new Error(`Table ${t} : liste attendue.`);
  return e;
}

/**
 * db : base 2.0 ouverte ; comptes, coffre, journal : ceux du socle.
 * Rend le bilan (comptes à réinitialiser compris). Lève sans rien écrire si
 * la base n'est pas neuve ou si une ligne ne passe pas.
 */
export function importerV1({ db, comptes, coffre, journal, export: e, cleV1 = null }) {
  const T = nom => e.tables[nom] || [];
  if (db.prepare('SELECT 1 FROM socle_comptes LIMIT 1').get() || db.prepare('SELECT 1 FROM appareils LIMIT 1').get()) {
    throw new Error('La base 2.0 contient déjà des comptes ou des appareils : la reprise se fait dans une base neuve.');
  }
  const ouvrirV1 = dechiffreurV1(cleV1);
  const bilan = { comptes: 0, sansMotDePasse: [], totp: 0, clesNonReprises: T('Passkey').length, secretsLaisses: 0, jetonsIgnores: 0, reglagesIgnores: [], canauxIgnores: [], boitesARevoir: 0, lignes: {} };
  const rouvrir = (enc, quoi) => {
    if (!enc) return null;
    if (!ouvrirV1) { bilan.secretsLaisses++; return null; }
    try { return ouvrirV1(enc); } catch { throw new Error(`${quoi} : MAPMYLAN_V1_MASTER_KEY ne rouvre pas ce secret (clé différente de MASTER_KEY ?).`); }
  };
  const inserer = (table, colonnes, lignes, { ignorer = false } = {}) => {
    const st = db.prepare(`INSERT ${ignorer ? 'OR IGNORE ' : ''}INTO ${table}(${colonnes.join(', ')}) VALUES(${colonnes.map(() => '?').join(', ')})`);
    let n = 0;
    for (const l of lignes) n += st.run(...l).changes;
    bilan.lignes[table] = (bilan.lignes[table] || 0) + n;
  };

  db.exec('BEGIN IMMEDIATE');
  try {
    // L'amorçage d'une base neuve (règles, réglages de départ) cède la place à l'ancien.
    db.exec('DELETE FROM regles; DELETE FROM reglages;');

    const compteDe = new Map();
    T('User').forEach((u, rang) => {
      let ident = normaliseIdentifiant(u.username).replace(/[^\p{L}\p{N}._@+-]/gu, '-').slice(0, 64);
      if (!IDENTIFIANT.test(ident) || comptes.parIdentifiant(ident)) ident = `compte-${rang + 1}`;
      const c = comptes.creerCompte({ identifiant: ident, affichage: String(u.username).slice(0, 80), role: ROLES[u.role] || 'lecture' });
      const argon = /^\$argon2id\$/.test(String(u.password || ''));
      if (!argon) bilan.sansMotDePasse.push(ident);
      const totp = u.totpEnabled && u.totpSecret ? coffre.scelle('totp', String(u.totpSecret).replace(/\s/g, '').toUpperCase(), c.id) : null;
      if (totp) bilan.totp++;
      db.prepare('UPDATE socle_comptes SET mdp = ?, totp = ?, cree = ?, derniere = ?, courriel = ?, courriel_verifie = 0 WHERE id = ?')
        .run(argon ? u.password : null, totp, instant(u.createdAt) ?? Date.now(), instant(u.lastLogin), u.email ? String(u.email).slice(0, 254) : null, c.id);
      compteDe.set(u.id, c.id);
      bilan.comptes++;
    });

    inserer('appareils', ['id', 'ip', 'mac', 'hostname', 'customName', 'vendor', 'model', 'os', 'type', 'customType', 'vlan', 'zone', 'tags', 'notes', 'role', 'status',
      'trustScore', 'activityScore', 'vulnScore', 'dangerScore', 'scoreReasons', 'whitelisted', 'isMainRouter', 'posX', 'posY', 'pinned', 'firstSeen', 'lastSeen', 'metadata'],
    T('Device').map(d => [d.id, d.ip, d.mac, d.hostname, d.customName, d.vendor, d.model, d.os, d.type || 'unknown', d.customType, d.vlan, d.zone, JSON.stringify(Array.isArray(d.tags) ? d.tags : []), d.notes, d.role, d.status || 'online',
      d.trustScore ?? 50, d.activityScore ?? 0, d.vulnScore ?? 0, d.dangerScore ?? 0, json(d.scoreReasons), bool(d.whitelisted), bool(d.isMainRouter), d.posX, d.posY, bool(d.pinned),
      instant(d.firstSeen) ?? Date.now(), instant(d.lastSeen) ?? Date.now(), json(d.metadata)]));
    inserer('interfaces', ['id', 'deviceId', 'mac', 'ip', 'type', 'label', 'posX', 'posY', 'isPrimary', 'createdAt'],
      T('Interface').map(i => [i.id, i.deviceId, i.mac, i.ip, i.type || 'ethernet', i.label, i.posX, i.posY, bool(i.isPrimary), instant(i.createdAt) ?? Date.now()]));
    inserer('ports', ['id', 'deviceId', 'port', 'protocol', 'state', 'service', 'product', 'version', 'detectedAt'],
      T('Port').map(p => [p.id, p.deviceId, p.port, p.protocol, p.state, p.service, p.product, p.version, instant(p.detectedAt) ?? Date.now()]));
    // La 1.4.1 n'interdisait pas deux fois le même CVE sur un appareil : on garde le premier.
    inserer('cves', ['id', 'deviceId', 'cveId', 'cvss', 'severity', 'description', 'service', 'detectedAt'],
      T('CveMatch').map(c => [c.id, c.deviceId, c.cveId, c.cvss, c.severity, c.description, c.service, instant(c.detectedAt) ?? Date.now()]), { ignorer: true });
    inserer('historique', ['id', 'deviceId', 'event', 'data', 'createdAt'],
      T('DeviceHistory').map(h => [h.id, h.deviceId, h.event, json(h.data) || '{}', instant(h.createdAt) ?? Date.now()]));
    inserer('liens', ['id', 'fromId', 'toId', 'fromIfaceId', 'toIfaceId', 'type', 'speed', 'vlan', 'manual', 'createdAt'],
      T('TopologyLink').map(l => [l.id, l.fromId, l.toId, l.fromIfaceId, l.toIfaceId, l.type || 'ethernet', l.speed, l.vlan, bool(l.manual), instant(l.createdAt) ?? Date.now()]), { ignorer: true });
    inserer('zones', ['id', 'name', 'color', 'x', 'y', 'width', 'height', 'notes', 'createdAt'],
      T('Zone').map(z => [z.id, z.name, z.color || '#38bdf8', z.x, z.y, z.width ?? 200, z.height ?? 150, z.notes, instant(z.createdAt) ?? Date.now()]));
    inserer('vlans', ['id', 'name', 'subnet', 'description', 'color', 'isolated', 'gateway', 'networkId', 'createdAt'],
      T('Vlan').filter(v => Number.isInteger(v.id) && v.id >= 1 && v.id <= 4094).map(v => [v.id, v.name, v.subnet, v.description, v.color || '#38bdf8', bool(v.isolated), v.gateway, v.networkId, instant(v.createdAt) ?? Date.now()]));

    const equipements = T('SshDevice').map(d => {
      const sceller = (champ, enc) => {
        const clair = rouvrir(enc, `Équipement ${d.name}`);
        return clair ? coffre.scelle('equipement', clair, `${d.id}:${champ}`) : null;
      };
      return [d.id, d.name, d.host, d.port ?? 22, d.username, sceller('passwordEnc', d.passwordEnc), sceller('privateKeyEnc', d.privateKeyEnc), sceller('passphraseEnc', d.passphraseEnc),
        d.vendor || 'generic', d.transport || 'ssh', d.apiBaseUrl, d.site, bool(d.verifyTls), bool(d.isMainRouter), instant(d.lastConnected),
        d.lastTestOk === null || d.lastTestOk === undefined ? null : bool(d.lastTestOk), instant(d.lastTestAt), texte(d.lastTestInfo, 300), instant(d.createdAt) ?? Date.now()];
    });
    inserer('equipements', ['id', 'name', 'host', 'port', 'username', 'passwordEnc', 'privateKeyEnc', 'passphraseEnc', 'vendor', 'transport', 'apiBaseUrl', 'site', 'verifyTls', 'isMainRouter',
      'lastConnected', 'lastTestOk', 'lastTestAt', 'lastTestInfo', 'createdAt'], equipements);

    inserer('alertes', ['id', 'severity', 'source', 'message', 'deviceId', 'deviceIp', 'deviceMac', 'acknowledged', 'metadata', 'createdAt'],
      T('Alert').map(a => [a.id, a.severity, a.source, a.message, a.deviceId, a.deviceIp, a.deviceMac, bool(a.acknowledged), json(a.metadata), instant(a.createdAt) ?? Date.now()]));
    inserer('journal_service', ['id', 'level', 'source', 'message', 'metadata', 'createdAt'],
      T('LogEntry').map(l => [l.id, ['info', 'warn', 'error', 'success'].includes(l.level) ? l.level : 'info', l.source, l.message, json(l.metadata), instant(l.createdAt) ?? Date.now()]));

    // Réglages : seulement les clés connues, dont la valeur passe le schéma.
    // Le fil de l'assistant, rangé là en 1.4.1, rejoint son compte.
    for (const r of T('Setting')) {
      const fil = FIL.exec(r.key);
      if (fil) {
        const compte = compteDe.get(fil[1]);
        const tours = Array.isArray(r.value) ? r.value : [];
        if (!compte) { bilan.reglagesIgnores.push('assistant.fil (compte inconnu)'); continue; }
        const t0 = Date.now() - tours.length;
        inserer('assistant_tours', ['id', 'compte', 't', 'tour'], tours.filter(x => x && typeof x === 'object').map((x, i) => [crypto.randomBytes(12).toString('base64url'), compte, instant(x.le) ?? t0 + i, JSON.stringify(x)]));
        continue;
      }
      const def = CLES[r.key];
      let ok = !!def;
      if (ok) {
        try { const { value } = valider({ value: r.value }, { value: def.schema }); ok = !def.controle || def.controle(value) === true; } catch {
          ok = false; // valeur que la 1.4.1 acceptait sans contrôle : ignorée et signalée au bilan
        }
      }
      if (!ok) { bilan.reglagesIgnores.push(String(r.key).slice(0, 60)); continue; }
      inserer('reglages', ['key', 'value', 'updatedAt'], [[r.key, JSON.stringify(r.value), instant(r.updatedAt) ?? Date.now()]]);
    }

    for (const c of T('NotificationConfig')) {
      if (!CANAUX.includes(c.channel)) { bilan.canauxIgnores.push(String(c.channel).slice(0, 20)); continue; }
      const clair = rouvrir(c.configEnc, `Canal ${c.channel}`);
      let config = null;
      if (clair) {
        const v = JSON.parse(clair);
        delete v.enabled;
        // La 1.4.1 ne connaissait que trois préréglages SMTP : un fournisseur
        // sans hôte saisi ne peut être que celui qui s'appelle « apple » ici.
        if (c.channel === 'email' && !['gmail', 'outlook'].includes(v.provider)) v.provider = v.host ? 'autre' : 'apple';
        config = coffre.scelle('canal', JSON.stringify(v), c.channel);
      }
      inserer('canaux', ['id', 'channel', 'enabled', 'configEnc', 'lastTested', 'lastSuccess'], [[c.id, c.channel, config ? bool(c.enabled) : 0, config, instant(c.lastTested), instant(c.lastSuccess)]]);
    }

    inserer('commandes_bot', ['id', 'trigger', 'description', 'action', 'params', 'enabled', 'confirm', 'allowedChatIds', 'cooldownSec', 'lastFiredBy', 'lastFiredAt', 'fireCount', 'createdAt', 'updatedAt'],
      T('BotCommand').map(b => [b.id, String(b.trigger).toLowerCase(), b.description, b.action, json(b.params), bool(b.enabled), bool(b.confirm), JSON.stringify((b.allowedChatIds || []).map(String)),
        b.cooldownSec ?? 0, b.lastFiredBy, instant(b.lastFiredAt), b.fireCount ?? 0, instant(b.createdAt) ?? Date.now(), instant(b.updatedAt) ?? Date.now()]));
    // Le SMS n'existe plus : il sort des actions « notifier ».
    inserer('commandes', ['id', 'name', 'enabled', 'trigger', 'filter', 'actions', 'template', 'cooldownSec', 'lastFired', 'fireCount', 'createdAt', 'updatedAt'],
      T('NotificationCommand').map(c => [c.id, c.name, bool(c.enabled), c.trigger, json(c.filter),
        JSON.stringify((Array.isArray(c.actions) ? c.actions : []).map(a => (a?.kind === 'notify' ? { ...a, channels: (a.channels || []).filter(x => CANAUX.includes(x)) } : a))),
        c.template, c.cooldownSec ?? 0, instant(c.lastFired), c.fireCount ?? 0, instant(c.createdAt) ?? Date.now(), instant(c.updatedAt) ?? Date.now()]));
    inserer('regles', ['id', 'name', 'enabled', 'trigger', 'threshold', 'action', 'exceptWhitelist', 'createdAt'],
      T('SecurityRule').map(r => [r.id, r.name, bool(r.enabled), r.trigger, r.threshold, r.action, bool(r.exceptWhitelist), instant(r.createdAt) ?? Date.now()]));
    inserer('balayages', ['id', 'type', 'subnet', 'status', 'hostsFound', 'startedAt', 'endedAt', 'error'],
      T('ScanRun').map(b => [b.id, b.type, b.subnet, b.status, b.hostsFound ?? 0, instant(b.startedAt) ?? Date.now(), instant(b.endedAt), b.error]));
    inserer('mesures_hote', ['id', 'cpuPct', 'memPct', 'memUsedMB', 'memTotalMB', 'diskPct', 'tempC', 'loadAvg', 'netRxKBs', 'netTxKBs', 'uptimeSec', 'createdAt'],
      T('HostMetric').map(m => [m.id, m.cpuPct, m.memPct, m.memUsedMB, m.memTotalMB, m.diskPct, m.tempC, m.loadAvg, m.netRxKBs, m.netTxKBs, m.uptimeSec, instant(m.createdAt) ?? Date.now()]));

    // Plus d'identifiants en clair vers une boîte : « none » devient STARTTLS exigé.
    const securite = v => (v === 'ssl' || v === 'starttls' ? v : v ? (bilan.boitesARevoir++, 'starttls') : null);
    inserer('boites', ['id', 'email', 'provider', 'role', 'imapHost', 'imapPort', 'imapSecurity', 'smtpHost', 'smtpPort', 'smtpSecurity', 'passwordEnc', 'active', 'lastTestAt', 'lastTestOk', 'lastTestInfo', 'createdAt'],
      T('Mailbox').map(b => {
        const mdp = rouvrir(b.passwordEnc, `Boîte ${b.email}`);
        return [b.id, String(b.email).toLowerCase(), b.provider || 'other', b.role || 'both', b.imapHost, b.imapPort, securite(b.imapSecurity), b.smtpHost, b.smtpPort, securite(b.smtpSecurity),
          mdp ? coffre.scelle('boite', mdp, `${b.id}:password`) : null, bool(b.active), instant(b.lastTestAt), b.lastTestOk === null || b.lastTestOk === undefined ? null : bool(b.lastTestOk), texte(b.lastTestInfo, 300), instant(b.createdAt) ?? Date.now()];
      }));
    inserer('flux_trafic', ['id', 'srcIp', 'dstIp', 'port', 'proto', 'firstSeen', 'lastSeen', 'bytes', 'packets', 'hits', 'host', 'domain', 'operator', 'logo', 'country', 'direction', 'suspect', 'raison'],
      T('TrafficFlow').map(f => [f.id, f.srcIp, f.dstIp, f.port ?? 0, f.proto || 'tcp', instant(f.firstSeen) ?? Date.now(), instant(f.lastSeen) ?? Date.now(), f.bytes ?? 0, f.packets ?? 0, f.hits ?? 1,
        f.host, f.domain, f.operator, f.logo, f.country, f.direction || 'sortant', bool(f.suspect), f.raison]), { ignorer: true });

    // Un jeton de portée « comptes » n'a plus d'objet : un jeton ne gère jamais les comptes.
    const jetons = T('IntegrationToken').filter(j => (j.scope || 'service') === 'service' && ROLES[j.role] && ROLES[j.role] !== 'admin');
    bilan.jetonsIgnores = T('IntegrationToken').length - jetons.length;
    inserer('jetons_integration', ['id', 'name', 'prefix', 'hash', 'role', 'createdById', 'createdAt', 'lastUsedAt', 'expiresAt', 'revokedAt'],
      jetons.map(j => [j.id, j.name, j.prefix, j.hash, ROLES[j.role], compteDe.get(j.createdById) || null, instant(j.createdAt) ?? Date.now(), instant(j.lastUsedAt), instant(j.expiresAt), instant(j.revokedAt)]));

    journal.ecrire({ acteur: null, action: 'migration.v1', details: { comptes: bilan.comptes, aReinitialiser: bilan.sansMotDePasse.length, appareils: bilan.lignes.appareils || 0, secretsLaisses: bilan.secretsLaisses } });
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return bilan;
}
