// « Appareils vus » : ce que les balayages ont trouvé, créneau par créneau.
//
// Deux sources réelles, rien d'autre : les balayages terminés (hostsFound,
// plage par plage) et la date de première apparition de chaque appareil. Un
// créneau sans balayage reste vide et le dit ; aucune barre n'est inventée.
import { h, carte, vues, remplir } from '../dom.js';
import { E, api } from '../etat.js';
import { t, langue } from '../i18n.js';
import { PERIODES, creneaux, plafond } from '../lib/creneaux.js';

function etiquette(quand, periode, complet = false) {
  const loc = langue() === 'fr' ? 'fr-FR' : 'en-GB';
  const d = new Date(quand);
  if (periode === '24h') return d.toLocaleTimeString(loc, { hour: '2-digit', minute: '2-digit' });
  if (periode === '7d') return d.toLocaleString(loc, complet ? { weekday: 'short', hour: '2-digit', minute: '2-digit' } : { weekday: 'short' });
  return d.toLocaleDateString(loc, { day: 'numeric', month: 'short' });
}

export function grapheVus(p) {
  let periode = '24h';
  const cache = {};
  const racine = carte({ classe: 'vus' });
  const lire = () => api.get(`/api/devices/scans?heures=${PERIODES[periode].heures}`)
    .then(l => { cache[periode] = Array.isArray(l) ? l : []; peindre(); })
    .catch(() => { cache[periode] = []; peindre(); });

  function peindre() {
    const liste = cache[periode];
    const serie = liste ? creneaux(liste, E.devices, periode) : [];
    const max = plafond(Math.max(0, ...serie.map(c => (c.vus ?? 0) + (c.vus === null ? c.nouveaux : 0))));
    const bulle = h('div', { class: 'vus-bulle', role: 'status' });
    const zone = h('div', { class: 'vus-zone' });
    const montrer = (barre, c) => {
      for (const b of zone.querySelectorAll('.vus-b')) b.classList.toggle('hl', b === barre);
      remplir(bulle,
        h('div', { class: 'h', text: `${etiquette(c.debut, periode, true)} – ${etiquette(c.fin, periode, true)}` }),
        c.vus === null
          ? h('div', { class: 'r' }, h('span', { text: t('chart.noScan') }))
          : h('div', { class: 'r' }, h('span', { text: t('chart.known') }), h('b', { text: String(c.connus) })),
        h('div', { class: 'r' }, h('span', { text: t('chart.new') }), h('b', { class: 'g', text: String(c.nouveaux) })));
      bulle.classList.add('on');
      const cz = zone.getBoundingClientRect(), cb = barre.getBoundingClientRect();
      let gauche = cb.left - cz.left - bulle.offsetWidth - 8;
      if (gauche < 8) gauche = Math.min(cb.right - cz.left + 8, cz.width - bulle.offsetWidth - 8);
      bulle.style.left = `${Math.max(8, gauche)}px`;
    };
    const cacher = () => { bulle.classList.remove('on'); for (const b of zone.querySelectorAll('.vus-b')) b.classList.remove('hl'); };
    const barres = serie.map(c => {
      const b = h('button', {
        class: c.vus === null ? 'vus-b sans' : 'vus-b', type: 'button',
        'aria-label': `${etiquette(c.debut, periode, true)} : ${c.vus === null ? t('chart.noScan') : `${t('chart.known')} ${c.connus}`}, ${t('chart.new')} ${c.nouveaux}`,
      },
      h('i', { class: 'neuf', style: { height: `${(c.nouveaux / max) * 100}%` } }),
      h('i', { class: 'connu', style: { height: `${(c.connus / max) * 100}%` } }));
      b.addEventListener('mouseenter', () => montrer(b, c));
      b.addEventListener('focus', () => montrer(b, c));
      b.addEventListener('click', () => montrer(b, c));
      return b;
    });
    zone.addEventListener('mouseleave', cacher);
    const reperes = serie.length ? [0, 1, 2, 3, 4, 5, 6].map(k => serie[Math.round((k * (serie.length - 1)) / 6)]) : [];
    const vide = liste && !liste.length;
    remplir(racine,
      h('div', { class: 'vus-h' },
        h('div', {}, h('div', { class: 't', text: t('chart.seen.title') }), h('div', { class: 's', text: t(`chart.seen.sub.${periode}`) })),
        h('div', { class: 'vus-leg' },
          h('span', {}, h('i', { class: 'connu' }), t('chart.known')),
          h('span', {}, h('i', { class: 'neuf' }), t('chart.new')),
          vues(Object.keys(PERIODES).map(k => ({ libelle: t(`chart.range.${k}`), on: k === periode,
            onclick: () => { periode = k; if (cache[k]) peindre(); else lire(); } }))))),
      h('div', { class: 'vus-graphe' },
        h('div', { class: 'vus-y' }, [4, 3, 2, 1, 0].map(k => h('span', { text: String((max / 4) * k) }))),
        remplir(zone, ...barres),
        h('div', { class: 'vus-x' }, reperes.map(c => h('span', { text: etiquette(c.debut, periode) }))),
        vide ? h('div', { class: 'vus-vide', text: t('chart.empty') }) : null,
        bulle));
  }

  p.suivre('devices', peindre);
  p.suivre('scanRunning', () => { if (!E.scanRunning) { for (const k of Object.keys(cache)) delete cache[k]; lire(); } });
  peindre();
  lire();
  return racine;
}
