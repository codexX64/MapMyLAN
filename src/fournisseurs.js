// Catalogue des fournisseurs de courrier : de quoi préremplir IMAP et SMTP à
// partir d'une adresse. Un fournisseur absent n'est pas un problème : « other »
// laisse saisir les serveurs, et c'est le test de connexion qui tranche.
const CATALOGUE = [
  { id: 'gmail', nom: 'Gmail', domaines: ['gmail.com', 'googlemail.com'], imap: { host: 'imap.gmail.com', port: 993, security: 'ssl' }, smtp: { host: 'smtp.gmail.com', port: 465, security: 'ssl' }, note: 'Mot de passe d’application requis : la validation en deux étapes doit être active.' },
  { id: 'apple', nom: 'Apple', domaines: ['me.com', 'mac.com'], imap: { host: 'imap.mail.me.com', port: 993, security: 'ssl' }, smtp: { host: 'smtp.mail.me.com', port: 587, security: 'starttls' }, note: 'Mot de passe pour application requis.' },
  { id: 'outlook', nom: 'Outlook / Hotmail', domaines: ['outlook.com', 'hotmail.com', 'live.com', 'msn.com'], imap: { host: 'outlook.office365.com', port: 993, security: 'ssl' }, smtp: { host: 'smtp-mail.outlook.com', port: 587, security: 'starttls' }, note: 'Les comptes professionnels peuvent exiger OAuth : vérifie auprès de ton administrateur.' },
  { id: 'yahoo', nom: 'Yahoo Mail', domaines: ['yahoo.com', 'yahoo.fr', 'ymail.com'], imap: { host: 'imap.mail.yahoo.com', port: 993, security: 'ssl' }, smtp: { host: 'smtp.mail.yahoo.com', port: 465, security: 'ssl' }, note: 'Mot de passe d’application requis.' },
  { id: 'fastmail', nom: 'Fastmail', domaines: ['fastmail.com', 'fastmail.fm'], imap: { host: 'imap.fastmail.com', port: 993, security: 'ssl' }, smtp: { host: 'smtp.fastmail.com', port: 465, security: 'ssl' }, note: 'Mot de passe d’application requis.' },
  // Le numéro du serveur mutualisé ne se devine pas depuis l'adresse : on le demande.
  { id: 'ovh', nom: 'OVH — mutualisé', domaines: [], imap: { host: 'ssl{n}.ovh.net', port: 993, security: 'ssl' }, smtp: { host: 'ssl{n}.ovh.net', port: 465, security: 'ssl' }, besoins: ['n'], note: 'Le numéro du serveur figure dans l’espace client OVH (ssl0, ssl1, …).' },
  { id: 'other', nom: 'Autre — saisie manuelle', domaines: [], imap: null, smtp: null, note: 'Saisis les serveurs ; le test de connexion valide avant l’enregistrement.' },
];

// « none » (identifiants en clair) n'est plus admis.
export const SECURITES = ['ssl', 'starttls'];

export const lister = () => CATALOGUE.map(f => ({ id: f.id, nom: f.nom, besoins: f.besoins || [], note: f.note || '' }));

export function detecter(email) {
  const d = String(email || '').trim().toLowerCase().split('@')[1] || '';
  return d ? CATALOGUE.find(f => f.domaines.includes(d))?.id || null : null;
}

export function resoudre(id, email, options = {}) {
  const f = CATALOGUE.find(x => x.id === id);
  if (!f) return null;
  const manques = [];
  const garnir = hote => String(hote).replace(/\{(\w+)\}/g, (tout, cle) => {
    const v = options[cle];
    if (v === undefined || v === null || String(v) === '' || !/^\d{1,3}$/.test(String(v))) { if (!manques.includes(cle)) manques.push(cle); return tout; }
    return String(v);
  });
  return {
    provider: f.id, nom: f.nom, note: f.note || '',
    imap: f.imap ? { ...f.imap, host: garnir(f.imap.host) } : null,
    smtp: f.smtp ? { ...f.smtp, host: garnir(f.smtp.host) } : null,
    needs: manques,
  };
}
