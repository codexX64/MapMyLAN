// Contrôle — console SSH, machine hôte, inventaire, commandes du bot.
import { confirmer, toast } from '/socle/compte.js';
import {
  h, ic, panneau, entete, page, figs, fig, courbe, carte, pad, split, btn, chip, bascule, whoCell, vide, note, champ, lbl, choix, interrupteur, remplir,
} from '../dom.js';
import { E, api, ecrireLocal } from '../etat.js';
import { t } from '../i18n.js';
import { fmtUptime, fmtOctets } from '../communs.js';
import { estInterrogeable } from '../lib/trafic.js';
import { texteTelegram } from '../composants/texte-riche.js';

// Effacer l'écran est une affaire de terminal, pas d'équipement. Envoyer
// « clear » sur une exécution non interactive ne fait rien de bon : il n'y a
// pas de terminal en face. On le traite donc ici, et on ne l'envoie pas.
const EFFACEMENT = new Set(['clear', 'cls', '/clear', '!clear', '?clear', 'clear()']);
const MARQUES = ['generic', 'asus-merlin', 'mikrotik', 'openwrt', 'pfsense', 'cisco', 'unifi'];
const FORM_SSH = () => ({ name: '', host: '', port: 22, username: '', password: '', privateKey: '', passphrase: '', useKey: false, vendor: 'generic', isMainRouter: false, empreinte: null });

