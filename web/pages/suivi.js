// Suivi — notifications, journal, rapports.
import { confirmer, toast } from '/socle/compte.js';
import { h, ic, panneau, entete, page, figs, fig, carte, split, btn, chip, bascule, notice, vide, note, champ, lbl, choix, interrupteur, telecharger, remplir } from '../dom.js';
import { E, api, rafraichirAlertes } from '../etat.js';
import { t } from '../i18n.js';
import { fmtDate, depuis, nomAppareil } from '../communs.js';

// Les canaux d'alerte. Le SMS n'en fait plus partie depuis la 2.0 ; la
// billetterie envoie chaque alerte comme un ticket structuré.
const CANAUX = ['telegram', 'email', 'billetterie'];

const CHAMPS = {
  telegram: [['token', 'Jeton du bot'], ['chatId', 'Identifiant de discussion']],
  email: [['provider', 'Fournisseur'], ['address', 'Adresse'], ['password', "Mot de passe d'application"]],
  billetterie: [['url', 'URL'], ['cle', 'Clé'], ['entete', 'En-tête (facultatif)'], ['marqueur', 'Marqueur (facultatif)'], ['seuil', 'Seuil (p1 à p4)']],
};
const SECRETS = new Set(['token', 'password', 'cle']);
// Le serveur n'admet que ces fournisseurs : une saisie libre serait refusée.
const FOURNISSEURS = [['gmail', 'Gmail'], ['outlook', 'Outlook'], ['apple', 'Apple'], ['autre', 'Autre']];

const couleurActe = k => (k === 'ban' ? 'var(--alarm)' : k === 'quarantine' ? 'var(--warn)' : 'var(--accent)');

