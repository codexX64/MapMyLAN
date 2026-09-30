// Trafic mondial — connexions réellement relevées.
//
// Globe orthographique dessiné au canevas, sans dépendance : les terres sont
// un semis de points et les littoraux viennent de Natural Earth.
//
// Ce qui est tracé n'est pas simulé. Le serveur relève en continu la table de
// suivi de connexions de l'équipement ; la page lit cet historique toutes les
// huit secondes. Une destination n'apparaît sur le globe que si son nom porte
// un code de ville reconnu, ou au pays d'enregistrement de son préfixe, en
// pointillé. Les autres sont listées sans arc : on ne devine pas une position.
import { h, ic, pictoType, remplir } from '../dom.js';
import { E, api } from '../etat.js';
import { t } from '../i18n.js';
import { terre, traits, vec } from '../lib/geo-globe.js';
import { etatTrafic, lireFlux, lireAggregats } from '../lib/trafic.js';

// Paliers du curseur : libellé, et durée de la fenêtre en millisecondes. Le
// journal, les quatre compteurs et les deux classements décrivent tous cette
// période.
const PALIERS = [['1 h', 3_600_000], ['24 h', 86_400_000], ['7 j', 604_800_000], ['30 j', 2_592_000_000], ['tout', 0]];

/** Nombre d'arcs gardés sur le globe : une question de lisibilité du dessin. */
const ARCS_GARDES = 300;

// Cadence de *lecture* de l'historique. Le relevé est fait par le serveur à
// son propre rythme : rafraîchir souvent ici ne touche pas la passerelle.
const PERIODE_MS = 8000;

// Point d'observation par défaut, tant que « world.origin » n'est pas réglé :
// le croisement de l'équateur et du méridien d'origine, qui ne désigne aucun
// lieu habité.
const ORIGINE = { lat: 0, lon: 0 };

// Logos
//
// Le navigateur ne parle qu'à notre propre API : c'est le serveur qui va
// chercher l'image chez les fournisseurs, la garde et la sert. La route
// répond 404 quand le réglage est éteint — il l'est par défaut — et pour un
// domaine sans logo ; la pastille prend alors le relais.
const resolus = new Map();
// Tant que le réglage n'est pas lu, ou s'il est éteint, on ne demande rien :
// la route répondrait 404 à chaque destination.
let logosActifs = false;

function teinte(nom) {
  let v = 0;
  for (let i = 0; i < nom.length; i++) v = (v * 31 + nom.charCodeAt(i)) % 360;
  return `hsl(${v} 42% 46%)`;
}

function logo(domaine, taille = 22) {
  const boite = h('span', { class: 'lg', style: { width: taille, height: taille, borderRadius: Math.round(taille * 0.28) } });
  const pastille = () => {
    remplir(boite, String((domaine || '?')[0]).toUpperCase());
    boite.style.background = domaine ? teinte(domaine) : 'var(--well)';
    boite.style.color = domaine ? '#fff' : 'var(--faint)';
    boite.style.fontSize = `${Math.round(taille * 0.44)}px`;
  };
  const image = url => {
    boite.style.background = 'var(--well)';
    remplir(boite, h('img', { src: url, alt: '', width: Math.round(taille * 0.68), height: Math.round(taille * 0.68) }));
  };
  if (!domaine || !logosActifs) { pastille(); return boite; }
  if (resolus.has(domaine)) { const u = resolus.get(domaine); if (u) image(u); else pastille(); return boite; }
  pastille();
  const im = new Image();
  im.onload = () => { resolus.set(domaine, im.src); image(im.src); };
  im.onerror = () => { resolus.set(domaine, null); };
  im.src = `/api/logos/${encodeURIComponent(domaine)}`;
  return boite;
}

// Géométrie

const INCLINAISON = 0.36;

/**
 * Projection orthographique. L'abscisse à l'écran suit le **sinus** de la
 * longitude et la profondeur son cosinus : les intervertir retourne la Terre
 * comme un gant, l'est passant à gauche.
 */
function projette(pt, rot, v) {
  const c = Math.cos(rot), sn = Math.sin(rot);
  const est = pt.x * sn + pt.z * c;
  const nord = pt.y;
  const face = pt.x * c - pt.z * sn;
  const ci = Math.cos(INCLINAISON), si = Math.sin(INCLINAISON);
  return { x: v.CX + est * v.R, y: v.CY - (nord * ci - face * si) * v.R, z: nord * si + face * ci };
}

// Un point est caché s'il est derrière la sphère ET dans sa silhouette. Au-delà
// du disque, un point arrière reste visible : c'est le cas des arcs qui
// débordent du globe.
function visible(q, v) {
  if (q.z >= 0) return true;
  return Math.hypot(q.x - v.CX, q.y - v.CY) > v.R;
}

/** Arc de grand cercle, bombé selon la distance parcourue. */
function arc(a, b, n = 46) {
  const dot = Math.max(-1, Math.min(1, a.x * b.x + a.y * b.y + a.z * b.z));
  const ang = Math.acos(dot), alt = 0.13 + 0.30 * (ang / Math.PI);
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const tt = i / n, sn = Math.sin(ang) < 1e-6 ? 1 : Math.sin(ang);
    const c1 = Math.sin((1 - tt) * ang) / sn, c2 = Math.sin(tt * ang) / sn;
    const x = a.x * c1 + b.x * c2, y = a.y * c1 + b.y * c2, z = a.z * c1 + b.z * c2;
    const m = Math.hypot(x, y, z) || 1, hh = 1 + alt * Math.sin(Math.PI * tt);
    pts.push({ x: (x / m) * hh, y: (y / m) * hh, z: (z / m) * hh, lat: 0, lon: 0 });
  }
  return pts;
}

