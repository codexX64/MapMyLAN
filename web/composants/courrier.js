// Boîtes mail.
//
// L'utilisateur saisit une adresse et un mot de passe, choisit son fournisseur,
// et les réglages IMAP/SMTP se remplissent seuls : le serveur tient le
// catalogue des fournisseurs et le résout (/api/mail/resolve).
//
// Deux règles qui ne se contournent pas : enregistrer reste inaccessible tant
// que le test n'est pas passé, et toute modification d'un champ réarme ce
// verrou. Aucune configuration non vérifiée n'entre en base.
import { confirmer, toast } from '/socle/compte.js';
import { h, ic, panneau, remplir } from '../dom.js';
import { api } from '../etat.js';
import { t } from '../i18n.js';

const ROLES = [{ id: 'both', label: 'mail.role.both' }, { id: 'receive', label: 'mail.role.receive' }, { id: 'send', label: 'mail.role.send' }];
// Le serveur refuse « none » : des identifiants ne partent jamais en clair.
const SECURITES = ['ssl', 'starttls'];

/**
 * Menu déroulant aux couleurs de l'application, utilisable au clavier :
 * flèches pour parcourir, Entrée pour choisir, Échap pour refermer.
 * options : [{ value, label, note?, icon? }].
 */
export function menu({ valeur, options, surChange, placeholder, disabled, aria }) {
  let ouvert = false, vise = -1, courant = valeur;
  const panneauOptions = h('div', { class: 'sel-pan', role: 'listbox', hidden: true });
  const libelle = h('span', { class: 'sel-lib' });
  const pictoChoisi = h('span', { class: 'sel-ic' });
  const bouton = h('button', { class: 'sel-btn', type: 'button', disabled: !!disabled, 'aria-haspopup': 'listbox', 'aria-label': aria },
    pictoChoisi, libelle, h('span', { class: 'sel-ch' }, ic('chevron', 14, { trait: 1.8 })));
  const boite = h('div', { class: 'sel' }, bouton, panneauOptions);
  // Le survol ne fait que déplacer la marque : reconstruire les options sous
  // le pointeur ferait tomber le clic entre deux boutons différents.
  const viser = cible => { for (const b of panneauOptions.children) b.classList.toggle('vise', b === cible); };
  const peindre = () => {
    const choisi = options.find(o => o.value === courant);
    libelle.textContent = choisi?.label || placeholder || '';
    bouton.classList.toggle('sans-choix', !choisi);
    bouton.classList.toggle('open', ouvert);
    remplir(pictoChoisi, choisi?.icon ? ic(choisi.icon, 15) : '');
    panneauOptions.hidden = !ouvert;
    remplir(panneauOptions, ...options.map((o, i) => h('button', {
      class: ['sel-opt', i === vise ? 'vise' : '', o.value === courant ? 'on' : ''].filter(Boolean).join(' '),
      type: 'button', role: 'option', 'aria-selected': String(o.value === courant),
      onmouseenter: ev => { vise = i; viser(ev.currentTarget); }, onclick: () => choisir(o.value),
    }, o.icon ? h('span', { class: 'sel-oic' }, ic(o.icon, 15)) : null,
      h('span', { class: 'grow' }, h('span', { class: 'sel-ol', text: o.label }), o.note ? h('span', { class: 'sel-on', text: o.note }) : null),
      o.value === courant ? h('span', { class: 'sel-ok' }, ic('shield', 13)) : null)));
  };
  // Refermer au clic extérieur : sans cela le panneau reste ouvert derrière
  // les autres champs. L'écoute ne vit que le temps de l'ouverture.
  const dehors = ev => { if (!boite.contains(ev.target)) basculer(false); };
  const choisir = v => { courant = v; basculer(false); surChange(v); };
  const basculer = v => {
    ouvert = v;
    if (ouvert) { vise = Math.max(0, options.findIndex(o => o.value === courant)); document.addEventListener('pointerdown', dehors); }
    else document.removeEventListener('pointerdown', dehors);
    peindre();
  };
  bouton.addEventListener('click', () => { if (!disabled) basculer(!ouvert); });
  bouton.addEventListener('keydown', ev => {
    if (disabled) return;
    if (!ouvert && ['Enter', ' ', 'ArrowDown'].includes(ev.key)) { ev.preventDefault(); basculer(true); return; }
    if (!ouvert) return;
    if (ev.key === 'Escape') { ev.preventDefault(); basculer(false); }
    else if (ev.key === 'ArrowDown') { ev.preventDefault(); vise = Math.min(options.length - 1, vise + 1); peindre(); }
    else if (ev.key === 'ArrowUp') { ev.preventDefault(); vise = Math.max(0, vise - 1); peindre(); }
    else if (ev.key === 'Enter') { ev.preventDefault(); if (options[vise]) choisir(options[vise].value); }
  });
  peindre();
  boite.valeur = v => { courant = v; peindre(); };
  return boite;
}

