// Construction du DOM et primitives d'interface de MapMyLAN.
//
// Tout passe par h() et s(), qui écrivent du texte, des attributs et des
// nœuds, jamais du balisage : aucune donnée n'est interprétée comme HTML. Les
// styles s'écrivent par l'objet style de l'élément (CSSOM), ce que la
// politique de contenu du socle autorise, et non par un attribut style=.
//
// Les primitives émettent les classes de soma.css et de mapmylan.css, sans
// couleur en dur : tout vient des variables du thème.
import { icone, ajouterPictos, feuille } from '/socle/compte.js';

const SVG = 'http://www.w3.org/2000/svg';

// Propriétés dont un nombre n'est pas une longueur.
const SANS_UNITE = new Set(['opacity', 'zIndex', 'fontWeight', 'flex', 'flexGrow', 'flexShrink', 'lineHeight', 'order']);

function styler(el, style) {
  for (const [k, v] of Object.entries(style)) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('--')) el.style.setProperty(k, String(v));
    else el.style[k] = typeof v === 'number' && !SANS_UNITE.has(k) ? `${v}px` : String(v);
  }
}

function enfanter(el, enfants) {
  for (const e of enfants.flat(Infinity)) {
    if (e === null || e === undefined || e === false || e === true) continue;
    el.append(e instanceof Node ? e : String(e));
  }
}

/**
 * Élément HTML. props : class, text, style (objet), dataset, on<événement>
 * (en minuscules : onclick, oninput…), value et checked posés après les
 * enfants (un <select> n'a sa valeur qu'une fois ses options présentes).
 */
export function h(tag, props = {}, ...enfants) {
  const el = document.createElement(tag);
  let valeur, coche;
  for (const [k, v] of Object.entries(props || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k === 'style') styler(el, v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'value') valeur = v;
    else if (k === 'checked') coche = v;
    else if (k === 'ref') v(el);
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  enfanter(el, enfants);
  if (valeur !== undefined) el.value = String(valeur);
  if (coche !== undefined) el.checked = !!coche;
  return el;
}

/**
 * Remplace le contenu d'un élément. Contrairement à replaceChildren, un
 * enfant absent (null, false) ne devient pas le texte « null » et un
 * tableau est déplié au lieu d'être écrit « a,b ».
 */
export function remplir(el, ...enfants) {
  el.replaceChildren();
  enfanter(el, enfants);
  return el;
}

/** Élément SVG : les attributs s'écrivent sous leur nom SVG (stroke-width…). */
export function s(tag, attrs = {}, ...enfants) {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'style') styler(el, v);
    else if (k === 'text') el.textContent = v;
    else if (k === 'ref') v(el);
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  enfanter(el, enfants);
  return el;
}

