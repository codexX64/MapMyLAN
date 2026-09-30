// Le plafond de dépense de l'assistant (SEC-LLM-002), sur le modèle de
// SYNAPSE : un nombre d'appels au modèle par compte et par jour (UTC), un
// autre pour toute l'instance, comptés en base pour survivre à un
// redémarrage. Les deux compteurs avancent ensemble ou pas du tout. Le
// premier refus du jour prévient les administrateurs.
const TOUT = '*';
export const jourUtc = (t = Date.now()) => new Date(t).toISOString().slice(0, 10);

export class Plafond {
  constructor({ db, cfg, journal, comptes }) {
    Object.assign(this, { db, journal, comptes, parCompte: cfg.iaJour, total: cfg.iaJourTotal });
    this.signales = new Set();
  }

  compte(qui, jour = jourUtc()) { return this.db.prepare('SELECT n FROM quotas_ia WHERE qui = ? AND jour = ?').get(qui, jour)?.n || 0; }

  restant(qui) { return Math.max(0, Math.min(this.parCompte - this.compte(qui), this.total - this.compte(TOUT))); }

  // Un appel de plus pour `qui`, s'il reste de la place sous les deux plafonds.
  prendre(qui) {
    const jour = jourUtc();
    const avancer = this.db.prepare('INSERT INTO quotas_ia(qui, jour, n) VALUES(?, ?, 1) ON CONFLICT(qui, jour) DO UPDATE SET n = n + 1 WHERE n < ?');
    let refus = null;
    this.db.exec('SAVEPOINT quota');
    for (const [q, max] of [[qui, this.parCompte], [TOUT, this.total]]) {
      if (!avancer.run(q, jour, max).changes) { refus = q; break; }
    }
    this.db.exec(refus ? 'ROLLBACK TO quota; RELEASE quota' : 'RELEASE quota');
    if (!refus) return true;
    const max = refus === TOUT ? this.total : this.parCompte;
    if (!this.signales.has(`${refus}:${jour}`)) {
      this.signales.add(`${refus}:${jour}`);
      this.journal.ecrire({ acteur: qui.startsWith('compte:') ? qui.slice(7) : null, action: 'ia.plafond', resultat: 'refus', details: { plafond: max, global: refus === TOUT } });
      this.comptes.alerterAdmins('service.depense', {
        texte: refus === TOUT ? `plafond de ${max} appels à l’assistant atteint aujourd’hui pour l’instance` : `plafond de ${max} appels à l’assistant atteint aujourd’hui par un compte`,
      });
    }
    return false;
  }

  purger() { this.db.prepare('DELETE FROM quotas_ia WHERE jour < ?').run(jourUtc(Date.now() - 2 * 86400e3)); }
}
