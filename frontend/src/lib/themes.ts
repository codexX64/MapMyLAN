// Jetons de style — la maquette, transposée en TypeScript.
//
// Deux apparences d'un même langage visuel :
//
//   light (défaut) — fond papier, encre, un seul accent bleu utilisé au
//                    compte-gouttes, rouge réservé au risque réel.
//   dark           — mêmes règles, neutres inversés.
//
// Ce fichier contient trois choses :
//
//   1. THEMES          les valeurs qui changent selon l'apparence (couleurs,
//                      ombres, grain).
//   2. TYPO / RAYONS / ESPACE / MOUVEMENT
//                      les valeurs qui ne changent pas d'une apparence à
//                      l'autre. Elles vivent à part pour ne pas être écrites
//                      deux fois.
//   3. compatTheme()   assemble le tout et rajoute les alias hérités, pour que
//                      les pages existantes continuent de compiler sans
//                      la moindre modification.
//
// Toutes les clés historiques (primary, ok, warn, glass, grad, radius…) sont
// conservées. Rien de ce qui lisait `t.quelquechose` hier ne casse aujourd'hui.

const SANS = "'Schibsted Grotesk', -apple-system, system-ui, sans-serif";
const MONO = "'IBM Plex Mono', ui-monospace, Menlo, monospace";

// ───────────────────────────────────────────────────────────────────────────
// 1. Ce qui change avec l'apparence
// ───────────────────────────────────────────────────────────────────────────

export const THEMES = {
  light: {
    id: "light",
    name: "Clair",
    layout: "minimal",

    // fonds
    bg: "#F6F6F3",          // --paper
    surface: "#FFFFFF",     // --surface
    surfaceHover: "#F1F1ED",
    well: "#F1F1ED",        // --well : creux, champs de saisie, pastilles
    border: "#E5E5E0",      // --hair
    hairSoft: "#EDEDE8",    // --hair-soft : filets internes, plus discrets
    sidebar: "#F6F6F3",

    // encres
    txt: "#14161A",         // --ink
    txtSoft: "#3E434A",     // --ink-soft
    muted: "#858B93",       // --muted
    faint: "#B2B7BD",       // --faint : capitales, unités, notes

    // accent unique
    primary: "#1B2AFF",
    accent: "#1B2AFF",      // --accent
    wash: "#EEF0FF",        // --wash : fond d'accent très dilué
    ok: "#1B2AFF",
    info: "#1B2AFF",

    // alertes
    warn: "#B7791F",
    warnWash: "#FBF3E4",
    err: "#C8322B",         // --alarm
    alarmWash: "#FBEEED",   // --alarm-wash

    // relief
    lift: "0 1px 2px rgba(20,22,26,.05), 0 10px 26px -14px rgba(20,22,26,.16)",
    liftHi: "0 1px 2px rgba(20,22,26,.06), 0 18px 40px -18px rgba(20,22,26,.24)",
    grain: 0.05,

    // texte
    font: SANS,
    monoFont: MONO,
    headFont: SANS,

    // encre pleine (boutons pleins, pastille du logo)
    grad: "#14161A",
    onPrimary: "#F6F6F3",
    onInk: "#F6F6F3",

    glass: "none",
    radius: 9,              // rayon des contrôles — cf. note ci-dessous
    radiusCard: 14,
    useEmoji: false,
    showSparklines: true,
    showHero: false,
    showGrid: false,
    densityRow: 52,
  },

  dark: {
    id: "dark",
    name: "Sombre",
    layout: "minimal",

    bg: "#0D0E10",
    surface: "#16181B",
    surfaceHover: "#1C1F23",
    well: "#101215",
    border: "#23262A",
    hairSoft: "#1C1F22",
    sidebar: "#0D0E10",

    txt: "#ECEEF1",
    txtSoft: "#C3C8CF",
    muted: "#858C95",
    faint: "#575E66",

    primary: "#8089FF",
    accent: "#8089FF",
    wash: "#1A1D31",
    ok: "#8089FF",
    info: "#8089FF",

    warn: "#D9A441",
    warnWash: "#241E12",
    err: "#F06B63",
    alarmWash: "#2A1918",

    lift: "0 1px 2px rgba(0,0,0,.4), 0 12px 30px -16px rgba(0,0,0,.7)",
    liftHi: "0 1px 2px rgba(0,0,0,.5), 0 20px 44px -20px rgba(0,0,0,.85)",
    grain: 0.035,

    font: SANS,
    monoFont: MONO,
    headFont: SANS,

    grad: "#ECEEF1",
    onPrimary: "#0D0E10",
    onInk: "#0D0E10",

    glass: "none",
    radius: 9,
    radiusCard: 14,
    useEmoji: false,
    showSparklines: true,
    showHero: false,
    showGrid: false,
    densityRow: 52,
  },
} as const;

export type ThemeKey = keyof typeof THEMES;

