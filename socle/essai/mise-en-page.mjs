// Contrôle de mise en page, à lancer dans une page ouverte par Playwright :
// page.evaluate(chevauchements). Renvoie la liste des défauts visibles.
//
//   - deux éléments de contenu qui se recouvrent (ni l'un ni l'autre ne
//     contenant l'autre), dans la même couche d'empilement ;
//   - un texte qui déborde de sa boîte sans être coupé proprement ;
//   - une page ou une zone de travail plus large que l'écran.
export function chevauchements() {
  const defauts = [];
  const vw = document.documentElement.clientWidth;
  const racine = document.scrollingElement;
  if (racine.scrollWidth > vw + 1) defauts.push({ type: 'defilement-horizontal', detail: `${racine.scrollWidth} > ${vw}` });
  // Un tableau qui défile de côté cache des colonnes à moitié : à ces
  // largeurs, on retire des colonnes plutôt que de les couper.
  for (const t of document.querySelectorAll('.tw')) {
    if (t.scrollWidth > t.clientWidth + 1 && t.getBoundingClientRect().width > 0) defauts.push({ type: 'tableau-defile', detail: `${t.scrollWidth} > ${t.clientWidth}` });
  }
  for (const z of document.querySelectorAll('.stage,.wbody,.dialogue,.porte')) {
    if (z.scrollWidth > z.clientWidth + 1 && getComputedStyle(z).overflowX !== 'visible') defauts.push({ type: 'zone-trop-large', detail: `${z.className} ${z.scrollWidth} > ${z.clientWidth}` });
  }

  const visible = el => {
    // Le contenu d'un <details> fermé garde des boîtes, mais personne ne le voit.
    if (el.checkVisibility && !el.checkVisibility({ contentVisibilityAuto: true, opacityProperty: true, visibilityProperty: true })) return false;
    for (let e = el; e && e !== document.body; e = e.parentElement) {
      const s = getComputedStyle(e);
      if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) === 0) return false;
    }
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  // Couche : le plus proche ancêtre qui sort du flux (fixe, absolu, dialogue).
  const couche = el => {
    for (let e = el.parentElement; e; e = e.parentElement) {
      const p = getComputedStyle(e).position;
      if (p === 'fixed' || p === 'absolute' || p === 'sticky') return e;
    }
    return document.body;
  };
  // Rectangle réellement visible : coupé par chaque ancêtre qui masque son débordement.
  const decoupe = el => {
    let r = el.getBoundingClientRect();
    let [x1, y1, x2, y2] = [r.left, r.top, r.right, r.bottom];
    for (let e = el.parentElement; e && e !== document.documentElement; e = e.parentElement) {
      const s = getComputedStyle(e);
      if (s.overflowX !== 'visible' || s.overflowY !== 'visible') {
        const q = e.getBoundingClientRect();
        x1 = Math.max(x1, q.left); y1 = Math.max(y1, q.top); x2 = Math.min(x2, q.right); y2 = Math.min(y2, q.bottom);
      }
    }
    return x2 - x1 > 1 && y2 - y1 > 1 ? { x1, y1, x2, y2 } : null;
  };
  const texteDirect = el => [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim());
  const feuilles = [...document.querySelectorAll('body *')].filter(el => {
    // Un dessin ou une formule est une seule boîte : l'intérieur d'une formule
    // se recouvre par construction (indices, bornes d'intégrale, fractions).
    for (const bloc of ['svg', 'math']) if (el.tagName.toLowerCase() !== bloc && el.closest(bloc)) return false;
    if (['SCRIPT', 'STYLE', 'OPTION', 'BR'].includes(el.tagName)) return false;
    const utile = texteDirect(el) || ['BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'IMG', 'CANVAS'].includes(el.tagName) || el.matches('svg.i,math,.toggle,.tag .d,.chip');
    return utile && visible(el);
  });
  const boites = feuilles.map(el => ({ el, r: decoupe(el), c: couche(el) })).filter(b => b.r);
  const nom = el => (el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).join('.') : '')) + (el.textContent?.trim() ? ` « ${el.textContent.trim().slice(0, 30)} »` : '');
  for (let i = 0; i < boites.length; i++) {
    for (let j = i + 1; j < boites.length; j++) {
      const a = boites[i], b = boites[j];
      if (a.c !== b.c || a.el.contains(b.el) || b.el.contains(a.el)) continue;
      const w = Math.min(a.r.x2, b.r.x2) - Math.max(a.r.x1, b.r.x1);
      const hgt = Math.min(a.r.y2, b.r.y2) - Math.max(a.r.y1, b.r.y1);
      if (w > 2 && hgt > 2) defauts.push({ type: 'chevauchement', detail: `${nom(a.el)} ⟷ ${nom(b.el)} (${Math.round(w)}×${Math.round(hgt)})` });
    }
  }
  // Un contenu qui sort de son cadre (carte, encart, dialogue) sans être coupé.
  const cadre = el => {
    for (let e = el.parentElement; e && e !== document.body; e = e.parentElement) {
      const s = getComputedStyle(e);
      const fond = s.backgroundColor !== 'rgba(0, 0, 0, 0)' && s.backgroundColor !== 'transparent';
      if (s.overflowX !== 'visible' || (fond && parseFloat(s.borderRadius) > 0)) return e;
    }
    return null;
  };
  for (const { el } of boites) {
    const c = cadre(el);
    if (!c) continue;
    const r = el.getBoundingClientRect(), q = c.getBoundingClientRect();
    const sc = getComputedStyle(c);
    if (sc.overflowX === 'auto' || sc.overflowX === 'scroll') continue;
    if (!(r.right > q.right + 1 || r.left < q.left - 1)) continue;
    // Coupé net par un cadre qui masque son débordement : défaut, sauf si le
    // texte finit proprement en « … ».
    let propre = false;
    for (let e = el; e && e !== c; e = e.parentElement) if (getComputedStyle(e).textOverflow === 'ellipsis') propre = true;
    if (!propre) defauts.push({ type: sc.overflowX === 'visible' ? 'sort-du-cadre' : 'coupe-par-le-cadre', detail: `${nom(el)} dépasse de ${nom(c).slice(0, 60)} (${Math.round(Math.max(r.right - q.right, q.left - r.left))} px)` });
  }
  // Boutons : un libellé replié sur deux lignes, ou un groupe de boutons
  // côte à côte dont un seul est parti à la ligne (« Installer » en haut,
  // « Connecter » seul en dessous). Un groupe se replie entier ou pas du tout.
  const boutons = [...document.querySelectorAll('button,.btn,a.btn')].filter(b => visible(b) && b.textContent.trim());
  // Libellé replié : un texte du bouton lui-même (pas une ligne de
  // description posée en bloc dessous) qui passe sur deux lignes.
  for (const b of boutons) {
    // Un libellé de bouton ou d'entrée de menu coupé en « … » cache ce qu'il
    // fait : la coupure propre vaut pour une donnée, pas pour une commande.
    const coupe = [b, ...b.querySelectorAll('*')].find(e => getComputedStyle(e).textOverflow === 'ellipsis' && e.scrollWidth > e.clientWidth + 1 && e.textContent.trim());
    // Une ligne de données (data-donnee : un appareil, un fichier) coupe son
    // nom comme une cellule de tableau : ce n'est pas une commande.
    if (coupe && !b.matches('.field,.csel-btn,.vpick-btn,[data-donnee]')) defauts.push({ type: 'bouton-tronque', detail: `${nom(b)} ${coupe.scrollWidth} > ${coupe.clientWidth}` });
    const w = document.createTreeWalker(b, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      if (!n.textContent.trim()) continue;
      let enLigne = true;
      for (let e = n.parentElement; e && e !== b; e = e.parentElement) if (!/^inline/.test(getComputedStyle(e).display)) enLigne = false;
      if (!enLigne) continue;
      const rg = document.createRange();
      rg.selectNodeContents(n);
      const lignes = new Set([...rg.getClientRects()].filter(r => r.width > 1).map(r => Math.round(r.top / 3)));
      if (lignes.size > 1) { defauts.push({ type: 'bouton-replie', detail: `${nom(b)} sur ${lignes.size} lignes` }); break; }
    }
  }
  // Une valeur ou un libellé court (24 caractères au plus, hors paragraphe)
  // replié sur deux lignes : « 1 / » puis « 1 », « Ubuntu 24.04 » puis « LTS ».
  const marcheur = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = marcheur.nextNode(); n; n = marcheur.nextNode()) {
    const t = n.textContent.trim();
    if (!t || t.length > 24 || !/\s|\//.test(t)) continue;
    const el = n.parentElement;
    if (!el || el.closest('p,li,dd,blockquote,pre,code,textarea,svg,math,.hint,.lede,.note,.toast') || !visible(el)) continue;
    const rg = document.createRange();
    rg.selectNodeContents(n);
    const lignes = new Set([...rg.getClientRects()].filter(r => r.width > 1).map(r => Math.round(r.top / 3)));
    if (lignes.size > 1) defauts.push({ type: 'libelle-replie', detail: `${nom(el).slice(0, 50)} « ${t} » sur ${lignes.size} lignes` });
  }
  const parents = new Set(boutons.map(b => b.parentElement));
  for (const p of parents) {
    const s = getComputedStyle(p);
    if (!/flex/.test(s.display) || !s.flexDirection.startsWith('row') || s.flexWrap === 'nowrap') continue;
    // Les commandes (.btn) seulement : une liste de puces ou de tuiles se
    // replie naturellement. Au-delà de trois, seule une barre d'outils ou un
    // pied de carte ou de dialogue doit tenir ensemble.
    const groupe = [...p.children].filter(e => boutons.includes(e) && e.matches('.btn'));
    if (groupe.length < 2) continue;
    if (groupe.length > 3 && !p.matches('footer,.pied,.actions,[role=toolbar]')) continue;
    const rangs = new Map();
    for (const b of groupe) { const t = Math.round(b.getBoundingClientRect().top / 4); rangs.set(t, (rangs.get(t) || 0) + 1); }
    if (rangs.size < 2) continue;
    // Empilés pleine largeur exprès : c'est une colonne, pas une coupure.
    const large = p.clientWidth - parseFloat(s.paddingLeft) - parseFloat(s.paddingRight);
    if (groupe.every(b => b.getBoundingClientRect().width >= large * 0.9)) continue;
    const tailles = [...rangs.values()];
    defauts.push({ type: 'groupe-de-boutons-coupe', detail: `${nom(p).slice(0, 60)} : ${tailles.join(' + ')} par ligne` });
  }
  for (const { el } of boites) {
    if (!texteDirect(el)) continue;
    const s = getComputedStyle(el);
    const coupe = s.textOverflow === 'ellipsis' || s.overflowX === 'hidden' || s.overflowX === 'auto' || s.overflowX === 'scroll';
    if (!coupe && el.scrollWidth > el.clientWidth + 2 && s.display !== 'inline') defauts.push({ type: 'texte-deborde', detail: `${nom(el)} ${el.scrollWidth} > ${el.clientWidth}` });
  }
  return defauts;
}

export const LARGEURS = [360, 390, 768, 1024, 1280, 1440, 1920];
