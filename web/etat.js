// L'état partagé de l'interface, et la liaison au serveur.
//
// Un seul objet, E, que les pages lisent ; poser() le modifie et prévient
// ceux qui suivent les clés touchées. Les données viennent de l'API, le temps
// réel du flux SSE /api/flux, sous les mêmes noms d'événements qu'en 1.4.
import { Api, toast } from '/socle/compte.js';

export const api = new Api({ surDeconnexion: () => location.reload() });

const lireLocal = (cle, defaut) => {
  try { return localStorage.getItem(cle) ?? defaut; } catch { return defaut; }
};
export const ecrireLocal = (cle, valeur) => {
  try {
    if (valeur === null) localStorage.removeItem(cle);
    else localStorage.setItem(cle, valeur);
  } catch { /* stockage plein ou refusé : le réglage vaut pour la session */ }
};

export const E = {
  moi: null,
  devices: [], vlans: [], alerts: [], logs: [],
  stats: { total: 0, online: 0, offline: 0, suspect: 0, banned: 0, quarantined: 0, vlans: 0, alerts: 0 },
  scanRunning: false, healthScore: 100,
  topology: { links: [], zones: [] },
  hostStats: null,
  page: 'dashboard',
  // Disposition : « reading » aérée, une page à la fois ; « workshop » dense,
  // tout visible en même temps. Mémorisée par navigateur.
  shell: lireLocal('mapmylan_shell', 'reading') === 'workshop' ? 'workshop' : 'reading',
  selectedDeviceId: null,
};

const suiveurs = new Map();

/** fn est rappelée quand l'une des clés change ; rend de quoi se désabonner. */
export function suivre(cles, fn) {
  const liste = [cles].flat();
  for (const c of liste) {
    if (!suiveurs.has(c)) suiveurs.set(c, new Set());
    suiveurs.get(c).add(fn);
  }
  return () => { for (const c of liste) suiveurs.get(c)?.delete(fn); };
}

export function poser(changes) {
  Object.assign(E, changes);
  const appels = new Set();
  for (const c of Object.keys(changes)) for (const f of suiveurs.get(c) || []) appels.add(f);
  for (const f of appels) {
    try { f(E); } catch (e) { console.error(e); }
  }
}

/**
 * Durée de vie d'une page : ce qu'elle abonne, programme ou écoute est défait
 * d'un coup quand on la quitte.
 */
export function portee() {
  const defaire = [];
  return {
    suivre(cles, fn) { defaire.push(suivre(cles, fn)); },
    intervalle(fn, ms) { const i = setInterval(fn, ms); defaire.push(() => clearInterval(i)); },
    ecouter(cible, ev, fn, opts) { cible.addEventListener(ev, fn, opts); defaire.push(() => cible.removeEventListener(ev, fn, opts)); },
    au(fn) { defaire.push(fn); },
    fermer() { while (defaire.length) { try { defaire.pop()(); } catch (e) { console.error(e); } } },
  };
}

export async function rafraichirAppareils() {
  const [devices, sante] = await Promise.all([api.get('/api/devices'), api.get('/api/devices/health/score')]);
  poser({ devices, healthScore: sante.score });
}
export const rafraichirAlertes = async () => poser({ alerts: await api.get('/api/alerts?limit=50') });
export const rafraichirStats = async () => poser({ stats: await api.get('/api/stats') });
export const rafraichirTopologie = async () => poser({ topology: await api.get('/api/topology') });
export const rafraichirVlans = async () => poser({ vlans: await api.get('/api/vlans') });

export async function lancerBalayage(subnet) {
  poser({ scanRunning: true });
  try { await api.post('/api/devices/scan', subnet ? { subnet } : {}); } catch (e) { poser({ scanRunning: false }); toast(e.message, true); }
}

export const choisirPage = page => poser({ page });
export const choisirAppareil = id => poser({ selectedDeviceId: id });

