// Coquille applicative — les deux dispositions de MapMyLAN.
//
// Un seul arbre, deux lectures :
//
//   « lecture » (reading)  rail large à gauche, barre de recherche, une page à
//                          la fois, beaucoup d'air.
//   « atelier » (workshop) barre supérieure, rail à pictos, explorateur en
//                          arbre, dock d'état en bas, tout visible d'un coup.
//
// Ce qui distingue les deux est l'attribut data-shell posé sur <html> : la
// feuille masque le rail large en atelier, et l'explorateur en lecture. Le
// contenu des pages est rigoureusement le même d'une disposition à l'autre.
// Sous 760 px, l'atelier n'a plus la place de ses panneaux : la feuille
// ramène alors la disposition de lecture, rail en tiroir.
import { h, ic, pictoType, remplir } from './dom.js';
import { E, api, choisirPage, choisirAppareil, changerDisposition, lancerBalayage, poser } from './etat.js';
import { t, langue, changerLangue } from './i18n.js';
import { boutonAssistant, basculer as basculerAssistant } from './assistant/panneau.js';
import { estSombre, appliquerTheme } from '/socle/compte.js';

// Le raccourci de la palette, tel que le clavier de la machine le nomme.
const RACCOURCI = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent) ? '⌘K' : 'Ctrl K';

// L'ordre est celui de la maquette. Les groupes portent un nom : un rail de
// quinze entrées sans intertitre ne se lit plus.
export const NAV = [
  { id: 'dashboard', icon: 'overview', group: 'main' },
  { id: 'map', icon: 'map', group: 'main' },
  { id: 'world', icon: 'globe', group: 'main' },
  { id: 'devices', icon: 'devices', group: 'main' },
  { id: 'vlans', icon: 'vlan', group: 'main' },
  { id: 'security', icon: 'shield', group: 'security' },
  { id: 'vulns', icon: 'alert', group: 'security' },
  { id: 'router', icon: 'router', group: 'control' },
  { id: 'botcommands', icon: 'bot', group: 'control' },
  { id: 'ssh', icon: 'ssh', group: 'control' },
  { id: 'host', icon: 'server', group: 'control' },
  { id: 'inventory', icon: 'switch', group: 'control' },
  { id: 'notifications', icon: 'bell', group: 'monitor' },
  { id: 'logs', icon: 'logs', group: 'monitor' },
  { id: 'reports', icon: 'chart', group: 'monitor' },
  { id: 'settings', icon: 'settings', group: 'system' },
  { id: 'users', icon: 'users', group: 'system', admin: true },
  { id: 'compte', icon: 'key', group: 'system' },
];
const GROUPES = ['main', 'security', 'control', 'monitor', 'system'];

// Rail à pictos de l'atelier : un sous-ensemble, celui qu'on ouvre dix fois
// par jour. Le reste passe par l'explorateur ou la recherche.
const RAIL_ATELIER = [
  { id: 'dashboard', icon: 'overview', court: 'Aperçu' },
  { id: 'map', icon: 'map', court: 'Carte' },
  { id: 'world', icon: 'globe', court: 'Monde' },
  { id: 'devices', icon: 'devices', court: 'Parc' },
  { id: 'security', icon: 'shield', court: 'Défense' },
  { id: 'router', icon: 'router', court: 'Équip.' },
];
const RAIL_ATELIER_BAS = [
  { id: 'logs', icon: 'logs', court: 'Journal' },
  { id: 'settings', icon: 'settings', court: 'Réglages' },
];

const deux = n => String(n).padStart(2, '0');

/** Le thème actif, qu'il soit choisi ou hérité du système. */
export function basculerTheme() {
  const cle = estSombre() ? 'light' : 'dark';
  document.documentElement.dataset.theme = cle;
  try { localStorage.setItem('theme', cle); } catch { /* le choix vaut pour la session */ }
  appliquerTheme();
}

