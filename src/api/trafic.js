// Routes du trafic vers l'extérieur, des registres (RDAP) et des logos.
import { Debit, ErreurHttp } from '../../socle/src/index.js';
import { adresseDeRegistre } from '../registre.js';
import { domaineValide } from '../logos.js';
import { vide } from './schemas.js';

const INSTANT = { type: 'entier', min: 0, max: 8.64e15 };
const plusOuMoins = v => (v === null || v === undefined || v === '' ? undefined : v);

export function routesTrafic(route, s, acces) {
  const { db, trafic, registre, logos } = s;
  const quotas = { collecte: new Debit({ max: 6 }), registre: new Debit({ max: 20 }), logos: new Debit({ max: 60 }) };
  let dernierAvis = 0;

  route.get('/api/traffic/flows', ctx => {
    const { limite, avant, depuis, sens, suspect } = ctx.q;
    const conditions = [], valeurs = [];
    if (avant) { conditions.push('lastSeen < ?'); valeurs.push(avant); }
    if (depuis) { conditions.push('lastSeen > ?'); valeurs.push(depuis); }
    if (sens) { conditions.push('direction = ?'); valeurs.push(sens); }
    if (suspect === 'true') conditions.push('suspect = 1');
    const lignes = db.prepare(`SELECT * FROM flux_trafic ${conditions.length ? 'WHERE ' + conditions.join(' AND ') : ''} ORDER BY lastSeen DESC LIMIT ?`).all(...valeurs, limite);
    return lignes.map(f => ({
      id: f.id, src: f.srcIp, dst: f.dstIp, port: f.port, proto: f.proto, premier: f.firstSeen, dernier: f.lastSeen,
      octets: f.bytes, paquets: f.packets, vues: f.hits, nom: plusOuMoins(f.host), domaine: plusOuMoins(f.domain), operateur: plusOuMoins(f.operator),
      logo: plusOuMoins(f.logo), paysRegistre: plusOuMoins(f.country), sens: f.direction || 'sortant', suspect: f.suspect === 1, raison: plusOuMoins(f.raison),
    }));
  }, {
    role: 'lecture',
    requete: { limite: { type: 'entier', min: 1, max: 5000, defaut: 300 }, avant: INSTANT, depuis: INSTANT, sens: { type: 'chaine', parmi: ['sortant', 'entrant'] }, suspect: { type: 'chaine', parmi: ['true', 'false'] } },
  });

  route.get('/api/traffic/aggregats', ctx => {
    const filtre = ctx.q.depuis ? 'WHERE lastSeen > ?' : '';
    const a = ctx.q.depuis ? [ctx.q.depuis] : [];
    return {
      connexions: db.prepare(`SELECT COUNT(*) n FROM flux_trafic ${filtre}`).get(...a).n,
      destinations: db.prepare(`SELECT dstIp dst, MAX(host) nom, MAX(domain) domaine, MAX(operator) operateur, MAX(logo) logo, MAX(country) pays,
          MAX(direction) sens, MAX(suspect) suspect, SUM(bytes) octets, MAX(lastSeen) dernier
          FROM flux_trafic ${filtre} GROUP BY dstIp ORDER BY SUM(bytes) DESC LIMIT 5000`).all(...a)
        .map(d => ({ dst: d.dst, nom: plusOuMoins(d.nom), domaine: plusOuMoins(d.domaine), operateur: plusOuMoins(d.operateur), logo: plusOuMoins(d.logo), paysRegistre: plusOuMoins(d.pays), sens: d.sens || 'sortant', suspect: d.suspect === 1, octets: d.octets || 0, dernier: d.dernier || 0 })),
      appareils: db.prepare(`SELECT srcIp src, SUM(bytes) octets FROM flux_trafic ${filtre} GROUP BY srcIp ORDER BY SUM(bytes) DESC LIMIT 300`).all(...a).map(x => ({ src: x.src, octets: x.octets || 0 })),
    };
  }, { role: 'lecture', requete: { depuis: INSTANT } });

  route.get('/api/traffic/state', () => trafic.etatPublic(), { role: 'lecture' });

  route.post('/api/traffic/collect', ctx => {
    if (!quotas.collecte.prendre(ctx.acteur.id)) throw new ErreurHttp(429, 'Trop de relevés demandés : attends une minute.');
    return trafic.relancer();
  }, { role: 'membre', corps: vide });

  route.post('/api/traffic/purge', ctx => {
    const r = trafic.purger();
    acces.tracer(ctx, 'trafic.purge', null, { parAge: r.parAge, parTaille: r.parTaille });
    return r;
  }, { role: 'admin', corps: vide });

  route.del('/api/traffic/flows', ctx => {
    const supprimes = db.prepare('DELETE FROM flux_trafic').run().changes;
    acces.tracer(ctx, 'trafic.efface', null, { supprimes });
    return { supprimes };
  }, { role: 'admin', renfort: true });

  // Titulaire, bloc et pays des destinations publiques : des adresses
  // privées ne partent jamais vers un registre.
  route.post('/api/net/whois', async ctx => {
    if (!registre.actif()) return { actif: false, fiches: [] };
    if (!quotas.registre.prendre(ctx.acteur.id)) throw new ErreurHttp(429, 'Trop d’interrogations des registres : attends une minute.');
    const ips = [...new Set(ctx.corps.ips)].filter(adresseDeRegistre).slice(0, 64);
    const fiches = [];
    for (let i = 0; i < ips.length; i += 8) fiches.push(...await Promise.all(ips.slice(i, i + 8).map(ip => registre.fiche(ip))));
    const joignable = fiches.length === 0 || fiches.some(f => !f.injoignable);
    if (!joignable && Date.now() - dernierAvis > 3600e3) {
      dernierAvis = Date.now();
      s.evts.journaliser('warn', 'net', 'Registres RDAP injoignables : les destinations resteront affichées par leur adresse.');
    }
    return { actif: true, joignable, fiches: fiches.map(({ debut, fin, ...f }) => f) };
  }, { role: 'lecture', corps: { ips: { type: 'liste', requis: true, max: 64, de: { type: 'chaine', max: 45 } } } });

  // Une image téléchargée ailleurs, servie comme telle : jamais de SVG, et
  // une politique qui interdit tout script même ouverte seule. Le serveur la
  // garde ; le navigateur non, comme toute réponse authentifiée.
  route.get('/api/logos/:domaine', async ctx => {
    if (!logos.actifs()) throw new ErreurHttp(404, 'Logos éteints.');
    const domaine = String(ctx.params.domaine).toLowerCase();
    if (!domaineValide(domaine)) throw new ErreurHttp(400, 'Domaine invalide.');
    // Un domaine jamais cherché coûte jusqu'à quatre requêtes sortantes.
    if (!logos.connu(domaine) && !quotas.logos.prendre(ctx.acteur.id)) throw new ErreurHttp(429, 'Trop de logos demandés : attends une minute.');
    const logo = await logos.logo(domaine);
    if (!logo) throw new ErreurHttp(404, 'Pas de logo.');
    ctx.res.writeHead(200, {
      'Content-Type': logo.type, 'Content-Length': logo.corps.length, 'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox",
    });
    ctx.res.end(logo.corps);
  }, { role: 'lecture' });
}