export function pageSsh(p) {
  let liste = [], choisi = null, lignes = [], ouvert = false, essai = null;
  let form = FORM_SSH();
  const zoneForm = h('div');
  const zoneEmpreinte = h('div', { class: 'ssh-empreinte' });
  const equipements = h('div');
  const corps = h('div', { class: 'termbody' });
  const titreTerm = h('span', { class: 'mono term-titre' });
  const relie = h('span', { class: 'pousse' });
  const saisie = champ({ placeholder: "ip neigh · clear pour effacer l'écran", 'aria-label': 'Commande' });
  const ligneSaisie = h('div', { class: 'term-saisie', hidden: true }, saisie, btn({ solid: true, icone: 'arrow', onclick: () => executer() }, t('act.run')));
  saisie.addEventListener('keydown', ev => { if (ev.key === 'Enter') executer(); });

  const charger = () => api.get('/api/ssh').then(l => {
    liste = l;
    // La sélection ne doit jamais retomber sur une entrée sans shell.
    if (choisi && !liste.filter(estInterrogeable).some(d => d.id === choisi.id)) choisi = null;
    peindreListe(); peindreTerm();
  }).catch(() => { /* liste vide : on peut toujours en ajouter */ });

  // Confiance au premier usage : le serveur lit la clé d'hôte de
  // l'équipement, l'administrateur la compare à celle que l'équipement
  // affiche, puis l'accepte. Rien ne s'enregistre sans elle.
  const charge = () => {
    const { useKey, password, privateKey, passphrase, empreinte, ...reste } = form;
    return {
      ...reste, ...(useKey ? { privateKey, passphrase: passphrase || undefined } : { password }),
      ...(empreinte?.acceptee ? { empreinteHote: empreinte.valeur } : {}),
    };
  };
  const proposer = r => { if (r?.empreinteHote && r.empreinteHote !== form.empreinte?.valeur) form.empreinte = { valeur: r.empreinteHote, acceptee: false, typeCle: r.typeCle }; };
  const tester = async () => {
    essai = null; peindreForm();
    try {
      essai = await api.post('/api/ssh/test', charge());
      proposer(essai);
    } catch (e) {
      if (e.status === 409 && e.details?.empreinteHote) proposer(e.details);
      essai = { ok: false, error: e.message };
    }
    peindreForm();
  };
  const enregistrer = async () => {
    if (!form.empreinte?.acceptee) {
      await tester();
      if (!form.empreinte?.acceptee) { essai = { ok: false, error: "Accepte d'abord l'empreinte de la clé d'hôte, ci-dessous." }; peindreForm(); return; }
    }
    try { await api.post('/api/ssh', charge()); } catch (e) {
      if (e.status === 409 && e.details?.empreinteHote) { proposer(e.details); peindreForm(); }
      toast(e.message, true); return;
    }
    ouvert = false; essai = null; form = FORM_SSH();
    peindreForm(); charger();
  };
  const supprimer = async d => {
    if (!await confirmer(t('misc.confirmDelete', { name: d.name }), '', { danger: true, oui: t('action.delete') })) return;
    try { await api.del(`/api/ssh/${d.id}`); } catch (e) { toast(e.message, true); return; }
    if (choisi?.id === d.id) choisi = null;
    charger();
  };
  async function executer() {
    const cmd = saisie.value;
    if (!choisi || !cmd.trim()) return;
    saisie.value = '';
    if (EFFACEMENT.has(cmd.trim().toLowerCase())) { lignes = []; peindreTerm(); return; }
    lignes.push({ cmd }); peindreTerm();
    try {
      const r = await api.post(`/api/ssh/${choisi.id}/exec`, { command: cmd });
      const sortie = [r.stdout, r.stderr ? `[erreur] ${r.stderr}` : ''].filter(Boolean).join('\n');
      lignes.push({ out: sortie || '(aucune sortie)', err: !!r.stderr });
    } catch (e) { lignes.push({ out: e.message, err: true }); }
    peindreTerm();
  }

  function peindreEmpreinte() {
    const e = form.empreinte;
    remplir(zoneEmpreinte, e ? h('div', { class: e.acceptee ? 'empreinte acceptee' : 'empreinte' },
      h('div', { class: 'empreinte-t' }, ic('key', 14), `Clé d'hôte SSH${e.typeCle ? ` (${e.typeCle})` : ''}`),
      h('code', { class: 'coupe', text: e.valeur }),
      e.acceptee
        ? h('div', { class: 'empreinte-aide', text: 'Acceptée : elle sera vérifiée à chaque connexion. Une empreinte différente coupera la liaison.' })
        : [h('div', { class: 'empreinte-aide', text: "Compare-la avec celle que l'équipement affiche lui-même avant de l'accepter : c'est ce qui garantit que tu parles bien à lui." }),
          btn({ solid: true, icone: 'check', onclick: () => { e.acceptee = true; tester(); } }, 'Accepter cette empreinte')]) : '');
  }

  function peindreForm() {
    if (!ouvert) { remplir(zoneForm); return; }
    peindreEmpreinte();
    const saisir = (cle, props = {}) => {
      const el = champ({ value: form[cle], ...props });
      el.addEventListener('input', () => {
        form[cle] = props.type === 'number' ? (parseInt(el.value) || 22) : el.value;
        // Une autre adresse, c'est un autre équipement : sa clé reste à vérifier.
        if ((cle === 'host' || cle === 'port') && form.empreinte) { form.empreinte = null; peindreEmpreinte(); }
      });
      return el;
    };
    const cle = h('textarea', { class: 'field mml', rows: 4, placeholder: '-----BEGIN OPENSSH PRIVATE KEY-----', 'aria-label': 'Clé privée' });
    cle.value = form.privateKey;
    cle.addEventListener('input', () => { form.privateKey = cle.value; });
    remplir(zoneForm, carte({ titre: 'Nouvel équipement' }, pad(
      h('div', { class: 'gform', style: { display: 'grid', gridTemplateColumns: '1fr 1fr 90px 1fr', gap: 12 } },
        h('div', {}, lbl(t('col.name')), saisir('name', { sans: true, 'aria-label': t('col.name') })),
        h('div', {}, lbl('Hôte'), saisir('host', { placeholder: '192.0.2.1', 'aria-label': 'Hôte' })),
        h('div', {}, lbl('Port'), saisir('port', { type: 'number', 'aria-label': 'Port' })),
        h('div', {}, lbl('Compte'), saisir('username', { 'aria-label': 'Compte' }))),
      h('div', { class: 'gform', style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 12 } },
        h('div', {}, lbl('Marque / micrologiciel'), choix(MARQUES, { valeur: form.vendor, surChange: v => { form.vendor = v; }, aria: 'Marque / micrologiciel' })),
        h('div', { class: 'bascules-bas' },
          interrupteur(!!form.useKey, v => { form.useKey = v; peindreForm(); }, 'clé plutôt que mot de passe'),
          interrupteur(!!form.isMainRouter, v => { form.isMainRouter = v; },
            h('span', { title: "Un seul équipement porte ce drapeau : le cocher ici le retire à celui qui l'a aujourd'hui, y compris à un contrôleur configuré dans Équipement réseau.", text: 'équipement principal' })))),
      h('div', { style: { marginTop: 12 } }, !form.useKey
        ? [lbl('Mot de passe'), saisir('password', { type: 'password', 'aria-label': 'Mot de passe', autocomplete: 'new-password' })]
        : [lbl('Clé privée'), cle, h('div', { style: { marginTop: 10 } }, lbl('Phrase de passe (facultative)'), saisir('passphrase', { type: 'password', 'aria-label': 'Phrase de passe', autocomplete: 'off' }))]),
      zoneEmpreinte,
      essai && !essai.aConfirmer ? h('div', { style: { marginTop: 12 } }, note(essai.ok ? 'info' : 'warn', essai.ok ? (essai.banner || 'Connexion établie.') : essai.error)) : null,
      h('div', { class: 'boutons-fin' },
        btn({ onclick: () => { ouvert = false; peindreForm(); } }, t('action.cancel')),
        btn({ icone: 'refresh', onclick: tester }, t('action.test')),
        btn({ solid: true, icone: 'check', onclick: enregistrer }, t('action.save'))))));
  }

  function peindreListe() {
    // Le routeur principal et les consoles partagent la même table côté
    // serveur. Un contrôleur joint par son API locale s'y trouve donc aussi —
    // mais il n'a pas de shell, et le supprimer d'ici effacerait la
    // configuration de la page Équipement réseau. On le signale sans le lister.
    const consoles = liste.filter(estInterrogeable);
    const parApi = liste.filter(d => !estInterrogeable(d));
    remplir(equipements, carte({ titre: t('card.equipment'), note: String(consoles.length) },
      consoles.map(d => h('div', {
        class: choisi?.id === d.id ? 'zrow cliquable choisi' : 'zrow cliquable', role: 'button', tabindex: '0',
        onclick: () => { choisi = d; peindreListe(); peindreTerm(); },
        onkeydown: ev => { if (ev.key === 'Enter') { choisi = d; peindreListe(); peindreTerm(); } },
      }, h('span', { class: 'itile' }, ic(d.isMainRouter ? 'router' : 'switch', 15)),
        h('span', { class: 'zrow-c' }, h('b', { text: d.name }), h('small', { text: `${d.username}@${d.host}:${d.port} · ${d.vendor}` })),
        h('button', { class: 'lnk', type: 'button', title: 'retirer', 'aria-label': `Retirer ${d.name}`, onclick: ev => { ev.stopPropagation(); supprimer(d); } }, '✕'))),
      consoles.length === 0 ? vide('Aucun équipement enregistré', 'ssh') : null,
      // Ce qui est piloté par API n'est pas une console : on le nomme, on
      // explique où il se configure, et on ne propose pas de le retirer.
      parApi.map(d => h('div', { class: 'par-api' },
        h('b', { class: 'moyen', text: d.name }), ' ', h('span', { class: 'mono', text: `(${d.host}:${d.port})` }),
        ' est piloté par son API locale : pas de shell, donc pas de console. Il se modifie et se supprime depuis ',
        h('b', { class: 'moyen', text: 'Équipement réseau' }), '.'))));
  }

  function peindreTerm() {
    titreTerm.textContent = choisi ? `${choisi.username}@${choisi.name} · ${choisi.host}` : t('card.console');
    remplir(relie, choisi ? chip('a', 'relié') : '');
    ligneSaisie.hidden = !choisi;
    remplir(corps,
      !choisi ? h('div', { class: 'dim', text: t('misc.selectLeft') }) : null,
      choisi && lignes.length === 0 ? h('div', { class: 'dim', text: t('misc.outputHere') }) : null,
      ...lignes.map(l => l.cmd
        ? h('div', {}, h('span', { class: 'pr', text: '$' }), ` ${l.cmd}`)
        : h('div', { class: l.err ? 'out err' : 'out', text: l.out })));
    corps.scrollTop = corps.scrollHeight;
  }

  peindreListe(); peindreTerm(); charger();
  return page({
    titre: t('page.ssh.title'), lede: t('page.ssh.lede'),
    actions: btn({ solid: true, icone: 'plus', onclick: () => { ouvert = !ouvert; peindreForm(); } }, t('act.addDevice')),
  },
  note('warn', t('misc.sshWarn'), ' Celles qui enchaînent plusieurs instructions sont refusées avant l’envoi. ',
    h('b', { class: 'moyen', text: 'clear' }), " fait exception : il efface l'écran ici et n'est pas envoyé — sans terminal en face, l'équipement n'en ferait rien."),
  zoneForm,
  split('s300',
    equipements,
    // Hauteur fixe, pas « au plus » : sinon le panneau grandit à chaque sortie
    // et c'est la page entière qui descend. Un terminal garde sa taille et fait
    // défiler son contenu ; la ligne de saisie est cousue en bas.
    h('div', { class: 'term console' },
      h('div', { class: 'termhead' }, h('span', { class: 'dots' }, h('i'), h('i'), h('i')), titreTerm, relie),
      corps, ligneSaisie)));
}

