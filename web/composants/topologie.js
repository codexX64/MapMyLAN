// Carte manipulable.
//
// - déplacer un appareil (la position est enregistrée) ;
// - molette ou boutons pour zoomer, glisser le fond pour se déplacer ;
// - clic droit maintenu d'un appareil à un autre : une liaison ;
// - zones rectangulaires nommées, déplaçables et redimensionnables ;
// - plan d'architecte en fond, importé depuis le poste ;
// - clic sur un appareil : sa fiche s'ouvre.
//
// Les gestes passent par les événements « pointer », qui couvrent la souris,
// le stylet et le doigt : sur un écran tactile, on déplace et on fait glisser
// la carte comme à la souris.
//
// L'apparence des nœuds suit la maquette : une plaque carrée, la silhouette au
// centre, le genre en capitales, le nom, l'adresse. Les couleurs viennent des
// classes de mapmylan.css, donc de la palette du thème.
import { toast, confirmer, feuille } from '/socle/compte.js';
import { h, s, ic, remplir } from '../dom.js';
import { E, api, rafraichirAppareils, rafraichirTopologie, lancerBalayage, choisirAppareil } from '../etat.js';
import { disposerEnArbre, courbeArbre, PAS_COLONNE } from '../lib/topologie-arbre.js';
import { silhouette } from './silhouettes.js';
import { glypheArbre, natureArbre, bandeRadio } from './glyphes-arbre.js';

// Largeur du plan de travail. La HAUTEUR, elle, suit le cadre : voir plus bas.
const W = 2400;
const H_DEFAUT = 1600;

// Le plan de travail fait 2400 unités de large, la maquette 980 : sans
// agrandissement, une plaque de 74 unités et son libellé de 11,5 seraient
// réduits de moitié à l'écran. Les positions enregistrées ne changent pas —
// seul le dessin du nœud est mis à l'échelle.
const ECHELLE_NOEUD = 2.2;

export const PALETTE_ZONES = [
  '#38bdf8', '#22d3ee', '#a78bfa', '#f472b6', '#fb923c',
  '#fbbf24', '#34d399', '#f87171', '#94a3b8', '#06b6d4',
  '#84cc16', '#e879f9',
];

const TRAITS = { solid: '0', dashed: '8 4', dotted: '1 4', dashdot: '10 4 2 4', long: '16 6' };

// Le trait dit le médium, pas la couleur : plein pour du cuivre, pointillé pour
// de l'onde. La couleur reste neutre, seul le lien sélectionné prend l'accent.
const LIAISONS = {
  ethernet: { couleur: 'var(--faint)', tirets: '0', largeur: 1.4 },
  wifi: { couleur: 'var(--faint)', tirets: '2 5', largeur: 1.4 },
  vpn: { couleur: 'var(--accent)', tirets: '7 3 2 3', largeur: 1.4, anime: true },
  trunk: { couleur: 'var(--ink-soft)', tirets: '0', largeur: 2.4 },
  wan: { couleur: 'var(--warn)', tirets: '8 4', largeur: 1.6 },
  docker: { couleur: 'var(--faint)', tirets: '4 3', largeur: 1.2 },
  // Deux faces d'un même boîtier : trait presque effacé, il signale la parenté
  // sans prétendre représenter un câble.
  sibling: { couleur: 'var(--hair)', tirets: '1 5', largeur: 1.1 },
};
const TYPES_LIAISON = [['ethernet', 'filaire'], ['wifi', 'sans fil'], ['vpn', 'tunnel'], ['trunk', 'agrégée'], ['wan', 'sortie'], ['docker', 'conteneur']];
const AMONT = ['router', 'switch', 'firewall', 'ap', 'gateway'];

const ZOOM_MIN = 0.25, ZOOM_MAX = 2;

// L'arborescence se dessine comme un contrôleur de réseau : un glyphe plein,
// le nom, l'adresse, la radio au-dessus pour un client sans fil, et des
// courbes entre les nœuds — pleines en filaire, pointillées sans fil.
const GLYPHE = 52;
const MARGE_COURBE = (GLYPHE / 2 + 4) * ECHELLE_NOEUD;
const INTERNET = 'internet:';
const sansFil = (d, l) => l?.type === 'wifi' || String(d?.metadata?.medium || '').toLowerCase() === 'wireless';

/** Métadonnées d'affichage d'une zone, rangées par le serveur dans « notes ». */
function metaZone(z) {
  try { return typeof z.notes === 'string' ? JSON.parse(z.notes || '{}') : (z.notes || {}); } catch { return {}; }
}

const lireLocal = (cle) => { try { return localStorage.getItem(cle); } catch { return null; } };
const ecrireLocal = (cle, v) => {
  try { if (v === null) localStorage.removeItem(cle); else localStorage.setItem(cle, v); }
  catch { /* image trop lourde pour le stockage : elle reste en mémoire */ }
};

