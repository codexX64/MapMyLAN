// Défense — règles automatiques et vulnérabilités.
import { confirmer } from '/socle/compte.js';
import { h, ic, entete, page, figs, fig, carte, split, btn, chip, bascule, whoCell, vide, note, champ, remplir } from '../dom.js';
import { E, api, choisirPage, choisirAppareil, rafraichirAppareils } from '../etat.js';
import { t } from '../i18n.js';
import { depuis, nomAppareil, glyphe, ETATS, fmtDate } from '../communs.js';

const libelleAction = a => (a === 'ban' ? 'bloquer' : a === 'quarantine' ? 'isoler' : a === 'notify' ? 'prévenir' : a);
const couleurAction = a => (a === 'ban' ? 'var(--alarm)' : a === 'quarantine' ? 'var(--warn)' : 'var(--accent)');

export function pageSecuriteReseau(p) {
  let regles = [];
  let chargees = false;
  const message = h('div');
  const cartes = h('div');
  const dire = texte => remplir(message, texte ? note('warn', texte) : '');

  const charger = () => api.get('/api/rules').then(r => { regles = r; chargees = true; peindre(); }).catch(() => { /* « chargement » reste affiché : rien de faux n'est montré */ });
  const modifier = (id, corps) => api.patch(`/api/rules/${id}`, corps).then(charger).catch(e => dire(e.message));
  const liberer = async d => {
    if (!await confirmer(`Rendre l'accès à ${nomAppareil(d)} ?`, '', { oui: "Rendre l'accès" })) return;
    try { await api.post(`/api/devices/${d.id}/unban`); await rafraichirAppareils(); }
    catch (e) { dire(e.message); }
  };

  function peindre() {
    const retenus = E.devices.filter(d => d.status === 'banned' || d.status === 'quarantined');
    const actives = regles.filter(r => r.enabled).length;
    remplir(cartes, split('',
      carte({ titre: t('card.rules'), note: `${actives} active${actives > 1 ? 's' : ''}` },
        regles.map(r => {
          const seuil = r.threshold != null ? champ({ type: 'number', value: r.threshold, classe: 'seuil', 'aria-label': `Seuil de ${r.name}` }) : null;
          seuil?.addEventListener('change', () => modifier(r.id, { threshold: parseFloat(seuil.value) }));
          return h('div', { class: 'flowrow regle' },
            bascule(!!r.enabled, v => modifier(r.id, { enabled: v }), { aria: r.name }),
            h('span', { class: 'itile cache-s' }, ic('shield', 15)),
            h('div', {},
              h('strong', { text: r.name }),
              h('div', { class: 'chain' },
                h('span', { text: r.trigger }), h('span', { class: 'ar', text: '→' }),
                h('span', { style: { color: couleurAction(r.action) }, text: libelleAction(r.action) }),
                r.exceptWhitelist ? h('span', { class: 'ar', text: '· hors liste blanche' }) : null)),
            h('div', { class: 'stat' }, seuil ? h('span', { class: 'seuil-l' }, 'seuil', seuil) : h('b', { text: r.enabled ? 'active' : 'en veille' })));
        }),
        !chargees || regles.length === 0 ? vide(t('misc.loading'), 'shield') : null),
      carte({ titre: t('card.blocked'), note: String(retenus.length) },
        h('table', {}, h('tbody', {}, retenus.map(d => h('tr', {},
          h('td', { class: 'principal cliquable', onclick: () => choisirAppareil(d.id) }, whoCell({ icone: glyphe(d), ton: 'hot', nom: nomAppareil(d), sous: d.ip })),
          h('td', { class: 'cache-s' }, chip('w', ETATS[d.status] || d.status)),
          h('td', { class: 'mono dim nowrap cache-m', text: depuis(d.updatedAt || d.lastSeen) }),
          h('td', { class: 'droite nowrap' }, h('button', { class: 'lnk', type: 'button', onclick: () => liberer(d) }, "rendre l'accès")))))),
        retenus.length === 0
          ? vide('Aucun hôte retenu', 'check')
          : h('div', { class: 'pad' }, h('div', { class: 'explication', text: "Un hôte retenu reste visible et continue d'être balayé : c'est sa route sortante qui est coupée, pas sa surveillance." })))));
  }
  p.suivre('devices', peindre);
  peindre();
  charger();
  return page({
    titre: t('page.security.title'), lede: t('page.security.lede'),
    actions: btn({ solid: true, icone: 'plus', onclick: () => choisirPage('notifications') }, t('act.newRule')),
  }, message, cartes);
}