export function pageHote(p) {
  const sec = h('section', { class: 'page on' });
  let histo = [];
  const lire = () => api.get('/api/host/history?minutes=60').then(r => { histo = r || []; peindre(); }).catch(() => { /* courbes vides jusqu'à la lecture suivante */ });
  function peindre() {
    const hs = E.hostStats;
    const tete = entete({ titre: t('page.host.title'), lede: t('page.host.lede') });
    if (!hs) { remplir(sec, tete, carte({}, vide(t('misc.loading'), 'server'))); return; }
    const cpu = histo.map(x => Number(x.cpuPct) || 0);
    const mem = histo.map(x => Number(x.memPct) || 0);
    const interfaces = hs.interfaces || [];
    // La liste des conteneurs n'est pas ici : cette page dit dans quel état est
    // la machine. La collecte continue, le dock de l'atelier s'en sert.
    remplir(sec, tete,
      figs(
        fig({ icone: 'chip', libelle: t('fig.cpu'), valeur: Math.round(hs.cpuPct), unite: ' %',
          delta: `${hs.cores || '?'} cœurs · ${Number(hs.loadAvg || 0).toFixed(2)} de charge`,
          courbe: cpu.length > 1 ? courbe(cpu, hs.cpuPct > 80 ? 'alarm' : 'accent') : undefined }),
        fig({ icone: 'server', ton: 'plain', libelle: t('fig.memory'), valeur: fmtOctets(hs.memUsedMB), delta: `sur ${fmtOctets(hs.memTotalMB)}`,
          courbe: mem.length > 1 ? courbe(mem, 'accent') : undefined }),
        fig({ icone: 'switch', ton: hs.diskPct > 90 ? 'warn' : undefined, libelle: t('fig.disk'), valeur: Math.round(hs.diskPct), unite: ' %',
          delta: hs.diskFreeGB != null ? `${Math.round(hs.diskFreeGB)} Gio libres` : '—' }),
        fig({ icone: 'clock', libelle: t('fig.uptime'), valeur: fmtUptime(hs.uptimeSec), delta: hs.tempC != null ? `${hs.tempC} °C` : '—' })),
      carte({ titre: t('card.ifaces'), note: 'de la machine' },
        h('table', {},
          h('thead', {}, h('tr', {}, h('th', { text: t('col.iface') }), h('th', { text: t('col.address') }), h('th', { class: 'cache-s', text: t('col.role') }))),
          h('tbody', {}, interfaces.map(n => h('tr', {},
            h('td', { class: 'mono' }, h('b', { class: 'moyen', text: n.name })),
            h('td', { class: 'mono principal tronque', text: n.address || n.ip || '—' }),
            h('td', { class: 'dim cache-s', text: n.role || (n.internal ? 'boucle locale' : 'balayage') }))))),
        interfaces.length === 0 ? vide('Interfaces non remontées', 'wired') : null,
        pad(h('div', { class: 'explication petite', text: t('misc.scanIface') }))),
      carte({ titre: t('card.history'), note: '60 dernières minutes' },
        pad(h('div', { class: 'histo-deux' },
          h('div', {}, h('span', { class: 'lbl', text: 'processeur' }), cpu.length > 1 ? courbe(cpu, 'accent', true) : h('div', { class: 'dim', text: "pas encore d'historique" })),
          h('div', {}, h('span', { class: 'lbl', text: 'mémoire' }), mem.length > 1 ? courbe(mem, 'accent', true) : h('div', { class: 'dim', text: "pas encore d'historique" }))))));
  }
  p.suivre('hostStats', peindre);
  p.intervalle(lire, 30000);
  peindre();
  lire();
  return sec;
}

