// Système — réglages.
//
// Les comptes, les facteurs de connexion et les sessions ne sont plus ici :
// ils vivent dans les pages du socle (« Mon compte » et « Utilisateurs »),
// communes à tous les services.
import { confirmer, toast } from '/socle/compte.js';
import { h, ic, page, btn, bascule, note, champ, lbl, remplir } from '../dom.js';
import { api } from '../etat.js';
import { t } from '../i18n.js';
import { panneauPlages } from '../composants/plages.js';
import { panneauCourrier } from '../composants/courrier.js';
import { panneauIntegrations } from '../composants/integrations.js';

/** Bloc de réglage : pastille, titre, explication, contenu. */
function bloc({ icone, titre, texte, extra }, ...enfants) {
  return h('div', { class: 'set' },
    h('header', {}, h('span', { class: 'tile' }, ic(icone, 17)), h('div', { class: 'grow' }, h('h2', { text: titre }), texte ? h('p', { text: texte }) : null), extra || null),
    enfants);
}

export function pageReglages() {
  const message = h('div');
  const infoTrafic = h('span', { class: 'info-trafic' });
  let reglages = {};
  const champs = {};
  const bascules = {};

  const poser = async (cle, valeur) => {
    try { await api.put(`/api/settings/${cle}`, { value: valeur }); reglages = { ...reglages, [cle]: valeur }; remplir(message); }
    catch (e) { remplir(message, note('warn', e.message)); }
  };
  // Un champ enregistre sa valeur quand on le quitte, comme en 1.4.
  const reglage = (cle, { type = 'text', placeholder, lire = v => v, defaut = '' } = {}) => {
    const el = champ({ type, placeholder, 'aria-label': cle });
    el.addEventListener('blur', () => poser(cle, lire(el.value)));
    champs[cle] = { el, defaut };
    return el;
  };
  const entier = (v, secours = 0) => parseInt(v) || secours;
  const basculeReglage = (cle, allume) => (bascules[cle] = { el: bascule(false, v => poser(cle, v), { aria: cle }), allume });

  const autorisees = h('textarea', { class: 'field mml', rows: 3, placeholder: 'billetterie.exemple.org\n192.0.2.25', 'aria-label': 'sortie.autorisees' });

  api.get('/api/settings').then(r => {
    reglages = r || {};
    for (const [cle, { el, defaut }] of Object.entries(champs)) el.value = String(reglages[cle] ?? defaut);
    for (const [cle, { el, allume }] of Object.entries(bascules)) {
      const on = allume(reglages[cle]);
      el.classList.toggle('on', on);
      el.setAttribute('aria-checked', String(on));
    }
    autorisees.value = (Array.isArray(reglages['sortie.autorisees']) ? reglages['sortie.autorisees'] : []).join('\n');
  }).catch(() => { /* les champs gardent leurs valeurs par défaut */ });

  const purger = async () => {
    try { const r = await api.post('/api/traffic/purge'); infoTrafic.textContent = `${r.parAge + r.parTaille} flux retirés · ${Number(r.mo).toFixed(2)} Mo conservés`; }
    catch (e) { toast(e.message, true); }
  };
  const effacer = async () => {
    if (!await confirmer("Effacer tout l'historique du trafic ?", 'Les flux relevés disparaissent définitivement ; la collecte reprend au relevé suivant.', { danger: true, oui: 'Tout effacer' })) return;
    try { const r = await api.del('/api/traffic/flows'); infoTrafic.textContent = `${r.supprimes} flux effacés`; }
    catch (e) { toast(e.message, true); }
  };
  const enregistrerSorties = async () => {
    const liste = autorisees.value.split(/[\n,]/).map(x => x.trim()).filter(Boolean);
    try { await api.put('/api/settings/sortie.autorisees', { value: liste }); toast('Destinations enregistrées.'); }
    catch (e) { toast(e.message, true); }
  };

  const b = (texte) => h('b', { class: 'moyen', text: texte });
  return page({ titre: t('page.settings.title'), lede: t('page.settings.lede') },
    message,
    panneauPlages(),
    panneauCourrier(),
    // Ne s'affiche que pour un administrateur : la liste des jetons lui est
    // réservée, et le panneau se retire de lui-même si elle est refusée.
    panneauIntegrations(),
    bloc({ icone: 'refresh', titre: 'Cadence du balayage', texte: 'À quel rythme le parc est parcouru, et sur quel sous-réseau par défaut.' },
      h('div', { class: 'pad serre' },
        h('div', { class: 'gform', style: { display: 'grid', gridTemplateColumns: '1fr 200px', gap: 12 } },
          h('div', {}, lbl('Sous-réseau par défaut'), reglage('scan.subnet', { placeholder: '192.0.2.0/24' })),
          h('div', {}, lbl('Intervalle (secondes)'), reglage('scan.interval', { type: 'number', lire: v => entier(v, 300), defaut: 300 }))),
        h('div', { class: 'aide', text: "Les plages déclarées plus haut sont parcourues l'une après l'autre. Deux balayages simultanés saturent la carte réseau et faussent les relevés." }))),
    bloc({
      icone: 'globe', titre: 'Historique du trafic mondial',
      texte: "Combien de temps, et jusqu'à quelle taille, les flux sortants relevés sont conservés.",
      extra: h('span', { class: 'extra' }, h('span', { class: 'extra-lib', text: 'interroger les registres' }), basculeReglage('world.rdap', v => v !== false).el),
    },
    h('div', { class: 'pad serre' },
      h('div', { class: 'gform', style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 } },
        h('div', {}, lbl('Durée de conservation (jours)'), reglage('world.retentionDays', { type: 'number', lire: v => Math.max(0, entier(v)), defaut: 30 })),
        h('div', {}, lbl('Taille maximale (Mo)'), reglage('world.retentionMaxMb', { type: 'number', lire: v => Math.max(0, entier(v)), defaut: 0 }))),
      h('div', { class: 'aide' }, b('0'), " dans l'un ou l'autre champ signifie « sans limite ». L'âge passe d'abord ; si la taille dépasse encore, les flux les plus anciennement vus sont retirés jusqu'à repasser dessous. La taille mesurée est celle des données conservées, pas celle du fichier sur le disque."),
      h('div', { class: 'aide', text: "L'interrogation des registres identifie les destinations qui n'ont pas de nom d'hôte. Coupée, elles restent affichées par leur adresse : leurs adresses ne sortent alors jamais de ton réseau." }),
      h('div', { class: 'reglage-ligne' }, basculeReglage('world.logos', v => v === true).el,
        h('div', { class: 'grow' }, h('div', { class: 'rl-titre', text: 'Logos des destinations' }), h('div', { class: 'rl-sous', text: 'Éteint par défaut.' }))),
      h('div', { class: 'aide' }, 'Allumé, ', b('le serveur'), ' — jamais ton navigateur — demande le logo de chaque destination à des fournisseurs publics, puis le garde et le sert lui-même. Ces fournisseurs apprennent donc les domaines que ton réseau contacte, sans savoir qui les contacte. Éteint, rien ne sort : chaque destination porte une pastille dont la teinte dérive de son nom.'),
      h('div', { class: 'boutons-debut' }, btn({ icone: 'refresh', onclick: purger }, 'Purger maintenant'), btn({ icone: 'trash', onclick: effacer }, 'Tout effacer'), infoTrafic))),
    bloc({
      icone: 'map', titre: 'Carte', texte: 'La reconstruction automatique déduit les liaisons à partir des relevés.',
      extra: h('span', { class: 'extra' }, basculeReglage('topology.autoBuild', v => v !== false).el),
    }, h('div', { class: 'pad serre' }, h('div', { class: 'aide', text: 'Désactivée, le bouton « Reconstruire » de la carte ne fait plus rien : les liaisons que tu as tracées à la main restent alors intactes.' }))),
    // Nouveau en 2.0 : MapMyLAN ne joint une adresse interne en sortie
    // (billetterie, relais SMTP) que si elle figure ici.
    bloc({ icone: 'shield', titre: 'Destinations internes autorisées', texte: 'Les seules adresses de ton réseau que MapMyLAN peut appeler en sortie : billetterie interne, relais SMTP interne.' },
      h('div', { class: 'pad serre' },
        lbl('Noms d’hôte, adresses ou plages, un par ligne'), autorisees,
        h('div', { class: 'aide', text: 'Une destination hors de cette liste est refusée si elle tombe dans une plage privée. Enregistrer demande une confirmation d’identité récente.' }),
        h('div', { class: 'boutons-debut' }, btn({ solid: true, icone: 'check', onclick: enregistrerSorties }, t('action.save'))))));
}
