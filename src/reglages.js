// Réglages de l'instance (table reglages). La 1.4.1 acceptait n'importe
// quelle clé et n'importe quelle valeur ; ici chaque clé a son schéma et une
// clé inconnue est refusée. Les valeurs sont rangées en JSON.
import { ErreurHttp, valider } from '../socle/src/index.js';
import { lireJson } from './formes.js';
import { estCidr, prefixeDe } from './cibles.js';
import { lireEntree } from './sortie.js';

const PLAGE = { type: 'objet', champs: { cidr: { type: 'chaine', requis: true, max: 18 }, label: { type: 'chaine', max: 60 }, enabled: { type: 'booleen' } } };
// « latitude,longitude » ou « latitude,longitude,Nom » : la forme que lit le globe.
const ORIGINE = /^(-?\d{1,3}(?:\.\d{1,8})?) *, *(-?\d{1,3}(?:\.\d{1,8})?) *(?:, *([^\x00-\x1f\x7f]{1,60}))?$/;

// Chaque schéma décrit `value` ; `controle` vérifie ce que le type seul ne dit pas.
export const CLES = {
  'setup.complete': { schema: { type: 'booleen', requis: true } },
  'scan.subnet': { schema: { type: 'chaine', requis: true, max: 18 }, controle: v => estCidr(v) && prefixeDe(v) >= 16 || 'plage CIDR IPv4 de /16 ou plus étroite attendue' },
  'scan.interval': { schema: { type: 'entier', requis: true, min: 60, max: 86400 } },
  'scan.ranges': {
    schema: { type: 'liste', requis: true, max: 32, de: PLAGE },
    controle: l => l.every(p => estCidr(p.cidr) && prefixeDe(p.cidr) >= 16) || 'chaque plage : CIDR IPv4 de /16 ou plus étroite',
  },
  'topology.autoBuild': { schema: { type: 'booleen', requis: true } },
  'grouping.enabled': { schema: { type: 'booleen', requis: true } },
  'grouping.prefix': { schema: { type: 'chaine', requis: true, max: 7, motif: /^\d{1,3}\.\d{1,3}$/ } },
  'grouping.wifiMultiplier': { schema: { type: 'entier', requis: true, min: 2, max: 100 } },
  'world.rdap': { schema: { type: 'booleen', requis: true } },
  'world.logos': { schema: { type: 'booleen', requis: true } },
  'world.retentionDays': { schema: { type: 'entier', requis: true, min: 0, max: 3650 } },
  'world.retentionMaxMb': { schema: { type: 'entier', requis: true, min: 0, max: 100000 } },
  // Le point d'observation du globe ; sans lui, l'équateur au méridien d'origine.
  'world.origin': {
    schema: { type: 'chaine', requis: true, max: 100, motif: ORIGINE },
    controle: v => { const [, lat, lon] = ORIGINE.exec(v); return (Math.abs(lat) <= 90 && Math.abs(lon) <= 180) || 'latitude entre -90 et 90, longitude entre -180 et 180'; },
  },
  // Réglage de sécurité : les destinations internes que MapMyLAN peut joindre.
  'sortie.autorisees': {
    schema: { type: 'liste', requis: true, max: 64, de: { type: 'chaine', max: 253 } },
    controle: l => { for (const e of l) { try { lireEntree(e); } catch (err) { return err.message; } } return true; },
    securite: true,
  },
};

export class Reglages {
  constructor(db) { this.db = db; }

  lire(cle, defaut = undefined) {
    const l = this.db.prepare('SELECT value FROM reglages WHERE key = ?').get(cle);
    return l ? lireJson(l.value, defaut) : defaut;
  }

  tous() {
    const out = {};
    for (const l of this.db.prepare('SELECT key, value FROM reglages ORDER BY key').all()) out[l.key] = lireJson(l.value);
    return out;
  }

  // Valide puis écrit. Rend la valeur retenue (normalisée par le schéma).
  ecrire(cle, valeur) {
    const def = CLES[cle];
    if (!def) throw new ErreurHttp(400, `Réglage inconnu : « ${String(cle).slice(0, 60)} ».`);
    const { value } = valider({ value: valeur }, { value: def.schema });
    if (def.controle) {
      const ok = def.controle(value);
      if (ok !== true) throw new ErreurHttp(400, `Réglage « ${cle} » : ${ok}.`);
    }
    this.poser(cle, value);
    return value;
  }

  // Écriture interne, sans schéma : réservée au code (premier démarrage, reprise).
  poser(cle, valeur) {
    this.db.prepare('INSERT INTO reglages(key, value, updatedAt) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updatedAt = excluded.updatedAt')
      .run(cle, JSON.stringify(valeur), Date.now());
  }
}
