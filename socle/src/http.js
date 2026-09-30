// Briques HTTP communes : adresse du client, contexte sécurisé, en-têtes,
// cookies, lecture bornée du corps, fichiers statiques, erreurs.
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { ErreurHttp } from './outils.js';
import { requeteCourante } from './requete.js';

// ---- mandataires de confiance ----
// Seuls les relais listés (SOCLE_PROXYS, en CIDR) peuvent dire qui est le
// client. Sans cette liste, X-Forwarded-For est ignoré : sinon n'importe qui
// choisit l'adresse que le limiteur et le journal enregistrent.
export function listeConfiance(cidrs = []) {
  const bl = new net.BlockList();
  for (const c of cidrs) {
    const [adr, lon] = c.split('/');
    const type = net.isIPv6(adr) ? 'ipv6' : 'ipv4';
    if (!net.isIP(adr)) throw new Error(`SOCLE_PROXYS : adresse invalide ${c}`);
    if (lon === undefined) bl.addAddress(adr, type);
    else bl.addSubnet(adr, Number(lon), type);
  }
  return bl;
}
const nue = a => String(a || '').replace(/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/, '');
const deConfiance = (bl, a) => { const x = nue(a); return !!x && net.isIP(x) && bl.check(x, net.isIPv6(x) ? 'ipv6' : 'ipv4'); };

export function adresseClient(req, bl) {
  let a = nue(req.socket.remoteAddress);
  if (!bl || !deConfiance(bl, a)) return a;
  const chaine = String(req.headers['x-forwarded-for'] || '').split(',').map(s => nue(s.trim())).filter(Boolean);
  while (chaine.length) {
    const suivant = chaine.pop();
    if (!net.isIP(suivant)) return a;
    a = suivant;
    if (!deConfiance(bl, a)) return a;
  }
  return a;
}

export function estSecurise(req, bl) {
  if (req.socket.encrypted) return true;
  return !!bl && deConfiance(bl, req.socket.remoteAddress) && String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';
}

// localhost est un contexte sûr pour le navigateur (WebAuthn, cookies Secure)
// même en HTTP : c'est ainsi qu'on développe et qu'on teste.
export const hoteLocal = h => /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(String(h || ''));

export function origineDe(req, bl) {
  let hote = String(req.headers.host || '');
  if (bl && deConfiance(bl, req.socket.remoteAddress) && req.headers['x-forwarded-host']) {
    hote = String(req.headers['x-forwarded-host']).split(',')[0].trim();
  }
  if (!/^[a-z0-9.\-[\]:]+$/i.test(hote)) return null;
  return `${estSecurise(req, bl) ? 'https' : 'http'}://${hote.toLowerCase()}`;
}

// ---- en-têtes ----
export function nonceCsp() { return crypto.randomBytes(16).toString('base64'); }

export function politiqueContenu({ nonce, connect = [], img = [], media = [], frame = [], secure, stylesEnLigne = false }) {
  return [
    "default-src 'self'",
    `script-src 'self'${nonce ? ` 'nonce-${nonce}'` : ''}`,
    `style-src 'self'${stylesEnLigne ? " 'unsafe-inline'" : ''}`,
    `img-src 'self' data:${img.length ? ' ' + img.join(' ') : ''}`,
    "font-src 'self'",
    `connect-src 'self'${connect.length ? ' ' + connect.join(' ') : ''}`,
    `media-src 'self'${media.length ? ' ' + media.join(' ') : ''}`,
    frame.length ? `frame-src ${frame.join(' ')}` : "frame-src 'none'",
    "worker-src 'self'",
    "object-src 'none'", "base-uri 'none'", "frame-ancestors 'none'", "form-action 'self'",
    ...(secure ? ['upgrade-insecure-requests'] : []),
  ].join('; ');
}