async function seDeconnecter() {
  await api.post('/api/compte/deconnexion').catch(() => { /* session déjà close : le rechargement ramène à la porte */ });
  location.reload();
}

/**
 * Recherche : filtre le parc et ouvre la fiche de l'appareil choisi.
 * Elle ne remplace pas le tableau des appareils, elle évite d'y aller.
 */
function recherche({ atelier }) {
  const liste = h('div', { class: atelier ? 'trouves atelier' : 'trouves', hidden: true });
  const champ = h('input', { placeholder: t('top.search'), 'aria-label': t('top.search'), autocomplete: 'off' });
  const peindre = () => {
    const q = champ.value.trim().toLowerCase();
    const trouves = !q ? [] : E.devices.filter(d =>
      [d.ip, d.mac, d.hostname, d.customName, d.vendor, atelier ? null : d.type]
        .filter(Boolean).some(v => String(v).toLowerCase().includes(q))).slice(0, atelier ? 8 : 7);
    liste.hidden = !trouves.length;
    remplir(liste, ...trouves.map(d => h('button', {
      class: 'trow', type: 'button', onclick: () => { choisirAppareil(d.id); champ.value = ''; peindre(); },
    }, h('span', { class: 'ic' }, ic(atelier ? pictoType(d.customType || d.type) : 'devices', 13)),
      h('span', { class: 'nm2', text: d.customName || d.hostname || d.ip }),
      h('span', { class: 'ipx2', text: d.ip }))));
  };
  champ.addEventListener('input', peindre);
  return h('div', { class: atelier ? 'recherche atelier' : 'recherche' },
    h('label', { class: atelier ? 'wcmd' : 'search' }, ic('search', 13), champ, h('kbd', { text: RACCOURCI })),
    liste);
}

// Compte à rebours du prochain balayage
// La période vient des réglages ; à défaut, cinq minutes, comme le serveur.
// Le compteur repart à chaque fin de balayage plutôt qu'à intervalle fixe :
// c'est la fin réelle qui fait foi, pas l'horloge de l'interface.
function balayage(p) {
  const b = { periode: 300, reste: 300 };
  api.get('/api/settings').then(r => {
    const v = parseInt(String(r?.['scan.interval'] ?? 300), 10);
    if (Number.isFinite(v) && v > 0) { b.periode = v; b.reste = v; }
  }).catch(() => { /* la période par défaut sert de repère */ });
  p.suivre('scanRunning', () => { if (!E.scanRunning) b.reste = b.periode; });
  p.intervalle(() => { b.reste = b.reste <= 0 ? b.periode : b.reste - 1; }, 1000);
  b.mmss = () => `${Math.floor(b.reste / 60)}:${deux(b.reste % 60)}`;
  b.avancement = () => Math.max(0, Math.min(100, Math.round(100 - (b.reste / b.periode) * 100)));
  return b;
}

