// Le panneau de l'assistant, le même que celui du Hub : à droite, par-dessus
// la page ; un onglet sort du bord droit quand la souris y reste une seconde ;
// le micro passe en mode vocal, où l'orbe écoute et la réponse est dite, avec
// les seuls widgets dans le fil.
import { h, ic, remplir } from '../dom.js';
import { api } from '../etat.js';
import { t } from '../i18n.js';
import { rendu, widget, brancherBulle } from './rendu.js';
import { basculerVoix, monter as monterVoix, tourVocal, rejouer, arreter as arreterVoix, brancher as brancherVoix } from './voix.js';

const S = { ouvert: false, occupe: false, demande: '', erreur: '', dernierEnvoi: null, relances: [] };

// Les boutons de la barre du haut sont refaits à chaque changement de langue :
// on les retrouve dans le document plutôt que de garder des références.
function peindreBoutons() {
  for (const b of document.querySelectorAll('button[data-assistant]')) {
    b.classList.toggle('on', S.ouvert);
    b.style.color = S.ouvert ? 'var(--accent)' : '';
    b.setAttribute('aria-pressed', String(S.ouvert));
  }
}

/** Le bouton de la barre du haut : il s'allume quand le panneau est ouvert. */
export function boutonAssistant(taille = 32, picto = 16) {
  return h('button', {
    class: S.ouvert ? 'ghost on' : 'ghost', type: 'button', dataset: { assistant: '' },
    style: { width: taille, height: taille, color: S.ouvert ? 'var(--accent)' : undefined },
    title: t('top.assistant'), 'aria-label': t('top.assistant'), 'aria-pressed': String(S.ouvert), onclick: basculer,
  }, ic('sparkle', picto));
}

export function basculer() {
  S.ouvert = !S.ouvert;
  if (!S.ouvert) arreterVoix();
  const panneau = document.getElementById('aiaPanel');
  if (S.ouvert && !panneau) {
    document.body.append(h('aside', { id: 'aiaPanel', class: 'aia', 'aria-label': 'Assistant' }));
    dessiner().then(() => document.getElementById('aiaIn')?.focus());
  } else if (!S.ouvert) panneau?.remove();
  document.getElementById('aiaBord')?.classList.remove('vu');
  peindreBoutons();
}

brancherVoix({
  apresReponse: () => { dessiner(); },
  signaler: m => { S.erreur = m; dessiner(); },
});