// Jeu de pictos dessiné pour MapMyLAN, recentré dans sa boîte de 24 × 24.
// Préfixés « m: » pour ne jamais remplacer un picto du socle du même nom.
const PICTOS = {
  overview: '<rect x="3.5" y="3.5" width="7.5" height="7.5" rx="2.2"/><rect x="13" y="3.5" width="7.5" height="7.5" rx="2.2"/><rect x="3.5" y="13" width="7.5" height="7.5" rx="2.2"/><rect x="13" y="13" width="7.5" height="7.5" rx="2.2"/>',
  map: '<circle cx="12" cy="5.5" r="2.5"/><circle cx="5.5" cy="18" r="2.5"/><circle cx="18.5" cy="18" r="2.5"/><path d="M10.2 7.4 7 15.7M13.8 7.4 17 15.7M8 18h8"/>',
  devices: '<rect x="3.5" y="4" width="17" height="6" rx="2"/><rect x="3.5" y="14" width="17" height="6" rx="2"/><path d="M7 7h.01M7 17h.01"/>',
  auto: '<g transform="translate(0.5 0.0)"><path d="M13 3 5.5 13.5H11L10 21l7.5-10.5H12z"/></g>',
  shield: '<g transform="translate(0.0 0.35)"><path d="M12 3.2 19 6v5.2c0 4.4-2.9 7.5-7 8.9-4.1-1.4-7-4.5-7-8.9V6z"/><path d="M9.6 11.8 11.4 13.6 15 10"/></g>',
  ban: '<circle cx="12" cy="12" r="8.5"/><path d="M6 6l12 12"/>',
  chip: '<rect x="6" y="6" width="12" height="12" rx="2.4"/><rect x="9.5" y="9.5" width="5" height="5" rx="1.2"/><path d="M9 3v3M15 3v3M9 18v3M15 18v3M3 9h3M3 15h3M18 9h3M18 15h3"/>',
  settings: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2.2"/><circle cx="7.5" cy="17" r="2.2"/>',
  router: '<rect x="3.5" y="13" width="17" height="7" rx="2"/><path d="M7 16.5h.01M10.5 16.5h.01"/><path d="M8.6 9.4a4.8 4.8 0 0 1 6.8 0M6 6.8a8.5 8.5 0 0 1 12 0"/>',
  switch: '<rect x="3" y="6.8" width="18" height="8" rx="2"/><path d="M7 14.8v2.4M11 14.8v2.4M15 14.8v2.4M17.5 10.8h.01"/>',
  server: '<rect x="3.5" y="4.5" width="17" height="6" rx="1.8"/><rect x="3.5" y="13.5" width="17" height="6" rx="1.8"/><path d="M7 7.5h.01M7 16.5h.01M16 7.5h2M16 16.5h2"/>',
  plug: '<path d="M9 3v4.5M15 3v4.5M6.5 7.5h11v3.2a5.5 5.5 0 0 1-11 0z"/><path d="M12 16.2V21"/>',
  cam: '<path d="M3 8.9 16.5 5.3l1.6 5.2L4.5 14.1z"/><path d="M6 13.7v3.2a2 2 0 0 0 2 2h1.6a2 2 0 0 0 2-2v-2"/><circle cx="18.9" cy="16.3" r="2.1"/>',
  printer: '<path d="M7 8.5V3.5h10v5"/><rect x="3.5" y="8.5" width="17" height="7" rx="2"/><path d="M7 13h10v7.5H7z"/>',
  pi: '<rect x="4" y="6" width="16" height="12" rx="2"/><path d="M7.5 9.5h4M7.5 12.5h2"/><rect x="14" y="9.5" width="3.5" height="5" rx="1"/>',
  unknown: '<circle cx="12" cy="12" r="8.6" stroke-dasharray="3.2 3.4"/><path d="M9.7 9.9a2.4 2.4 0 1 1 2.9 2.35v1.05"/><path d="M12.6 16.4h.01"/>',
  wired: '<path d="M4 12h5M15 12h5"/><rect x="9" y="8.6" width="6" height="6.8" rx="1.6"/>',
  // Les deux agencements de la carte. « libre » : des plaques posées où on
  // veut, reliées par des traits obliques. « arbre » : une racine et des
  // branches à angle droit — la forme même du dessin qu'ils produisent.
  libre: '<rect x="3" y="4" width="5" height="4.4" rx="1.5"/><rect x="15.5" y="8" width="5" height="4.4" rx="1.5"/><rect x="7" y="15.4" width="5" height="4.4" rx="1.5"/><path d="M8.2 7.1 15.4 10M15.8 12.6 11.9 15.5"/>',
  arbre: '<rect x="2.5" y="9.6" width="5" height="4.8" rx="1.5"/><rect x="16.5" y="3.6" width="5" height="4.4" rx="1.5"/><rect x="16.5" y="15.6" width="5" height="4.4" rx="1.5"/><path d="M7.5 12h4.6V5.8h4.4M12.1 12v5.8h4.4"/>',
  air: '<g transform="translate(0.0 -1.11)"><path d="M8.6 13.6a4.8 4.8 0 0 1 6.8 0M5.6 10.4a9 9 0 0 1 12.8 0"/><circle cx="12" cy="17.4" r="1.1" fill="currentColor" stroke="none"/></g>',
  search: '<g transform="translate(-0.5 -0.5)"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/></g>',
  refresh: '<path d="M20 11.4a8.2 8.2 0 1 0-1.9 6.2"/><path d="M20.5 5v5h-5"/>',
  export: '<g transform="translate(0.0 1.0)"><path d="M12 3.5v10M8.2 10l3.8 3.8 3.8-3.8M4.5 18.5h15"/></g>',
  sparkle: '<path d="M12 3.5c.6 3.8 2.2 5.4 6 6-3.8.6-5.4 2.2-6 6-.6-3.8-2.2-5.4-6-6 3.8-.6 5.4-2.2 6-6z"/><path d="M18.5 15.5c.3 1.7 1 2.4 2.5 2.7-1.5.3-2.2 1-2.5 2.7-.3-1.7-1-2.4-2.5-2.7 1.5-.3 2.2-1 2.5-2.7z"/>',
  plus: '<path d="M12 5.5v13M5.5 12h13"/>',
  pair: '<circle cx="9" cy="12" r="5.2"/><circle cx="15" cy="12" r="5.2"/>',
  bell: '<path d="M6.5 10a5.5 5.5 0 0 1 11 0c0 4 1.6 5.6 1.6 5.6H4.9S6.5 14 6.5 10z"/><path d="M10.2 18.6a2 2 0 0 0 3.6 0"/>',
  mode: '<circle cx="12" cy="12" r="8.4"/><path d="M12 3.6v16.8a8.4 8.4 0 0 0 0-16.8z" fill="currentColor" stroke="none"/>',
  alert: '<path d="M12 4.6 20.5 19.4h-17z"/><path d="M12 10v4M12 16.8h.01"/>',
  clock: '<circle cx="12" cy="12" r="8.4"/><path d="M12 7.4V12l3 1.8"/>',
  port: '<g transform="translate(0.0 -1.25)"><rect x="4.5" y="7" width="15" height="10" rx="2"/><path d="M8.5 17v2.5M15.5 17v2.5M9 11h6"/></g>',
  logo: '<circle cx="12" cy="6.4" r="2.1"/><circle cx="6" cy="17.4" r="2.1"/><circle cx="18" cy="17.4" r="2.1"/><path d="M10.4 8.1 7.3 15.4M13.6 8.1 16.7 15.4M8 17.9h8"/>',
  vlan: '<path d="M4 6h6M14 6h6M4 18h6M14 18h6"/><path d="M10 6c0 6 4 6 4 12M14 6c0 6-4 6-4 12"/>',
  ssh: '<rect x="3.2" y="4.5" width="17.6" height="15" rx="2.4"/><path d="M7.5 10l2.6 2.2-2.6 2.2M12.6 14.6h4"/>',
  logs: '<path d="M5 5h14M5 9.6h14M5 14.2h9M5 18.8h6"/>',
  report: '<g transform="translate(0.0 -1.0)"><path d="M5 19V9.5M10 19V5M15 19v-6.5M20 19V8"/><path d="M3.5 21h17"/></g>',
  users: '<g transform="translate(0.0 -0.3)"><circle cx="9.2" cy="8.6" r="3.4"/><path d="M3.4 19.4a5.8 5.8 0 0 1 11.6 0"/><path d="M16 6.2a3.4 3.4 0 0 1 0 6.6M17.4 15.2a5.5 5.5 0 0 1 3.4 4.2"/></g>',
  power: '<path d="M12 3.5v8"/><path d="M7.6 6.6a7.6 7.6 0 1 0 8.8 0"/>',
  bot: '<g transform="translate(0.0 1.5)"><rect x="4" y="8" width="16" height="11" rx="3"/><path d="M12 4.2V8"/><circle cx="12" cy="3.2" r="1.2"/><path d="M9 12.6h.01M15 12.6h.01M9.6 16h4.8"/></g>',
  eye: '<path d="M2.6 12S6.4 5.8 12 5.8 21.4 12 21.4 12 17.6 18.2 12 18.2 2.6 12 2.6 12z"/><circle cx="12" cy="12" r="2.7"/>',
  globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.4 2.6 3.6 5.4 3.6 8.5S14.4 18.4 12 20.5C9.6 18.4 8.4 15.6 8.4 12.5S9.6 6.1 12 3.5z"/>',
  mail: '<rect x="3" y="5.5" width="18" height="13" rx="2.4"/><path d="M3.6 7 12 13l8.4-6"/>',
  chart: '<path d="M4 19.4h16"/><rect x="5.6" y="11" width="3.4" height="6.2" rx="1"/><rect x="10.6" y="6.4" width="3.4" height="10.8" rx="1"/><rect x="15.6" y="8.8" width="3.4" height="8.4" rx="1"/>',
  user: '<circle cx="12" cy="8.2" r="3.8"/><path d="M4.8 20a7.2 7.2 0 0 1 14.4 0"/>',
  key: '<circle cx="8" cy="12" r="4.2"/><path d="M12.2 12H21M17.5 12v3.4M20 12v2.6"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  back: '<path d="M19 12H5M11 6l-6 6 6 6"/>',
  check: '<path d="M4.5 12.5 9.5 17.5 19.5 7"/>',
  trash: '<path d="M4.5 7h15M9.5 7V4.8h5V7M6.5 7l.9 12.2h9.2L17.5 7"/>',
  // Ceux du panneau de l'assistant.
  mic: '<rect x="9" y="3.5" width="6" height="10.5" rx="3"/><path d="M5.8 11.5a6.2 6.2 0 0 0 12.4 0M12 17.7v2.8"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  play: '<path d="M8 5.5v13l10-6.5z"/>',
  minus: '<path d="M5.5 12h13"/>',
  fit: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  actions: '<circle cx="5.5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="18.5" cy="12" r="1.3"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  chevron: '<path d="M6 9.5 12 15.5 18 9.5"/>',
};
// Des constantes de ce fichier, lues comme SVG par le socle : jamais une donnée.
ajouterPictos(Object.fromEntries(Object.entries(PICTOS).map(([k, v]) => [`m:${k}`, v])));