// Rail large, disposition lecture
function rail(p, b, navs) {
  const compteurs = () => ({
    devices: E.devices.length,
    vlans: E.vlans.length,
    vulns: E.devices.reduce((n, d) => n + (d.cves?.length || 0), 0),
    security: E.devices.filter(d => d.status === 'banned' || d.status === 'quarantined').length,
    notifications: E.alerts.filter(a => !a.acknowledged).length,
  });
  const cnts = {};
  const admin = E.moi?.role === 'admin';
  const groupes = GROUPES.map(g => h('div', { class: 'grp' }, h('span', { text: t(`nav.group.${g}`) }),
    NAV.filter(n => n.group === g && (!n.admin || admin)).map(n => {
      cnts[n.id] = h('span', { class: 'cnt' });
      return (navs[n.id] = h('button', { class: 'nav', type: 'button', onclick: () => choisirPage(n.id), title: t(`nav.${n.id}`) },
        ic(n.icon, 16), h('span', { class: 'lib', text: t(`nav.${n.id}`) }), cnts[n.id]));
    })));
  const peindreCompteurs = () => {
    const c = compteurs();
    for (const [id, el] of Object.entries(cnts)) { el.textContent = c[id] ? String(c[id]) : ''; el.hidden = !c[id]; }
  };
  p.suivre(['devices', 'vlans', 'alerts'], peindreCompteurs);
  peindreCompteurs();

  const prochain = h('b'), frequence = h('b'), barre = h('i');
  const peindreCarte = () => {
    prochain.textContent = E.scanRunning ? '…' : b.mmss();
    frequence.textContent = t('rail.minutes', { n: Math.round(b.periode / 60) });
    barre.style.width = `${E.scanRunning ? 100 : b.avancement()}%`;
  };
  p.intervalle(peindreCarte, 1000);
  p.suivre('scanRunning', peindreCarte);
  peindreCarte();

  return h('aside', { class: 'rail', 'aria-label': 'Navigation' },
    h('div', { class: 'mark' },
      // La marque porte sa propre transparence : ni fond ni arrondi, elle tient
      // sur le clair comme sur le sombre. La gamme Console la pose dans une
      // tuile claire, suivie du sélecteur.
      h('img', { class: 'marque', src: '/logo.png', alt: 'MapMyLAN' }),
      h('span', { class: 'tuile', 'aria-hidden': 'true' }, ic('map', 16, { trait: 2.2 })),
      h('b', { text: 'MapMyLAN' }), h('span', { class: 'pulse' }), h('span', { class: 'chev', 'aria-hidden': 'true' }, ic('deplier', 14))),
    h('button', { class: 'rail-cherche', type: 'button', onclick: () => ouvrirPalette() },
      ic('search', 15), h('span', { text: t('top.search.short') }), h('kbd', { text: RACCOURCI })),
    groupes,
    plagesRail(p),
    h('div', { class: 'railcard' },
      h('div', { class: 'row' }, ic('clock', 13), h('span', { text: t('rail.next') }), prochain),
      h('div', { class: 'row' }, ic('refresh', 13), h('span', { text: t('rail.every') }), frequence),
      h('div', { class: 'bar' }, barre)));
}

// Les plages balayées, dans le rail de la gamme Console : un clic ouvre le
// parc filtré sur la plage. Lues une fois au montage, puis à chaque balayage.
function plagesRail(p) {
  const liste = h('div', { class: 'plages-rail' });
  const peindre = plages => remplir(liste,
    h('div', { class: 'sec-rail' }, h('span', { text: t('rail.ranges') }), h('button', { class: 'plus', type: 'button', title: t('rail.ranges.add'), 'aria-label': t('rail.ranges.add'), onclick: () => choisirPage('settings'), text: '+' })),
    ...plages.map(x => h('button', { class: 'plage', type: 'button', onclick: () => { poser({ filtreAppareils: prefixe(x.cidr) }); choisirPage('devices'); } },
      ic(E.scanRunning ? 'refresh' : 'wired', 15), h('span', { class: 'lib', text: x.label || x.cidr }), h('span', { class: 'cidr', text: x.cidr }))));
  const lire = () => api.get('/api/devices/scan/ranges').then(r => peindre(Array.isArray(r) ? r : [])).catch(() => peindre([]));
  p.suivre('scanRunning', lire);
  lire();
  return liste;
}
// Ce qu'une adresse de la plage a en commun avec les autres, pour le filtre du parc.
const prefixe = cidr => {
  const [ip, n] = String(cidr).split('/');
  const octets = Math.max(1, Math.min(3, Math.floor(Number(n) / 8)));
  return ip.split('.').slice(0, octets).join('.') + '.';
};

/* Palette de commandes (⌘K) : appareils, pages et actions, au clavier. En
   gamme SOMA, ⌘K place le curseur dans la recherche de la barre du haut. */
