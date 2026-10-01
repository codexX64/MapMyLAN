// Hachage des mots de passe : Argon2id, par node:crypto (Node 24.7 et plus).
//
// Le format stocké est la chaîne PHC standard, $argon2id$v=19$m=…,t=…,p=…$sel$empreinte,
// lisible par argon2-cffi comme par @node-rs/argon2 : les comptes d'Oracle se
// relisent tels quels. Les empreintes scrypt des anciennes versions du Hub, de
// SYNAPSE et de Sentinel restent vérifiables, et sont réécrites en Argon2id à la
// première connexion réussie.
import crypto from 'node:crypto';
import { promisify } from 'node:util';

const argon2 = promisify(crypto.argon2);
const scrypt = promisify(crypto.scrypt);

// Plancher du manuel (REQ-CRYPT-001) : en dessous, le processus refuse de démarrer.
export const PLANCHER = Object.freeze({ m: 19456, t: 2, p: 1 });
export const CIBLE = Object.freeze({ m: 65536, t: 3, p: 4 });
const LONGUEUR = 32;
const MAX_OCTETS = 4096;

let reglage = { ...CIBLE };
let poivre = null;
// Pendant une rotation du poivre : l'ancien (null : il n'y en avait pas).
// undefined hors rotation.
let poivreAncien;

export function reglerArgon({ m = CIBLE.m, t = CIBLE.t, p = CIBLE.p, poivre: pv = null, poivreAncien: ancien } = {}) {
  for (const [k, v] of Object.entries({ m, t, p })) {
    if (!Number.isInteger(v) || v < PLANCHER[k]) {
      throw new Error(`Argon2id : ${k}=${v} est sous le plancher (${PLANCHER[k]}).`);
    }
  }
  const actuel = pv ? String(pv) : null;
  const precedent = ancien === undefined || ancien === null ? undefined : ancien === 'aucun' ? null : String(ancien);
  if (precedent === actuel) throw new Error('SOCLE_POIVRE_ANCIEN est le poivre actuel : pose le nouveau dans SOCLE_POIVRE.');
  reglage = { m, t, p };
  poivre = actuel;
  poivreAncien = precedent;
}
export const reglageArgon = () => ({ ...reglage });

// Chaque calcul réserve m Kio : sans file d'attente, une rafale de connexions
// épuiserait la mémoire bien avant que le limiteur ne réagisse.
const ENSEMBLE = 2;
let enCours = 0;
const attente = [];
async function tour(fn) {
  if (enCours >= ENSEMBLE) await new Promise(r => attente.push(r));
  enCours++;
  try { return await fn(); } finally { enCours--; attente.shift()?.(); }
}

function message(mdp, pv = poivre) {
  const s = String(mdp);
  if (Buffer.byteLength(s, 'utf8') > MAX_OCTETS) throw new Error('Mot de passe démesurément long.');
  return pv ? crypto.createHmac('sha256', pv).update(s, 'utf8').digest('base64') : s;
}

const sansBourrage = b => b.toString('base64').replace(/=+$/, '');

async function calcule(msg, sel, { m, t, p }) {
  return tour(() => argon2('argon2id', { message: msg, nonce: sel, memory: m, passes: t, parallelism: p, tagLength: LONGUEUR }));
}

export async function hacher(mdp) {
  const sel = crypto.randomBytes(16);
  const h = await calcule(message(mdp), sel, reglage);
  return `$argon2id$v=19$m=${reglage.m},t=${reglage.t},p=${reglage.p}$${sansBourrage(sel)}$${sansBourrage(h)}`;
}

