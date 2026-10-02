// Point d'entrée : assemble le socle à partir de l'environnement, de la même
// façon dans chaque service. Les variables SOCLE_* sont communes à tous.
import path from 'node:path';
import { lireConfig } from './config.js';
import { reglerArgon, prechauffer } from './argon.js';
import { Coffre } from './chiffre.js';
import { Journal } from './journal.js';
import { Limiteur } from './limiteur.js';
import { Comptes } from './comptes.js';
import { Portail } from './portail.js';
import { GAMMES, listeConfiance } from './http.js';
import { Postier, adresseValide } from './courriel.js';
import { notificateur } from './notifications.js';
import { Vigie } from './vigie.js';

export * from './http.js';
export * from './outils.js';
export { valider } from './schema.js';
export { lireConfig } from './config.js';
export { Comptes, POLITIQUE_DEFAUT } from './comptes.js';
export { Portail, appareilDe } from './portail.js';
export { Journal } from './journal.js';
export { Limiteur } from './limiteur.js';
export { Coffre } from './chiffre.js';
export { Postier } from './courriel.js';
export { envelopper, requeteCourante } from './requete.js';
export { sauvegarder, dechiffrer } from './sauvegarde.js';

const NIVEAU = { type: 'choix', parmi: ['desactive', 'facultatif', 'requis', 'requis_admin'] };

export const SPEC_SOCLE = {
  // 32 octets en base64, ou en base64url sans remplissage (format des secrets générés par le Hub).
  cle: { env: 'SOCLE_CLE', type: 'chaine', motif: /^(?:[A-Za-z0-9+/]{43}=|[A-Za-z0-9_-]{43})$/ },
  // Pendant une rotation seulement : la clé remplacée, pour resceller ce qu'elle a écrit.
  cleAncienne: { env: 'SOCLE_CLE_ANCIENNE', type: 'chaine', motif: /^(?:[A-Za-z0-9+/]{43}=|[A-Za-z0-9_-]{43})$/ },
  proxys: { env: 'SOCLE_PROXYS', type: 'liste', defaut: [] },
  origines: { env: 'SOCLE_ORIGINES', type: 'liste', defaut: [] },
  modeHttp: { env: 'SOCLE_HTTP', type: 'booleen', defaut: false },
  jetonInstallation: { env: 'SOCLE_JETON_INSTALLATION', type: 'secret', min: 24 },
  sessionHeures: { env: 'SOCLE_SESSION_HEURES', type: 'entier', min: 1, max: 720, defaut: 12 },
  inactiviteMinutes: { env: 'SOCLE_INACTIVITE_MINUTES', type: 'entier', min: 5, max: 1440, defaut: 60 },
  argonM: { env: 'SOCLE_ARGON2_M', type: 'entier', min: 19456, max: 1048576, defaut: 65536 },
  argonT: { env: 'SOCLE_ARGON2_T', type: 'entier', min: 2, max: 16, defaut: 3 },
  argonP: { env: 'SOCLE_ARGON2_P', type: 'entier', min: 1, max: 16, defaut: 4 },
  poivre: { env: 'SOCLE_POIVRE', type: 'secret', min: 32 },
  // Pendant une rotation du poivre : l'ancien (« aucun » s'il n'y en avait pas).
  // Chaque mot de passe passe au nouveau à la connexion suivante.
  poivreAncien: { env: 'SOCLE_POIVRE_ANCIEN', type: 'chaine', motif: /^(?:aucun|\S{32,})$/ },
  politiqueMotdepasse: { env: 'SOCLE_POLITIQUE_MOTDEPASSE', ...NIVEAU, defaut: 'facultatif' },
  politiqueTotp: { env: 'SOCLE_POLITIQUE_TOTP', ...NIVEAU, defaut: 'facultatif' },
  politiqueCle: { env: 'SOCLE_POLITIQUE_CLE', ...NIVEAU, defaut: 'requis_admin' },
  // Alertes par courriel (REQ-AUTH-014). Sans relais, elles restent dans le compte.
  urlPublique: { env: 'SOCLE_URL_PUBLIQUE', type: 'url' },
  smtpHote: { env: 'SOCLE_SMTP_HOTE', type: 'chaine', motif: /^[A-Za-z0-9.:-]{1,253}$/ },
  smtpPort: { env: 'SOCLE_SMTP_PORT', type: 'entier', min: 1, max: 65535 },
  smtpSecurite: { env: 'SOCLE_SMTP_SECURITE', type: 'choix', parmi: ['tls', 'starttls'], defaut: 'tls' },
  smtpUtilisateur: { env: 'SOCLE_SMTP_UTILISATEUR', type: 'chaine' },
  smtpMotDePasse: { env: 'SOCLE_SMTP_MOTDEPASSE', type: 'secret', min: 8 },
  smtpDe: { env: 'SOCLE_SMTP_DE', type: 'chaine' },
  smtpAutorite: { env: 'SOCLE_SMTP_AUTORITE', type: 'chaine' },
  // Gamme de l'interface (SOMA ou Console) : posée par le Hub pour tous les services qui l'acceptent.
  gamme: { env: 'SOCLE_THEME', type: 'choix', parmi: GAMMES, defaut: 'soma' },
  // Administration des comptes déléguée au Hub : jeton à lui seul, généré par
  // le Hub, distinct du jeton de service. Absent : aucune délégation.
  jetonAdminHub: { env: 'SOCLE_JETON_ADMIN_HUB', type: 'secret', min: 32 },
  // Où signaler une faille (security.txt) : adresse https: ou mailto:.
  contactSecurite: { env: 'SOCLE_CONTACT_SECURITE', type: 'chaine', motif: /^(https:\/\/|mailto:)\S{3,300}$/ },
};