const couleurVar = nom => getComputedStyle(document.documentElement).getPropertyValue(nom).trim() || '#888888';
function avecAlpha(hex, a) {
  const x = hex.replace('#', '');
  return `rgba(${parseInt(x.slice(0, 2), 16) || 0},${parseInt(x.slice(2, 4), 16) || 0},${parseInt(x.slice(4, 6), 16) || 0},${a})`;
}

function fmtOctets(o) {
  if (!o) return '';
  if (o >= 1048576) return `${(o / 1048576).toFixed(1)} Mo`;
  if (o >= 1024) return `${(o / 1024).toFixed(1)} Ko`;
  return `${o} o`;
}

/** Nom courant d'un service d'après son port. */
function nomProto(port, proto) {
  if (port === 443) return proto === 'udp' ? 'QUIC' : 'HTTPS';
  if (port === 80) return 'HTTP';
  if (port === 53) return 'DNS';
  if (port === 853) return 'DoT';
  if (port === 993) return 'IMAPS';
  if (port === 587 || port === 465) return 'SMTP';
  if (port === 22) return 'SSH';
  if (port === 123) return 'NTP';
  return `${String(proto || '').toUpperCase()} ${port}`;
}

const nomDe = c => c.operateur || c.domaine || c.nom || c.dst;

// La vue

