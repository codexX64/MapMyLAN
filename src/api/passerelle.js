// La passerelle pour VIGIE : MapMyLAN pilote déjà le routeur principal (ses
// identifiants et son certificat épinglé ne quittent jamais MapMyLAN). VIGIE,
// par le jeton que le Hub a dérivé pour elle, y lit les alertes de l'IPS et y
// tient la liste des adresses à refuser — rien d'autre.
//
// Lecture : tout jeton dérivé et toute session. Écriture : le jeton dérivé
// « membre » (celui du service d'audit que le Hub désigne), ou un administrateur
// sous renfort — jamais un jeton d'intégration, ni celui du Hub.
import { ErreurHttp } from '../../socle/src/index.js';
import { Refus } from './acces.js';
import { adaptateur } from '../adaptateurs/index.js';
import { classer } from '../sortie.js';
import { estIP } from '../cibles.js';

const MAX_ADRESSES = 2000;

export function routesPasserelle(route, s, acces) {
  const { equipements } = s;
  const pilote = () => {
    const l = equipements.principal();
    if (!l) return null;
    const a = adaptateur(l.vendor);
    return { ligne: l, adaptateur: a, capacites: a.capabilities || [] };
  };
  const exiger = capacite => {
    const p = pilote();
    if (!p) throw new ErreurHttp(409, 'Aucun routeur principal relié à MapMyLAN.');
    if (!p.capacites.includes(capacite) || typeof p.adaptateur[capacite] !== 'function') throw new ErreurHttp(409, `${p.adaptateur.label} : pas de « ${capacite} » par MapMyLAN.`);
    return { ...p, ctx: equipements.contexteDe(p.ligne) };
  };

  route.get('/api/passerelle', () => {
    const p = pilote();
    if (!p) return { reliee: false };
    return {
      reliee: true, nom: p.ligne.name, hote: p.ligne.host, constructeur: p.adaptateur.id, libelle: p.adaptateur.label,
      bouclier: p.capacites.includes('bouclier'), ips: p.capacites.includes('ips'),
      dernierEssai: p.ligne.lastTestAt || null, dernierEssaiOk: p.ligne.lastTestOk === null || p.ligne.lastTestOk === undefined ? null : p.ligne.lastTestOk === 1,
    };
  }, { role: 'lecture', jeton: true });

  route.get('/api/passerelle/ips', async ctx => {
    const { adaptateur: a, ctx: c } = exiger('ips');
    const maintenant = Date.now();
    // Au plus une journée en arrière : la relève est faite chaque minute.
    const depuis = Math.max(ctx.q.depuis ?? maintenant - 3600e3, maintenant - 86400e3);
    return a.ips(c, { depuis, jusque: maintenant, limite: ctx.q.limite ?? 500 });
  }, { role: 'membre', jeton: true, requete: { depuis: { type: 'entier', min: 0, max: 8.64e15 }, limite: { type: 'entier', min: 1, max: 1000 } } });

  route.put('/api/passerelle/bouclier', async ctx => {
    if (ctx.acteur.type === 'compte') acces.exiger(ctx, 'admin', { renfort: true });
    else if (!ctx.acteur.derive) throw new Refus(403, 'Le pare-feu ne se règle que par le service d’audit désigné par le Hub, ou par un administrateur.');
    const ips = [...new Set(ctx.corps.ips)];
    // Défense en profondeur : VIGIE ne bloque jamais le réseau local ; MapMyLAN non plus.
    for (const ip of ips) if (!estIP(ip) || classer(ip) !== 'publique') throw new ErreurHttp(400, `Adresse refusée : ${String(ip).slice(0, 45)} (une adresse publique seule).`);
    const { adaptateur: a, ctx: c, ligne } = exiger('bouclier');
    const r = await a.bouclier(c, ips);
    equipements.noterConnexion(ligne.id);
    acces.tracer(ctx, 'passerelle.bouclier', ligne.host, { adresses: ips.length });
    return { passerelle: ligne.name, ...r };
  }, { role: 'membre', jeton: true, corps: { ips: { type: 'liste', requis: true, max: MAX_ADRESSES, de: { type: 'chaine', max: 45 } } } });
}
