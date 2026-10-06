// Vigie — ce que VIGIE (l'audit de sécurité, installé à part depuis le Hub)
// dit de ce réseau : score par domaine, priorités, écarts par appareil, et ce
// que sa veille a remarqué. MapMyLAN relaie, VIGIE décide ; un clic sur un
// écart ouvre la fiche de l'appareil.
import { toast } from '/socle/compte.js';
import { h, ic, s, entete, figs, fig, carte, split, btn, chip, vide, remplir, telecharger } from '../dom.js';
import { E, api, choisirAppareil } from '../etat.js';
import { t } from '../i18n.js';
import { fmtDate } from '../communs.js';

export const LIB_GRAVITE = { safe: 'Conforme', info: 'Info', faible: 'Faible', eleve: 'Élevé', critique: 'Critique' };
export const TON_GRAVITE = { safe: 'ok', info: 'a', faible: 'o', eleve: 'w', critique: 'w' };
const ORDRE = ['critique', 'eleve', 'faible', 'info', 'safe'];
const tonScore = v => (v === null || v === undefined ? 'nul' : v >= 80 ? 'bon' : v >= 60 ? 'moyen' : v >= 40 ? 'faible' : 'mauvais');

function anneau(score) {
  const r = 52, c = 2 * Math.PI * r, part = 0.75;
  const arc = (classe, v) => s('circle', { cx: 60, cy: 60, r, fill: 'none', 'stroke-width': 10, 'stroke-linecap': 'round', class: classe, 'stroke-dasharray': `${c * part * v} ${c}`, transform: 'rotate(135 60 60)' });
  return h('div', { class: 'vg-anneau', role: 'img', 'aria-label': `Score ${score ?? 'non évalué'} sur 100` },
    s('svg', { viewBox: '0 0 120 120', 'aria-hidden': 'true' }, arc('fond', 1), score ? arc(`val ${tonScore(score)}`, score / 100) : null),
    h('div', { class: 'vg-chiffre' }, h('b', { text: score ?? '—' }), h('span', { text: 'score / 100' })));
}

function domaines(audit, noms) {
  return h('div', { class: 'vg-domaines' }, Object.entries(noms).map(([k, nom]) => {
    const d = audit.domaines?.[k];
    const ne = d?.score === null || d?.score === undefined;
    const barre = h('i', { class: tonScore(d?.score) });
    barre.style.width = `${ne ? 0 : d.score}%`;
    return h('div', { class: 'vg-domaine' }, h('span', { text: nom }), h('b', { class: ne ? 'ne' : '', text: ne ? 'non évalué' : String(d.score) }), h('div', { class: 'bar' }, barre));
  }));
}