export function traficMondial(p) {
  const racine = h('div', { class: 'monde' });
  let etat = null;
  let evenements = [];
  let totaux = { connexions: 0, destinations: [], appareils: [] };
  let retention = 2;
  let dernier = 0, plusVieux = 0, chargeEncore = false, finHistorique = false, prochain = 0;
  let totauxPour = '';
  let detail = null, detache = false, posFiche = { x: 120, y: 120 };
  let vivant = true, minuteur = null;
  const vues = new Set();
  const flux = [], histo = [];
  let endroits = [];
  let rot = -0.6;
  let maison = vec(ORIGINE.lat, ORIGINE.lon);
  let origine = { lat: ORIGINE.lat, lon: ORIGINE.lon, nom: '' };
  const vue = { W: 0, H: 0, R: 0, CX: 0, CY: 0 };
  p.au(() => { vivant = false; clearTimeout(minuteur); });

  // Nom d'appareil à partir de l'adresse source : les vrais hôtes du parc.
  const parIp = () => {
    const m = new Map();
    for (const d of E.devices) {
      const nom = d.customName || d.hostname || d.ip;
      const icone = pictoType(d.customType || d.type);
      if (d.ip) m.set(d.ip, { nom, icone });
      for (const i of d.interfaces || []) if (i.ip) m.set(i.ip, { nom, icone });
    }
    return m;
  };
  let indexIp = parIp();
  p.suivre('devices', () => { indexIp = parIp(); peindrePanneaux(); });

  // Point d'observation, réglable par la clé « world.origin » des réglages, au
  // format « latitude,longitude » ou « latitude,longitude,Nom ».
  api.get('/api/settings').then(r => {
    if (r?.['world.logos'] === true && !logosActifs) { logosActifs = true; peindreJournal(); peindrePanneaux(); }
    const brut = String(r?.['world.origin'] || '').trim();
    const m = /^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*(?:,\s*(.+))?$/.exec(brut);
    if (!m) return;
    const lat = Number(m[1]), lon = Number(m[2]);
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return;
    maison = vec(lat, lon);
    origine = { lat, lon, nom: (m[3] || '').trim() };
    recalculerEndroits();
    peindreTitre();
  }).catch(() => { /* point d'observation par défaut, logos éteints */ });

  const enEvenement = c => {
    const app = indexIp.get(c.src);
    return { cle: c.cle, quand: c.dernier || Date.now(), c, appareil: app?.nom || c.src, icone: app?.icone || 'unknown' };
  };

  // Éléments stables
  const titreSous = h('p');
  const kpis = h('div', { class: 'kpis' });
  const canvas = h('canvas');
  const libFenetre = h('b');
  const curseur = h('input', { type: 'range', min: 0, max: PALIERS.length - 1, step: 1, value: retention, 'aria-label': 'Fenêtre' });
  const globe = h('div', { class: 'globe' },
    h('div', { class: 'gtitre' }, h('h1', { text: t('world.title') }), titreSous),
    kpis, canvas,
    h('div', { class: 'legende' },
      h('div', {}, h('i', { class: 'leg-etabli' }), t('world.legEstab')),
      h('div', { class: 'cache-s', title: "Placé au pays d'enregistrement du préfixe, faute de ville connue — ce n'est pas la position du serveur" },
        h('i', { class: 'leg-pays' }), "pays d'enregistrement"),
      h('div', { class: 'cache-s' }, h('i', { class: 'leg-terre' }), t('world.legLand')),
      h('div', { class: 'retention', title: 'Période décrite par le journal, les compteurs et les classements' },
        h('label', { text: 'Fenêtre' }), curseur, libFenetre)));
  const compteJournal = h('em');
  const fluxEl = h('div', { class: 'flux' });
  const journal = h('div', { class: 'panel pw-l' }, h('div', { class: 'ph' }, h('span', { text: t('world.log') }), compteJournal), fluxEl);
  const droite = h('div', { class: 'panel pw-r' });
  // Sans boîte à elle : la fiche détachée est posée en position fixe, et une
  // boîte vide ajouterait un écart dans la rangée.
  const flottante = h('div', { class: 'contenu' });
  const grille = h('div', { class: 'grid3' }, journal, flottante, globe, droite);

  curseur.addEventListener('input', () => {
    retention = Number(curseur.value);
    // Changer de fenêtre repart de zéro : le journal, les compteurs et les
    // classements décrivent tous la même période, pas un mélange.
    dernier = 0; plusVieux = 0; vues.clear(); evenements = []; finHistorique = false; totauxPour = '';
    peindreTout();
    planifier(0);
  });
  fluxEl.addEventListener('scroll', () => {
    // Marge de 120 px : on charge avant d'atteindre le fond.
    if (fluxEl.scrollHeight - fluxEl.scrollTop - fluxEl.clientHeight < 120) chargerPlusAncien();
  });

  const fenetre = () => PALIERS[retention][1];

  // Descente dans l'historique
  async function chargerPlusAncien() {
    if (chargeEncore || finHistorique || !plusVieux) return;
    chargeEncore = true;
    try {
      const borne = fenetre() ? Date.now() - fenetre() : 0;
      if (borne && plusVieux <= borne) { finHistorique = true; return; }
      const anciens = (await lireFlux({ limite: 500, avant: plusVieux })).filter(c => !borne || (c.dernier || 0) > borne);
      if (!anciens.length) { finHistorique = true; return; }
      plusVieux = Math.min(...anciens.map(c => c.dernier || 0));
      for (const c of anciens) vues.add(c.cle);
      evenements = [...evenements, ...anciens.map(enEvenement)];
      recalculerEndroits();
      peindreJournal(); peindrePanneaux();
    } catch { /* le serveur répondra la prochaine fois */ }
    finally { chargeEncore = false; }
  }

  function planifier(delai) {
    clearTimeout(minuteur);
    prochain = Date.now() + delai;
    minuteur = setTimeout(tour, delai);
  }

  async function tour() {
    if (!vivant) return;
    // Un onglet en arrière-plan n'a rien à afficher : on repasse plus tard.
    if (document.visibilityState === 'hidden') { planifier(PERIODE_MS); return; }
    try {
      const e = await etatTrafic();
      if (!vivant) return;
      const avant = !!etat?.cible;
      etat = e;
      if (!etat.cible || !avant) peindreTout();
      // Les totaux ne sont redemandés que lorsque le nombre de flux conservés
      // bouge, ou quand on change de fenêtre.
      const f = fenetre();
      const signature = `${e?.total ?? 0}|${f}`;
      if (signature !== totauxPour) {
        totauxPour = signature;
        lireAggregats(f ? Date.now() - f : undefined).then(tt => { if (vivant) { totaux = tt; peindrePanneaux(); } }).catch(() => { /* les totaux d'avant restent jusqu'au relevé suivant */ });
      }
      if (dernier === 0) {
        // Première ouverture : le journal se remplit avec l'historique récent,
        // sans lancer d'arc — ces connexions ne sont pas nouvelles.
        const debut = await lireFlux(fenetre() ? { limite: 1000, depuis: Date.now() - fenetre() } : { limite: 1000 });
        if (!vivant) return;
        if (debut.length) {
          dernier = Math.max(...debut.map(c => c.dernier || 0));
          plusVieux = Math.min(...debut.map(c => c.dernier || 0));
          for (const c of debut) vues.add(c.cle);
          evenements = debut.map(enEvenement);
        } else dernier = Date.now();
        recalculerEndroits();
        peindreJournal(); peindrePanneaux();
      } else {
        const frais = await lireFlux({ limite: 200, depuis: dernier });
        if (!vivant) return;
        if (frais.length) {
          dernier = Math.max(dernier, ...frais.map(c => c.dernier || 0));
          nouveaux(frais);
        }
      }
      peindreJournal();
    } catch { /* le serveur répondra la prochaine fois */ }
    if (vivant) planifier(PERIODE_MS);
  }

  const relancer = () => { api.post('/api/traffic/collect').catch(() => { /* l'état relu juste après dira l'erreur */ }); planifier(1200); };
  p.ecouter(document, 'visibilitychange', () => { if (document.visibilityState === 'visible') planifier(0); });

  // Nouvelles connexions : un arc part, une ligne s'ajoute en haut du journal.
  function nouveaux(liste) {
    const revus = new Set(liste.filter(c => vues.has(c.cle)).map(c => c.cle));
    const inedits = new Set(liste.filter(c => !vues.has(c.cle)).map(c => c.cle));
    for (const c of liste) vues.add(c.cle);
    for (const c of liste) {
      // La ville d'abord ; à défaut le pays d'enregistrement, tracé autrement.
      const cible = c.lieu || c.pays;
      if (!cible) continue;
      const pts = arc(maison, vec(cible.lat, cible.lon));
      const cachee = !visible(projette(pts[pts.length - 1], rot, vue), vue);
      flux.push({ pts, t0: performance.now(), approx: !c.lieu, alerte: !!c.suspect, duree: (cachee ? 1300 : 2100) + Math.random() * 900 });
      if (flux.length > 42) flux.shift();
    }
    // Un flux déjà connu remonte en tête plutôt que d'être dupliqué.
    evenements = [...liste.map(enEvenement), ...evenements.filter(e => !revus.has(e.cle) && !inedits.has(e.cle))];
    recalculerEndroits();
    peindrePanneaux();
  }

  // Endroits atteints, dédoublonnés : deux cents connexions vers le même pays
  // ne tracent qu'un arc. Un seul flux signalé suffit à teindre l'endroit.
  function recalculerEndroits() {
    const vus = new Map();
    for (const { c } of evenements) {
      const q = c.lieu || c.pays;
      if (!q) continue;
      const cle = `${q.lat.toFixed(2)},${q.lon.toFixed(2)}`;
      const deja = vus.get(cle);
      if (!deja) vus.set(cle, { lat: q.lat, lon: q.lon, approx: !c.lieu, alerte: !!c.suspect });
      else if (c.suspect) deja.alerte = true;
    }
    endroits = [...vus.values()].slice(0, 400).map(e => ({ pts: arc(maison, vec(e.lat, e.lon)), p: vec(e.lat, e.lon), approx: e.approx, alerte: e.alerte }));
  }

  // Peinture
  const charges = () => evenements.map(e => e.c);

  function peindreTitre() {
    titreSous.textContent = `${origine.lat.toFixed(2)} N · ${origine.lon.toFixed(2)} E — ${origine.nom || t('world.origin')}`;
  }

  function peindreJournal() {
    const cx = charges();
    compteJournal.title = totaux.connexions > cx.length ? `${cx.length} lignes chargées sur ${totaux.connexions} dans la fenêtre « ${PALIERS[retention][0]} »` : '';
    remplir(compteJournal, String(cx.length), totaux.connexions > cx.length ? h('span', { class: 'faint', text: ` / ${totaux.connexions}` }) : '');
    const haut = fluxEl.scrollTop;
    const erreur = etat?.erreur ? h('div', { class: 'monde-erreur' },
      h('div', { class: 'note warn' }, ic('alert', 15, { style: { marginTop: 1 } }), h('span', {},
        etat.liaisonPerdue
          ? ['La liaison avec ', h('b', { class: 'moyen', text: etat.equipement || '' }), " n'a pas abouti."]
          : ["La commande de relevé n'a rien rendu sur ", h('b', { class: 'moyen', text: etat.equipement || '' }), '.'])),
      h('div', { class: 'mono monde-err-txt', text: etat.erreur }),
      etat.liaisonPerdue ? h('div', { class: 'monde-err-aide', text: "« Connection lost before handshake » veut dire que la machine a répondu puis coupé avant d'échanger sa bannière : soit le port visé n'est pas celui du serveur SSH, soit l'équipement limite le nombre de connexions. MapMyLAN espace donc ses tentatives au lieu d'insister." }) : null,
      h('div', { class: 'monde-relance' },
        h('button', { class: 'btn', type: 'button', onclick: relancer }, ic('refresh', 14), 'Réessayer'),
        h('span', { class: 'mono attente' }))) : null;
    remplir(fluxEl,
      erreur || '',
      evenements.length === 0 && !etat?.erreur ? h('div', { class: 'monde-vide', text: etat?.quand ? "Aucune connexion sortante relevée pour l'instant." : "Lecture de l'historique…" }) : '',
      ...evenements.map(e => {
        const c = e.c;
        const ligne = h('div', { class: c.suspect ? 'evt suspect' : 'evt', onclick: () => { detail = c; peindreFiche(); } },
          logo(c.logo, 22),
          h('div', { class: 'c' },
            h('span', { class: 's' },
              // La flèche dit qui a ouvert la connexion : sans elle, une entrée
              // et une sortie se ressemblent trait pour trait.
              h('span', { class: 'mono sens', text: c.sens === 'entrant' ? '←' : '→' }), nomDe(c)),
            h('span', {
              class: 'd',
              title: !c.lieu && c.paysRegistre ? "Pays d'enregistrement du préfixe au registre — pas la position du serveur : un préfixe enregistré ailleurs peut être annoncé depuis n'importe où." : null,
              text: `${e.appareil} · ${c.dst}${c.lieu ? ` · ${c.lieu.ville}` : c.pays ? ` · ${c.pays.nom} (enregistré)` : c.paysRegistre ? ` · ${c.paysRegistre.toLowerCase()}` : ''}`,
            })),
          h('div', { class: 'r' }, h('b', { text: fmtOctets(c.octets) || new Date(e.quand).toLocaleTimeString() }), h('span', { text: nomProto(c.port, c.proto) })));
        return ligne;
      }));
    fluxEl.scrollTop = haut;
  }

  function peindrePanneaux() {
    const cx = charges();
    // Sur les totaux du serveur quand ils sont là, sinon sur ce qui est chargé.
    const parDomaine = new Map();
    for (const c of (totaux.destinations.length ? totaux.destinations : cx)) {
      const nom = nomDe(c);
      const q = parDomaine.get(nom) || { poids: 0, domaine: c.logo };
      q.poids += c.octets || 1;
      parDomaine.set(nom, q);
    }
    const domaines = [...parDomaine.entries()].sort((a, b) => b[1].poids - a[1].poids).slice(0, 6);
    const parApp = new Map();
    const source = totaux.appareils.length ? totaux.appareils.map(a => ({ src: a.src, octets: a.octets })) : cx.map(c => ({ src: c.src, octets: c.octets || 1 }));
    for (const c of source) {
      const app = indexIp.get(c.src);
      const nom = app?.nom || c.src;
      const q = parApp.get(nom) || { poids: 0, icone: app?.icone || 'unknown' };
      q.poids += c.octets || 1;
      parApp.set(nom, q);
    }
    const appareils = [...parApp.entries()].sort((a, b) => b[1].poids - a[1].poids).slice(0, 6);
    // Ce qui est signalé, dédoublonné par flux : un panneau qui répète vingt
    // fois la même alerte n'alerte plus.
    const signales = new Map();
    for (const c of cx) {
      if (!c.suspect) continue;
      const vu = signales.get(c.cle);
      if (!vu || (c.dernier || 0) > (vu.dernier || 0)) signales.set(c.cle, c);
    }
    const listeSignales = [...signales.values()].sort((a, b) => (b.dernier || 0) - (a.dernier || 0));
    const maxDom = domaines.length ? domaines[0][1].poids : 1;
    const maxApp = appareils.length ? appareils[0][1].poids : 1;
    const base = totaux.destinations.length ? totaux.destinations : cx;
    const situees = base.filter(c => c.lieu).length;
    const parPays = base.filter(c => !c.lieu && c.pays).length;
    const destinations = totaux.destinations.length ? totaux.destinations.length : new Set(cx.map(c => c.dst)).size;
    const avecOctets = cx.some(c => c.octets);
    const poids = v => (avecOctets ? fmtOctets(v) : `${v}`);

    remplir(kpis,
      h('div', { class: 'kpi', title: `Sur la fenêtre « ${PALIERS[retention][0]} »${totaux.connexions > cx.length ? ` · ${cx.length} chargées dans le journal` : ''}` },
        h('span', { text: 'Connexions' }),
        h('b', { class: 'a' }, String(totaux.connexions || cx.length), totaux.connexions > cx.length ? h('em', { class: 'kpi-em', text: ` · ${cx.length} affichées` }) : '')),
      h('div', { class: 'kpi' }, h('span', { text: 'Destinations' }), h('b', { text: String(destinations) })),
      h('div', { class: 'kpi cache-s', title: "Destinations dont le nom d'hôte porte un code de ville reconnu" }, h('span', { text: 'Situées' }), h('b', { text: String(situees) })),
      h('div', { class: 'kpi cache-s', title: "Destinations placées au pays d'enregistrement du préfixe, faute de ville — ce n'est pas la position du serveur" }, h('span', { text: 'Par pays' }), h('b', { text: String(parPays) })));
    libFenetre.textContent = PALIERS[retention][0];

    const ficheDansPanneau = detail && !detache ? ficheFlux(detail, { surFerme: () => { detail = null; peindreFiche(); }, surDetache: () => { detache = true; posFiche = { x: 120, y: 120 }; peindreFiche(); } }) : null;
    remplir(droite,
      // Épinglé en haut : c'est la seule chose de cet écran qui demande une décision.
      ...(listeSignales.length ? [
        h('div', { class: 'ph' }, h('span', { class: 'alarme', text: 'Signalés' }), h('em', { class: 'alarme', text: String(listeSignales.length) })),
        h('div', { class: 'bloc' },
          listeSignales.slice(0, 6).map(c => h('div', { class: 'row cliquable', title: c.raison, onclick: () => { detail = c; peindreFiche(); } },
            h('span', { class: 'idev alarme' }, ic('alert', 12)),
            h('div', { class: 'c' },
              h('div', { class: 'tp' }, h('span', { class: 'n alarme', text: nomDe(c) }), h('span', { class: 'v mono', text: c.sens === 'entrant' ? 'entrée' : 'sortie' })),
              h('div', { class: 'raison', text: c.raison || '' })))),
          listeSignales.length > 6 ? h('div', { class: 'reste', text: `et ${listeSignales.length - 6} autre(s) — la liste complète est dans le journal` }) : null),
      ] : []),
      ficheDansPanneau || '',
      h('div', { class: 'ph' }, h('span', { text: 'Destinations' }), h('em', { text: String(destinations) })),
      h('div', { class: 'bloc' },
        domaines.map(([nom, v]) => h('div', { class: 'row' }, logo(v.domaine, 20),
          h('div', { class: 'c' }, h('div', { class: 'tp' }, h('span', { class: 'n', text: nom }), h('span', { class: 'v', text: poids(v.poids) })),
            h('div', { class: 'jauge' }, h('i', { style: { width: `${Math.round((v.poids / maxDom) * 100)}%` } }))))),
        domaines.length === 0 ? h('div', { class: 'tiret', text: '—' }) : null),
      h('div', { class: 'ph' }, h('span', { text: t('world.devices') }), h('em', { text: String(appareils.length) })),
      h('div', { class: 'bloc' },
        appareils.map(([nom, v]) => h('div', { class: 'row' }, h('span', { class: 'idev' }, ic(v.icone, 12)),
          h('div', { class: 'c' }, h('div', { class: 'tp' }, h('span', { class: 'n', text: nom }), h('span', { class: 'v', text: poids(v.poids) })),
            h('div', { class: 'jauge dev' }, h('i', { style: { width: `${Math.round((v.poids / maxApp) * 100)}%` } }))))),
        appareils.length === 0 ? h('div', { class: 'tiret', text: '—' }) : null),
      h('div', { class: 'monde-pied' }, piedReleve()));
  }

  const agePied = h('span');
  function piedReleve() {
    if (!etat?.quand) return "connexion à l'équipement…";
    return [
      'relevé sur ', h('b', { class: 'eq', text: etat.equipement || '' }), ' il y a ', agePied, ' s', h('br'),
      `${etat.total} flux conservés · ${Number(etat.tailleMo || 0).toFixed(2)} Mo`,
      etat.retentionJours > 0 ? ` · ${etat.retentionJours} j` : ' · sans limite de durée',
      etat.retentionMaxMo > 0 ? ` · ${etat.retentionMaxMo} Mo max` : '',
      h('br'), (etat.commande || '').split('|')[0].trim(),
    ];
  }
  // Âge du relevé et attente avant la prochaine tentative, affichés en clair :
  // on doit savoir de quand datent les chiffres qu'on regarde.
  p.intervalle(() => {
    agePied.textContent = String(etat?.quand ? Math.round((Date.now() - etat.quand) / 1000) : 0);
    const attente = prochain ? Math.max(0, Math.round((prochain - Date.now()) / 1000)) : 0;
    const el = fluxEl.querySelector('.attente');
    if (el) el.textContent = attente > 0 ? `prochaine tentative dans ${attente} s` : '';
  }, 1000);

  function peindreFiche() {
    remplir(flottante, detail && detache ? ficheFlux(detail, {
      flottante: true, pos: posFiche, surBouge: q => { posFiche = q; },
      surFerme: () => { detail = null; detache = false; peindreFiche(); },
      surRattache: () => { detache = false; peindreFiche(); },
    }) : '');
    peindrePanneaux();
  }

  function peindreTout() {
    if (etat && !etat.cible) {
      remplir(racine, sansEquipement(etat));
      return;
    }
    peindreTitre();
    remplir(racine, grille);
    peindreJournal();
    peindrePanneaux();
  }

  // Dimensionnement du canevas
  const mesurer = () => {
    const r = globe.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(r.width * dpr);
    canvas.height = Math.round(r.height * dpr);
    canvas.style.width = `${r.width}px`;
    canvas.style.height = `${r.height}px`;
    canvas.getContext('2d')?.setTransform(dpr, 0, 0, dpr, 0, 0);
    Object.assign(vue, { W: r.width, H: r.height, R: Math.min(r.width, r.height) * 0.4, CX: r.width / 2, CY: r.height / 2 });
  };
  const ro = new ResizeObserver(mesurer);
  ro.observe(globe);
  p.au(() => ro.disconnect());

  // Boucle de rendu
  let ctx = null;
  try { ctx = canvas.getContext('2d'); } catch { ctx = null; }
  const TERRE = terre(), TRAITS = traits();
  let raf = 0;
  const trace = (liste, ok) => {
    ctx.beginPath();
    let ouvert = false;
    for (const pt of liste) {
      const q = projette(pt, rot, vue);
      if (!ok(q)) { ouvert = false; continue; }
      if (!ouvert) { ctx.moveTo(q.x, q.y); ouvert = true; } else ctx.lineTo(q.x, q.y);
    }
    ctx.stroke();
  };
  const disque = (x, y, rayon) => { ctx.beginPath(); ctx.arc(x, y, rayon, 0, 6.2832); };
  function dessine() {
    raf = requestAnimationFrame(dessine);
    const v = vue;
    if (!ctx || v.W < 2 || v.H < 2 || !canvas.isConnected) return;
    const accent = couleurVar('--accent');
    // Un flux signalé se dessine en rouge, arc et point : la seule couleur de
    // l'écran qui veut dire « regarde ça ».
    const alarme = couleurVar('--alarm');
    const inkSoft = couleurVar('--ink-soft');
    const surface = couleurVar('--surface');
    ctx.clearRect(0, 0, v.W, v.H);
    const halo = ctx.createRadialGradient(v.CX, v.CY, v.R * 0.75, v.CX, v.CY, v.R * 1.5);
    halo.addColorStop(0, avecAlpha(accent, 0.10));
    halo.addColorStop(1, avecAlpha(accent, 0));
    ctx.fillStyle = halo; disque(v.CX, v.CY, v.R * 1.5); ctx.fill();
    ctx.fillStyle = surface; disque(v.CX, v.CY, v.R); ctx.fill();
    ctx.strokeStyle = avecAlpha(accent, 0.18); ctx.lineWidth = 1; disque(v.CX, v.CY, v.R); ctx.stroke();
    for (const pt of TERRE) {
      const q = projette(pt, rot, v);
      if (q.z <= 0.02) continue;
      ctx.fillStyle = avecAlpha(inkSoft, 0.10 + q.z * 0.30);
      disque(q.x, q.y, 0.7 + q.z * 0.55); ctx.fill();
    }
    ctx.lineWidth = 0.85;
    ctx.strokeStyle = avecAlpha(inkSoft, 0.42);
    for (const seg of TRAITS) trace(seg, q => q.z > 0.02);
    // Couche permanente : trait plein pour une ville relevée, pointillé pour un
    // pays d'enregistrement.
    for (const e of endroits) {
      const teinteE = e.alerte ? alarme : accent;
      ctx.lineWidth = e.alerte ? 1.4 : e.approx ? 0.8 : 1;
      ctx.setLineDash(e.approx ? [3, 4] : []);
      ctx.strokeStyle = avecAlpha(teinteE, e.alerte ? 0.75 : e.approx ? 0.3 : 0.48);
      trace(e.pts, q => visible(q, v));
      ctx.setLineDash([]);
      const q = projette(e.p, rot, v);
      if (!visible(q, v)) continue;
      if (e.approx) {
        // Cercle creux : le point marque un pays, pas une adresse.
        ctx.strokeStyle = avecAlpha(teinteE, 0.8); ctx.lineWidth = 1.3; disque(q.x, q.y, 3); ctx.stroke();
      } else {
        ctx.fillStyle = avecAlpha(teinteE, 0.95); disque(q.x, q.y, e.alerte ? 3.2 : 2.6); ctx.fill();
        ctx.fillStyle = avecAlpha(teinteE, e.alerte ? 0.26 : 0.18); disque(q.x, q.y, e.alerte ? 8 : 6); ctx.fill();
      }
    }
    ctx.lineWidth = 0.75;
    ctx.strokeStyle = avecAlpha(accent, 0.11);
    for (const pts of histo) trace(pts, q => visible(q, v));
    const maintenant = performance.now();
    for (let i = flux.length - 1; i >= 0; i--) {
      const f = flux[i];
      const vieillesse = (maintenant - f.t0) / f.duree;
      if (vieillesse > 1.25) {
        histo.push(f.pts);
        while (histo.length > ARCS_GARDES) histo.shift();
        flux.splice(i, 1);
        continue;
      }
      const pts = f.pts.map(pt => projette(pt, rot, v));
      const av = Math.min(1, vieillesse * 1.5);
      const fin = Math.floor(pts.length * av);
      const fondu = vieillesse > 1 ? Math.max(0, 1 - (vieillesse - 1) * 4) : 1;
      // Pointillé et plus pâle : « pays d'enregistrement », pas « position ».
      const teinteF = f.alerte ? alarme : accent;
      ctx.lineWidth = f.alerte ? 1.7 : f.approx ? 0.9 : 1.2;
      ctx.setLineDash(f.approx ? [3, 4] : []);
      ctx.beginPath();
      let ouvert = false;
      for (let k = 0; k < fin; k++) {
        const q = pts[k];
        if (!visible(q, v)) { ouvert = false; continue; }
        if (!ouvert) { ctx.moveTo(q.x, q.y); ouvert = true; } else ctx.lineTo(q.x, q.y);
      }
      ctx.strokeStyle = avecAlpha(teinteF, (f.alerte ? 0.85 : f.approx ? 0.34 : 0.6) * fondu);
      ctx.stroke();
      ctx.setLineDash([]);
      if (fin > 0 && fin < pts.length) {
        const q = pts[fin - 1];
        if (visible(q, v)) {
          ctx.fillStyle = avecAlpha(teinteF, f.approx ? 0.6 : 0.95); disque(q.x, q.y, f.approx ? 1.8 : 2.2); ctx.fill();
          ctx.fillStyle = avecAlpha(teinteF, f.approx ? 0.12 : 0.22); disque(q.x, q.y, 6); ctx.fill();
        }
      }
      if (av >= 1) {
        const q = pts[pts.length - 1];
        if (visible(q, v)) {
          if (f.approx) { ctx.strokeStyle = avecAlpha(teinteF, 0.7 * fondu); ctx.lineWidth = 1; disque(q.x, q.y, 2.8); ctx.stroke(); }
          else { ctx.fillStyle = avecAlpha(teinteF, 0.9 * fondu); disque(q.x, q.y, f.alerte ? 3 : 2.4); ctx.fill(); }
          ctx.strokeStyle = avecAlpha(teinteF, (f.alerte ? 0.5 : 0.32) * fondu); disque(q.x, q.y, 5 + vieillesse * 5); ctx.stroke();
        }
      }
    }
    const m = projette(maison, rot, v);
    if (m.z > -0.05) {
      const pl = 3 + Math.sin(maintenant / 380) * 1.2;
      ctx.fillStyle = avecAlpha(accent, 0.18); disque(m.x, m.y, pl + 7); ctx.fill();
      ctx.fillStyle = accent; disque(m.x, m.y, 3.2); ctx.fill();
    }
    rot += 0.0013;
  }
  raf = requestAnimationFrame(dessine);
  p.au(() => cancelAnimationFrame(raf));

  peindreTout();
  tour();
  return racine;
}