let paletteOuverte = null;
export function ouvrirPalette() {
  if (document.documentElement.dataset.gamme !== 'console') {
    document.querySelector('.top .search input, .wcmd input')?.focus();
    return;
  }
  if (paletteOuverte?.isConnected) return;
  const champ = h('input', { placeholder: t('palette.placeholder'), 'aria-label': t('palette.placeholder'), autocomplete: 'off' });
  const liste = h('div', { class: 'pal-liste', role: 'listbox' });
  let rang = 0, elements = [];
  const fermer = () => { voile.remove(); paletteOuverte = null; document.removeEventListener('keydown', clavier, true); };
  const ACTIONS = [
    { titre: t('act.scan'), icone: 'refresh', agir: () => lancerBalayage() },
    { titre: t('shell.toWorkshop'), icone: 'overview', agir: () => changerDisposition('workshop') },
    { titre: t('top.assistant'), icone: 'sparkle', agir: () => basculerAssistant() },
  ];
  const peindre = () => {
    const q = champ.value.trim().toLowerCase();
    const mots = q.split(/\s+/).filter(Boolean);
    const vaut = texte => !mots.length || mots.every(m => texte.toLowerCase().includes(m));
    const appareils = E.devices.filter(d => vaut([d.ip, d.mac, d.hostname, d.customName, d.vendor].filter(Boolean).join(' '))).slice(0, 6)
      .map(d => ({ groupe: t('palette.devices'), titre: d.customName || d.hostname || d.ip, id: d.ip, icone: pictoType(d.customType || d.type),
        droite: d.status === 'online' ? t('state.online') : t(`state.${d.status}`), attention: ['suspect', 'quarantined', 'banned'].includes(d.status), agir: () => choisirAppareil(d.id) }));
    const pages = NAV.filter(n => (!n.admin || E.moi?.role === 'admin') && vaut(t(`nav.${n.id}`))).slice(0, q ? 5 : 4)
      .map(n => ({ groupe: t('palette.pages'), titre: t(`nav.${n.id}`), icone: n.icon, agir: () => choisirPage(n.id) }));
    const actions = ACTIONS.filter(a => vaut(a.titre)).map(a => ({ ...a, groupe: t('palette.actions') }));
    elements = [...appareils, ...pages, ...actions];
    rang = Math.min(rang, Math.max(0, elements.length - 1));
    let groupe = '';
    remplir(liste, elements.length ? elements.flatMap((x, i) => {
      const tete = x.groupe !== groupe ? [h('div', { class: 'pal-grp' }, h('span', { text: x.groupe }),
        x.groupe === t('palette.devices') ? h('span', { class: 'mono', text: t('palette.count', { n: appareils.length, total: E.devices.length }) }) : null)] : [];
      groupe = x.groupe;
      return [...tete, h('button', { class: i === rang ? 'pal-it act' : 'pal-it', type: 'button', role: 'option', 'aria-selected': String(i === rang),
        onmousemove: () => { if (rang !== i) { rang = i; peindre(); } }, onclick: () => { fermer(); x.agir(); } },
        h('span', { class: x.attention ? 'pal-ic g' : 'pal-ic' }, ic(x.icone, 15)),
        h('span', { class: 'pal-m' }, h('span', { class: 'pal-t', text: x.titre }), x.id ? h('span', { class: 'pal-id', text: x.id }) : null),
        x.touches ? h('span', { class: 'pal-k' }, ...x.touches.map(k => h('span', { text: k }))) : h('span', { class: x.attention ? 'pal-r g' : 'pal-r', text: x.droite || '' }))];
    }) : [h('div', { class: 'pal-vide', text: t('palette.empty', { q: champ.value.trim() }) })]);
  };
  const clavier = e => {
    if (e.key === 'Escape') { e.preventDefault(); fermer(); }
    else if (e.key === 'ArrowDown' && elements.length) { e.preventDefault(); rang = (rang + 1) % elements.length; peindre(); }
    else if (e.key === 'ArrowUp' && elements.length) { e.preventDefault(); rang = (rang - 1 + elements.length) % elements.length; peindre(); }
    else if (e.key === 'Enter' && elements[rang]) { e.preventDefault(); const x = elements[rang]; fermer(); x.agir(); }
  };
  const voile = h('div', { class: 'pal-voile', onclick: e => { if (e.target === voile) fermer(); } },
    h('div', { class: 'pal', role: 'dialog', 'aria-modal': 'true', 'aria-label': t('palette.title') },
      h('label', { class: 'pal-in' }, ic('search', 16), champ, h('kbd', { text: t('palette.esc') })),
      liste,
      h('div', { class: 'pal-ft' },
        h('span', { class: 'pal-k' }, h('span', { text: '↑↓' })), h('span', { text: t('palette.navigate') }),
        h('span', { class: 'pal-k' }, h('span', { text: '↵' })), h('span', { text: t('palette.open') }),
        h('button', { class: 'pal-ask', type: 'button', onclick: () => { fermer(); basculerAssistant(); } }, ic('sparkle', 14), h('span', { text: t('palette.ask') })))));
  champ.addEventListener('input', () => { rang = 0; peindre(); });
  document.addEventListener('keydown', clavier, true);
  document.body.append(voile);
  paletteOuverte = voile;
  peindre();
  champ.focus();
}
document.addEventListener('keydown', e => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k' && !e.shiftKey && !e.altKey) { e.preventDefault(); ouvrirPalette(); }
});

