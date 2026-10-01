// Intégrations.
//
// Un jeton d'intégration donne à un programme tiers un accès durable à l'API,
// sans compte et sans mot de passe. Deux choses en découlent, visibles ici :
//
//   — le jeton n'est montré qu'une fois, à la création. Le serveur n'en garde
//     que l'empreinte ; personne ne peut le réafficher ensuite. Fermer ce
//     bandeau sans l'avoir copié oblige à en créer un autre, et c'est voulu ;
//   — révoquer n'efface pas la ligne. On garde le nom, le rôle et la dernière
//     utilisation : savoir ce qui a existé fait partie de la surveillance.
//
// Le rôle « admin » n'est pas proposé, et le serveur le refuserait : un jeton
// vit dans le fichier de configuration d'un autre programme, il n'a ni second
// facteur ni mot de passe à opposer à qui le lit.
import { confirmer, toast } from '/socle/compte.js';
import { h, ic, remplir } from '../dom.js';
import { E, api } from '../etat.js';
import { t } from '../i18n.js';

const ROLES = ['lecture', 'membre'];

function quand(v) {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
}
const teinte = etat => (etat === 'actif' ? 'var(--accent)' : etat === 'expire' ? 'var(--faint)' : 'var(--alarm)');

export function panneauIntegrations() {
  let jetons = [], clair = null, copie = false, occupe = false, err = '';
  const bloc = h('div', { class: 'set', hidden: true });
  const nom = h('input', { class: 'field mml police-texte', placeholder: t('integrations.namePlaceholder'), 'aria-label': t('integrations.name') });
  const role = h('select', { class: 'field mml police-texte', 'aria-label': t('integrations.role') }, ROLES.map(r => h('option', { value: r }, t(`integrations.role.${r}`))));
  const erreur = h('p', { class: 'set-err' });
  const liste = h('div');
  const bandeau = h('div');

  // La liste n'est ouverte qu'aux administrateurs : les autres ne la
  // demandent pas (chaque refus entrerait au journal de sécurité), et un
  // refus malgré tout veut dire « rien à afficher ici », pas une panne.
  const charger = () => E.moi?.role !== 'admin' ? Promise.resolve() : api.get('/api/integrations').then(l => { jetons = l; bloc.hidden = false; peindre(); }).catch(() => { bloc.hidden = true; });

  const creer = async () => {
    const n = nom.value.trim();
    if (!n) { err = t('integrations.errName'); peindre(); return; }
    occupe = true; err = ''; peindre();
    try {
      const rep = await api.post('/api/integrations', { name: n, role: role.value });
      clair = rep.token; copie = false; nom.value = '';
      await charger();
    } catch (e) { err = e?.message || t('integrations.errApi'); }
    finally { occupe = false; peindre(); }
  };
  const revoquer = async j => {
    if (!await confirmer(t('integrations.revoke'), t('integrations.confirmRevoke', { nom: j.name }), { danger: true, oui: t('integrations.revoke') })) return;
    occupe = true; err = ''; peindre();
    try { await api.del(`/api/integrations/${j.id}`); await charger(); }
    catch (e) { err = e?.message || t('integrations.errApi'); }
    finally { occupe = false; peindre(); }
  };
  const copier = async () => {
    try { await navigator.clipboard.writeText(clair); copie = true; } catch { toast('Copie impossible ici.', true); }
    peindre();
  };

  function peindre() {
    remplir(bandeau, clair ? h('div', { class: 'jeton-clair' },
      h('div', { class: 'jeton-avert', text: t('integrations.onceOnly') }),
      h('div', { class: 'jeton-ligne' },
        h('code', { class: 'coupe', text: clair }),
        h('button', { class: 'jeton-copier', type: 'button', onclick: copier }, copie ? t('integrations.copied') : t('integrations.copy')),
        h('button', { class: 'jeton-x', type: 'button', title: t('integrations.close'), 'aria-label': t('integrations.close'), onclick: () => { clair = null; peindre(); } }, ic('x', 15)))) : '');
    remplir(liste, jetons.length === 0
      ? h('div', { class: 'set-vide', text: t('integrations.none') })
      : h('div', {}, jetons.map(j => h('div', { class: 'jeton' },
        h('span', { class: 'jeton-pt', style: { background: teinte(j.etat) } }),
        h('div', { class: 'grow' }, h('div', { class: 'jeton-nom', text: j.name }),
          h('div', { class: 'jeton-meta', text: `${j.prefix}… · ${t(`integrations.role.${j.role}`)} · ${t('integrations.lastUsed')} ${quand(j.lastUsedAt)}` })),
        h('span', { class: 'jeton-etat', style: { color: teinte(j.etat) }, text: t(`integrations.state.${j.etat}`) }),
        !j.revokedAt ? h('button', { class: 'jeton-revoquer', type: 'button', disabled: occupe, onclick: () => revoquer(j) }, t('integrations.revoke')) : null))));
    erreur.textContent = err;
  }

  bloc.append(
    h('header', {}, h('span', { class: 'tile' }, ic('plug', 17)), h('div', { class: 'grow' }, h('h2', { text: t('integrations.title') }), h('p', { text: t('integrations.lede') }))),
    bandeau, liste,
    h('div', { class: 'set-pied' },
      h('div', { class: 'jeton-form' },
        h('div', { class: 'jeton-f-nom' }, h('label', { class: 'lbl', text: t('integrations.name') }), nom),
        h('div', { class: 'jeton-f-role' }, h('label', { class: 'lbl', text: t('integrations.role') }), role),
        h('button', { class: 'jeton-creer', type: 'button', onclick: creer }, t('integrations.create'))),
      h('p', { class: 'set-note', text: t('integrations.scopeNote.service') }),
      h('p', { class: 'set-note', text: t('integrations.roleNote') }),
      erreur));
  peindre();
  charger();
  return bloc;
}
