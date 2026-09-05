// Disposition « arborescence » de la carte.
//
// La disposition par étages, celle d'origine, range les appareils par NATURE :
// les passerelles en haut, les commutateurs en dessous, les machines ensuite.
// Elle répond bien à « qu'est-ce que j'ai ? ».
//
// Celle-ci répond à une autre question — « qu'est-ce qui pend de quoi ? » — et
// la dessine comme on câble vraiment : la passerelle à gauche, et à chaque
// colonne vers la droite ce qui se branche dessus. Un père est centré en face
// de ses fils, les liaisons se tracent en coudes à angle droit. C'est la
// lecture d'un schéma de baie, pas celle d'un inventaire.
//
// Le module ne dessine rien : il rend des coordonnées. Il n'a donc besoin ni
// de React ni du DOM, et se vérifie tout seul.

export interface AppareilArbre {
  id: string;
  type?: string | null;
  customType?: string | null;
  isMainRouter?: boolean;
  ip?: string | null;
  /** MAC de l'appareil, pour reconnaître l'équipement amont des autres. */
  mac?: string | null;
  /**
   * Ce que le contrôleur a MESURÉ sur cet appareil. C'est la hiérarchie réelle
   * du réseau, celle que l'interface du constructeur affiche : il n'y a rien à
   * en déduire, et elle est rafraîchie à chaque relevé alors que les liaisons
   * enregistrées, elles, datent de la dernière reconstruction.
   *
   *   uplinkMac — l'équipement dont ce matériel dépend, déclaré par lui-même
   *               (`/stat/device`, champ « uplink ») ;
   *   swMac     — le commutateur qui porte cet appareil ;
   *   apMac     — la borne qui le porte, et seulement s'il est en sans-fil :
   *               certains micrologiciels renseignent ce champ sur des
   *               appareils filaires, où il désigne l'amont et pas une borne.
   */
  uplinkMac?: string | null;
  swMac?: string | null;
  apMac?: string | null;
  medium?: string | null;
}

export interface LienArbre {
  fromId: string;
  toId: string;
  /** Tracée à la main par l'exploitant : elle prime sur toute mesure. */
  manual?: boolean;
}

export interface Pos { x: number; y: number }

export interface Arbre {
  positions: Record<string, Pos>;
  /** Le tronc vertical de chaque nœud qui porte plusieurs fils. */
  troncs: { x: number; y1: number; y2: number; depuis: string }[];
  /**
   * À quel nœud chaque appareil a été rattaché. La carte s'en sert pour tracer
   * l'attache d'un appareil dont aucune liaison n'est enregistrée : sans ça,
   * il serait posé au bon endroit mais relié à rien du tout.
   */
  rattachements: Record<string, string>;
}

/** Ce qui fait partie de l'ossature plutôt que des feuilles. */
const INFRA = new Set(["router", "gateway", "firewall", "switch", "ap", "accesspoint"]);

export function estInfra(d: AppareilArbre): boolean {
  if (d.isMainRouter) return true;
  return INFRA.has(String(d.customType || d.type || "").toLowerCase());
}

/** Écartements, en unités du dessin.
 *
 *  Un nœud de la carte est dessiné à 2,2× : sa plaque de 74 fait 163 de large,
 *  et ses trois lignes de libellé descendent 180 sous son centre. Une rangée
 *  occupe donc près de 260 — d'où le pas vertical ci-dessous, sinon le nom
 *  d'un appareil s'écrit sur la plaque du suivant. */
export const PAS_COLONNE = 380;
export const PAS_LIGNE = 290;
export const DEPART_X = 200;
export const AXE_Y = 700;

/** Ordre de l'ossature : pare-feu, routeurs, commutateurs, bornes. */
function rang(d: AppareilArbre): number {
  if (d.isMainRouter) return 0;
  const t = String(d.customType || d.type || "").toLowerCase();
  if (t === "firewall") return 1;
  if (t === "router" || t === "gateway") return 2;
  if (t === "switch") return 3;
  if (INFRA.has(t)) return 4;              // bornes
  return 5;                                // tout le reste : des feuilles
}

/** À nature égale, on range par adresse : deux relevés successifs donnent
 *  alors le même dessin, au lieu de bouger tout seuls d'un balayage à l'autre. */