// Barre du haut, disposition lecture
function barreHaut(app) {
  const initiales = String(E.moi?.identifiant || '?').slice(0, 2).toUpperCase();
  return h('div', { class: 'top' },
    h('button', { class: 'ghost menu', type: 'button', 'aria-label': 'Menu', onclick: () => app.classList.toggle('menu-ouvert') }, ic('menu', 16)),
    recherche({ atelier: false }),
    h('div', { class: 'topright' },
      basculeDisposition('workshop'),
      h('button', { class: 'ghost langue', type: 'button', title: t('top.language'), onclick: () => changerLangue(langue() === 'fr' ? 'en' : 'fr'), text: langue().toUpperCase() }),
      boutonAssistant(32, 16),
      h('button', { class: 'ghost cache-etroit', type: 'button', title: t('top.notifications'), 'aria-label': t('top.notifications'), onclick: () => choisirPage('notifications') }, ic('bell', 16)),
      h('button', { class: 'ghost bascule-theme', type: 'button', title: t('top.appearance'), 'aria-label': t('top.appearance'), onclick: basculerTheme }, ic('mode', 16)),
      h('button', { class: 'ghost', type: 'button', title: t('top.logout'), 'aria-label': t('top.logout'), onclick: seDeconnecter }, ic('power', 16)),
      h('div', { class: 'who cache-etroit', title: E.moi?.identifiant || '', text: initiales })));
}

// Le passage d'une disposition à l'autre. La 1.4 le posait en bouton
// flottant au coin de l'écran, par-dessus le contenu ; il vit ici dans la
// barre du haut, où il ne recouvre rien.
function basculeDisposition(vers) {
  const texte = vers === 'workshop' ? t('shell.toWorkshop') : t('shell.toReading');
  return h('button', { class: 'swap-haut', type: 'button', title: texte, 'aria-label': texte, onclick: () => changerDisposition(vers) },
    ic(vers === 'workshop' ? 'overview' : 'logs', 14), h('span', { class: 'swap-lib', text: texte }));
}