export function panneauCourrier() {
  let boites = [], fournisseurs = [];
  const tableau = h('div');
  const charger = () => Promise.all([api.get('/api/mail/mailboxes').catch(() => []), api.get('/api/mail/providers').catch(() => [])])
    .then(([b, f]) => { boites = b || []; fournisseurs = f || []; peindre(); });
  const supprimer = async b => {
    if (!await confirmer(t('action.delete'), t('mail.confirmDelete', { e: b.email }), { danger: true, oui: t('action.delete') })) return;
    try { await api.del(`/api/mail/mailboxes/${b.id}`); } catch (e) { toast(e.message, true); }
    charger();
  };
  const etat = b => (b.lastTestOk === false ? ['alert', 'mail.stateFail', 'ko'] : b.lastTestOk ? ['shield', 'mail.stateOk', 'ok'] : ['clock', 'mail.stateNever', '']);
  function peindre() {
    remplir(tableau, boites.length === 0
      ? h('div', { class: 'set-vide large', text: t('mail.none') })
      : h('table', { class: 'boites' },
        h('thead', {}, h('tr', {}, h('th', { text: t('mail.col.address') }), h('th', { class: 'cache-m', text: t('mail.col.provider') }),
          h('th', { class: 'cache-l', text: t('mail.col.host') }), h('th', { class: 'cache-m', text: t('mail.col.role') }), h('th', { class: 'cache-s', text: t('mail.col.state') }), h('th'))),
        h('tbody', {}, boites.map(b => {
          const f = fournisseurs.find(x => x.id === b.provider);
          const [picto, cle, ton] = etat(b);
          return h('tr', {},
            h('td', { class: 'principal tronque moyen', text: b.email }),
            h('td', { class: 'dim cache-m', text: f?.nom || b.provider }),
            h('td', { class: 'mono cache-l', text: b.imap?.host || b.smtp?.host || '—' }),
            h('td', { class: 'dim cache-m', text: t(ROLES.find(r => r.id === b.role)?.label || 'mail.role.both') }),
            h('td', { class: 'cache-s' }, h('span', { class: `etat-boite ${ton}` }, ic(picto, 13), t(cle))),
            h('td', { class: 'droite nowrap' },
              h('button', { class: 'lien-sobre', type: 'button', onclick: () => formulaire(b, fournisseurs, charger) }, t('action.edit')),
              h('button', { class: 'lien-sobre alarme', type: 'button', onclick: () => supprimer(b) }, t('action.delete'))));
        }))));
  }
  charger();
  return h('div', { class: 'set' },
    h('header', {}, h('span', { class: 'tile' }, ic('bell', 17)), h('div', { class: 'grow' }, h('h2', { text: t('mail.title') }), h('p', { text: t('mail.lede') })),
      h('button', { class: 'btn-ajout pret', type: 'button', onclick: () => formulaire({}, fournisseurs, charger) }, ic('plus', 14, { trait: 1.8 }), h('span', { class: 'cache-s', text: t('mail.add') }))),
    tableau);
}