function dernierOctet(ip?: string | null): number {
  const p = String(ip || "").split(".");
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
export function disposerEnArbre(
  appareils: AppareilArbre[],
  liens: LienArbre[] = [],
): Arbre {
  const positions: Record<string, Pos> = {};
  const troncs: Arbre["troncs"] = [];
  const rattachements: Record<string, string> = {};
  if (!appareils.length) return { positions, troncs, rattachements };

  const parId = new Map(appareils.map((d) => [d.id, d]));
  const ordonner = (a: AppareilArbre, b: AppareilArbre) =>
    rang(a) - rang(b) || dernierOctet(a.ip) - dernierOctet(b.ip);

  const infra = appareils.filter(estInfra).sort(ordonner);

  // ── 1. La racine ────────────────────────────────────────────────────────
  // La passerelle principale si elle est désignée, sinon l'équipement le plus
  // haut placé. Sans aucun équipement réseau, on prend le premier appareil :
  // le dessin devient une simple colonne, ce qui reste honnête.
  const racine = (infra[0] || appareils[0]).id;

  // ── 2. Qui pend de qui ──────────────────────────────────────────────────
  const enfants = new Map<string, string[]>();
  const vus = new Set<string>([racine]);

  const attacher = (id: string, pere: string) => {
    vus.add(id);
    rattachements[id] = pere;
    if (!enfants.has(pere)) enfants.set(pere, []);
    enfants.get(pere)!.push(id);
  };

  // Index MAC → appareil, pour lire les mesures du contrôleur.
  const parMac = new Map<string, string>();
  for (const d of appareils) {
    if (d.mac) parMac.set(String(d.mac).toUpperCase(), d.id);
  }
  const parLaMac = (m?: string | null) => (m ? parMac.get(String(m).toUpperCase()) : undefined);

  // Les liaisons, indexées par appareil, à la main et automatiques séparées.
  const voisins = new Map<string, string[]>();
  const voisinsManuels = new Map<string, string[]>();
  const noter = (table: Map<string, string[]>, a: string, b: string) => {
    if (!table.has(a)) table.set(a, []);
    table.get(a)!.push(b);
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
  const mesures = (d: AppareilArbre): (string | undefined)[] => [
    parLaMac(d.uplinkMac),
    parLaMac(d.swMac),
    // La borne ne vaut que pour un appareil dont le média est mesuré sans fil.
    String(d.medium || "").toLowerCase() === "wireless" ? parLaMac(d.apMac) : undefined,
  ];

  /**
   * Rattache tout ce qui peut l'être par une règle donnée. On ne se rattache
   * qu'à un nœud DÉJÀ placé : c'est ce qui garantit un arbre, même si les
   * mesures ou les liaisons forment une boucle.
   */
  const passe = (candidats: (d: AppareilArbre) => (string | undefined)[]): boolean => {
    let fait = false;
    for (const d of appareils) {
      if (vus.has(d.id)) continue;
      const pere = candidats(d).find((x) => x && x !== d.id && vus.has(x));
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
  const prochainInfra = (): boolean => {
    for (const d of infra) {
      if (vus.has(d.id)) { dernierInfra = d.id; continue; }
      attacher(d.id, dernierInfra);
      dernierInfra = d.id;
      return true;
    }
    return false;
  };

  for (;;) {
    if (passe((d) => voisinsManuels.get(d.id) || [])) continue;
    if (passe(mesures)) continue;
    if (passe((d) => voisins.get(d.id) || [])) continue;
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
    fils.sort((a, b) => ordonner(parId.get(a)!, parId.get(b)!));
  }

  // ── 3. Les colonnes ─────────────────────────────────────────────────────
  // Une colonne par génération : la profondeur dans l'arbre, pas la nature de
  // l'appareil. C'est ce qui distingue cette vue de celle par étages.
  const profondeur: Record<string, number> = { [racine]: 0 };
  const pile = [racine];
  while (pile.length) {
    const id = pile.pop()!;
    for (const f of enfants.get(id) || []) {
      profondeur[f] = profondeur[id] + 1;
      pile.push(f);
    }
  }

  // ── 4. Les lignes ───────────────────────────────────────────────────────
  // Chaque feuille prend la ligne suivante ; chaque père se centre en face de
  // ses fils. Deux sous-arbres ne peuvent donc pas se marcher dessus.
  const y: Record<string, number> = {};
  let ligne = 0;
  const poser = (id: string): number => {
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

  // ── 5. Les troncs ───────────────────────────────────────────────────────
  // Le trait vertical qui porte une fratrie. Un fils unique aligné sur son
  // père n'en a pas besoin : la liaison est alors une simple horizontale.
  for (const [idPere, fils] of enfants) {
    const pp = positions[idPere];
    if (!pp || !fils.length) continue;
    const ys = fils.map((f) => positions[f]?.y).filter((v) => v !== undefined) as number[];
    if (!ys.length) continue;
    const y1 = Math.min(...ys), y2 = Math.max(...ys);
    if (y1 === y2) continue;
    troncs.push({ x: pp.x + PAS_COLONNE / 2, y1, y2, depuis: idPere });
  }

  return { positions, troncs, rattachements };
}

/**
 * Le tracé d'une liaison en arborescence : deux coudes à angle droit plutôt
 * qu'une courbe. C'est ce qui donne au schéma sa lisibilité — l'œil suit une
 * horizontale et une verticale, pas une diagonale parmi douze autres.
 */
export function coude(a: Pos, b: Pos, xTronc?: number): string {
  const mx = xTronc ?? (a.x + b.x) / 2;
  if (Math.abs(a.y - b.y) < 0.5) return `M${a.x} ${a.y}H${b.x}`;
  return `M${a.x} ${a.y}H${mx}V${b.y}H${b.x}`;
}
