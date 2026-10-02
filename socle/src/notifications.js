// Les messages envoyés à l'adresse vérifiée d'un compte : alertes de sécurité
// (REQ-AUTH-014) et lien de vérification (REQ-AUTH-012). Les liens partent de
// SOCLE_URL_PUBLIQUE, jamais de l'en-tête Host d'une requête : une connexion
// hostile ne choisit pas où pointe le lien reçu par la victime.
import { Debit } from './http.js';

const LIBELLES = {
  'connexion.appareil': 'Connexion depuis un nouvel appareil',
  'facteur.ajoute': 'Moyen de connexion ajouté',
  'facteur.retire': 'Moyen de connexion retiré',
  'motdepasse.change': 'Mot de passe changé',
  'motdepasse.reinitialise': 'Mot de passe réinitialisé',
  'secours.utilise': 'Code de secours utilisé',
  'secours.regeneres': 'Codes de secours régénérés',
  'cle.clonee': 'Clé d’accès peut-être copiée',
  'role.change': 'Rôle modifié',
  'courriel.change': 'Adresse d’alerte changée',
  'courriel.retire': 'Adresse d’alerte retirée',
  'vigie.admin': 'Un administrateur s’est connecté depuis un nouvel appareil',
  'vigie.connexions': 'Rafale d’échecs de connexion',
  'vigie.refus': 'Rafale d’accès refusés',
  'vigie.limites': 'Limites de tentatives atteintes à répétition',
  'vigie.erreurs': 'Erreurs internes en série',
  'service.depense': 'Dépense inhabituelle',
};
const FACTEURS = { motdepasse: 'mot de passe', totp: 'application d’authentification', cle: 'clé d’accès' };
const PAS_MOI_MS = 72 * 3600e3;

const heure = t => `${new Date(t).toISOString().slice(0, 16).replace('T', ' à ')} UTC`;

function detail(type, d) {
  if (d.facteur) return FACTEURS[d.facteur] + (d.nom ? ` « ${d.nom} »` : '');
  if (d.nom) return `clé « ${d.nom} »`;
  if (type === 'role.change') return `nouveau rôle : ${d.role}`;
  if (type === 'secours.utilise') return `${d.restants} code${d.restants > 1 ? 's' : ''} restant${d.restants > 1 ? 's' : ''}`;
  if (type === 'courriel.change') return 'les alertes partent désormais vers la nouvelle adresse';
  if (type === 'vigie.admin') return `compte ${d.identifiant}`;
  if (type.startsWith('vigie.')) return `${d.nombre} en ${d.minutes} minutes`;
  if (d.texte) return d.texte;
  return null;
}

export function messageAlerte({ service, compte, type, details, lienPasMoi }) {
  const lignes = [
    `${service.nom} — ${LIBELLES[type]}`,
    `Compte : ${compte.identifiant}`,
    '',
    `Quand : ${heure(details.t)}`,
    details.ip ? `Depuis : ${details.ip} (adresse réseau, localisation approximative)` : null,
    details.appareil ? `Appareil : ${details.appareil}` : null,
    detail(type, details) ? `Détail : ${detail(type, details)}` : null,
    '',
    'Si c’était toi, rien à faire.',
    'Si ce n’était pas toi, ce lien ferme immédiatement toutes les sessions du compte :',
    lienPasMoi,
    'Change ensuite ton mot de passe et vérifie tes moyens de connexion.',
    'Le lien sert une seule fois et expire dans trois jours.',
  ];
  return { sujet: `${service.nom} : ${LIBELLES[type].toLowerCase()}`, texte: lignes.filter(l => l !== null).join('\n') };
}

export function messageVerification({ service, compte, lien }) {
  return {
    sujet: `${service.nom} : confirme ton adresse d’alerte`,
    texte: [
      `Pour recevoir les alertes de sécurité du compte « ${compte.identifiant} » (${service.nom}) à cette adresse, ouvre ce lien dans les trente minutes :`,
      lien,
      '',
      'Si tu n’as rien demandé, ignore ce message : l’adresse ne sera pas enregistrée.',
    ].join('\n'),
  };
}

// Liens envoyés par un administrateur (ou le Hub) à l'adresse du compte :
// invitation et réinitialisation. Le lien sert une fois ; personne d'autre que
// le destinataire ne choisit le mot de passe.
export function messageLien({ service, compte, usage, lien, heures }) {
  const invitation = usage === 'invitation';
  return {
    sujet: invitation ? `${service.nom} : ton compte t’attend` : `${service.nom} : réinitialise ton mot de passe`,
    texte: [
      invitation
        ? `Un compte « ${compte.identifiant} » a été créé pour toi sur ${service.nom}. Ouvre ce lien pour choisir ton mot de passe, puis tes facteurs de connexion :`
        : `Une réinitialisation du mot de passe du compte « ${compte.identifiant} » (${service.nom}) a été demandée par un administrateur. Ouvre ce lien pour en choisir un nouveau :`,
      lien,
      '',
      `Le lien sert une seule fois et expire dans ${heures} heure${heures > 1 ? 's' : ''}.`,
      invitation ? 'Si tu ne t’attendais pas à ce message, ignore-le.' : 'Tes autres facteurs de connexion restent exigés. Si tu n’es pas à l’origine de cette demande, préviens l’administrateur.',
    ].join('\n'),
  };
}

// Canal branché sur Comptes.alerter : seules les adresses vérifiées reçoivent,
// et l'ancienne adresse est prévenue quand elle est remplacée ou retirée. Au
// plus trente messages par compte et par heure : une alerte ne devient pas un
// moyen d'inonder une boîte.
export function notificateur({ postier, comptes, service, urlPublique, log = console }) {
  const debit = new Debit({ max: 30, fenetreMs: 3600e3 });
  return (compte, type, details) => {
    if (!LIBELLES[type] || !debit.prendre(compte.id)) return;
    const destinataires = new Set();
    if (compte.courriel && compte.courriel_verifie) destinataires.add(compte.courriel);
    if (details.ancien) destinataires.add(details.ancien);
    for (const a of destinataires) {
      const jeton = comptes.emettreJeton('pasmoi', compte.id, PAS_MOI_MS);
      const m = messageAlerte({ service, compte, type, details, lienPasMoi: `${urlPublique}/#pas-moi=${jeton}` });
      postier.envoyer({ a, ...m }).catch(e => log.warn?.(`[courriel] alerte ${type} non envoyée : ${e.message}`));
    }
  };
}