//
// L'inventaire n'a pas de contrepartie côté serveur : il vit dans le
// navigateur. C'est assumé et affiché — le jour où une route existe, seules
// les deux fonctions de lecture et d'écriture changent.

const CLE_INV = 'mapmylan_inventaire';
const FAMILLES = [
  { id: 'cable', nom: 'Câble', icone: 'wired', champs: [['categorie', 'Catégorie'], ['longueur', 'Longueur'], ['couleur', 'Couleur']] },
  { id: 'module', nom: 'Module optique', icone: 'port', champs: [['debit', 'Débit'], ['portee', 'Portée'], ['connecteur', 'Connecteur']] },
  { id: 'actif', nom: 'Équipement actif', icone: 'switch', champs: [['ports', 'Ports'], ['alim', 'Alimentation']] },
  { id: 'prise', nom: 'Prise / goulotte', icone: 'plug', champs: [['format', 'Format'], ['montage', 'Montage']] },
  { id: 'divers', nom: 'Divers', icone: 'unknown', champs: [['detail', 'Détail']] },
];
const famDe = id => FAMILLES.find(f => f.id === id) || FAMILLES[FAMILLES.length - 1];

function lireInventaire() {
  try { const brut = localStorage.getItem(CLE_INV); return brut ? JSON.parse(brut) : []; }
  catch { return []; }
}
const FORM_INV = () => ({ nom: '', famille: 'cable', zone: '', pose: 0, reserve: 0, seuil: 2, specs: {} });