export function entetesSecurite(res, { secure, csp, permissions = 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), hid=(), midi=(), magnetometer=(), gyroscope=(), accelerometer=(), display-capture=()' } = {}) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', permissions);
  if (csp) res.setHeader('Content-Security-Policy', csp);
  if (secure) res.setHeader('Strict-Transport-Security', 'max-age=63072000; includeSubDomains');
}

// ---- cookies ----
export function lireCookies(entete = '') {
  const out = {};
  for (const morceau of String(entete).split(';')) {
    const i = morceau.indexOf('=');
    if (i < 1) continue;
    const k = morceau.slice(0, i).trim();
    let v = morceau.slice(i + 1).trim();
    try { v = decodeURIComponent(v); } catch { continue; }
    if (!Object.hasOwn(out, k)) out[k] = v;
  }
  return out;
}

export function poseCookie(res, nom, valeur, { maxAge, secure, sameSite = 'Strict' }) {
  const attributs = [`${nom}=${encodeURIComponent(valeur)}`, 'Path=/', 'HttpOnly', `SameSite=${sameSite}`, `Max-Age=${Math.max(0, Math.floor(maxAge))}`];
  if (secure) attributs.push('Secure');
  const avant = res.getHeader('Set-Cookie');
  res.setHeader('Set-Cookie', [...(Array.isArray(avant) ? avant : avant ? [avant] : []), attributs.join('; ')]);
}

// ---- corps ----
export function lireCorps(req, { limite = 64 * 1024, json = true } = {}) {
  // Un formulaire HTML ne sait pas envoyer application/json sans pré-vol CORS :
  // l'exiger sur toute écriture ferme la soumission silencieuse d'un autre site.
  if (json) {
    const type = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    const vide = Number(req.headers['content-length'] || 0) === 0 && !req.headers['transfer-encoding'];
    const ecriture = ['POST', 'PUT', 'PATCH'].includes(req.method);
    if (type !== 'application/json' && (ecriture || !vide)) {
      req.resume();
      return Promise.reject(new ErreurHttp(415, 'Corps JSON attendu (Content-Type: application/json).'));
    }
  }
  const annonce = Number(req.headers['content-length']);
  if (Number.isFinite(annonce) && annonce > limite) {
    req.resume();
    return Promise.reject(new ErreurHttp(413, 'Corps trop volumineux.'));
  }
  return new Promise((resolve, reject) => {
    let taille = 0; const morceaux = [];
    req.on('data', c => {
      taille += c.length;
      if (taille > limite) { req.destroy(); reject(new ErreurHttp(413, 'Corps trop volumineux.')); }
      else morceaux.push(c);
    });
    req.on('end', () => {
      const buf = Buffer.concat(morceaux);
      if (!json) return resolve(buf);
      if (!buf.length) return resolve({});
      try { resolve(JSON.parse(buf.toString('utf8'))); } catch { reject(new ErreurHttp(400, 'JSON invalide.')); }
    });
    req.on('error', reject);
  });
}

export function repondreJson(res, status, corps, entetes = {}) {
  if (res.headersSent) return;
  const s = JSON.stringify(corps ?? null);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Length': Buffer.byteLength(s), ...entetes });
  res.end(s);
}

// Le client ne voit qu'un message générique et un numéro à citer ; le détail
// reste dans le journal du serveur.
let internes = 0;
export const erreursInternes = () => internes;

export function repondreErreur(res, e, { journal = console } = {}) {
  const status = e instanceof ErreurHttp || (e?.status >= 400 && e?.status < 500) ? e.status : 500;
  if (status >= 500) {
    internes++;
    const ref = requeteCourante() || crypto.randomBytes(4).toString('hex');
    journal.error?.(`[${ref}]`, e?.stack || e);
    return repondreJson(res, 500, { error: `Erreur interne (réf. ${ref}).` });
  }
  repondreJson(res, status, { error: e.message, ...(e.details ? { details: e.details } : {}) });
}

// ---- fichiers statiques ----
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp',
  '.ico': 'image/x-icon', '.json': 'application/json; charset=utf-8', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
};

