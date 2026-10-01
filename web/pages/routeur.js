// Connexion à l'équipement réseau principal.
//
// Un seul équipement pilote la défense active : c'est lui qui bloque, isole et
// dit ce qu'il voit sur le fil. L'écran montre d'abord ce qu'il sait faire —
// les capacités déclarées par l'adaptateur — pour qu'aucun bouton ne promette
// une action que le matériel ne sait pas exécuter.
//
// Nouveau en 2.0 : la confiance au premier usage. L'équipement présente une
// empreinte (clé d'hôte SSH, ou certificat TLS auto-signé) ; l'administrateur
// la compare avec celle que l'équipement affiche avant de l'accepter, et elle
// est ensuite vérifiée à chaque connexion.
import { confirmer, toast } from '/socle/compte.js';
import { h, ic, remplir } from '../dom.js';
import { api } from '../etat.js';
import { t } from '../i18n.js';

// Picto par constructeur : on reste sur le vocabulaire de l'application.
const PICTO_CONSTRUCTEUR = {
  unifi: 'router', 'asus-merlin': 'router', edgeos: 'router',
  openwrt: 'chip', routeros: 'switch', pfsense: 'shield',
  'cisco-ios': 'switch', zyxel: 'switch', generic: 'ssh',
};

const CAPACITES = {
  ban: 'bloquer', unban: 'débloquer', quarantine: 'isoler',
  clients: 'lister les clients', arp: 'table ARP', leases: 'baux DHCP',
  ports: 'ports', vlans: 'VLAN', reboot: 'redémarrer',
};

const bouton = ({ icone, solid, danger, onclick }, ...enfants) => h('button', {
  class: ['btn-routeur', solid ? 'solid' : '', danger ? 'danger' : ''].filter(Boolean).join(' '), type: 'button', onclick,
}, icone ? ic(icone, 14, { trait: 1.8 }) : null, enfants);