export function pageInventaire() {
  let refs = lireInventaire(), famille = 'all', ouvert = false, form = FORM_INV();
  const sec = h('section', { class: 'page on' });
  const sauver = l => { refs = l; ecrireLocal(CLE_INV, JSON.stringify(l)); peindre(); };
  const ajouter = () => {
    if (!form.nom.trim()) return;
    sauver([...refs, { ...form, id: `r${Date.now().toString(36)}`, pose: Number(form.pose) || 0, reserve: Number(form.reserve) || 0, seuil: Number(form.seuil) || 0 }]);
    ouvert = false; form = FORM_INV(); peindre();
  };
  const bouger = (id, champNom, delta) => sauver(refs.map(r => (r.id === id ? { ...r, [champNom]: Math.max(0, r[champNom] + delta) } : r)));
  const supprimer = async r => {
    if (!await confirmer(t('misc.confirmDelete', { name: r.nom }), '', { danger: true, oui: t('action.delete') })) return;
    sauver(refs.filter(x => x.id !== r.id));
  };

  const formulaire = () => {
    const saisir = (cle, props = {}) => {
      const el = champ({ value: form[cle], ...props });
      el.addEventListener('input', () => { form[cle] = el.value; });
      return el;
    };
    const specs = h('div', { class: 'gform', style: { display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12, marginTop: 12 } });
    const peindreSpecs = () => remplir(specs, ...famDe(form.famille).champs.map(([cle, nom]) => {
      const el = champ({ sans: true, value: form.specs[cle] || '', 'aria-label': nom });
      el.addEventListener('input', () => { form.specs = { ...form.specs, [cle]: el.value }; });
      return h('div', {}, lbl(nom), el);
    }));
    peindreSpecs();
    return carte({ titre: 'Nouvelle référence' }, pad(
      h('div', { class: 'gform', style: { display: 'grid', gridTemplateColumns: '1.4fr 1fr 1fr', gap: 12 } },
        h('div', {}, lbl(t('col.name')), saisir('nom', { sans: true, placeholder: 'Cordon RJ45 2 m', 'aria-label': t('col.name') })),
        h('div', {}, lbl('Famille'), choix(FAMILLES.map(f => [f.id, f.nom]), { valeur: form.famille, aria: 'Famille', surChange: v => { form.famille = v; form.specs = {}; peindreSpecs(); } })),
        h('div', {}, lbl(t('col.zone')), saisir('zone', { sans: true, placeholder: 'Baie, bureau…', 'aria-label': t('col.zone') }))),
      specs,
      h('div', { class: 'gform', style: { display: 'grid', gridTemplateColumns: 'repeat(3,110px) 1fr auto', gap: 12, marginTop: 12, alignItems: 'end' } },
        h('div', {}, lbl(t('col.placed')), saisir('pose', { type: 'number', 'aria-label': t('col.placed') })),
        h('div', {}, lbl(t('col.spare')), saisir('reserve', { type: 'number', 'aria-label': t('col.spare') })),
        h('div', {}, lbl('Seuil'), saisir('seuil', { type: 'number', 'aria-label': 'Seuil' })),
        h('span'),
        btn({ solid: true, icone: 'check', onclick: ajouter }, t('action.add')))));
  };

  const compteur = (r, cle, classe = '') => h('td', { class: `mono droite nowrap ${classe}` },
    h('button', { class: 'lnk', type: 'button', 'aria-label': 'moins', onclick: () => bouger(r.id, cle, -1) }, '−'),
    String(r[cle]),
    h('button', { class: 'lnk', type: 'button', 'aria-label': 'plus', onclick: () => bouger(r.id, cle, 1) }, '+'));

  function peindre() {
    const listees = famille === 'all' ? refs : refs.filter(r => r.famille === famille);
    const pose = refs.reduce((n, r) => n + r.pose, 0);
    const reserve = refs.reduce((n, r) => n + r.reserve, 0);
    const aCommander = refs.filter(r => r.reserve <= r.seuil);
    const zones = [...new Set(refs.map(r => r.zone).filter(Boolean))];
    remplir(sec,
      entete({
        titre: t('page.inventory.title'),
        lede: `${t('page.inventory.lede')} Cet inventaire est enregistré dans ce navigateur, pas sur le serveur.`,
        actions: btn({ solid: true, icone: 'plus', onclick: () => { ouvert = !ouvert; peindre(); } }, t('act.addRef')),
      }),
      figs(
        fig({ icone: 'devices', libelle: t('fig.refs'), valeur: refs.length, delta: `${zones.length} zone(s)` }),
        fig({ icone: 'wired', ton: 'plain', libelle: t('fig.placed'), valeur: pose, delta: 'en service' }),
        fig({ icone: 'switch', libelle: t('fig.spare'), valeur: reserve, delta: 'disponibles' }),
        fig({ icone: 'alert', ton: aCommander.length ? 'warn' : undefined, libelle: t('fig.restock'), valeur: aCommander.length, delta: aCommander[0]?.nom || 'rien à commander' })),
      ouvert ? formulaire() : null,
      split('s300d',
        carte({
          titre: 'Références',
          tete: h('div', { class: 'filtres' },
            h('button', { class: famille === 'all' ? 'ftr on' : 'ftr', type: 'button', onclick: () => { famille = 'all'; peindre(); } }, t('misc.all')),
            FAMILLES.map(f => h('button', { class: famille === f.id ? 'ftr on' : 'ftr', type: 'button', onclick: () => { famille = f.id; peindre(); } }, f.nom))),
        },
        h('table', { id: 'inv-tb' },
          h('thead', {}, h('tr', {}, h('th', { text: t('col.ref') }), h('th', { class: 'cache-l', text: t('col.specs') }), h('th', { class: 'cache-m', text: t('col.zone') }),
            h('th', { class: 'droite', text: t('col.placed') }), h('th', { class: 'droite cache-s', text: t('col.spare') }), h('th', { class: 'cache-m', text: t('col.state') }), h('th'))),
          h('tbody', {}, listees.map(r => {
            const f = famDe(r.famille);
            const bas = r.reserve <= r.seuil;
            return h('tr', {},
              h('td', { class: 'principal' }, whoCell({ icone: ic(f.icone, 15), nom: r.nom, sous: f.nom })),
              h('td', { class: 'cache-l' }, h('div', { class: 'specs' }, Object.entries(r.specs || {}).filter(([, v]) => v).map(([k, v]) => h('span', { class: 'sp', text: v, dataset: { k } })))),
              h('td', { class: 'dim cache-m', text: r.zone || '—' }),
              compteur(r, 'pose'),
              compteur(r, 'reserve', 'cache-s'),
              h('td', { class: 'cache-m' }, chip(bas ? 'w' : 'a', bas ? 'à recompléter' : 'suffisant')),
              h('td', { class: 'droite' }, h('button', { class: 'lnk', type: 'button', 'aria-label': `Supprimer ${r.nom}`, onclick: () => supprimer(r) }, '✕')));
          }))),
        listees.length === 0 ? vide('Aucune référence', 'switch') : null),
        h('div', {},
          carte({ titre: 'Zones', note: 'regroupement', classe: 'avec-marge' },
            zones.map(z => h('div', { class: 'zrow' }, h('span', { class: 'ivig' }, ic('map', 14)),
              h('span', { class: 'zrow-c' }, h('b', { text: z }), h('small', { text: `${refs.filter(r => r.zone === z).length} référence(s)` })))),
            zones.length === 0 ? pad(h('div', { class: 'explication haut', text: 'Nomme une zone sur une référence et elle apparaîtra ici.' })) : null),
          carte({ titre: 'À recompléter', note: 'sous le seuil' },
            aCommander.map(r => h('div', { class: 'zrow' }, h('span', { class: 'ivig' }, ic('alert', 14)),
              h('span', { class: 'zrow-c' }, h('b', { text: r.nom }), h('small', { text: `${r.reserve} en réserve · seuil ${r.seuil}` })))),
            aCommander.length === 0 ? pad(h('div', { class: 'explication haut', text: 'Rien à commander.' })) : null))));
  }
  peindre();
  return sec;
}

