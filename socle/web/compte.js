// Interface des comptes, commune à tous les services : porte d'entrée
// (installation, connexion, second facteur, inscription forcée), renfort,
// page « Sécurité » du compte et page « Comptes » de l'administrateur.
//
// Rien n'est injecté comme balisage : tout passe par h(), qui écrit du
// texte. Les seules chaînes interprétées le sont comme documents SVG, où rien
// ne s'exécute : les pictogrammes (constantes) et le QR code, fabriqué ici
// même à partir de la matrice.
import { svg as qrSvg } from './qr.js';

export function h(tag, props = {}, ...enfants) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const e of enfants.flat(Infinity)) if (e !== null && e !== undefined && e !== false) el.append(e instanceof Node ? e : String(e));
  return el;
}

const PICTOS = {
  cle: '<circle cx="8" cy="12" r="4.2"/><path d="M12.2 12H21M17.5 12v3.4M20 12v2.6"/>',
  bouclier: '<path d="M12 3.5 19 6.3v5.2c0 4.4-2.9 7.5-7 8.9-4.1-1.4-7-4.5-7-8.9V6.3z"/><path d="M9.6 12.1 11.4 13.9 15 10.3"/>',
  telephone: '<rect x="7" y="3" width="10" height="18" rx="2.4"/><path d="M11 17.5h2"/>',
  empreinte: '<path d="M7.5 18.5c1-2 1.5-4 1.5-6.5a3 3 0 0 1 6 0c0 2.2-.3 4.3-1 6.3M12 12c0 3-.6 5.6-1.8 8M4.8 15.5c.4-1.2.7-2.3.7-3.5a6.5 6.5 0 0 1 13 0c0 1.4-.1 2.7-.4 4M16.5 19.5c.3-.9.6-1.8.8-2.8"/>',
  bouee: '<circle cx="12" cy="12" r="8.4"/><circle cx="12" cy="12" r="3.6"/><path d="m6 6 3.4 3.4M14.6 14.6 18 18M18 6l-3.4 3.4M9.4 14.6 6 18"/>',
  cadenas: '<rect x="5" y="10.5" width="14" height="10" rx="2.4"/><path d="M8.3 10.5V7.8a3.7 3.7 0 0 1 7.4 0v2.7"/>',
  ecran: '<rect x="3" y="4.5" width="18" height="12" rx="2"/><path d="M9 20h6M12 16.5V20"/>',
  alerte: '<path d="M12 4 21 19.5H3z"/><path d="M12 10v4.2M12 17h.01"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  corbeille: '<path d="M4.5 7h15M9.5 7V4.8h5V7M6.5 7l.9 12.2h9.2L17.5 7"/>',
  crayon: '<path d="m4.5 19.5 1-4 10-10 3 3-10 10z"/><path d="m13.5 7.5 3 3"/>',
  copie: '<rect x="8.5" y="8.5" width="11" height="11" rx="2"/><path d="M15.5 5.5v-1H4.5v11h1"/>',
  telecharge: '<path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19.5h14"/>',
  soleil: '<circle cx="12" cy="12" r="3.8"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4"/>',
  lune: '<path d="M19.5 14.5A7.5 7.5 0 0 1 9.5 4.5a7.5 7.5 0 1 0 10 10z"/>',
  sortie: '<path d="M14 4.5h4.5v15H14M10 8l-4 4 4 4M6 12h9"/>',
  fleche: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  retour: '<path d="M19 12H5M11 6l-6 6 6 6"/>',
  verifie: '<path d="m5 12.5 4.2 4.2L19 7"/>',
  utilisateurs: '<circle cx="9.2" cy="8.3" r="3.4"/><path d="M3.4 19.1a5.8 5.8 0 0 1 11.6 0"/><path d="M16 5.9a3.4 3.4 0 0 1 0 6.6M17.4 14.9a5.5 5.5 0 0 1 3.4 4.2"/>',
  journal: '<path d="M6 3.5h9.5L19 7v13.5H6z"/><path d="M9.5 11h6M9.5 14.5h6M9.5 18h3.5"/>',
  lien: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  croix: '<path d="M6 6l12 12M18 6 6 18"/>',
  horloge: '<circle cx="12" cy="12" r="8.4"/><path d="M12 7.4V12l3 1.8"/>',
  enveloppe: '<rect x="3.5" y="5.5" width="17" height="13" rx="2.2"/><path d="m4.2 7.2 7.8 6 7.8-6"/>',
};

// Un pictogramme est un fragment SVG constant, du socle ou du service qui
// l'ajoute : il est lu comme document SVG, où rien ne s'exécute, puis cloné.
// Jamais d'injection de balisage dans la page.
const SVG = 'http://www.w3.org/2000/svg';
const dessins = new Map();
export function ajouterPictos(pictos) { Object.assign(PICTOS, pictos); }

function dessin(nom) {
  if (!dessins.has(nom)) {
    const doc = new DOMParser().parseFromString(`<svg xmlns="${SVG}">${PICTOS[nom] || ''}</svg>`, 'image/svg+xml');
    const f = document.createDocumentFragment();
    if (!doc.querySelector('parsererror')) f.append(...[...doc.documentElement.childNodes].map(n => document.importNode(n, true)));
    dessins.set(nom, f);
  }
  return dessins.get(nom).cloneNode(true);
}

export function icone(nom, taille = 16) {
  const s = document.createElementNS(SVG, 'svg');
  s.setAttribute('class', 'i'); s.setAttribute('width', taille); s.setAttribute('height', taille);
  s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('aria-hidden', 'true');
  s.append(dessin(nom));
  return s;
}

function noeudQr(texte, taille) {
  const doc = new DOMParser().parseFromString(qrSvg(texte, { taille }), 'image/svg+xml');
  return document.importNode(doc.documentElement, true);
}

const quand = t => t ? new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(t)) : '—';
const depuis = t => {
  if (!t) return 'jamais';
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return 'à l’instant';
  if (s < 3600) return `il y a ${Math.round(s / 60)} min`;
  if (s < 86400) return `il y a ${Math.round(s / 3600)} h`;
  return quand(t);
};

