// Configuration lue une fois au démarrage et validée (REQ-CFG-004).
//
// Une valeur manquante ou malformée arrête le processus avec la liste complète
// des erreurs : jamais de repli silencieux vers un défaut permissif. Les secrets
// peuvent venir d'un fichier (NOM_FILE, convention des secrets Docker) pour ne
// pas traîner dans l'environnement du conteneur.
import fs from 'node:fs';

function brut(env, nom) {
  if (env[nom + '_FILE']) return fs.readFileSync(env[nom + '_FILE'], 'utf8').trim();
  return env[nom];
}

export function lireConfig(spec, env = process.env) {
  const out = {}, erreurs = [];
  for (const [cle, s] of Object.entries(spec)) {
    const nom = s.env || cle;
    let v;
    try { v = brut(env, nom); } catch (e) { erreurs.push(`${nom}_FILE illisible : ${e.message}`); continue; }
    if (v === undefined || v === '') {
      if (s.requis) erreurs.push(`${nom} est obligatoire.${s.aide ? ' ' + s.aide : ''}`);
      out[cle] = s.defaut;
      continue;
    }
    switch (s.type) {
      case 'entier': {
        if (!/^-?\d+$/.test(v)) { erreurs.push(`${nom} doit être un entier (reçu « ${v} »).`); break; }
        const n = Number(v);
        if (s.min !== undefined && n < s.min) erreurs.push(`${nom} doit valoir au moins ${s.min}.`);
        else if (s.max !== undefined && n > s.max) erreurs.push(`${nom} doit valoir au plus ${s.max}.`);
        else out[cle] = n;
        break;
      }
      case 'booleen':
        if (!['0', '1', 'true', 'false', 'oui', 'non'].includes(v)) erreurs.push(`${nom} : 0 ou 1 attendu.`);
        else out[cle] = ['1', 'true', 'oui'].includes(v);
        break;
      case 'url': {
        let u;
        try { u = new URL(v); } catch { erreurs.push(`${nom} : adresse invalide.`); break; }
        if (!(s.schemas || ['http:', 'https:']).includes(u.protocol)) erreurs.push(`${nom} : schéma ${u.protocol} refusé.`);
        else out[cle] = v.replace(/\/+$/, '');
        break;
      }
      case 'liste':
        out[cle] = v.split(',').map(x => x.trim()).filter(Boolean);
        break;
      case 'choix':
        if (!s.parmi.includes(v)) erreurs.push(`${nom} : une valeur parmi ${s.parmi.join(', ')} attendue.`);
        else out[cle] = v;
        break;
      case 'secret':
        if (v.length < (s.min ?? 32)) erreurs.push(`${nom} : au moins ${s.min ?? 32} caractères aléatoires attendus.`);
        else if (/^(change-?moi|changeme|secret|password|motdepasse|your[-_]?secret)/i.test(v)) erreurs.push(`${nom} : valeur d'exemple refusée.`);
        else out[cle] = v;
        break;
      default:
        if (s.motif && !s.motif.test(v)) erreurs.push(`${nom} : format invalide.`);
        else out[cle] = v;
    }
  }
  if (erreurs.length) {
    const e = new Error('Configuration invalide :\n  - ' + erreurs.join('\n  - '));
    e.erreurs = erreurs;
    throw e;
  }
  return Object.freeze(out);
}