export function pageBot() {
  let liste = [], actions = [], reponse = null;
  const zoneListe = h('div');
  const compte = h('span', { class: 'note' });
  const charger = async () => {
    try {
      [liste, actions] = await Promise.all([api.get('/api/bot-commands'), api.get('/api/bot-commands/actions')]);
    } catch (e) { toast(e.message, true); }
    peindre();
  };
  const essayer = async c => {
    try { const r = await api.post(`/api/bot-commands/${c.id}/run`, { args: [] }); reponse = { id: c.id, texte: r.reply }; }
    catch (e) { reponse = { id: c.id, texte: e.message, brut: true }; }
    peindre();
  };
  const basculer = async (c, enabled) => { try { await api.patch(`/api/bot-commands/${c.id}`, { enabled }); } catch (e) { toast(e.message, true); } charger(); };
  const supprimer = async c => {
    if (!await confirmer(t('misc.confirmDelete', { name: c.trigger }), '', { danger: true, oui: t('action.delete') })) return;
    try { await api.del(`/api/bot-commands/${c.id}`); } catch (e) { toast(e.message, true); }
    charger();
  };
  function peindre() {
    compte.textContent = `${liste.length} · ${actions.length} actions disponibles`;
    remplir(zoneListe, ...liste.map(c => {
      const a = actions.find(x => x.id === c.action);
      return h('div', {},
        h('div', { class: 'flowrow regle' },
          bascule(!!c.enabled, v => basculer(c, v), { aria: c.trigger }),
          h('span', { class: 'cmd', text: c.trigger }),
          h('div', {}, h('strong', { text: a?.label || c.action }),
            h('div', { class: 'chain' },
              c.description ? h('span', { text: c.description }) : null,
              c.confirm ? h('span', { class: 'ar', text: '· confirmation exigée' }) : null,
              a?.destructive ? h('span', { class: 'alarme', text: '· destructif' }) : null,
              c.cooldownSec > 0 ? h('span', { class: 'ar', text: `· pause ${c.cooldownSec} s` }) : null)),
          h('div', { class: 'stat' }, h('b', { text: `${c.fireCount || 0} appel(s)` }),
            h('span', { class: 'liens' },
              h('button', { class: 'lnk', type: 'button', onclick: () => essayer(c) }, t('action.test')),
              h('button', { class: 'lnk', type: 'button', onclick: () => editeurBot({ ...c, isNew: false }, actions, charger) }, t('action.edit')),
              h('button', { class: 'lnk', type: 'button', onclick: () => supprimer(c) }, t('action.delete'))))),
        // La réponse du bot est du texte mis en forme pour la messagerie : on en
        // reprend le gras et le code, jamais d'autre balise.
        reponse?.id === c.id ? pad(h('div', { class: 'termbody reponse-bot' }, reponse.brut ? reponse.texte : texteTelegram(reponse.texte))) : null);
    }), liste.length === 0 ? vide('Aucune commande définie', 'bot') : '');
  }
  charger();
  return page({
    titre: t('page.bot.title'), lede: t('page.bot.lede'),
    actions: btn({ solid: true, icone: 'plus', onclick: () => editeurBot({
      isNew: true, trigger: '/', description: '', action: actions[0]?.id || 'status', params: {}, enabled: true, confirm: false, allowedChatIds: [], cooldownSec: 0,
    }, actions, charger) }, t('act.newCommand')),
  }, carte({ titre: t('card.commands'), tete: compte }, zoneListe));
}

