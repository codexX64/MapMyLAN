// Assistant de première configuration de MapMyLAN.
//
// Il suit le thème comme le reste — clair ou sombre, sans une couleur écrite
// en dur. Ses classes sont préfixées « ob- » pour ne jamais entrer en
// collision avec celles des pages.
//
// Ce que l'assistant garantit : l'équipement réseau est obligatoire, et rien
// n'est enregistré tant que la connexion n'a pas répondu. L'empreinte que
// l'équipement présente (clé d'hôte SSH, certificat TLS auto-signé) est
// montrée avant l'enregistrement : enregistrer, c'est lui faire confiance, et
// elle sera vérifiée à chaque connexion. Le reste — messagerie, courrier — se
// passe, et se règle plus tard.
import { h, s, remplir } from '../dom.js';
import { api } from '../etat.js';
import { t } from '../i18n.js';
import { basculerTheme } from '../coque.js';

const ETAPES = ['accueil', 'equipement', 'verif', 'telegram', 'courrier', 'topologie', 'fin'];
/** Étapes que « Passer cette étape » saute : les canaux d'alerte. */
const FACULTATIVES = new Set([3, 4]);

// Les identifiants doivent correspondre exactement à ceux des adaptateurs du
// serveur. UniFi parle à l'API locale en HTTPS ; tous les autres en SSH.
const CONSTRUCTEURS = [
  { value: 'unifi', label: 'Ubiquiti · UniFi', note: 'API locale HTTPS' },
  { value: 'asus-merlin', label: 'Asus · Merlin', note: 'SSH' },
  { value: 'openwrt', label: 'OpenWrt', note: 'SSH' },
  { value: 'routeros', label: 'MikroTik · RouterOS', note: 'SSH' },
  { value: 'pfsense', label: 'pfSense / OPNsense', note: 'SSH' },
  { value: 'cisco-ios', label: 'Cisco IOS', note: 'SSH' },
  { value: 'zyxel', label: 'Zyxel', note: 'SSH' },
  { value: 'edgeos', label: 'Ubiquiti · EdgeOS', note: 'SSH' },
  { value: 'generic', label: 'Autre (SSH générique)', note: 'SSH' },
];
const estApi = v => v === 'unifi';

const FOURNISSEURS = [
  { value: 'gmail', label: 'Gmail', note: 'IMAP et SMTP remplis tout seuls' },
  { value: 'apple', label: 'Apple', note: 'IMAP et SMTP remplis tout seuls' },
  { value: 'outlook', label: 'Outlook', note: 'IMAP et SMTP remplis tout seuls' },
];

