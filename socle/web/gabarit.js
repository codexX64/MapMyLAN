// Gabarits sûrs : html`<p class=${classe}>${texte}</p>` rend des nœuds DOM.
//
// Le balisage vient uniquement des chaînes littérales du code. Chaque valeur
// devient un nœud texte, une valeur d'attribut posée par setAttribute, ou un
// nœud déjà construit (un autre gabarit, un pictogramme) : elle n'est jamais
// relue comme du HTML. C'est la voie d'échappement par défaut des interfaces
// (SEC-XSS-001), au même titre que h() de compte.js.
//
// Refusé à la construction, pour qu'une erreur se voie tout de suite :
// une valeur en position de balise (<input ${x}>), dans un commentaire, dans
// <script> ou <style>, ou dans un attribut on…. Un attribut booléen s'écrit
// checked=${vrai} : false, null et undefined le retirent.
//
// Les styles en ligne passent par le CSSOM (el.style), que la politique de
// contenu admet sans 'unsafe-inline'. Une adresse dans href, src ou action
// doit être relative ou en http(s), mailto, tel ou blob ; une autre (javascript:,
// data: hors image) est neutralisée.

// getRandomValues, pas randomUUID : celle-ci manque hors contexte sûr (mode HTTP).
const PREFIXE = 'gbt' + crypto.getRandomValues(new Uint32Array(1))[0].toString(36);
const marque = i => `${PREFIXE}v${i}v`;
const MARQUES = new RegExp(`${PREFIXE}v(\\d+)v`, 'g');
const SEULE = new RegExp(`^${PREFIXE}v(\\d+)v$`);
const BRUTS = new Set(['textarea', 'title']);
const INTERDITS = new Set(['script', 'style']);
const ADRESSES = new Set(['href', 'src', 'action', 'formaction', 'poster', 'xlink:href', 'cite']);
const SVG_SEUL = /^\s*<(path|g|circle|rect|line|polyline|polygon|ellipse|text|tspan|defs|linearGradient|radialGradient|stop|use|filter|fe[A-Z]\w*|clipPath|mask|marker|pattern|symbol)[\s>/]/;

class Gabarit {
  constructor(chaines, valeurs) { this.chaines = chaines; this.valeurs = valeurs; }
}

export const html = (chaines, ...valeurs) => new Gabarit(chaines, valeurs);
export const estGabarit = v => v instanceof Gabarit;