// Disposition atelier
function atelierHaut(p) {
  const hotes = h('span');
  const peindre = () => { hotes.textContent = `${E.devices.length} hôtes`; };
  p.suivre('devices', peindre);
  peindre();
  const petit = { width: 28, height: 28 };
  return h('div', { class: 'wtop' },
    h('div', { class: 'brand' }, h('img', { class: 'marque', src: '/logo.png', alt: 'MapMyLAN' }),
      h('div', {}, h('b', { text: 'MapMyLAN' }), ' ', hotes)),
    h('div', { class: 'wcentre' }, recherche({ atelier: true })),
    h('div', { class: 'wboutons' },
      basculeDisposition('reading'),
      boutonAssistant(28, 15),
      h('button', { class: 'ghost', type: 'button', style: petit, title: t('top.notifications'), 'aria-label': t('top.notifications'), onclick: () => choisirPage('notifications') }, ic('bell', 15)),
      h('button', { class: 'ghost bascule-theme', type: 'button', style: petit, title: t('top.appearance'), 'aria-label': t('top.appearance'), onclick: basculerTheme }, ic('mode', 15)),
      h('button', { class: 'ghost', type: 'button', style: petit, title: t('top.logout'), 'aria-label': t('top.logout'), onclick: seDeconnecter }, ic('power', 15))));
}

function atelierRail(riNavs) {
  const bouton = r => (riNavs[r.id] = h('button', { class: 'ri', type: 'button', onclick: () => choisirPage(r.id), title: r.court },
    ic(r.icon, 19), h('em', { text: r.court })));
  return h('nav', { class: 'wrail' }, RAIL_ATELIER.map(bouton), h('div', { class: 'bot' }, RAIL_ATELIER_BAS.map(bouton)));
}

const dernierOctet = ip => Number((ip || '').split('.')[3]) || 0;

/**
 * L'arbre suit le découpage réel du réseau : un groupe par VLAN déclaré, et
 * pour les appareils qui n'en portent pas, un groupe par sous-réseau. Rien
 * n'est inventé — si le parc est plat, l'arbre l'est aussi.
 */
function explorateur(p, b) {
  const replies = {};
  const arbre = h('div', { class: 'tree' });
  const total = h('span', { class: 'cnt' });
  const couleurEtat = st => st === 'online' ? 'var(--accent)'
    : st === 'banned' || st === 'suspect' ? 'var(--alarm)'
      : st === 'quarantined' ? 'var(--warn)' : 'var(--faint)';
  const peindre = () => {
    total.textContent = String(E.devices.length);
    // Le rang est numérique, pas alphabétique : trié comme du texte, « VLAN
    // 10 » passerait devant « VLAN 2 ». On classe par numéro de VLAN, puis par
    // les octets du sous-réseau, les groupes sans VLAN venant après.
    const parGroupe = new Map();
    for (const d of E.devices) {
      const v = E.vlans.find(x => x.id === (d.vlan ?? d.vlanId));
      const seg = /^(\d+\.\d+\.\d+)\.\d+$/.exec(d.ip || '');
      const segTxt = seg ? `${seg[1]}.0/24` : '—';
      const nom = v ? `VLAN ${v.id} · ${v.name}` : segTxt;
      const rang = v ? [0, v.id, 0, 0, 0] : [1, ...segTxt.split(/[./]/).map(n => Number(n) || 0)];
      if (!parGroupe.has(nom)) parGroupe.set(nom, { nom, rang, liste: [] });
      parGroupe.get(nom).liste.push(d);
    }
    const avant = (x, y) => {
      for (let i = 0; i < Math.max(x.length, y.length); i++) { const d = (x[i] ?? 0) - (y[i] ?? 0); if (d) return d; }
      return 0;
    };
    const groupes = [...parGroupe.values()]
      .map(g => ({ ...g, liste: g.liste.sort((x, y) => dernierOctet(x.ip) - dernierOctet(y.ip)) }))
      .sort((x, y) => avant(x.rang, y.rang) || x.nom.localeCompare(y.nom, 'fr'));
    remplir(arbre,
      groupes.length ? null : h('div', { class: 'tree-vide', text: t('explorer.empty') }),
      ...groupes.map(g => h('div', {},
        h('button', { class: 'secttl', type: 'button', onclick: () => { replies[g.nom] = !replies[g.nom]; peindre(); } },
          h('span', { class: 'pli', text: replies[g.nom] ? '▸' : '▾' }), g.nom),
        replies[g.nom] ? null : g.liste.map(d => h('button', {
          class: E.selectedDeviceId === d.id ? 'trow ind2 sel' : 'trow ind2', type: 'button', onclick: () => choisirAppareil(d.id),
        }, h('span', { class: 'ic' }, ic(pictoType(d.customType || d.type), 13)),
          h('span', { class: 'nm2', text: d.customName || d.hostname || d.ip }),
          h('span', { class: 'ipx2', text: d.ip }),
          h('span', { class: 'dd', style: { background: couleurEtat(d.status) } }))))));
  };
  p.suivre(['devices', 'vlans', 'selectedDeviceId'], peindre);
  peindre();
  // Le pied a son propre décompte de cinq minutes, comme en 1.4 : il ne lit
  // pas la période des réglages.
  let reste = 300;
  const mmss = h('b');
  const tic = () => { mmss.textContent = E.scanRunning ? '…' : `${Math.floor(reste / 60)}:${deux(reste % 60)}`; };
  p.intervalle(() => { reste = reste <= 0 ? 300 : reste - 1; tic(); }, 1000);
  tic();
  return h('aside', { class: 'explorer' },
    h('div', { class: 'exhead' }, h('span', { text: t('explorer.title') }), total),
    arbre,
    h('div', { class: 'exfoot' }, ic('clock', 13), t('rail.next'), mmss));
}