export function pageNotifications(p) {
  let canaux = [], commandes = [], declencheurs = [], canalEdite = null;
  const admin = E.moi?.role === 'admin';
  const sec = h('section', { class: 'page on' });
  const recharger = async () => {
    try {
      [canaux, commandes, declencheurs] = await Promise.all([api.get('/api/notifications'), api.get('/api/commands'), api.get('/api/commands/triggers')]);
    } catch (e) { toast(e.message, true); }
    peindre();
  };
  const actifs = () => canaux.filter(n => n.enabled).map(n => n.channel);
  const agir = fn => async () => { try { await fn(); } catch (e) { toast(e.message, true); } };

  const basculer = (id, enabled) => agir(async () => { await api.patch(`/api/commands/${id}`, { enabled }); recharger(); })();
  const supprimer = async c => {
    if (!await confirmer(t('misc.confirmDelete', { name: c.name }), '', { danger: true, oui: t('action.delete') })) return;
    agir(async () => { await api.del(`/api/commands/${c.id}`); recharger(); })();
  };
  const declencher = async c => {
    if (!await confirmer(`Déclencher « ${c.name} » maintenant, à titre d'essai ?`, '', { oui: 'Déclencher' })) return;
    // Adresse de documentation : aucun hôte réel n'est désigné par cet essai.
    agir(async () => {
      await api.post(`/api/commands/${c.id}/fire`, { vars: { test: true, ip: '192.0.2.42', name: 'hôte-exemple', score: 88 } });
      toast('Commande déclenchée — vérifie le canal concerné.');
    })();
  };
  const acquitter = a => agir(async () => { await api.post(`/api/alerts/${a.id}/ack`); await rafraichirAlertes(); })();
  const acquitterTout = agir(async () => {
    await Promise.allSettled(E.alerts.filter(a => !a.acknowledged).map(a => api.post(`/api/alerts/${a.id}/ack`)));
    await rafraichirAlertes();
  });
  const nouvelle = () => editeurCommande({
    isNew: true, name: '', trigger: declencheurs[0]?.id || 'device.new',
    actions: [{ kind: 'notify', channels: actifs().slice(0, 1) }], template: '', cooldownSec: 0, enabled: true, filter: null,
  }, declencheurs, actifs(), recharger);

  function peindre() {
    const enAttente = E.alerts.filter(a => !a.acknowledged).length;
    const parId = Object.fromEntries(declencheurs.map(d => [d.id, d]));
    const act = actifs();
    remplir(sec,
      entete({
        titre: t('page.notifications.title'), lede: t('page.notifications.lede'),
        actions: [
          btn({ icone: 'check', onclick: acquitterTout, disabled: !enAttente, classe: 'cache-s' }, t('act.markAllRead')),
          btn({ solid: true, icone: 'plus', onclick: nouvelle }, t('act.newCommand')),
        ],
      }),
      carte({ titre: t('card.channels'), note: `${act.length} actif(s)` },
        h('div', { class: 'pad serre' },
          h('div', { class: 'canaux' }, CANAUX.map(ch => {
            const cfg = canaux.find(n => n.channel === ch);
            const etat = !cfg?.enabled ? 'off' : cfg.lastSuccess ? 'on' : 'pending';
            // Les réglages d'un canal ne s'ouvrent qu'à l'administrateur : le
            // serveur les refuserait aux autres, et chaque refus irait au journal.
            return h('button', { class: 'canal', type: 'button', disabled: !admin, 'aria-pressed': String(canalEdite === ch), onclick: () => { canalEdite = canalEdite === ch ? null : ch; peindre(); } },
              chip(etat === 'on' ? 'a' : etat === 'pending' ? 'w' : undefined, [h('i', { class: `d ${etat}` }), ch]));
          })),
          // L'explication se lit sous les pastilles, à côté de ce qu'elle décrit.
          admin ? h('div', { class: 'aide', text: 'Clique un canal pour saisir ou remplacer ses identifiants.' }) : null,
          canalEdite ? editeurCanal(canalEdite, () => { canalEdite = null; peindre(); }, async () => { canalEdite = null; await recharger(); }) : null)),
      split('',
        carte({ titre: t('card.commands'), note: `${commandes.length}` },
          commandes.map(c => {
            const d = parId[c.trigger];
            const actes = Array.isArray(c.actions) ? c.actions : [];
            return h('div', { class: 'flowrow regle' },
              bascule(!!c.enabled, v => basculer(c.id, v), { aria: c.name }),
              h('span', { class: 'itile cache-s' }, ic('bell', 15)),
              h('div', {}, h('strong', { text: c.name }),
                h('div', { class: 'chain' },
                  h('span', { text: d?.label || c.trigger }), h('span', { class: 'ar', text: '→' }),
                  actes.map((a, i) => h('span', { style: { color: couleurActe(a.kind) } },
                    a.kind === 'notify' ? `prévenir [${(a.channels || []).join(', ')}]` : a.kind, i < actes.length - 1 ? ' + ' : '')),
                  c.cooldownSec > 0 ? h('span', { class: 'ar', text: `· pause ${c.cooldownSec} s` }) : null)),
              h('div', { class: 'stat' }, h('b', { text: `${c.fireCount || 0} envoi(s)` }),
                h('span', { class: 'liens' },
                  h('button', { class: 'lnk', type: 'button', onclick: () => declencher(c) }, t('action.test')),
                  h('button', { class: 'lnk', type: 'button', onclick: () => editeurCommande({ ...c, isNew: false }, declencheurs, actifs(), recharger) }, t('action.edit')),
                  h('button', { class: 'lnk', type: 'button', onclick: () => supprimer(c) }, t('action.delete')))));
          }),
          commandes.length === 0 ? vide('Aucune commande — « quand ceci, fais cela »', 'bell') : null),
        carte({ titre: 'Reçues', note: `${enAttente} en attente` },
          E.alerts.slice(0, 12).map(a => notice({
            icone: a.severity === 'critical' || a.severity === 'high' ? 'alert' : 'bell',
            ton: a.severity === 'critical' || a.severity === 'high' ? 'hot' : undefined,
            quand: [`${a.source || 'système'} · ${depuis(a.createdAt)}`,
              !a.acknowledged ? [' · ', h('button', { class: 'lnk', type: 'button', onclick: () => acquitter(a) }, 'marquer comme lu')] : null],
          }, a.message)),
          E.alerts.length === 0 ? vide(t('misc.calm'), 'check') : null)));
  }
  p.suivre('alerts', peindre);
  peindre();
  recharger();
  return sec;
}

