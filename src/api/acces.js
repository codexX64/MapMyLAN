// Qui appelle, et a-t-il le droit ? Deux preuves possibles : la session du
// socle (avec son rôle, son jeton anti-CSRF et, pour les actions sensibles,
// un renfort récent), ou un jeton d'intégration présenté en en-tête
// Authorization, seulement sur les routes qui l'admettent. Un jeton présenté
// et refusé n'est jamais remplacé par la session.
import { Debit, ErreurHttp } from '../../socle/src/index.js';

export const RANG = { lecture: 0, membre: 1, admin: 2 };

// Les refus décidés ici, journalisés par le répartiteur ; ceux du socle le sont déjà.
export class Refus extends ErreurHttp {}

export class Acces {
  constructor(s) {
    this.s = s;
    // Un jeton inconnu ne fait pas travailler la base autant qu'il veut.
    this.debitEssais = new Debit({ max: 120 });
    this.debitJeton = new Debit({ max: 120 });
  }

  principal(ctx, { role = 'lecture', renfort = false, jeton = false } = {}) {
    const entete = ctx.req.headers.authorization;
    if (entete !== undefined) return this.parJeton(ctx, entete, { role, jeton });
    const session = this.s.portail.exiger(ctx, { role, renfort });
    ctx.acteur = { type: 'compte', id: session.compte, compte: session.compte, nom: session.compteLigne.identifiant, role: session.compteLigne.role };
    return ctx.acteur;
  }

  parJeton(ctx, entete, { role, jeton }) {
    const { journal } = this.s;
    const refuser = raison => {
      // « connexion » : la vigie compte ces refus avec les échecs de connexion.
      journal.rare(`jeton:${ctx.ip}`, { action: 'connexion.jeton', objet: ctx.url.pathname, ip: ctx.ip, resultat: 'refus', details: { cause: raison } });
      throw new ErreurHttp(401, 'Jeton refusé.');
    };
    if (!this.debitEssais.prendre(ctx.ip)) throw new ErreurHttp(429, 'Trop de requêtes.');
    const m = /^Bearer ([\w-]{1,256})$/.exec(String(entete));
    if (!m) refuser('forme');
    const v = this.s.jetons.verifier(m[1]);
    if (!v.ok) refuser(v.raison);
    if (!jeton) refuser('route');
    if (!this.debitJeton.prendre(v.jeton.id)) throw new ErreurHttp(429, 'Trop de requêtes pour ce jeton.');
    ctx.acteur = { type: 'jeton', id: `jeton:${v.jeton.id}`, jeton: v.jeton.id, nom: v.jeton.name, role: v.jeton.role };
    if (RANG[v.jeton.role] < RANG[role]) throw new Refus(403, 'Droits insuffisants pour ce jeton.');
    this.s.jetons.noterUsage(v.jeton.id);
    return ctx.acteur;
  }

  // Un rôle de plus au sein d'une route (un champ réservé aux administrateurs).
  exiger(ctx, role, { renfort = false } = {}) {
    if (ctx.acteur.type === 'jeton') {
      if (RANG[ctx.acteur.role] < RANG[role] || renfort) throw new Refus(403, 'Droits insuffisants pour ce jeton.');
      return;
    }
    this.s.portail.exiger(ctx, { role, renfort });
  }

  // Une action d'administration ou de défense au journal chaîné du socle :
  // qui, quoi, sur quoi, d'où. Jamais de secret ni de commande complète. Un
  // jeton y est nommé sous « integration » : le journal retire toute clé
  // dont le nom évoque un secret (« jeton » compris).
  tracer(ctx, action, objet = null, details = null) {
    this.s.journal.ecrire({
      acteur: ctx.acteur?.compte || null, action, objet, ip: ctx.ip,
      details: { ...(ctx.acteur?.type === 'jeton' ? { integration: ctx.acteur.nom } : {}), ...(details || {}) },
    });
  }
}