let pileToasts;
export function toast(message, mauvais = false) {
  if (!pileToasts) { pileToasts = h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' }); document.body.append(pileToasts); }
  const t = h('div', { class: 'toast' + (mauvais ? ' bad' : ''), text: message });
  pileToasts.append(t);
  setTimeout(() => t.remove(), mauvais ? 7000 : 3800);
}

export function dialogue({ titre, texte, contenu = [], boutons = [], large = false, liste = false }) {
  return new Promise(resolve => {
    const precedent = document.activeElement;
    const fermer = v => { voile.remove(); document.removeEventListener('keydown', echap); precedent?.focus?.(); resolve(v); };
    const echap = e => { if (e.key === 'Escape') fermer(null); };
    const pied = h('div', { class: 'pied' }, boutons.map(b => h('button', {
      class: 'btn ' + (b.classe || ''), type: 'button', text: b.texte,
      onclick: async () => { if (b.agir) { const r = await b.agir(); if (r === false) return; fermer(r ?? b.valeur); } else fermer(b.valeur); },
    })));
    const boite = h('div', { class: 'dialogue' + (large ? ' large' : '') + (liste ? ' liste' : ''), role: 'dialog', 'aria-modal': 'true', 'aria-label': titre },
      h('h3', { text: titre }), texte ? h('p', { text: texte }) : null, contenu, pied);
    const voile = h('div', { class: 'voile', onclick: e => { if (e.target === voile) fermer(null); } }, boite);
    document.body.append(voile);
    document.addEventListener('keydown', echap);
    (boite.querySelector('input,select,textarea') || pied.lastElementChild)?.focus();
  });
}

// Effacement du compte par lui-même : l'identifiant retapé, puis le renfort
// que le serveur demande. Rien n'est effacé tant que le serveur n'a pas dit oui.
async function supprimerCompte(api, c) {
  const champ = h('input', { type: 'text', autocomplete: 'off', spellcheck: 'false', 'aria-label': 'Identifiant', placeholder: c.identifiant });
  const fait = await dialogue({
    titre: 'Supprimer ton compte ?',
    texte: 'Le compte, ses facteurs, ses appareils et ce que le service garde de lui sont effacés, sans retour possible. Retape ton identifiant pour confirmer.',
    contenu: [champ],
    boutons: [{ texte: 'Annuler', classe: 'flat', valeur: false }, { texte: 'Supprimer', classe: 'danger solid', agir: async () => {
      try { await api.post('/api/compte/supprimer', { identifiant: champ.value }); return true; } catch (e) { toast(e.message, true); return false; }
    } }],
  });
  if (fait) location.replace('/');
}

export const confirmer = (titre, texte, { danger = false, oui = 'Confirmer' } = {}) =>
  dialogue({ titre, texte, boutons: [{ texte: 'Annuler', classe: 'flat', valeur: false }, { texte: oui, classe: danger ? 'danger solid' : 'solid', valeur: true }] }).then(Boolean);

// Ce qu'une largeur étroite retire de l'écran reste joignable : les actions
// masquées se retrouvent ici, une par ligne.
export const feuille = (titre, actions) =>
  dialogue({ titre, liste: true, boutons: [...actions.map(a => ({ texte: a.texte, classe: 'flat' + (a.danger ? ' danger' : ''), valeur: a })), { texte: 'Fermer', classe: '', valeur: null }] })
    .then(a => a?.agir());

export class Api {
  constructor({ surDeconnexion } = {}) { this.csrf = null; this.surDeconnexion = surDeconnexion; }

  async req(methode, chemin, corps, { renfortFait = false } = {}) {
    const ecriture = !['GET', 'HEAD'].includes(methode);
    const r = await fetch(chemin, {
      method: methode, credentials: 'same-origin', cache: 'no-store',
      headers: { ...(ecriture ? { 'Content-Type': 'application/json' } : {}), ...(this.csrf ? { 'X-CSRF': this.csrf } : {}) },
      body: ecriture && methode !== 'DELETE' ? JSON.stringify(corps ?? {}) : undefined,
    });
    let json = null;
    try { json = await r.json(); } catch { /* réponse vide */ }
    if (json?.csrf) this.csrf = json.csrf;
    if (json?.session?.csrf) this.csrf = json.session.csrf;
    if (r.status === 403 && json?.details?.renfort && !renfortFait) {
      if (await renforcer(this, json.details.methodes)) return this.req(methode, chemin, corps, { renfortFait: true });
    }
    if (r.status === 401 && !chemin.startsWith('/api/compte/connexion')) this.surDeconnexion?.();
    if (!r.ok) {
      const e = new Error(json?.error || `Erreur ${r.status}`);
      e.status = r.status; e.details = json?.details;
      throw e;
    }
    return json;
  }
  get(c) { return this.req('GET', c); }
  post(c, b) { return this.req('POST', c, b); }
  put(c, b) { return this.req('PUT', c, b); }
  patch(c, b) { return this.req('PATCH', c, b); }
  del(c) { return this.req('DELETE', c); }
  etat() { return this.get('/api/compte/etat'); }
}

const versBuf = s => { const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)); return Uint8Array.from(b, c => c.charCodeAt(0)).buffer; };
const versB64 = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export const clesDisponibles = () => typeof window.PublicKeyCredential === 'function' && window.isSecureContext;

async function creerCle(o) {
  const publicKey = PublicKeyCredential.parseCreationOptionsFromJSON ? PublicKeyCredential.parseCreationOptionsFromJSON(o) : {
    ...o, challenge: versBuf(o.challenge), user: { ...o.user, id: versBuf(o.user.id) },
    excludeCredentials: (o.excludeCredentials || []).map(c => ({ ...c, id: versBuf(c.id) })),
  };
  const c = await navigator.credentials.create({ publicKey });
  if (c.toJSON) return c.toJSON();
  return {
    id: c.id, rawId: versB64(c.rawId), type: c.type,
    response: { clientDataJSON: versB64(c.response.clientDataJSON), attestationObject: versB64(c.response.attestationObject), transports: c.response.getTransports?.() || [] },
  };
}

async function utiliserCle(o) {
  const publicKey = PublicKeyCredential.parseRequestOptionsFromJSON ? PublicKeyCredential.parseRequestOptionsFromJSON(o) : {
    ...o, challenge: versBuf(o.challenge), allowCredentials: (o.allowCredentials || []).map(c => ({ ...c, id: versBuf(c.id) })),
  };
  const c = await navigator.credentials.get({ publicKey });
  if (c.toJSON) return c.toJSON();
  return {
    id: c.id, rawId: versB64(c.rawId), type: c.type,
    response: {
      clientDataJSON: versB64(c.response.clientDataJSON), authenticatorData: versB64(c.response.authenticatorData),
      signature: versB64(c.response.signature), userHandle: c.response.userHandle ? versB64(c.response.userHandle) : null,
    },
  };
}

function raisonCle(e) {
  if (e?.name === 'NotAllowedError') return 'Opération annulée ou délai dépassé.';
  if (e?.name === 'InvalidStateError') return 'Cette clé est déjà enregistrée sur ce compte.';
  if (e?.name === 'SecurityError') return 'Le navigateur refuse : la page doit être servie en HTTPS.';
  return e?.message || 'La clé d’accès n’a pas répondu.';
}

const nomAppareil = () => {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua)) return 'iPad';
  if (/Android/.test(ua)) return 'Android';
  if (/Mac OS X/.test(ua)) return 'Mac';
  if (/Windows/.test(ua)) return 'Windows';
  return 'Clé d’accès';
};

function resoudrePreuve(defi, base) {
  return new Promise((resolve, reject) => {
    const w = new Worker(new URL('preuve.js', base || import.meta.url));
    w.onmessage = ({ data }) => { w.terminate(); data.nonce ? resolve({ id: defi.id, nonce: data.nonce }) : reject(new Error('Vérification impossible.')); };
    w.onerror = () => { w.terminate(); reject(new Error('Vérification impossible.')); };
    w.postMessage({ sel: defi.sel, bits: defi.bits });
  });
}

let champs = 0;
function champ(etiquette, attrs = {}, aide) {
  const id = `champ-${++champs}`;
  const input = h('input', { class: 'field', id, ...attrs });
  return { input, noeud: h('label', { class: 'champ', for: id }, h('span', { class: 'lbl', text: etiquette }), input, aide ? h('p', { class: 'hint', text: aide }) : null) };
}

function casesCode(surComplet) {
  const cases = Array.from({ length: 6 }, (_, i) => h('input', {
    inputmode: 'numeric', autocomplete: i ? 'off' : 'one-time-code', maxlength: 6, 'aria-label': `Chiffre ${i + 1}`,
  }));
  const valeur = () => cases.map(c => c.value).join('');
  cases.forEach((c, i) => {
    c.addEventListener('input', () => {
      const chiffres = c.value.replace(/\D/g, '');
      if (chiffres.length > 1) {
        [...chiffres.slice(0, 6 - i)].forEach((d, j) => { cases[i + j].value = d; });
        cases[Math.min(5, i + chiffres.length - 1)].focus();
      } else {
        c.value = chiffres;
        if (chiffres && i < 5) cases[i + 1].focus();
      }
      if (/^\d{6}$/.test(valeur())) surComplet(valeur());
    });
    c.addEventListener('keydown', e => { if (e.key === 'Backspace' && !c.value && i) { cases[i - 1].focus(); cases[i - 1].value = ''; } });
  });
  return { noeud: h('div', { class: 'codes' }, cases.slice(0, 3), h('span', { class: 'tiret', text: '–' }), cases.slice(3)), vider: () => { cases.forEach(c => { c.value = ''; }); cases[0].focus(); }, focus: () => cases[0].focus() };
}

// Indication de solidité, à titre d'aide : le serveur seul décide.
function jauge(input) {
  const barre = h('i');
  const noeud = h('div', { class: 'force', 'aria-hidden': 'true' }, barre);
  input.addEventListener('input', () => {
    const v = input.value, n = [...v].length;
    const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^\w]/].filter(r => r.test(v)).length;
    const score = n < 12 ? 1 : n >= 20 || (n >= 14 && classes >= 3) ? 4 : n >= 16 || classes >= 3 ? 3 : 2;
    barre.style.width = `${Math.min(100, (n / 20) * 100)}%`;
    barre.dataset.n = score;
  });
  return noeud;
}