function editeurCanal(canal, surFerme, surEnregistre) {
  const config = {};
  const resultat = h('div');
  const bTester = btn({ icone: 'refresh' }, t('action.test'));
  const bEnreg = btn({ solid: true, icone: 'check' }, t('action.save'));
  const occuper = v => { bTester.disabled = v; bEnreg.disabled = v; };
  // Un champ vide n'est pas envoyé : le serveur garde alors ce qui est en place.
  const aEnvoyer = () => Object.fromEntries(Object.entries(config).filter(([, v]) => v !== ''));
  bEnreg.addEventListener('click', async () => {
    occuper(true);
    try { await api.put(`/api/notifications/${canal}`, { enabled: true, config: aEnvoyer() }); await surEnregistre(); }
    catch (e) { toast(e.message, true); }
    finally { occuper(false); }
  });
  bTester.addEventListener('click', async () => {
    occuper(true); remplir(resultat);
    let r;
    try { r = await api.post(`/api/notifications/${canal}/test`, { config: aEnvoyer() }); } catch (e) { r = { ok: false, error: e.message }; }
    remplir(resultat, h('div', { style: { marginTop: 12 } }, note(r.ok ? 'info' : 'warn', r.ok ? "Message d'essai envoyé." : r.error)));
    occuper(false);
  });
  const couper = async () => {
    try { await api.put(`/api/notifications/${canal}`, { enabled: false, config: {} }); await surEnregistre(); } catch (e) { toast(e.message, true); }
  };
  const champs = (CHAMPS[canal] || []).map(([cle, nom]) => {
    const el = cle === 'provider'
      ? h('select', { class: 'field mml', 'aria-label': nom }, h('option', { value: '' }, '—'), FOURNISSEURS.map(([v, l]) => h('option', { value: v }, l)))
      : champ({ type: SECRETS.has(cle) ? 'password' : 'text', placeholder: 'ressaisir pour remplacer', 'aria-label': nom, autocomplete: 'off' });
    el.addEventListener(cle === 'provider' ? 'change' : 'input', () => { config[cle] = el.value; });
    return { cle, el, noeud: h('div', {}, lbl(nom), el) };
  });
  // Ce qui est déjà réglé : les champs ordinaires reviennent tels quels, un
  // secret ne revient jamais — on dit seulement qu'il est en place.
  api.get(`/api/notifications/${canal}`).then(r => {
    for (const c of champs) {
      if (SECRETS.has(c.cle)) { if (r?.secrets?.[c.cle]) c.el.placeholder = 'en place — laisser vide pour le garder'; }
      else if (r?.config?.[c.cle] != null && !c.el.value) { c.el.value = String(r.config[c.cle]); config[c.cle] = c.el.value; }
    }
  }).catch(() => { /* canal jamais réglé : on part d'un formulaire vide */ });
  return h('div', { class: 'editeur-canal' },
    h('div', { class: 'gform', style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 } }, champs.map(c => c.noeud)),
    resultat,
    h('div', { class: 'boutons-fin' },
      h('button', { class: 'lnk', type: 'button', onclick: couper }, 'désactiver'),
      btn({ onclick: surFerme }, t('action.cancel')), bTester, bEnreg));
}

const ACTES = [
  { k: 'notify', l: 'prévenir' }, { k: 'log', l: 'consigner' }, { k: 'quarantine', l: 'isoler' },
  { k: 'ban', l: 'bloquer' }, { k: 'exec_ssh', l: 'commande SSH' },
];