function editeurBot(commande, actions, apres) {
  const v = {
    trigger: commande.trigger || '/', description: commande.description || '', action: commande.action || 'status',
    params: { ...(commande.params || {}) }, enabled: commande.enabled !== false, confirm: commande.confirm === true,
    chats: (commande.allowedChatIds || []).join(', '), pause: commande.cooldownSec || 0,
  };
  panneau({ titre: commande.isNew ? 'Nouvelle commande' : commande.trigger, sous: 'déclenchée depuis la messagerie' }, fermer => {
    const zoneAction = h('div');
    const bConfirm = h('span');
    const peindreAction = () => {
      const sel = actions.find(a => a.id === v.action);
      if (sel?.destructive) v.confirm = true;
      remplir(zoneAction,
        sel?.destructive ? h('div', { style: { marginTop: 10 } }, note('warn', 'Action destructrice : la confirmation est imposée.')) : null,
        ...(sel?.params || []).filter(q => q.fromConfig).map(q => {
          const el = champ({ value: v.params[q.name] || '', 'aria-label': q.name });
          el.addEventListener('input', () => { v.params = { ...v.params, [q.name]: el.value }; });
          return h('div', { style: { marginTop: 14 } }, lbl(`${q.name}${q.required ? ' *' : ''}`), el);
        }));
      remplir(bConfirm, interrupteur(v.confirm, x => { if (!sel?.destructive) v.confirm = x; else peindreAction(); }, 'confirmation'));
    };
    const saisir = (cle, props = {}) => {
      const el = champ({ value: v[cle], ...props });
      el.addEventListener('input', () => { v[cle] = props.type === 'number' ? (parseInt(el.value) || 0) : el.value; });
      return el;
    };
    peindreAction();
    const enregistrer = async () => {
      if (!v.trigger || v.trigger === '/') { toast('Donne un appel, par exemple /etat', true); return; }
      const donnees = {
        trigger: v.trigger, description: v.description, action: v.action, params: v.params, enabled: v.enabled, confirm: v.confirm,
        allowedChatIds: v.chats.split(',').map(x => x.trim()).filter(Boolean), cooldownSec: v.pause || 0,
      };
      try {
        if (commande.isNew) await api.post('/api/bot-commands', donnees);
        else await api.patch(`/api/bot-commands/${commande.id}`, donnees);
        fermer(); apres();
      } catch (e) { toast(e.message, true); }
    };
    return [
      h('div', { class: 'gform', style: { display: 'grid', gridTemplateColumns: '120px 1fr', gap: 12 } },
        h('div', {}, lbl('Appel'), saisir('trigger', { 'aria-label': 'Appel' })),
        h('div', {}, lbl('Description'), saisir('description', { sans: true, 'aria-label': 'Description' }))),
      h('div', { style: { marginTop: 14 } }, lbl('Action'),
        choix(actions.map(a => [a.id, `${a.destructive ? '⚠ ' : ''}${a.label} — ${a.id}`]), { valeur: v.action, aria: 'Action', surChange: x => { v.action = x; peindreAction(); } }),
        zoneAction),
      h('div', { class: 'gform', style: { display: 'grid', gridTemplateColumns: '120px 1fr', gap: 12, marginTop: 14 } },
        h('div', {}, lbl('Pause (s)'), saisir('pause', { type: 'number', 'aria-label': 'Pause (s)' })),
        h('div', {}, lbl('Discussions autorisées'), saisir('chats', { placeholder: 'vide = discussion principale', 'aria-label': 'Discussions autorisées' }))),
      h('div', { class: 'ligne-bascules' }, interrupteur(v.enabled, x => { v.enabled = x; }, 'active'), bConfirm),
      h('div', { class: 'fboutons' }, btn({ onclick: fermer }, t('action.cancel')), btn({ solid: true, icone: 'check', onclick: enregistrer }, t('action.save'))),
    ];
  });
}