export function basculeTheme() {
  const b = h('button', { class: 'ghost bascule-theme', type: 'button', title: 'Clair ou sombre', 'aria-label': 'Changer de thème' });
  const peint = () => b.replaceChildren(icone(estSombre() ? 'soleil' : 'lune'));
  b.addEventListener('click', () => {
    document.documentElement.dataset.theme = estSombre() ? 'light' : 'dark';
    try { localStorage.setItem('theme', document.documentElement.dataset.theme); } catch { /* stockage indisponible */ }
    appliquerTheme();
    peint();
  });
  peint();
  return b;
}
// Sombre ou clair : le choix posé l'emporte ; sans choix, la gamme Console
// est sombre et SOMA suit le système.
export function estSombre() {
  const d = document.documentElement.dataset;
  return d.theme ? d.theme === 'dark' : d.gamme === 'console' || matchMedia('(prefers-color-scheme: dark)').matches;
}
export function appliquerTheme() {
  try { const t = localStorage.getItem('theme'); if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t; } catch { /* rien */ }
  // En gamme Console, la barre du navigateur mobile suit le fond de la page.
  if (document.documentElement.dataset.gamme === 'console') {
    for (const m of document.querySelectorAll('meta[name="theme-color"]')) m.content = estSombre() ? '#000000' : '#F7F7F8';
  }
}

