// Glyphes de l'arborescence : des boîtiers pleins vus de face, à la manière
// d'un contrôleur de réseau. La carte libre garde ses silhouettes au trait ;
// l'arborescence se lit de loin, d'où des formes pleines et peu de détails.
// Les couleurs viennent des classes de mapmylan.css : le thème décide.
import { s } from '../dom.js';
import { langue } from '../i18n.js';

const NATURES = {
  router: 'passerelle', gateway: 'passerelle', firewall: 'passerelle', shield: 'passerelle',
  switch: 'commutateur',
  ap: 'borne', accesspoint: 'borne', air: 'borne',
  server: 'serveur', docker: 'serveur', container: 'serveur', vm: 'serveur', pi: 'serveur', raspberry: 'serveur',
  nas: 'stockage',
  camera: 'camera', cam: 'camera',
  iot: 'prise', plug: 'prise', sensor: 'prise',
  computer: 'poste', laptop: 'poste', desktop: 'poste', pc: 'poste', chip: 'poste',
  phone: 'mobile', tablet: 'mobile',
  printer: 'imprimante',
  tv: 'ecran', console: 'ecran', eye: 'ecran',
};

export const natureArbre = d => (d.isMainRouter ? 'passerelle' : NATURES[String(d.customType || d.type || '').toLowerCase()] || 'inconnu');

const r = (x, y, w, hh, rx, c) => s('rect', { x, y, width: w, height: hh, rx, class: c });
const o = (cx, cy, rr, c) => s('circle', { cx, cy, r: rr, class: c });
const p = (d, c) => s('path', { d, class: c });

const DESSINS = {
  internet: () => [o(24, 24, 15, 't'), p('M9 24h30M24 9c5 4.5 5 25.5 0 30M24 9c-5 4.5-5 25.5 0 30', 't')],
  passerelle: () => [r(5, 17, 38, 14, 3, 'c'), ...[11, 18, 25, 32].map(x => r(x, 22, 5, 4, 1, 'd'))],
  commutateur: () => [r(3, 19, 42, 10, 2, 'c'), ...[0, 1, 2, 3, 4, 5, 6, 7].map(i => r(7 + i * 4, 22.5, 2.6, 3, 0.5, 'd')), r(40, 22.5, 2, 3, 0, 'led')],
  borne: () => [o(24, 24, 17, 'disque'), o(24, 24, 15, 'anneau'), o(24, 24, 4.5, 'bleu')],
  serveur: () => [r(8, 12, 32, 10, 2, 'c'), r(8, 26, 32, 10, 2, 'c'), o(13, 17, 1.3, 'd'), o(13, 31, 1.3, 'd'), r(24, 16, 12, 2, 1, 'd'), r(24, 30, 12, 2, 1, 'd')],
  stockage: () => [r(12, 9, 24, 30, 3, 'c'), r(16, 14, 16, 4, 1, 'd'), r(16, 21, 16, 4, 1, 'd'), o(18, 33, 1.3, 'd')],
  camera: () => [r(9, 17, 26, 14, 7, 'c'), o(17, 24, 4, 'd'), o(17, 24, 1.6, 'm'), p('M35 24h5v10', 'tc')],
  prise: () => [r(12, 12, 24, 24, 6, 'c'), o(20, 24, 1.8, 'd'), o(28, 24, 1.8, 'd')],
  poste: () => [r(8, 11, 32, 21, 2, 'c'), r(11, 14, 26, 15, 1, 'd'), p('M20 36h8M24 32v4', 'tc')],
  mobile: () => [r(16, 8, 16, 32, 3, 'c'), r(18, 11, 12, 23, 1, 'd'), o(24, 37, 1.1, 'd')],
  imprimante: () => [r(14, 9, 20, 9, 1, 'c'), r(8, 18, 32, 14, 2, 'c'), r(14, 28, 20, 10, 1, 'd'), r(32, 22, 4, 2, 1, 'led')],
  ecran: () => [r(6, 11, 36, 22, 2, 'c'), r(9, 14, 30, 16, 1, 'd'), p('M18 38h12M24 33v5', 'tc')],
  inconnu: () => [o(24, 24, 14, 'tp'), p('M20.5 20.5a3.5 3.5 0 1 1 5 3.2c-1 .5-1.5 1.2-1.5 2.3M24 30.5h.01', 'tq')],
};

/** Le glyphe d'une nature, centré sur l'origine, de `taille` unités de côté. */
export function glypheArbre(nature, taille = 52) {
  return s('svg', { class: 'glyphe-arbre', viewBox: '0 0 48 48', x: -taille / 2, y: -taille / 2, width: taille, height: taille, overflow: 'visible', 'aria-hidden': 'true', style: { pointerEvents: 'none' } },
    (DESSINS[nature] || DESSINS.inconnu)());
}

/** La bande radio d'un client sans fil, telle que le contrôleur la nomme. */
export function bandeRadio(radio) {
  const ghz = { ng: 2.4, na: 5, '6e': 6 }[String(radio || '').toLowerCase()];
  return ghz ? `${ghz.toLocaleString(langue() === 'fr' ? 'fr-FR' : 'en-GB')} GHz` : null;
}