// Aucun équipement à interroger
// Deux cas très différents : soit rien n'est enregistré, soit tout ce qui est
// enregistré est joint par API locale et n'a pas de shell à interroger. On
// nomme chaque entrée et la raison exacte de son exclusion.
function sansEquipement(etat) {
  const barres = etat.ecartees || [];
  const b = texte => h('b', { class: 'moyen', text: texte });
  return h('div', { class: 'card' }, h('div', { class: 'pad monde-sans' },
    h('h2', { text: barres.length ? 'Aucun équipement interrogeable' : 'Aucun équipement à interroger' }),
    h('p', { text: "Cette page ne montre que des connexions réellement relevées. Pour les obtenir, MapMyLAN interroge la table de suivi de connexions de l'équipement qui voit passer le trafic du parc — la passerelle." }),
    barres.length ? [
      h('p', { text: barres.length === 1 ? "L'équipement enregistré ne porte pas de shell :" : 'Aucun des équipements enregistrés ne porte de shell :' }),
      h('ul', {}, barres.map(c => h('li', {}, b(c.nom), h('span', { class: 'mono faint', text: `${c.hote}:${c.port}` }),
        h('span', { class: 'faint', text: c.transport === 'api'
          ? 'piloté par son API locale — une API expose les clients et les règles, pas la table de suivi de connexions'
          : `le port ${c.port} est un port web, pas un port SSH` })))),
      h('p', {}, 'Pour relever le trafic, active SSH sur la passerelle, puis ajoute-la dans ', b('Console SSH'), ' comme entrée distincte, sur son ', b('port 22'), '. Le relevé démarrera tout seul.'),
    ] : h('p', {}, 'Enregistre-la dans ', b('Console SSH'), ", en cochant « équipement principal ». Rien d'autre à faire : le relevé démarre tout seul.")));
}