// ───────────────────────────────────────────────────────────────────────────
// 2. Ce qui ne change pas avec l'apparence
// ───────────────────────────────────────────────────────────────────────────

// Échelle de tailles relevée dans la maquette. Les noms disent l'usage, pas la
// dimension : on change une valeur ici plutôt que de la chasser dans vingt
// fichiers.
export const TYPO = {
  famille: { sans: SANS, mono: MONO },

  // corps de texte, en pixels (les styles en ligne de React attendent des nombres)
  taille: {
    micro: 8,        // étiquettes minuscules sur la carte
    minuscule: 9.5,  // adresses IP sur les nœuds
    capitale: 10,    // titres de groupe en capitales
    note: 10.5,      // en-têtes de colonnes, libellés de champs
    petit: 11,       // compteurs, unités
    tableau: 11.5,   // cellules secondaires, pastilles
    corps2: 12.5,    // texte courant dense
    corps: 13.5,     // texte courant — référence du body
    bouton: 13,
    titreCarte: 13.5,
    chiffre: 19,     // valeurs des cartes de compte
    titre: 20,
    titreGrand: 26,
    heros: 32,
  },

  // graisses
  graisse: { normal: 400, moyen: 500, demi: 600, gras: 700 },

  // interlettrage : négatif sur les titres, ouvert sur les capitales
  chasse: {
    titreGrand: "-0.03em",
    titre: "-0.022em",
    serre: "-0.01em",
    normal: "0",
    capitale: "0.12em",
    capitaleLarge: "0.16em",
  },

  // hauteurs de ligne
  ligne: { serree: 1.12, titre: 1.25, corps: 1.55, aere: 1.9 },
} as const;

// Rayons. La maquette n'en utilise que quatre familles.
export const RAYONS = {
  minuscule: 4,   // pastilles de gravité
  petit: 6,       // touches clavier, marqueurs
  controle: 9,    // boutons, champs, menus déroulants
  carte: 14,      // cartes, vignettes, photos d'appareil
  rond: 999,      // pastilles rondes et jauges
} as const;

// Pas d'espacement. La maquette respire par multiples de ~4 px.
export const ESPACE = {
  xs: 4, s: 7, m: 10, l: 14, xl: 18, xxl: 22, xxxl: 26,
} as const;

// Durées et courbes. Une seule courbe pour tout ce qui glisse.
export const MOUVEMENT = {
  rapide: "0.16s",
  normal: "0.2s",
  lent: "0.42s",
  courbe: "cubic-bezier(.2,.8,.3,1)",
} as const;

// Grain du papier — l'image est partagée, seule son opacité change de thème.
export const GRAIN_URL =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='3'/%3E%3C/filter%3E%3Crect width='160' height='160' filter='url(%23n)'/%3E%3C/svg%3E\")";

// ───────────────────────────────────────────────────────────────────────────
// 3. Résolution et compatibilité
// ───────────────────────────────────────────────────────────────────────────

export type Theme = (typeof THEMES)[ThemeKey] & {
  hi?: string; acc?: string;
  panel?: string; hover?: string; blur?: string;
  bodyFont?: string; ambient?: string; sideW?: number;
  useCisco?: boolean;
  typo?: typeof TYPO; fs?: typeof TYPO.taille;
  r?: typeof RAYONS; esp?: typeof ESPACE; mvt?: typeof MOUVEMENT;
};

// Les préférences enregistrées avant le redesign pointent vers d'anciens
// thèmes : on les ramène vers l'apparence claire au lieu de planter.
const LEGACY: Record<string, ThemeKey> = {
  glass: "light", modern: "light", minimal: "light",
  enterprise: "dark", cyber: "dark", noc: "dark",
};

export function resolveTheme(key?: string | null): ThemeKey {
  if (key && key in THEMES) return key as ThemeKey;
  if (key && LEGACY[key]) return LEGACY[key];
  return "light";
}

// Assemble le thème complet tel que le voient les composants.
//
//   - alias hérités : d'anciens composants lisent encore t.hi, t.panel, t.hover…
//   - jetons partagés : t.fs (tailles), t.r (rayons), t.esp (espaces),
//     t.mvt (mouvement), t.typo (typographie complète).
export function compatTheme(t: any): any {
  return {
    ...t,

    // alias hérités — ne pas retirer sans relire les pages
    hi: t.primary,
    acc: t.accent,
    panel: t.surface,
    hover: t.surfaceHover,
    blur: t.glass,
    bodyFont: t.font,
    ambient: "none",
    sideW: 226,          // largeur du rail dans la maquette
    useCisco: false,

    // jetons partagés
    typo: TYPO,
    fs: TYPO.taille,
    fw: TYPO.graisse,
    ls: TYPO.chasse,
    lh: TYPO.ligne,
    r: RAYONS,
    esp: ESPACE,
    mvt: MOUVEMENT,
    grainUrl: GRAIN_URL,
  };
}