// Partie sans DOM, vérifiée par les essais du socle : où tombe chaque valeur,
// et le balisage à interpréter, qui ne contient que les chaînes et des marques.
// Les attributs à valeur variable, et tout style en ligne, y sont renommés
// data-gbt-N (noms[N] garde le vrai nom) : l'analyseur HTML ne voit jamais une
// marque dans un attribut qu'il vérifie (SVG), ni un style qu'il soumettrait à
// la politique de contenu.
const ATTRIBUT = /(\s)([^\s=>"'/]+)(\s*=\s*)("[^"]*"|'[^']*'|[^\s>"']+)/g;
export function analyser(chaines) {
  let etat = 'texte', balise = '', brut = '', sortie = '', debutBalise = 0;
  const contextes = [], noms = [];
  const lireBalise = (s, i) => /^\/?([a-zA-Z][\w:-]*)/.exec(s.slice(i + 1))?.[1]?.toLowerCase() || '';
  const fermerBalise = () => {
    const texte = sortie.slice(debutBalise).replace(ATTRIBUT, (tout, espace, nom, egal, valeur) => {
      if (nom.toLowerCase() !== 'style' && !valeur.includes(PREFIXE)) return tout;
      noms.push(nom);
      return `${espace}data-gbt-${noms.length - 1}${egal}${valeur}`;
    });
    sortie = sortie.slice(0, debutBalise) + texte;
  };
  for (let k = 0; k < chaines.length; k++) {
    const s = chaines[k];
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (etat === 'texte') {
        if (s.startsWith('<!--', i)) { etat = 'commentaire'; sortie += '<!--'; i += 3; continue; }
        if (c === '<' && /[a-zA-Z/]/.test(s[i + 1] || '')) { balise = s[i + 1] === '/' ? '' : lireBalise(s, i); etat = 'balise'; debutBalise = sortie.length; }
      } else if (etat === 'commentaire') {
        if (s.startsWith('-->', i)) { etat = 'texte'; sortie += '-->'; i += 2; continue; }
      } else if (etat === 'brut') {
        if (s.slice(i, i + 2 + brut.length).toLowerCase() === '</' + brut) { etat = 'balise'; balise = ''; debutBalise = sortie.length; }
      } else if (etat === 'balise' || etat === 'nq') {
        if (etat === 'nq' && /[\s>]/.test(c)) etat = 'balise';
        if (etat === 'balise') {
          if (c === '"') etat = 'dq';
          else if (c === "'") etat = 'sq';
          else if (c === '=') { const suite = s[i + 1]; if (suite !== undefined && !/[\s"'>]/.test(suite)) etat = 'nq'; }
          else if (c === '>') {
            sortie += c; fermerBalise();
            if (BRUTS.has(balise) || INTERDITS.has(balise)) { etat = 'brut'; brut = balise; } else etat = 'texte';
            continue;
          }
        }
      } else if (etat === 'dq' && c === '"') etat = 'balise';
      else if (etat === 'sq' && c === "'") etat = 'balise';
      sortie += c;
    }
    if (k === chaines.length - 1) break;
    let contexte;
    if (etat === 'texte' && /<\/?$/.test(s)) etat = 'balise';
    if (etat === 'texte') { contexte = 'texte'; sortie += `<!--${marque(k)}-->`; }
    // Valeur entière d'un attribut sans guillemets : entourée ici, pour qu'un
    // « /> » qui suit ne soit pas lu comme la fin de la valeur.
    else if (etat === 'balise' && /=\s*$/.test(s)) { contexte = 'attribut'; sortie += `"${marque(k)}"`; }
    else if (etat === 'dq' || etat === 'sq' || etat === 'nq') { contexte = 'attribut'; sortie += marque(k); }
    else if (etat === 'brut' && BRUTS.has(brut)) { contexte = 'brut'; sortie += marque(k); }
    else {
      const ou = { balise: 'en position de balise (écrire nom=${valeur})', commentaire: 'dans un commentaire', brut: `dans <${brut}>` }[etat] || etat;
      throw new Error(`html\`…\` : valeur n° ${k + 1} ${ou}.`);
    }
    contextes.push(contexte);
  }
  return { balisage: sortie, contextes, noms };
}

const modeles = new WeakMap();
function modele(chaines) {
  let m = modeles.get(chaines);
  if (!m) {
    const { balisage, noms } = analyser(chaines);
    const t = document.createElement('template');
    // Seule interprétation de balisage de l'interface : les chaînes littérales
    // du code et des marques numérotées, jamais une valeur. Un fragment qui
    // commence par un élément SVG (un tracé, un groupe) est lu dans un <svg>,
    // pour naître dans le bon espace de noms, puis sorti de son enveloppe.
    if (SVG_SEUL.test(balisage)) {
      t.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg">${balisage}</svg>`;
      const enveloppe = t.content.firstElementChild;
      t.content.append(...enveloppe.childNodes);
      enveloppe.remove();
    } else t.innerHTML = balisage;
    for (const el of t.content.querySelectorAll('*')) {
      for (const a of el.attributes) {
        const nom = /^data-gbt-(\d+)$/.exec(a.name) ? noms[Number(a.name.slice(9))] : a.name;
        if (/^on/i.test(nom)) throw new Error(`html\`…\` : attribut ${nom} interdit, brancher l'évènement en JavaScript.`);
      }
    }
    modeles.set(chaines, m = { t, noms });
  }
  return m;
}

const substituer = (texte, valeurs) => texte.replace(MARQUES, (_, i) => {
  const v = valeurs[Number(i)];
  return v === null || v === undefined || v === false ? '' : String(v);
});

export function adresseSure(valeur, { image = false } = {}) {
  const v = String(valeur).trim();
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(v)) return true;
  if (/^(https?|mailto|tel|blob):/i.test(v)) return true;
  return image && /^data:image\/(png|jpeg|gif|webp|avif);/i.test(v);
}

function poserStyle(el, modeleStyle, valeurs) {
  const seule = SEULE.exec(modeleStyle);
  if (seule && valeurs[Number(seule[1])] && typeof valeurs[Number(seule[1])] === 'object') {
    for (const [p, v] of Object.entries(valeurs[Number(seule[1])])) if (v !== null && v !== undefined && v !== false) el.style.setProperty(p, String(v));
    return;
  }
  for (const decl of substituer(modeleStyle, valeurs).split(';')) {
    const i = decl.indexOf(':');
    if (i < 1) continue;
    const valeur = decl.slice(i + 1).trim();
    const important = /!important$/i.test(valeur);
    el.style.setProperty(decl.slice(0, i).trim(), important ? valeur.replace(/!important$/i, '').trim() : valeur, important ? 'important' : '');
  }
}

function poserAttribut(el, nom, modeleValeur, valeurs) {
  const seule = SEULE.exec(modeleValeur);
  let v;
  if (seule) {
    v = valeurs[Number(seule[1])];
    if (v === false || v === null || v === undefined) { el.removeAttribute(nom); return; }
    v = v === true ? '' : String(v);
  } else v = substituer(modeleValeur, valeurs);
  const bas = nom.toLowerCase();
  if (ADRESSES.has(bas) && !adresseSure(v, { image: bas === 'src' && el.localName === 'img' })) {
    if (bas === 'href') v = '#'; else { el.removeAttribute(nom); return; }
  }
  el.setAttribute(nom, v);
}

function remplir(g) {
  const { t, noms } = modele(g.chaines);
  const frag = document.importNode(t.content, true);
  const parcours = document.createTreeWalker(frag, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_COMMENT);
  const trous = [];
  while (parcours.nextNode()) {
    const n = parcours.currentNode;
    if (n.nodeType === Node.COMMENT_NODE) {
      const m = SEULE.exec(n.data);
      if (m) trous.push([n, Number(m[1])]);
      continue;
    }
    for (const a of [...n.attributes]) {
      const m = /^data-gbt-(\d+)$/.exec(a.name);
      if (!m) continue;
      n.removeAttribute(a.name);
      const nom = noms[Number(m[1])];
      if (nom.toLowerCase() === 'style') poserStyle(n, a.value, g.valeurs); else poserAttribut(n, nom, a.value, g.valeurs);
    }
    if (BRUTS.has(n.localName) && n.textContent.includes(PREFIXE)) n.textContent = substituer(n.textContent, g.valeurs);
  }
  for (const [n, i] of trous) n.replaceWith(rendre(g.valeurs[i]));
  return frag;
}

// Toute valeur en nœuds : un gabarit, une liste, un nœud, ou du texte.
export function rendre(v) {
  if (v instanceof Gabarit) return remplir(v);
  if (v instanceof Node) return v;
  if (Array.isArray(v)) { const f = document.createDocumentFragment(); for (const x of v) f.append(rendre(x)); return f; }
  if (v === null || v === undefined || v === false || v === true) return document.createTextNode('');
  return document.createTextNode(String(v));
}

// Remplace le contenu d'un élément.
export function poser(el, ...contenus) {
  el.replaceChildren(...contenus.map(rendre));
  return el;
}

// Le premier élément d'un gabarit : pour un composant qui rend une seule racine.
export function element(g) {
  const f = rendre(g);
  return f.nodeType === Node.DOCUMENT_FRAGMENT_NODE ? f.firstElementChild : f;
}