const PHC = /^\$argon2id\$v=(\d+)\$m=(\d+),t=(\d+),p=(\d+)\$([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)$/;

export function aRehacher(empreinte) {
  const m = PHC.exec(String(empreinte || ''));
  if (!m) return true;
  const [, v, mem, t, p] = m.map(Number);
  return v !== 19 || mem < reglage.m || t < reglage.t || p < reglage.p;
}

async function verifieArgon(mdp, m, pv = poivre) {
  const [, v, mem, t, p, sel, ref] = m;
  const nonce = Buffer.from(sel, 'base64'), attendu = Buffer.from(ref, 'base64');
  // Une empreinte hors des bornes raisonnables est refusée avant tout calcul :
  // elle ne vient pas de ce code, et m=4 Go ferait tomber le processus.
  if (Number(v) !== 19 || nonce.length < 8 || attendu.length < 16 || Number(mem) > 1 << 21 || Number(t) > 16 || Number(p) > 16) return false;
  try {
    const h = await tour(() => argon2('argon2id', {
      message: message(mdp, pv), nonce, memory: Number(mem), passes: Number(t), parallelism: Number(p), tagLength: attendu.length,
    }));
    return crypto.timingSafeEqual(h, attendu);
  } catch { return false; }
}

// Formats hérités, jamais écrits : seulement relus puis remplacés.
async function verifieScrypt(mdp, empreinte) {
  const s = String(empreinte);
  let sel, ref, N;
  const hub = /^scrypt\$(\d+)\$([A-Za-z0-9+/=]+)\$([A-Za-z0-9+/=]+)$/.exec(s);
  const sentinel = /^scrypt\$([0-9a-f]{32})\$([0-9a-f]{64})$/.exec(s);
  const synapse = /^([0-9a-f]{32}):([0-9a-f]{64})$/.exec(s);
  if (hub) { N = Number(hub[1]); sel = Buffer.from(hub[2], 'base64'); ref = Buffer.from(hub[3], 'base64'); }
  else if (sentinel) { N = 16384; sel = Buffer.from(sentinel[1], 'hex'); ref = Buffer.from(sentinel[2], 'hex'); }
  else if (synapse) { N = 32768; sel = Buffer.from(synapse[1], 'hex'); ref = Buffer.from(synapse[2], 'hex'); }
  else return null;
  if (![16384, 32768, 65536].includes(N) || ref.length !== 32) return false;
  // Les anciennes empreintes ont été calculées sans poivre.
  const dk = await tour(() => scrypt(String(mdp), sel, 32, { N, r: 8, p: 1, maxmem: 256 * 1024 * 1024 }));
  return crypto.timingSafeEqual(dk, ref);
}

let leurre = null;
async function tempsEquivalent() {
  if (!leurre) leurre = await hacher(crypto.randomBytes(24).toString('base64'));
  await verifieArgon('toujours faux', PHC.exec(leurre));
  // Pendant une rotation du poivre, un mauvais mot de passe coûte deux calculs.
  if (poivreAncien !== undefined) await verifieArgon('toujours faux', PHC.exec(leurre), poivreAncien);
}
export const prechauffer = tempsEquivalent;

// { ok, nouvelle } : nouvelle est l'empreinte à écrire quand l'ancienne est en
// retard (paramètres plus faibles, ou scrypt). Un compte inconnu coûte le même
// temps qu'un compte connu : pas de chronomètre pour énumérer.
export async function verifier(mdp, empreinte) {
  if (!empreinte) { await tempsEquivalent(); return { ok: false }; }
  const m = PHC.exec(String(empreinte));
  let ok;
  if (m) {
    ok = await verifieArgon(mdp, m);
    // Empreinte écrite avec l'ancien poivre : elle passe au nouveau tout de suite.
    if (!ok && poivreAncien !== undefined && await verifieArgon(mdp, m, poivreAncien)) return { ok: true, nouvelle: await hacher(mdp) };
  } else {
    ok = await verifieScrypt(mdp, empreinte);
    if (ok === null) { await tempsEquivalent(); return { ok: false }; }
  }
  if (!ok) return { ok: false };
  return aRehacher(empreinte) ? { ok: true, nouvelle: await hacher(mdp) } : { ok: true };
}