const LIBELLE_GRAVITE = { critical: 'critique', high: 'élevée', medium: 'moyenne', low: 'faible', info: 'pour info' };

function gravite(c) {
  const v = Number(c.cvss || 0);
  if (c.severity) return String(c.severity).toLowerCase();
  return v >= 9 ? 'critical' : v >= 7 ? 'high' : v >= 4 ? 'medium' : 'low';
}

export function pageVulns(p) {
  let filtre = 'all';
  const sec = h('section', { class: 'page on' });
  function peindre() {
    const toutes = E.devices.flatMap(d => (d.cves || []).map(c => ({ ...c, appareil: d }))).sort((a, b) => (b.cvss || 0) - (a.cvss || 0));
    const listees = filtre === 'all' ? toutes : toutes.filter(c => gravite(c) === filtre);
    const compte = g => toutes.filter(c => gravite(c) === g).length;
    remplir(sec,
      entete({ titre: t('page.vulns.title'), lede: t('page.vulns.lede') }),
      figs(
        fig({ icone: 'alert', ton: compte('critical') ? 'warn' : undefined, libelle: 'Critiques', valeur: compte('critical'), delta: 'correction immédiate' }),
        fig({ icone: 'alert', libelle: 'Élevées', valeur: compte('high'), delta: 'à planifier' }),
        fig({ icone: 'port', ton: 'plain', libelle: 'Moyennes', valeur: compte('medium'), delta: 'à surveiller' }),
        fig({ icone: 'devices', ton: 'plain', libelle: 'Hôtes touchés', valeur: new Set(toutes.map(c => c.appareil.id)).size, delta: `sur ${E.devices.length}` })),
      carte({
        titre: t('card.cves'), note: `${listees.length}`,
        tete: h('div', { class: 'filtres' }, ['all', 'critical', 'high', 'medium', 'low'].map(g => h('button', {
          class: filtre === g ? 'ftr on' : 'ftr', type: 'button', onclick: () => { filtre = g; peindre(); },
        }, g === 'all' ? t('misc.all') : LIBELLE_GRAVITE[g]))),
      },
      h('table', {},
        h('thead', {}, h('tr', {}, h('th', { text: t('col.ref') }), h('th', { class: 'cache-m', text: t('col.host') }), h('th', { class: 'cache-l', text: t('col.service') }),
          h('th', { text: t('col.severity') }), h('th', { class: 'cache-l', text: t('col.found') }))),
        h('tbody', {}, listees.map(c => {
          const g = gravite(c);
          return h('tr', { class: 'cliquable', onclick: () => choisirAppareil(c.appareil.id) },
            h('td', { class: 'principal' }, h('b', { class: 'mono encre', text: c.cveId }), h('div', { class: 'dim cve-desc', text: c.description || '' })),
            h('td', { class: 'mono cache-m', text: nomAppareil(c.appareil) }),
            h('td', { class: 'dim cache-l', text: c.service || '—' }),
            h('td', {}, chip(g === 'critical' || g === 'high' ? 'w' : g === 'medium' ? undefined : 'a', `${LIBELLE_GRAVITE[g] || g}${c.cvss ? ` · ${c.cvss}` : ''}`)),
            h('td', { class: 'mono dim cache-l', text: c.detectedAt ? fmtDate(c.detectedAt) : '—' }));
        }))),
      listees.length === 0 ? vide(t('misc.noVulns'), 'check') : null));
  }
  p.suivre('devices', peindre);
  peindre();
  return sec;
}