function editeurCommande(commande, declencheurs, actifs, apres) {
  const v = {
    nom: commande.name || '', decl: commande.trigger || 'device.new',
    actes: (commande.actions || [{ kind: 'notify', channels: actifs.slice(0, 1) }]).map(a => ({ ...a })),
    modele: commande.template || '', pause: commande.cooldownSec || 0, active: commande.enabled !== false, recherche: '',
  };
  panneau({ titre: commande.isNew ? 'Nouvelle commande' : commande.name, sous: 'quand ceci se produit, fais cela', largeur: 520 }, fermer => {
    const liste = h('div', { class: 'declencheurs' });
    const variables = h('div');
    const zoneActes = h('div');
    const peindreDecl = () => {
      const groupes = {};
      for (const d of declencheurs) {
        const cat = d.category || 'Autres';
        if (v.recherche && !`${d.id} ${d.label} ${cat}`.toLowerCase().includes(v.recherche.toLowerCase())) continue;
        (groupes[cat] ||= []).push(d);
      }
      remplir(liste, ...Object.keys(groupes).map(cat => h('div', {}, h('div', { class: 'secttl', text: cat }),
        groupes[cat].map(d => h('button', { class: v.decl === d.id ? 'trow sel' : 'trow', type: 'button', title: d.label || d.nom || undefined, 'data-donnee': '', onclick: () => { v.decl = d.id; peindreDecl(); } },
          h('span', { class: 'nm2', text: d.label }), h('span', { class: 'ipx2', text: d.id }))))));
      const choisi = declencheurs.find(d => d.id === v.decl);
      remplir(variables, choisi?.vars?.length ? h('div', { class: 'variables', text: `variables : ${choisi.vars.map(x => `{{${x}}}`).join(' · ')}` }) : '');
    };
    const peindreActes = () => remplir(zoneActes, ...v.actes.map((a, i) => {
      const maj = patch => { Object.assign(v.actes[i], patch); peindreActes(); };
      const saisie = (cle, placeholder, props = {}) => {
        const el = champ({ value: a[cle] || '', placeholder, 'aria-label': placeholder, ...props });
        el.addEventListener('input', () => { v.actes[i][cle] = el.value; });
        return el;
      };
      return h('div', { class: 'acte' },
        h('div', { class: 'acte-tete' }, h('b', { class: 'mono', text: a.kind }),
          h('button', { class: 'lnk pousse', type: 'button', onclick: () => { v.actes.splice(i, 1); peindreActes(); } }, 'retirer')),
        a.kind === 'notify' ? h('div', { class: 'acte-canaux' }, CANAUX.map(ch => {
          const coche = (a.channels || []).includes(ch), dispo = actifs.includes(ch);
          return h('button', { class: coche ? 'ftr on' : 'ftr', type: 'button', disabled: !dispo, style: { opacity: dispo ? 1 : 0.45 },
            onclick: () => maj({ channels: coche ? (a.channels || []).filter(x => x !== ch) : [...(a.channels || []), ch] }) }, ch);
        })) : null,
        a.kind === 'log' ? h('div', { class: 'acte-ligne' }, choix(['info', 'warn', 'error', 'success'], { valeur: a.level || 'info', aria: 'Niveau', surChange: x => { v.actes[i].level = x; } })) : null,
        a.kind === 'ban' ? h('div', { class: 'acte-ligne' }, saisie('reason', 'motif consigné', { sans: true })) : null,
        a.kind === 'exec_ssh' ? h('div', { class: 'acte-ssh' }, saisie('deviceId', 'id équipement'), saisie('cmd', 'commande')) : null);
    }));
    const recherche = champ({ sans: true, placeholder: 'filtrer les déclencheurs…', 'aria-label': 'filtrer les déclencheurs' });
    recherche.addEventListener('input', () => { v.recherche = recherche.value; peindreDecl(); });
    const nom = champ({ sans: true, value: v.nom, placeholder: 'Prévenir sur un nouvel objet connecté', 'aria-label': t('col.name') });
    nom.addEventListener('input', () => { v.nom = nom.value; });
    const modele = h('textarea', { class: 'field mml', rows: 3, placeholder: 'Nouvel appareil {{name}} ({{ip}}) chez {{vendor}}.', 'aria-label': 'Message' });
    modele.value = v.modele;
    modele.addEventListener('input', () => { v.modele = modele.value; });
    const pause = champ({ type: 'number', value: v.pause, 'aria-label': 'Pause (s)' });
    pause.addEventListener('input', () => { v.pause = parseInt(pause.value) || 0; });
    peindreDecl(); peindreActes();
    const enregistrer = async () => {
      if (!v.nom.trim()) { toast('Donne un nom à la commande.', true); return; }
      if (v.actes.length === 0) { toast('Ajoute au moins une action.', true); return; }
      const donnees = { name: v.nom, trigger: v.decl, actions: v.actes, template: v.modele || null, cooldownSec: v.pause || 0, enabled: v.active, filter: null };
      try {
        if (commande.isNew) await api.post('/api/commands', donnees);
        else await api.patch(`/api/commands/${commande.id}`, donnees);
        fermer(); apres();
      } catch (e) { toast(e.message, true); }
    };
    return [
      lbl(t('col.name')), nom,
      h('div', { class: 'ftitre marge', text: '1 · quand' }), recherche, liste, variables,
      h('div', { class: 'ftitre marge', text: '2 · fais' }), zoneActes,
      h('div', { class: 'ajouts' }, ACTES.map(a => h('button', { class: 'ftr', type: 'button', onclick: () => {
        v.actes.push(a.k === 'notify' ? { kind: 'notify', channels: actifs.slice(0, 1) }
          : a.k === 'log' ? { kind: 'log', level: 'info' }
            : a.k === 'ban' ? { kind: 'ban', reason: '' }
              : a.k === 'exec_ssh' ? { kind: 'exec_ssh', deviceId: '', cmd: '' }
                : { kind: a.k });
        peindreActes();
      } }, `+ ${a.l}`))),
      h('div', { class: 'ftitre marge', text: '3 · message' }), modele,
      h('div', { class: 'gform', style: { display: 'grid', gridTemplateColumns: '140px 1fr', gap: 12, marginTop: 18, alignItems: 'end' } },
        h('div', {}, lbl('Pause (s)'), pause),
        h('span', { class: 'bascule-bas' }, interrupteur(v.active, x => { v.active = x; }, 'active'))),
      h('div', { class: 'fboutons' }, btn({ onclick: fermer }, t('action.cancel')), btn({ solid: true, icone: 'check', onclick: enregistrer }, t('action.save'))),
    ];
  });
}

