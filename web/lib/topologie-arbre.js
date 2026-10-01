// Disposition « arborescence » de la carte.
//
// La disposition par étages, celle d'origine, range les appareils par NATURE :
// les passerelles en haut, les commutateurs en dessous, les machines ensuite.
// Elle répond bien à « qu'est-ce que j'ai ? ».
//
// Celle-ci répond à une autre question — « qu'est-ce qui pend de quoi ? » — et
// la dessine comme un contrôleur de réseau : la passerelle à gauche, et à
// chaque colonne vers la droite ce qui se branche dessus. Un père est centré en
// face de ses fils, les liaisons sont des courbes qui partent et arrivent à
// l'horizontale.
//
// Le module ne dessine rien : il rend des coordonnées. Il n'a donc pas besoin
// du DOM, et se vérifie tout seul.

/** Ce qui fait partie de l'ossature plutôt que des feuilles. */
const INFRA = new Set(['router', 'gateway', 'firewall', 'switch', 'ap', 'accesspoint']);

export function estInfra(d) {
  if (d.isMainRouter) return true;
  return INFRA.has(String(d.customType || d.type || '').toLowerCase());
}

/** Écartements, en unités du dessin.
 *
 *  Un nœud de l'arborescence est dessiné à 2,2× : la radio d'un client sans
 *  fil monte à 80 au-dessus de son centre, son nom et son adresse descendent
 *  à 130 en dessous. Une rangée occupe donc un peu plus de 210 — d'où le pas
 *  vertical ci-dessous, sinon l'adresse d'un appareil touche la radio du
 *  suivant. */
export const PAS_COLONNE = 380;
export const PAS_LIGNE = 290;
export const DEPART_X = 200;
export const AXE_Y = 700;

/** Ordre de l'ossature : pare-feu, routeurs, commutateurs, bornes. */
function rang(d) {
  if (d.isMainRouter) return 0;
  const t = String(d.customType || d.type || '').toLowerCase();
  if (t === 'firewall') return 1;
  if (t === 'router' || t === 'gateway') return 2;
  if (t === 'switch') return 3;
  // Les bornes ; tout le reste est une feuille.
  if (INFRA.has(t)) return 4;
  return 5;
}

/** À nature égale, on range par adresse : deux relevés successifs donnent
 *  alors le même dessin, au lieu de bouger tout seuls d'un balayage à l'autre. */
function dernierOctet(ip) {
  const p = String(ip || '').split('.');
  return Number(p[3]) || 0;
}

/**
 * Range les appareils en arborescence.
 *
 * Le père de chaque appareil est cherché dans cet ordre, du plus sûr au moins
 * sûr — et un père trouvé par une règle n'est jamais remis en cause par une
 * règle inférieure :
 *
 *   1. une liaison tracée À LA MAIN : l'exploitant sait ce qu'il a câblé ;
 *   2. ce que le contrôleur a MESURÉ — l'amont déclaré par l'équipement
 *      lui-même, puis le commutateur qui porte l'appareil, puis la borne s'il
 *      est en sans-fil. C'est la hiérarchie que l'interface du constructeur
 *      affiche, et elle est rafraîchie à chaque relevé ;
 *   3. une liaison enregistrée par la reconstruction automatique. Elle vient
 *      des mêmes mesures, mais telles qu'elles étaient à la dernière
 *      reconstruction : elle passe donc APRÈS la mesure du jour ;
 *   4. faute de tout cela, l'ossature se chaîne et le reste rejoint la racine.
 *
 * Le repli sur la racine n'est pas un détail. Une version précédente retombait
 * sur le DERNIER équipement de la colonne, et comme la colonne est rangée par
 * nature — passerelle, commutateur, borne — le dernier était la borne Wi-Fi.
 * Tout appareil sans liaison connue se retrouvait accroché à un point d'accès
 * qui n'avait aucun client, ce qui est faux et se voit tout de suite.
 */