// Renvoie false si le fichier n'existe pas (l'appelant décide du 404).
export function servirFichier(req, res, racine, chemin, { nonce, cache = 'no-cache' } = {}) {
  let rel;
  try { rel = decodeURIComponent(chemin); } catch { return false; }
  if (rel.includes('\0')) return false;
  const base = path.resolve(racine);
  const plein = path.resolve(base, '.' + path.posix.normalize('/' + rel));
  if (plein !== base && !plein.startsWith(base + path.sep)) return false;
  let st;
  try { st = fs.statSync(plein); } catch { return false; }
  if (!st.isFile()) return false;
  const ext = path.extname(plein).toLowerCase();
  const type = TYPES[ext];
  if (!type) return false;
  if (ext === '.html') {
    const html = fs.readFileSync(plein, 'utf8').replaceAll('__NONCE__', nonce || '');
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store', 'Content-Length': Buffer.byteLength(html) });
    res.end(req.method === 'HEAD' ? undefined : html);
    return true;
  }
  const etag = `W/"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}"`;
  if (req.headers['if-none-match'] === etag) { res.writeHead(304, { ETag: etag }); res.end(); return true; }
  res.writeHead(200, { 'Content-Type': type, 'Content-Length': st.size, ETag: etag, 'Cache-Control': cache });
  if (req.method === 'HEAD') { res.end(); return true; }
  fs.createReadStream(plein).on('error', () => res.destroy()).pipe(res);
  return true;
}

// ---- routeur ----
// Motifs à segments nommés (« /api/conversation/:id »). Chaque paramètre est
// décodé une fois ; un encodage invalide ne correspond à aucune route.
export class Routeur {
  constructor() { this.routes = []; }
  ajouter(methode, motif, gestionnaire, options = {}) {
    const cles = [];
    const re = new RegExp('^' + motif.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\/:([a-zA-Z_]+)/g, (_, k) => { cles.push(k); return '/([^/]+)'; }) + '$');
    this.routes.push({ methode, re, cles, gestionnaire, options });
    return this;
  }
  get(m, g, o) { return this.ajouter('GET', m, g, o); }
  post(m, g, o) { return this.ajouter('POST', m, g, o); }
  put(m, g, o) { return this.ajouter('PUT', m, g, o); }
  patch(m, g, o) { return this.ajouter('PATCH', m, g, o); }
  del(m, g, o) { return this.ajouter('DELETE', m, g, o); }
  // { route, params } ; ou { methodes } si le chemin existe sous d'autres méthodes.
  trouver(methode, chemin) {
    const autres = [];
    for (const r of this.routes) {
      const m = r.re.exec(chemin);
      if (!m) continue;
      if (r.methode !== methode && !(methode === 'HEAD' && r.methode === 'GET')) { autres.push(r.methode); continue; }
      const params = {};
      try { r.cles.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); }); } catch { return null; }
      return { route: r, params };
    }
    return autres.length ? { methodes: [...new Set(autres)] } : null;
  }
}

// ---- débit par adresse ----
// Fenêtre glissante en mémoire : le service tourne en un seul processus
// longue durée, et ce plafond ne protège que contre l'emballement. Les
// essais d'authentification ont leur propre limiteur, persistant.
export class Debit {
  constructor({ max = 300, fenetreMs = 60_000 } = {}) { this.max = max; this.fenetre = fenetreMs; this.compteurs = new Map(); }
  prendre(cle) {
    const t = Date.now();
    const l = (this.compteurs.get(cle) || []).filter(x => t - x < this.fenetre);
    if (l.length >= this.max) { this.compteurs.set(cle, l); return false; }
    l.push(t); this.compteurs.set(cle, l);
    if (this.compteurs.size > 10_000) for (const [k, v] of this.compteurs) if (!v.length || t - v.at(-1) > this.fenetre) this.compteurs.delete(k);
    return true;
  }
}