export function carteTopologie(p, { agencement, surAgencement, choixAgencement }) {
  let libres = {};
  let pan = { x: 0, y: 0 }, zoom = 1, H = H_DEFAUT;
  let typeLiaison = 'ethernet';
  let mode = agencement || 'libre';
  let arbre = null;
  let glisse = null;          // { id, bouge } — un appareil déplacé
  let tire = null;            // identifiant de l'appareil d'où part une liaison
  let zoneGlissee = null, zoneRetaillee = null, panDepart = null;
  let lienChoisi = null;
  let souris = { x: 0, y: 0 };
  let dejaCadre = false;
  let plan = lireLocal('mapmylan_plan');
  let planOpacite = (() => { const v = Number(lireLocal('mapmylan_plan_opacite')); return Number.isFinite(v) && v > 0 ? v : 55; })();

  const positions = () => (arbre ? arbre.positions : libres);

  const monde = s('g');
  const couches = { plan: s('g'), zones: s('g'), attaches: s('g'), liens: s('g'), apercu: s('g'), noeuds: s('g') };
  monde.append(couches.plan, couches.zones, couches.attaches, couches.liens, couches.apercu, couches.noeuds);
  const grille = s('rect', { width: W, height: H, fill: 'url(#grille-topo)' });
  const svg = s('svg', { width: '100%', height: '100%', viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'xMidYMid meet', class: 'map' },
    s('defs', {}, s('pattern', { id: 'grille-topo', width: 22, height: 22, patternUnits: 'userSpaceOnUse' }, s('circle', { cx: 1, cy: 1, r: 1, fill: 'var(--hair)' }))),
    grille, monde);
  const bulle = h('div', { class: 'topo-bulle', hidden: true });
  const menuLien = h('div', { class: 'topo-menu', hidden: true });
  const fichier = h('input', { type: 'file', accept: 'image/*', hidden: true });
  const niveau = h('button', { class: 'pomini zoom-niveau', type: 'button', title: 'Revenir à 100 %' });
  const info = h('span', { class: 'poinfo cache-m' });
  const outilsPlan = h('span', { class: 'contenu cache-m' });
  const selAgencement = h('select', { class: 'po-choix', 'aria-label': 'Agencement' },
    h('option', { value: 'libre' }, 'libre'), h('option', { value: 'arbre' }, 'arborescence'));
  const selLiaison = h('select', { class: 'po-choix', 'aria-label': 'Liaison' }, TYPES_LIAISON.map(([v, l]) => h('option', { value: v }, l)));
  selLiaison.addEventListener('change', () => { typeLiaison = selLiaison.value; });
  selAgencement.addEventListener('change', () => changerMode(selAgencement.value));

  const arret = fn => ev => { ev.stopPropagation(); fn(ev); };
  const outils = h('div', { class: 'planoutils' },
    h('button', { class: 'po', type: 'button', onclick: arret(() => api.post('/api/topology/auto-build').then(rafraichirTopologie).catch(e => toast(e.message, true))) }, 'Reconstruire'),
    h('button', { class: 'po', type: 'button', onclick: arret(() => ajusterVue()) }, 'Recentrer'),
    // L'agencement : le choix fourni par la page, sinon le sélecteur d'ici.
    surAgencement ? (choixAgencement || null) : h('span', { class: 'po fixe' }, 'Agencement', selAgencement),
    h('span', { class: 'po fixe cache-s' }, 'Liaison', selLiaison),
    h('button', { class: 'po cache-s', type: 'button', onclick: arret(() => ajouterAppareil()) }, '+ Appareil'),
    h('button', { class: 'po cache-s', type: 'button', onclick: arret(() => nouvelleZone()) }, '+ Zone'),
    fichier, outilsPlan,
    h('button', { class: 'po seul-s', type: 'button', 'aria-label': 'Outils de la carte', onclick: arret(() => feuille('Carte', [
      { texte: '+ Appareil', agir: ajouterAppareil },
      { texte: '+ Zone', agir: nouvelleZone },
      { texte: plan ? 'Changer le plan' : 'Importer un plan', agir: () => fichier.click() },
      ...(plan ? [{ texte: 'Retirer le plan', agir: retirerPlan }] : []),
    ])) }, ic('actions', 14)),
    h('span', { class: 'posep' }),
    info,
    h('span', { class: 'po fixe zoom' },
      h('button', { class: 'pomini', type: 'button', title: 'Dézoomer', onclick: arret(() => zoomerAuBouton(zoom / 1.25)) }, '−'),
      niveau,
      h('button', { class: 'pomini', type: 'button', title: 'Zoomer', onclick: arret(() => zoomerAuBouton(zoom * 1.25)) }, '+')));
  niveau.addEventListener('click', arret(() => zoomerAuBouton(1)));
  fichier.addEventListener('change', () => chargerPlan(fichier.files?.[0]));

  const vide = h('div', { class: 'topo-vide', hidden: true },
    h('div', {}, 'No devices discovered yet.'),
    h('button', { class: 'topo-scan', type: 'button', onclick: () => lancerBalayage() }, '↻ Trigger scan'));
  const conteneur = h('div', { class: 'topo' }, outils, svg, bulle, vide);
  document.body.append(menuLien);
  p.au(() => menuLien.remove());

  // Agencement
  //
  // « Libre » : chaque appareil garde la position que l'utilisateur lui a
  // donnée, enregistrée sur sa fiche (posX / posY). « Arborescence » range par
  // dépendance — qu'est-ce qui pend de quoi — et se recalcule à chaque relevé.
  // Passer en arborescence n'écrase JAMAIS les positions enregistrées : elles
  // restent dans `libres` et reviennent intactes au retour.
  function calculerArbre() {
    arbre = mode === 'arbre'
      ? disposerEnArbre(E.devices.map(d => ({
        ...d,
        // Ce que le contrôleur a mesuré vit dans les métadonnées du relevé :
        // l'amont déclaré, le commutateur, la borne et le média. La hiérarchie
        // dessinée est ainsi celle que l'équipement rapporte.
        uplinkMac: d?.metadata?.uplinkMac, swMac: d?.metadata?.swMac,
        apMac: d?.metadata?.apMac, medium: d?.metadata?.medium,
      })), E.topology.links)
      : null;
    // Devant la passerelle, Internet : ce qu'elle relie, pas un appareil.
    const racine = arbre?.racine && E.devices.find(d => d.id === arbre.racine);
    if (racine && natureArbre(racine) === 'passerelle') {
      const q = arbre.positions[racine.id];
      arbre.positions[INTERNET] = { x: q.x - PAS_COLONNE * 0.8, y: q.y };
    }
  }
  function changerMode(m) {
    if (surAgencement) { surAgencement(m); return; }
    appliquerMode(m);
    ecrireLocal('mapmylan_agencement', m);
  }
  function appliquerMode(m) {
    mode = m;
    selAgencement.value = m;
    calculerArbre();
    info.textContent = mode === 'arbre' ? 'places calculées' : 'glisser pour déplacer';
    tout();
    // Les deux agencements n'occupent pas la même emprise : sans recadrage, on
    // bascule en arborescence et on se retrouve devant un coin vide.
    ajusterVue();
  }

  // Positions initiales : posX / posY enregistrés, sinon par étages
  function placerLibres() {
    const suivant = { ...libres };
    // Le type prime : une passerelle en haut, un commutateur ou une borne juste
    // en dessous, les machines ensuite. Quand le type ne dit rien, on se
    // rabat sur le segment — les appareils d'un même sous-réseau se retrouvent
    // sur la même ligne, quel que soit le plan d'adressage.
    const segments = [];
    const segmentDe = d => {
      const m = /^(\d+\.\d+\.\d+)\./.exec(d.ip || '');
      const cle = m ? m[1] : '?';
      let i = segments.indexOf(cle);
      if (i < 0) { segments.push(cle); i = segments.length - 1; }
      return i;
    };
    const etage = d => {
      const ty = d.customType || d.type;
      if (ty === 'firewall') return 0;
      if (ty === 'router' || d.isMainRouter) return 1;
      if (ty === 'switch' || ty === 'ap') return 2;
      if (ty === 'server' || ty === 'nas' || ty === 'vm' || ty === 'docker' || ty === 'container') return 3;
      return 4 + (segmentDe(d) % 2);
    };
    const etages = { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [] };
    for (const d of E.devices) etages[etage(d)].push(d);
    // Les étages sont espacés d'une hauteur de nœud entière : plaque, genre,
    // nom et adresse compris, sinon deux rangées se chevauchent.
    const Y = [140, 430, 720, 1010, 1300, 1590];
    const octet = ip => Number((ip || '').split('.')[3]) || 0;
    for (const n of Object.keys(etages)) {
      const items = etages[n].sort((a, b) => octet(a.ip) - octet(b.ip));
      items.forEach((d, i) => {
        if (suivant[d.id]) return;
        if (d.posX != null && d.posY != null) suivant[d.id] = { x: d.posX, y: d.posY };
        else suivant[d.id] = { x: items.length === 1 ? W / 2 : 200 + ((W - 400) / Math.max(1, items.length - 1)) * i, y: Y[+n] };
      });
    }
    for (const id of Object.keys(suivant)) if (!E.devices.find(d => d.id === id)) delete suivant[id];
    libres = suivant;
  }

  // Coordonnées
  // Le CTM du groupe tient compte du déplacement, du zoom et des marges de
  // preserveAspectRatio : le curseur tombe exactement sur le point rendu.
  const versPlan = (cx, cy) => {
    const ctm = monde.getScreenCTM();
    if (!ctm) return { x: 0, y: 0 };
    const pt = svg.createSVGPoint();
    pt.x = cx; pt.y = cy;
    const l = pt.matrixTransform(ctm.inverse());
    return { x: l.x, y: l.y };
  };

  function transformer() {
    monde.setAttribute('transform', `translate(${pan.x} ${pan.y}) scale(${zoom}) translate(${(W - W * zoom) / (2 * zoom)} ${(H - H * zoom) / (2 * zoom)})`);
    niveau.textContent = `${Math.round(zoom * 100)} %`;
  }

  /**
   * Cadre la vue sur ce qui existe : l'emprise des appareils, l'agrandissement
   * qui la fait tenir, ramenée au centre. Les marges ne sont pas symétriques :
   * un nœud déborde de 81 vers le haut (la plaque) mais de 180 vers le bas
   * (genre, nom, adresse).
   */
  // Le premier cadrage attend que le cadre ait sa taille réelle : mesuré trop
  // tôt, la barre d'outils ne compte pour rien et le zoom est trop fort.
  function cadrerUneFois() {
    if (dejaCadre || !Object.keys(positions()).length || conteneur.getBoundingClientRect().height < 40) return;
    dejaCadre = true;
    mesurer();
    ajusterVue();
  }
  function ajusterVue() {
    const pts = Object.values(positions());
    if (!pts.length) { zoom = 1; pan = { x: 0, y: 0 }; transformer(); return; }
    const margeX = 170, margeHaut = 100, margeBas = 245;
    const xs = pts.map(q => q.x), ys = pts.map(q => q.y);
    const minX = Math.min(...xs) - margeX, maxX = Math.max(...xs) + margeX;
    const minY = Math.min(...ys) - margeHaut, maxY = Math.max(...ys) + margeBas;
    // La barre d'outils est posée PAR-DESSUS le dessin : la place qu'elle
    // occupe n'est pas utilisable. On la mesure plutôt que de la deviner : elle
    // passe sur deux lignes quand la fenêtre est étroite.
    const cadre = conteneur.getBoundingClientRect();
    const partBarre = cadre.height > 0 ? Math.min(0.35, outils.offsetHeight / cadre.height) : 0;
    const hUtile = H * (1 - partBarre);
    const k = Math.max(0.25, Math.min(2.6, Math.min(W / (maxX - minX), hUtile / (maxY - minY))));
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    zoom = k;
    pan = { x: k * (W / 2 - cx), y: k * (H / 2 - cy) + (H * partBarre) / 2 };
    transformer();
  }

  /**
   * Amène le zoom à `cible` en gardant immobile le point du plan situé sous
   * (clientX, clientY). Sans cette correction, zoomer déplace ce qu'on vise.
   */
  function zoomerVers(cible, clientX, clientY) {
    const k = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, cible));
    if (Math.abs(k - zoom) < 0.0005) return;
    const avant = versPlan(clientX, clientY);
    const ctm = svg.getScreenCTM();
    if (!ctm) { zoom = k; transformer(); return; }
    const pt = svg.createSVGPoint();
    pt.x = clientX; pt.y = clientY;
    const dansCadre = pt.matrixTransform(ctm.inverse());
    pan = {
      x: dansCadre.x - k * (avant.x + (W - W * k) / (2 * k)),
      y: dansCadre.y - k * (avant.y + (H - H * k) / (2 * k)),
    };
    zoom = k;
    transformer();
  }
  function zoomerAuBouton(cible) {
    const r = conteneur.getBoundingClientRect();
    zoomerVers(cible, r.left + r.width / 2, r.top + r.height / 2);
  }

  // Le pas de zoom suit l'AMPLEUR du geste : un pavé tactile émet des dizaines
  // d'événements par geste, et un pas fixe rendait la visée impossible. Chaque
  // événement est borné, quel que soit ce que rapporte le navigateur.
  p.ecouter(conteneur, 'wheel', ev => {
    ev.preventDefault();
    const unite = ev.deltaMode === 1 ? 16 : ev.deltaMode === 2 ? 400 : 1;
    const px = Math.max(-60, Math.min(60, ev.deltaY * unite));
    // Le pincement d'un pavé tactile arrive avec ctrlKey : valeurs plus petites.
    zoomerVers(zoom * Math.exp(-px * (ev.ctrlKey ? 0.010 : 0.002)), ev.clientX, ev.clientY);
  }, { passive: false });

  // La hauteur du plan suit la forme du cadre : largeur fixe, hauteur déduite
  // du rapport, bornée pour qu'un cadre très plat n'écrase pas le plan.
  function mesurer() {
    const r = conteneur.getBoundingClientRect();
    if (r.width < 40 || r.height < 40) return;
    const nh = Math.max(900, Math.min(8000, Math.round((W * r.height) / r.width)));
    if (nh === H) return;
    H = nh;
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    grille.setAttribute('height', H);
    dessinerPlan();
    transformer();
  }
  // L'arborescence a une rangée par appareil : le cadre grandit avec elle,
  // pour qu'un nom reste lisible sans zoomer, comme dans un contrôleur. Le
  // pas visé est d'environ 120 px par rangée, moins si la largeur manque.
  let hauteurPosee = 0;
  function cadrerArbre() {
    const cadre = conteneur.closest('.planwrap');
    if (!cadre) return;
    // Le plan suit tout de suite la nouvelle hauteur : le cadrage qui suit
    // doit compter avec elle, pas avec l'ancienne.
    if (!arbre) { if (hauteurPosee) { cadre.style.height = ''; hauteurPosee = 0; mesurer(); } return; }
    const pts = Object.values(arbre.positions);
    const l = cadre.getBoundingClientRect().width;
    if (!pts.length || l < 40) return;
    const ys = pts.map(q => q.y), xs = pts.map(q => q.x);
    const etendueY = Math.max(...ys) - Math.min(...ys) + 345, etendueX = Math.max(...xs) - Math.min(...xs) + 340;
    const parUnite = Math.min(0.42, (l - 12) / etendueX);
    const voulue = Math.round(etendueY * parUnite + outils.offsetHeight + 12);
    if (hauteurPosee) cadre.style.height = '';
    const naturelle = cadre.getBoundingClientRect().height;
    if (voulue > naturelle) { cadre.style.height = `${voulue}px`; hauteurPosee = voulue; } else hauteurPosee = 0;
    mesurer();
  }
  const ro = new ResizeObserver(() => { cadrerArbre(); mesurer(); cadrerUneFois(); if (arbre) ajusterVue(); });
  ro.observe(conteneur);
  p.au(() => ro.disconnect());

  // Plan d'architecte
  // Sans contrepartie serveur : il est conservé dans ce navigateur, en URL de
  // données, et suit le zoom et le déplacement comme le reste.
  function dessinerPlan() {
    remplir(couches.plan, plan ? s('image', { href: plan, x: 0, y: 0, width: W, height: H, preserveAspectRatio: 'xMidYMid meet', opacity: planOpacite / 100, style: { pointerEvents: 'none' } }) : '');
    const curseur = h('input', { type: 'range', min: 10, max: 100, value: planOpacite, 'aria-label': 'Opacité du plan' });
    curseur.addEventListener('input', () => {
      planOpacite = Number(curseur.value);
      ecrireLocal('mapmylan_plan_opacite', String(planOpacite));
      couches.plan.firstChild?.setAttribute?.('opacity', planOpacite / 100);
    });
    remplir(outilsPlan,
      h('button', { class: 'po', type: 'button', onclick: arret(() => fichier.click()) }, plan ? 'Changer le plan' : 'Importer un plan'),
      plan ? h('label', { class: 'po opa', onclick: ev => ev.stopPropagation() }, 'Plan', curseur) : null,
      plan ? h('button', { class: 'po', type: 'button', onclick: arret(retirerPlan) }, 'Retirer le plan') : null);
  }
  function chargerPlan(f) {
    if (!f) return;
    const lecteur = new FileReader();
    lecteur.onload = () => { plan = String(lecteur.result || ''); ecrireLocal('mapmylan_plan', plan); dessinerPlan(); };
    lecteur.readAsDataURL(f);
  }
  function retirerPlan() { plan = null; ecrireLocal('mapmylan_plan', null); dessinerPlan(); }

  function dessinerZones() {
    remplir(couches.zones, ...E.topology.zones.map(z => {
      const meta = metaZone(z);
      const couleur = z.color || 'var(--accent)';
      const corps = s('rect', {
        x: z.x, y: z.y, width: z.width, height: z.height, rx: 12,
        fill: couleur, 'fill-opacity': meta.opacity ?? 0.10, stroke: couleur, 'stroke-width': meta.strokeWidth || 2,
        'stroke-dasharray': TRAITS[meta.strokeStyle || 'dashed'] || TRAITS.dashed, class: 'zcorps',
      });
      corps.addEventListener('pointerdown', ev => { ev.stopPropagation(); zoneGlissee = { z, dx: souris.x - z.x, dy: souris.y - z.y }; });
      corps.addEventListener('dblclick', ev => { ev.stopPropagation(); editerZone({ ...z, ...meta, isNew: false }); });
      corps.addEventListener('contextmenu', async ev => {
        ev.preventDefault(); ev.stopPropagation();
        if (await confirmer(`Delete zone "${z.name}"?`, '', { danger: true, oui: 'Delete' })) {
          await api.del(`/api/topology/zones/${z.id}`).catch(e => toast(e.message, true));
          rafraichirTopologie();
        }
      });
      const poignees = [['nw', z.x, z.y], ['ne', z.x + z.width, z.y], ['sw', z.x, z.y + z.height], ['se', z.x + z.width, z.y + z.height]].map(([coin, hx, hy]) => {
        const r = s('rect', { x: hx - 7, y: hy - 7, width: 14, height: 14, fill: 'var(--paper)', stroke: couleur, 'stroke-width': 2, class: `zpoignee-${coin}` });
        r.addEventListener('pointerdown', ev => {
          ev.stopPropagation();
          zoneRetaillee = { z, coin, x0: souris.x, y0: souris.y, w0: z.width, h0: z.height, zx: z.x, zy: z.y };
        });
        return r;
      });
      return s('g', { 'data-zone-node': '1' }, corps,
        s('text', { x: z.x + 12, y: z.y + 22, fill: couleur, 'font-size': 14, 'font-family': 'var(--sans)', 'font-weight': 700, class: 'znom-l', text: z.name }),
        poignees);
    }));
  }

  // Attaches déduites de l'arborescence
  // Un appareil relevé mais jamais rattaché a bien une place dans le dessin ;
  // sans ce trait, il y flotterait sans rien qui l'explique. Le pointillé pâle
  // dit ce que c'est : une déduction, pas une liaison enregistrée.
  function dessinerAttaches() {
    const pos = positions();
    remplir(couches.attaches, ...(!arbre ? [] : Object.entries(arbre.rattachements).map(([feuilleId, pereId]) => {
      const deja = E.topology.links.some(l => (l.fromId === feuilleId && l.toId === pereId) || (l.toId === feuilleId && l.fromId === pereId));
      const a = pos[pereId], b = pos[feuilleId];
      if (deja || !a || !b) return null;
      const feuille = E.devices.find(d => d.id === feuilleId);
      return s('path', { d: courbeArbre(a, b, MARGE_COURBE), class: sansFil(feuille) ? 'lien-arbre air deduit' : 'lien-arbre deduit', style: { pointerEvents: 'none' } });
    }).filter(Boolean)),
    ...(arbre && pos[INTERNET] ? [s('path', { d: courbeArbre(pos[INTERNET], pos[arbre.racine], MARGE_COURBE), class: 'lien-arbre', style: { pointerEvents: 'none' } })] : []));
  }

  function dessinerLiens() {
    const pos = positions();
    const parId = new Map(E.devices.map(d => [d.id, d]));
    remplir(couches.liens, ...E.topology.links.map(l => {
      const a = pos[l.fromId], b = pos[l.toId];
      if (!a || !b) return null;
      const de = parId.get(l.fromId), vers = parId.get(l.toId);
      const suspect = (de?.dangerScore ?? 0) > 60 || (vers?.dangerScore ?? 0) > 60;
      const style = LIAISONS[l.type] || LIAISONS.ethernet;
      const couleur = suspect ? 'var(--alarm)' : style.couleur;
      const choisi = lienChoisi === l.id;
      // Sens du flux : une liaison posée à la main garde le sens donné ; une
      // liaison déduite va de l'équipement réseau vers l'appareil.
      const deInfra = de && AMONT.includes(de.customType || de.type);
      const versInfra = vers && AMONT.includes(vers.customType || vers.type);
      const inverse = l.manual ? false : (!deInfra && versInfra);
      const depart = inverse ? b : a, arrivee = inverse ? a : b;
      // En arborescence, une liaison est une courbe d'un glyphe à l'autre, sans
      // flèche ni particule : la hiérarchie dit déjà le sens.
      const fils = arbre ? (arbre.rattachements[l.toId] === l.fromId ? vers : arbre.rattachements[l.fromId] === l.toId ? de : (a.x <= b.x ? vers : de)) : null;
      const mx = (a.x + b.x) / 2;
      const trace = arbre ? courbeArbre(a, b, MARGE_COURBE) : null;
      const trait = extra => trace ? s('path', { d: trace, fill: 'none', ...extra }) : s('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, ...extra });

      const zoneClic = trait({ stroke: 'transparent', 'stroke-width': 14, style: { cursor: 'pointer' } });
      zoneClic.addEventListener('click', ev => { ev.stopPropagation(); lienChoisi = choisi ? null : l.id; dessinerLiens(); });
      zoneClic.addEventListener('dblclick', async ev => {
        ev.stopPropagation();
        if (await confirmer(`Delete link between ${de?.hostname || de?.ip || '?'} and ${vers?.hostname || vers?.ip || '?'}?`, '', { danger: true, oui: 'Delete' })) {
          await api.del(`/api/topology/links/${l.id}`).catch(e => toast(e.message, true));
          lienChoisi = null; rafraichirTopologie();
        }
      });
      zoneClic.addEventListener('contextmenu', ev => { ev.preventDefault(); ev.stopPropagation(); ouvrirMenuLien(ev.clientX, ev.clientY, l); });

      if (trace) {
        return s('g', {},
          suspect ? trait({ stroke: 'var(--alarm)', 'stroke-opacity': 0.25, 'stroke-width': 6 }) : null,
          zoneClic,
          trait({
            class: ['lien-arbre', sansFil(fils, l) ? 'air' : '', suspect ? 'suspect' : '', choisi ? 'choisi' : ''].filter(Boolean).join(' '),
            style: { pointerEvents: 'none' },
          }),
          choisi ? s('text', {
            x: mx, y: (a.y + b.y) / 2 - 10, fill: couleur, 'font-size': 11, 'font-family': 'var(--mono)', 'font-weight': 700, 'text-anchor': 'middle',
            style: { pointerEvents: 'none', userSelect: 'none' }, text: l.type,
          }) : null);
      }
      let fleche;
      {
        const ax = depart.x + (arrivee.x - depart.x) * 0.6, ay = depart.y + (arrivee.y - depart.y) * 0.6;
        const angle = Math.atan2(arrivee.y - depart.y, arrivee.x - depart.x) * 180 / Math.PI;
        fleche = s('g', { transform: `translate(${ax} ${ay}) rotate(${angle})`, style: { pointerEvents: 'none' } },
          s('polygon', { points: '-7,-5 7,0 -7,5', fill: couleur, opacity: 0.9 }));
      }
      // Particule animée : elle longe le câble.
      const particule = s('circle', { cx: depart.x, cy: depart.y, r: 3, fill: couleur, opacity: 0.9, style: { pointerEvents: 'none' } },
          s('animate', { attributeName: 'cx', from: depart.x, to: arrivee.x, dur: '2.4s', repeatCount: 'indefinite' }),
          s('animate', { attributeName: 'cy', from: depart.y, to: arrivee.y, dur: '2.4s', repeatCount: 'indefinite' }),
          s('animate', { attributeName: 'opacity', values: '0;0.9;0.9;0', dur: '2.4s', repeatCount: 'indefinite' }));
      return s('g', {},
        suspect ? trait({ stroke: 'var(--alarm)', 'stroke-opacity': 0.25, 'stroke-width': 6 }) : null,
        zoneClic,
        trait({
          stroke: couleur, 'stroke-width': choisi ? style.largeur + 2 : style.largeur, opacity: choisi ? 1 : 0.75,
          'stroke-dasharray': style.tirets, class: style.anime ? 'flux-anime' : null, style: { pointerEvents: 'none' },
        }),
        fleche, particule,
        s('text', {
          x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 - 10, fill: choisi ? couleur : 'var(--muted)',
          'font-size': choisi ? 11 : 9, 'font-family': 'var(--mono)', 'font-weight': choisi ? 700 : 400, 'text-anchor': 'middle',
          style: { pointerEvents: 'none', userSelect: 'none' }, text: l.type !== 'ethernet' ? l.type : (choisi ? 'ethernet' : ''),
        }));
    }).filter(Boolean));
  }

  function dessinerApercu() {
    const a = tire ? positions()[tire] : null;
    remplir(couches.apercu, a ? s('line', { x1: a.x, y1: a.y, x2: souris.x, y2: souris.y, stroke: 'var(--accent)', 'stroke-width': 2, 'stroke-dasharray': '4 4', opacity: 0.7 }) : '');
  }

  const noeuds = new Map();
  // Un nœud de l'arborescence : glyphe plein, nom, adresse ; la radio au-dessus
  // pour un client sans fil. Pas de plaque : c'est le glyphe qu'on reconnaît.
  function noeudArbre(d, q, inquiete) {
    const G = GLYPHE, r = G / 2;
    const radio = sansFil(d) ? [bandeRadio(d.metadata?.radio), d.metadata?.essid].filter(Boolean).join(' · ') : '';
    const halo = s('circle', { r: r + 9, fill: 'none', stroke: 'var(--accent)', 'stroke-width': 1.5, opacity: 0.45, class: 'halo' });
    const classes = ['noeud-arbre', d.isMainRouter ? 'core' : '', inquiete ? 'flag' : '', d.status === 'offline' ? 'ded' : ''].filter(Boolean).join(' ');
    const g = s('g', { class: classes, 'data-device-node': '1', transform: `translate(${q.x} ${q.y}) scale(${ECHELLE_NOEUD})`, style: { cursor: 'pointer' } },
      s('rect', { x: -66, y: -r - 4, width: 132, height: G + 40, fill: 'transparent' }),
      halo,
      radio ? s('text', { class: 'ra', y: -r - 6, 'text-anchor': 'middle', text: radio.slice(0, 28) }) : null,
      glypheArbre(natureArbre(d), G),
      s('text', { class: 'nm', y: r + 15, 'text-anchor': 'middle', text: (d.customName || d.hostname || d.ip || '').slice(0, 22) }),
      s('text', { class: 'ipx', y: r + 29, 'text-anchor': 'middle', text: d.ip || '' }),
      d.dangerScore > 30 && !d.isMainRouter ? s('g', { transform: `translate(${r - 2} ${-r + 4})` },
        s('circle', { cx: 0, cy: 0, r: 10, fill: d.dangerScore > 70 ? 'var(--alarm)' : 'var(--warn)', stroke: 'var(--surface)', 'stroke-width': 1.5 }),
        s('text', { x: 0, y: 3.5, 'text-anchor': 'middle', fill: '#fff', 'font-size': 9.5, 'font-family': 'var(--mono)', 'font-weight': 500, text: String(Math.round(d.dangerScore)) })) : null);
    return { g, halo };
  }
  function noeudInternet(q) {
    return s('g', { class: 'noeud-arbre internet', transform: `translate(${q.x} ${q.y}) scale(${ECHELLE_NOEUD})`, style: { pointerEvents: 'none' } },
      glypheArbre('internet', 44),
      s('text', { class: 'nm', y: GLYPHE / 2 + 15, 'text-anchor': 'middle', text: 'Internet' }));
  }
  function dessinerNoeuds() {
    const pos = positions();
    noeuds.clear();
    remplir(couches.noeuds, arbre && pos[INTERNET] ? noeudInternet(pos[INTERNET]) : null, ...E.devices.map(d => {
      const q = pos[d.id];
      if (!q) return null;
      const T = 74, r = T / 2;
      const inquiete = d.dangerScore > 70 || d.status === 'banned' || d.status === 'quarantined';
      const enArbre = arbre ? noeudArbre(d, q, inquiete) : null;
      // Trois lectures d'un même nœud : core — l'équipement principal, plaque
      // pleine ; flag — ce qui inquiète ; ded — hors ligne, contour pointillé.
      const classes = ['unit', d.isMainRouter ? 'core' : '', inquiete ? 'flag' : '', d.status === 'offline' ? 'ded' : ''].filter(Boolean).join(' ');
      const halo = enArbre ? enArbre.halo : s('rect', { x: -r - 5, y: -r - 5, width: T + 10, height: T + 10, rx: 23, fill: 'none', stroke: 'var(--accent)', 'stroke-width': 1.5, opacity: 0.45, class: 'halo' });
      const g = enArbre ? enArbre.g : s('g', {
        class: classes, 'data-device-node': '1', transform: `translate(${q.x} ${q.y}) scale(${ECHELLE_NOEUD})`,
        style: { cursor: 'pointer', opacity: d.status === 'offline' ? 0.72 : 1 },
      },
      halo,
      s('rect', { class: 'plate', x: -r, y: -r, width: T, height: T, rx: 19 }),
      silhouette({
        type: d.customType || d.type, vendor: d.vendor, model: d.model, hostname: d.hostname,
        x: -27, y: -17, size: 54, dim: d.status === 'offline',
        color: d.isMainRouter ? 'var(--paper)' : inquiete ? 'var(--alarm)' : 'var(--ink-soft)',
      }),
      s('text', { class: 'kd', y: r + 17, 'text-anchor': 'middle', text: String(d.customType || d.type || 'inconnu').toUpperCase() }),
      s('text', { class: 'nm', y: r + 32, 'text-anchor': 'middle', text: (d.customName || d.hostname || d.ip || '').slice(0, 24) }),
      s('text', { class: 'ipx', y: r + 45, 'text-anchor': 'middle', text: d.ip || '' }),
      // Pastille de risque : seulement quand elle apprend quelque chose.
      d.dangerScore > 30 && !d.isMainRouter ? s('g', { transform: `translate(${r - 7} ${-r + 7})` },
        s('circle', { cx: 0, cy: 0, r: 11, fill: d.dangerScore > 70 ? 'var(--alarm)' : 'var(--warn)', stroke: 'var(--surface)', 'stroke-width': 1.5 }),
        s('text', { x: 0, y: 3.5, 'text-anchor': 'middle', fill: '#fff', 'font-size': 9.5, 'font-family': 'var(--mono)', 'font-weight': 500, text: String(Math.round(d.dangerScore)) })) : null);
      g.addEventListener('pointerdown', ev => {
        ev.stopPropagation();
        if (ev.button === 2) { ev.preventDefault(); tire = d.id; glisse = null; marquerHalo(); return; }
        // En arborescence, les places sont calculées : on ne déplace pas un
        // nœud pour le voir revenir au relevé suivant. Le clic ouvre la fiche.
        if (ev.button !== 0 || mode === 'arbre') return;
        glisse = { id: d.id, bouge: false };
        tire = null;
      });
      g.addEventListener('pointerenter', () => survoler(d.id));
      g.addEventListener('pointerleave', () => survoler(null));
      g.addEventListener('click', ev => {
        ev.stopPropagation();
        if (dernierGlisseBouge) { dernierGlisseBouge = false; return; }
        choisirAppareil(d.id);
      });
      g.addEventListener('contextmenu', ev => ev.preventDefault());
      noeuds.set(d.id, { g, halo });
      return g;
    }).filter(Boolean));
    marquerHalo();
  }

  let survole = null;
  function marquerHalo() {
    for (const [id, { halo }] of noeuds) {
      const vu = id === survole || id === tire;
      halo.style.display = vu ? '' : 'none';
      halo.setAttribute('opacity', id === tire ? 0.9 : 0.45);
    }
  }
  function survoler(id) {
    survole = id;
    marquerHalo();
    const d = id ? E.devices.find(x => x.id === id) : null;
    bulle.hidden = !d;
    if (!d) return;
    const m = d.metadata || {};
    const lignes = [
      ['IP', d.ip], ['MAC', d.mac || '—'], ['Vendor', d.vendor || '—'],
      ['Type', d.customType ? d.type : (m.typeConfidence != null ? `${d.type} · ${Math.round(m.typeConfidence * 100)}%` : d.type)],
      ['Status', d.status],
      // Rattachement physique, tel que l'équipement réseau le rapporte.
      ...(m.swPort !== undefined ? [['Port', `commutateur · port ${m.swPort}`]] : []),
      ...(m.apMac ? [['Borne', m.essid ? `${m.essid}${m.radio ? ' · ' + m.radio : ''}${m.rssi != null ? ' · ' + m.rssi + ' dBm' : ''}` : m.apMac]] : []),
      ['Danger', `${d.dangerScore}/100`], ['Trust', `${d.trustScore}/100`],
    ];
    remplir(bulle, h('div', { class: 'topo-bulle-t', text: d.customName || d.hostname || d.ip }),
      lignes.map(([k, v]) => h('div', { class: 'topo-bulle-l' }, h('span', { text: k }), h('span', { text: String(v ?? '') }))));
  }

  function tout() {
    calculerArbre();
    dessinerZones(); dessinerAttaches(); dessinerLiens(); dessinerApercu(); dessinerNoeuds();
    vide.hidden = E.devices.length > 0;
    outils.hidden = E.devices.length === 0;
    svg.style.display = E.devices.length === 0 ? 'none' : '';
    cadrerArbre();
  }

  // Gestes
  let dernierGlisseBouge = false;
  const appareilSous = (x, y, sauf) => {
    const pos = positions();
    for (const d of E.devices) {
      if (d.id === sauf) continue;
      const q = pos[d.id];
      if (q && (q.x - x) ** 2 + (q.y - y) ** 2 < 36 * 36) return d.id;
    }
    return null;
  };
  // Le point sous le doigt avant tout geste : sur un écran tactile, aucun
  // survol ne l'a encore donné.
  conteneur.addEventListener('pointerdown', ev => { souris = versPlan(ev.clientX, ev.clientY); }, true);
  conteneur.addEventListener('pointerdown', ev => {
    if (ev.target.closest('[data-device-node],[data-zone-node],.planoutils') || tire) return;
    panDepart = { x: ev.clientX, y: ev.clientY, pan: { ...pan } };
    conteneur.classList.add('saisie');
  });
  conteneur.addEventListener('pointermove', ev => {
    souris = versPlan(ev.clientX, ev.clientY);
    if (glisse && mode === 'libre') {
      libres = { ...libres, [glisse.id]: souris };
      glisse.bouge = true;
      conteneur.classList.add('saisie');
      noeuds.get(glisse.id)?.g.setAttribute('transform', `translate(${souris.x} ${souris.y}) scale(${ECHELLE_NOEUD})`);
      dessinerLiens();
      return;
    }
    if (tire) { dessinerApercu(); return; }
    if (zoneGlissee) {
      zoneGlissee.z.x = souris.x - zoneGlissee.dx;
      zoneGlissee.z.y = souris.y - zoneGlissee.dy;
      dessinerZones();
      return;
    }
    if (zoneRetaillee) {
      const zr = zoneRetaillee, z = zr.z, dx = souris.x - zr.x0, dy = souris.y - zr.y0, min = 40;
      if (zr.coin === 'se') { z.width = Math.max(min, zr.w0 + dx); z.height = Math.max(min, zr.h0 + dy); }
      else if (zr.coin === 'sw') { const nw = Math.max(min, zr.w0 - dx); z.x = zr.zx + (zr.w0 - nw); z.width = nw; z.height = Math.max(min, zr.h0 + dy); }
      else if (zr.coin === 'ne') { z.width = Math.max(min, zr.w0 + dx); const nh = Math.max(min, zr.h0 - dy); z.y = zr.zy + (zr.h0 - nh); z.height = nh; }
      else { const nw = Math.max(min, zr.w0 - dx), nh = Math.max(min, zr.h0 - dy); z.x = zr.zx + (zr.w0 - nw); z.y = zr.zy + (zr.h0 - nh); z.width = nw; z.height = nh; }
      dessinerZones();
      return;
    }
    if (panDepart) {
      pan = { x: panDepart.pan.x + ev.clientX - panDepart.x, y: panDepart.pan.y + ev.clientY - panDepart.y };
      transformer();
    }
  });
  const relacher = async ev => {
    conteneur.classList.remove('saisie');
    if (glisse && mode === 'libre') {
      const q = libres[glisse.id];
      dernierGlisseBouge = glisse.bouge;
      // Route ouverte au rôle lecture : déplacer une plaque n'est pas modifier
      // l'appareil.
      if (q && glisse.bouge) api.post('/api/topology/positions', { positions: [{ id: glisse.id, x: Math.round(q.x), y: Math.round(q.y) }] }).catch(() => { /* la plaque reste où elle est posée à l'écran ; rien d'autre n'en dépend */ });
    }
    if (zoneGlissee) { const z = zoneGlissee.z; api.patch(`/api/topology/zones/${z.id}`, { x: z.x, y: z.y }).catch(e => toast(e.message, true)); }
    if (zoneRetaillee) { const z = zoneRetaillee.z; api.patch(`/api/topology/zones/${z.id}`, { x: z.x, y: z.y, width: z.width, height: z.height }).catch(e => toast(e.message, true)); }
    // Liaison tirée au clic droit : on la pose sur l'appareil sous le curseur.
    if (tire && ev) {
      const cible = appareilSous(souris.x, souris.y, tire);
      if (cible) {
        try { await api.post('/api/topology/links', { fromId: tire, toId: cible, type: typeLiaison }); await rafraichirTopologie(); }
        catch { /* liaison déjà présente : rien à ajouter */ }
      }
      tire = null; dessinerApercu(); marquerHalo();
    }
    glisse = null; zoneGlissee = null; zoneRetaillee = null; panDepart = null;
  };
  conteneur.addEventListener('pointerup', relacher);
  conteneur.addEventListener('pointercancel', () => relacher(null));
  conteneur.addEventListener('click', ev => {
    if (ev.target.closest('[data-device-node],.planoutils')) return;
    tire = null; lienChoisi = null; fermerMenuLien(); dessinerLiens(); dessinerApercu(); marquerHalo();
  });
  svg.addEventListener('contextmenu', ev => ev.preventDefault());
  // Relâché hors de la fenêtre : on remet tout à zéro.
  p.ecouter(window, 'blur', () => { tire = null; glisse = null; zoneGlissee = null; zoneRetaillee = null; panDepart = null; dessinerApercu(); });

  // Menu d'une liaison
  function fermerMenuLien() { menuLien.hidden = true; remplir(menuLien); }
  function ouvrirMenuLien(x, y, l) {
    // Le menu se pose sous le curseur ; s'il déborderait, il bascule de l'autre côté.
    const MW = 240, MH = 380, marge = 6;
    let gauche = x, haut = y;
    if (gauche + MW + marge > innerWidth) gauche = x - MW;
    if (haut + MH + marge > innerHeight) haut = y - MH;
    gauche = Math.max(marge, gauche); haut = Math.max(marge, haut);
    const agir = fn => async ev => { ev.stopPropagation(); try { await fn(); await rafraichirTopologie(); } catch (e) { toast(e.message, true); } fermerMenuLien(); };
    remplir(menuLien,
      h('div', { class: 'topo-menu-t', text: `Link · ${l.type}` }),
      ['ethernet', 'wifi', 'vpn', 'trunk', 'wan', 'docker'].map(typ => h('button', {
        class: l.type === typ ? 'on' : '', type: 'button', onclick: agir(() => api.patch(`/api/topology/links/${l.id}`, { type: typ })),
      }, s('svg', { width: 32, height: 3 }, s('line', { x1: 0, y1: 1.5, x2: 32, y2: 1.5, stroke: LIAISONS[typ].couleur, 'stroke-width': 2, 'stroke-dasharray': LIAISONS[typ].tirets })), `Set type: ${typ}`)),
      h('div', { class: 'topo-menu-sep' },
        h('button', { type: 'button', onclick: agir(() => api.post(`/api/topology/links/${l.id}/reverse`)) }, '⇄ Reverse direction'),
        h('button', { class: 'danger', type: 'button', onclick: agir(async () => { await api.del(`/api/topology/links/${l.id}`); lienChoisi = null; }) }, '✕ Delete link')));
    menuLien.style.left = `${gauche}px`;
    menuLien.style.top = `${haut}px`;
    menuLien.hidden = false;
  }
  menuLien.addEventListener('contextmenu', ev => ev.preventDefault());
  p.ecouter(document, 'pointerdown', ev => { if (!menuLien.hidden && !menuLien.contains(ev.target)) fermerMenuLien(); });

  // Zones : création et édition
  function nouvelleZone() {
    const cx = -pan.x / zoom + W / 2, cy = -pan.y / zoom + H / 2;
    editerZone({ isNew: true, id: '', name: 'Nouvelle zone', color: PALETTE_ZONES[0], x: cx - 200, y: cy - 100, width: 400, height: 200, opacity: 0.10, strokeStyle: 'dashed', strokeWidth: 2 });
  }
  function editerZone(zone) {
    editeurZone(zone, async donnees => {
      if (zone.isNew) await api.post('/api/topology/zones', donnees);
      else await api.patch(`/api/topology/zones/${zone.id}`, donnees);
      await rafraichirTopologie();
    });
  }
  function ajouterAppareil() {
    fenetreAppareil(async donnees => { await api.post('/api/devices/manual', donnees); await rafraichirAppareils(); });
  }

  // Réactions à l'état
  p.suivre('devices', () => { placerLibres(); tout(); cadrerUneFois(); });
  p.suivre('topology', tout);

  placerLibres();
  selAgencement.value = mode;
  info.textContent = mode === 'arbre' ? 'places calculées' : 'glisser pour déplacer';
  dessinerPlan();
  tout();
  transformer();
  // Cadrage à la première ouverture : on ne montre pas un coin vide d'un plan
  // de 2400 unités alors que le parc tient dans un mouchoir.
  requestAnimationFrame(cadrerUneFois);

  return { noeud: conteneur, agencement: appliquerMode };
}

