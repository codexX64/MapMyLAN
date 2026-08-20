// Design tokens — two looks of the same visual language.
//
//   light (default) — paper background, ink, a single blue accent used
//                     sparingly, red reserved for real risk.
//   dark            — same rules, neutrals inverted.
//
// All the historical keys (primary, ok, warn, glass, grad, radius…) are kept
// so that existing pages keep compiling without modification: they simply
// inherit from the new palette.

const SANS = "'Schibsted Grotesk', -apple-system, system-ui, sans-serif";
const MONO = "'IBM Plex Mono', ui-monospace, Menlo, monospace";

export const THEMES = {
  light: {
    id: "light",
    name: "Clair",
    layout: "minimal",

    bg: "#F6F6F3",
    surface: "#FFFFFF",
    surfaceHover: "#F1F1ED",
    well: "#F1F1ED",
    border: "#E5E5E0",
    hairSoft: "#EDEDE8",
    sidebar: "#F6F6F3",

    txt: "#14161A",
    txtSoft: "#3E434A",
    muted: "#858B93",
    faint: "#B2B7BD",

    primary: "#1B2AFF",
    accent: "#1B2AFF",
    wash: "#EEF0FF",
    ok: "#1B2AFF",
    info: "#1B2AFF",
    warn: "#B7791F",
    warnWash: "#FBF3E4",
    err: "#C8322B",
    alarmWash: "#FBEEED",

    lift: "0 1px 2px rgba(20,22,26,.05), 0 10px 26px -14px rgba(20,22,26,.16)",
    liftHi: "0 1px 2px rgba(20,22,26,.06), 0 18px 40px -18px rgba(20,22,26,.24)",
    grain: 0.05,

    font: SANS,
    monoFont: MONO,
    headFont: SANS,

    grad: "#14161A",
    onPrimary: "#F6F6F3",

    glass: "none",
    radius: 12,
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

    glass: "none",
    radius: 12,
    useEmoji: false,
    showSparklines: true,
    showHero: false,
    showGrid: false,
    densityRow: 52,
  },
} as const;

export type ThemeKey = keyof typeof THEMES;

export type Theme = (typeof THEMES)[ThemeKey] & {
  hi?: string; acc?: string;
  panel?: string; hover?: string; blur?: string;
  bodyFont?: string; ambient?: string; sideW?: number;
  useCisco?: boolean;
};

// Preferences saved before the redesign point to old themes: we bring them
// back to the light look instead of crashing.
const LEGACY: Record<string, ThemeKey> = {
  glass: "light", modern: "light", minimal: "light",
  enterprise: "dark", cyber: "dark", noc: "dark",
};

export function resolveTheme(key?: string | null): ThemeKey {
  if (key && key in THEMES) return key as ThemeKey;
  if (key && LEGACY[key]) return LEGACY[key];
  return "light";
}

// Legacy aliases: old components still read t.hi, t.panel, t.hover…
export function compatTheme(t: any): any {
  return {
    ...t,
    hi: t.primary,
    acc: t.accent,
    panel: t.surface,
    hover: t.surfaceHover,
    blur: t.glass,
    bodyFont: t.font,
    ambient: "none",
    sideW: 224,
    useCisco: false,
  };
}