// Ce que la validation champ par champ ne voit pas : les réglages qui vont ensemble.
function controlerEnsemble(cfg) {
  const erreurs = [];
  if (cfg.smtpHote) {
    if (!adresseValide(cfg.smtpDe || '')) erreurs.push('SOCLE_SMTP_DE : adresse d’expédition valide obligatoire avec SOCLE_SMTP_HOTE.');
    if (!cfg.urlPublique) erreurs.push('SOCLE_URL_PUBLIQUE est obligatoire avec SOCLE_SMTP_HOTE : les liens des courriels en partent.');
    if (cfg.smtpUtilisateur && !cfg.smtpMotDePasse) erreurs.push('SOCLE_SMTP_MOTDEPASSE est obligatoire avec SOCLE_SMTP_UTILISATEUR.');
  }
  if (cfg.urlPublique && !cfg.modeHttp && !cfg.urlPublique.startsWith('https://') && !/^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(cfg.urlPublique)) {
    erreurs.push('SOCLE_URL_PUBLIQUE doit commencer par https:// (ou SOCLE_HTTP=1).');
  }
  if (erreurs.length) throw Object.assign(new Error('Configuration invalide :\n  - ' + erreurs.join('\n  - ')), { erreurs });
}

// service : { id, nom, contactSecurite } ; db : DatabaseSync (node:sqlite) du
// service ; dossier : volume de données (la clé maîtresse y vit si SOCLE_CLE
// est absente).
// migrer : reprise des comptes d'une version antérieure du service, appelée
// avant que le socle ne décide s'il attend une installation.
export async function demarrerSocle({ service, db, dossier, env = process.env, log = console, notifier = null, maintenant, migrer = null }) {
  const cfg = lireConfig(SPEC_SOCLE, env);
  controlerEnsemble(cfg);
  reglerArgon({ m: cfg.argonM, t: cfg.argonT, p: cfg.argonP, poivre: cfg.poivre, poivreAncien: cfg.poivreAncien });
  const coffre = new Coffre({ cle: cfg.cle, fichier: path.join(dossier, 'cles', 'socle.key'), ancienne: cfg.cleAncienne });
  // Chaque ligne du journal part aussi sur la sortie standard : les journaux du
  // conteneur la gardent hors de portée du service, qui ne peut plus la retoucher.
  const journal = new Journal(db, { sortie: e => log.info?.(JSON.stringify({ journal: service.id, ...e })) });
  const limiteur = new Limiteur(db, { journal, ...(maintenant ? { maintenant } : {}) });
  const comptes = new Comptes({
    db, coffre, journal, limiteur, service, notifier, modeHttp: cfg.modeHttp, ...(maintenant ? { maintenant } : {}),
    politique: { motdepasse: cfg.politiqueMotdepasse, totp: cfg.politiqueTotp, cle: cfg.politiqueCle },
    sessions: { absolueHeures: cfg.sessionHeures, inactiviteMinutes: cfg.inactiviteMinutes },
  });
  const tour = comptes.tournerCle();
  if (tour && coffre.precedente) log.info?.(`[coffre] Clé tournée : ${tour.totp} secret(s) TOTP rescellé(s), ${tour.secours} code(s) de secours vérifiés désormais par leur empreinte. Retire SOCLE_CLE_ANCIENNE.`);
  else if (coffre.precedente) log.warn?.('[coffre] La base est déjà sous SOCLE_CLE : retire SOCLE_CLE_ANCIENNE.');
  const postier = cfg.smtpHote ? new Postier({
    hote: cfg.smtpHote, port: cfg.smtpPort, securite: cfg.smtpSecurite, utilisateur: cfg.smtpUtilisateur, motDePasse: cfg.smtpMotDePasse,
    de: cfg.smtpDe, nom: service.nom, autorite: cfg.smtpAutorite,
  }) : null;
  if (postier) {
    const parCourriel = notificateur({ postier, comptes, service, urlPublique: cfg.urlPublique, log });
    comptes.notifier = notifier ? (...a) => { parCourriel(...a); notifier(...a); } : parCourriel;
  }
  const portail = new Portail({
    comptes, service, proxys: cfg.proxys.length ? listeConfiance(cfg.proxys) : null, origines: cfg.origines, jetonInstallation: cfg.jetonInstallation, journal: log,
    courriel: postier ? { postier } : null, urlPublique: cfg.urlPublique, contactSecurite: cfg.contactSecurite || service.contactSecurite || null,
    jetonAdminHub: cfg.jetonAdminHub || null,
  });
  const vigie = new Vigie({ journal, comptes, ...(maintenant ? { maintenant } : {}) });
  migrer?.({ comptes, coffre, journal });
  await prechauffer();
  const jeton = comptes.jetonInstallation(cfg.jetonInstallation);
  if (jeton && !cfg.jetonInstallation) log.info?.(`[installation] Aucun compte. Jeton d'installation : ${jeton}`);
  const minuterie = setInterval(() => { comptes.purger(); limiteur.purger(); journal.purger(); }, 10 * 60e3);
  const ronde = setInterval(() => vigie.tour(), 60e3);
  minuterie.unref(); ronde.unref();
  return { cfg, coffre, journal, limiteur, comptes, portail, vigie, arreter: () => { clearInterval(minuterie); clearInterval(ronde); } };
}