export function pageVigie(p) {
  const sec = h('section', { class: 'page on' });
  let etat = null, constats = [], evenements = [], erreur = null, lancement = false;
  const membre = E.moi?.role === 'admin' || E.moi?.role === 'membre';

  async function charger() {
    try {
      etat = await api.get('/api/vigie/etat');
      const [detail, ev] = await Promise.all([etat.audit ? api.get(`/api/vigie/audits/${etat.audit.id}`) : null, api.get('/api/vigie/evenements')]);
      constats = detail?.constats || [];
      evenements = ev || [];
      erreur = null;
    } catch (e) { erreur = e.message; }
    peindre();
    if (etat?.enCours) setTimeout(() => { if (sec.isConnected) charger(); }, 3000);
  }
  const lancer = async () => {
    lancement = true; peindre();
    try { const o = await api.post('/api/vigie/audit', {}); toast(o.deja ? 'Un audit est déjà en cours.' : 'Audit lancé dans VIGIE.'); await charger(); }
    catch (e) { toast(e.message, true); }
    finally { lancement = false; peindre(); }
  };
  const pdf = async a => {
    const r = await fetch(`/api/vigie/audits/${a.id}/pdf`, { credentials: 'same-origin' });
    if (!r.ok) { let m = 'Téléchargement impossible.'; try { m = (await r.json()).error || m; } catch { /* corps non JSON */ } toast(m, true); return; }
    telecharger(`vigie-audit-${new Date(a.debut).toISOString().slice(0, 10)}.pdf`, await r.blob(), 'application/pdf');
  };

  function peindre() {
    const a = etat?.audit;
    const actions = [
      a ? btn({ icone: 'download', onclick: () => pdf(a) }, 'Rapport PDF') : null,
      membre ? btn({ solid: true, icone: 'shield', onclick: lancer, disabled: lancement || !!etat?.enCours }, etat?.enCours ? 'Audit en cours…' : 'Lancer un audit') : null,
    ];
    if (erreur || !etat) {
      remplir(sec, entete({ titre: t('page.vigie.title'), lede: t('page.vigie.lede') }), carte({}, vide(erreur || t('misc.loading'), 'shield')));
      return;
    }
    if (!a) {
      remplir(sec, entete({ titre: t('page.vigie.title'), lede: t('page.vigie.lede'), actions }), carte({}, vide(etat.enCours ? 'Premier audit en cours…' : 'Aucun audit encore : lance le premier.', 'shield')));
      return;
    }
    const ecarts = constats.filter(c => c.gravite !== 'safe');
    const dist = a.distribution || {};
    const total = ORDRE.reduce((n, g) => n + (dist[g] || 0), 0) || 1;
    const barre = h('div', { class: 'vg-distribution', role: 'img', 'aria-label': ORDRE.map(g => `${dist[g] || 0} ${LIB_GRAVITE[g]}`).join(', ') },
      [...ORDRE].reverse().map(g => { const i = h('i', { class: `g-${g}` }); i.style.width = `${100 * (dist[g] || 0) / total}%`; return i; }));
    const prio = a.ia?.priorites?.length ? a.ia.priorites.map(x => ({ titre: x.titre, sous: x.pourquoi })) : (etat.priorites || []).map(x => ({ titre: x.titre, sous: x.sujet || '' }));
    const nonAcq = evenements.filter(e => !e.acquitte);
    remplir(sec,
      entete({ titre: t('page.vigie.title'), lede: `Audit du ${fmtDate(a.debut)} · ${a.declencheur}${a.ia?.statut === 'faite' ? ` · relu par l’IA ${a.ia.moteur}` : ''}`, actions }),
      figs(
        fig({ icone: 'shield', ton: (a.score ?? 0) < 50 ? 'warn' : undefined, libelle: 'Score', valeur: a.score ?? '—', unite: '/100', delta: a.score === null ? 'non évalué' : a.score >= 80 ? 'sain' : a.score >= 60 ? 'à surveiller' : 'à corriger' }),
        fig({ icone: 'alert', ton: dist.critique ? 'warn' : 'plain', libelle: 'Critiques', valeur: dist.critique || 0, delta: 'action immédiate' }),
        fig({ icone: 'alert', ton: 'plain', libelle: 'Élevés', valeur: dist.eleve || 0, delta: 'à corriger' }),
        fig({ icone: 'bell', ton: etat.evenements?.critiques ? 'warn' : 'plain', libelle: 'Veille', valeur: nonAcq.length, delta: 'non acquittés' })),
      split('',
        carte({ titre: 'Score par domaine', note: 'référentiel Codex64' },
          h('div', { class: 'vg-score' }, anneau(a.score), domaines(a, etat.domaines || {})),
          barre,
          h('div', { class: 'vg-legende' }, ORDRE.map(g => h('span', {}, h('i', { class: `vg-pastille g-${g}` }), h('b', { text: dist[g] || 0 }), LIB_GRAVITE[g])))),
        carte({ titre: 'Priorités' },
          prio.length ? prio.map((x, i) => h('div', { class: 'flowrow' }, h('span', { class: 'itile' }, String(i + 1)), h('div', {}, h('strong', { text: x.titre }), x.sous ? h('small', { text: x.sous }) : null)))
            : vide('Rien à corriger en priorité.', 'check'),
          a.ia?.synthese ? h('p', { class: 'vg-synthese', text: a.ia.synthese }) : null)),
      carte({ titre: 'Écarts', note: `${ecarts.length}` },
        ecarts.length ? h('table', {},
          h('thead', {}, h('tr', {}, h('th', { text: 'Constat' }), h('th', { class: 'cache-m', text: 'Concerne' }), h('th', { text: 'Gravité' }))),
          h('tbody', {}, ecarts.slice(0, 200).map(c => h('tr', { class: c.sujetId ? 'cliquable' : '', onclick: c.sujetId ? () => choisirAppareil(c.sujetId) : undefined },
            h('td', { class: 'principal' }, h('b', { text: c.titre }), h('div', { class: 'dim', text: c.correction || '' })),
            h('td', { class: 'dim cache-m', text: c.sujet || 'réseau' }),
            h('td', {}, chip(TON_GRAVITE[c.gravite], LIB_GRAVITE[c.gravite])))))) : vide('Aucun écart : tous les contrôles évalués sont conformes.', 'check')),
      carte({ titre: 'Veille', note: etat.veille?.actif ? `toutes les ${etat.veille.minutes} min` : 'coupée' },
        evenements.length ? evenements.slice(0, 15).map(e => h('div', { class: 'flowrow' },
          h('span', { class: `itile ${e.gravite === 'critique' || e.gravite === 'eleve' ? 'hot' : ''}` }, ic(e.gravite === 'critique' ? 'alert' : 'bell', 15)),
          h('div', {}, h('strong', { text: e.titre }), h('small', { text: [e.texte, fmtDate(e.quand)].filter(Boolean).join(' · ') })),
          h('div', { class: 'fin' }, chip(TON_GRAVITE[e.gravite], LIB_GRAVITE[e.gravite])))) : vide('Rien de remarqué.', 'check')));
  }

  peindre();
  charger();
  return sec;
}

/** Les écarts d'un appareil au dernier audit, pour sa fiche. Rend null si VIGIE n'est pas reliée. */
export async function ecartsAppareil(id) {
  if (!E.vigie) return null;
  try { return await api.get(`/api/vigie/appareils/${encodeURIComponent(id)}`); } catch { return null; }
}