// Promesse résolue quand la session est complète : le service peut alors
// monter son interface. marque : nœud du logo (optionnel).
export function porte({ api, service, marque = null, sousTitre = '' }) {
  return new Promise(resolve => {
    const wiz = h('div', { class: 'wiz' });
    const racine = h('div', { class: 'porte' }, h('div', { class: 'halos', 'aria-hidden': 'true' }, h('i'), h('i')), wiz,
      h('div', { class: 'credit', text: `${service} · Codex64` }));
    document.body.append(racine);

    const entete = (etapes = 0, courante = 0) => h('div', { class: 'whead' },
      h('div', { class: 'brand' }, h('div', { class: 'g' }, marque ? marque.cloneNode(true) : icone('bouclier', 18)),
        h('div', {}, h('b', { text: service }), h('span', { text: sousTitre || 'Accès protégé' })), h('div', { class: 'th' }, basculeTheme())),
      etapes > 1 ? h('div', { class: 'steps', 'aria-hidden': 'true' }, Array.from({ length: etapes }, (_, i) => h('i', { class: i < courante ? 'done' : i === courante ? 'now' : '' }))) : null);

    const ecran = ({ etapes, courante, titre, sous, corps = [], pied = [], large = false }) => {
      wiz.className = 'wiz' + (large ? ' large' : '');
      wiz.replaceChildren(entete(etapes, courante), h('div', { class: 'wbody' }, h('h1', { text: titre }), sous ? h('p', { class: 'sub', text: sous }) : null, corps),
        pied.length ? h('div', { class: 'wfoot' }, pied) : h('div', { class: 'wfoot' }));
      wiz.querySelector('input:not([type=checkbox])')?.focus();
    };

    const occupe = async (bouton, zoneErreur, fn) => {
      zoneErreur.textContent = '';
      bouton?.setAttribute('aria-busy', 'true');
      try { await fn(); } catch (e) { zoneErreur.textContent = e.message; } finally { bouton?.removeAttribute('aria-busy'); }
    };

    async function suite() {
      let e;
      try { e = await api.etat(); } catch { return ecran({ titre: 'Service injoignable', sous: 'Nouvel essai dans quelques secondes.' }), setTimeout(suite, 4000); }
      const jeton = /^#(invitation|reinit)=([\w-]{20,100})$/.exec(location.hash);
      const lien = /^#(courriel|pas-moi)=([\w-]{20,100})$/.exec(location.hash);
      if (lien) return ecranLien(lien[1], lien[2]);
      if (!e.installe) return installation(e);
      if (jeton && (!e.session || e.session.niveau === 'partiel')) return ecranJeton(e, jeton[1], jeton[2]);
      if (!e.session) return connexion(e);
      if (e.session.niveau === 'partiel') return second(e);
      if (e.session.niveau === 'inscription') return inscription(e);
      if (e.session.compte.facteurs.secours === 0) return codesSecours(e);
      racine.remove();
      resolve(e);
    }

    function installation(e) {
      const err = h('p', { class: 'erreur', role: 'alert' });
      const jeton = champ('Jeton d’installation', { autocomplete: 'off', class: 'field mono', spellcheck: false }, 'Affiché dans les journaux du service au premier démarrage (ou transmis par le Hub).');
      const ident = champ('Identifiant', { autocomplete: 'username', autocapitalize: 'none', spellcheck: false });
      const mdp = champ('Mot de passe', { type: 'password', autocomplete: 'new-password' }, 'Douze caractères au moins. Une phrase de quelques mots fait très bien l’affaire.');
      const go = h('button', { class: 'next', type: 'submit' }, 'Créer le compte', icone('fleche'));
      const form = h('form', { class: 'grpf', onsubmit: ev => {
        ev.preventDefault();
        occupe(go, err, async () => {
          await api.post('/api/compte/installation', { jeton: jeton.input.value.trim(), identifiant: ident.input.value.trim(), motDePasse: mdp.input.value });
          history.replaceState(null, '', location.pathname);
          suite();
        });
      } }, jeton.noeud, ident.noeud, mdp.noeud, jauge(mdp.input), err, h('div', { class: 'wfoot' }, go));
      if (e.parHub) {
        // Installé par le Hub : aucun jeton à recopier, le compte naît d'un lien.
        const verifier = h('button', { class: 'next', type: 'button', onclick: () => occupe(verifier, err, async () => suite()) }, 'J’ai ouvert le lien', icone('fleche'));
        ecran({ etapes: 3, courante: 0, titre: 'Premier compte', sous: `${service} a été installé par le Hub : c’est lui qui crée ton compte.`, corps: [
          h('ol', { class: 'etapes-hub' },
            h('li', { text: 'Dans le Hub : Comptes services, ouvre ce service, puis « Créer l’administrateur ».' }),
            h('li', { text: 'Ouvre le lien que le Hub affiche : tu choisis ton mot de passe, puis tes facteurs de connexion.' })),
          err,
          h('details', { class: 'sans-hub' }, h('summary', { text: 'Sans le Hub : jeton d’installation' }), form)],
          pied: [verifier] });
        return;
      }
      ecran({ etapes: 3, courante: 0, titre: 'Premier compte', sous: `Ce compte administre ${service}. Les facteurs de connexion viennent juste après.`, corps: [bandeauContexte(e), form] });
      wiz.lastElementChild.remove();
    }

    function connexion(e) {
      const err = h('p', { class: 'erreur', role: 'alert' });
      const ident = champ('Identifiant', { autocomplete: 'username webauthn', autocapitalize: 'none', spellcheck: false });
      const mdp = champ('Mot de passe', { type: 'password', autocomplete: 'current-password' });
      const go = h('button', { class: 'next', type: 'submit' }, 'Se connecter', icone('fleche'));
      const envoyer = async (preuve) => {
        try {
          await api.post('/api/compte/connexion', { identifiant: ident.input.value.trim(), motDePasse: mdp.input.value, ...(preuve ? { preuve } : {}) });
        } catch (x) {
          if (x.status === 428 && x.details?.preuve && !preuve) {
            go.firstChild.textContent = 'Vérification…';
            try { return await envoyer(await resoudrePreuve(x.details.preuve)); } finally { go.firstChild.textContent = 'Se connecter'; }
          }
          throw x;
        }
      };
      const form = h('form', { class: 'grpf', onsubmit: ev => {
        ev.preventDefault();
        occupe(go, err, async () => { await envoyer(); suite(); });
      } }, ident.noeud, mdp.noeud, err, h('div', { class: 'wfoot' }, go));
      const cle = e.cles && clesDisponibles() ? boutonCle('Se connecter avec une clé d’accès', 'Touch ID, Face ID, Windows Hello ou clé USB — sans mot de passe.', async () => {
        const o = await api.post('/api/compte/connexion/cle/options');
        await api.post('/api/compte/connexion/cle', { reponse: await utiliserCle(o) });
        suite();
      }, err) : null;
      const parMdp = e.politique.motdepasse !== 'desactive';
      ecran({ titre: 'Connexion', sous: parMdp ? null : 'Ce service se passe de mot de passe : ta clé d’accès suffit.', corps: [bandeauContexte(e), cle, cle && parMdp ? h('div', { class: 'separe', text: 'ou' }) : null, parMdp ? form : err] });
      wiz.lastElementChild.remove();
    }

    function boutonCle(titre, texte, agir, err) {
      const b = h('button', { class: 'pk', type: 'button' }, h('div', { class: 'pk-ic' }, icone('empreinte', 22)), h('div', { class: 'pk-txt' }, h('b', { text: titre }), h('p', { text: texte })));
      b.addEventListener('click', async () => {
        err.textContent = ''; b.classList.add('encours');
        try { await agir(); } catch (x) { err.textContent = x instanceof DOMException ? raisonCle(x) : x.message; } finally { b.classList.remove('encours'); }
      });
      return b;
    }

    function second(e, choisi) {
      const methodes = e.session.methodes || [];
      const mode = choisi || methodes[0];
      const err = h('p', { class: 'erreur', role: 'alert' });
      const autres = methodes.filter(m => m !== mode).map(m => h('button', { class: 'lnk', type: 'button', onclick: () => second(e, m),
        text: { totp: 'Utiliser l’application', cle: 'Utiliser une clé d’accès', secours: 'Utiliser un code de secours' }[m] }));
      let corps;
      if (mode === 'totp') {
        const c = casesCode(code => occupe(null, err, async () => {
          try { await api.post('/api/compte/connexion/totp', { code }); suite(); } catch (x) { c.vider(); throw x; }
        }));
        corps = [h('p', { class: 'sub', text: 'Le code à six chiffres affiché par ton application d’authentification.' }), c.noeud];
        setTimeout(c.focus, 50);
      } else if (mode === 'cle') {
        corps = [boutonCle('Confirmer avec ma clé d’accès', 'Le navigateur va te demander ton empreinte, ton visage ou le code de l’appareil.', async () => {
          const o = await api.post('/api/compte/connexion/cle/options');
          await api.post('/api/compte/connexion/cle', { reponse: await utiliserCle(o) });
          suite();
        }, err)];
      } else {
        const code = champ('Code de secours', { class: 'field mono', autocomplete: 'off', spellcheck: false, placeholder: 'XXXX-XXXX-XXXX-XXXX-XXXX' }, 'Chaque code ne sert qu’une fois. Pense à en régénérer ensuite.');
        const go = h('button', { class: 'next', type: 'submit' }, 'Valider', icone('fleche'));
        corps = [h('form', { class: 'grpf', onsubmit: ev => {
          ev.preventDefault();
          occupe(go, err, async () => { const r = await api.post('/api/compte/connexion/secours', { code: code.input.value }); toast(`Code accepté. Il t’en reste ${r.restants}.`); suite(); });
        } }, code.noeud, h('div', { class: 'wfoot' }, go))];
      }
      const annuler = h('button', { class: 'retour', type: 'button', onclick: async () => { await api.post('/api/compte/deconnexion').catch(() => {}); suite(); } }, icone('retour'), 'Changer de compte');
      ecran({ etapes: 2, courante: 1, titre: 'Deuxième étape', sous: e.session.compte.identifiant, corps: [corps, err, autres.length ? h('div', { class: 'grpf' }, autres) : null], pied: [annuler] });
    }

    // Liens reçus par courriel : un geste explicite, jamais à l'ouverture.
    function ecranLien(type, jeton) {
      const err = h('p', { class: 'erreur', role: 'alert' });
      const continuer = h('button', { class: 'next', type: 'button', onclick: () => { history.replaceState(null, '', location.pathname); suite(); } }, 'Continuer', icone('fleche'));
      const pasMoi = type === 'pas-moi';
      const go = h('button', { class: 'next' + (pasMoi ? ' danger' : ''), type: 'button', onclick: () => occupe(go, err, async () => {
        await api.post(pasMoi ? '/api/compte/pas-moi/lien' : '/api/compte/courriel/verifier', { jeton });
        history.replaceState(null, '', location.pathname);
        ecran(pasMoi
          ? { titre: 'Sessions fermées', sous: 'Plus aucun appareil n’est connecté à ce compte. Connecte-toi, change ton mot de passe et vérifie tes moyens de connexion.', pied: [continuer] }
          : { titre: 'Adresse confirmée', sous: 'Les alertes de sécurité de ce compte partent désormais vers elle.', pied: [continuer] });
      }) }, pasMoi ? 'Tout fermer' : 'Confirmer l’adresse');
      ecran(pasMoi
        ? { titre: 'Ce n’était pas toi ?', sous: 'Toutes les sessions de ce compte vont être fermées, sur tous les appareils, celle-ci comprise.', corps: [err], pied: [go] }
        : { titre: 'Adresse d’alerte', sous: 'Confirme pour recevoir à cette adresse les alertes de sécurité de ton compte.', corps: [err], pied: [go] });
    }

    async function ecranJeton(e, usage, jeton) {
      const err = h('p', { class: 'erreur', role: 'alert' });
      let v;
      try { v = await api.post('/api/compte/jeton/verifier', { usage, jeton }); } catch (x) { v = { valide: false }; }
      const oublier = () => { history.replaceState(null, '', location.pathname); suite(); };
      if (!v.valide) return ecran({ titre: 'Lien expiré', sous: 'Ce lien a déjà servi ou n’est plus valable. Demande-en un nouveau à l’administrateur.', pied: [h('button', { class: 'next', type: 'button', onclick: oublier }, 'Aller à la connexion')] });
      const mdp = champ('Nouveau mot de passe', { type: 'password', autocomplete: 'new-password' }, 'Douze caractères au moins. Une phrase de quelques mots fait très bien l’affaire.');
      const go = h('button', { class: 'next', type: 'submit' }, usage === 'invitation' ? 'Créer mon accès' : 'Changer le mot de passe', icone('fleche'));
      const form = h('form', { class: 'grpf', onsubmit: ev => {
        ev.preventDefault();
        occupe(go, err, async () => {
          const r = await api.post('/api/compte/jeton', { usage, jeton, motDePasse: mdp.input.value });
          history.replaceState(null, '', location.pathname);
          if (r.etape === 'connexion') toast('Mot de passe changé. Connecte-toi : ton second facteur te sera demandé.');
          suite();
        });
      } }, h('input', { type: 'text', autocomplete: 'username', value: v.identifiant, hidden: true, readOnly: true }), mdp.noeud, jauge(mdp.input), err, h('div', { class: 'wfoot' }, go));
      ecran({ titre: usage === 'invitation' ? 'Bienvenue' : 'Nouveau mot de passe', sous: `Compte « ${v.identifiant} ». ${usage === 'invitation' ? 'Choisis ton mot de passe ; tes facteurs de connexion viennent juste après.' : 'Seul le mot de passe change : ton second facteur restera demandé.'}`, corps: [form] });
      wiz.lastElementChild.remove();
    }

    function inscription(e) {
      const m = e.session.compte.manquants;
      if (m.includes('motdepasse')) return poserMotDePasse(e);
      if (m.includes('cle') && !(e.cles && clesDisponibles())) return cleImpossible(e);
      if (m.includes('cle')) return inscrireCle(e, true);
      if (m.includes('totp')) return inscrireTotp(e);
      return choisirSecond(e);
    }

    const piedDeconnexion = () => h('button', { class: 'retour', type: 'button', onclick: async () => { await api.post('/api/compte/deconnexion').catch(() => {}); suite(); } }, icone('sortie'), 'Se déconnecter');

    function choisirSecond(e) {
      const peutCle = e.cles && clesDisponibles() && e.politique.cle !== 'desactive';
      const peutTotp = e.politique.totp !== 'desactive';
      const opt = (ic, titre, texte, agir) => h('button', { class: 'opt', type: 'button', onclick: agir }, h('div', { class: 'ic' }, icone(ic, 18)), h('div', {}, h('b', { text: titre }), h('p', { text: texte })));
      ecran({ etapes: 3, courante: 1, titre: 'Un second facteur', sous: 'Un mot de passe seul ne suffit pas ici. Choisis ce qui confirmera que c’est bien toi.', corps: [h('div', { class: 'choix' },
        peutCle ? opt('empreinte', 'Clé d’accès (recommandé)', 'Touch ID, Face ID, Windows Hello ou une clé USB. Rien à recopier, impossible à hameçonner.', () => inscrireCle(e)) : null,
        peutTotp ? opt('telephone', 'Application d’authentification', 'Un code à six chiffres qui change toutes les trente secondes (Aegis, 2FAS, Google Authenticator…).', () => inscrireTotp(e)) : null)],
      pied: [piedDeconnexion()] });
    }

    async function inscrireTotp(e) {
      const err = h('p', { class: 'erreur', role: 'alert' });
      let t;
      try { t = await api.post('/api/compte/totp'); } catch (x) { return ecran({ titre: 'Impossible pour l’instant', sous: x.message, pied: [piedDeconnexion()] }); }
      const copier = h('button', { type: 'button', text: 'Copier', onclick: async () => { await navigator.clipboard?.writeText(t.secret); toast('Clé copiée.'); } });
      const c = casesCode(code => occupe(null, err, async () => {
        try { await api.post('/api/compte/totp/confirmer', { code }); toast('Application enregistrée.'); suite(); } catch (x) { c.vider(); throw x; }
      }));
      ecran({ etapes: 3, courante: 1, titre: 'Application d’authentification', large: true,
        sous: 'Scanne ce QR code avec ton application, puis tape le code qu’elle affiche. Il est généré ici, dans ton navigateur : le secret ne quitte pas cette page.',
        corps: [h('div', { class: 'a2f' }, h('div', { class: 'qr' }, noeudQr(t.otpauth, 150)), h('div', {},
          h('span', { class: 'lbl', text: 'Ou saisis cette clé' }), h('div', { class: 'secret' }, h('span', { class: 'coupe', text: t.secret.match(/.{1,4}/g).join(' ') }), copier),
          h('p', { class: 'hint' }, 'Sur ce téléphone ? ', h('a', { class: 'lnk', href: t.otpauth, text: 'Ouvrir dans l’application' })),
          h('span', { class: 'lbl', text: 'Code affiché' }), c.noeud, err))],
        pied: [h('button', { class: 'retour', type: 'button', onclick: () => inscription(e) }, icone('retour'), 'Autre méthode')] });
      setTimeout(c.focus, 50);
    }

    function inscrireCle(e, exigee = false) {
      const err = h('p', { class: 'erreur', role: 'alert' });
      const nom = champ('Nom de cette clé', { value: nomAppareil(), maxlength: 60 }, 'Pour la reconnaître dans la liste : « MacBook », « YubiKey bleue »…');
      ecran({ etapes: 3, courante: 1, titre: 'Clé d’accès',
        sous: exigee ? 'Un administrateur tient une clé d’accès : c’est le seul facteur qu’un faux site ne peut pas voler.' : 'Ton appareil garde la clé ; le service ne reçoit que sa partie publique.',
        corps: [nom.noeud, h('div', { class: 'grpf' }, boutonCle('Créer la clé maintenant', 'Le navigateur va te demander ton empreinte, ton visage ou le code de l’appareil.', async () => {
          const o = await api.post('/api/compte/cles/options');
          await api.post('/api/compte/cles', { reponse: await creerCle(o), nom: nom.input.value });
          toast('Clé d’accès enregistrée.');
          suite();
        }, err)), err],
        pied: [exigee ? piedDeconnexion() : h('button', { class: 'retour', type: 'button', onclick: () => inscription(e) }, icone('retour'), 'Autre méthode')] });
    }

    function cleImpossible(e) {
      ecran({ titre: 'Clé d’accès requise', sous: 'La politique de ce service exige une clé d’accès pour ce compte, et le navigateur n’en crée que sur une page HTTPS.',
        corps: [h('div', { class: 'note warn grpf' }, icone('alerte'), h('div', {},
          'Ouvre ce service par son adresse HTTPS (Relay ou certificat du Hub). ',
          'À défaut, l’administrateur peut démarrer le service avec SOCLE_HTTP=1 : il reste alors en mode dégradé, affiché comme tel.'))],
        pied: [piedDeconnexion()] });
    }

    function poserMotDePasse(e) {
      const err = h('p', { class: 'erreur', role: 'alert' });
      const mdp = champ('Mot de passe', { type: 'password', autocomplete: 'new-password' }, 'La politique du service exige un mot de passe en plus de ta clé.');
      const go = h('button', { class: 'next', type: 'submit' }, 'Enregistrer', icone('fleche'));
      ecran({ titre: 'Mot de passe', corps: [h('form', { class: 'grpf', onsubmit: ev => { ev.preventDefault(); occupe(go, err, async () => { await api.post('/api/compte/motdepasse', { nouveau: mdp.input.value }); suite(); }); } },
        h('input', { type: 'text', autocomplete: 'username', value: e.session.compte.identifiant, hidden: true, readOnly: true }), mdp.noeud, jauge(mdp.input), err, h('div', { class: 'wfoot' }, go))] });
      wiz.lastElementChild.remove();
    }

    // Codes de secours, montrés une seule fois.
    async function codesSecours(e) {
      const err = h('p', { class: 'erreur', role: 'alert' });
      let r;
      try { r = await api.post('/api/compte/secours'); } catch (x) { return ecran({ titre: 'Codes de secours', sous: x.message, pied: [h('button', { class: 'next', type: 'button', onclick: () => { racine.remove(); resolve(e); } }, 'Continuer')] }); }
      const coche = h('input', { type: 'checkbox', id: 'range' });
      const go = h('button', { class: 'next', type: 'button', disabled: true, onclick: () => suite() }, 'Terminer', icone('verifie'));
      coche.addEventListener('change', () => { go.disabled = !coche.checked; });
      ecran({ etapes: 3, courante: 2, titre: 'Codes de secours', large: true,
        sous: 'Si tu perds tes appareils, chacun de ces codes remplace une fois le second facteur. Ils ne seront plus jamais affichés : range-les hors de cet ordinateur.',
        corps: [...blocCodes(r.codes, service), err, h('label', { class: 'note info grpf', for: 'range' }, coche, h('div', { text: 'J’ai rangé ces codes en lieu sûr.' }))],
        pied: [go] });
    }

    suite();
  });
}