export function disposerEnArbre(appareils, liens = []) {
  const positions = {};
  const rattachements = {};
  if (!appareils.length) return { positions, rattachements, racine: null };

  const parId = new Map(appareils.map(d => [d.id, d]));
  const ordonner = (a, b) => rang(a) - rang(b) || dernierOctet(a.ip) - dernierOctet(b.ip);

  const infra = appareils.filter(estInfra).sort(ordonner);

  // La racine : la passerelle principale si elle est désignée, sinon
  // l'équipement le plus haut placé. Sans aucun équipement réseau, on prend
  // le premier appareil : le dessin devient une simple colonne, ce qui reste
  // honnête.
  const racine = (infra[0] || appareils[0]).id;

  const enfants = new Map();
  const vus = new Set([racine]);

  const attacher = (id, pere) => {
    vus.add(id);
    rattachements[id] = pere;
    if (!enfants.has(pere)) enfants.set(pere, []);
    enfants.get(pere).push(id);
  };

  // Index MAC → appareil, pour lire les mesures du contrôleur.
  const parMac = new Map();
  for (const d of appareils) {
    if (d.mac) parMac.set(String(d.mac).toUpperCase(), d.id);
  }
  const parLaMac = m => (m ? parMac.get(String(m).toUpperCase()) : undefined);

  // Les liaisons, indexées par appareil, à la main et automatiques séparées.
  const voisins = new Map();
  const voisinsManuels = new Map();
  const noter = (table, a, b) => {
    if (!table.has(a)) table.set(a, []);
    table.get(a).push(b);
  };
  for (const l of liens) {
    if (!parId.has(l.fromId) || !parId.has(l.toId)) continue;
    noter(voisins, l.fromId, l.toId);
    noter(voisins, l.toId, l.fromId);
    if (l.manual) {
      noter(voisinsManuels, l.fromId, l.toId);
      noter(voisinsManuels, l.toId, l.fromId);
    }
  }

  /** Ce que le contrôleur a mesuré sur cet appareil, du plus précis au moins. */
  const mesures = d => [
    parLaMac(d.uplinkMac),
    parLaMac(d.swMac),
    // La borne ne vaut que pour un appareil dont le média est mesuré sans fil.
    String(d.medium || '').toLowerCase() === 'wireless' ? parLaMac(d.apMac) : undefined,
  ];

  /**
   * Rattache tout ce qui peut l'être par une règle donnée. On ne se rattache
   * qu'à un nœud DÉJÀ placé : c'est ce qui garantit un arbre, même si les
   * mesures ou les liaisons forment une boucle.
   */
  const passe = candidats => {
    let fait = false;
    for (const d of appareils) {
      if (vus.has(d.id)) continue;
      const pere = candidats(d).find(x => x && x !== d.id && vus.has(x));
      if (!pere) continue;
      attacher(d.id, pere);
      fait = true;
    }
    return fait;
  };

  // Faute de tout le reste, l'ossature se chaîne — passerelle → commutateur →
  // borne, comme un câblage de baie. Un seul équipement à la fois : une fois
  // placé, il peut rendre rattachables des appareils par les règles du dessus,
  // qui sont meilleures.
  let dernierInfra = racine;
  const prochainInfra = () => {
    for (const d of infra) {
      if (vus.has(d.id)) { dernierInfra = d.id; continue; }
      attacher(d.id, dernierInfra);
      dernierInfra = d.id;
      return true;
    }
    return false;
  };

  for (;;) {
    if (passe(d => voisinsManuels.get(d.id) || [])) continue;
    if (passe(mesures)) continue;
    if (passe(d => voisins.get(d.id) || [])) continue;
    if (prochainInfra()) continue;
    break;
  }

  // Ce que rien n'a permis de rattacher rejoint la racine. Surtout pas le
  // dernier équipement de la colonne : rangée par nature, elle se termine par
  // la borne Wi-Fi, et tout le parc inconnu s'y accrochait.
  for (const d of appareils) {
    if (!vus.has(d.id)) attacher(d.id, racine);
  }

  for (const [, fils] of enfants) {
    fils.sort((a, b) => ordonner(parId.get(a), parId.get(b)));
  }

  // Une colonne par génération : la profondeur dans l'arbre, pas la nature de
  // l'appareil. C'est ce qui distingue cette vue de celle par étages.
  const profondeur = { [racine]: 0 };
  const pile = [racine];
  while (pile.length) {
    const id = pile.pop();
    for (const f of enfants.get(id) || []) {
      profondeur[f] = profondeur[id] + 1;
      pile.push(f);
    }
  }

  // Chaque feuille prend la ligne suivante ; chaque père se centre en face de
  // ses fils. Deux sous-arbres ne peuvent donc pas se marcher dessus.
  const y = {};
  let ligne = 0;
  const poser = id => {
    const fils = enfants.get(id) || [];
    if (!fils.length) {
      y[id] = ligne * PAS_LIGNE;
      ligne += 1;
      return y[id];
    }
    const bornes = fils.map(poser);
    y[id] = (bornes[0] + bornes[bornes.length - 1]) / 2;
    return y[id];
  };
  poser(racine);

  // On ramène la racine sur l'axe : le dessin s'ouvre là où l'œil l'attend.
  const decalage = AXE_Y - y[racine];
  for (const d of appareils) {
    if (y[d.id] === undefined) continue;
    positions[d.id] = {
      x: DEPART_X + (profondeur[d.id] || 0) * PAS_COLONNE,
      y: y[d.id] + decalage,
    };
  }

  return { positions, rattachements, racine };
}

/**
 * Le tracé d'une liaison dans l'arborescence dessinée à la manière d'un
 * contrôleur : une courbe qui quitte le père à l'horizontale et arrive au fils
 * à l'horizontale. `marge` laisse le trait au bord des glyphes, pas dessous.
 */
export function courbeArbre(a, b, marge = 0) {
  const [g, d] = a.x <= b.x ? [a, b] : [b, a];
  const x1 = g.x + marge, x2 = d.x - marge, m = (x1 + x2) / 2;
  return `M${x1} ${g.y}C${m} ${g.y} ${m} ${d.y} ${x2} ${d.y}`;
}