// Éditeur de zone
function modale(titre, corps, pied, { large = 520 } = {}) {
  const fermer = () => { voile.remove(); document.removeEventListener('keydown', echap); };
  const echap = ev => { if (ev.key === 'Escape') fermer(); };
  const boite = h('div', { class: 'modale', role: 'dialog', 'aria-modal': 'true', 'aria-label': titre, style: { width: large } },
    h('div', { class: 'modale-tete' }, h('div', { class: 'modale-titre', text: titre }), h('button', { class: 'modale-x', type: 'button', 'aria-label': 'Close', onclick: () => fermer() }, '✕')),
    corps, h('div', { class: 'modale-pied' }, pied(fermer)));
  const voile = h('div', { class: 'modale-voile', onclick: ev => { if (ev.target === voile) fermer(); } }, boite);
  document.body.append(voile);
  document.addEventListener('keydown', echap);
  boite.querySelector('input')?.focus();
  return fermer;
}

const etiquette = texte => h('div', { class: 'modale-lbl' }, texte);

function editeurZone(zone, enregistrer) {
  const v = {
    name: zone.name || '', color: zone.color || PALETTE_ZONES[0], strokeStyle: zone.strokeStyle || 'dashed',
    strokeWidth: zone.strokeWidth || 2, opacity: zone.opacity ?? 0.10, width: zone.width || 400, height: zone.height || 200,
  };
  const apercuRect = s('rect', { x: 2, y: 2, width: 456, height: 66, rx: 10 });
  const apercuTexte = s('text', { x: 16, y: 40, 'font-size': 18, 'font-family': 'var(--sans)', 'font-weight': 700 });
  const couleurs = h('div', { class: 'modale-couleurs' });
  const traits = h('div', { class: 'modale-traits' });
  const libLargeur = etiquette(''), libOpacite = etiquette('');
  const creer = h('button', { class: 'modale-ok', type: 'button' }, zone.isNew ? 'Create zone' : 'Save changes');
  const peindre = () => {
    apercuRect.setAttribute('fill', v.color); apercuRect.setAttribute('fill-opacity', v.opacity);
    apercuRect.setAttribute('stroke', v.color); apercuRect.setAttribute('stroke-width', v.strokeWidth);
    apercuRect.setAttribute('stroke-dasharray', TRAITS[v.strokeStyle] || TRAITS.dashed);
    apercuTexte.setAttribute('fill', v.color); apercuTexte.textContent = v.name || 'Zone preview';
    remplir(couleurs, ...PALETTE_ZONES.map(c => {
      const b = h('button', { class: v.color === c ? 'pastille on' : 'pastille', type: 'button', 'aria-label': c, onclick: () => { v.color = c; peindre(); } });
      b.style.background = c;
      if (v.color === c) b.style.boxShadow = `0 0 0 1px var(--paper), 0 0 0 3px ${c}80`;
      return b;
    }), perso);
    remplir(traits, ...Object.entries(TRAITS).map(([k, d]) => {
      const b = h('button', { class: v.strokeStyle === k ? 'trait on' : 'trait', type: 'button', onclick: () => { v.strokeStyle = k; peindre(); } },
        s('svg', { width: 48, height: 6 }, s('line', { x1: 2, y1: 3, x2: 46, y2: 3, stroke: v.color, 'stroke-width': 2, 'stroke-dasharray': d })),
        h('span', { text: k }));
      if (v.strokeStyle === k) { b.style.borderColor = v.color; b.style.color = v.color; b.style.background = `${v.color}20`; }
      return b;
    }));
    libLargeur.textContent = `Border width — ${v.strokeWidth}px`;
    libOpacite.textContent = `Fill opacity — ${Math.round(v.opacity * 100)}%`;
    creer.disabled = !v.name;
  };
  const perso = h('input', { type: 'color', value: /^#[0-9a-f]{6}$/i.test(v.color) ? v.color : '#1b2aff', title: 'Custom color', class: 'pastille-perso' });
  perso.addEventListener('input', () => { v.color = perso.value; peindre(); });
  const nom = h('input', { class: 'modale-champ', value: v.name, placeholder: 'Living Room', 'aria-label': 'Name' });
  nom.addEventListener('input', () => { v.name = nom.value; peindre(); });
  const epaisseur = h('input', { type: 'range', min: 1, max: 6, step: 1, value: v.strokeWidth, 'aria-label': 'Border width' });
  epaisseur.addEventListener('input', () => { v.strokeWidth = parseInt(epaisseur.value); peindre(); });
  const opacite = h('input', { type: 'range', min: 0, max: 50, step: 1, value: Math.round(v.opacity * 100), 'aria-label': 'Fill opacity' });
  opacite.addEventListener('input', () => { v.opacity = parseInt(opacite.value) / 100; peindre(); });
  const largeur = h('input', { class: 'modale-champ', type: 'number', min: 40, value: Math.round(v.width), 'aria-label': 'Width' });
  largeur.addEventListener('input', () => { v.width = parseInt(largeur.value) || 40; });
  const hauteur = h('input', { class: 'modale-champ', type: 'number', min: 40, value: Math.round(v.height), 'aria-label': 'Height' });
  hauteur.addEventListener('input', () => { v.height = parseInt(hauteur.value) || 40; });
  peindre();
  modale(zone.isNew ? 'New zone' : 'Edit zone',
    h('div', { class: 'modale-corps' },
      h('div', { class: 'modale-apercu' }, s('svg', { width: '100%', height: '100%', viewBox: '0 0 460 70', preserveAspectRatio: 'none' }, apercuRect, apercuTexte)),
      h('div', {}, etiquette('Name'), nom),
      h('div', {}, etiquette('Color'), couleurs),
      h('div', {}, etiquette('Border style'), traits),
      h('div', { class: 'modale-deux' }, h('div', {}, libLargeur, epaisseur), h('div', {}, libOpacite, opacite)),
      h('div', { class: 'modale-deux' }, h('div', {}, etiquette('Width'), largeur), h('div', {}, etiquette('Height'), hauteur))),
    fermer => {
      creer.addEventListener('click', async () => {
        try {
          // Le serveur range les réglages d'affichage dans « notes », en JSON.
          await enregistrer({ name: v.name, color: v.color, x: zone.x, y: zone.y, width: v.width, height: v.height, notes: JSON.stringify({ strokeStyle: v.strokeStyle, strokeWidth: v.strokeWidth, opacity: v.opacity }) });
          fermer();
        } catch (e) { toast(e.message, true); }
      });
      return [h('button', { class: 'modale-annuler', type: 'button', onclick: fermer }, 'Cancel'), creer];
    });
}

// Appareil ajouté à la main
const TYPES_MANUELS = [
  ['router', '🌐', 'Router'], ['switch', '🔀', 'Switch'], ['ap', '📡', 'Access Point'], ['firewall', '🛡', 'Firewall'],
  ['server', '🖥️', 'Server / NAS'], ['laptop', '💻', 'Laptop / Desktop'], ['phone', '📱', 'Phone'], ['printer', '🖨', 'Printer'],
  ['camera', '📷', 'Camera'], ['tv', '📺', 'TV / Media'], ['console', '🎮', 'Console'], ['iot', '⚡', 'IoT'],
  ['vm', '📦', 'VM'], ['container', '🐳', 'Container'], ['unknown', '❓', 'Unknown'],
];

function fenetreAppareil(enregistrer) {
  const f = { customName: '', type: 'switch', vendor: '', model: '', ip: '', mac: '', hostname: '', notes: '' };
  const types = h('div', { class: 'modale-types' });
  const ajouter = h('button', { class: 'modale-ok', type: 'button', disabled: true }, 'Add device');
  const peindreTypes = () => remplir(types, ...TYPES_MANUELS.map(([v, emoji, lib]) => h('button', {
    class: f.type === v ? 'type on' : 'type', type: 'button', onclick: () => { f.type = v; peindreTypes(); },
  }, h('span', { class: 'emoji', text: emoji }), h('span', { text: lib }))));
  peindreTypes();
  const saisie = (cle, placeholder, lib, extra = {}) => {
    const el = h(extra.multiligne ? 'textarea' : 'input', { class: 'modale-champ', placeholder, 'aria-label': lib, rows: extra.multiligne ? 2 : undefined });
    el.addEventListener('input', () => { f[cle] = el.value; ajouter.disabled = !f.customName; });
    return el;
  };
  modale('Add device manually',
    h('div', { class: 'modale-corps' },
      h('div', { class: 'modale-aide', text: "Use this for devices that don't show up in scans (managed switches, isolated APs, equipment behind NAT…). Just give it a name and type. IP and MAC are optional." }),
      h('div', {}, etiquette('Type'), types),
      h('div', { class: 'modale-deux' },
        h('div', {}, etiquette(['Name ', h('span', { class: 'requis', text: '*' })]), saisie('customName', 'e.g. Garage Switch', 'Name')),
        h('div', {}, etiquette('Hostname'), saisie('hostname', 'optional', 'Hostname')),
        h('div', {}, etiquette('IP address'), saisie('ip', 'optional', 'IP address')),
        h('div', {}, etiquette('MAC address'), saisie('mac', 'optional', 'MAC address')),
        h('div', {}, etiquette('Vendor'), saisie('vendor', 'e.g. Cisco', 'Vendor')),
        h('div', {}, etiquette('Model'), saisie('model', 'e.g. Catalyst 2960', 'Model'))),
      h('div', {}, etiquette('Notes'), saisie('notes', '', 'Notes', { multiligne: true }))),
    fermer => {
      ajouter.addEventListener('click', async () => {
        if (!f.customName) return;
        ajouter.disabled = true; ajouter.textContent = 'Adding…';
        try {
          // Un champ laissé vide n'est pas envoyé : le serveur refuse null là
          // où il attend une chaîne.
          const facultatifs = Object.fromEntries(['hostname', 'ip', 'mac', 'vendor', 'model', 'notes']
            .filter(k => String(f[k]).trim()).map(k => [k, String(f[k]).trim()]));
          await enregistrer({ customName: f.customName, type: f.type, customType: f.type, ...facultatifs });
          fermer();
        } catch (e) { toast(e.message, true); ajouter.disabled = false; ajouter.textContent = 'Add device'; }
      });
      return [h('button', { class: 'modale-annuler', type: 'button', onclick: fermer }, 'Cancel'), ajouter];
    }, { large: 540 });
}
