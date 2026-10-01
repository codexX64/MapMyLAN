// Le plafond de dépense des modèles (SEC-LLM-002), sur le modèle de SYNAPSE :
// un nombre d'appels par compte et par jour (UTC), un autre pour toute
// l'instance, comptés en base pour survivre à un redémarrage. Les deux
// compteurs avancent ensemble ou pas du tout. Le premier refus du jour
// prévient les administrateurs. Deux usages, chacun ses compteurs : le modèle
// de langage de l'assistant, et la voix (transcriptions et lectures de VOX).
export const jourUtc = (t = Date.now()) => new Date(t).toISOString().slice(0, 10);
const USAGES = {
  assistant: { prefixe: '', appels: 'appels à l’assistant' },
  voix: { prefixe: 'voix:', appels: 'transcriptions et lectures de la voix' },
};

export class Plafond {
  constructor({ db, journal, comptes, parCompte, total, usage = 'assistant' }) {
    Object.assign(this, { db, journal, comptes, parCompte, total, usage, ...USAGES[usage] });
    this.tout = `${this.prefixe}*`;
    this.signales = new Set();
  }

  compte(qui, jour = jourUtc()) { return this.db.prepare('SELECT n FROM quotas_ia WHERE qui = ? AND jour = ?').get(this.prefixe + qui, jour)?.n || 0; }

  restant(qui) { return Math.max(0, Math.min(this.parCompte - this.compte(qui), this.total - this.compte('*'))); }

  // Un appel de plus pour `qui`, s'il reste de la place sous les deux plafonds.
  prendre(qui) {
    const jour = jourUtc();
    const avancer = this.db.prepare('INSERT INTO quotas_ia(qui, jour, n) VALUES(?, ?, 1) ON CONFLICT(qui, jour) DO UPDATE SET n = n + 1 WHERE n < ?');
    let refus = null;
    this.db.exec('SAVEPOINT quota');
    for (const [q, max] of [[this.prefixe + qui, this.parCompte], [this.tout, this.total]]) {
      if (!avancer.run(q, jour, max).changes) { refus = q; break; }
    }
    this.db.exec(refus ? 'ROLLBACK TO quota; RELEASE quota' : 'RELEASE quota');
    if (!refus) return true;
    const global = refus === this.tout;
    const max = global ? this.total : this.parCompte;
    if (!this.signales.has(`${refus}:${jour}`)) {
      this.signales.add(`${refus}:${jour}`);
      this.journal.ecrire({ acteur: qui.startsWith('compte:') ? qui.slice(7) : null, action: 'ia.plafond', resultat: 'refus', details: { plafond: max, global, usage: this.usage } });
      this.comptes.alerterAdmins('service.depense', {
        texte: `plafond de ${max} ${this.appels} atteint aujourd’hui ${global ? 'pour l’instance' : 'par un compte'}`,
      });
    }
    return false;
  }

  // Les compteurs d'un compte effacé partent avec lui.
  effacer(qui) { this.db.prepare('DELETE FROM quotas_ia WHERE qui = ?').run(this.prefixe + qui); }

  purger() { this.db.prepare('DELETE FROM quotas_ia WHERE jour < ?').run(jourUtc(Date.now() - 2 * 86400e3)); }
}