/** Picto du jeu MapMyLAN. Un nom inconnu dessine le point d'interrogation. */
export function ic(nom, taille = 16, { trait, style, classe } = {}) {
  const el = icone(`m:${PICTOS[nom] ? nom : 'unknown'}`, taille);
  if (trait) el.style.strokeWidth = String(trait);
  if (classe) el.classList.add(...classe.split(' '));
  if (style) styler(el, style);
  return el;
}

// Type d'appareil → picto. Couvre les types du classifieur du serveur.
const PICTO_TYPE = {
  router: 'router', gateway: 'router', firewall: 'shield', switch: 'switch',
  ap: 'air', accesspoint: 'air', server: 'server', nas: 'server',
  computer: 'chip', laptop: 'chip', desktop: 'chip', pc: 'chip',
  phone: 'chip', tablet: 'chip', printer: 'printer', camera: 'cam',
  iot: 'plug', plug: 'plug', sensor: 'plug', tv: 'eye', console: 'chip',
  pi: 'pi', raspberry: 'pi', docker: 'server', container: 'server', vm: 'server',
  hypervisor: 'server', voip: 'chip', unknown: 'unknown',
};
export function pictoType(type) {
  if (!type) return 'unknown';
  return PICTO_TYPE[String(type).toLowerCase()] || 'unknown';
}

