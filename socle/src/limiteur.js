// Limiteur de tentatives persistant (REQ-AUTH-010).
//
// Deux compteurs par tentative : l'adresse et le compte visé. Le compte se
// verrouille par paliers quelle que soit l'adresse (un attaquant change d'IP,
// pas de cible), l'adresse se bloque quand elle échoue trop sur l'ensemble des
// comptes. Au-delà de trois échecs, chaque essai exige en plus une preuve de
// travail calculée par le navigateur : un script qui enchaîne les essais paie
// chaque tentative en calcul. L'état vit en base : un redémarrage ne remet pas
// les compteurs à zéro.
import crypto from 'node:crypto';
import { ErreurHttp } from './outils.js';

const PALIERS_COMPTE = [[20, 4 * 3600e3], [15, 3600e3], [10, 15 * 60e3], [7, 5 * 60e3], [5, 60e3]];
const PALIERS_ADRESSE = [[50, 3600e3], [20, 15 * 60e3], [10, 60e3]];
const OUBLI_MS = 3600e3;
export const SEUIL_PREUVE = 3;
const SEUIL_PREUVE_ADRESSE = 5;
const BITS_PREUVE = 16;

export class Limiteur {
  constructor(db, { maintenant = () => Date.now(), journal = null } = {}) {
    this.db = db; this.maintenant = maintenant; this.journal = journal;
    db.exec(`CREATE TABLE IF NOT EXISTS socle_essais (
      cle TEXT PRIMARY KEY, echecs INTEGER NOT NULL, dernier INTEGER NOT NULL, bloque INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS socle_preuves (id TEXT PRIMARY KEY, sel TEXT NOT NULL, bits INTEGER NOT NULL, expire INTEGER NOT NULL);`);
  }

  lire(cle) {
    const l = this.db.prepare('SELECT echecs, dernier, bloque FROM socle_essais WHERE cle = ?').get(cle);
    if (!l) return { echecs: 0, bloque: 0 };
    if (this.maintenant() - l.dernier > OUBLI_MS && l.bloque < this.maintenant()) return { echecs: 0, bloque: 0 };
    return l;
  }

  // Lève 429 si l'une des clés est bloquée. Renvoie vrai si une preuve de
  // travail doit accompagner la tentative.
  controler(cles) {
    const t = this.maintenant();
    let preuve = false, attente = 0;
    for (const cle of cles) {
      const e = this.lire(cle);
      if (e.bloque > t) attente = Math.max(attente, e.bloque - t);
      if (e.echecs >= (cle.startsWith('ip:') ? SEUIL_PREUVE_ADRESSE : SEUIL_PREUVE)) preuve = true;
    }
    if (attente) {
      const s = Math.ceil(attente / 1000);
      const bloquee = cles.find(c => this.lire(c).bloque > t);
      this.journal?.rare(`limite:${bloquee}`, { action: 'limite.atteinte', objet: bloquee, resultat: 'refus', details: { attente: s } });
      throw new ErreurHttp(429, `Trop de tentatives. Réessaie dans ${s < 90 ? s + ' s' : Math.ceil(s / 60) + ' min'}.`, { attendre: s });
    }
    return preuve;
  }

  echec(cles) {
    const t = this.maintenant();
    for (const cle of cles) {
      const n = this.lire(cle).echecs + 1;
      const paliers = cle.startsWith('ip:') ? PALIERS_ADRESSE : PALIERS_COMPTE;
      const palier = paliers.find(([seuil]) => n >= seuil);
      this.db.prepare(`INSERT INTO socle_essais(cle, echecs, dernier, bloque) VALUES(?,?,?,?)
        ON CONFLICT(cle) DO UPDATE SET echecs = excluded.echecs, dernier = excluded.dernier, bloque = excluded.bloque`)
        .run(cle, n, t, palier ? t + palier[1] : 0);
      if (palier) this.journal?.ecrire({ action: 'limite.verrou', objet: cle, resultat: 'refus', details: { echecs: n, minutes: Math.round(palier[1] / 60e3) } });
    }
  }

  reussite(cles) {
    for (const cle of cles) this.db.prepare('DELETE FROM socle_essais WHERE cle = ?').run(cle);
  }

  liberer(cle) { this.db.prepare('DELETE FROM socle_essais WHERE cle = ?').run(cle); }

  // ---- preuve de travail ----
  emettrePreuve() {
    const id = crypto.randomBytes(16).toString('base64url');
    const sel = crypto.randomBytes(16).toString('base64url');
    this.db.prepare('INSERT INTO socle_preuves(id, sel, bits, expire) VALUES(?,?,?,?)').run(id, sel, BITS_PREUVE, this.maintenant() + 5 * 60e3);
    return { id, sel, bits: BITS_PREUVE };
  }

  // Usage unique : la ligne disparaît au premier contrôle, réussi ou non.
  verifierPreuve(preuve) {
    if (!preuve || typeof preuve.id !== 'string' || typeof preuve.nonce !== 'string' || preuve.nonce.length > 32) return false;
    const l = this.db.prepare('SELECT sel, bits, expire FROM socle_preuves WHERE id = ?').get(preuve.id);
    this.db.prepare('DELETE FROM socle_preuves WHERE id = ?').run(preuve.id);
    if (!l || l.expire < this.maintenant()) return false;
    return bitsNuls(crypto.createHash('sha256').update(`${l.sel}:${preuve.nonce}`).digest()) >= l.bits;
  }

  purger() {
    const t = this.maintenant();
    this.db.prepare('DELETE FROM socle_essais WHERE dernier < ? AND bloque < ?').run(t - 24 * 3600e3, t);
    this.db.prepare('DELETE FROM socle_preuves WHERE expire < ?').run(t);
  }
}

export function bitsNuls(h) {
  let n = 0;
  for (const o of h) {
    if (o === 0) { n += 8; continue; }
    n += Math.clz32(o) - 24;
    break;
  }
  return n;
}