// Une action d'un autre cerveau : le bouton qui y mène, avec la demande déjà écrite.
function relais(r) {
  if (!r) return null;
  const lien = typeof r.lien === 'string' && /^https?:\/\/[^\s"'<>]+$/.test(r.lien) ? r.lien : '';
  return h('div', { class: 'aia-relais' }, h('span', { class: 'itile' }, ic('arrow', 14)),
    h('div', { class: 'grow' }, h('b', { text: r.titre }), h('small', { text: `${r.action} · ${r.ou}` })),
    lien ? h('a', { class: 'btn solid sm', href: lien, target: '_blank', rel: 'noopener noreferrer', text: 'Continuer là-bas' }) : null);
}

function tour(p) {
  const widgets = (p.widgets || []).map(widget);
  const duree = p.duree != null
    ? h('small', { class: 'duree', title: 'Temps de réponse', text: `${p.duree < 1000 ? '< 1 s' : `${Math.round(p.duree / 1000)} s`}${p.modele ? ` · ${p.modele}` : ''}${p.sources?.length ? ` · via ${p.sources.join(', ')}` : ''}` })
    : null;
  const classes = ['m a', p.widgets?.length || p.voix || p.relais ? 'large' : '', p.voix ? 'vocal' : ''].filter(Boolean).join(' ');
  return [
    p.voix ? null : h('div', { class: 'm u', text: p.request }),
    h('div', { class: classes },
      p.voix ? tourVocal(p, widgets) : [rendu(p.reply), relais(p.relais), widgets],
      h('div', { class: 'pied' },
        p.voix ? h('button', { class: 'lienfin', type: 'button', title: 'Réentendre la réponse', onclick: () => rejouer(p.parole || p.reply) }, ic('play', 11), ' Réécouter') : null,
        duree)),
  ];
}

async function dessiner() {
  const panneau = document.getElementById('aiaPanel');
  if (!panneau) return;
  let etat = { fil: [], ia: { prete: false, modele: null }, relances: [], encours: false };
  try { etat = await api.get('/api/assistant'); } catch (e) { S.erreur = S.erreur || e?.message || String(e); }
  if (!panneau.isConnected) return;
  S.relances = etat.relances || [];
  if (etat.encours && !S.occupe) S.occupe = true;
  const fil = etat.fil || [];
  const sous = [etat.ia?.prete ? etat.ia.modele : 'sans modèle', etat.cerveau?.synapse ? 'relié à SYNAPSE' : 'lecture seule'].join(' · ');

  const champ = h('input', { id: 'aiaIn', placeholder: 'Demande quelque chose…', autocomplete: 'off', 'aria-label': 'Question', disabled: S.occupe });
  const nouvelle = async () => {
    try { await api.post('/api/assistant/nouvelle', {}); S.erreur = ''; S.demande = ''; } catch (e) { S.erreur = e?.message; }
    dessiner();
  };
  const messages = h('div', { class: 'msgs', id: 'aiaMsgs' },
    fil.length
      ? fil.map(tour)
      : h('div', { class: 'm a aia-accueil' }, h('b', { text: 'Pose-moi une question sur ton réseau.' }),
        'Les nouveaux appareils, les alertes, ce qui est exposé, ce qui ne répond plus, un appareil par son adresse. Je lis le réseau, je ne change rien.'),
    S.demande ? h('div', { class: 'm u', text: S.demande }) : null,
    S.erreur ? h('div', { class: 'm a' }, h('span', { class: 'err', text: S.erreur })) : null,
    S.occupe ? h('div', { class: 'm a' }, h('span', { class: 'typing' }, h('span'), h('span'), h('span'))) : null);

  remplir(panneau,
    h('header', {}, h('span', { class: 'itile ink' }, ic('sparkle')), h('div', { class: 'grow' }, h('b', { text: 'Assistant' }), h('small', { text: sous })),
      h('button', { class: 'ghost', id: 'aiaVoixBtn', type: 'button', title: 'Parler à l’assistant — il répond à voix haute (VOX)', 'aria-label': 'Mode vocal',
        onclick: () => { basculerVoix().catch(e => { S.erreur = e?.message; dessiner(); }); } }, ic('mic', 14)),
      h('button', { class: 'ghost', id: 'aiaNew', type: 'button', title: 'Nouvelle conversation — repart à vide', 'aria-label': 'Nouvelle conversation', onclick: nouvelle }, ic('plus', 14)),
      h('button', { class: 'ghost', id: 'aiaClose', type: 'button', 'aria-label': 'Fermer', onclick: basculer }, ic('x', 14))),
    messages,
    h('div', { class: 'sugg' }, S.occupe ? null : S.relances.map(r =>
      h('button', { type: 'button', onclick: () => demander(r) }, ic('sparkle', 13), h('span', { text: r })))),
    h('form', { id: 'aiaForm', onsubmit: ev => { ev.preventDefault(); demander(champ.value); } }, champ,
      S.occupe
        ? h('button', { class: 'btn sm', type: 'button', id: 'aiaStop', 'aria-label': 'Arrêter', onclick: () => { api.post('/api/assistant/stop', {}).catch(() => { /* la réponse en cours finira d'elle-même */ }); } }, ic('x', 14), 'Arrêter')
        : h('button', { class: 'btn solid sm', type: 'submit', 'aria-label': 'Envoyer' }, ic('arrow', 14))));
  messages.scrollTop = messages.scrollHeight;
  monterVoix();
}

async function demander(texte) {
  const question = String(texte || '').trim();
  if (!question || S.occupe) return;
  // Le même texte deux fois en trois secondes : un double envoi, pas une deuxième question.
  if (S.dernierEnvoi?.texte === question && Date.now() - S.dernierEnvoi.t < 3000) return;
  S.dernierEnvoi = { texte: question, t: Date.now() };
  Object.assign(S, { occupe: true, demande: question, erreur: '' });
  await dessiner();
  try { await api.post('/api/assistant/ask', { text: question, voix: false }); S.demande = ''; }
  catch (e) { S.erreur = e?.message || String(e); }   // la question reste affichée au-dessus
  S.occupe = false;
  await dessiner();
  document.getElementById('aiaIn')?.focus();
}

// Bord droit : la souris collée au bord une seconde fait sortir un petit
// onglet à sa hauteur ; un clic ouvre l'assistant. Il rentre dès qu'on
// s'éloigne. Rien sur un écran tactile, ni quand l'assistant est ouvert.
let bordBranche = false;
export function brancherBord() {
  brancherBulle();
  if (bordBranche) return;
  bordBranche = true;
  let minuteur = null, rentre, derniere = { x: 0, y: 0 };
  const largeur = () => Math.min(innerWidth, document.documentElement.clientWidth || innerWidth);
  const auBord = x => largeur() - x <= 8;
  const masquer = () => document.getElementById('aiaBord')?.classList.remove('vu');
  const onglet = () => {
    const existant = document.getElementById('aiaBord');
    if (existant) return existant;
    const b = h('button', {
      id: 'aiaBord', class: 'aibord', type: 'button', title: 'Assistant', 'aria-label': 'Ouvrir l’assistant',
      onclick: () => { masquer(); if (!S.ouvert) basculer(); },
      onmouseenter: () => clearTimeout(rentre),
      onmouseleave: () => { clearTimeout(rentre); rentre = setTimeout(masquer, 700); },
    }, ic('sparkle', 18));
    document.body.append(b);
    return b;
  };
  const montrer = () => {
    if (S.ouvert || !document.querySelector('.app') || !auBord(derniere.x)) return;
    const b = onglet();
    b.style.top = `${Math.max(70, Math.min(innerHeight - 70, derniere.y)) - 22}px`;
    b.classList.add('vu');
  };
  document.addEventListener('mousemove', ev => {
    derniere = { x: ev.clientX, y: ev.clientY };
    if (auBord(ev.clientX)) {
      if (!minuteur && !S.ouvert) minuteur = setTimeout(() => { minuteur = null; montrer(); }, 1000);
    } else {
      if (minuteur) clearTimeout(minuteur);
      minuteur = null;
      if (document.getElementById('aiaBord')?.classList.contains('vu') && largeur() - ev.clientX > 90) { clearTimeout(rentre); rentre = setTimeout(masquer, 700); }
    }
  }, { passive: true });
}