function blocCodes(codes, service) {
  const texte = `Codes de secours — ${service}\nChaque code ne sert qu’une fois.\n\n${codes.join('\n')}\n`;
  return [
    h('div', { class: 'secours' }, codes.map(c => h('code', { text: c }))),
    h('div', { class: 'actions grpf' },
      h('button', { class: 'btn sm', type: 'button', onclick: async () => { await navigator.clipboard?.writeText(texte); toast('Codes copiés.'); } }, icone('copie'), 'Copier'),
      h('a', { class: 'btn sm', href: 'data:text/plain;charset=utf-8,' + encodeURIComponent(texte), download: `codes-secours-${service.toLowerCase().replace(/\W+/g, '-')}.txt` }, icone('telecharge'), 'Télécharger')),
  ];
}

function bandeauContexte(e) {
  if (e.modeHttp) return h('div', { class: 'note warn grpf' }, icone('alerte'), h('div', { text: 'Mode HTTP : ce service n’est pas chiffré sur le réseau et n’accepte pas de clé d’accès. À réserver à un réseau de confiance, le temps de le servir en HTTPS.' }));
  if (!e.securise && !e.cles) return h('div', { class: 'note warn grpf' }, icone('alerte'), h('div', { text: 'Connexion non chiffrée : les clés d’accès ne sont disponibles qu’en HTTPS.' }));
  return null;
}

// Confirmation d'identité avant une action sensible, avec le facteur le plus
// fort du compte. Résout vrai si la session a été renforcée.
export function renforcer(api, methodes = ['motdepasse']) {
  const m = methodes[0];
  const err = h('p', { class: 'erreur', role: 'alert' });
  const valider = async corps => { await api.post('/api/compte/renfort', { methode: m, ...corps }); return true; };
  let contenu, agir;
  if (m === 'cle') {
    contenu = [h('p', { class: 'hint', text: 'Ta clé d’accès confirme que c’est bien toi.' })];
    agir = async () => {
      try { const o = await api.post('/api/compte/renfort/options'); return await valider({ reponse: await utiliserCle(o) }); }
      catch (x) { err.textContent = x instanceof DOMException ? raisonCle(x) : x.message; return false; }
    };
  } else if (m === 'totp') {
    let code = '';
    const c = casesCode(v => { code = v; });
    contenu = [c.noeud];
    agir = async () => { try { return await valider({ code }); } catch (x) { err.textContent = x.message; c.vider(); return false; } };
  } else {
    const mdp = champ('Mot de passe', { type: 'password', autocomplete: 'current-password' });
    contenu = [mdp.noeud];
    agir = async () => { try { return await valider({ motDePasse: mdp.input.value }); } catch (x) { err.textContent = x.message; return false; } };
  }
  return dialogue({ titre: 'Confirme ton identité', texte: 'Cette action touche à la sécurité. La confirmation vaut cinq minutes.', contenu: [...contenu, err],
    boutons: [{ texte: 'Annuler', classe: 'flat', valeur: false }, { texte: m === 'cle' ? 'Utiliser ma clé' : 'Confirmer', classe: 'solid', agir }] }).then(Boolean);
}