// Feuille d'ajout et de modification
function formulaire(boite, fournisseurs, apres) {
  const modification = !!boite?.id;
  const v = {
    email: boite?.email || '', password: '', provider: boite?.provider || '', n: '', role: boite?.role || 'both', deplie: false,
    srv: { imap: { host: '', port: 993, security: 'ssl', ...(boite?.imap || {}) }, smtp: { host: '', port: 465, security: 'ssl', ...(boite?.smtp || {}) } },
    teste: false, resultat: null, occupe: '', fiche: null,
  };
  panneau({ titre: modification ? t('mail.formEdit') : t('mail.formNew'), largeur: 520, classe: 'mail' }, fermer => {
    const zoneN = h('div'), zoneNote = h('div'), zoneServeurs = h('div'), zoneRoles = h('div', { class: 'roles-mail' }), zoneResultat = h('div'), zoneVerrou = h('div');
    const libre = () => v.provider === 'other' || v.provider === 'autre' || !v.provider || !v.fiche?.imap;
    // Toute modification réarme le verrou.
    const touche = () => { v.teste = false; v.resultat = null; peindre(); };

    let resolution = 0;
    const resoudre = async () => {
      const n = ++resolution;
      if (!v.provider) { v.fiche = null; peindre(); return; }
      try {
        const f = await api.post('/api/mail/resolve', { provider: v.provider, email: v.email, ...(v.n ? { n: v.n } : {}) });
        if (n !== resolution) return;
        v.fiche = f;
        // Les réglages serveur suivent le fournisseur, sauf en mode libre.
        if (f?.imap && f?.smtp) v.srv = { imap: { ...f.imap }, smtp: { ...f.smtp } };
      } catch { v.fiche = null; }
      peindre();
    };
    let minuterie;
    const email = h('input', { class: 'field mml', value: v.email, placeholder: 'alertes@exemple.org', disabled: modification, 'aria-label': t('mail.address'), autocomplete: 'off' });
    email.addEventListener('input', () => {
      v.email = email.value; touche();
      // Détection du fournisseur à la saisie de l'adresse.
      clearTimeout(minuterie);
      minuterie = setTimeout(async () => {
        if (!modification && !v.provider && v.email.includes('@')) {
          const r = await api.post('/api/mail/detect', { email: v.email }).catch(() => null);
          if (r?.provider) { v.provider = r.provider; choixFournisseur.valeur(v.provider); }
        }
        resoudre();
      }, 300);
    });
    const mdp = h('input', { class: 'field mml', type: 'password', placeholder: boite?.hasPassword ? t('mail.keepPassword') : '', 'aria-label': t('mail.password'), autocomplete: 'new-password' });
    mdp.addEventListener('input', () => { v.password = mdp.value; touche(); });
    const choixFournisseur = menu({
      valeur: v.provider, placeholder: t('mail.choose'), aria: t('mail.provider'),
      options: fournisseurs.map(f => ({ value: f.id, label: f.nom, note: f.note || undefined, icon: 'bell' })),
      surChange: x => { v.provider = x; touche(); resoudre(); },
    });

    const charge = ({ pourTest }) => ({
      email: v.email.trim().toLowerCase(),
      ...(v.password ? { password: v.password } : {}),
      ...(pourTest ? {} : { provider: v.provider || 'other' }),
      role: v.role,
      ...(v.role === 'send' ? {} : { imap: { host: v.srv.imap.host, port: Number(v.srv.imap.port), security: v.srv.imap.security } }),
      ...(v.role === 'receive' ? {} : { smtp: { host: v.srv.smtp.host, port: Number(v.srv.smtp.port), security: v.srv.smtp.security } }),
    });
    const tester = async () => {
      v.occupe = 'test'; v.resultat = null; peindre();
      try { const r = await api.post('/api/mail/verify', charge({ pourTest: true })); v.resultat = r; v.teste = !!r.ok; }
      catch (e) {
        // Pas d'échec silencieux : si l'API ne répond pas, on le dit.
        v.resultat = { ok: false, error: e?.message || t('mail.apiDown'), details: e?.details?.details };
        v.teste = false;
      }
      finally { v.occupe = ''; peindre(); }
    };
    const enregistrer = async () => {
      v.occupe = 'save'; peindre();
      try { await api.post('/api/mail/mailboxes', charge({ pourTest: false })); fermer(); apres(); }
      catch (e) { v.resultat = { ok: false, error: e?.message || t('mail.apiDown') }; }
      finally { v.occupe = ''; peindre(); }
    };
    const bTester = h('button', { class: 'btn-gris', type: 'button', onclick: tester });
    const bEnreg = h('button', { class: 'btn-enreg', type: 'button', onclick: enregistrer });
    const bDeplier = h('button', { class: 'deplier', type: 'button', onclick: () => { v.deplie = !v.deplie; peindre(); } });

    function peindre() {
      const manque = v.fiche?.needs || [];
      remplir(zoneN, manque.includes('n') ? h('div', { class: 'champ-mail' }, h('label', { class: 'lbl', text: t('mail.serverNumber') }), (() => {
        const el = h('input', { class: 'field mml court', value: v.n, placeholder: '2', 'aria-label': t('mail.serverNumber') });
        el.addEventListener('input', () => { el.value = el.value.replace(/\D/g, ''); v.n = el.value; touche(); resoudre(); });
        return el;
      })()) : '');
      remplir(zoneNote, v.fiche?.note ? h('div', { class: 'note-fournisseur', text: v.fiche.note }) : '');
      remplir(bDeplier, ic('settings', 13, { trait: 1.8 }), `${t('mail.serverSettings')} ${v.deplie ? '▾' : '▸'}`);
      bDeplier.classList.toggle('ouvert', v.deplie);
      remplir(zoneServeurs, ...(!v.deplie ? [] : ['imap', 'smtp'].filter(cote => !((v.role === 'send' && cote === 'imap') || (v.role === 'receive' && cote === 'smtp'))).map(cote => {
        const hote = h('input', { class: 'field mml', value: v.srv[cote].host, disabled: !libre(), 'aria-label': `${cote.toUpperCase()} hôte` });
        hote.addEventListener('input', () => { v.srv[cote].host = hote.value; touche(); });
        const port = h('input', { class: 'field mml', value: v.srv[cote].port, disabled: !libre(), 'aria-label': `${cote.toUpperCase()} ${t('mail.port')}` });
        port.addEventListener('input', () => { port.value = port.value.replace(/\D/g, ''); v.srv[cote].port = Number(port.value) || 0; touche(); });
        return h('div', { class: 'serveur-mail' },
          h('div', {}, h('label', { class: 'lbl', text: cote.toUpperCase() }), hote),
          h('div', {}, h('label', { class: 'lbl', text: t('mail.port') }), port),
          h('div', {}, h('label', { class: 'lbl', text: t('mail.security') }), menu({
            valeur: v.srv[cote].security, disabled: !libre(), aria: `${cote.toUpperCase()} ${t('mail.security')}`,
            options: SECURITES.map(x => ({ value: x, label: x === 'ssl' ? 'SSL/TLS' : 'STARTTLS', icon: 'shield' })),
            surChange: x => { v.srv[cote].security = x; touche(); },
          })));
      })));
      remplir(zoneRoles, ...ROLES.map(r => h('button', { class: v.role === r.id ? 'role-mail on' : 'role-mail', type: 'button', onclick: () => { v.role = r.id; touche(); } }, t(r.label))));
      const r = v.resultat;
      remplir(zoneResultat, r ? h('div', { class: r.ok ? 'resultat ok' : 'resultat ko' }, h('span', { class: 'resultat-ic' }, ic(r.ok ? 'shield' : 'alert', 14)),
        h('div', {}, h('div', { text: r.ok ? (r.inbox || t('mail.testOk')) : (r.error || '') }),
          Array.isArray(r.details) && r.details.length ? h('div', { class: 'resultat-details', text: r.details.join(' · ') }) : null)) : '');
      bTester.disabled = !!v.occupe;
      remplir(bTester, ic('refresh', 14, { trait: 1.8 }), v.occupe === 'test' ? t('mail.testing') : t('mail.test'));
      bEnreg.disabled = !v.teste || !!v.occupe;
      bEnreg.title = v.teste ? '' : t('mail.testFirst');
      bEnreg.classList.toggle('pret', v.teste);
      remplir(bEnreg, ic('shield', 14, { trait: 1.8 }), v.occupe === 'save' ? '…' : t('action.save'));
      remplir(zoneVerrou, !v.teste ? h('div', { class: 'verrou', text: t('mail.testFirst') }) : '');
    }
    if (v.provider) resoudre();
    peindre();
    setTimeout(() => email.focus(), 0);
    return [
      h('div', { class: 'champ-mail' }, h('label', { class: 'lbl', text: t('mail.address') }), email),
      h('div', { class: 'champ-mail' }, h('label', { class: 'lbl', text: t('mail.password') }), mdp),
      h('div', { class: 'champ-mail' }, h('label', { class: 'lbl', text: t('mail.provider') }), choixFournisseur),
      zoneN, zoneNote, bDeplier, zoneServeurs,
      h('div', { class: 'champ-mail roles' }, h('label', { class: 'lbl', text: t('mail.role') }), zoneRoles),
      zoneResultat,
      h('div', { class: 'actions-mail' }, bTester, bEnreg),
      zoneVerrou,
    ];
  });
}
