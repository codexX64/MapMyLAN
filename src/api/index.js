// Le répartiteur de l'API. Chaque route déclare qui peut l'appeler (rôle,
// renfort, jeton admis ou non), le schéma de sa requête et de son corps ; le
// gestionnaire ne voit que ce qui a été validé (ctx.q, ctx.corps, ctx.params).
// Rien n'est public ici, sauf /api/health.
//
// Options d'une route : role, renfort, jeton (Bearer admis), public,
// requete (schéma de la chaîne de requête), corps (schéma du corps JSON),
// effacables (champs de corps qu'un null ou une chaîne vide remet à nul),
// brut (préfixe du type admis ; corps lu tel quel, borné par limite).
import { ErreurHttp, Routeur, lireCorps, repondreJson, valider } from '../../socle/src/index.js';
import { Acces, Refus } from './acces.js';
import { routesAppareils } from './appareils.js';
import { routesReseau } from './reseau.js';
import { routesSysteme } from './systeme.js';
import { routesAutomatisation } from './automatisation.js';
import { routesTrafic } from './trafic.js';
import { routesMessagerie } from './messagerie.js';
import { routesAssistant } from './assistant.js';

const ECRITURES = new Set(['POST', 'PUT', 'PATCH']);
// Un paramètre de chemin : identifiant, numéro, nom de canal ou de domaine.
const PARAMETRE = /^[A-Za-z0-9_.:-]{1,253}$/;

const sansCorps = req => !req.headers['transfer-encoding'] && Number(req.headers['content-length'] || 0) === 0;

export function creerApi(s) {
  const r = new Routeur();
  const acces = new Acces(s);
  const declarer = (methode, chemin, gestionnaire, options = {}) => {
    if (ECRITURES.has(methode) && !options.corps && !options.brut) throw new Error(`Route sans schéma de corps : ${methode} ${chemin}`);
    r.ajouter(methode, chemin, gestionnaire, options);
  };
  const route = {
    get: (c, g, o) => declarer('GET', c, g, o), post: (c, g, o) => declarer('POST', c, g, o), put: (c, g, o) => declarer('PUT', c, g, o),
    patch: (c, g, o) => declarer('PATCH', c, g, o), del: (c, g, o) => declarer('DELETE', c, g, o),
  };
  for (const enregistrer of [routesSysteme, routesAppareils, routesReseau, routesAutomatisation, routesTrafic, routesMessagerie, routesAssistant]) enregistrer(route, s, acces);

  async function traiter(ctx) {
    const { req, res, url } = ctx;
    if (!url.pathname.startsWith('/api/')) return false;
    const t = r.trouver(req.method, url.pathname);
    if (!t) throw new ErreurHttp(404, 'Route inconnue.');
    if (t.methodes) { res.setHeader('Allow', t.methodes.join(', ')); throw new ErreurHttp(405, 'Méthode non admise.'); }
    const o = t.route.options;
    for (const v of Object.values(t.params)) if (!PARAMETRE.test(v)) throw new ErreurHttp(404, 'Introuvable.');
    ctx.params = t.params;
    try {
      if (!o.public) acces.principal(ctx, o);
      ctx.q = valider(Object.fromEntries(url.searchParams), o.requete || {});
      if (o.brut) {
        const type = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
        if (!type.startsWith(o.brut)) { req.resume(); throw new ErreurHttp(415, `Corps attendu : ${o.brut}*.`); }
        ctx.brut = await lireCorps(req, { limite: o.limite || 64 * 1024, json: false });
      } else if (o.corps) {
        const recu = sansCorps(req) ? {} : await lireCorps(req, { limite: o.limite || 64 * 1024 });
        ctx.corps = valider(recu, o.corps);
        // Un champ facultatif envoyé vide ou nul s'efface ; absent, il ne change pas.
        for (const k of o.effacables || []) if (recu[k] === null || recu[k] === '') ctx.corps[k] = null;
      } else if (!sansCorps(req)) req.resume();
      const reponse = await t.route.gestionnaire(ctx);
      if (reponse !== undefined && !res.headersSent) repondreJson(res, ctx.statut || 200, reponse);
    } catch (e) {
      if (e instanceof Refus && e.status === 403) {
        s.journal.rare(`refus:${ctx.acteur?.id}:${req.method} ${url.pathname}`, {
          acteur: ctx.acteur?.compte || null, action: 'acces.refuse', objet: url.pathname, ip: ctx.ip, resultat: 'refus',
          details: { cause: e.message.slice(0, 120), ...(ctx.acteur?.type === 'jeton' ? { jeton: ctx.acteur.nom } : {}) },
        });
      }
      throw e;
    }
    return true;
  }
  return { traiter, routeur: r };
}