function dock(p) {
  let onglet = 'log';
  const corps = h('div', { class: 'dbody' });
  const onglets = {};
  const cotes = h('div', { class: 'dside' });
  const etat = h('div', { class: 'dside' });
  const couleur = n => n === 'error' || n === 'critical' || n === 'high' ? 'var(--alarm)'
    : n === 'warn' || n === 'medium' ? 'var(--warn)' : n === 'success' ? 'var(--accent)' : 'var(--ink-soft)';
  const peindreCorps = () => {
    for (const [k, b] of Object.entries(onglets)) b.classList.toggle('on', k === onglet);
    const lignes = onglet === 'alerts'
      ? E.alerts.slice(0, 60).map(a => ({ id: a.id, t: new Date(a.createdAt), src: a.source || 'alerte', msg: a.message, niveau: a.severity }))
      : E.logs.filter(l => onglet === 'log' || /scan|balay/i.test(String(l.source || ''))).slice(0, 120)
        .map(l => ({ id: l.id, t: new Date(l.createdAt), src: l.source, msg: l.message, niveau: l.level }));
    remplir(corps,
      lignes.length ? null : h('div', { class: 'faint', text: t('dock.empty') }),
      ...lignes.map(l => h('div', {}, h('span', { class: 't', text: l.t.toLocaleTimeString() }), ' ',
        h('span', { class: 'faint', text: l.src ?? '' }), ' ', h('span', { style: { color: couleur(l.niveau) }, text: l.msg ?? '' }))));
    // Le dock suit le direct : une fois les lignes posées, il descend tout en
    // bas s'il y était déjà, et reste où il est si on est remonté lire.
    if (corps.scrollHeight - corps.scrollTop - corps.clientHeight < 60) corps.scrollTop = corps.scrollHeight;
  };
  const peindreCotes = () => {
    const ports = E.devices.reduce((n, d) => n + (d.ports?.length || 0), 0);
    const enLigne = E.devices.filter(d => d.status === 'online').length;
    remplir(cotes, h('h4', { text: t('dock.sweep') }),
      [[t('dock.hosts'), E.devices.length], [t('dock.online'), enLigne], [t('dock.ports'), ports], ['VLAN', E.vlans.length]]
        .map(([k, v]) => h('div', { class: 'krow' }, h('span', { text: k }), h('b', { text: String(v) }))));
    // Les conteneurs remontés par la machine hôte, à défaut le seul service dont
    // on est certain : c'est lui qui répond, sinon la page ne s'afficherait pas.
    const conteneurs = (E.hostStats?.containers || []).map(c => ({ nom: c.name, ok: c.state === 'running' }));
    const services = conteneurs.length ? conteneurs.slice(0, 4) : [{ nom: 'backend', ok: true }];
    remplir(etat, h('h4', { text: t('dock.state') }), services.map(sv => h('div', { class: 'srow' }, sv.nom,
      h('span', { class: 's' }, h('i', { class: 'd', style: { background: sv.ok ? 'var(--accent)' : 'var(--alarm)' } }), sv.ok ? t('dock.up') : t('dock.down')))));
  };
  p.suivre(['logs', 'alerts'], peindreCorps);
  p.suivre(['devices', 'vlans', 'hostStats'], peindreCotes);
  peindreCorps();
  peindreCotes();
  const tab = (k, lib) => (onglets[k] = h('button', { class: 'dtab', type: 'button', onclick: () => { onglet = k; peindreCorps(); } }, lib));
  return h('div', { class: 'dock' },
    h('div', { class: 'dterm' }, h('div', { class: 'dtabs' }, tab('log', t('dock.journal')), tab('scan', t('dock.scans')), tab('alerts', t('dock.alerts'))), corps),
    cotes, etat);
}

