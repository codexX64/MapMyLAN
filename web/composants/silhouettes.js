// Illustrations d'appareils pour la carte.
//
// Les pictos disent la CATÉGORIE : ils sont parfaits dans un tableau, une
// ligne de journal, un menu. Sur la carte, ils ne suffisent pas — une
// topologie se lit d'un coup d'œil, et on y reconnaît un matériel à sa
// silhouette avant de lire son nom. Un boîtier plat percé de deux rangées de
// ports EST un commutateur ; un picto abstrait, lui, demande à être décodé.
//
// D'où ce second jeu, réservé à la carte : des dessins au trait, vus de face,
// dans une boîte commune de 64 × 40 avec la même ligne d'assise, pour qu'une
// rangée d'appareils mélangés reste alignée. Un seul trait, aucune couleur en
// dur : le thème décide. Ce sont des dessins originaux.
import { s } from '../dom.js';
import { familleDuModele } from '../lib/modeles.js';

/**
 * Type d'appareil → famille de dessin. Un type inconnu tombe sur le boîtier
 * en pointillé, qui dit honnêtement « on ne sait pas ». Les noms de pictos
 * sont acceptés aussi : les deux vocabulaires circulent dans l'interface.
 */
const FAMILLE = {
  router: 'routeur', gateway: 'routeur', firewall: 'routeur',
  switch: 'commutateur',
  ap: 'borne', accesspoint: 'borne',
  server: 'serveur', nas: 'serveur', docker: 'serveur', vm: 'serveur',
  pi: 'carte', raspberry: 'carte',
  computer: 'ordinateur', laptop: 'ordinateur', desktop: 'ordinateur', pc: 'ordinateur',
  phone: 'mobile', tablet: 'mobile',
  printer: 'imprimante',
  camera: 'camera',
  iot: 'objet', plug: 'objet',
  tv: 'ecran', console: 'ecran',
  unknown: 'inconnu',
  chip: 'ordinateur', air: 'borne', cam: 'camera', eye: 'ecran', shield: 'routeur',
};

const familleDe = type => (type ? FAMILLE[String(type).toLowerCase()] || 'inconnu' : 'inconnu');

/**
 * La famille à dessiner pour un appareil. Le modèle passe avant le type, sauf
 * quand le type a été choisi à la main : l'exploitant sait ce qu'il a devant
 * lui mieux qu'une table de motifs.
 */
function familleAppareil(d) {
  const parType = familleDe(d.customType || d.type);
  if (d.customType) return parType;
  return familleDuModele(d) || parType;
}

const r = (x, y, width, height, rx, extra = {}) => s('rect', { x, y, width, height, rx, ...extra });
const c = (cx, cy, rayon) => s('circle', { cx, cy, r: rayon });
const t = d => s('path', { d });
const e = (cx, cy, rx, ry) => s('ellipse', { cx, cy, rx, ry });
const serie = (n, f) => Array.from({ length: n }, (_, i) => f(i));

/* Toutes les silhouettes tiennent dans 64 × 40, posées sur y = 34. */
const DESSINS = {
  // Passerelle : boîtier plat, bandeau d'affichage à gauche, diodes à droite.
  routeur: () => [r(7, 15, 50, 17, 3.5), r(12.5, 20, 13, 7, 1.5), c(42, 23.5, 1.3), c(47, 23.5, 1.3), c(52, 23.5, 1.3)],
  // Commutateur : 1U, deux rangées de ports. C'est ce qui le rend
  // immédiatement reconnaissable.
  commutateur: () => [r(4, 16, 56, 16, 2.5), c(9, 24, 1.2),
    serie(8, i => r(15 + i * 5.4, 19, 3.8, 3.2, 0.6)), serie(8, i => r(15 + i * 5.4, 25.8, 3.8, 3.2, 0.6))],
  // Borne : un palet. Ellipse du dessus, flanc court, aucune antenne.
  borne: () => [e(32, 20, 17, 5.5), t('M15 20v5a17 5.5 0 0 0 34 0v-5'), e(32, 20, 6, 2)],
  // Serveur : baies de disques à gauche, aérations à droite.
  serveur: () => [r(8, 11, 48, 22, 2.5), r(12, 14.5, 13, 4.2, 1), r(12, 20.4, 13, 4.2, 1), r(12, 26.3, 13, 4.2, 1),
    t('M31 15.5h20M31 19.5h20M31 23.5h20M31 27.5h20'), c(51.5, 31, 1.1)],
  // Carte nue : broches en haut, puce au centre, ports en bord de plaque.
  carte: () => [r(10, 12, 44, 21, 2), serie(10, i => r(14 + i * 2.6, 15, 1.4, 3, 0.4)),
    r(16, 22, 10, 7.5, 1), r(44, 20, 10, 5, 1), r(44, 27, 10, 4, 1)],
  // Ordinateur : portable ouvert, vu de face.
  ordinateur: () => [r(14, 10, 36, 22, 2), t('M8 33.5h48l-3.5-4.5H11.5z'), t('M27 31h10')],
  // Mobile : dalle verticale, écouteur en haut.
  mobile: () => [r(23, 7, 18, 28, 3.5), t('M29.5 11h5'), t('M23 30.5h18')],
  // Imprimante : la feuille SORT du corps au lieu de flotter au-dessus.
  imprimante: () => [t('M21 16V8h22v8'), r(9, 16, 46, 12, 2.5), t('M21 28v6h22v-6'), t('M25 31h14'), c(49, 22, 1.2)],
  // Caméra : tube, objectif à l'avant, potence de fixation.
  camera: () => [r(12, 13, 30, 14, 7), t('M42 15.5a4.5 4.5 0 0 1 0 9z'), c(38, 20, 3.6), c(38, 20, 1.4), t('M24 27v4M17 34h14')],
  // Prise connectée, vue de face : fentes verticales, terre au-dessus.
  objet: () => [r(18, 9, 28, 26, 7), c(32, 15.5, 1.6), r(26.5, 20, 2.6, 8, 1.3), r(34.9, 20, 2.6, 8, 1.3)],
  // Écran : dalle et pied.
  ecran: () => [r(9, 9, 46, 19, 2), t('M32 28v4M24 34h16')],
  // Inconnu : le pointillé dit qu'on n'a pas identifié, il ne prétend rien.
  inconnu: () => [r(13, 12, 38, 21, 4, { 'stroke-dasharray': '3 2.6' }), t('M29 20.5a3.2 3.2 0 1 1 3.6 3.1v1.8'), c(32.6, 28.6, 0.9)],
};

/** Silhouette d'un appareil, imbriquée dans le SVG de la carte. */
export function silhouette({ type, vendor, model, hostname, x, y, size = 56, color, dim }) {
  const famille = (vendor || model || hostname) ? familleAppareil({ type, vendor, model, hostname }) : familleDe(type);
  const dessin = (DESSINS[famille] || DESSINS.inconnu)();
  return s('svg', {
    viewBox: '0 0 64 40', x, y, width: size, height: (size * 40) / 64, overflow: 'visible',
    fill: 'none', stroke: color || 'currentColor', 'stroke-width': 1.5, 'stroke-linecap': 'round', 'stroke-linejoin': 'round',
    // Le trait ne doit pas maigrir quand la carte est dézoomée : sans ça, les
    // appareils disparaissent avant les liaisons.
    'vector-effect': 'non-scaling-stroke', opacity: dim ? 0.45 : 1, 'aria-hidden': 'true',
    style: { pointerEvents: 'none' },
  }, dessin);
}
