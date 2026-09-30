// Démarrage de MapMyLAN : configuration validée, base, socle commun
// (comptes, sessions, coffre, journal), services du réseau, tâches de fond,
// serveur HTTP.
import http from 'node:http';
import path from 'node:path';
import { Debit, ErreurHttp, demarrerSocle, entetesSecurite, envelopper, nonceCsp, politiqueContenu, repondreErreur, repondreJson, servirFichier } from '../socle/src/index.js';
import { lireConfigMapmylan, VERSION } from './config.js';
import { nouvelId, ouvrirBase } from './db.js';
import { Evenements } from './evenements.js';
import { Reglages } from './reglages.js';
import { Sortie } from './sortie.js';
import { Executeur } from './executeur.js';
import { Ssh } from './ssh.js';
import { Equipements } from './equipements.js';
import { Appareils } from './appareils.js';
import { Scanner } from './scanner.js';
import { Scores } from './scores.js';
import { Defense } from './defense.js';
import { Enrichissement } from './enrichissement.js';
import { Vlans } from './vlans.js';
import { Notifications } from './notifications.js';
import { Poste } from './poste.js';
import { Commandes } from './commandes.js';
import { Consoles } from './consoles.js';
import { CommandesBot } from './commandes-bot.js';
import { Hote } from './hote.js';
import { Registre } from './registre.js';
import { Logos } from './logos.js';
import { Trafic } from './trafic.js';
import { Jetons } from './jetons.js';
import { Extensions } from './extensions.js';
import { Memoire } from './memoire.js';
import { Liaisons } from './assistant/liaisons.js';
import { Assistant } from './assistant/index.js';
import { Plafond } from './assistant/plafond.js';
import { Flux } from './flux.js';
import { Planificateur } from './planif.js';
import { creerApi } from './api/index.js';
import { resceller } from './rotation.js';
import * as F from './formes.js';

const RACINE = path.resolve(import.meta.dirname, '..');
const CONSOLE = { info: (...a) => console.log(...a), warn: (...a) => console.warn(...a), error: (...a) => console.error(...a) };
// Signalement privé d'une faille, sur le dépôt : lu par le mainteneur.
const CONTACT_SECURITE = 'https://github.com/codexX64/MapMyLAN/security/advisories/new';
// La politique des permissions du socle, à une exception près : la dictée
// vocale de l'assistant ouvre le micro, depuis la page elle-même seulement.
const PERMISSIONS = 'camera=(), microphone=(self), geolocation=(), payment=(), usb=(), serial=(), hid=(), midi=(), magnetometer=(), gyroscope=(), accelerometer=(), display-capture=()';
// Un segment caché (/.env, /.git/…) ne désigne jamais une page : une sonde qui
// recevrait l'interface à sa place croirait le fichier servi.
const SEGMENT_CACHE = /(^|\/)\./;
const decode = chemin => {
  try { return decodeURIComponent(chemin); } catch {
    // Un encodage invalide ne désigne aucun fichier : le chemin brut est jugé tel quel.
    return chemin;
  }
};

// Ce qu'une installation neuve contient d'emblée (la 1.4.1 le posait par
// son script d'amorçage) : les règles de défense par défaut et les réglages
// de départ. Rien n'est écrasé.
const REGLES_DEFAUT = [
  ['Isolement automatique — danger élevé', 'dangerScore', 75, 'quarantine'],
  ['Blocage automatique — danger critique', 'dangerScore', 85, 'ban'],
  ['Alerte sur balayage de ports', 'portScan', null, 'alert'],
  ['Alerte sur usurpation ARP', 'arpSpoof', null, 'alert'],
  ['Alerte sur CVE critique', 'cve', 9, 'alert'],
  ['Alerte sur nouvel appareil', 'newDevice', null, 'alert'],
];

function amorcer({ db, reglages, cfg }) {
  if (!db.prepare('SELECT 1 FROM regles LIMIT 1').get()) {
    const t = Date.now();
    const ins = db.prepare('INSERT INTO regles(id, name, enabled, trigger, threshold, action, exceptWhitelist, createdAt) VALUES(?,?,1,?,?,?,1,?)');
    REGLES_DEFAUT.forEach(([nom, declencheur, seuil, action], i) => ins.run(nouvelId(), nom, declencheur, seuil, action, t + i));
  }
  const depart = { 'setup.complete': false, 'scan.subnet': cfg.sousReseau, 'topology.autoBuild': true, ...(cfg.intervalle >= 60 ? { 'scan.interval': cfg.intervalle } : {}) };
  for (const [cle, valeur] of Object.entries(depart)) if (reglages.lire(cle) === undefined) reglages.poser(cle, valeur);
}

