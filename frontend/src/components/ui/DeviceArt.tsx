// Illustrations d'appareils pour la carte.
//
// Les pictogrammes de `lib/icons` disent la CATÉGORIE : ils sont parfaits dans
// un tableau, une ligne de journal, un menu. Sur la carte, ils ne suffisent
// pas — une topologie se lit d'un coup d'œil, et on y reconnaît un matériel à
// sa silhouette avant de lire son nom. Un boîtier plat percé de deux rangées
// de ports EST un commutateur ; un picto abstrait, lui, demande à être décodé.
//
// D'où ce second jeu, réservé à la carte : des dessins au trait, vus de face,
// dans une boîte commune de 64 × 40 avec la même ligne d'assise, pour qu'une
// rangée d'appareils mélangés reste alignée. Un seul trait, `currentColor`,
// aucune couleur en dur : le thème décide.
//
// Ce sont des dessins originaux. Ils s'inspirent de la façon dont ce matériel
// se présente réellement — un routeur est plat et large, une borne est un
// palet, une caméra est un tube avec un objectif — et de rien d'autre.

import { CSSProperties } from "react";
import { familleDuModele } from "../../lib/modeles";

/**
 * Type d'appareil → famille de dessin.
 *
 * La table suit celle de `lib/icons` pour que le classifieur du backend soit
 * couvert de la même façon des deux côtés. Un type inconnu tombe sur le
 * boîtier en pointillé, qui dit honnêtement « on ne sait pas ».
 */
export const FAMILLE: Record<string, string> = {
  router: "routeur", gateway: "routeur", firewall: "routeur",
  switch: "commutateur",
  ap: "borne", accesspoint: "borne",
  server: "serveur", nas: "serveur", docker: "serveur", vm: "serveur",
  pi: "carte", raspberry: "carte",
  computer: "ordinateur", laptop: "ordinateur", desktop: "ordinateur", pc: "ordinateur",
  phone: "mobile", tablet: "mobile",
  printer: "imprimante",
  camera: "camera",
  iot: "objet", plug: "objet",
  tv: "ecran", console: "ecran",
  unknown: "inconnu",

  // Les noms de pictos de `lib/icons` sont acceptés aussi. Les deux
  // vocabulaires circulent dans l'application — un appareil porte un type, un
  // composant d'affichage reçoit parfois déjà le picto résolu — et une
  // silhouette manquante se voit tout de suite sur la carte : tout retombait
  // sur le boîtier en pointillé.
  chip: "ordinateur", air: "borne", cam: "camera",
  eye: "ecran", shield: "routeur",
};

export function familleDe(type?: string | null): string {
  if (!type) return "inconnu";
  return FAMILLE[String(type).toLowerCase()] || "inconnu";
}

/**
 * La famille à dessiner pour un appareil.
 *
 * Le modèle passe avant le type : le classifieur range un châssis de baie dans
 * « serveur », mais aussi un nano-ordinateur, et les deux ne se ressemblent
 * pas. Quand le modèle ne dit rien de reconnaissable, le type reprend la main.
 */
export function familleAppareil(d: {
  type?: string | null; customType?: string | null;
  vendor?: string | null; model?: string | null;
  hostname?: string | null; os?: string | null;
}): string {
  const parType = familleDe(d.customType || d.type);
  // Un type choisi à la main par l'exploitant l'emporte sur tout : il sait ce
  // qu'il a devant lui mieux qu'une table de motifs.
  if (d.customType) return parType;
  return familleDuModele(d) || parType;
}

