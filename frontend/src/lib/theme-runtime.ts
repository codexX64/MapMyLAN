// Pont entre le thème TypeScript et le CSS.
//
// Pourquoi ce fichier existe
// --------------------------
// La maquette est écrite en CSS avec des variables : `var(--accent)`,
// `var(--hair)`, `var(--sans)`. Le frontend, lui, passe un objet `t` de
// composant en composant et écrit des styles en ligne. Les deux façons de
// faire sont bonnes, mais elles ne se parlent pas.
//
// Plutôt que de choisir — et donc de réécrire soit la maquette, soit les
// quinze pages existantes — on recopie le thème actif sur la racine du
// document sous la forme de variables CSS, avec exactement les mêmes noms que
// la maquette. Résultat :
//
//   - les composants existants continuent de lire `t.surface` : rien ne casse ;
//   - le CSS des étapes suivantes peut être repris de la maquette presque tel
//     quel, puisque `var(--surface)` existe désormais pour de vrai.
//
// On pose aussi `data-theme` et `data-shell` sur <html>, comme la maquette, ce
// qui permettra à l'étape 2 de distinguer les deux dispositions en CSS.

import { useEffect } from "react";
import { useStore } from "../stores/app";
import { THEMES, resolveTheme, TYPO, RAYONS, MOUVEMENT, type ThemeKey } from "./themes";

// Correspondance nom de variable CSS → clé du thème.
// Les noms sont ceux de la maquette : ne pas les renommer.
const COULEURS: Array<[string, keyof (typeof THEMES)["light"]]> = [
  ["--paper",         "bg"],
  ["--surface",       "surface"],
  ["--surface-hover", "surfaceHover"],
  ["--well",          "well"],
  ["--ink",           "txt"],
  ["--ink-soft",      "txtSoft"],
  ["--muted",         "muted"],
  ["--faint",         "faint"],
  ["--hair",          "border"],
  ["--hair-soft",     "hairSoft"],
  ["--accent",        "accent"],
  ["--wash",          "wash"],
  ["--alarm",         "err"],
  ["--alarm-wash",    "alarmWash"],
  ["--warn",          "warn"],
  ["--warn-wash",     "warnWash"],
  ["--lift",          "lift"],
  ["--lift-hi",       "liftHi"],
  ["--on-ink",        "onInk"],
];

/** Écrit le thème demandé sur <html>. Appelable hors React si besoin. */
export function appliquerTheme(cle: ThemeKey) {
  const t = THEMES[cle];
  const racine = document.documentElement;

  for (const [nom, champ] of COULEURS) {
    racine.style.setProperty(nom, String(t[champ]));
  }
  // typographie
  racine.style.setProperty("--sans", TYPO.famille.sans);
  racine.style.setProperty("--mono", TYPO.famille.mono);
  racine.style.setProperty("--corps", `${TYPO.taille.corps}px`);

  // grain : l'opacité change d'un thème à l'autre
  racine.style.setProperty("--grain", String(t.grain));

  // rayons
  racine.style.setProperty("--r-min", `${RAYONS.minuscule}px`);
  racine.style.setProperty("--r-petit", `${RAYONS.petit}px`);
  racine.style.setProperty("--r-ctrl", `${RAYONS.controle}px`);
  racine.style.setProperty("--r-carte", `${RAYONS.carte}px`);

  // mouvement
  racine.style.setProperty("--t-rapide", MOUVEMENT.rapide);
  racine.style.setProperty("--t-normal", MOUVEMENT.normal);
  racine.style.setProperty("--t-lent", MOUVEMENT.lent);
  racine.style.setProperty("--courbe", MOUVEMENT.courbe);

  // attribut lisible en CSS et dans l'inspecteur
  racine.setAttribute("data-theme", cle);
  // indique au navigateur la teinte des ascenseurs et des champs natifs
  racine.style.colorScheme = cle === "dark" ? "dark" : "light";
}

/** Écrit la disposition courante sur <html> — utilisée à partir de l'étape 2. */
export function appliquerDisposition(shell: "reading" | "workshop") {
  document.documentElement.setAttribute("data-shell", shell);
}

/**
 * À appeler une seule fois, tout en haut de l'application.
 * Suit le magasin : dès que l'apparence ou la disposition change, les
 * variables CSS suivent. La bascule clair/sombre fonctionne exactement comme
 * aujourd'hui, c'est toujours `setTheme` du magasin qui la déclenche.
 */
export function useApparence() {
  const themeKey = useStore((s) => s.themeKey);
  const shell = useStore((s) => s.shell);

  useEffect(() => { appliquerTheme(resolveTheme(themeKey)); }, [themeKey]);
  useEffect(() => { appliquerDisposition(shell); }, [shell]);
}
