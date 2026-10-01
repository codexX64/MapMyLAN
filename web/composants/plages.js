// Plages balayées.
//
// Un réseau ne tient jamais dans un seul sous-réseau dès qu'il grandit : le
// DHCP distribue ici, l'infrastructure vit là, et un équipement resté sur son
// adressage d'usine se cache ailleurs. Ce panneau permet d'en déclarer autant
// que nécessaire, de les activer ou non, sans toucher à la configuration.
//
// Les plages sont balayées l'une après l'autre : deux balayages ARP simultanés
// saturent la carte réseau et faussent les résultats.
import { h, ic, remplir } from '../dom.js';
import { api } from '../etat.js';
import { t } from '../i18n.js';

/** Nombre d'adresses couvertes, pour avertir avant un balayage démesuré. */
function taille(cidr) {
  const m = /^(\d{1,3}(?:\.\d{1,3}){3})\/(\d{1,2})$/.exec(cidr.trim());
  if (!m) return null;
  const bits = Number(m[2]);
  if (bits < 0 || bits > 32) return null;
  return 2 ** (32 - bits);
}

function valide(cidr) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(\d{1,2})$/.exec(cidr.trim());
  if (!m) return false;
  const oct = [1, 2, 3, 4].map(i => Number(m[i]));
  return oct.every(o => o >= 0 && o <= 255) && Number(m[5]) >= 0 && Number(m[5]) <= 32;
}

export function panneauPlages() {
  let plages = [], occupe = false, err = '', ok = '';
  const liste = h('div');
  const avert = h('div');
  const cidr = h('input', { class: 'field mml', placeholder: '192.0.2.0/24', 'aria-label': t('ranges.cidr') });
  const libelle = h('input', { class: 'field mml police-texte', placeholder: t('ranges.labelHint'), 'aria-label': t('ranges.label') });
  const ajouterB = h('button', { class: 'btn-ajout', type: 'button' }, ic('plus', 14, { trait: 1.8 }), t('action.add'));

  const enregistrer = async suivantes => {
    occupe = true; err = ''; ok = ''; peindre();
    try {
      // Le serveur valide strictement : on n'envoie que les trois champs admis.
      await api.put('/api/settings/scan.ranges', { value: suivantes.map(q => ({ cidr: q.cidr, ...(q.label ? { label: q.label } : {}), enabled: q.enabled !== false })) });
      plages = suivantes;
      ok = t('ranges.saved');
      setTimeout(() => { ok = ''; peindre(); }, 2500);
    } catch (e) { err = e?.message || t('ranges.errApi'); }
    finally { occupe = false; peindre(); }
  };
  const ajouter = () => {
    const c = cidr.value.trim();
    if (!valide(c)) { err = t('ranges.errCidr'); peindre(); return; }
    if (plages.some(q => q.cidr === c)) { err = t('ranges.errDup'); peindre(); return; }
    const l = libelle.value.trim();
    enregistrer([...plages, { cidr: c, ...(l ? { label: l } : {}), enabled: true }]);
    cidr.value = ''; libelle.value = '';
  };
  ajouterB.addEventListener('click', ajouter);
  for (const el of [cidr, libelle]) el.addEventListener('keydown', ev => { if (ev.key === 'Enter') ajouter(); });
  cidr.addEventListener('input', () => { err = ''; peindre(); });

  function peindre() {
    remplir(liste, plages.length === 0
      ? h('div', { class: 'set-vide', text: t('ranges.none') })
      : h('div', {}, plages.map((q, i) => {
        const n = taille(q.cidr);
        const actif = q.enabled !== false;
        return h('div', { class: 'rgrow plage' },
          h('button', {
            class: actif ? 'tog on' : 'tog', type: 'button', disabled: occupe, title: t(actif ? 'ranges.disable' : 'ranges.enable'),
            'aria-label': `${t(actif ? 'ranges.disable' : 'ranges.enable')} ${q.cidr}`,
            onclick: () => enregistrer(plages.map((x, j) => (j === i ? { ...x, enabled: x.enabled === false } : x))),
          }, h('i')),
          h('div', { class: actif ? 'c' : 'c eteinte' },
            h('div', { class: 'cidr', text: q.cidr }),
            h('div', { class: 'lab', text: `${q.label ? q.label + ' · ' : ''}${n !== null ? t('ranges.addresses', { n: n.toLocaleString('fr-FR') }) : ''}` })),
          n !== null && n > 1024 && actif ? h('span', { class: 'grande', title: t('ranges.bigHint') }, ic('alert', 12), t('ranges.big')) : null,
          h('button', { class: 'rm', type: 'button', disabled: occupe, onclick: () => enregistrer(plages.filter((_, j) => j !== i)) }, t('action.delete')));
      })));
    const n = taille(cidr.value);
    // Avertissement plutôt qu'interdiction : au-delà d'un millier d'adresses,
    // le balayage ARP devient long et lourd. À l'exploitant de juger.
    remplir(avert,
      n !== null && n > 1024 ? h('div', { class: 'encart warn' }, ic('alert', 14), t('ranges.bigWarn', { n: n.toLocaleString('fr-FR') })) : '',
      err ? h('div', { class: 'encart bad' }, ic('alert', 14), err) : '',
      ok ? h('div', { class: 'encart ok' }, ic('shield', 14), ok) : '');
    ajouterB.disabled = occupe || !cidr.value.trim();
    ajouterB.classList.toggle('pret', !!cidr.value.trim());
  }

  api.get('/api/settings').then(r => {
    const brut = r?.['scan.ranges'];
    if (Array.isArray(brut) && brut.length) { plages = brut; peindre(); }
    else api.get('/api/devices/scan/ranges').then(x => { plages = x || []; peindre(); }).catch(() => { /* liste vide : on peut toujours en ajouter */ });
  }).catch(() => { /* liste vide : on peut toujours en ajouter */ });
  peindre();

  return h('div', { class: 'set' },
    h('header', {}, h('span', { class: 'tile' }, ic('map', 17)), h('div', { class: 'grow' }, h('h2', { text: t('ranges.title') }), h('p', { text: t('ranges.lede') }))),
    liste,
    h('div', { class: 'set-pied' },
      h('div', { class: 'gform', style: { display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 10, alignItems: 'end' } },
        h('div', {}, h('label', { class: 'lbl', text: t('ranges.cidr') }), cidr),
        h('div', {}, h('label', { class: 'lbl', text: t('ranges.label') }), libelle),
        ajouterB),
      avert,
      h('div', { class: 'pied-note', text: t('ranges.note') })));
}