/**
 * En-tête de page : grand titre, chapeau, actions à droite. Les actions
 * secondaires disparaissent aux petites largeurs et se retrouvent dans le
 * bouton « … » (feuille du socle) : rien de ce qui est retiré n'est perdu.
 */
export function page({ titre, lede, actions = [], id }, ...enfants) {
  return h('section', { class: 'page on', id }, entete({ titre, lede, actions }), enfants);
}

/**
 * Les actions d'un en-tête : les principales restent, les secondaires se
 * retirent sous 520 px dans un bouton « … » qui les liste (feuille du socle).
 * secondaires : [{ texte, agir, bouton }] où bouton est le bouton affiché.
 */
export function actionsPage(principales, secondaires = [], titre = 'Actions') {
  const visibles = secondaires.filter(Boolean);
  if (!visibles.length) return principales;
  for (const a of visibles) a.bouton.classList.add('cache-s');
  const plus = h('button', { class: 'btn seul-s', type: 'button', 'aria-label': titre, onclick: () => feuille(titre, visibles.map(a => ({ texte: a.texte, danger: a.danger, agir: a.agir }))) }, ic('actions', 14), titre);
  return [...visibles.map(a => a.bouton), ...[principales].flat(), plus];
}

/** L'en-tête seul, pour une page qui se repeint sans être recréée. */
export function entete({ titre, lede, actions = [] }) {
  return h('div', { class: 'headrow' },
    h('div', {}, h('h1', { class: 'title' }, titre), lede ? h('p', { class: 'lede' }, lede) : null),
    [actions].flat().filter(Boolean).length ? h('div', { class: 'actions' }, actions) : null);
}

/** Bandeau de chiffres de tête. */
export function figs(...tuiles) {
  return h('div', { class: 'figs' }, tuiles);
}

