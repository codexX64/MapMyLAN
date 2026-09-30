// La vigie : ce que personne ne regarde en direct. Toutes les minutes, elle
// compte dans le journal les échecs des dix dernières minutes et prévient les
// administrateurs (page Sécurité et, s'il existe, courriel) quand un seuil est
// franchi. Une même alerte ne repart pas avant une heure.
import { erreursInternes } from './http.js';

const FENETRE_MS = 10 * 60e3;
const REPOS_MS = 3600e3;

// action du journal → [type d'alerte, seuil sur la fenêtre]
const SURVEILLES = [
  [/^connexion/, 'vigie.connexions', 20],
  [/^acces\.refuse$/, 'vigie.refus', 20],
  [/^limite\./, 'vigie.limites', 10],
];
const SEUIL_ERREURS = 10;

export class Vigie {
  constructor({ journal, comptes, maintenant = () => Date.now() }) {
    Object.assign(this, { journal, comptes, maintenant });
    this.dernieres = new Map();
    this.erreurs = [];
  }

  signaler(type, details) {
    const t = this.maintenant();
    if (t - (this.dernieres.get(type) || 0) < REPOS_MS) return;
    this.dernieres.set(type, t);
    this.journal.ecrire({ action: type, resultat: 'alerte', details });
    this.comptes.alerterAdmins(type, details);
  }

  tour() {
    const t = this.maintenant();
    const totaux = new Map();
    for (const { action, n } of this.journal.refusDepuis(t - FENETRE_MS)) {
      const regle = SURVEILLES.find(([motif]) => motif.test(action));
      if (regle) totaux.set(regle, (totaux.get(regle) || 0) + n);
    }
    for (const [regle, n] of totaux) if (n >= regle[2]) this.signaler(regle[1], { nombre: n, minutes: FENETRE_MS / 60e3 });
    // Les erreurs internes ne vont pas au journal (elles ne sont pas des
    // événements de sécurité) : la vigie suit leur compteur.
    this.erreurs.push([t, erreursInternes()]);
    this.erreurs = this.erreurs.filter(([x]) => t - x <= FENETRE_MS);
    const ecart = this.erreurs.at(-1)[1] - this.erreurs[0][1];
    if (ecart >= SEUIL_ERREURS) this.signaler('vigie.erreurs', { nombre: ecart, minutes: FENETRE_MS / 60e3 });
  }
}