const LIBELLES_ALERTES = {
  'connexion.appareil': 'Connexion depuis un nouvel appareil',
  'facteur.ajoute': 'Facteur ajouté', 'facteur.retire': 'Facteur retiré',
  'motdepasse.change': 'Mot de passe changé', 'motdepasse.reinitialise': 'Mot de passe réinitialisé',
  'secours.utilise': 'Code de secours utilisé', 'secours.regeneres': 'Codes de secours régénérés',
  'role.change': 'Rôle modifié', 'cle.clonee': 'Clé d’accès suspecte (compteur en recul)',
  'courriel.change': 'Adresse d’alerte changée', 'courriel.retire': 'Adresse d’alerte retirée',
  'vigie.admin': 'Un administrateur s’est connecté depuis un nouvel appareil', 'vigie.connexions': 'Rafale d’échecs de connexion',
  'vigie.refus': 'Rafale d’accès refusés', 'vigie.limites': 'Limites de tentatives atteintes à répétition',
  'vigie.erreurs': 'Erreurs internes en série', 'service.depense': 'Dépense inhabituelle',
};
const detailAlerte = a => {
  const d = a.details || {};
  if (a.type === 'vigie.admin') return `compte ${d.identifiant}`;
  if (a.type.startsWith('vigie.')) return `${d.nombre} en ${d.minutes} min`;
  return [d.facteur ? `(${LIBELLE_FACTEUR[d.facteur] || d.facteur})` : '', d.nom ? `« ${d.nom} »` : '', d.texte || ''].filter(Boolean).join(' ');
};
const LIBELLE_FACTEUR = { totp: 'application', cle: 'clé d’accès', motdepasse: 'mot de passe' };

export function pageSecurite(api, { service, confidentialite = null }) {
  const page = h('div', { class: 'page' });
  async function peindre() {
    let d;
    try { d = await api.get('/api/compte/securite'); } catch (x) { page.replaceChildren(h('p', { class: 'erreur', text: x.message })); return; }
    const c = d.compte, pol = d.politique;
    const action = (texte, classe, fn) => h('button', { class: 'btn sm ' + classe, type: 'button', onclick: async ev => {
      ev.currentTarget.setAttribute('aria-busy', 'true');
      try { await fn(); } catch (x) { toast(x.message, true); } finally { peindre(); }
    } }, texte);

    const ligne = (ic, titre, detail, actions, cle = '') => h('div', { class: 'flowrow' },
      h('div', { class: 'itile ' + cle }, icone(ic)), h('div', {}, h('strong', { text: titre }), h('small', { text: detail })), h('div', { class: 'fin' }, actions));

    const facteurs = h('div', { class: 'card' }, h('header', {}, h('h2', { text: 'Moyens de connexion' }), h('span', { class: 'note cache-s', text: `politique : mot de passe ${pol.motdepasse.replace('_', ' ')} · application ${pol.totp.replace('_', ' ')} · clé ${pol.cle.replace('_', ' ')}` })),
      ligne('cadenas', 'Mot de passe', c.facteurs.motdepasse ? 'Défini' : 'Aucun — connexion par clé d’accès', [
        pol.motdepasse !== 'desactive' ? action(c.facteurs.motdepasse ? 'Changer' : 'Définir', '', () => changerMdp(api, c)) : null,
        c.facteurs.motdepasse ? action('Retirer', 'flat danger cache-s', async () => { if (await confirmer('Retirer le mot de passe ?', 'Tu ne te connecteras plus qu’avec tes clés d’accès.', { danger: true, oui: 'Retirer' })) { await api.del('/api/compte/motdepasse'); toast('Mot de passe retiré.'); } }) : null]),
      ligne('telephone', 'Application d’authentification', c.facteurs.totp ? 'Enregistrée' : 'Aucune', [
        !c.facteurs.totp && pol.totp !== 'desactive' ? action('Ajouter', '', () => ajouterTotp(api)) : null,
        c.facteurs.totp ? action('Retirer', 'flat danger', async () => { if (await confirmer('Retirer l’application ?', 'Ses codes ne seront plus acceptés.', { danger: true, oui: 'Retirer' })) { await api.del('/api/compte/totp'); toast('Application retirée.'); } }) : null], c.facteurs.totp ? 'key' : ''),
      d.cles.map(k => ligne('empreinte', k.nom, `Créée ${quand(k.cree)} · ${k.utilisee ? `utilisée ${depuis(k.utilisee)}` : 'jamais utilisée'}${k.sauvegardee ? ' · synchronisée' : ''}`, [
        action('Renommer', 'flat cache-s', async () => { const n = await demander('Renommer la clé', k.nom); if (n) { await api.patch(`/api/compte/cles/${k.id}`, { nom: n }); toast('Clé renommée.'); } }),
        action('Retirer', 'flat danger', async () => { if (await confirmer(`Retirer « ${k.nom} » ?`, 'Cet appareil ne pourra plus ouvrir de session.', { danger: true, oui: 'Retirer' })) { await api.del(`/api/compte/cles/${k.id}`); toast('Clé retirée.'); } })], 'key')),
      pol.cle !== 'desactive' ? ligne('plus', 'Ajouter une clé d’accès', d.clesPossibles && clesDisponibles() ? `${d.cles.length} sur 20 · Touch ID, Face ID, Windows Hello ou clé USB` : 'Disponible uniquement en HTTPS', [
        d.clesPossibles && clesDisponibles() ? action('Ajouter', 'solid', () => ajouterCle(api)) : null]) : null,
      ligne('bouee', 'Codes de secours', `${c.facteurs.secours} sur 10 restants`, [action('Régénérer', '', async () => {
        if (!await confirmer('Régénérer les codes ?', 'Les anciens codes cesseront immédiatement de fonctionner.', { oui: 'Régénérer' })) return;
        const r = await api.post('/api/compte/secours');
        await dialogue({ titre: 'Nouveaux codes de secours', texte: 'Ils ne seront plus affichés. Range-les hors de cet ordinateur.', contenu: blocCodes(r.codes, service), boutons: [{ texte: 'C’est rangé', classe: 'solid', valeur: true }], large: true });
      })], c.facteurs.secours < 3 ? 'hot' : ''));

    const sessions = h('div', { class: 'card' }, h('header', {}, h('h2', { text: 'Appareils connectés' }), h('span', { class: 'note', text: `${d.sessions.length} session${d.sessions.length > 1 ? 's' : ''}` })),
      d.sessions.map(s => ligne('ecran', s.appareil || 'Appareil', `${s.ip || 'adresse inconnue'} · vue ${depuis(s.vue)}`,
        s.courante ? h('span', { class: 'chip a', text: 'Cet appareil' }) : action('Déconnecter', 'flat', async () => { await api.del(`/api/compte/sessions/${s.id}`); toast('Session fermée.'); }))),
      d.sessions.length > 1 ? h('div', { class: 'pad' }, action('Déconnecter tous les autres appareils', '', async () => { await api.del('/api/compte/sessions'); toast('Autres sessions fermées.'); })) : null);

    const alertes = h('div', { class: 'card' }, h('header', {}, h('h2', { text: 'Événements de sécurité' }), h('p', { text: 'Tout ce qui a touché à ton compte. Si une ligne ne te dit rien, ferme toutes les sessions et change ton mot de passe.' })),
      d.alertes.length ? d.alertes.slice(0, 12).map(a => h('div', { class: 'notice' }, h('div', { class: 'itile ' + (/secours|clonee|retire/.test(a.type) ? 'hot' : '') }, icone(/connexion/.test(a.type) ? 'ecran' : 'bouclier')),
        h('div', {}, h('p', { text: [LIBELLES_ALERTES[a.type] || a.type, detailAlerte(a)].filter(Boolean).join(' ') }),
          h('span', { class: 'when', text: [quand(a.t), a.details?.ip, a.details?.appareil].filter(Boolean).join(' · ') })))) : h('p', { class: 'vide', text: 'Rien à signaler.' }),
      h('div', { class: 'pad' }, action('Ce n’était pas moi', 'danger', async () => {
        if (!await confirmer('Tout fermer ?', 'Toutes les sessions de ce compte, celle-ci comprise, seront fermées. Change ensuite ton mot de passe.', { danger: true, oui: 'Tout fermer' })) return;
        await api.post('/api/compte/pas-moi'); location.reload();
      })));

    const courriel = h('div', { class: 'card' }, h('header', {}, h('h2', { text: 'Alertes par courriel' }), h('p', { text: 'Chaque connexion d’un nouvel appareil et chaque changement de facteur y sont signalés, avec un lien qui ferme toutes les sessions.' })),
      d.envoiCourriel
        ? ligne('enveloppe', c.courriel || 'Aucune adresse', c.courriel ? 'Vérifiée · reçoit les alertes' : 'Les alertes restent visibles ici seulement', [
          action(c.courriel ? 'Changer' : 'Ajouter', c.courriel ? '' : 'solid', () => demanderCourriel(api)),
          c.courriel ? action('Retirer', 'flat danger cache-s', async () => { if (await confirmer('Retirer l’adresse ?', 'Les alertes ne seront plus envoyées. L’adresse actuelle en sera prévenue.', { danger: true, oui: 'Retirer' })) { await api.del('/api/compte/courriel'); toast('Adresse retirée.'); } }) : null])
        : h('div', { class: 'pad' }, h('div', { class: 'note info' }, icone('alerte'), h('div', { text: 'Ce service n’envoie pas encore de courriel : l’administrateur doit lui indiquer un relais SMTP. En attendant, les alertes restent visibles ci-dessous.' }))));

    const donnees = h('div', { class: 'card' }, h('header', {}, h('h2', { text: 'Mes données' }), h('p', {}, 'Tout ce que ce service garde de ton compte, dans un fichier JSON ; et le compte lui-même, que tu peux supprimer avec ce qu’il contient.',
      confidentialite ? [' ', h('a', { href: confidentialite, target: '_blank', rel: 'noopener', text: 'Ce que le service garde, et pourquoi' }), '.'] : null)),
      ligne('telecharge', 'Exporter mes données', 'Compte, facteurs (sans leurs secrets), appareils, événements et contenus du service', [action('Exporter', '', async () => {
        const exporte = await api.get('/api/compte/export');
        const url = URL.createObjectURL(new Blob([JSON.stringify(exporte, null, 2)], { type: 'application/json' }));
        const lien = h('a', { href: url, download: `${service.toLowerCase().replace(/[^a-z0-9-]+/g, '-')}-${c.identifiant.replace(/[^\w-]+/g, '_')}.json`, hidden: true });
        document.body.append(lien); lien.click(); lien.remove();
        setTimeout(() => URL.revokeObjectURL(url), 10_000);
      })]),
      ligne('corbeille', 'Supprimer mon compte', c.role === 'admin' ? 'Possible s’il reste un autre administrateur actif' : 'Le compte, ses facteurs, ses appareils et ce que le service garde de lui', [action('Supprimer', 'flat danger', () => supprimerCompte(api, c))]));

    page.replaceChildren(...[
      h('div', { class: 'headrow' }, h('div', {}, h('h1', { class: 'title', text: 'Sécurité' }), h('p', { class: 'lede', text: `Connecté en tant que ${c.identifiant} (${c.role}). Chaque changement ici demande une confirmation récente et ferme tes autres sessions.` }))),
      d.modeHttp ? h('div', { class: 'note warn' }, icone('alerte'), h('div', { text: 'Mode HTTP : clés d’accès indisponibles et trafic non chiffré. Sers ce service en HTTPS pour sortir de ce mode.' })) : null,
      facteurs, courriel, h('div', { class: 'split' }, sessions, alertes), donnees].filter(Boolean));
    if (d.alertes.some(a => !a.vue)) api.post('/api/compte/alertes/vues').catch(() => {});
  }
  peindre();
  return page;
}