/**
 * options (essais) : executeur (double des outils système), telegramBase,
 * fluxControleMs (contrôle des sessions du flux), planifier: false (aucune
 * tâche de fond).
 */
export async function demarrer(env = process.env, { log = CONSOLE, options = {} } = {}) {
  const cfg = lireConfigMapmylan(env);
  const db = ouvrirBase(cfg.donnees);
  const socle = await demarrerSocle({ service: { id: 'mapmylan', nom: 'MapMyLAN', contactSecurite: CONTACT_SECURITE }, db, dossier: cfg.donnees, env, log });
  const { coffre, journal, portail, comptes } = socle;
  // Rotation de SOCLE_CLE : les secrets de MapMyLAN suivent ceux du socle.
  const tour = resceller({ db, coffre });
  if (tour.rescelles || tour.illisibles) {
    journal.ecrire({ action: 'coffre.rescelle', details: tour });
    log.info(`[coffre] ${tour.rescelles} secret(s) de MapMyLAN rescellé(s) sous la clé neuve${tour.illisibles ? `, ${tour.illisibles} illisible(s) avec l'une comme l'autre : à ressaisir` : ''}.`);
  }

  // Le conteneur des services : chacun reçoit ce dont il a besoin, rien n'est global.
  const s = { cfg, db, log, options, coffre, journal, portail, comptes };
  s.evts = new Evenements({ db, log });
  s.reglages = new Reglages(db);
  s.sortie = new Sortie({ internes: () => s.reglages.lire('sortie.autorisees', []) || [] });
  s.executeur = options.executeur || new Executeur();
  s.ssh = new Ssh({ executeur: s.executeur });
  s.equipements = new Equipements(s);
  s.appareils = new Appareils(db);
  s.jetons = new Jetons(db);
  s.extensions = new Extensions({ journal: (niveau, message) => s.evts.journaliser(niveau, 'extensions', message) });
  s.memoire = new Memoire({ url: cfg.synapseUrl, jeton: cfg.synapseJeton });
  s.liaisons = new Liaisons({ cfg });
  s.poste = new Poste({ cfg, evts: s.evts });
  s.registre = new Registre({ sortie: s.sortie, reglages: s.reglages });
  s.logos = new Logos({ sortie: s.sortie, reglages: s.reglages });
  s.hote = new Hote({ cfg, db, plages: () => s.scanner.plagesActives().map(p => p.cidr) });
  s.plafond = new Plafond({ db, journal, comptes, parCompte: cfg.iaJour, total: cfg.iaJourTotal });
  s.plafondVoix = new Plafond({ db, journal, comptes, parCompte: cfg.voixJour, total: cfg.voixJourTotal, usage: 'voix' });
  for (const [nom, Classe] of [['scanner', Scanner], ['scores', Scores], ['defense', Defense], ['enrichissement', Enrichissement], ['vlans', Vlans],
    ['notifications', Notifications], ['commandes', Commandes], ['consoles', Consoles], ['bot', CommandesBot], ['trafic', Trafic], ['assistant', Assistant]]) s[nom] = new Classe(s);
  s.flux = new Flux({ evts: s.evts, comptes, ...(options.fluxControleMs ? { controleMs: options.fluxControleMs } : {}) });

  amorcer(s);
  const amorce = s.jetons.amorcer(cfg.jetonHub);
  if (amorce.fait !== 'rien' && amorce.fait !== 'inchange') log.info(`[integrations] Jeton du Hub : ${amorce.fait}.`);
  await s.extensions.charger(cfg.extensions);

  // Ce qu'une alerte ou un balayage apprend aux autres : SYNAPSE et les extensions.
  s.evts.surAlerte.push(a => s.memoire.surAlerte(a), a => s.extensions.alerte(a));
  s.evts.bus.on('scan:complete', r => s.memoire.surBalayage(r || {}));

  // Les données d'un compte partent avec lui (dans la transaction du socle) ;
  // l'export les lui rend.
  comptes.apresSuppression.push(id => {
    s.assistant.arreter(id);
    db.prepare('DELETE FROM assistant_tours WHERE compte = ?').run(id);
    for (const p of [s.plafond, s.plafondVoix]) p.effacer(`compte:${id}`);
  });
  portail.exporteur = async id => ({
    assistant: s.assistant.fil(id),
    jetonsCrees: db.prepare('SELECT * FROM jetons_integration WHERE createdById = ? ORDER BY createdAt').all(id).map(j => F.jetonIntegration(j)),
  });

  const api = creerApi(s);
  const planif = new Planificateur(s);
  if (options.planifier !== false) {
    planif.demarrer();
    s.notifications.demarrerBot();
    s.assistant.publier();
    s.commandes.declencher('system.boot', { version: VERSION });
  }
  const menage = setInterval(() => s.plafond.purger(), 3600e3);
  menage.unref();

  // Toute requête compte, pages et fichiers compris ; les actions coûteuses
  // ont en plus leurs quotas propres.
  const debit = new Debit({ max: 600 });
  const serveur = http.createServer(envelopper(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://mapmylan');
      const ctx = portail.contexte(req, res);
      const nonce = nonceCsp();
      // Posés avant tout refus : une réponse 429 porte les mêmes en-têtes que
      // les autres. blob: pour les images : l'interface détoure localement un
      // logo choisi par l'utilisateur.
      entetesSecurite(res, { secure: ctx.securise, csp: politiqueContenu({ nonce, secure: ctx.securise, img: ['blob:'] }), permissions: PERMISSIONS });
      if (!debit.prendre(ctx.ip)) {
        journal.rare(`debit:${ctx.ip}`, { action: 'limite.atteinte', objet: 'requetes', ip: ctx.ip, resultat: 'refus' });
        throw new ErreurHttp(429, 'Trop de requêtes.');
      }
      ctx.url = url;
      if (await portail.traiter(req, res, url, ctx)) return;
      if (await api.traiter(ctx)) return;
      if (!['GET', 'HEAD'].includes(req.method)) return repondreJson(res, 405, { error: 'Méthode non admise.' }, { Allow: 'GET, HEAD' });
      if (SEGMENT_CACHE.test(decode(url.pathname))) return repondreJson(res, 404, { error: 'Introuvable.' });
      if (url.pathname.startsWith('/socle/') && servirFichier(req, res, path.join(RACINE, 'socle', 'web'), url.pathname.slice(6), { nonce, cache: 'public, max-age=3600' })) return;
      const fichier = url.pathname === '/' ? '/index.html' : url.pathname;
      if (servirFichier(req, res, path.join(RACINE, 'web'), fichier, { nonce })) return;
      // Une adresse de page sans extension (lien gardé en favori) mène à l'interface.
      if (!path.extname(url.pathname) && servirFichier(req, res, path.join(RACINE, 'web'), '/index.html', { nonce })) return;
      repondreJson(res, 404, { error: 'Introuvable.' });
    } catch (e) {
      // Un équipement ou un service tiers en échec : son message, écrit ici,
      // dit quoi corriger (le socle rendrait « erreur interne »).
      if (e instanceof ErreurHttp && (e.status === 502 || e.status === 503) && !res.headersSent) return repondreJson(res, e.status, { error: e.message, ...(e.details ? { details: e.details } : {}) });
      if (res.headersSent) { res.destroy(); return; }
      repondreErreur(res, e, { journal: log });
    }
  }));
  // Bornes du serveur : une connexion lente ne tient pas un fil ouvert
  // indéfiniment. Le flux temps réel n'est pas concerné (réponse, pas requête).
  serveur.headersTimeout = 20_000;
  serveur.requestTimeout = 120_000;
  serveur.keepAliveTimeout = 5_000;
  await new Promise(r => serveur.listen(cfg.port, cfg.hote, r));
  log.info(`MapMyLAN ${VERSION} à l'écoute sur ${cfg.hote}:${serveur.address().port}`);

  const arreter = () => new Promise(r => {
    socle.arreter(); planif.arreter(); s.notifications.arreterBot(); s.memoire.arreter(); s.flux.fermerTout(); clearInterval(menage);
    serveur.close(() => { db.close(); r(); });
    serveur.closeAllConnections?.();
  });
  return { serveur, socle, cfg, db, s, api, arreter };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  demarrer().then(({ arreter }) => {
    for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => arreter().then(() => process.exit(0)));
  }).catch(e => { console.error(e.message); process.exit(1); });
}