export function pageRouteur(p) {
  let adaptateurs = [], equipement = null, test = null, enTest = false, vue = 'clients', lignes = [], noteLignes = '';
  const tete = h('div', { class: 'routeur-tete' });
  const corps = h('div');

  const charger = async () => {
    [adaptateurs, equipement] = await Promise.all([api.get('/api/router/adapters').catch(() => []), api.get('/api/router').catch(() => null)]);
    peindre();
    if (equipement) chargerLignes();
  };
  const chargerLignes = async () => {
    lignes = []; noteLignes = ''; peindre();
    try {
      const r = vue === 'clients' ? await api.get('/api/router/clients') : await api.get('/api/router/arp');
      if (!r.supported) noteLignes = t('gear.unsupported');
      else lignes = vue === 'clients' ? r.clients : r.entries;
    } catch (e) { noteLignes = e.message; }
    peindre();
  };
  const tester = async () => {
    enTest = true; test = null; peindre();
    try { test = await api.post('/api/router/test', { useSaved: true }); } catch (e) { test = { ok: false, error: e.message }; }
    finally { enTest = false; await charger(); }
  };
  const retirer = async () => {
    if (!await confirmer(t('gear.confirmDelete'), '', { danger: true, oui: t('action.delete') })) return;
    try { await api.del('/api/router'); equipement = null; lignes = []; peindre(); } catch (e) { toast(e.message, true); }
  };
  const editer = () => formulaireEquipement(adaptateurs, equipement, charger);

  function peindre() {
    const adaptateur = adaptateurs.find(a => a.id === equipement?.vendor);
    remplir(tete,
      h('div', { class: 'grow' }, h('h1', { text: t('gear.title') }), h('p', { text: t('gear.lede') })),
      // Sans équipement, le seul bouton est celui de la carte vide, au centre.
      equipement ? h('div', { class: 'routeur-actions' },
        bouton({ icone: 'refresh', onclick: tester }, enTest ? t('gear.testing') : t('gear.test')),
        bouton({ icone: 'settings', solid: true, onclick: editer }, t('action.edit'))) : null);
    if (!equipement) {
      remplir(corps, h('div', { class: 'routeur-vide' },
        h('span', { class: 'routeur-vide-ic' }, ic('router', 22)),
        h('div', { class: 'routeur-vide-t', text: t('gear.emptyTitle') }),
        h('p', { text: t('gear.emptyBody') }),
        h('div', { class: 'centre' }, bouton({ icone: 'plus', solid: true, onclick: editer }, t('gear.connect')))));
      return;
    }
    const g = equipement;
    const etatTest = g.lastTestOk === false ? 'ko' : '';
    remplir(corps,
      h('div', { class: 'routeur-carte' },
        h('div', { class: 'routeur-id' },
          h('span', { class: 'routeur-ic' }, ic(PICTO_CONSTRUCTEUR[g.vendor] || 'router', 20)),
          h('div', { class: 'grow' },
            h('div', { class: 'routeur-nom', text: adaptateur?.label || g.vendor }),
            h('div', { class: 'routeur-acces', text: `${g.username}@${g.host}:${g.port} · ${g.transport === 'api' ? 'API' : 'SSH'}${g.site ? ` · site ${g.site}` : ''}` })),
          bouton({ icone: 'ban', danger: true, onclick: retirer }, t('action.delete'))),
        h('div', { class: 'routeur-caps' }, (g.capabilities || []).map(c => h('span', { text: CAPACITES[c] || c }))),
        g.empreinteHote || g.empreinteTls ? h('div', { class: 'routeur-empreinte' }, ic('key', 13),
          h('span', { class: 'mono coupe', text: g.empreinteHote ? `clé d'hôte ${g.empreinteHote}` : `certificat ${g.empreinteTls}` })) : null,
        h('div', { class: `routeur-test ${etatTest}` },
          ic(g.lastTestOk === false ? 'alert' : g.lastTestOk ? 'shield' : 'clock', 14),
          h('span', { class: 'mono', text: g.lastTestAt ? `${g.lastTestOk ? t('gear.lastOk') : t('gear.lastFail')} · ${new Date(g.lastTestAt).toLocaleString()}` : t('gear.never') }),
          g.lastTestInfo ? h('span', { class: 'mono routeur-info', text: g.lastTestInfo }) : null),
        test ? h('div', { class: test.ok ? 'resultat ok' : 'resultat ko' }, ic(test.ok ? 'shield' : 'alert', 14), h('span', { text: test.ok ? (test.info || t('gear.testOk')) : test.error })) : null),
      h('div', { class: 'routeur-vu' },
        h('div', { class: 'routeur-vu-tete' },
          h('h2', { text: t('gear.seen') }),
          h('div', { class: 'routeur-vues' },
            ['clients', 'arp'].map(v => h('button', { class: vue === v ? 'on' : '', type: 'button', onclick: () => { vue = v; chargerLignes(); } }, v === 'clients' ? t('gear.clients') : t('gear.arp'))),
            h('button', { class: 'recharger', type: 'button', title: t('gear.reload'), 'aria-label': t('gear.reload'), onclick: chargerLignes }, ic('refresh', 15)))),
        noteLignes ? h('div', { class: 'routeur-note', text: noteLignes })
          : lignes.length === 0 ? h('div', { class: 'routeur-note faint', text: t('gear.none') })
            : h('table', {},
              h('thead', {}, h('tr', {}, h('th', { text: t('gear.col.host') }), h('th', { text: 'IP' }), h('th', { class: 'cache-m', text: 'MAC' }),
                h('th', { class: 'cache-l', text: t('gear.col.vendor') }), h('th', { class: 'cache-s', text: t('gear.col.link') }))),
              h('tbody', {}, lignes.map(c => h('tr', {},
                h('td', { class: 'principal tronque', text: c.hostname || '—' }),
                h('td', { class: 'mono', text: c.ip || '—' }),
                h('td', { class: 'mono dim cache-m', text: c.mac || '—' }),
                h('td', { class: 'dim cache-l', text: c.vendor || '—' }),
                h('td', { class: 'cache-s' }, h('span', { class: 'liaison' }, ic(c.medium === 'wireless' ? 'air' : 'wired', 13, { trait: 1.8 }),
                  c.medium === 'wireless' ? t('link.wireless') : t('link.wired'),
                  c.blocked ? h('span', { class: 'alarme bloque', text: t('state.banned') }) : null))))))));
  }
  peindre();
  charger();
  return h('div', { class: 'page-routeur' }, tete, corps);
}

