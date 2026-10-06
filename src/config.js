// Configuration de MapMyLAN, lue et validée une fois au démarrage. Les
// variables SOCLE_* (comptes, relais, clé maîtresse) sont lues par le socle.
// Une valeur fausse arrête le processus avec la liste complète des erreurs.
import { lireConfig } from '../socle/src/index.js';

export const VERSION = '2.0.3';

const CIDR = /^(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\/(?:[0-9]|[12]\d|3[0-2])$/;
// Un nom d'interface Linux : quinze caractères au plus, jamais d'espace.
const INTERFACE = /^[A-Za-z0-9_.:-]{1,15}$/;

export const SPEC = {
  port: { env: 'PORT', type: 'entier', min: 0, max: 65535, defaut: 8090 },
  hote: { env: 'HOTE', type: 'chaine', motif: /^[0-9a-fA-F.:]{2,45}$/, defaut: '0.0.0.0' },
  donnees: { env: 'DATA_DIR', type: 'chaine', defaut: '/app/data' },
  sousReseau: { env: 'SCAN_SUBNET', type: 'chaine', motif: CIDR, defaut: '192.0.2.0/24' },
  // 0 : aucun balayage planifié, seulement ceux qu'on lance.
  intervalle: { env: 'SCAN_INTERVAL', type: 'entier', min: 0, max: 86400, defaut: 300 },
  interfaceScan: { env: 'SCAN_INTERFACE', type: 'chaine', motif: INTERFACE },
  proc: { env: 'HOST_PROC', type: 'chaine', motif: /^\/[\w./-]{0,200}$/, defaut: '/proc' },
  sys: { env: 'HOST_SYS', type: 'chaine', motif: /^\/[\w./-]{0,200}$/, defaut: '/sys' },
  // Le proxy de socket Docker en lecture seule : tcp://hôte:port ou unix:///chemin.
  docker: { env: 'DOCKER_HOST', type: 'chaine', motif: /^(?:tcp:\/\/[\w.-]{1,253}:\d{1,5}|unix:\/\/\/[\w./-]{1,200})$/ },
  jetonHub: { env: 'INTEGRATION_TOKEN_SEED', type: 'secret', min: 32 },
  iaUrl: { env: 'IA_URL', type: 'url' },
  iaModele: { env: 'IA_MODELE', type: 'chaine', motif: /^[\w.:\-/]{1,120}$/ },
  iaModeleDefaut: { env: 'IA_MODELE_DEFAUT', type: 'chaine', motif: /^[\w.:\-/]{1,120}$/ },
  voxUrl: { env: 'VOX_URL', type: 'url' },
  voxJeton: { env: 'VOX_JETON', type: 'secret', min: 16 },
  synapseUrl: { env: 'SYNAPSE_URL', type: 'url' },
  synapseJeton: { env: 'SYNAPSE_JETON', type: 'secret', min: 16 },
  // VIGIE (audit de sécurité) : son adresse vue de la machine, le jeton que
  // le Hub a dérivé pour MapMyLAN, et les services dont le jeton dérivé peut
  // agir ici (isoler, balayer) — les autres jetons dérivés lisent seulement.
  vigieUrl: { env: 'VIGIE_URL', type: 'url' },
  vigieJeton: { env: 'VIGIE_JETON', type: 'chaine', motif: /^cer_[a-z0-9][a-z0-9-]{1,30}_[0-9a-f]{64}$/ },
  derivesMembre: { env: 'JETONS_DERIVES_MEMBRE', type: 'liste', defaut: [] },
  // L'adresse de MapMyLAN pour un humain : les autres services la donnent.
  serviceUi: { env: 'SERVICE_UI', type: 'url' },
  posteUrl: { env: 'POSTE_URL', type: 'url', schemas: ['https:'] },
  posteDe: { env: 'POSTE_FROM', type: 'chaine', motif: /^[^\s@]{1,64}@[^\s@]{1,253}$/ },
  posteAlias: { env: 'POSTE_ALIAS', type: 'chaine', motif: /^[^\s@]{1,64}@[^\s@]{1,253}$/ },
  posteCle: { env: 'POSTE_SEND_KEY', type: 'secret', min: 16 },
  prefixeRegroupement: { env: 'GROUPING_PREFIX', type: 'chaine', motif: /^\d{1,3}\.\d{1,3}$/ },
  extensions: { env: 'EXTENSIONS_DIR', type: 'chaine', motif: /^\/[\w./-]{0,200}$/ },
  // Plafonds de l'assistant (SEC-LLM-002) : par compte et par jour, pour toute
  // l'instance et par jour, par compte et par minute. La voix a les siens :
  // une question dictée puis lue coûte une transcription et une lecture.
  iaJour: { env: 'MAPMYLAN_IA_JOUR', type: 'entier', min: 1, max: 100000, defaut: 200 },
  iaJourTotal: { env: 'MAPMYLAN_IA_JOUR_TOTAL', type: 'entier', min: 1, max: 1000000, defaut: 1000 },
  iaMinute: { env: 'MAPMYLAN_IA_MINUTE', type: 'entier', min: 1, max: 600, defaut: 10 },
  voixJour: { env: 'MAPMYLAN_VOIX_JOUR', type: 'entier', min: 1, max: 100000, defaut: 400 },
  voixJourTotal: { env: 'MAPMYLAN_VOIX_JOUR_TOTAL', type: 'entier', min: 1, max: 1000000, defaut: 2000 },
};

export function lireConfigMapmylan(env = process.env) {
  const cfg = lireConfig(SPEC, env);
  const erreurs = [];
  // Le Hub fabrique un jeton préfixé : sans préfixe, il ne serait jamais
  // reconnu à l'authentification et l'amorce créerait un jeton mort.
  if (cfg.jetonHub && !/^(hub|mml)_[\w-]{24,}$/.test(cfg.jetonHub)) erreurs.push('INTEGRATION_TOKEN_SEED : « hub_ » ou « mml_ » suivi de 24 caractères aléatoires au moins.');
  if (cfg.posteUrl && !(cfg.posteDe && cfg.posteCle)) erreurs.push('POSTE_URL demande POSTE_FROM et POSTE_SEND_KEY.');
  if (erreurs.length) throw Object.assign(new Error('Configuration invalide :\n  - ' + erreurs.join('\n  - ')), { erreurs });
  return Object.freeze({ ...cfg, iaModeleRetenu: cfg.iaModele || cfg.iaModeleDefaut || null });
}