const trait = (n, ...enfants) => s('svg', { width: n, height: n, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.6, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, enfants);
const IcoInfo = () => trait(15, s('circle', { cx: 12, cy: 12, r: 8.5 }), s('path', { d: 'M12 11v5M12 8h.01' }));
const IcoAlerte = () => trait(15, s('path', { d: 'M12 4 21 19H3z' }), s('path', { d: 'M12 10v4M12 16.5h.01' }));
const IcoBouclier = () => trait(15, s('path', { d: 'M12 3.2 19 6v5.2c0 4.4-2.9 7.5-7 8.9-4.1-1.4-7-4.5-7-8.9V6z' }), s('path', { d: 'M9.6 11.8 11.4 13.6 15 10' }));
const IcoCarte = n => trait(n, s('circle', { cx: 12, cy: 5.5, r: 2.5 }), s('circle', { cx: 5.5, cy: 18, r: 2.5 }), s('circle', { cx: 18.5, cy: 18, r: 2.5 }), s('path', { d: 'M10.2 7.4 7 15.7M13.8 7.4 17 15.7M8 18h8' }));

const noteOb = (classe, icone, texte) => h('div', { class: classe ? `ob-note ${classe}` : 'ob-note' }, h('span', { class: 'p' }, icone()), h('span', { text: texte }));

/** Rend une promesse résolue quand la configuration est terminée. */
export function premierReglage() {
  return new Promise(resolve => {
    let etape = 0, verdict = null, occupe = false, erreur = '';
    const d = {
      router: { name: 'Routeur principal', host: '', port: 443, username: 'admin', password: '', privateKey: '', passphrase: '', useKey: false, vendor: 'unifi', apiBaseUrl: '', site: 'default' },
      telegram: { enabled: false, token: '', chatId: '' },
      email: { enabled: false, provider: 'gmail', address: '', password: '' },
      autoTopology: true,
    };
    const r = d.router;
    const corps = h('div', { class: 'ob-body' });
    const pas = h('div', { class: 'ob-steps' });
    const pied = h('div', { class: 'ob-foot' });
    const racine = h('div', { class: 'ob-overlay' },
      h('div', { class: 'ob-halos', 'aria-hidden': 'true' }, h('i'), h('i')),
      h('div', { class: 'ob-wiz' },
        h('div', { class: 'ob-head' },
          h('div', { class: 'ob-brand' },
            h('span', { class: 'g' }, IcoCarte(19)),
            h('div', {}, h('b', { text: 'MapMyLAN' }), h('span', { text: t('ob.brand.sub') })),
            h('button', { class: 'th', type: 'button', title: t('ob.theme'), 'aria-label': t('ob.theme'), onclick: basculerTheme },
              trait(17, s('circle', { cx: 12, cy: 12, r: 8 }), s('path', { d: 'M12 4a8 8 0 0 0 0 16z', fill: 'currentColor', stroke: 'none' })))),
          pas),
        corps, pied));
    document.body.append(racine);

    // L'adresse de l'équipement est devinée depuis la plage balayée : dans la
    // très grande majorité des installations, la passerelle est en .1.
    api.get('/api/settings').then(x => {
      const plage = x?.['scan.subnet'];
      if (!plage || r.host) return;
      r.host = plage.split('/')[0].split('.').slice(0, 3).join('.') + '.1';
      if (etape === 1) peindre();
    }).catch(() => { /* l'adresse reste à saisir */ });

    const parApi = () => estApi(r.vendor);
    // Le serveur valide strictement : seuls les champs du transport choisi
    // partent, et l'empreinte acceptée les accompagne une fois connue.
    const identifiants = empreinte => ({
      vendor: r.vendor, transport: parApi() ? 'api' : 'ssh', host: r.host.trim(), port: Number(r.port) || undefined, username: r.username.trim(),
      ...(parApi() ? { apiBaseUrl: r.apiBaseUrl.trim() || `https://${r.host.trim()}`, site: r.site || 'default' } : {}),
      ...(r.useKey && !parApi() ? { privateKey: r.privateKey, ...(r.passphrase ? { passphrase: r.passphrase } : {}) } : { password: r.password }),
      ...(empreinte?.empreinteHote ? { empreinteHote: empreinte.empreinteHote } : {}),
      ...(empreinte?.empreinteTls ? { empreinteTls: empreinte.empreinteTls } : {}),
      ...(empreinte?.verifyTls ? { verifyTls: true } : {}),
    });
    const incomplet = () => !r.host || !r.username || (r.useKey && !parApi() ? !r.privateKey : !r.password);

    const verifier = async () => {
      occupe = true; erreur = ''; peindre();
      try {
        // D'abord ce que l'équipement présente, puis une vraie connexion qui
        // vérifie cette même empreinte.
        const lu = await api.post('/api/router/detect', identifiants());
        const empreinte = lu?.empreinteHote ? { empreinteHote: lu.empreinteHote, typeCle: lu.typeCle }
          : lu?.empreinteTls && !lu.certificatReconnu ? { empreinteTls: lu.empreinteTls, sujet: lu.sujetTls }
            : lu?.certificatReconnu ? { verifyTls: true } : null;
        if (!lu?.ok && !empreinte) verdict = { ok: false, error: lu?.error || lu?.info };
        else {
          const v = await api.post('/api/router/test', identifiants(empreinte));
          verdict = { ok: !!v.ok, banner: v.info, error: v.error, empreinte };
        }
        // Même en cas d'échec on avance : l'écran suivant explique ce qui
        // s'est passé, et il porte le bouton qui réessaie.
        etape = 2;
      } catch (e) {
        if (e.status === 409 || e.status === 502) { verdict = { ok: false, error: e.message }; etape = 2; }
        else erreur = e.message;
      } finally { occupe = false; peindre(); }
    };
    const enregistrer = async () => {
      occupe = true; erreur = ''; peindre();
      try { await api.put('/api/router', { ...identifiants(verdict?.empreinte), name: r.name }); etape = 3; }
      catch (e) { erreur = e.message; }
      finally { occupe = false; peindre(); }
    };
    const terminer = async () => {
      occupe = true; erreur = ''; peindre();
      try {
        if (d.telegram.enabled) await api.put('/api/notifications/telegram', { enabled: true, config: { token: d.telegram.token, chatId: d.telegram.chatId } });
        if (d.email.enabled) await api.put('/api/notifications/email', { enabled: true, config: { provider: d.email.provider, address: d.email.address, password: d.email.password } });
        await api.put('/api/settings/topology.autoBuild', { value: d.autoTopology });
        await api.post('/api/setup/complete');
        racine.classList.add('parti');
        setTimeout(() => racine.remove(), 550);
        // Balayage et carte partent en arrière-plan : leur échec s'inscrit au
        // journal du service, et le bouton de balayage reste là.
        api.post('/api/devices/scan', {}).catch(() => { /* voir ci-dessus */ });
        setTimeout(() => api.post('/api/topology/auto-build').catch(() => { /* voir ci-dessus */ }), 5000);
        resolve();
      } catch (e) { erreur = e.message; occupe = false; peindre(); }
    };
    const suivant = () => {
      if (etape === 1) return verifier();
      if (etape === 2) { if (verdict?.ok) return enregistrer(); etape = 1; return peindre(); }
      if (etape === ETAPES.length - 1) return terminer();
      etape = Math.min(ETAPES.length - 1, etape + 1);
      peindre();
    };
    // Passer une étape de canal d'alerte le désactive : sauter n'est pas
    // « garder ce qui est saisi », c'est renoncer pour l'instant.
    const passer = () => { (etape === 3 ? d.telegram : d.email).enabled = false; etape += 1; peindre(); };
    const libelle = () => {
      if (etape === 0) return t('ob.btn.start');
      if (etape === 1) return t('ob.btn.verify');
      if (etape === 2) return verdict?.ok ? t('ob.btn.save') : t('ob.btn.retry');
      if (etape === ETAPES.length - 1) return t('ob.btn.open');
      return t('ob.btn.next');
    };

    const champOb = (objet, cle, { type, placeholder, sans, lire, multiligne, aria } = {}) => {
      const el = h(multiligne ? 'textarea' : 'input', { class: sans ? 'ob-field sans' : 'ob-field', type, placeholder, rows: multiligne ? 5 : undefined, 'aria-label': aria, inputmode: lire ? 'numeric' : undefined, autocomplete: type === 'password' ? 'new-password' : 'off' });
      el.value = objet[cle];
      el.addEventListener('input', () => { objet[cle] = lire ? lire(el.value) : el.value; if (objet === r) peindrePied(); });
      return el;
    };
    const groupe = (libelleTxt, champ, indice, classe = '') => h('div', { class: `ob-grp ${classe}`.trim() }, h('label', { class: 'ob-lbl', text: libelleTxt }), champ, indice ? h('div', { class: 'ob-hint', text: indice }) : null);
    const bascule = (on, titre, note, agir) => h('div', { class: 'ob-basc' },
      h('div', { class: 't' }, h('b', { text: titre }), note ? h('p', { text: note }) : null),
      h('button', { class: on ? 'ob-sw on' : 'ob-sw', type: 'button', 'aria-pressed': String(on), 'aria-label': titre, onclick: agir }, h('s')));

    function contenu() {
      if (etape === 0) return [
        h('h1', { text: t('ob.welcome.title') }), h('p', { class: 'sub', text: t('ob.welcome.sub') }),
        h('ul', { class: 'ob-liste' }, ['router', 'check', 'alerts', 'topo'].map((k, i) => h('li', {},
          h('span', { class: 'c', text: String(i + 1) }), h('span', {}, h('b', { class: 'moyen', text: t(`ob.welcome.${k}.t`) }), ' ', t(`ob.welcome.${k}.d`))))),
      ];
      if (etape === 1) return [
        h('h1', { text: t('ob.router.title') }), h('p', { class: 'sub', text: t('ob.router.sub') }),
        groupe(t('ob.router.vendor'), choixOb(CONSTRUCTEURS, r.vendor, v => {
          // Le port suit le transport, tant que l'utilisateur n'a pas saisi
          // une valeur à lui : 443 pour l'API UniFi, 22 en SSH.
          const parDefaut = r.port === 22 || r.port === 443;
          r.vendor = v;
          if (parDefaut) r.port = estApi(v) ? 443 : 22;
          peindre();
        }, t('ob.router.vendor'))),
        groupe(t('ob.router.name'), champOb(r, 'name', { sans: true, aria: t('ob.router.name') })),
        h('div', { class: 'ob-grp ob-row3' },
          h('div', {}, h('label', { class: 'ob-lbl', text: t('ob.router.host') }), champOb(r, 'host', { placeholder: '192.0.2.1', aria: t('ob.router.host') }), h('div', { class: 'ob-hint', text: t('ob.router.hostHint') })),
          h('div', {}, h('label', { class: 'ob-lbl', text: parApi() ? t('ob.router.portApi') : t('ob.router.portSsh') }), champOb(r, 'port', { lire: x => parseInt(x) || 0, aria: 'Port' }))),
        groupe(t('ob.router.user'), champOb(r, 'username', { aria: t('ob.router.user') })),
        parApi() ? [
          groupe(t('ob.router.ctrl'), champOb(r, 'apiBaseUrl', { placeholder: `https://${r.host || '192.0.2.1'}`, aria: t('ob.router.ctrl') }), t('ob.router.ctrlHint')),
          groupe(t('ob.router.site'), champOb(r, 'site', { placeholder: 'default', aria: t('ob.router.site') })),
        ] : bascule(r.useKey, t('ob.router.useKey'), t('ob.router.useKeyHint'), () => { r.useKey = !r.useKey; peindre(); }),
        r.useKey && !parApi()
          ? [groupe(t('ob.router.key'), champOb(r, 'privateKey', { multiligne: true, placeholder: '-----BEGIN OPENSSH PRIVATE KEY-----\n…', aria: t('ob.router.key') })),
            groupe(t('ob.router.passphrase'), champOb(r, 'passphrase', { type: 'password', aria: t('ob.router.passphrase') }))]
          : groupe(t('ob.router.password'), champOb(r, 'password', { type: 'password', aria: t('ob.router.password') })),
        parApi() ? noteOb('', IcoInfo, t('ob.router.unifi')) : null,
      ];
      if (etape === 2) {
        const e = verdict?.empreinte;
        return [
          h('h1', { text: verdict?.ok ? t('ob.verify.titleOk') : t('ob.verify.titleKo') }), h('p', { class: 'sub', text: t('ob.verify.sub') }),
          h('div', { class: 'ob-choix' }, h('div', { class: `ob-opt fig ${verdict?.ok ? 'on' : 'ko'}` },
            h('span', { class: 'ic' }, verdict?.ok ? trait(17, s('path', { d: 'M5 12.5 10 17.5 19 7' })) : trait(17, s('circle', { cx: 12, cy: 12, r: 8.5 }), s('path', { d: 'M15 9l-6 6M9 9l6 6' }))),
            h('div', {}, h('b', { text: verdict?.ok ? t('ob.verify.ok') : t('ob.verify.ko') }),
              h('p', { text: verdict?.ok ? (verdict.banner || t('ob.verify.okNoBanner')) : (verdict?.error || t('ob.verify.koNoReason')) })))),
          verdict?.ok && (e?.empreinteHote || e?.empreinteTls) ? h('div', { class: 'ob-empreinte' },
            h('span', { class: 'ob-lbl', text: e.empreinteHote ? `Clé d'hôte présentée${e.typeCle ? ` (${e.typeCle})` : ''}` : 'Certificat présenté' }),
            h('code', { class: 'coupe', text: e.empreinteHote || e.empreinteTls }),
            h('div', { class: 'ob-hint', text: "Compare-la avec celle que l'équipement affiche lui-même : enregistrer revient à lui faire confiance, et elle sera vérifiée à chaque connexion." })) : null,
          verdict?.ok ? noteOb('ok', IcoBouclier, t('ob.verify.crypto')) : noteOb('w', IcoAlerte, t('ob.verify.advice')),
        ];
      }
      if (etape === 3) return [
        h('h1', { text: t('ob.tg.title') }), h('p', { class: 'sub', text: t('ob.tg.sub') }),
        bascule(d.telegram.enabled, t('ob.enable'), t('ob.later'), () => { d.telegram.enabled = !d.telegram.enabled; peindre(); }),
        d.telegram.enabled ? [
          groupe(t('ob.tg.token'), champOb(d.telegram, 'token', { type: 'password', aria: t('ob.tg.token') }), t('ob.tg.tokenHint')),
          groupe(t('ob.tg.chat'), champOb(d.telegram, 'chatId', { placeholder: '-100…', aria: t('ob.tg.chat') }), t('ob.tg.chatHint')),
        ] : null,
      ];
      if (etape === 4) return [
        h('h1', { text: t('ob.mail.title') }), h('p', { class: 'sub', text: t('ob.mail.sub') }),
        bascule(d.email.enabled, t('ob.enable'), t('ob.later'), () => { d.email.enabled = !d.email.enabled; peindre(); }),
        d.email.enabled ? [
          groupe(t('ob.mail.provider'), choixOb(FOURNISSEURS, d.email.provider, v => { d.email.provider = v; peindre(); }, t('ob.mail.provider'))),
          h('div', { class: 'ob-grp ob-row2' },
            h('div', {}, h('label', { class: 'ob-lbl', text: t('ob.mail.address') }), champOb(d.email, 'address', { type: 'email', placeholder: 'alertes@exemple.org', aria: t('ob.mail.address') })),
            h('div', {}, h('label', { class: 'ob-lbl', text: t('ob.mail.password') }), champOb(d.email, 'password', { type: 'password', aria: t('ob.mail.password') }))),
        ] : null,
        // Cette adresse ENVOIE les alertes du réseau ; celles de sécurité des
        // comptes passent par le relais du socle.
        d.email.enabled ? noteOb('', IcoInfo, t('ob.mail.noteOn')) : noteOb('w', IcoAlerte, t('ob.mail.noteOff')),
      ];
      if (etape === 5) {
        const opt = (auto, icone, titre, texte) => h('button', { class: d.autoTopology === auto ? 'ob-opt on' : 'ob-opt', type: 'button', onclick: () => { d.autoTopology = auto; peindre(); } },
          h('span', { class: 'ic' }, icone), h('div', {}, h('b', { text: titre }), h('p', { text: texte })));
        return [
          h('h1', { text: t('ob.topo.title') }), h('p', { class: 'sub', text: t('ob.topo.sub') }),
          h('div', { class: 'ob-choix' },
            opt(true, trait(17, s('path', { d: 'M13 3 5.5 13.5H11L10 21l7.5-10.5H12z' })), t('ob.topo.auto'), t('ob.topo.autoD')),
            opt(false, trait(17, s('circle', { cx: 12, cy: 5.5, r: 2.5 }), s('circle', { cx: 5.5, cy: 18, r: 2.5 }), s('circle', { cx: 18.5, cy: 18, r: 2.5 }), s('path', { d: 'M10.2 7.4 7 15.7M13.8 7.4 17 15.7' })), t('ob.topo.manual'), t('ob.topo.manualD'))),
        ];
      }
      const canaux = [d.telegram.enabled && 'Telegram', d.email.enabled && 'courrier'].filter(Boolean).join(', ');
      return [
        h('h1', { text: t('ob.done.title') }), h('p', { class: 'sub', text: t('ob.done.sub') }),
        h('ul', { class: 'ob-liste' },
          h('li', {}, h('span', { class: 'c', text: '✓' }), h('span', { text: t('ob.done.router') })),
          h('li', {}, h('span', { class: 'c', text: canaux ? '✓' : '—' }), h('span', { text: canaux ? t('ob.done.alerts', { liste: canaux }) : t('ob.done.noAlerts') })),
          h('li', {}, h('span', { class: 'c', text: '✓' }), h('span', { text: d.autoTopology ? t('ob.done.topoAuto') : t('ob.done.topoManual') }))),
        noteOb('w', IcoAlerte, t('ob.done.warn')),
      ];
    }

    function peindrePied() {
      const bloque = occupe || (etape === 1 && incomplet());
      remplir(pied,
        h('button', { class: etape === 0 || occupe ? 'ob-back masque' : 'ob-back', type: 'button', onclick: () => { etape = Math.max(0, etape - 1); peindre(); } },
          trait(15, s('path', { d: 'M15 5l-7 7 7 7' })), t('ob.back')),
        FACULTATIVES.has(etape) ? h('button', { class: 'ob-passer', type: 'button', onclick: passer }, t('ob.skip')) : null,
        h('button', { class: 'ob-next', type: 'button', disabled: bloque, onclick: suivant },
          occupe ? h('span', { class: 'ob-spin' }) : null, h('span', { text: libelle() }), occupe ? null : trait(15, s('path', { d: 'M9 5l7 7-7 7' }))));
    }

    // La section d'une étape n'est recréée qu'en changeant d'étape : son
    // animation d'entrée ne rejoue pas à chaque bascule, et le corps remonte
    // en haut seulement quand on avance ou recule.
    let section = null, etapeAffichee = -1;
    function peindre() {
      remplir(pas, ...ETAPES.map((_, i) => h('i', { class: i < etape ? 'done' : i === etape ? 'now' : '' })));
      const actif = document.activeElement;
      const garde = actif && corps.contains(actif) ? actif.getAttribute('aria-label') : null;
      if (etapeAffichee !== etape) {
        section = h('section', { class: 'ob-step', dataset: { etape: ETAPES[etape] } });
        remplir(corps, section);
        corps.scrollTop = 0;
        etapeAffichee = etape;
      }
      remplir(section, ...[contenu()].flat(Infinity).filter(Boolean), erreur ? noteOb('a', IcoAlerte, erreur) : '');
      if (garde) corps.querySelector(`[aria-label="${CSS.escape(garde)}"]`)?.focus();
      peindrePied();
    }
    peindre();
  });
}

// Le <select> natif impose le rendu du système : flèche dessinée par l'OS,
// panneau qui ignore le thème. Celui-ci s'ouvre en panneau, montre une ligne
// secondaire par option, et se pilote au clavier.
function choixOb(options, valeur, surChange, aria) {
  let ouvert = false, vise = 0;
  const pan = h('div', { class: 'ob-pan', role: 'listbox', hidden: true });
  const lib = h('span', { class: 'ob-sel-lib' });
  const chevron = h('span', { class: 'ob-sel-ch' }, trait(14, s('path', { d: 'M6 9.5 12 15.5 18 9.5' })));
  const btn = h('button', { class: 'ob-field sans ob-sel-btn', type: 'button', 'aria-haspopup': 'listbox', 'aria-label': aria }, lib, chevron);
  const boite = h('div', { class: 'ob-sel' }, btn, pan);
  const dehors = ev => { if (!boite.contains(ev.target)) basculer(false); };
  const basculer = v => {
    ouvert = v;
    if (v) { vise = Math.max(0, options.findIndex(o => o.value === valeur)); document.addEventListener('pointerdown', dehors); }
    else document.removeEventListener('pointerdown', dehors);
    peindre();
  };
  const choisir = v => { basculer(false); surChange(v); };
  function peindre() {
    lib.textContent = options.find(o => o.value === valeur)?.label || valeur;
    btn.classList.toggle('ouvert', ouvert);
    pan.hidden = !ouvert;
    remplir(pan, ...options.map((o, i) => h('button', {
      class: i === vise ? 'vise' : '', type: 'button', role: 'option', 'aria-selected': String(o.value === valeur),
      // Le survol ne fait que déplacer la marque : reconstruire les options sous
      // le pointeur ferait tomber le clic entre deux boutons différents.
      onmouseenter: ev => { vise = i; for (const b of pan.children) b.classList.toggle('vise', b === ev.currentTarget); }, onclick: () => choisir(o.value),
    }, h('span', { class: 'grow' }, h('span', { class: o.value === valeur ? 'l choisi' : 'l', text: o.label }), o.note ? h('span', { class: 'n', text: o.note }) : null),
      o.value === valeur ? h('span', { class: 'coche' }, trait(13, s('path', { d: 'M5 12.5 10 17.5 19 7' }))) : null)));
  }
  btn.addEventListener('click', () => basculer(!ouvert));
  btn.addEventListener('keydown', ev => {
    if (!ouvert) { if (['Enter', ' ', 'ArrowDown'].includes(ev.key)) { ev.preventDefault(); basculer(true); } return; }
    if (ev.key === 'Escape') { ev.preventDefault(); basculer(false); }
    else if (ev.key === 'ArrowDown') { ev.preventDefault(); vise = Math.min(options.length - 1, vise + 1); peindre(); }
    else if (ev.key === 'ArrowUp') { ev.preventDefault(); vise = Math.max(0, vise - 1); peindre(); }
    else if (ev.key === 'Enter') { ev.preventDefault(); if (options[vise]) choisir(options[vise].value); }
  });
  peindre();
  return boite;
}