function formulaireEquipement(adaptateurs, equipement, apres) {
  const v = {
    vendor: equipement?.vendor || 'unifi',
    host: equipement?.host || '', port: equipement?.port || '', username: equipement?.username || '',
    password: '', privateKey: '', passphrase: '',
    apiBaseUrl: equipement?.apiBaseUrl || '', site: equipement?.site || 'default', verifyTls: !!equipement?.verifyTls,
  };
  // L'empreinte déjà acceptée reste acceptée ; une nouvelle attend l'accord.
  let empreinte = equipement?.empreinteHote ? { type: 'hote', valeur: equipement.empreinteHote, acceptee: true }
    : equipement?.empreinteTls ? { type: 'tls', valeur: equipement.empreinteTls, acceptee: true } : null;
  let occupe = '', resultat = null;

  const adaptateur = () => adaptateurs.find(x => x.id === v.vendor);
  // UniFi parle à l'API locale en HTTPS, pas en SSH. On lit le transport
  // déclaré par l'adaptateur ; si la liste n'est pas encore chargée, on se
  // rabat sur l'identifiant plutôt que de retomber sur SSH par défaut.
  const transport = () => { const a = adaptateur(); return a?.transport === 'api' ? 'api' : a?.transport === 'ssh' ? 'ssh' : v.vendor === 'unifi' ? 'api' : 'ssh'; };
  const besoins = () => adaptateur()?.needs || ['password'];
  // Le serveur valide strictement : seuls les champs utiles partent, et un
  // secret laissé vide garde celui qui est en place.
  const charge = () => {
    const api_ = transport() === 'api';
    return {
      vendor: v.vendor, transport: transport(), host: v.host.trim(), username: v.username.trim(),
      ...(Number(v.port) ? { port: Number(v.port) } : {}),
      ...(v.password ? { password: v.password } : {}),
      ...(v.privateKey ? { privateKey: v.privateKey } : {}),
      ...(v.passphrase ? { passphrase: v.passphrase } : {}),
      ...(api_ && v.apiBaseUrl ? { apiBaseUrl: v.apiBaseUrl.trim() } : {}),
      ...(api_ ? { site: v.site || 'default' } : {}),
      verifyTls: !!v.verifyTls,
      ...(empreinte?.acceptee && empreinte.type === 'hote' ? { empreinteHote: empreinte.valeur } : {}),
      ...(empreinte?.acceptee && empreinte.type === 'tls' ? { empreinteTls: empreinte.valeur } : {}),
    };
  };
  // L'équipement a présenté une empreinte que personne n'a encore acceptée.
  const proposer = (r) => {
    if (r?.empreinteHote) empreinte = { type: 'hote', valeur: r.empreinteHote, acceptee: false, typeCle: r.typeCle };
    else if (r?.empreinteTls && !r.certificatReconnu) empreinte = { type: 'tls', valeur: r.empreinteTls, acceptee: false, sujet: r.sujetTls };
    else if (r?.certificatReconnu) v.verifyTls = true;
  };
  const appel = async (nom, fn) => {
    occupe = nom; resultat = null; peindre();
    try { return await fn(); } catch (e) {
      if (e.status === 409 && (e.details?.empreinteHote || e.details?.empreinteTls)) {
        proposer(e.details);
        resultat = { ok: false, error: "L'équipement présente une empreinte qu'il faut d'abord accepter, ci-dessous." };
      } else resultat = { ok: false, error: e.message };
      return null;
    } finally { occupe = ''; peindre(); }
  };
  const reconnaitre = () => appel('detect', async () => {
    const r = await api.post('/api/router/detect', charge());
    resultat = r;
    if (r.detected) v.vendor = r.detected;
    proposer(r);
  });
  const tester = () => appel('test', async () => { resultat = await api.post('/api/router/test', charge()); proposer(resultat); });
  const enregistrer = async () => {
    if (!v.host || !v.username) { resultat = { ok: false, error: t('gear.needHost') }; peindre(); return; }
    const fait = await appel('save', async () => { await api.put('/api/router', charge()); return true; });
    if (fait) { fermer(); apres(); }
  };

  const fermer = () => { voile.remove(); document.removeEventListener('keydown', echap); };
  const echap = ev => { if (ev.key === 'Escape') fermer(); };
  const saisie = (cle, props = {}) => {
    const el = h(props.multiligne ? 'textarea' : 'input', { class: props.multiligne ? 'gf-champ cle' : 'gf-champ', type: props.type, rows: props.multiligne ? 4 : undefined, placeholder: props.placeholder, 'aria-label': props.aria, autocomplete: props.type === 'password' ? 'new-password' : 'off' });
    el.value = v[cle];
    el.addEventListener('input', () => { v[cle] = el.value; });
    return el;
  };
  const lib = texte => h('label', { class: 'gf-lbl', text: texte });
  const corps = h('div', { class: 'gf-corps' });
  function peindre() {
    const a = adaptateur(), tr = transport(), bs = besoins();
    const tls = h('input', { type: 'checkbox', checked: v.verifyTls, 'aria-label': t('gear.verifyTls') });
    tls.addEventListener('change', () => { v.verifyTls = tls.checked; });
    remplir(corps,
      h('div', { class: 'gf-lbl marge', text: t('gear.vendor') }),
      h('div', { class: 'gf-constructeurs' }, adaptateurs.map(x => h('button', {
        class: x.id === v.vendor ? 'on' : '', type: 'button', onclick: () => { v.vendor = x.id; empreinte = null; peindre(); },
      }, h('span', { class: 'gf-c-ic' }, ic(PICTO_CONSTRUCTEUR[x.id] || 'router', 16)), h('span', { text: x.label })))),
      a ? h('div', { class: 'gf-caps' }, (a.capabilities || []).map(c => h('span', { text: CAPACITES[c] || c })), h('span', { class: 'gf-transport', text: tr === 'api' ? 'API locale' : 'SSH' })) : null,
      h('div', { class: 'gf-deux' },
        h('div', {}, lib(t('gear.host')), saisie('host', { placeholder: '192.0.2.1', aria: t('gear.host') })),
        h('div', {}, lib(t('gear.port')), saisie('port', { placeholder: tr === 'api' ? '443' : '22', aria: t('gear.port') }))),
      h('div', { class: 'gf-grp' }, lib(t('gear.user')), saisie('username', { placeholder: v.vendor === 'unifi' ? 'admin' : 'root', aria: t('gear.user') })),
      bs.includes('password') ? h('div', { class: 'gf-grp' }, lib(t('gear.pass')), saisie('password', { type: 'password', placeholder: equipement?.hasPassword ? t('gear.keepSecret') : '', aria: t('gear.pass') })) : null,
      bs.includes('privateKey') ? h('div', { class: 'gf-grp' }, lib(t('gear.key')), saisie('privateKey', { multiligne: true, placeholder: equipement?.hasPrivateKey ? t('gear.keepSecret') : '-----BEGIN OPENSSH PRIVATE KEY-----', aria: t('gear.key') })) : null,
      tr === 'api' ? h('div', { class: 'gf-deux' },
        h('div', {}, lib(t('gear.apiUrl')), saisie('apiBaseUrl', { placeholder: 'https://192.0.2.1', aria: t('gear.apiUrl') })),
        h('div', {}, lib(t('gear.site')), saisie('site', { placeholder: 'default', aria: t('gear.site') }))) : null,
      h('label', { class: 'gf-tls' }, tls, t('gear.verifyTls')),
      empreinte ? h('div', { class: empreinte.acceptee ? 'empreinte acceptee' : 'empreinte' },
        h('div', { class: 'empreinte-t' }, ic('key', 14), empreinte.type === 'hote' ? `Clé d'hôte SSH${empreinte.typeCle ? ` (${empreinte.typeCle})` : ''}` : `Certificat TLS${empreinte.sujet ? ` — ${empreinte.sujet}` : ''}`),
        h('code', { class: 'coupe', text: empreinte.valeur }),
        empreinte.acceptee
          ? h('div', { class: 'empreinte-aide', text: 'Acceptée : elle sera vérifiée à chaque connexion. Une empreinte différente coupera la liaison.' })
          : [h('div', { class: 'empreinte-aide', text: "Compare-la avec celle que l'équipement affiche lui-même avant de l'accepter : c'est ce qui garantit que tu parles bien à lui." }),
            h('button', { class: 'btn-routeur solid', type: 'button', onclick: () => { empreinte.acceptee = true; peindre(); } }, ic('check', 14, { trait: 1.8 }), 'Accepter cette empreinte')]) : null,
      resultat ? h('div', { class: resultat.ok ? 'resultat ok' : 'resultat ko' }, ic(resultat.ok ? 'shield' : 'alert', 14),
        h('span', { text: resultat.ok ? (resultat.detected ? t('gear.detected', { v: resultat.detected }) : (resultat.info || t('gear.testOk'))) : resultat.error })) : null,
      h('div', { class: 'gf-boutons' },
        bouton({ icone: 'search', onclick: reconnaitre }, occupe === 'detect' ? '…' : t('gear.detect')),
        bouton({ icone: 'refresh', onclick: tester }, occupe === 'test' ? '…' : t('gear.test')),
        h('span', { class: 'grow' }),
        bouton({ icone: 'shield', solid: true, onclick: enregistrer }, occupe === 'save' ? '…' : t('action.save'))));
  }
  // Deux halos qui dérivent lentement derrière le voile : le fond respire sans
  // jamais attirer l'œil, et la feuille se détache mieux.
  const fiche = h('div', { class: 'gf', role: 'dialog', 'aria-modal': 'true', 'aria-label': t('gear.formTitle') },
    h('div', { class: 'gf-tete' }, h('h2', { text: t('gear.formTitle') }), h('button', { class: 'gf-x', type: 'button', 'aria-label': t('action.close'), onclick: fermer }, ic('x', 15))),
    corps);
  const voile = h('div', { class: 'gf-voile', onclick: ev => { if (ev.target === voile) fermer(); } },
    h('div', { class: 'gf-halos', 'aria-hidden': 'true' }, h('i'), h('i')), fiche);
  peindre();
  document.body.append(voile);
  document.addEventListener('keydown', echap);
}
