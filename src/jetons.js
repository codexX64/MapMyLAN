// Jetons d'intégration : ce qui permet à un programme (le Hub, un script)
// d'interroger l'API sans être un compte. Un secret durable, révocable d'un
// geste, à la portée plus étroite qu'un humain : rôle lecture ou membre,
// jamais admin, et seulement sur les routes marquées « jeton » (api/).
//
// La base ne garde que l'empreinte SHA-256 ; le clair n'existe qu'une fois,
// à la création. Révoquer ne supprime pas la ligne : ce qui a existé reste
// lisible (nom, rôle, dernière utilisation).
import crypto from 'node:crypto';
import { egal } from '../socle/src/index.js';
import { nouvelId } from './db.js';

export const ROLES_JETON = ['lecture', 'membre'];
const PREFIXES = /^(mml|hub)_[\w-]{24,200}$/;
// Jeton dérivé par le Hub pour un service voisin : cer_<nom>_<hmac>, calculé
// avec le jeton du Hub (INTEGRATION_TOKEN_SEED). Rien n'est stocké : il se
// vérifie par le même calcul, et changer le jeton du Hub les révoque tous.
const DERIVE = /^cer_([a-z0-9][a-z0-9-]{1,30})_([0-9a-f]{64})$/;
const PAS_ECRITURE_MS = 60_000;
// Le Hub amorce son jeton par l'environnement : une ligne à ce nom.
export const NOM_AMORCE = 'hub';

export const empreinte = jeton => crypto.createHash('sha256').update(String(jeton), 'utf8').digest('hex');
export const estJeton = v => typeof v === 'string' && (PREFIXES.test(v) || DERIVE.test(v));

/** Le nom porté par un jeton dérivé valide pour cette semence, ou null. */
export function nomDerive(semence, clair) {
  const m = DERIVE.exec(String(clair || ''));
  if (!m || !semence || String(semence).length < 16) return null;
  const attendu = crypto.createHmac('sha256', String(semence)).update('cerveau:' + m[1]).digest();
  const recu = Buffer.from(m[2], 'hex');
  return recu.length === attendu.length && crypto.timingSafeEqual(recu, attendu) ? m[1] : null;
}

export function fabriquer() {
  const clair = 'mml_' + crypto.randomBytes(32).toString('base64url');
  return { clair, prefix: clair.slice(0, 8), hash: empreinte(clair) };
}

export class Jetons {
  // semence : le jeton du Hub ; membres : les services dont le jeton dérivé
  // agit (rôle membre, VIGIE) — les autres lisent seulement.
  constructor(db, { semence = null, membres = [] } = {}) { this.db = db; this.dernieres = new Map(); this.semence = semence; this.membres = new Set(membres); }

  // { ok, jeton } ou { ok: false, raison }. La recherche porte sur
  // l'empreinte ; la comparaison finale est en temps constant.
  verifier(clair, maintenant = Date.now()) {
    if (!estJeton(clair)) return { ok: false, raison: 'forme' };
    if (DERIVE.test(clair)) {
      const nom = nomDerive(this.semence, clair);
      if (!nom) return { ok: false, raison: 'inconnu' };
      return { ok: true, jeton: { id: `derive:${nom}`, name: `service:${nom}`, role: this.membres.has(nom) ? 'membre' : 'lecture', derive: true } };
    }
    const h = empreinte(clair);
    const j = this.db.prepare('SELECT * FROM jetons_integration WHERE hash = ?').get(h);
    if (!j || !egal(j.hash, h)) return { ok: false, raison: 'inconnu' };
    if (j.revokedAt) return { ok: false, raison: 'revoque' };
    if (j.expiresAt && j.expiresAt <= maintenant) return { ok: false, raison: 'expire' };
    if (!ROLES_JETON.includes(j.role)) return { ok: false, raison: 'role' };
    return { ok: true, jeton: j };
  }

  // Une écriture par minute suffit : la précision utile est « aujourd'hui ».
  noterUsage(id, maintenant = Date.now()) {
    if (String(id).startsWith('derive:')) return false;
    if (maintenant - (this.dernieres.get(id) || 0) < PAS_ECRITURE_MS) return false;
    this.dernieres.set(id, maintenant);
    this.db.prepare('UPDATE jetons_integration SET lastUsedAt = ? WHERE id = ?').run(maintenant, id);
    return true;
  }

  creer({ name, role, expiresAt = null, createdById = null }) {
    const { clair, prefix, hash } = fabriquer();
    const id = nouvelId();
    this.db.prepare('INSERT INTO jetons_integration(id, name, prefix, hash, role, createdById, createdAt, expiresAt) VALUES(?,?,?,?,?,?,?,?)')
      .run(id, name, prefix, hash, role, createdById, Date.now(), expiresAt);
    return { ligne: this.ligne(id), clair };
  }

  ligne(id) { return this.db.prepare('SELECT * FROM jetons_integration WHERE id = ?').get(id) || null; }
  lister() { return this.db.prepare('SELECT * FROM jetons_integration ORDER BY createdAt DESC LIMIT 1000').all(); }

  revoquer(id) {
    this.db.prepare('UPDATE jetons_integration SET revokedAt = COALESCE(revokedAt, ?) WHERE id = ?').run(Date.now(), id);
    return this.ligne(id);
  }

  // Le jeton du Hub, posé par INTEGRATION_TOKEN_SEED. Relancer ne crée pas de
  // doublon, changer la valeur remplace l'ancienne, et une amorce présente
  // réactive une ligne révoquée (le Hub reste la source de vérité).
  amorcer(clair) {
    if (!clair) return { fait: 'rien' };
    if (!estJeton(clair)) return { fait: 'ignore' };
    const h = empreinte(clair);
    const existant = this.db.prepare('SELECT * FROM jetons_integration WHERE name = ? ORDER BY createdAt LIMIT 1').get(NOM_AMORCE);
    if (existant) {
      if (existant.hash === h && !existant.revokedAt && existant.role === 'membre') return { fait: 'inchange' };
      this.db.prepare("UPDATE jetons_integration SET hash = ?, prefix = ?, role = 'membre', revokedAt = NULL, expiresAt = NULL WHERE id = ?").run(h, clair.slice(0, 8), existant.id);
      return { fait: 'mis-a-jour' };
    }
    this.db.prepare("INSERT INTO jetons_integration(id, name, prefix, hash, role, createdAt) VALUES(?,?,?,?, 'membre', ?)").run(nouvelId(), NOM_AMORCE, clair.slice(0, 8), h, Date.now());
    return { fait: 'cree' };
  }
}
