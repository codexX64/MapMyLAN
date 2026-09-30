// Validation stricte des corps de requête : chaque champ est déclaré, tout champ
// inconnu est refusé (pas d'affectation de masse), les bornes sont vérifiées
// avant usage. Le handler ne voit jamais que l'objet validé.
import { ErreurHttp } from './outils.js';

const INTERDITES = new Set(['__proto__', 'constructor', 'prototype']);

function champ(nom, v, s) {
  const faux = raison => { throw new ErreurHttp(400, `Champ « ${nom} » : ${raison}.`); };
  if (v === undefined || v === null || v === '') {
    if (s.requis) faux('obligatoire');
    return s.defaut;
  }
  switch (s.type) {
    case 'chaine': {
      if (typeof v !== 'string') faux('texte attendu');
      const n = [...v].length;
      if (s.min !== undefined && n < s.min) faux(`au moins ${s.min} caractères`);
      if (n > (s.max ?? 1000)) faux(`au plus ${s.max ?? 1000} caractères`);
      if (s.motif && !s.motif.test(v)) faux('format invalide');
      if (s.parmi && !s.parmi.includes(v)) faux('valeur non admise');
      return v;
    }
    case 'entier': {
      const n = typeof v === 'string' && /^-?\d+$/.test(v) ? Number(v) : v;
      if (!Number.isInteger(n)) faux('entier attendu');
      if (s.min !== undefined && n < s.min) faux(`au moins ${s.min}`);
      if (s.max !== undefined && n > s.max) faux(`au plus ${s.max}`);
      return n;
    }
    case 'nombre': {
      const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
      if (typeof n !== 'number' || !Number.isFinite(n)) faux('nombre attendu');
      if (s.min !== undefined && n < s.min) faux(`au moins ${s.min}`);
      if (s.max !== undefined && n > s.max) faux(`au plus ${s.max}`);
      return n;
    }
    case 'booleen':
      if (typeof v !== 'boolean') faux('vrai ou faux attendu');
      return v;
    // Une valeur JSON quelconque (graphe, charge utile) : clés contrôlées,
    // profondeur bornée ; sa forme relève du code qui la reçoit.
    case 'json':
      return libre(v, nom, 0, s.profondeur ?? 6);
    case 'objet':
      if (typeof v !== 'object' || Array.isArray(v)) faux('objet attendu');
      return s.champs ? valider(v, s.champs) : libre(v, nom, 0, s.profondeur ?? 6);
    case 'liste': {
      if (!Array.isArray(v)) faux('liste attendue');
      if (v.length > (s.max ?? 100)) faux(`au plus ${s.max ?? 100} éléments`);
      return v.map((x, i) => champ(`${nom}[${i}]`, x, s.de));
    }
    default: throw new Error(`schéma : type inconnu ${s.type}`);
  }
}

// Objet opaque (réponse WebAuthn, graphe) : clés contrôlées, profondeur bornée.
function libre(v, nom, profondeur = 0, max = 6) {
  if (profondeur > max) throw new ErreurHttp(400, `Champ « ${nom} » : trop imbriqué.`);
  if (v && typeof v === 'object') {
    for (const k of Object.keys(v)) {
      if (INTERDITES.has(k)) throw new ErreurHttp(400, `Champ « ${nom} » : clé interdite.`);
      libre(v[k], nom, profondeur + 1, max);
    }
  }
  return v;
}

export function valider(corps, schema) {
  if (!corps || typeof corps !== 'object' || Array.isArray(corps)) throw new ErreurHttp(400, 'Corps JSON attendu.');
  for (const k of Object.keys(corps)) {
    if (!Object.hasOwn(schema, k)) throw new ErreurHttp(400, `Champ inattendu : « ${String(k).slice(0, 40)} ».`);
  }
  const out = {};
  for (const [k, s] of Object.entries(schema)) {
    const v = champ(k, corps[k], s);
    if (v !== undefined) out[k] = v;
  }
  return out;
}