function barreEtat(p) {
  const plage = h('span'), enLigne = h('span'), isoles = h('span'), heure = h('span');
  let cidr = '—';
  const peindre = () => {
    remplir(plage, h('i', { class: 'dot' }), ` ${cidr}`);
    enLigne.textContent = `${E.devices.filter(d => d.status === 'online').length} en ligne`;
    const n = E.devices.filter(d => d.status === 'quarantined' || d.status === 'banned').length;
    isoles.textContent = `${n} isolé${n > 1 ? 's' : ''}`;
  };
  const tic = () => { const d = new Date(); heure.textContent = `${deux(d.getHours())}:${deux(d.getMinutes())}`; };
  api.get('/api/devices/scan/ranges').then(r => {
    if (Array.isArray(r) && r.length) { cidr = r[0]?.cidr || r[0]?.subnet || '—'; peindre(); }
  }).catch(() => { /* la barre d'état affiche « — » */ });
  p.suivre('devices', peindre);
  p.intervalle(tic, 20000);
  peindre(); tic();
  return h('div', { class: 'statusbar' }, plage, enLigne, isoles, h('div', { class: 'r' }, h('span', { text: langue().toUpperCase() }), heure));
}

/**
 * Monte la coquille dans le document et rend la zone où les pages se posent.
 * p : portée de la coquille, fermée quand on la reconstruit (changement de
 * langue).
 */
export function coque(p) {
  const navs = {}, riNavs = {};
  const b = balayage(p);
  const stage = h('div', { class: 'stage' });
  const app = h('div', { class: 'app' });
  app.append(
    atelierHaut(p),
    h('div', { class: 'body' },
      rail(p, b, navs),
      h('div', { class: 'voile-rail', onclick: () => app.classList.remove('menu-ouvert') }),
      atelierRail(riNavs),
      explorateur(p, b),
      h('main', { class: 'main' }, barreHaut(app), stage, dock(p))),
    barreEtat(p));
  const marquer = () => {
    for (const [id, el] of Object.entries(navs)) el.classList.toggle('on', id === E.page);
    for (const [id, el] of Object.entries(riNavs)) el.classList.toggle('on', id === E.page);
    app.classList.remove('menu-ouvert');
  };
  p.suivre('page', marquer);
  marquer();
  document.body.prepend(app);
  p.au(() => app.remove());
  return stage;
}
