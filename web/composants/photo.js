// Photo d'appareil.
//
// L'utilisateur dépose une image, le détourage se lance seul et il voit le
// résultat immédiatement. S'il n'est pas satisfait, un curseur ajuste la
// tolérance et il relance ; s'il préfère garder l'image telle quelle, il le
// peut. Rien ne quitte le navigateur.
import { h, ic, remplir } from '../dom.js';
import { t } from '../i18n.js';
import { detourer, vignette } from '../lib/detourage.js';

const TAILLE_MAX = 8 * 1024 * 1024;   // 8 Mo : au-delà, c'est une photo brute

export function photoAppareil(p, valeur, surChange) {
  let brut = null, apercu = valeur, infos = null, tolerance = 34, occupe = false, err = '', survol = false;
  const fichier = h('input', { type: 'file', accept: 'image/*', hidden: true, 'aria-label': t('photo.titre') });
  const zone = h('div', { class: 'depot-photo', role: 'button', tabindex: '0', 'aria-label': t('photo.deposer') });
  const reglages = h('div');
  const erreur = h('div');

  const traiter = async (source, tol) => {
    occupe = true; err = ''; peindre();
    try {
      const r = await detourer(source, { tolerance: tol });
      // Un détourage qui n'enlève presque rien signale un fond trop complexe :
      // mieux vaut le dire que de livrer une image inchangée sans explication.
      if (!r.dejaDetouree && r.retire < 0.05) err = t('photo.fondComplexe');
      infos = r;
      apercu = await vignette(r.dataUrl, 512);
      surChange(r.dataUrl);
    } catch (e) { err = e?.message || t('photo.errLecture'); }
    finally { occupe = false; peindre(); }
  };
  const prendre = f => {
    if (!f.type.startsWith('image/')) { err = t('photo.errType'); peindre(); return; }
    if (f.size > TAILLE_MAX) { err = t('photo.errPoids'); peindre(); return; }
    const lecteur = new FileReader();
    lecteur.onload = () => { brut = String(lecteur.result); traiter(brut, tolerance); };
    lecteur.onerror = () => { err = t('photo.errLecture'); peindre(); };
    lecteur.readAsDataURL(f);
  };
  const retirer = () => { brut = null; apercu = null; infos = null; err = ''; surChange(null); fichier.value = ''; peindre(); };

  fichier.addEventListener('change', () => { const f = fichier.files?.[0]; if (f) prendre(f); });
  zone.addEventListener('click', () => fichier.click());
  zone.addEventListener('keydown', ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); fichier.click(); } });
  zone.addEventListener('dragover', ev => { ev.preventDefault(); survol = true; zone.classList.add('sur'); });
  zone.addEventListener('dragleave', () => { survol = false; zone.classList.remove('sur'); });
  zone.addEventListener('drop', ev => {
    ev.preventDefault(); survol = false; zone.classList.remove('sur');
    const f = ev.dataTransfer.files?.[0];
    if (f) prendre(f);
  });
  // Coller une image : c'est le geste le plus naturel quand on vient de copier
  // une photo sur une fiche constructeur.
  p.ecouter(window, 'paste', ev => {
    const it = [...(ev.clipboardData?.items || [])].find(i => i.type.startsWith('image/'));
    const f = it?.getAsFile();
    if (f) { ev.preventDefault(); prendre(f); }
  });

  function peindre() {
    zone.classList.toggle('sur', survol);
    remplir(zone,
      // Damier discret : sans lui, on ne distingue pas une zone transparente
      // d'une zone blanche.
      apercu ? h('div', { class: 'damier', 'aria-hidden': 'true' }) : null,
      ...(occupe
        ? [ic('refresh', 22, { classe: 'tourne' }), h('span', { class: 'depot-txt', text: t('photo.enCours') })]
        : apercu
          ? [h('img', { src: apercu, alt: '', class: 'depot-img' })]
          : [h('span', { class: 'depot-ic' }, ic('devices', 18)), h('span', { class: 'depot-titre', text: t('photo.deposer') }), h('span', { class: 'depot-aide', text: t('photo.aide') })]));
    const curseur = h('input', { type: 'range', min: 8, max: 110, value: tolerance, 'aria-label': t('photo.tolerance') });
    curseur.addEventListener('change', () => { tolerance = Number(curseur.value); if (brut) traiter(brut, tolerance); });
    curseur.addEventListener('input', () => { valeurTol.textContent = curseur.value; });
    const valeurTol = h('span', { class: 'mono', text: String(tolerance) });
    remplir(reglages, infos && !occupe ? h('div', { class: 'photo-infos' },
      h('div', { class: infos.dejaDetouree ? 'photo-bilan dim' : 'photo-bilan' }, ic('shield', 13),
        infos.dejaDetouree ? t('photo.dejaDetouree') : t('photo.retire', { n: Math.round(infos.retire * 100) }),
        h('span', { class: 'photo-taille', text: `${infos.largeur} × ${infos.hauteur}` })),
      infos.dejaDetouree ? null : h('div', { class: 'photo-tol' },
        h('div', { class: 'photo-tol-l' }, h('span', { text: t('photo.tolerance') }), valeurTol),
        curseur,
        h('div', { class: 'photo-tol-aide', text: t('photo.toleranceAide') })),
      h('div', { class: 'photo-boutons' },
        h('button', { class: 'btn-gris', type: 'button', onclick: () => fichier.click() }, ic('refresh', 13, { trait: 1.8 }), t('photo.remplacer')),
        h('button', { class: 'btn-gris alarme', type: 'button', onclick: retirer }, ic('ban', 13, { trait: 1.8 }), t('action.delete')))) : '');
    remplir(erreur, err ? h('div', { class: 'encart warn' }, ic('alert', 14), err) : '');
  }
  peindre();
  return h('div', {}, h('label', { class: 'lbl photo-lbl', text: t('photo.titre') }), zone, fichier, reglages, erreur);
}
