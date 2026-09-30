// Mise en page des réponses de l'assistant et dessin des widgets, les mêmes
// que dans le Hub.
//
// Le texte du modèle ne devient jamais du balisage : il est découpé ici et
// chaque morceau est posé comme texte dans un élément créé par h(). Les
// chiffres des widgets viennent du serveur (photo prise au moment de la
// réponse) ; une couleur ne dit jamais seule l'état : le mot ou le nombre est
// à côté.
import { h, s } from '../dom.js';

// Gras puis code, dans cet ordre, comme la 1.4 : un code écrit dans un
// passage en gras reste du code dans du gras.
function enLigne(texte) {
  const code = morceau => morceau.split(/`([^`]+)`/).map((x, i) => (i % 2 ? h('code', { text: x }) : x));
  return String(texte).split(/\*\*([^*]+)\*\*/).map((x, i) => (i % 2 ? h('b', {}, code(x)) : code(x)));
}

/** Puces, listes numérotées, petits titres, gras, tableaux. */
export function rendu(texte) {
  let tx = String(texte || '').replace(/\r/g, '').trim();
  // Les puces qu'un petit modèle écrit à la suite (« … : - a - b ») sont remises une par ligne.
  if ((tx.match(/(^|\s)[-•]\s+(?=[A-ZÀ-Ý*«"0-9])/g) || []).length >= 2) tx = tx.replace(/\s+[-•]\s+(?=[A-ZÀ-Ý*«"0-9])/g, '\n- ');
  const noeuds = [];
  let liste = null, typeListe = null, tableau = [];
  const ferme = () => { liste = null; typeListe = null; };
  const cellules = l => l.replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim());
  // Un tableau (« | a | b | ») : la première ligne est l'en-tête, la ligne de tirets est sautée.
  const videTableau = () => {
    if (!tableau.length) return;
    const [tete, ...corps] = tableau;
    noeuds.push(h('div', { class: 'md-tab' }, h('table', {},
      h('thead', {}, h('tr', {}, tete.map(c => h('th', {}, enLigne(c))))),
      h('tbody', {}, corps.map(r => h('tr', {}, tete.map((_, i) => h('td', {}, enLigne(r[i] ?? '')))))))));
    tableau = [];
  };
  const puce = (type, contenu) => {
    if (typeListe !== type) { liste = h(type, { class: 'md' }); typeListe = type; noeuds.push(liste); }
    liste.append(h('li', {}, enLigne(contenu)));
  };
  for (const brut of tx.split('\n')) {
    const l = brut.trim();
    if (/^\|.*\|$/.test(l)) { ferme(); if (!/^\|[\s:|-]+\|$/.test(l)) tableau.push(cellules(l)); continue; }
    videTableau();
    if (!l) { ferme(); continue; }
    let m;
    if ((m = /^[-•*]\s+(.*)$/.exec(l))) { puce('ul', m[1]); continue; }
    if ((m = /^\d+[.)]\s+(.*)$/.exec(l))) { puce('ol', m[1]); continue; }
    ferme();
    if ((m = /^#{1,4}\s+(.*)$/.exec(l))) { noeuds.push(h('div', { class: 'md-t' }, enLigne(m[1]))); continue; }
    if ((m = /^\*\*([^*]{2,50}?)\s*:?\s*\*\*\s*:?$/.exec(l))) { noeuds.push(h('div', { class: 'md-t', text: m[1] })); continue; }
    noeuds.push(h('p', { class: 'md-p' }, enLigne(l)));
  }
  videTableau();
  return noeuds;
}

const n = v => Number(v || 0).toLocaleString('fr-FR');

function activite(w) {
  const W = 300, H = 110, bas = H - 18;
  const max = Math.max(1, ...w.barres.map(b => b.ok + b.err));
  const pas = W / w.barres.length, larg = Math.max(3, Math.min(22, pas - 2));
  const y = v => (v / max) * (bas - 6);
  const seg = (x, haut, y0, classe, arrondi) => haut > 0
    ? s('rect', { class: classe, x: x.toFixed(1), y: (y0 - haut).toFixed(1), width: larg.toFixed(1), height: Math.max(1, haut).toFixed(1), rx: arrondi ? 3 : 0 })
    : null;
  const barres = w.barres.map((b, i) => {
    const x = i * pas + (pas - larg) / 2, okH = y(b.ok), hErr = y(b.err);
    const errH = hErr > 0 && okH > 0 ? Math.max(1, hErr - 2) : hErr;
    const g = s('g', {},
      s('rect', { class: 'hit', x: (i * pas).toFixed(1), y: 0, width: pas.toFixed(1), height: H }),
      seg(x, okH, bas, 'ok', !errH),
      seg(x, errH, bas - okH - (okH > 0 && errH > 0 ? 2 : 0), 'err', true));
    g.dataset.tip = `${b.jour} · ${b.ok} ${w.legende.ok.toLowerCase()} · ${b.err} ${w.legende.err.toLowerCase()}`;
    return g;
  });
  const reperes = w.barres.map((b, i) => (i === 0 || i === w.barres.length - 1 || i === Math.floor(w.barres.length / 2))
    ? s('text', { x: (i * pas + pas / 2).toFixed(1), y: H - 3, 'text-anchor': 'middle', text: b.jour }) : null);
  return [
    h('div', { class: 'wg-leg' },
      h('span', {}, h('i', { class: 'ok' }), `${w.legende.ok} `, h('b', { text: n(w.ok) })),
      h('span', {}, h('i', { class: 'err' }), `${w.legende.err} `, h('b', { text: n(w.err) }))),
    s('svg', { class: 'wg-barres', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `${w.titre} : ${w.ok} ${w.legende.ok}, ${w.err} ${w.legende.err}` },
      s('line', { class: 'base', x1: 0, x2: W, y1: bas, y2: bas }), barres, reperes),
    w.ok + w.err ? null : h('p', { class: 'wg-vide', text: 'Rien sur la période.' }),
  ];
}

function corpsWidget(w) {
  if (w.type === 'stats') {
    return h('div', { class: 'wg-tuiles' }, w.tuiles.map(tu =>
      h('div', { class: tu.etat ? `wg-tuile e-${tu.etat}` : 'wg-tuile' }, h('small', { text: tu.label }), h('b', { text: n(tu.valeur) }), tu.sous ? h('span', { text: tu.sous }) : null)));
  }
  if (w.type === 'activite') return activite(w);
  if (w.type === 'rang') {
    if (!w.lignes.length) return h('p', { class: 'wg-vide', text: 'Aucun appareil exposé.' });
    return w.lignes.map(l => h('div', { class: 'wg-rang', dataset: { tip: l.detail ?? '' } },
      h('span', { class: 'nom', text: l.nom }), h('span', { class: 'val', text: n(l.valeur) }),
      h('span', { class: 'piste' }, h('i', { class: l.niveau, style: { width: `${Math.max(2, Math.min(100, l.valeur)).toFixed(1)}%` } }))));
  }
  if (w.type === 'liste') {
    return [
      w.lignes.length
        ? w.lignes.map(l => h('div', { class: 'wg-svc' }, h('i', { class: `pt ${l.etat}` }), h('span', { class: 'nom' }, h('b', { text: l.nom }), h('span', { class: 'detail', text: l.detail }))))
        : h('p', { class: 'wg-vide', text: w.vide }),
      w.reste ? h('p', { class: 'liste-reste', text: `et ${n(w.reste)} autre${w.reste > 1 ? 's' : ''}` }) : null,
    ];
  }
  return null;
}

/** Un widget du fil ; un type inconnu ne dessine rien. */
export function widget(w) {
  const corps = corpsWidget(w);
  return corps ? h('div', { class: 'wg' }, h('div', { class: 'wg-t', text: w.titre || '' }), corps) : null;
}

// Une seule bulle d'info pour tous les widgets : elle suit la souris.
let bulleBranchee = false;
export function brancherBulle() {
  if (bulleBranchee) return;
  bulleBranchee = true;
  document.addEventListener('mouseover', ev => {
    const cible = ev.target instanceof Element ? ev.target.closest('[data-tip]') : null;
    let bulle = document.getElementById('aiaTip');
    if (!cible || !cible.closest('.aia')) { bulle?.classList.remove('vu'); return; }
    if (!bulle) {
      bulle = h('div', { id: 'aiaTip', class: 'wg-tip', role: 'tooltip' });
      document.body.append(bulle);
    }
    bulle.textContent = cible.dataset.tip || '';
    const r = cible.getBoundingClientRect();
    bulle.classList.add('vu');
    const bw = bulle.offsetWidth;
    bulle.style.left = `${Math.max(8, Math.min(innerWidth - bw - 8, r.left + r.width / 2 - bw / 2))}px`;
    bulle.style.top = `${Math.max(8, r.top - bulle.offsetHeight - 8)}px`;
  });
}
