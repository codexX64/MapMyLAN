// Base de MapMyLAN : node:sqlite, un fichier dans le volume de données.
//
// Le schéma reprend les modèles de la 1.4.1 (Prisma sur Postgres) sous des
// noms de tables français ; les colonnes gardent les noms des champs JSON
// de l'API, ce qui rend la conversion d'une ligne triviale. Les comptes, les
// facteurs et les sessions ne sont plus ici : ils vivent dans les tables du
// socle (socle_*). Les dates sont des millisecondes, rendues en ISO par
// formes.js. Chaque évolution du schéma est une migration numérotée, jouée
// une fois, dans une transaction.
import { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

// Identifiant public : 96 bits aléatoires, jamais un compteur (SEC-AUTHZ-006).
export const nouvelId = () => crypto.randomBytes(12).toString('base64url');
// Les identifiants repris de la 1.4.1 (cuid, 25 caractères) restent valables.
export const ID = /^[A-Za-z0-9_-]{6,80}$/;

const MIGRATIONS = [
  // 1 : les modèles de la 1.4.1.
  db => db.exec(`
    CREATE TABLE appareils (
      id TEXT PRIMARY KEY, ip TEXT NOT NULL, mac TEXT UNIQUE, hostname TEXT, customName TEXT, vendor TEXT, model TEXT, os TEXT,
      type TEXT NOT NULL DEFAULT 'unknown', customType TEXT, vlan INTEGER, zone TEXT, tags TEXT NOT NULL DEFAULT '[]', notes TEXT, role TEXT,
      status TEXT NOT NULL DEFAULT 'online',
      trustScore INTEGER NOT NULL DEFAULT 50, activityScore INTEGER NOT NULL DEFAULT 0, vulnScore INTEGER NOT NULL DEFAULT 0,
      dangerScore INTEGER NOT NULL DEFAULT 0, scoreReasons TEXT,
      whitelisted INTEGER NOT NULL DEFAULT 0, isMainRouter INTEGER NOT NULL DEFAULT 0,
      posX REAL, posY REAL, pinned INTEGER NOT NULL DEFAULT 0,
      firstSeen INTEGER NOT NULL, lastSeen INTEGER NOT NULL, metadata TEXT);
    CREATE INDEX appareils_ip ON appareils(ip);
    CREATE INDEX appareils_etat ON appareils(status);
    CREATE INDEX appareils_danger ON appareils(dangerScore);
    CREATE INDEX appareils_vu ON appareils(lastSeen);

    CREATE TABLE interfaces (
      id TEXT PRIMARY KEY, deviceId TEXT NOT NULL REFERENCES appareils(id) ON DELETE CASCADE,
      mac TEXT UNIQUE, ip TEXT, type TEXT NOT NULL DEFAULT 'ethernet', label TEXT, posX REAL, posY REAL,
      isPrimary INTEGER NOT NULL DEFAULT 0, createdAt INTEGER NOT NULL);
    CREATE INDEX interfaces_appareil ON interfaces(deviceId);

    CREATE TABLE ports (
      id TEXT PRIMARY KEY, deviceId TEXT NOT NULL REFERENCES appareils(id) ON DELETE CASCADE,
      port INTEGER NOT NULL, protocol TEXT NOT NULL, state TEXT NOT NULL, service TEXT, product TEXT, version TEXT,
      detectedAt INTEGER NOT NULL, UNIQUE(deviceId, port, protocol));

    CREATE TABLE cves (
      id TEXT PRIMARY KEY, deviceId TEXT NOT NULL REFERENCES appareils(id) ON DELETE CASCADE,
      cveId TEXT NOT NULL, cvss REAL NOT NULL, severity TEXT NOT NULL, description TEXT NOT NULL, service TEXT,
      detectedAt INTEGER NOT NULL, UNIQUE(deviceId, cveId));

    CREATE TABLE historique (
      id TEXT PRIMARY KEY, deviceId TEXT NOT NULL REFERENCES appareils(id) ON DELETE CASCADE,
      event TEXT NOT NULL, data TEXT NOT NULL DEFAULT '{}', createdAt INTEGER NOT NULL);
    CREATE INDEX historique_appareil ON historique(deviceId, createdAt);

    CREATE TABLE liens (
      id TEXT PRIMARY KEY,
      fromId TEXT NOT NULL REFERENCES appareils(id) ON DELETE CASCADE,
      toId TEXT NOT NULL REFERENCES appareils(id) ON DELETE CASCADE,
      fromIfaceId TEXT, toIfaceId TEXT, type TEXT NOT NULL DEFAULT 'ethernet', speed TEXT, vlan TEXT,
      manual INTEGER NOT NULL DEFAULT 0, createdAt INTEGER NOT NULL);
    -- Deux interfaces nulles valent la même chose ici : un lien ne se double pas.
    CREATE UNIQUE INDEX liens_uniques ON liens(fromId, toId, COALESCE(fromIfaceId, ''), COALESCE(toIfaceId, ''));
    CREATE INDEX liens_vers ON liens(toId);

    CREATE TABLE zones (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, color TEXT NOT NULL DEFAULT '#38bdf8',
      x REAL NOT NULL, y REAL NOT NULL, width REAL NOT NULL DEFAULT 200, height REAL NOT NULL DEFAULT 150,
      notes TEXT, createdAt INTEGER NOT NULL);

    CREATE TABLE vlans (
      id INTEGER PRIMARY KEY CHECK (id BETWEEN 1 AND 4094), name TEXT NOT NULL, subnet TEXT NOT NULL, description TEXT,
      color TEXT NOT NULL DEFAULT '#38bdf8', isolated INTEGER NOT NULL DEFAULT 0, gateway TEXT, networkId TEXT,
      createdAt INTEGER NOT NULL);

    -- Équipements pilotés (routeur principal et consoles SSH). Les secrets
    -- sont scellés par le coffre du socle ; la clé d'hôte SSH et le
    -- certificat TLS vus à l'enregistrement sont épinglés ici.
    CREATE TABLE equipements (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, host TEXT NOT NULL, port INTEGER NOT NULL DEFAULT 22, username TEXT NOT NULL,
      passwordEnc TEXT, privateKeyEnc TEXT, passphraseEnc TEXT,
      vendor TEXT NOT NULL DEFAULT 'generic', transport TEXT NOT NULL DEFAULT 'ssh', apiBaseUrl TEXT, site TEXT,
      verifyTls INTEGER NOT NULL DEFAULT 0, isMainRouter INTEGER NOT NULL DEFAULT 0,
      cleHote TEXT, empreinteHote TEXT, certificatTls TEXT, empreinteTls TEXT,
      lastConnected INTEGER, lastTestOk INTEGER, lastTestAt INTEGER, lastTestInfo TEXT, createdAt INTEGER NOT NULL);

    CREATE TABLE alertes (
      id TEXT PRIMARY KEY, severity TEXT NOT NULL, source TEXT NOT NULL, message TEXT NOT NULL,
      deviceId TEXT, deviceIp TEXT, deviceMac TEXT, acknowledged INTEGER NOT NULL DEFAULT 0, metadata TEXT,
      createdAt INTEGER NOT NULL);
    CREATE INDEX alertes_date ON alertes(createdAt);
    CREATE INDEX alertes_gravite ON alertes(severity);

    CREATE TABLE journal_service (
      id TEXT PRIMARY KEY, level TEXT NOT NULL, source TEXT NOT NULL, message TEXT NOT NULL, metadata TEXT,
      createdAt INTEGER NOT NULL);
    CREATE INDEX journal_service_date ON journal_service(createdAt);

    CREATE TABLE reglages (key TEXT PRIMARY KEY, value TEXT NOT NULL, updatedAt INTEGER NOT NULL);

    CREATE TABLE canaux (
      id TEXT PRIMARY KEY, channel TEXT NOT NULL UNIQUE, enabled INTEGER NOT NULL DEFAULT 0, configEnc TEXT,
      lastTested INTEGER, lastSuccess INTEGER);

    CREATE TABLE commandes_bot (
      id TEXT PRIMARY KEY, trigger TEXT NOT NULL UNIQUE, description TEXT, action TEXT NOT NULL, params TEXT,
      enabled INTEGER NOT NULL DEFAULT 1, confirm INTEGER NOT NULL DEFAULT 0, allowedChatIds TEXT NOT NULL DEFAULT '[]',
      cooldownSec INTEGER NOT NULL DEFAULT 0, lastFiredBy TEXT, lastFiredAt INTEGER, fireCount INTEGER NOT NULL DEFAULT 0,
      createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL);

    CREATE TABLE commandes (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, trigger TEXT NOT NULL, filter TEXT,
      actions TEXT NOT NULL DEFAULT '[]', template TEXT, cooldownSec INTEGER NOT NULL DEFAULT 0, lastFired INTEGER,
      fireCount INTEGER NOT NULL DEFAULT 0, createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL);
    CREATE INDEX commandes_declencheur ON commandes(trigger, enabled);

    CREATE TABLE regles (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, trigger TEXT NOT NULL, threshold REAL,
      action TEXT NOT NULL, exceptWhitelist INTEGER NOT NULL DEFAULT 1, createdAt INTEGER NOT NULL);

    CREATE TABLE balayages (
      id TEXT PRIMARY KEY, type TEXT NOT NULL, subnet TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'running',
      hostsFound INTEGER NOT NULL DEFAULT 0, startedAt INTEGER NOT NULL, endedAt INTEGER, error TEXT);
    CREATE INDEX balayages_debut ON balayages(startedAt);

    CREATE TABLE mesures_hote (
      id TEXT PRIMARY KEY, cpuPct REAL NOT NULL, memPct REAL NOT NULL, memUsedMB INTEGER NOT NULL, memTotalMB INTEGER NOT NULL,
      diskPct REAL NOT NULL, tempC REAL, loadAvg REAL NOT NULL, netRxKBs REAL NOT NULL, netTxKBs REAL NOT NULL,
      uptimeSec INTEGER NOT NULL, createdAt INTEGER NOT NULL);
    CREATE INDEX mesures_hote_date ON mesures_hote(createdAt);

    CREATE TABLE boites (
      id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, provider TEXT NOT NULL DEFAULT 'other', role TEXT NOT NULL DEFAULT 'both',
      imapHost TEXT, imapPort INTEGER, imapSecurity TEXT, smtpHost TEXT, smtpPort INTEGER, smtpSecurity TEXT,
      passwordEnc TEXT, active INTEGER NOT NULL DEFAULT 1, lastTestAt INTEGER, lastTestOk INTEGER, lastTestInfo TEXT,
      createdAt INTEGER NOT NULL);

    CREATE TABLE flux_trafic (
      id TEXT PRIMARY KEY, srcIp TEXT NOT NULL, dstIp TEXT NOT NULL, port INTEGER NOT NULL DEFAULT 0, proto TEXT NOT NULL DEFAULT 'tcp',
      firstSeen INTEGER NOT NULL, lastSeen INTEGER NOT NULL, bytes REAL NOT NULL DEFAULT 0, packets REAL NOT NULL DEFAULT 0,
      hits INTEGER NOT NULL DEFAULT 1, host TEXT, domain TEXT, operator TEXT, logo TEXT, country TEXT,
      direction TEXT NOT NULL DEFAULT 'sortant', suspect INTEGER NOT NULL DEFAULT 0, raison TEXT,
      UNIQUE(srcIp, dstIp, port, proto));
    CREATE INDEX flux_trafic_vu ON flux_trafic(lastSeen);
    CREATE INDEX flux_trafic_destination ON flux_trafic(dstIp);

    -- Le jeton n'est jamais gardé : son empreinte SHA-256 seulement.
    CREATE TABLE jetons_integration (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, prefix TEXT NOT NULL, hash TEXT NOT NULL UNIQUE, role TEXT NOT NULL,
      createdById TEXT REFERENCES socle_comptes(id) ON DELETE SET NULL, createdAt INTEGER NOT NULL,
      lastUsedAt INTEGER, expiresAt INTEGER, revokedAt INTEGER);
    CREATE INDEX jetons_revoques ON jetons_integration(revokedAt);

    -- Le fil de l'assistant, par compte ; il part avec le compte.
    CREATE TABLE assistant_tours (
      id TEXT PRIMARY KEY, compte TEXT NOT NULL REFERENCES socle_comptes(id) ON DELETE CASCADE,
      t INTEGER NOT NULL, tour TEXT NOT NULL);
    CREATE INDEX assistant_tours_compte ON assistant_tours(compte, t);

    CREATE TABLE quotas_ia (qui TEXT NOT NULL, jour TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (qui, jour));`),
];

function migrer(db) {
  db.exec('CREATE TABLE IF NOT EXISTS meta (cle TEXT PRIMARY KEY, valeur TEXT NOT NULL)');
  const actuelle = Number(db.prepare("SELECT valeur FROM meta WHERE cle = 'schema'").get()?.valeur || 0);
  if (actuelle > MIGRATIONS.length) throw new Error(`Base écrite par une version plus récente (schéma ${actuelle}) : mets MapMyLAN à jour.`);
  for (let v = actuelle; v < MIGRATIONS.length; v++) {
    db.exec('BEGIN IMMEDIATE');
    try {
      MIGRATIONS[v](db);
      db.prepare("INSERT INTO meta(cle, valeur) VALUES('schema', ?) ON CONFLICT(cle) DO UPDATE SET valeur = excluded.valeur").run(String(v + 1));
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
  }
}

// Lisible par le service seul : la base garde les secrets scellés des
// équipements et l'historique du réseau. SQLite donne aux fichiers WAL les
// droits de la base ; ceux d'une base existante sont resserrés au passage.
export function ouvrirBase(dossier, nom = 'mapmylan.db') {
  fs.mkdirSync(dossier, { recursive: true, mode: 0o700 });
  const fichier = path.join(dossier, nom);
  fs.closeSync(fs.openSync(fichier, 'a', 0o600));
  for (const f of [fichier, fichier + '-wal', fichier + '-shm']) if (fs.existsSync(f)) fs.chmodSync(f, 0o600);
  const db = new DatabaseSync(fichier);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  migrer(db);
  return db;
}

// Plusieurs écritures, toutes ou aucune. Réentrant : une transaction ouverte
// par l'appelant (celle du socle à la suppression d'un compte, par exemple)
// est réutilisée plutôt que doublée.
export function transaction(db, fn) {
  if (db.isTransaction) return fn();
  db.exec('BEGIN IMMEDIATE');
  try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; }
}