export function pageJournal(p) {
  let niveau = 'all', q = '';
  const compte = h('span', { class: 'mono term-titre' });
  const corps = h('div', { class: 'termbody journal' });
  const filtres = h('div', { class: 'filtres' });
  const couleur = n => (n === 'error' ? 'var(--alarm)' : n === 'warn' ? 'var(--warn)' : n === 'success' ? 'var(--accent)' : 'var(--ink-soft)');
  const recherche = champ({ sans: true, placeholder: t('misc.search'), 'aria-label': t('misc.search') });
  recherche.addEventListener('input', () => { q = recherche.value; peindre(); });
  function peindre() {
    const listes = E.logs.filter(l => (niveau === 'all' || l.level === niveau) && (!q || `${l.source} ${l.message}`.toLowerCase().includes(q.toLowerCase())));
    remplir(filtres, ...['all', 'info', 'success', 'warn', 'error'].map(n => h('button', {
      class: niveau === n ? 'ftr on' : 'ftr', type: 'button', onclick: () => { niveau = n; peindre(); },
    }, n === 'all' ? t('misc.all') : n)));
    compte.textContent = `${listes.length} entrée(s)`;
    remplir(corps, ...listes.map(l => h('div', {},
      h('span', { class: 't', text: new Date(l.createdAt).toLocaleTimeString() }), ' ',
      h('span', { class: 'faint', text: l.source ?? '' }), ' ',
      h('span', { style: { color: couleur(l.level) }, text: l.message ?? '' }))),
    listes.length === 0 ? h('div', { class: 'dim', text: t('misc.noLogs') }) : '');
  }
  p.suivre('logs', peindre);
  peindre();
  return page({ titre: t('page.logs.title'), lede: t('page.logs.lede'), actions: filtres },
    h('div', { class: 'recherche-journal' }, recherche),
    h('div', { class: 'term' }, h('div', { class: 'termhead' }, h('span', { class: 'dots' }, h('i'), h('i'), h('i')), compte), corps));
}

//
// Le serveur ne conserve pas d'archives de rapports : plutôt qu'un tableau
// d'entrées inventées, la page produit la synthèse du moment et permet de
// l'emporter. Ce qui est affiché est ce qui est mesuré.

