// Point d'entrée de l'interface de MapMyLAN.
//
// Dans l'ordre : l'apparence avant le premier pixel, la porte du socle
// (connexion, installation, facteurs), la mise en route si l'installation
// n'est pas terminée, puis la coquille et la page demandée. Tout est
// construit ici, sans étape de compilation : chaque module est servi tel quel.
import { porte, pageSecurite, pageComptes, appliquerTheme, toast } from '/socle/compte.js';
import { h, ic, remplir } from './dom.js';
import { E, api, poser, portee, suivre, chargerTout, brancherFlux, choisirPage } from './etat.js';
import { langue, surLangue } from './i18n.js';
import { coque, NAV } from './coque.js';
import { brancherFiche } from './composants/fiche.js';
import { brancherBord } from './assistant/panneau.js';
import { premierReglage } from './pages/premier-reglage.js';
import { tableauDeBord, pageCarte, pageMonde, pageAppareils, pageVlans } from './pages/supervision.js';
import { pageSecuriteReseau, pageVulns } from './pages/defense.js';
import { pageVigie } from './pages/vigie.js';
import { pageRouteur } from './pages/routeur.js';
import { pageSsh, pageHote, pageInventaire, pageBot } from './pages/controle.js';
import { pageNotifications, pageJournal, pageRapports } from './pages/suivi.js';
import { pageReglages } from './pages/systeme.js';

const SERVICE = 'MapMyLAN';

// La clé de la 1.4 est reprise une fois, puis c'est celle commune à tous les
// services qui fait foi. Sans choix enregistré, l'apparence suit le système,
// et le suit encore s'il change en cours de route.
function apparence() {
  try {
    const ancien = localStorage.getItem('mapmylan_theme');
    if (ancien && !localStorage.getItem('theme')) {
      localStorage.setItem('theme', ['dark', 'enterprise', 'cyber', 'noc'].includes(ancien) ? 'dark' : 'light');
    }
  } catch { /* stockage refusé : on suit le système */ }
  appliquerTheme();
  const racine = document.documentElement;
  if (racine.dataset.theme) return;
  // L'attribut est posé plutôt que laissé à la seule requête média : les
  // règles écrites pour [data-theme="dark"] valent ainsi dans les deux cas.
  const systeme = matchMedia('(prefers-color-scheme: dark)');
  const suivreSysteme = () => {
    let choisi = null;
    try { choisi = localStorage.getItem('theme'); } catch { /* aucun choix lisible */ }
    // Sans choix, la gamme Console est sombre ; SOMA suit le système.
    if (!choisi) racine.dataset.theme = racine.dataset.gamme === 'console' || systeme.matches ? 'dark' : 'light';
  };
  suivreSysteme();
  systeme.addEventListener('change', suivreSysteme);
}

const PAGES = {
  dashboard: tableauDeBord,
  map: pageCarte,
  world: pageMonde,
  devices: pageAppareils,
  vlans: pageVlans,
  security: pageSecuriteReseau,
  vulns: pageVulns,
  vigie: pageVigie,
  router: pageRouteur,
  botcommands: pageBot,
  ssh: pageSsh,
  host: pageHote,
  monitoring: pageHote,
  inventory: pageInventaire,
  notifications: pageNotifications,
  logs: pageJournal,
  reports: pageRapports,
  settings: pageReglages,
  users: () => pageComptes(api, { service: SERVICE }),
  compte: () => pageSecurite(api, { service: SERVICE, confidentialite: '/confidentialite.txt' }),
};

// La page ouverte se lit dans l'adresse (#carte…) : un rechargement ou un lien
// ramène au même endroit. Les jetons d'invitation du socle, eux, portent un
// « = » et ne sont jamais pris pour une page.
const pageDeAdresse = () => {
  const m = /^#([a-z]+)$/.exec(location.hash);
  return m && PAGES[m[1]] ? m[1] : null;
};

function monterPages(stage) {
  let courante = null;
  const ouvrir = () => {
    courante?.fermer();
    courante = portee();
    const id = PAGES[E.page] ? E.page : 'dashboard';
    // Une page réservée aux administrateurs n'est pas ouverte aux autres : le
    // serveur refuserait de toute façon ce qu'elle demande.
    const refus = NAV.find(n => n.id === id)?.admin && E.moi?.role !== 'admin';
    let noeud;
    try { noeud = PAGES[refus ? 'dashboard' : id](courante); }
    catch (e) { console.error(e); noeud = h('p', { class: 'erreur', text: e.message }); }
    remplir(stage, noeud);
    stage.scrollTop = 0;
    if (location.hash !== `#${id}`) history.replaceState(null, '', `#${id}`);
  };
  const defaire = suivre('page', ouvrir);
  ouvrir();
  return () => { defaire(); courante?.fermer(); };
}

async function demarrer() {
  apparence();
  document.documentElement.dataset.shell = E.shell;
  document.documentElement.lang = langue();

  const etat = await porte({ api, service: SERVICE, marque: ic('logo', 18), sousTitre: 'Connexion à votre réseau' });
  const compte = etat.session.compte;
  poser({ moi: compte, page: pageDeAdresse() || 'dashboard' });

  // La mise en route ne concerne que l'administrateur : c'est lui qui déclare
  // l'équipement réseau. Les autres comptes entrent directement.
  const mise = await api.get('/api/setup/status').catch(() => ({ complete: true }));
  if (!mise?.complete && compte.role === 'admin') await premierReglage();

  chargerTout();
  brancherFlux();
  brancherBord();

  let coquille = null;
  const construire = () => {
    coquille?.fermer();
    coquille = portee();
    const stage = coque(coquille);
    coquille.au(monterPages(stage));
    brancherFiche(coquille);
  };
  construire();
  // Changer de langue refait la coquille et la page ouverte : les textes sont
  // posés à la construction, pas relus à chaque rendu.
  surLangue(construire);
  addEventListener('hashchange', () => { const p = pageDeAdresse(); if (p && p !== E.page) choisirPage(p); });
}

demarrer().catch(e => { console.error(e); toast(e.message || String(e), true); });