/** Une tuile de chiffre. ton : défaut (accent), 'warn' (alarme), 'plain'. */
export function fig({ icone: nom, ton, libelle, valeur, unite, delta, tonDelta, courbe: trace }) {
  return h('div', { class: 'fig' },
    h('div', { class: ton ? `tile ${ton}` : 'tile' }, ic(nom, 16)),
    h('span', {}, libelle),
    h('strong', {}, String(valeur ?? ''), unite != null ? h('em', {}, unite) : null),
    delta != null ? h('div', { class: tonDelta ? `delta ${tonDelta}` : 'delta' }, delta) : null,
    trace || null);
}

let gradients = 0;
/**
 * Courbe de fond d'une tuile. Les points sont normalisés entre le minimum et
 * le maximum de la série : une variation faible reste lisible.
 */
export function courbe(data, ton = 'accent', libre = false) {
  if (!data || data.length < 2) return null;
  const W = 220, H = 42;
  const min = Math.min(...data), max = Math.max(...data);
  const ecart = max - min || 1;
  const pts = data.map((v, i) => [(i / (data.length - 1)) * W, H - 4 - ((v - min) / ecart) * (H - 10)]);
  const trace = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
  const couleur = `var(--${ton === 'alarm' ? 'alarm' : ton === 'faint' ? 'faint' : 'accent'})`;
  const id = `g-${ton}-${++gradients}`;
  return s('svg', { class: libre ? 'chart libre' : 'chart', viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'none' },
    ton !== 'faint' ? s('defs', {}, s('linearGradient', { id, x1: 0, y1: 0, x2: 0, y2: 1 },
      s('stop', { offset: 0, 'stop-color': couleur, 'stop-opacity': '.18' }),
      s('stop', { offset: 1, 'stop-color': couleur, 'stop-opacity': 0 }))) : null,
    ton !== 'faint' ? s('path', { d: `${trace} L${W} ${H} L0 ${H}Z`, fill: `url(#${id})` }) : null,
    s('path', { d: trace, fill: 'none', stroke: couleur, 'stroke-width': '1.6' }));
}

/** Carte : fond de surface, coins doux, ombre portée. */
export function carte({ titre, note: n, tete, classe, style, id }, ...enfants) {
  return h('div', { class: classe ? `card ${classe}` : 'card', style, id },
    titre || n != null || tete ? h('header', {}, titre ? h('h2', {}, titre) : null, tete || null, n != null ? h('span', { class: 'note' }, n) : null) : null,
    enfants);
}

export const pad = (...enfants) => h('div', { class: 'pad' }, enfants);

/** Deux colonnes : la principale et sa colonne d'appoint. */
export const split = (classe, ...enfants) => h('div', { class: classe ? `split ${classe}` : 'split' }, enfants);

export function btn({ solid, icone: nom, onclick, disabled, title, style, classe, type = 'button', aria }, ...enfants) {
  return h('button', {
    class: ['btn', solid ? 'solid' : '', classe || ''].filter(Boolean).join(' '),
    type, onclick, disabled: !!disabled, title, style, 'aria-label': aria,
  }, nom ? ic(nom, 14) : null, enfants);
}

/** Sélecteur de vue — carte, tableau, trafic. */
export function vues(items) {
  return h('div', { class: 'views' }, items.map(v => h('button', {
    class: v.on ? 'view on' : 'view', type: 'button', onclick: v.onclick, 'aria-pressed': String(!!v.on),
  }, v.icone ? ic(v.icone, 14) : null, v.libelle)));
}

export const chip = (ton, texte, style) => h('span', { class: ton ? `chip ${ton}` : 'chip', style }, texte);

/** Pastille d'état : point coloré et libellé. */
export const tag = (ton, ...enfants) => h('span', { class: ton ? `tag ${ton}` : 'tag' }, h('i', { class: 'd' }), enfants);

/** Jauge de risque : barre courte et valeur, rouge au-delà du seuil. */
export function risque(score, seuil = 70) {
  const v = Math.max(0, Math.min(100, Math.round(score || 0)));
  return h('span', { class: v >= seuil ? 'risk high' : 'risk' },
    h('span', { class: 'r2' }, h('i', { style: { width: `${v}%` } })), h('b', {}, String(v)));
}