function demander(titre, valeur = '', { etiquette = 'Nom', type = 'text' } = {}) {
  const c = champ(etiquette, { value: valeur, type, maxlength: 60 });
  return dialogue({ titre, contenu: [c.noeud], boutons: [{ texte: 'Annuler', classe: 'flat', valeur: null }, { texte: 'Enregistrer', classe: 'solid', agir: () => c.input.value.trim() || false }] });
}

async function demanderCourriel(api) {
  const err = h('p', { class: 'erreur', role: 'alert' });
  const adresse = champ('Adresse', { type: 'email', autocomplete: 'email', maxlength: 254, spellcheck: false }, 'Un lien de confirmation y part ; il expire dans trente minutes.');
  await dialogue({ titre: 'Adresse d’alerte', contenu: [adresse.noeud, err],
    boutons: [{ texte: 'Annuler', classe: 'flat', valeur: false }, { texte: 'Envoyer le lien', classe: 'solid', agir: async () => {
      try { const r = await api.post('/api/compte/courriel', { adresse: adresse.input.value.trim() }); toast(`Lien envoyé à ${r.attente}.`); return true; } catch (x) { err.textContent = x.message; return false; }
    } }] });
}

async function changerMdp(api, compte) {
  const err = h('p', { class: 'erreur', role: 'alert' });
  const mdp = champ('Nouveau mot de passe', { type: 'password', autocomplete: 'new-password' }, 'Douze caractères au moins. Tes autres sessions seront fermées.');
  await dialogue({ titre: 'Mot de passe', contenu: [h('input', { type: 'text', autocomplete: 'username', value: compte.identifiant, hidden: true, readOnly: true }), mdp.noeud, jauge(mdp.input), err],
    boutons: [{ texte: 'Annuler', classe: 'flat', valeur: false }, { texte: 'Enregistrer', classe: 'solid', agir: async () => {
      try { await api.post('/api/compte/motdepasse', { nouveau: mdp.input.value }); toast('Mot de passe enregistré.'); return true; } catch (x) { err.textContent = x.message; return false; }
    } }] });
}

async function ajouterTotp(api) {
  const t = await api.post('/api/compte/totp');
  const err = h('p', { class: 'erreur', role: 'alert' });
  let code = '';
  const c = casesCode(v => { code = v; });
  await dialogue({ titre: 'Application d’authentification', texte: 'Scanne le QR code, puis tape le code affiché. Il est généré dans ton navigateur.', large: true,
    contenu: [h('div', { class: 'a2f' }, h('div', { class: 'qr' }, noeudQr(t.otpauth, 150)), h('div', {}, h('span', { class: 'lbl', text: 'Ou saisis cette clé' }),
      h('div', { class: 'secret' }, h('span', { class: 'coupe', text: t.secret.match(/.{1,4}/g).join(' ') })), h('span', { class: 'lbl', text: 'Code affiché' }), c.noeud)), err],
    boutons: [{ texte: 'Annuler', classe: 'flat', valeur: false }, { texte: 'Vérifier', classe: 'solid', agir: async () => {
      try { await api.post('/api/compte/totp/confirmer', { code }); toast('Application enregistrée.'); return true; } catch (x) { err.textContent = x.message; c.vider(); return false; }
    } }] });
}

async function ajouterCle(api) {
  const err = h('p', { class: 'erreur', role: 'alert' });
  const nom = champ('Nom de cette clé', { value: nomAppareil(), maxlength: 60 });
  await dialogue({ titre: 'Nouvelle clé d’accès', texte: 'Le navigateur va te demander ton empreinte, ton visage, le code de l’appareil ou ta clé USB.', contenu: [nom.noeud, err],
    boutons: [{ texte: 'Annuler', classe: 'flat', valeur: false }, { texte: 'Créer la clé', classe: 'solid', agir: async () => {
      try {
        const o = await api.post('/api/compte/cles/options');
        await api.post('/api/compte/cles', { reponse: await creerCle(o), nom: nom.input.value });
        toast('Clé d’accès enregistrée.'); return true;
      } catch (x) { err.textContent = x instanceof DOMException ? raisonCle(x) : x.message; return false; }
    } }] });
}

const NIVEAUX = [['desactive', 'Désactivé'], ['facultatif', 'Facultatif'], ['requis', 'Requis pour tous'], ['requis_admin', 'Requis pour les admins']];