export function changerDisposition(k) {
  ecrireLocal('mapmylan_shell', k);
  document.documentElement.dataset.shell = k;
  poser({ shell: k });
}

export async function chargerTout() {
  try {
    const [devices, vlans, alerts, stats, sante, topology] = await Promise.all([
      api.get('/api/devices'), api.get('/api/vlans'), api.get('/api/alerts?limit=50'),
      api.get('/api/stats'), api.get('/api/devices/health/score'), api.get('/api/topology'),
    ]);
    poser({ devices, vlans, alerts, stats, healthScore: sante.score, topology });
  } catch (e) { toast(e.message, true); }
  api.get('/api/logs?limit=100').then(logs => poser({ logs })).catch(() => { /* le journal d'avant reste, le flux le complète */ });
  api.get('/api/vigie').then(v => poser({ vigie: !!v.relie })).catch(() => { /* sans réponse, la page Vigie reste cachée */ });
  api.get('/api/host/stats').then(hostStats => poser({ hostStats })).catch(() => { /* la page hôte dit « sans mesure » ; host:metrics suivra */ });
  // Un balayage fini pendant une coupure du flux n'a pas annoncé sa fin :
  // l'état du dernier fait foi.
  api.get('/api/devices/scans/latest').then(r => poser({ scanRunning: r?.status === 'running' })).catch(() => { /* l'état local reste ; scan:complete tranchera */ });
}

// Le temps réel. Le navigateur rouvre seul un flux coupé par le réseau. Un
// flux refusé (session expirée ou révoquée) reste fermé : on demande au socle
// où en est la session, et la porte reprend la main s'il n'y en a plus.
export function brancherFlux() {
  const flux = new EventSource('/api/flux');
  const donnee = e => { try { return JSON.parse(e.data); } catch { return null; } };
  const sur = (nom, fn) => flux.addEventListener(nom, e => { try { fn(donnee(e)); } catch (x) { console.error(x); } });
  const silencieux = p => p.catch(() => { /* l'état d'avant reste : la relecture suivante corrigera */ });
  sur('devices:updated', () => silencieux(rafraichirAppareils()));
  sur('device:updated', () => silencieux(rafraichirAppareils()));
  sur('device:deleted', d => {
    if (d?.id && E.selectedDeviceId === d.id) poser({ selectedDeviceId: null });
    silencieux(rafraichirAppareils());
  });
  // Un nouvel appareil arrive aussi par alert:new, sous une autre forme :
  // ce n'est pas une alerte à lister, c'est la liste des appareils à relire.
  sur('alert:new', a => {
    if (!a) return;
    if (a.newDevice) silencieux(rafraichirAppareils());
    else poser({ alerts: [a, ...E.alerts].slice(0, 100) });
  });
  sur('log:new', l => l && poser({ logs: [l, ...E.logs].slice(0, 200) }));
  sur('scan:started', () => poser({ scanRunning: true }));
  sur('scan:complete', () => { poser({ scanRunning: false }); silencieux(rafraichirAppareils()); silencieux(rafraichirStats()); });
  sur('topology:updated', () => silencieux(rafraichirTopologie()));
  sur('host:metrics', m => m && poser({ hostStats: m }));
  flux.addEventListener('error', () => {
    if (flux.readyState !== EventSource.CLOSED) return;
    api.etat().then(e => {
      if (!e?.session || e.session.niveau !== 'complet') location.reload();
      else setTimeout(brancherFlux, 5000);
    }).catch(() => setTimeout(brancherFlux, 5000));
  });
  // Ce qui s'est passé avant l'ouverture n'a été annoncé à personne : un
  // balayage court lancé par la mise en route peut finir avant que le flux
  // réponde, et une coupure fait manquer des événements. Chaque ouverture, la
  // première comprise, relit donc l'état.
  flux.addEventListener('open', () => chargerTout());
  return flux;
}