/** Interrupteur. La couleur pleine dit « actif », sans texte à lire. */
export function bascule(on, surChange, { title, aria, disabled } = {}) {
  const b = h('button', {
    class: on ? 'toggle on' : 'toggle', type: 'button', title, role: 'switch',
    'aria-checked': String(!!on), 'aria-label': aria || title, disabled: !!disabled,
  }, h('i'));
  b.addEventListener('click', ev => {
    ev.stopPropagation();
    const v = b.getAttribute('aria-checked') !== 'true';
    b.classList.toggle('on', v);
    b.setAttribute('aria-checked', String(v));
    surChange?.(v);
  });
  return b;
}

/** Vignette carrée d'un appareil ou d'un compte. */
export const itile = (ton, ...enfants) => h('span', { class: ton ? `itile ${ton}` : 'itile' }, enfants);

/** Cellule « qui » : vignette, nom, précision en dessous. */
export function whoCell({ icone: vignette, ton, nom, sous }) {
  return h('div', { class: 'who-cell' },
    vignette != null ? itile(ton, vignette) : null,
    h('span', {}, h('b', {}, nom), sous != null ? h('small', {}, sous) : null));
}

/** Encart d'information ou d'avertissement. */
export function note(ton = 'info', ...enfants) {
  return h('div', { class: `note ${ton}` }, ic(ton === 'warn' ? 'alert' : 'shield', 15, { style: { marginTop: 1 } }), h('span', {}, enfants));
}

/** Ligne d'annonce du flux « récent ». */
export function notice({ icone: nom, ton, quand }, ...enfants) {
  return h('div', { class: 'notice' },
    nom ? itile(ton, ic(nom, 15)) : null,
    h('div', {}, h('p', {}, enfants), quand != null ? h('span', { class: 'when' }, quand) : null));
}

/** Rien à montrer : on le dit, sans meubler. */
export function vide(texte, nom = 'unknown') {
  return h('div', { class: 'rien' }, ic(nom, 20), texte);
}

/** Libellé de champ, en capitales espacées. */
export const lbl = (texte, pour) => h('label', { class: 'lbl', for: pour }, texte);

/** Champ de saisie ; sans : typographie de texte plutôt que chasse fixe. */
export function champ({ sans, classe, ...props } = {}) {
  return h('input', { ...props, class: ['field', 'mml', sans ? 'sans' : '', classe || ''].filter(Boolean).join(' ') });
}

/** Menu déroulant natif, habillé comme un champ. */
export function choix(options, { valeur, surChange, classe, style, disabled, aria } = {}) {
  const el = h('select', { class: ['field', 'mml', classe || ''].filter(Boolean).join(' '), style, disabled: !!disabled, 'aria-label': aria, value: valeur },
    options.map(o => Array.isArray(o) ? h('option', { value: o[0] }, o[1]) : h('option', { value: o }, o)));
  if (surChange) el.addEventListener('change', () => surChange(el.value));
  return el;
}

/** Libellé et interrupteur côte à côte, comme dans les formulaires de la 1.4. */
export function interrupteur(on, surChange, ...texte) {
  return h('span', { class: 'bascule-l' }, bascule(on, surChange), texte);
}

/** Déclenche le téléchargement d'un contenu fabriqué dans le navigateur. */
export function telecharger(nom, contenu, type) {
  const url = URL.createObjectURL(new Blob([contenu], { type }));
  const a = h('a', { href: url, download: nom, hidden: true });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Panneau latéral commun aux éditeurs : fond voilé, fiche glissée à droite. */
export function panneau({ titre, sous, largeur, classe }, construire) {
  const fermer = () => { voile.remove(); document.removeEventListener('keydown', echap); };
  const echap = ev => { if (ev.key === 'Escape') fermer(); };
  const fiche = h('div', { class: classe ? `fcarte ${classe}` : 'fcarte', role: 'dialog', 'aria-modal': 'true', 'aria-label': titre, style: largeur ? { width: largeur } : undefined },
    h('div', { class: 'fhead' }, h('div', { class: 'grow' }, h('h2', { text: titre }), sous ? h('p', { text: sous }) : null),
      h('button', { class: 'fx', type: 'button', 'aria-label': 'Fermer', onclick: () => fermer() }, classe === 'mail' ? ic('x', 15) : '×')),
    h('div', { class: 'fcorps' }, construire(fermer)));
  const voile = h('div', { class: 'feuille', onclick: ev => { if (ev.target === voile) fermer(); } }, fiche);
  document.body.append(voile);
  document.addEventListener('keydown', echap);
  return fermer;
}
