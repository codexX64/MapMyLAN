// Connexions sortantes, lues dans l'historique que tient le serveur.
//
// La collecte tourne côté serveur, en continu : l'interface ne fait que lire.
// Le journal survit donc à un changement de page, il continue de se remplir
// onglet fermé, et la passerelle n'est interrogée qu'une fois quel que soit le
// nombre d'onglets ouverts.
//
// Deux principes :
//
//   1. rien n'est inventé. Une connexion affichée a été relevée sur
//      l'équipement, à la seconde près indiquée ;
//   2. rien n'est deviné. Une destination n'est placée sur le globe que si son
//      nom porte un code de ville reconnu, ou, en pointillé, au pays
//      d'enregistrement de son préfixe. Sinon elle est listée sans arc.

import { api } from '../etat.js';
import { lieuDepuisNom, operateurDe } from './lieux.js';
import { paysDe } from './pays.js';

export function etatTrafic() {
  return api.get('/api/traffic/state');
}

/** Complète une ligne du serveur avec ce qui se déduit côté interface. */
function habiller(f) {
  const c = {
    cle: f.id,
    src: f.src, dst: f.dst, port: f.port, proto: f.proto,
    octets: f.octets || undefined,
    paquets: f.paquets || undefined,
    nom: f.nom, domaine: f.domaine,
    operateur: f.operateur, logo: f.logo,
    paysRegistre: f.paysRegistre,
    premier: f.premier, dernier: f.dernier, vues: f.vues,
    sens: f.sens === 'entrant' ? 'entrant' : 'sortant',
    suspect: f.suspect === true,
    raison: f.raison,
  };
  // Deux niveaux, jamais confondus :
  //   la ville, déduite d'un nom d'hôte portant un code d'aéroport reconnu —
  //   c'est une position ;
  //   à défaut, le pays d'enregistrement du préfixe au registre — c'est une
  //   déclaration administrative, pas une position.
  c.lieu = lieuDepuisNom(f.nom);
  if (!c.lieu) c.pays = paysDe(f.paysRegistre) || null;
  const op = operateurDe(c.domaine);
  if (op) { c.operateur = op.nom; c.logo = op.logo || c.logo; }
  return c;
}

/**
 * Les totaux du serveur : une ligne par destination, sur tout l'historique.
 *
 * Elles passent par le même habillage que les flux — ville déduite du nom
 * d'hôte, pays d'enregistrement — pour que les compteurs et le panneau de
 * droite disent exactement la même chose que le journal.
 */
export async function lireAggregats(depuis) {
  const r = await api.get(`/api/traffic/aggregats${depuis ? `?depuis=${depuis}` : ''}`);
  return {
    connexions: Number(r?.connexions || 0),
    destinations: (r?.destinations || []).map((d) => habiller({ ...d, id: d.dst, src: '' })),
    appareils: r?.appareils || [],
  };
}

/**
 * Les flux, du plus récemment vu au plus ancien.
 *   depuis — ne rend que ce qui a bougé après cet instant (rafraîchissement)
 *   avant  — ne rend que ce qui est plus ancien (descente dans l'historique)
 */
export async function lireFlux(o = {}) {
  const q = new URLSearchParams();
  if (o.limite) q.set('limite', String(o.limite));
  if (o.depuis) q.set('depuis', String(Math.floor(o.depuis)));
  if (o.avant) q.set('avant', String(Math.floor(o.avant)));
  const flux = await api.get(`/api/traffic/flows${q.toString() ? `?${q}` : ''}`);
  return (flux || []).map(habiller);
}

/** Ports où un service web répond, jamais un shell. */
const PORTS_WEB = new Set([80, 443, 8080, 8443, 8843, 8880]);

/**
 * Cette entrée porte-t-elle un shell ?
 *
 * Le routeur principal et les consoles SSH partagent la même table côté
 * serveur. Un contrôleur joint par son API locale, ou déclaré sur un port web,
 * n'a rien à quoi ouvrir une session : il n'apparaît ni dans le relevé de
 * trafic ni dans la liste des consoles.
 */
export function estInterrogeable(entree) {
  const port = Number(entree?.port) || 22;
  return entree?.transport !== 'api' && !PORTS_WEB.has(port);
}