/* Toutes les silhouettes tiennent dans 64 × 40, posées sur y = 34. */
const DESSINS: Record<string, JSX.Element> = {
  // Passerelle : boîtier plat, bandeau d'affichage à gauche, diodes à droite.
  routeur: (
    <>
      <rect x={7} y={15} width={50} height={17} rx={3.5} />
      <rect x={12.5} y={20} width={13} height={7} rx={1.5} />
      <circle cx={42} cy={23.5} r={1.3} />
      <circle cx={47} cy={23.5} r={1.3} />
      <circle cx={52} cy={23.5} r={1.3} />
    </>
  ),

  // Commutateur : 1U, deux rangées de ports. C'est ce qui le rend
  // immédiatement reconnaissable.
  commutateur: (
    <>
      <rect x={4} y={16} width={56} height={16} rx={2.5} />
      <circle cx={9} cy={24} r={1.2} />
      {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
        <rect key={"h" + i} x={15 + i * 5.4} y={19} width={3.8} height={3.2} rx={0.6} />
      ))}
      {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
        <rect key={"b" + i} x={15 + i * 5.4} y={25.8} width={3.8} height={3.2} rx={0.6} />
      ))}
    </>
  ),

  // Borne : un palet. Ellipse du dessus, flanc court, aucune antenne — les
  // bornes modernes n'en montrent pas.
  borne: (
    <>
      <ellipse cx={32} cy={20} rx={17} ry={5.5} />
      <path d="M15 20v5a17 5.5 0 0 0 34 0v-5" />
      <ellipse cx={32} cy={20} rx={6} ry={2} />
    </>
  ),

  // Serveur : baies de disques à gauche, aérations à droite.
  serveur: (
    <>
      <rect x={8} y={11} width={48} height={22} rx={2.5} />
      <rect x={12} y={14.5} width={13} height={4.2} rx={1} />
      <rect x={12} y={20.4} width={13} height={4.2} rx={1} />
      <rect x={12} y={26.3} width={13} height={4.2} rx={1} />
      <path d="M31 15.5h20M31 19.5h20M31 23.5h20M31 27.5h20" />
      <circle cx={51.5} cy={31} r={1.1} />
    </>
  ),

  // Carte nue : rangée de broches en haut, puce au centre, ports en bord de
  // plaque. Sans ces trois marques, elle se confondait avec le routeur.
  carte: (
    <>
      <rect x={10} y={12} width={44} height={21} rx={2} />
      {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => (
        <rect key={"p" + i} x={14 + i * 2.6} y={15} width={1.4} height={3} rx={0.4} />
      ))}
      <rect x={16} y={22} width={10} height={7.5} rx={1} />
      <rect x={44} y={20} width={10} height={5} rx={1} />
      <rect x={44} y={27} width={10} height={4} rx={1} />
    </>
  ),

  // Ordinateur : portable ouvert, vu de face.
  ordinateur: (
    <>
      <rect x={14} y={10} width={36} height={22} rx={2} />
      <path d="M8 33.5h48l-3.5-4.5H11.5z" />
      <path d="M27 31h10" />
    </>
  ),

  // Mobile : dalle verticale, écouteur en haut.
  mobile: (
    <>
      <rect x={23} y={7} width={18} height={28} rx={3.5} />
      <path d="M29.5 11h5" />
      <path d="M23 30.5h18" />
    </>
  ),

  // Imprimante : la feuille SORT du corps au lieu de flotter au-dessus.
  imprimante: (
    <>
      <path d="M21 16V8h22v8" />
      <rect x={9} y={16} width={46} height={12} rx={2.5} />
      <path d="M21 28v6h22v-6" />
      <path d="M25 31h14" />
      <circle cx={49} cy={22} r={1.2} />
    </>
  ),

  // Caméra : tube, objectif à l'avant, potence de fixation.
  camera: (
    <>
      <rect x={12} y={13} width={30} height={14} rx={7} />
      <path d="M42 15.5a4.5 4.5 0 0 1 0 9z" />
      <circle cx={38} cy={20} r={3.6} />
      <circle cx={38} cy={20} r={1.4} />
      <path d="M24 27v4M17 34h14" />
    </>
  ),

  // Prise connectée, vue de face. Deux points ronds et un trait dessinaient un
  // visage : les fentes sont donc verticales, et la terre au-dessus.
  objet: (
    <>
      <rect x={18} y={9} width={28} height={26} rx={7} />
      <circle cx={32} cy={15.5} r={1.6} />
      <rect x={26.5} y={20} width={2.6} height={8} rx={1.3} />
      <rect x={34.9} y={20} width={2.6} height={8} rx={1.3} />
    </>
  ),

  // Écran : dalle et pied.
  ecran: (
    <>
      <rect x={9} y={9} width={46} height={19} rx={2} />
      <path d="M32 28v4M24 34h16" />
    </>
  ),

  // Inconnu : le pointillé dit qu'on n'a pas identifié, il ne prétend rien.
  inconnu: (
    <>
      <rect x={13} y={12} width={38} height={21} rx={4} strokeDasharray="3 2.6" />
      <path d="M29 20.5a3.2 3.2 0 1 1 3.6 3.1v1.8" />
      <circle cx={32.6} cy={28.6} r={0.9} />
    </>
  ),
};

interface Props {
  type?: string | null;
  /** Indices de modèle, quand on les a : ils affinent la silhouette. */
  vendor?: string | null;
  model?: string | null;
  hostname?: string | null;
  /** Largeur rendue. La hauteur suit le rapport 64 × 40. */
  size?: number;
  color?: string;
  dim?: boolean;
  style?: CSSProperties;
  className?: string;
  /** Position, quand le dessin est imbriqué dans un autre SVG (la carte). */
  x?: number;
  y?: number;
}

export function DeviceArt({ type, vendor, model, hostname, size = 56, color, dim, style, className, x, y }: Props) {
  const famille = (vendor || model || hostname)
    ? familleAppareil({ type, vendor, model, hostname })
    : familleDe(type);
  const dessin = DESSINS[famille] || DESSINS.inconnu;
  return (
    <svg
      className={className}
      viewBox="0 0 64 40"
      x={x}
      y={y}
      width={size}
      height={(size * 40) / 64}
      overflow="visible"
      fill="none"
      stroke={color || "currentColor"}
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      // Le trait ne doit pas maigrir quand la carte est dézoomée : sans ça,
      // les appareils disparaissent avant les liaisons.
      vectorEffect="non-scaling-stroke"
      opacity={dim ? 0.45 : 1}
      style={style}
      aria-hidden="true"
    >
      {dessin}
    </svg>
  );
}