// Le rapport HTML est un fichier téléchargé, lu hors de MapMyLAN : chaque
// valeur y est échappée, aucune ne devient une balise.
const echapper = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function pageRapports(p) {
  const sec = h('section', { class: 'page on' });
  const mesures = () => {
    const devices = E.devices;
    return {
      cves: devices.reduce((n, d) => n + (d.cves?.length || 0), 0),
      risqueEleve: devices.filter(d => (d.dangerScore || 0) >= 70),
      ports: devices.reduce((n, d) => n + (d.ports?.length || 0), 0),
      nouveaux: devices.filter(d => d.firstSeen && Date.now() - new Date(d.firstSeen).getTime() < 86400000),
      retenus: devices.filter(d => d.status === 'banned' || d.status === 'quarantined'),
    };
  };
  const emporter = format => {
    const m = mesures();
    const date = new Date();
    const jour = date.toISOString().slice(0, 10);
    if (format === 'json') {
      const synthese = {
        genereLe: date.toISOString(), sante: E.healthScore,
        parc: { total: E.devices.length, enLigne: E.devices.filter(d => d.status === 'online').length, nouveaux24h: m.nouveaux.length },
        exposition: { portsOuverts: m.ports, failles: m.cves, risqueEleve: m.risqueEleve.length },
        defense: { retenus: m.retenus.length, segments: E.vlans.length },
        incidents: E.alerts.slice(0, 50).map(a => ({ quand: a.createdAt, gravite: a.severity, source: a.source, message: a.message })),
      };
      telecharger(`mapmylan-rapport-${jour}.json`, JSON.stringify(synthese, null, 2), 'application/json');
      return;
    }
    const l = (k, v) => `<tr><td>${echapper(k)}</td><td>${echapper(v)}</td></tr>`;
    telecharger(`mapmylan-rapport-${jour}.html`, `<!doctype html><meta charset="utf-8"><title>Rapport MapMyLAN</title>
<style>body{font-family:system-ui;margin:40px;color:#14161A}h1{font-size:22px}
table{border-collapse:collapse;margin-top:18px}td{border-bottom:1px solid #E5E5E0;padding:7px 14px 7px 0}</style>
<h1>MapMyLAN — synthèse du ${echapper(date.toLocaleString())}</h1><table>
${l('Santé', `${E.healthScore}/100`)}${l('Hôtes connus', E.devices.length)}
${l('Nouveaux (24 h)', m.nouveaux.length)}${l('Ports ouverts', m.ports)}
${l('Failles', m.cves)}${l('Hôtes à risque élevé', m.risqueEleve.length)}
${l('Hôtes retenus', m.retenus.length)}${l('Segments', E.vlans.length)}</table>`, 'text/html');
  };
  function peindre() {
    const m = mesures();
    const json = btn({ icone: 'export', onclick: () => emporter('json') }, 'JSON');
    remplir(sec,
      entete({
        titre: t('page.reports.title'), lede: t('page.reports.lede'),
        actions: [json, btn({ solid: true, icone: 'export', onclick: () => emporter('html') }, t('act.generate'))],
      }),
      figs(
        fig({ icone: 'shield', libelle: t('fig.health'), valeur: E.healthScore, unite: '/100', delta: E.healthScore > 75 ? 'posture saine' : 'à consolider' }),
        fig({ icone: 'devices', ton: 'plain', libelle: t('fig.fleet'), valeur: E.devices.length, delta: `${m.nouveaux.length} nouveau(x) en 24 h` }),
        fig({ icone: 'alert', ton: m.risqueEleve.length ? 'warn' : undefined, libelle: t('fig.incidents'), valeur: E.alerts.length, delta: `${m.retenus.length} isolement(s)` }),
        fig({ icone: 'port', ton: 'plain', libelle: t('fig.exposed'), valeur: m.ports, delta: `${m.cves} faille(s) associée(s)` })),
      split('',
        carte({ titre: 'Ce qui pèse sur la note', note: "par ordre de poids" },
          h('table', {},
            h('thead', {}, h('tr', {}, h('th', { text: t('col.host') }), h('th', { text: t('col.risk') }), h('th', { class: 'cache-s', text: t('col.state') }))),
            h('tbody', {}, m.risqueEleve.slice(0, 8).map(d => h('tr', {},
              h('td', { class: 'principal' }, h('b', { class: 'moyen', text: nomAppareil(d) }), ' ', h('span', { class: 'mono dim', text: d.ip })),
              h('td', { class: 'mono', text: String(Math.round(d.dangerScore)) }),
              h('td', { class: 'dim cache-s', text: `${d.cves?.length || 0} faille(s) · ${d.ports?.length || 0} port(s)` }))))),
          m.risqueEleve.length === 0 ? vide('Aucun hôte au-dessus du seuil', 'check') : null),
        carte({ titre: 'Derniers incidents', note: `${E.alerts.length}` },
          E.alerts.slice(0, 8).map(a => notice({ icone: 'alert', ton: a.severity === 'critical' ? 'hot' : undefined, quand: `${a.source || 'système'} · ${fmtDate(a.createdAt)}` }, a.message)),
          E.alerts.length === 0 ? vide(t('misc.calm'), 'check') : null)));
  }
  p.suivre(['devices', 'alerts', 'vlans', 'healthScore'], peindre);
  peindre();
  return sec;
}