export function pageComptes(api, { service }) {
  const page = h('div', { class: 'page' });
  async function peindre() {
    let liste, pol, journal;
    try {
      [liste, pol, journal] = await Promise.all([api.get('/api/compte/admin/comptes'), api.get('/api/compte/admin/politique'), api.get('/api/compte/admin/journal')]);
    } catch (x) { page.replaceChildren(h('p', { class: 'erreur', text: x.message })); return; }
    const action = (texte, classe, fn) => h('button', { class: 'btn sm ' + classe, type: 'button', onclick: async () => { try { await fn(); } catch (x) { toast(x.message, true); } finally { peindre(); } } }, texte);
    const facteursTxt = c => [c.facteurs.motdepasse ? 'mot de passe' : null, c.facteurs.totp ? 'application' : null, c.facteurs.cles ? `${c.facteurs.cles} clé${c.facteurs.cles > 1 ? 's' : ''}` : null].filter(Boolean).join(' · ') || 'aucun facteur';

    const table = h('div', { class: 'card' }, h('header', {}, h('h2', { text: 'Tous les comptes' }), h('span', { class: 'note', text: `${liste.comptes.length}` })),
      h('div', { class: 'tw' }, h('table', {}, h('thead', {}, h('tr', {}, h('th', { text: 'Compte' }), h('th', { class: 'cache-m', text: 'Facteurs' }), h('th', { class: 'cache-l', text: 'Dernière connexion' }), h('th', { class: 'fin', text: '' }))),
        h('tbody', {}, liste.comptes.map(c => h('tr', {},
          h('td', { class: 'principal' }, h('div', { class: 'who-cell' }, h('div', { class: 'itile' + (c.role === 'admin' ? ' key' : '') }, icone(c.role === 'admin' ? 'bouclier' : 'utilisateurs')),
            h('div', {}, h('b', { text: c.affichage }), h('small', { text: `${c.identifiant} · ${c.role}${c.actif ? '' : ' · désactivé'}` })))),
          h('td', { class: 'cache-m' }, h('span', { class: 'dim une-ligne', text: facteursTxt(c) }), c.manquants.length ? h('span', { class: 'chip o', text: 'inscription incomplète' }) : null),
          h('td', { class: 'cache-l mono', text: depuis(c.derniere) }),
          h('td', { class: 'fin' }, h('div', { class: 'actions' },
            action('Rôle', 'flat', () => changerRole(api, c)),
            action('Réinitialiser', 'flat cache-s', async () => { const r = await api.post(`/api/compte/admin/comptes/${c.id}/reinit`); await montrerLien('Lien de réinitialisation', `Valable 20 minutes, une seule fois. Transmets-le à ${c.identifiant} ; son second facteur restera demandé.`, r.lien); }),
            action(c.actif ? 'Désactiver' : 'Réactiver', 'flat cache-s', () => api.patch(`/api/compte/admin/comptes/${c.id}`, { actif: !c.actif })),
            action('Supprimer', 'flat danger cache-m', async () => { if (await confirmer(`Supprimer ${c.identifiant} ?`, 'Le compte, ses facteurs et ses sessions disparaissent.', { danger: true, oui: 'Supprimer' })) await api.del(`/api/compte/admin/comptes/${c.id}`); })))))))));

    const selects = {};
    const politique = h('div', { class: 'card' }, h('header', {}, h('h2', { text: 'Politique des facteurs' }), h('p', { text: 'Quels facteurs chaque compte doit détenir. Un compte qui ne respecte plus la politique est ramené à l’inscription à sa requête suivante.' })),
      h('div', { class: 'pad' }, h('div', { class: 'row2' }, [['motdepasse', 'Mot de passe'], ['totp', 'Application d’authentification'], ['cle', 'Clé d’accès']].map(([k, l]) => {
        const s = h('select', { class: 'field' }, NIVEAUX.map(([v, t]) => h('option', { value: v, text: t, selected: pol[k] === v })));
        selects[k] = s;
        return h('label', { class: 'champ' }, h('span', { class: 'lbl', text: l }), s);
      })), h('p', { class: 'aide', text: 'Quoi qu’il arrive : une connexion exige toujours un second facteur ou une clé d’accès, et un administrateur tient deux facteurs dont une clé.' }),
      h('div', { class: 'actions grpf' }, action('Enregistrer la politique', 'solid', async () => { await api.put('/api/compte/admin/politique', Object.fromEntries(Object.entries(selects).map(([k, s]) => [k, s.value]))); toast('Politique enregistrée.'); }))));

    const trace = h('div', { class: 'card' }, h('header', {}, h('h2', { text: 'Journal de sécurité' }), h('span', { class: 'note', text: journal.integrite.ok ? `chaîne intacte · ${journal.integrite.lignes} lignes` : `chaîne rompue à la ligne ${journal.integrite.rupture}` })),
      journal.lignes.slice(0, 30).map(l => h('div', { class: 'notice' }, h('div', { class: 'itile' + (l.resultat !== 'ok' ? ' hot' : '') }, icone(l.resultat !== 'ok' ? 'alerte' : 'journal')),
        h('div', {}, h('p', { text: `${l.action}${l.resultat !== 'ok' ? ' — ' + l.resultat : ''}` }), h('span', { class: 'when', text: [quand(l.t), l.ip, l.acteur ? (liste.comptes.find(c => c.id === l.acteur)?.identifiant || l.acteur) : null].filter(Boolean).join(' · ') })))),
      h('div', { class: 'pad' }, action('Fermer toutes les sessions (incident)', 'danger', async () => {
        if (await confirmer('Fermer toutes les sessions ?', 'Tous les comptes seront déconnectés, sauf cette session. À faire en cas de fuite ou de doute.', { danger: true, oui: 'Tout fermer' })) { await api.post('/api/compte/admin/sessions/fermer-tout'); toast('Sessions fermées.'); }
      })));

    page.replaceChildren(
      h('div', { class: 'headrow' }, h('div', {}, h('h1', { class: 'title', text: 'Comptes' }), h('p', { class: 'lede', text: `Qui accède à ${service}, avec quels facteurs. Un administrateur invite ; chacun pose lui-même son mot de passe et ses facteurs.` })),
        h('div', { class: 'actions' }, h('button', { class: 'btn solid', type: 'button', onclick: () => inviter(api).then(peindre) }, icone('plus'), 'Inviter'))),
      table, h('div', { class: 'split' }, politique, trace));
  }
  peindre();
  return page;
}

async function inviter(api) {
  const err = h('p', { class: 'erreur', role: 'alert' });
  const ident = champ('Identifiant', { autocapitalize: 'none', spellcheck: false });
  const nom = champ('Nom affiché', {});
  const role = h('select', { class: 'field' }, h('option', { value: 'membre', text: 'Membre' }), h('option', { value: 'lecture', text: 'Lecture seule' }));
  const r = await dialogue({ titre: 'Inviter', texte: 'Tu obtiendras un lien valable 72 heures. La personne y choisit son mot de passe et inscrit ses facteurs.',
    contenu: [ident.noeud, nom.noeud, h('label', { class: 'champ' }, h('span', { class: 'lbl', text: 'Rôle' }), role), err],
    boutons: [{ texte: 'Annuler', classe: 'flat', valeur: null }, { texte: 'Créer le lien', classe: 'solid', agir: async () => {
      try { return await api.post('/api/compte/admin/comptes', { identifiant: ident.input.value.trim(), affichage: nom.input.value.trim() || undefined, role: role.value }); }
      catch (x) { err.textContent = x.message; return false; }
    } }] });
  if (r?.lien) await montrerLien('Lien d’invitation', 'Valable 72 heures, une seule fois. Scanne-le avec le téléphone de la personne ou envoie-le lui par un canal sûr.', r.lien);
}

function montrerLien(titre, texte, lien) {
  return dialogue({ titre, texte, large: true, contenu: [h('div', { class: 'a2f' }, h('div', { class: 'qr' }, noeudQr(lien, 150)),
    h('div', {}, h('span', { class: 'lbl', text: 'Lien' }), h('div', { class: 'secret' }, h('span', { class: 'coupe mono', text: lien }),
      h('button', { type: 'button', text: 'Copier', onclick: async () => { await navigator.clipboard?.writeText(lien); toast('Lien copié.'); } }))))],
    boutons: [{ texte: 'Fermer', classe: 'solid', valeur: true }] });
}

async function changerRole(api, c) {
  const s = h('select', { class: 'field' }, [['admin', 'Administrateur'], ['membre', 'Membre'], ['lecture', 'Lecture seule']].map(([v, t]) => h('option', { value: v, text: t, selected: c.role === v })));
  const err = h('p', { class: 'erreur', role: 'alert' });
  await dialogue({ titre: `Rôle de ${c.identifiant}`, texte: 'Un administrateur doit déjà tenir deux facteurs, dont une clé d’accès. Ses sessions seront fermées.',
    contenu: [h('label', { class: 'champ' }, h('span', { class: 'lbl', text: 'Rôle' }), s), err],
    boutons: [{ texte: 'Annuler', classe: 'flat', valeur: false }, { texte: 'Appliquer', classe: 'solid', agir: async () => {
      try { await api.patch(`/api/compte/admin/comptes/${c.id}`, { role: s.value }); toast('Rôle modifié.'); return true; } catch (x) { err.textContent = x.message; return false; }
    } }] });
}