/**
 * La fiche d'un flux. Deux états, le même contenu : rangée dans le panneau,
 * ou détachée et posée au-dessus de la page, où elle se déplace — ce qui sert
 * quand on veut garder une alerte sous les yeux en regardant le globe.
 */
function ficheFlux(c, { surFerme, surDetache, surRattache, flottante, pos, surBouge }) {
  const ligne = (k, v) => h('div', { class: 'ff-l' }, h('span', { text: k }), h('span', { class: 'mono', text: v }));
  const tete = h('div', { class: flottante ? 'ff-tete saisissable' : 'ff-tete' },
    c.suspect ? ic('alert', 13) : null,
    h('b', { class: c.suspect ? 'alarme' : '', text: nomDe(c) }),
    h('div', { class: 'ff-actions' },
      surDetache ? h('button', { class: 'lnk', type: 'button', onclick: surDetache }, 'détacher') : null,
      surRattache ? h('button', { class: 'lnk', type: 'button', onclick: surRattache }, 'rattacher') : null,
      h('button', { class: 'lnk', type: 'button', onclick: surFerme }, 'fermer')));
  const corps = h('div', { class: 'ff-corps' },
    c.suspect && c.raison ? h('div', { class: 'ff-raison', text: c.raison }) : null,
    ligne('Sens', c.sens === 'entrant' ? "entrante — l'extérieur est venu" : 'sortante — le parc est allé'),
    ligne('Appareil', c.src), ligne('Distant', c.dst), ligne('Port', `${c.port} · ${c.proto}`),
    c.nom ? ligne('Nom inverse', c.nom) : null,
    c.operateur ? ligne('Titulaire', c.operateur) : null,
    c.paysRegistre ? ligne('Registre', `${c.paysRegistre} — pays d'enregistrement du préfixe`) : null,
    c.lieu ? ligne('Ville', `${c.lieu.ville} — déduite du nom d'hôte`) : null,
    c.octets ? ligne('Volume', fmtOctets(c.octets)) : null,
    c.vues ? ligne('Relevés', `${c.vues} passage(s)`) : null,
    c.premier ? ligne("Vu d'abord", new Date(c.premier).toLocaleString()) : null,
    c.dernier ? ligne('Vu en dernier', new Date(c.dernier).toLocaleString()) : null);
  const fiche = h('div', { class: `${flottante ? 'fiche-flux flottante' : 'fiche-flux'}${c.suspect ? ' suspect' : ''}` }, tete, corps);
  if (flottante) {
    fiche.style.left = `${pos?.x ?? 120}px`;
    fiche.style.top = `${pos?.y ?? 120}px`;
    tete.addEventListener('pointerdown', ev => {
      if (ev.target.closest('button')) return;
      const dx = ev.clientX - (pos?.x ?? 120), dy = ev.clientY - (pos?.y ?? 120);
      const bouger = e => {
        // Bornée à la fenêtre : une fiche qu'on ne peut plus rattraper est une
        // fiche perdue.
        const q = { x: Math.max(0, Math.min(innerWidth - 280, e.clientX - dx)), y: Math.max(0, Math.min(innerHeight - 80, e.clientY - dy)) };
        fiche.style.left = `${q.x}px`; fiche.style.top = `${q.y}px`;
        surBouge?.(q);
      };
      const lacher = () => { removeEventListener('pointermove', bouger); removeEventListener('pointerup', lacher); };
      addEventListener('pointermove', bouger);
      addEventListener('pointerup', lacher);
    });
  }
  return fiche;
}
