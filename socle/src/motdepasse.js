// Politique de mot de passe, appliquée côté serveur (REQ-CRYPT-004).
//
// Douze caractères au moins, 1024 au plus, tout caractère accepté (espaces et
// émojis compris), aucune règle de composition, aucune rotation imposée. Le
// refus porte sur ce qu'un attaquant essaie en premier : les 30 000 mots de
// passe les plus fréquents des fuites publiques (liste de zxcvbn, licence MIT),
// et leurs variantes paresseuses — « Password123! » n'est que « password »
// habillé d'un suffixe.
import fs from 'node:fs';
import zlib from 'node:zlib';

export const MIN = 12;
export const MAX = 1024;

let courants = null;
function liste() {
  if (!courants) {
    const brut = zlib.gunzipSync(fs.readFileSync(new URL('../data/mots-de-passe-courants.txt.gz', import.meta.url)));
    courants = new Set(brut.toString('utf8').split('\n').filter(Boolean));
  }
  return courants;
}

const LEET = { '4': 'a', '@': 'a', '3': 'e', '1': 'i', '!': 'i', '0': 'o', '5': 's', '$': 's', '7': 't', '+': 't' };
const SUITES = ['0123456789', 'abcdefghijklmnopqrstuvwxyz', 'qwertyuiopasdfghjklzxcvbnm', 'azertyuiopqsdfghjklmwxcvbn', '1234567890azertyuiop', '1234567890qwertyuiop'];

function suiteTriviale(s) {
  if (/^(.)\1+$/u.test(s)) return true;
  if (/^(.{1,4})\1+$/u.test(s)) return true;
  for (const suite of SUITES) {
    const aller = suite.repeat(3), retour = [...aller].reverse().join('');
    if (aller.includes(s) || retour.includes(s)) return true;
  }
  return false;
}

function noyaux(s) {
  const bas = s.toLowerCase();
  const sansHabits = bas.replace(/^[\d\W_]{0,6}/u, '').replace(/[\d\W_]{0,8}$/u, '');
  const deLeet = x => [...x].map(c => LEET[c] ?? c).join('');
  return new Set([bas, sansHabits, deLeet(bas), deLeet(sansHabits), deLeet(bas).replace(/[\d\W_]+$/u, '')]);
}

// Renvoie null si le mot de passe convient, sinon la raison à afficher.
export function refus(mdp, { identifiant = '', service = '' } = {}) {
  if (typeof mdp !== 'string') return 'Mot de passe manquant.';
  const n = [...mdp].length;
  if (n < MIN) return `Au moins ${MIN} caractères.`;
  if (n > MAX) return `Au plus ${MAX} caractères.`;
  const bas = mdp.toLowerCase();
  if (suiteTriviale(bas)) return 'Suite ou répétition trop prévisible.';
  const connus = liste();
  for (const noyau of noyaux(mdp)) {
    if (noyau.length >= 3 && connus.has(noyau)) return 'Ce mot de passe figure parmi les plus utilisés dans les fuites publiques.';
  }
  for (const mot of [identifiant, service].map(x => String(x || '').toLowerCase()).filter(x => x.length >= 3)) {
    for (const noyau of noyaux(mdp)) if (noyau === mot) return 'Trop proche de l’identifiant ou du nom du service.';
  }
  return null;
}
