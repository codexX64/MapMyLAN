// Journal des événements de sécurité (REQ-DATA-004).
//
// Qui, quoi, sur quoi, quand, d'où, et le résultat. Jamais de mot de passe, de
// code, de jeton ni d'identifiant de session : les détails passent par une
// liste blanche de clés. Chaque ligne porte l'empreinte de la précédente, ce
// qui rend une suppression ou une retouche visible à la vérification.
import crypto from 'node:crypto';
import { requeteCourante } from './requete.js';

const SENSIBLES = /(mot|pass|mdp|code|jeton|token|secret|cle|key|session|sid|csrf|reponse|credential)/i;

export class Journal {
  constructor(db, { sortie = null, retentionJours = 365 } = {}) {
    this.db = db; this.sortie = sortie; this.retention = retentionJours;
    db.exec(`CREATE TABLE IF NOT EXISTS socle_journal (
      n INTEGER PRIMARY KEY AUTOINCREMENT, t INTEGER NOT NULL, acteur TEXT, action TEXT NOT NULL,
      objet TEXT, ip TEXT, resultat TEXT NOT NULL, details TEXT, chaine TEXT NOT NULL)`);
    if (!db.prepare("SELECT 1 FROM pragma_table_info('socle_journal') WHERE name = 'requete'").get()) db.exec('ALTER TABLE socle_journal ADD COLUMN requete TEXT');
    this.derniers = new Map();
  }

  // Une ligne sur l'empreinte : la requête n'y entre que si elle existe, ce qui
  // garde vérifiables les lignes écrites avant qu'elle ne soit notée.
  static empreinte(precedente, l) {
    return crypto.createHash('sha256').update([precedente, l.t, l.acteur, l.action, l.objet, l.ip, l.resultat, l.details, ...(l.requete ? [l.requete] : [])].join('\u001f')).digest('hex');
  }

  ecrire({ acteur = null, action, objet = null, ip = null, resultat = 'ok', details = null }) {
    const propres = details ? Object.fromEntries(Object.entries(details).filter(([k]) => !SENSIBLES.test(k))) : null;
    const l = { t: Date.now(), acteur, action, objet, ip, resultat, details: propres ? JSON.stringify(propres) : null, requete: requeteCourante() };
    const precedente = this.db.prepare('SELECT chaine FROM socle_journal ORDER BY n DESC LIMIT 1').get()?.chaine || '';
    this.db.prepare('INSERT INTO socle_journal(t,acteur,action,objet,ip,resultat,details,requete,chaine) VALUES(?,?,?,?,?,?,?,?,?)')
      .run(l.t, acteur, action, objet, ip, resultat, l.details, l.requete, Journal.empreinte(precedente, l));
    this.sortie?.({ ...l, details: propres });
  }

  // Pour les refus qui arrivent en rafale (limites, accès refusés) : une ligne
  // par clé et par minute suffit à l'enquête, et la base ne gonfle pas.
  rare(cle, evt, fenetreMs = 60_000) {
    const t = Date.now();
    if (t - (this.derniers.get(cle) || 0) < fenetreMs) return;
    this.derniers.set(cle, t);
    if (this.derniers.size > 5000) for (const [k, v] of this.derniers) if (t - v > fenetreMs) this.derniers.delete(k);
    this.ecrire(evt);
  }

  // Événements non « ok » depuis t, par action : la matière de la vigie.
  refusDepuis(t) {
    return this.db.prepare("SELECT action, COUNT(*) n FROM socle_journal WHERE t >= ? AND resultat != 'ok' GROUP BY action").all(t);
  }

  lire({ avant = null, limite = 100, compte = null } = {}) {
    const n = Math.min(Math.max(1, limite | 0), 500);
    const conditions = [], args = [];
    if (avant) { conditions.push('n < ?'); args.push(avant); }
    if (compte) { conditions.push('(acteur = ? OR objet = ?)'); args.push(compte, compte); }
    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
    return this.db.prepare(`SELECT n,t,acteur,action,objet,ip,resultat,details,requete FROM socle_journal ${where} ORDER BY n DESC LIMIT ?`).all(...args, n)
      .map(l => ({ ...l, details: l.details ? JSON.parse(l.details) : null }));
  }

  verifier() {
    let precedente = '', n = 0;
    for (const l of this.db.prepare('SELECT * FROM socle_journal ORDER BY n').iterate()) {
      if (n === 0 && l.n !== 1) { precedente = l.chaine; n++; continue; }
      if (Journal.empreinte(precedente, l) !== l.chaine) return { ok: false, rupture: l.n };
      precedente = l.chaine; n++;
    }
    return { ok: true, lignes: n };
  }

  // La purge ne casse pas la chaîne : la première ligne restante garde
  // l'empreinte de celle qui l'a précédée, et la vérification repart d'elle.
  purger() {
    this.db.prepare('DELETE FROM socle_journal WHERE t < ?').run(Date.now() - this.retention * 86400e3);
  }
}
