// Comptes à facteurs empilables (manuel, partie I, chapitres 2 à 4).
//
// Un compte peut détenir en même temps un mot de passe, un TOTP, plusieurs clés
// d'accès et dix codes de secours. Chaque facteur a sa politique côté serveur
// (désactivé, facultatif, requis, requis pour les administrateurs). Trois
// règles tiennent le reste, et aucune n'est réglable :
//
//   1. une connexion ne se termine que par mot de passe + second facteur, par
//      une clé d'accès (qui vérifie l'utilisateur), ou par mot de passe + code
//      de secours. Un mot de passe seul n'ouvre qu'une session d'inscription ;
//   2. on ne retire jamais un facteur si le compte tombe sous la politique, et
//      tout changement de facteur exige un renfort récent, ferme les autres
//      sessions et laisse une trace ;
//   3. personne n'inscrit un facteur à la place d'un autre : un administrateur
//      invite, exige ou réinitialise, il ne pose jamais de secret.
import crypto from 'node:crypto';
import { hacher, verifier as verifierMdp } from './argon.js';
import { refus as refusMdp } from './motdepasse.js';
import * as totp from './totp.js';
import * as wa from './webauthn.js';
import { ErreurHttp, aleatoire, crockford, normaliseCrockford, sha256hex } from './outils.js';
import { adresseValide } from './courriel.js';

export const FACTEURS = ['motdepasse', 'totp', 'cle'];
export const NIVEAUX = ['desactive', 'facultatif', 'requis', 'requis_admin'];
export const ROLES = ['admin', 'membre', 'lecture'];
export const POLITIQUE_DEFAUT = Object.freeze({ motdepasse: 'facultatif', totp: 'facultatif', cle: 'requis_admin' });

const RENFORT_MS = 5 * 60e3;
const PARTIELLE_MS = 10 * 60e3;
const DEFI_MS = 5 * 60e3;
const INVITATION_MS = 72 * 3600e3;
const REINIT_MS = 20 * 60e3;
const COURRIEL_MS = 30 * 60e3;
const MAX_CLES = 20;
const N_SECOURS = 10;

const nouvelId = prefixe => prefixe + crypto.randomBytes(12).toString('base64url');
export const normaliseIdentifiant = s => String(s || '').normalize('NFKC').trim().toLowerCase();
const IDENTIFIANT = /^[\p{L}\p{N}._@+-]{3,64}$/u;

const erreur = (status, message, details) => new ErreurHttp(status, message, details);

export class Comptes {
  constructor({ db, coffre, journal, limiteur, service, politique = {}, sessions = {}, maintenant = () => Date.now(), notifier = null, modeHttp = false }) {
    this.db = db; this.coffre = coffre; this.journal = journal; this.limiteur = limiteur;
    this.service = service; // { id: 'oracle', nom: 'Oracle' }
    this.maintenant = maintenant;
    this.notifier = notifier;
    // Instance servie en HTTP simple (hors localhost) : aucune clé d'accès ne
    // peut y naître. La règle « un administrateur tient une clé » est alors
    // inapplicable, et l'interface l'affiche en permanence.
    this.modeHttp = !!modeHttp;
    this.absolueMs = (sessions.absolueHeures ?? 12) * 3600e3;
    this.inactiviteMs = (sessions.inactiviteMinutes ?? 60) * 60e3;
    this.politiqueDemarrage = { ...POLITIQUE_DEFAUT, ...politique };
    // Ce que le service fait des données d'un compte supprimé (ses propres tables).
    this.apresSuppression = [];
    this.migrer();
  }

  migrer() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS socle_comptes (
        id TEXT PRIMARY KEY, identifiant TEXT NOT NULL UNIQUE, affichage TEXT NOT NULL,
        role TEXT NOT NULL, mdp TEXT, totp TEXT, totp_pas INTEGER NOT NULL DEFAULT 0, totp_attente TEXT,
        handle TEXT NOT NULL UNIQUE, actif INTEGER NOT NULL DEFAULT 1,
        cree INTEGER NOT NULL, maj INTEGER NOT NULL, derniere INTEGER);
      CREATE TABLE IF NOT EXISTS socle_cles (
        id TEXT PRIMARY KEY, compte TEXT NOT NULL REFERENCES socle_comptes(id) ON DELETE CASCADE,
        cred TEXT NOT NULL UNIQUE, spki TEXT NOT NULL, alg INTEGER NOT NULL, compteur INTEGER NOT NULL DEFAULT 0,
        transports TEXT, aaguid TEXT, sauvegardee INTEGER NOT NULL DEFAULT 0, nom TEXT NOT NULL,
        cree INTEGER NOT NULL, utilisee INTEGER);
      CREATE INDEX IF NOT EXISTS socle_cles_compte ON socle_cles(compte);
      CREATE TABLE IF NOT EXISTS socle_secours (
        id TEXT PRIMARY KEY, compte TEXT NOT NULL REFERENCES socle_comptes(id) ON DELETE CASCADE,
        repere TEXT NOT NULL UNIQUE, empreinte TEXT NOT NULL, cree INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS socle_sessions (
        id TEXT PRIMARY KEY, compte TEXT NOT NULL REFERENCES socle_comptes(id) ON DELETE CASCADE,
        niveau TEXT NOT NULL, facteurs TEXT NOT NULL, csrf TEXT NOT NULL,
        cree INTEGER NOT NULL, vue INTEGER NOT NULL, expire INTEGER NOT NULL, renfort INTEGER NOT NULL DEFAULT 0,
        ip TEXT, appareil TEXT);
      CREATE INDEX IF NOT EXISTS socle_sessions_compte ON socle_sessions(compte);
      CREATE TABLE IF NOT EXISTS socle_defis (
        defi TEXT PRIMARY KEY, lien TEXT NOT NULL, usage TEXT NOT NULL, compte TEXT, expire INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS socle_jetons (
        empreinte TEXT PRIMARY KEY, usage TEXT NOT NULL, compte TEXT, expire INTEGER NOT NULL, donnees TEXT);
      CREATE TABLE IF NOT EXISTS socle_reglages (cle TEXT PRIMARY KEY, valeur TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS socle_alertes (
        id TEXT PRIMARY KEY, compte TEXT NOT NULL REFERENCES socle_comptes(id) ON DELETE CASCADE,
        t INTEGER NOT NULL, type TEXT NOT NULL, details TEXT, vue INTEGER NOT NULL DEFAULT 0);`);
    // Adresse d'alerte, apparue après la première version du socle.
    const colonne = this.db.prepare('SELECT 1 FROM pragma_table_info(?) WHERE name = ?');
    if (!colonne.get('socle_comptes', 'courriel')) this.db.exec('ALTER TABLE socle_comptes ADD COLUMN courriel TEXT');
    if (!colonne.get('socle_comptes', 'courriel_verifie')) this.db.exec('ALTER TABLE socle_comptes ADD COLUMN courriel_verifie INTEGER');
    // Clé d'accès exigée pour ce compte en particulier (un administrateur la
    // tient toujours en HTTPS ; c'est pour les autres que ce réglage compte).
    if (!colonne.get('socle_comptes', 'cle_exigee')) this.db.exec('ALTER TABLE socle_comptes ADD COLUMN cle_exigee INTEGER');
  }

  // Rotation de la clé maîtresse, au démarrage. L'empreinte de contrôle dit
  // sous quelle clé la base a été écrite : rien à faire si c'est la clé
  // actuelle ; une base écrite sous une clé inconnue arrête le démarrage au lieu
  // de perdre les secrets TOTP. Pendant une rotation (SOCLE_CLE_ANCIENNE),
  // chaque secret TOTP est rescellé sous la clé neuve, et les repères des codes
  // de secours, calculés avec l'ancienne et impossibles à recalculer sans les
  // codes, sont marqués : ces codes restent valables par leur empreinte
  // Argon2id (consommerSecours). Tout ou rien.
  tournerCle() {
    const actuelle = this.coffre.controle(), avant = this.coffre.precedente;
    const l = this.db.prepare("SELECT valeur FROM socle_reglages WHERE cle = 'coffre'").get();
    if (l?.valeur === actuelle) return null;
    if (l && l.valeur !== avant?.controle()) throw new Error('SOCLE_CLE n’est pas la clé qui a écrit cette base, SOCLE_CLE_ANCIENNE non plus : pose la bonne, ou les secrets TOTP seraient perdus.');
    return this.transaction(() => {
      let totp = 0;
      for (const c of this.db.prepare('SELECT id, totp, totp_attente FROM socle_comptes WHERE totp IS NOT NULL OR totp_attente IS NOT NULL').all()) {
        for (const [colonne, usage] of [['totp', 'totp'], ['totp_attente', 'totp-attente']]) {
          if (!c[colonne]) continue;
          try { this.coffre.ouvre(usage, c[colonne], c.id); continue; } catch { /* scellé sous une autre clé */ }
          let clair;
          try { clair = avant.ouvre(usage, c[colonne], c.id); } catch { throw new Error(`Secret TOTP du compte ${c.id} illisible avec SOCLE_CLE${avant ? ' comme avec SOCLE_CLE_ANCIENNE' : ''} : pose la clé qui l’a écrit.`); }
          this.db.prepare(`UPDATE socle_comptes SET ${colonne} = ? WHERE id = ?`).run(this.coffre.scelle(usage, clair, c.id), c.id);
          totp++;
        }
      }
      const secours = avant ? this.db.prepare("UPDATE socle_secours SET repere = 'ancienne:' || id WHERE repere NOT LIKE 'ancienne:%'").run().changes : 0;
      this.db.prepare("INSERT INTO socle_reglages(cle, valeur) VALUES('coffre', ?) ON CONFLICT(cle) DO UPDATE SET valeur = excluded.valeur").run(actuelle);
      if (avant) this.trace({ acteur: 'système', action: 'coffre.tourne', details: { totp, secours } });
      return { totp, secours };
    });
  }

  transaction(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try { const r = fn(); this.db.exec('COMMIT'); return r; } catch (e) { this.db.exec('ROLLBACK'); throw e; }
  }

  trace(evt) { this.journal?.ecrire(evt); }

  politique() {
    const l = this.db.prepare("SELECT valeur FROM socle_reglages WHERE cle = 'politique'").get();
    const p = { ...this.politiqueDemarrage, ...(l ? JSON.parse(l.valeur) : {}) };
    if (this.modeHttp && p.cle !== 'desactive') p.cle = 'facultatif';
    return p;
  }

  definirPolitique(p, { acteur, ip }) {
    const net = {};
    for (const f of FACTEURS) {
      if (!NIVEAUX.includes(p[f])) throw erreur(400, `Politique : valeur inconnue pour ${f}.`);
      net[f] = p[f];
    }
    if (net.totp === 'desactive' && net.cle === 'desactive') throw erreur(400, 'Au moins un second facteur doit rester possible.');
    if (net.motdepasse === 'desactive' && net.cle === 'desactive') throw erreur(400, 'Sans mot de passe, les clés d’accès sont le seul moyen de connexion.');
    this.db.prepare("INSERT INTO socle_reglages(cle, valeur) VALUES('politique', ?) ON CONFLICT(cle) DO UPDATE SET valeur = excluded.valeur").run(JSON.stringify(net));
    this.trace({ acteur, action: 'politique.modifiee', ip, details: net });
    return this.politique();
  }

  // Ce que la politique exige de ce compte et qu'il ne détient pas encore.
  manquants(compte) {
    const p = this.politique();
    const detenus = this.facteursDe(compte);
    const admin = compte.role === 'admin';
    const exige = f => p[f] === 'requis' || (p[f] === 'requis_admin' && admin) || (f === 'cle' && compte.cle_exigee && !this.modeHttp);
    const out = FACTEURS.filter(f => exige(f) && !detenus[f]);
    const seconds = (detenus.totp ? 1 : 0) + (detenus.cle ? 1 : 0);
    // Règle 1 : un mot de passe seul ne suffit jamais.
    if (!seconds && !out.includes('totp') && !out.includes('cle')) out.push('second');
    // REQ-AUTH-013 : un administrateur tient deux facteurs, dont un résistant à
    // l'hameçonnage — sauf en mode HTTP, où aucune clé ne peut exister.
    if (admin) {
      const n = (detenus.motdepasse ? 1 : 0) + seconds;
      if (n < 2 && !out.includes('second') && !out.includes('totp') && !out.includes('cle')) out.push('second');
      if (!this.modeHttp && !detenus.cle && !out.includes('cle')) out.push('cle');
    }
    return out;
  }

  facteursDe(compte) {
    const cles = this.db.prepare('SELECT COUNT(*) n FROM socle_cles WHERE compte = ?').get(compte.id).n;
    const secours = this.db.prepare('SELECT COUNT(*) n FROM socle_secours WHERE compte = ?').get(compte.id).n;
    return { motdepasse: !!compte.mdp, totp: !!compte.totp, cle: cles > 0, nCles: cles, secours };
  }

  compte(id) { return this.db.prepare('SELECT * FROM socle_comptes WHERE id = ?').get(id) || null; }
  parIdentifiant(identifiant) { return this.db.prepare('SELECT * FROM socle_comptes WHERE identifiant = ?').get(normaliseIdentifiant(identifiant)) || null; }
  estInstalle() { return !!this.db.prepare('SELECT 1 FROM socle_comptes LIMIT 1').get(); }

  publicDe(c) {
    const f = this.facteursDe(c);
    return {
      id: c.id, identifiant: c.identifiant, affichage: c.affichage, role: c.role, actif: !!c.actif,
      facteurs: { motdepasse: f.motdepasse, totp: f.totp, cles: f.nCles, secours: f.secours },
      manquants: this.manquants(c), cree: c.cree, derniere: c.derniere,
      courriel: c.courriel_verifie ? c.courriel : null,
      cle: this.regleCle(c),
    };
  }

  // Ce que ce compte doit à la clé d'accès : « http » (aucune clé possible),
  // « toujours » (administrateur ou politique du service), « exigee » (réglée
  // pour ce compte) ou « facultative ».
  regleCle(c) {
    if (this.modeHttp) return 'http';
    const p = this.politique();
    if (c.role === 'admin' || p.cle === 'requis') return 'toujours';
    return c.cle_exigee ? 'exigee' : 'facultative';
  }

  lister() { return this.db.prepare('SELECT * FROM socle_comptes ORDER BY identifiant').all().map(c => this.publicDe(c)); }

  creerCompte({ identifiant, affichage, role }) {
    const ident = normaliseIdentifiant(identifiant);
    if (!IDENTIFIANT.test(ident)) throw erreur(400, 'Identifiant : 3 à 64 caractères, lettres, chiffres et . _ @ + -');
    if (!ROLES.includes(role)) throw erreur(400, 'Rôle inconnu.');
    if (this.parIdentifiant(ident)) throw erreur(409, 'Cet identifiant est déjà pris.');
    const t = this.maintenant();
    const id = nouvelId('c_');
    this.db.prepare('INSERT INTO socle_comptes(id, identifiant, affichage, role, handle, cree, maj) VALUES(?,?,?,?,?,?,?)')
      .run(id, ident, String(affichage || ident).slice(0, 80), role, crypto.randomBytes(16).toString('base64url'), t, t);
    return this.compte(id);
  }

  // Premier compte : il faut le jeton d'installation (journaux du conteneur, ou
  // valeur posée par le Hub). Sans lui, quiconque atteint le port avant le
  // propriétaire prendrait l'instance.
  jetonInstallation(depuisEnv) {
    if (this.estInstalle()) return null;
    if (depuisEnv) return depuisEnv;
    let l = this.db.prepare("SELECT valeur FROM socle_reglages WHERE cle = 'installation'").get();
    if (!l) {
      const j = aleatoire(24);
      this.db.prepare("INSERT INTO socle_reglages(cle, valeur) VALUES('installation', ?)").run(j);
      l = { valeur: j };
    }
    return l.valeur;
  }

  async installer({ jeton, jetonAttendu, identifiant, motDePasse, affichage, ip, appareil }) {
    const cles = ['installation', `ip:${ip}`];
    this.limiteur.controler(cles);
    if (this.estInstalle()) throw erreur(409, 'Ce service est déjà configuré.');
    const attendu = Buffer.from(sha256hex(String(jetonAttendu || '')));
    if (!jetonAttendu || !crypto.timingSafeEqual(attendu, Buffer.from(sha256hex(String(jeton || ''))))) {
      this.limiteur.echec(cles);
      this.trace({ action: 'installation.refusee', ip, resultat: 'refus' });
      throw erreur(403, 'Jeton d’installation incorrect. Il figure dans les journaux du service.');
    }
    const r = refusMdp(motDePasse, { identifiant, service: this.service.id });
    if (r) throw erreur(400, r);
    const empreinte = await hacher(motDePasse);
    const c = this.transaction(() => {
      if (this.estInstalle()) throw erreur(409, 'Ce service est déjà configuré.');
      const c = this.creerCompte({ identifiant, affichage, role: 'admin' });
      this.db.prepare('UPDATE socle_comptes SET mdp = ? WHERE id = ?').run(empreinte, c.id);
      this.db.prepare("DELETE FROM socle_reglages WHERE cle = 'installation'").run();
      return c;
    });
    this.limiteur.reussite(cles);
    this.trace({ acteur: c.id, action: 'installation', objet: c.id, ip });
    return this.ouvrirSession(this.compte(c.id), { facteurs: ['motdepasse'], ip, appareil });
  }

  // Le cookie porte un jeton aléatoire ; la base n'en garde que l'empreinte.
  ouvrirSession(compte, { facteurs, ip, appareil, partielle = false, rotation = false }) {
    const t = this.maintenant();
    const jeton = aleatoire(32);
    const niveau = partielle ? 'partiel' : (this.manquants(compte).length ? 'inscription' : 'complet');
    const expire = t + (partielle ? PARTIELLE_MS : this.absolueMs);
    const csrf = aleatoire(24);
    this.db.prepare('INSERT INTO socle_sessions(id, compte, niveau, facteurs, csrf, cree, vue, expire, renfort, ip, appareil) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
      .run(sha256hex(jeton), compte.id, niveau, JSON.stringify(facteurs), csrf, t, t, expire, partielle ? 0 : t, ip || null, String(appareil || '').slice(0, 160));
    if (!partielle && !rotation) {
      this.db.prepare('UPDATE socle_comptes SET derniere = ? WHERE id = ?').run(t, compte.id);
      this.nouvelAppareil(compte, { ip, appareil });
    }
    return { jeton, csrf, niveau, expire };
  }

  // Remplace une session par une autre (identifiant neuf à chaque changement de
  // niveau ou de privilège : pas de fixation possible).
  promouvoir(session, facteurs, { ip, appareil }) {
    this.db.prepare('DELETE FROM socle_sessions WHERE id = ?').run(session.id);
    return this.ouvrirSession(this.compte(session.compte), { facteurs, ip, appareil, rotation: session.niveau !== 'partiel' });
  }

  session(jeton) {
    if (!jeton || typeof jeton !== 'string' || jeton.length > 100) return null;
    const id = sha256hex(jeton);
    const s = this.db.prepare('SELECT * FROM socle_sessions WHERE id = ?').get(id);
    if (!s) return null;
    const t = this.maintenant();
    if (s.expire < t || (s.niveau !== 'partiel' && t - s.vue > this.inactiviteMs)) {
      this.db.prepare('DELETE FROM socle_sessions WHERE id = ?').run(id);
      return null;
    }
    const compte = this.compte(s.compte);
    if (!compte || !compte.actif) { this.db.prepare('DELETE FROM socle_sessions WHERE id = ?').run(id); return null; }
    // Le niveau suit la politique en cours : un facteur devenu requis ramène la
    // session en inscription dès la requête suivante.
    let niveau = s.niveau;
    if (niveau !== 'partiel') niveau = this.manquants(compte).length ? 'inscription' : 'complet';
    if (t - s.vue > 60e3 || niveau !== s.niveau) this.db.prepare('UPDATE socle_sessions SET vue = ?, niveau = ? WHERE id = ?').run(t, niveau, id);
    return { ...s, niveau, facteurs: JSON.parse(s.facteurs), compteLigne: compte };
  }

  // Pour un flux ouvert (SSE) : la session existe-t-elle encore, sans compter
  // la vérification comme une activité ? Un flux laissé ouvert ne doit ni
  // survivre à une révocation, ni prolonger une session inactive.
  sessionVivante(jeton) {
    if (!jeton || typeof jeton !== 'string' || jeton.length > 100) return false;
    const s = this.db.prepare('SELECT compte, niveau, expire, vue FROM socle_sessions WHERE id = ?').get(sha256hex(jeton));
    const t = this.maintenant();
    if (!s || s.niveau === 'partiel' || s.expire < t || t - s.vue > this.inactiviteMs) return false;
    return !!this.compte(s.compte)?.actif;
  }

  sessionsDe(compteId, courante) {
    return this.db.prepare('SELECT id, niveau, cree, vue, expire, ip, appareil FROM socle_sessions WHERE compte = ? AND niveau != ? ORDER BY vue DESC')
      .all(compteId, 'partiel').map(s => ({ ...s, id: s.id.slice(0, 16), courante: s.id === courante }));
  }

  fermerSession(id) { this.db.prepare('DELETE FROM socle_sessions WHERE id = ?').run(id); }
  fermerParPrefixe(compteId, prefixe) {
    if (!/^[0-9a-f]{16}$/.test(prefixe)) throw erreur(400, 'Session inconnue.');
    const r = this.db.prepare("DELETE FROM socle_sessions WHERE compte = ? AND substr(id, 1, 16) = ?").run(compteId, prefixe);
    if (!r.changes) throw erreur(404, 'Session inconnue.');
  }
  fermerAutres(compteId, sauf) { this.db.prepare('DELETE FROM socle_sessions WHERE compte = ? AND id != ?').run(compteId, sauf || ''); }
  fermerToutes(compteId) { this.db.prepare('DELETE FROM socle_sessions WHERE compte = ?').run(compteId); }
  fermerTout() { this.db.prepare('DELETE FROM socle_sessions').run(); }

  estRenforcee(session) { return session.renfort && this.maintenant() - session.renfort < RENFORT_MS; }
  exigerRenfort(session) {
    // Le Hub, délégué par son jeton d'administration, a exigé le renfort de
    // son opérateur avant d'entrer (Portail.delegue).
    if (session?.delegue === true && session.compte === 'hub') return;
    if (!this.estRenforcee(session)) throw erreur(403, 'Confirme ton identité pour continuer.', { renfort: true, methodes: this.methodesRenfort(session.compteLigne) });
  }

  // REQ-AUTH-014 : chaque événement de sécurité est gardé dans le compte (et
  // envoyé si un canal de notification est configuré), avec « ce n'était pas
  // moi » qui ferme toutes les sessions.
  alerter(compte, type, details = {}) {
    const t = this.maintenant();
    this.db.prepare('INSERT INTO socle_alertes(id, compte, t, type, details) VALUES(?,?,?,?,?)')
      .run(nouvelId('a_'), compte.id, t, type, JSON.stringify(details));
    this.db.prepare('DELETE FROM socle_alertes WHERE compte = ? AND id NOT IN (SELECT id FROM socle_alertes WHERE compte = ? ORDER BY t DESC LIMIT 50)').run(compte.id, compte.id);
    try { this.notifier?.(compte, type, { ...details, t }); } catch { /* le canal ne décide pas du succès de l'action */ }
  }
  alertesDe(compteId) {
    return this.db.prepare('SELECT id, t, type, details, vue FROM socle_alertes WHERE compte = ? ORDER BY t DESC LIMIT 50').all(compteId)
      .map(a => ({ ...a, details: JSON.parse(a.details || '{}'), vue: !!a.vue }));
  }
  marquerAlertesVues(compteId) { this.db.prepare('UPDATE socle_alertes SET vue = 1 WHERE compte = ?').run(compteId); }

  // Les administrateurs sont prévenus de ce qui menace le service entier : une
  // rafale d'échecs, un administrateur qui se connecte d'un appareil inconnu.
  alerterAdmins(type, details = {}, { sauf = null } = {}) {
    for (const a of this.db.prepare("SELECT * FROM socle_comptes WHERE role = 'admin' AND actif = 1").all()) if (a.id !== sauf) this.alerter(a, type, details);
  }

  nouvelAppareil(compte, { ip, appareil }) {
    const deja = this.db.prepare('SELECT 1 FROM socle_sessions WHERE compte = ? AND appareil = ? AND niveau != ? LIMIT 2').all(compte.id, String(appareil || '').slice(0, 160), 'partiel');
    if (deja.length > 1) return;
    this.alerter(compte, 'connexion.appareil', { ip, appareil: String(appareil || '').slice(0, 160) });
    if (compte.role === 'admin') this.alerterAdmins('vigie.admin', { ip, appareil: String(appareil || '').slice(0, 160), identifiant: compte.identifiant }, { sauf: compte.id });
  }

  clesLimiteur(ip, identifiant) { return [`ip:${ip}`, `compte:${normaliseIdentifiant(identifiant)}`]; }

  async connexionMotDePasse({ identifiant, motDePasse, preuve, ip, appareil }) {
    if (this.politique().motdepasse === 'desactive') throw erreur(403, 'La connexion par mot de passe est désactivée : utilise ta clé d’accès.');
    const cles = this.clesLimiteur(ip, identifiant);
    if (this.limiteur.controler(cles) && !this.limiteur.verifierPreuve(preuve)) {
      throw erreur(428, 'Vérification supplémentaire requise.', { preuve: this.limiteur.emettrePreuve() });
    }
    const c = this.parIdentifiant(identifiant);
    const r = await verifierMdp(String(motDePasse ?? ''), c?.actif ? c.mdp : null);
    if (!c || !c.actif || !r.ok) {
      this.limiteur.echec(cles);
      this.trace({ acteur: c?.id || null, action: 'connexion.motdepasse', ip, resultat: 'refus', details: { identifiant: normaliseIdentifiant(identifiant).slice(0, 64) } });
      throw erreur(401, 'Identifiant ou mot de passe incorrect.');
    }
    if (r.nouvelle) this.db.prepare('UPDATE socle_comptes SET mdp = ?, maj = ? WHERE id = ?').run(r.nouvelle, this.maintenant(), c.id);
    const f = this.facteursDe(c);
    if (f.totp || f.cle) {
      this.trace({ acteur: c.id, action: 'connexion.motdepasse', ip, resultat: 'second-facteur' });
      const s = this.ouvrirSession(c, { facteurs: ['motdepasse'], ip, appareil, partielle: true });
      return { ...s, etape: 'second', methodes: this.methodesSecondes(c) };
    }
    this.limiteur.reussite([cles[1]]);
    this.trace({ acteur: c.id, action: 'connexion', ip, details: { facteurs: 'motdepasse' } });
    // Aucun second facteur détenu : la session ne sert qu'à en inscrire un.
    return { ...this.ouvrirSession(c, { facteurs: ['motdepasse'], ip, appareil }), etape: 'inscription' };
  }

  connexionTotp(session, code, { ip, appareil }) {
    if (session?.niveau !== 'partiel') throw erreur(401, 'Recommence la connexion.');
    const c = session.compteLigne;
    const cles = [`ip:${ip}`, `compte:${c.identifiant}`];
    this.limiteur.controler(cles);
    const pas = c.totp ? totp.verifier(this.coffre.ouvre('totp', c.totp, c.id), code, { dernierPas: c.totp_pas, t: this.maintenant() }) : null;
    if (pas === null) {
      this.limiteur.echec(cles);
      this.trace({ acteur: c.id, action: 'connexion.totp', ip, resultat: 'refus' });
      throw erreur(401, 'Code incorrect ou déjà utilisé.');
    }
    this.db.prepare('UPDATE socle_comptes SET totp_pas = ? WHERE id = ?').run(pas, c.id);
    this.limiteur.reussite([cles[1]]);
    this.trace({ acteur: c.id, action: 'connexion', ip, details: { facteurs: 'motdepasse+totp' } });
    return this.promouvoir(session, [...session.facteurs, 'totp'], { ip, appareil });
  }

  methodesSecondes(c) {
    const f = this.facteursDe(c);
    return [...(f.totp ? ['totp'] : []), ...(f.cle && !this.modeHttp ? ['cle'] : []), ...(f.secours ? ['secours'] : [])];
  }

  async connexionSecours(session, code, { ip, appareil }) {
    if (session?.niveau !== 'partiel') throw erreur(401, 'Recommence la connexion.');
    const c = session.compteLigne;
    const cles = [`ip:${ip}`, `compte:${c.identifiant}`];
    this.limiteur.controler(cles);
    if (!(await this.consommerSecours(c, code))) {
      this.limiteur.echec(cles);
      this.trace({ acteur: c.id, action: 'connexion.secours', ip, resultat: 'refus' });
      throw erreur(401, 'Code de secours incorrect ou déjà utilisé.');
    }
    this.limiteur.reussite([cles[1]]);
    const restants = this.facteursDe(c).secours;
    this.trace({ acteur: c.id, action: 'connexion', ip, details: { facteurs: 'motdepasse+secours', restants } });
    this.alerter(c, 'secours.utilise', { ip, restants });
    // Un code de secours est une porte de sortie : les autres sessions tombent.
    this.fermerToutes(c.id);
    return { ...this.ouvrirSession(c, { facteurs: [...session.facteurs, 'secours'], ip, appareil }), restants };
  }

  async consommerSecours(c, saisi) {
    const propre = normaliseCrockford(saisi);
    if (!/^[0-9A-Z]{20}$/.test(propre)) return false;
    const repere = this.coffre.empreinte('secours', c.id + ':' + propre);
    const l = this.db.prepare('SELECT id, empreinte FROM socle_secours WHERE compte = ? AND repere = ?').get(c.id, repere);
    const brule = id => this.db.prepare('DELETE FROM socle_secours WHERE id = ?').run(id).changes === 1;
    if (l) return (await verifierMdp(propre, l.empreinte)).ok && brule(l.id);
    // Codes nés avant une rotation de la clé : leur repère n'a pas pu suivre.
    for (const a of this.db.prepare("SELECT id, empreinte FROM socle_secours WHERE compte = ? AND repere LIKE 'ancienne:%'").all(c.id)) {
      if ((await verifierMdp(propre, a.empreinte)).ok) return brule(a.id);
    }
    return false;
  }

  // Défis WebAuthn : usage unique, liés à la session (ou à la cérémonie en
  // cours avant connexion), cinq minutes de vie.
  poserDefi(lien, usage, compte = null) {
    const defi = aleatoire(32);
    const t = this.maintenant();
    this.db.prepare('DELETE FROM socle_defis WHERE expire < ? OR (lien = ? AND usage = ?)').run(t, lien, usage);
    this.db.prepare('INSERT INTO socle_defis(defi, lien, usage, compte, expire) VALUES(?,?,?,?,?)').run(defi, lien, usage, compte, t + DEFI_MS);
    return defi;
  }
  prendreDefi(lien, usage) {
    const l = this.db.prepare('SELECT defi, compte, expire FROM socle_defis WHERE lien = ? AND usage = ?').get(lien, usage);
    this.db.prepare('DELETE FROM socle_defis WHERE lien = ? AND usage = ?').run(lien, usage);
    if (!l || l.expire < this.maintenant()) throw erreur(400, 'Délai dépassé : recommence.');
    return l;
  }

  exigerContexteCle(ctx) {
    if (!ctx?.securise || !ctx.origine || !ctx.rpId) throw erreur(400, 'Les clés d’accès exigent une connexion HTTPS (ou localhost).');
  }

  cleEnregistree(credId) { return this.db.prepare('SELECT * FROM socle_cles WHERE cred = ?').get(String(credId || '')) || null; }

  // Options de connexion par clé. lien : l'identifiant de la session partielle,
  // ou celui de la cérémonie anonyme (cookie posé par l'appelant).
  optionsConnexionCle({ lien, session, ctx }) {
    this.exigerContexteCle(ctx);
    const compte = session?.niveau === 'partiel' ? session.compteLigne : null;
    const defi = this.poserDefi(lien, 'connexion', compte?.id || null);
    const autorises = compte ? this.db.prepare('SELECT cred FROM socle_cles WHERE compte = ?').all(compte.id).map(l => l.cred) : [];
    return wa.optionsAuthentification({ rpId: ctx.rpId, defi, autorises });
  }

  connexionCle({ lien, session, reponse, ctx, ip, appareil }) {
    this.exigerContexteCle(ctx);
    const { defi, compte: attenduId } = this.prendreDefi(lien, 'connexion');
    const cle = this.cleEnregistree(reponse?.id);
    const cles = [`ip:${ip}`];
    this.limiteur.controler(cles);
    const c = cle ? this.compte(cle.compte) : null;
    const refuser = raison => {
      this.limiteur.echec(cles);
      this.trace({ acteur: c?.id || null, action: 'connexion.cle', ip, resultat: 'refus', details: { raison } });
      return erreur(401, 'Clé d’accès refusée.');
    };
    if (!cle || !c || !c.actif) throw refuser('clé inconnue');
    if (attenduId && attenduId !== c.id) throw refuser('clé d’un autre compte');
    let r;
    try {
      r = wa.verifierAuthentification({ reponse, defi, origines: [ctx.origine], rpId: ctx.rpId, cle: { ...cle, handle: c.handle } });
    } catch (e) {
      if (/compteur/.test(e.message)) this.alerter(c, 'cle.clonee', { nom: cle.nom });
      throw refuser(e.message);
    }
    this.db.prepare('UPDATE socle_cles SET compteur = ?, utilisee = ?, sauvegardee = ? WHERE id = ?').run(r.compteur, this.maintenant(), r.sauvegardee ? 1 : 0, cle.id);
    this.limiteur.reussite([`compte:${c.identifiant}`]);
    const facteurs = session?.niveau === 'partiel' && session.compte === c.id ? [...session.facteurs, 'cle'] : ['cle'];
    this.trace({ acteur: c.id, action: 'connexion', ip, details: { facteurs: facteurs.join('+') } });
    if (session?.niveau === 'partiel') this.fermerSession(session.id);
    return this.ouvrirSession(c, { facteurs, ip, appareil });
  }

  // En inscription forcée, poser un facteur n'exige pas de renfort : la session
  // vient d'être ouverte et c'est la seule chose qu'elle permet. Ailleurs, si.
  exigerPourAjout(session) {
    if (session.niveau === 'inscription' && this.maintenant() - session.cree < PARTIELLE_MS) return;
    this.exigerRenfort(session);
  }

  debutTotp(session) {
    this.exigerPourAjout(session);
    const c = session.compteLigne;
    if (this.politique().totp === 'desactive') throw erreur(403, 'Le TOTP est désactivé sur ce service.');
    if (c.totp) throw erreur(409, 'Une application d’authentification est déjà enregistrée. Retire-la d’abord.');
    const secret = totp.nouveauSecret();
    this.db.prepare('UPDATE socle_comptes SET totp_attente = ? WHERE id = ?').run(this.coffre.scelle('totp-attente', secret, c.id), c.id);
    return { secret, otpauth: totp.uriOtpauth({ emetteur: this.service.nom, compte: c.identifiant, secret }) };
  }

  confirmerTotp(session, code, { ip }) {
    this.exigerPourAjout(session);
    const c = this.compte(session.compte);
    if (!c.totp_attente) throw erreur(400, 'Recommence l’inscription.');
    const cles = [`compte:${c.identifiant}`];
    this.limiteur.controler(cles);
    const secret = this.coffre.ouvre('totp-attente', c.totp_attente, c.id);
    const pas = totp.verifier(secret, code, { t: this.maintenant() });
    if (pas === null) { this.limiteur.echec(cles); throw erreur(400, 'Code incorrect : vérifie l’heure du téléphone et réessaie.'); }
    this.db.prepare('UPDATE socle_comptes SET totp = ?, totp_pas = ?, totp_attente = NULL, maj = ? WHERE id = ?')
      .run(this.coffre.scelle('totp', secret, c.id), pas, this.maintenant(), c.id);
    return this.apresChangement(session, 'facteur.ajoute', { facteur: 'totp', ip });
  }

  retirerTotp(session, { ip }) {
    this.exigerRenfort(session);
    const c = session.compteLigne;
    if (!c.totp) throw erreur(404, 'Aucune application enregistrée.');
    this.verifierRetrait(c, f => ({ ...f, totp: false }));
    this.db.prepare('UPDATE socle_comptes SET totp = NULL, totp_pas = 0, maj = ? WHERE id = ?').run(this.maintenant(), c.id);
    return this.apresChangement(session, 'facteur.retire', { facteur: 'totp', ip });
  }

  optionsNouvelleCle(session, ctx) {
    this.exigerPourAjout(session);
    this.exigerContexteCle(ctx);
    if (this.politique().cle === 'desactive') throw erreur(403, 'Les clés d’accès sont désactivées sur ce service.');
    const c = session.compteLigne;
    const existantes = this.db.prepare('SELECT cred FROM socle_cles WHERE compte = ?').all(c.id).map(l => l.cred);
    if (existantes.length >= MAX_CLES) throw erreur(409, `Au plus ${MAX_CLES} clés par compte.`);
    const defi = this.poserDefi(session.id, 'inscription', c.id);
    return wa.optionsCreation({ rp: { id: ctx.rpId, nom: this.service.nom }, utilisateur: { handle: c.handle, nom: c.identifiant, affichage: c.affichage }, defi, exclure: existantes });
  }

  ajouterCle(session, { reponse, nom, ctx, ip }) {
    this.exigerPourAjout(session);
    this.exigerContexteCle(ctx);
    const c = session.compteLigne;
    const { defi } = this.prendreDefi(session.id, 'inscription');
    let r;
    try { r = wa.verifierCreation({ reponse, defi, origines: [ctx.origine], rpId: ctx.rpId }); }
    catch (e) {
      this.trace({ acteur: c.id, action: 'cle.inscription', ip, resultat: 'refus', details: { raison: e.message } });
      throw erreur(400, `Clé refusée : ${e.message}.`);
    }
    if (this.cleEnregistree(r.credId)) throw erreur(409, 'Cette clé est déjà enregistrée.');
    const id = nouvelId('k_');
    this.db.prepare('INSERT INTO socle_cles(id, compte, cred, spki, alg, compteur, transports, aaguid, sauvegardee, nom, cree) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
      .run(id, c.id, r.credId, r.spki, r.alg, r.compteur, JSON.stringify(r.transports), r.aaguid, r.sauvegardee ? 1 : 0, String(nom || 'Clé d’accès').trim().slice(0, 60) || 'Clé d’accès', this.maintenant());
    return { ...this.apresChangement(session, 'facteur.ajoute', { facteur: 'cle', nom: String(nom || '').slice(0, 60), ip }), id };
  }

  clesDe(compteId) {
    return this.db.prepare('SELECT id, nom, cree, utilisee, sauvegardee, transports FROM socle_cles WHERE compte = ? ORDER BY cree').all(compteId)
      .map(k => ({ ...k, sauvegardee: !!k.sauvegardee, transports: JSON.parse(k.transports || '[]') }));
  }

  renommerCle(session, id, nom) {
    const propre = String(nom || '').trim().slice(0, 60);
    if (!propre) throw erreur(400, 'Nom vide.');
    const r = this.db.prepare('UPDATE socle_cles SET nom = ? WHERE id = ? AND compte = ?').run(propre, id, session.compte);
    if (!r.changes) throw erreur(404, 'Clé inconnue.');
  }

  retirerCle(session, id, { ip }) {
    this.exigerRenfort(session);
    const c = session.compteLigne;
    const cle = this.db.prepare('SELECT id, nom FROM socle_cles WHERE id = ? AND compte = ?').get(id, c.id);
    if (!cle) throw erreur(404, 'Clé inconnue.');
    this.verifierRetrait(c, f => ({ ...f, nCles: f.nCles - 1, cle: f.nCles - 1 > 0 }));
    this.db.prepare('DELETE FROM socle_cles WHERE id = ?').run(id);
    return this.apresChangement(session, 'facteur.retire', { facteur: 'cle', nom: cle.nom, ip });
  }

  async regenererSecours(session, { ip }) {
    this.exigerPourAjout(session);
    const c = session.compteLigne;
    const codes = Array.from({ length: N_SECOURS }, () => crockford(20));
    const lignes = [];
    for (const code of codes) lignes.push([nouvelId('s_'), this.coffre.empreinte('secours', c.id + ':' + code), await hacher(code)]);
    this.transaction(() => {
      this.db.prepare('DELETE FROM socle_secours WHERE compte = ?').run(c.id);
      for (const [id, repere, h] of lignes) this.db.prepare('INSERT INTO socle_secours(id, compte, repere, empreinte, cree) VALUES(?,?,?,?,?)').run(id, c.id, repere, h, this.maintenant());
    });
    return { ...this.apresChangement(session, 'secours.regeneres', { ip }), codes: codes.map(x => x.match(/.{4}/g).join('-')) };
  }

  async changerMotDePasse(session, nouveau, { ip }) {
    this.exigerPourAjout(session);
    if (this.politique().motdepasse === 'desactive') throw erreur(403, 'Les mots de passe sont désactivés sur ce service.');
    const c = session.compteLigne;
    const r = refusMdp(nouveau, { identifiant: c.identifiant, service: this.service.id });
    if (r) throw erreur(400, r);
    this.db.prepare('UPDATE socle_comptes SET mdp = ?, maj = ? WHERE id = ?').run(await hacher(nouveau), this.maintenant(), c.id);
    return this.apresChangement(session, c.mdp ? 'motdepasse.change' : 'facteur.ajoute', { facteur: 'motdepasse', ip });
  }

  retirerMotDePasse(session, { ip }) {
    this.exigerRenfort(session);
    const c = session.compteLigne;
    if (!c.mdp) throw erreur(404, 'Aucun mot de passe.');
    this.verifierRetrait(c, f => ({ ...f, motdepasse: false }));
    this.db.prepare('UPDATE socle_comptes SET mdp = NULL, maj = ? WHERE id = ?').run(this.maintenant(), c.id);
    return this.apresChangement(session, 'facteur.retire', { facteur: 'motdepasse', ip });
  }

  // REQ-AUTH-005 : le retrait est simulé, puis refusé s'il laisse le compte
  // sous la politique ou sans aucun moyen de connexion complet.
  verifierRetrait(c, apres) {
    const f = apres(this.facteursDe(c));
    const p = this.politique();
    const admin = c.role === 'admin';
    const exige = x => p[x] === 'requis' || (p[x] === 'requis_admin' && admin) || (x === 'cle' && c.cle_exigee && !this.modeHttp);
    const detient = { motdepasse: f.motdepasse, totp: f.totp, cle: f.cle };
    for (const x of FACTEURS) if (exige(x) && !detient[x]) throw erreur(409, 'Refusé : la politique du service exige ce facteur.');
    const peutSeConnecter = f.cle || (f.motdepasse && f.totp);
    if (!peutSeConnecter) throw erreur(409, 'Refusé : il ne te resterait aucun moyen de connexion complet.');
    if (admin && ((f.motdepasse ? 1 : 0) + (f.totp ? 1 : 0) + (f.cle ? 1 : 0) < 2 || (!this.modeHttp && !f.cle))) {
      throw erreur(409, 'Refusé : un administrateur garde deux facteurs, dont une clé d’accès.');
    }
  }

  // Après tout changement de facteur : identifiant de session neuf, autres
  // sessions fermées, alerte au compte, trace au journal.
  apresChangement(session, type, { ip, ...details }) {
    const c = this.compte(session.compte);
    this.fermerAutres(c.id, session.id);
    this.alerter(c, type, { ...details, ip, appareil: session.appareil });
    this.trace({ acteur: c.id, action: type, objet: c.id, ip, details });
    return this.promouvoir(session, session.facteurs, { ip, appareil: session.appareil });
  }

  // Le renfort se fait avec le facteur le plus fort que le compte détient et
  // qui soit utilisable ici : clé d'accès, sinon TOTP, sinon mot de passe.
  methodesRenfort(c) {
    const f = this.facteursDe(c);
    if (f.cle && !this.modeHttp) return ['cle'];
    if (f.totp) return ['totp'];
    return ['motdepasse'];
  }

  optionsRenfortCle(session, ctx) {
    this.exigerContexteCle(ctx);
    const defi = this.poserDefi(session.id, 'renfort', session.compte);
    const autorises = this.db.prepare('SELECT cred FROM socle_cles WHERE compte = ?').all(session.compte).map(l => l.cred);
    return wa.optionsAuthentification({ rpId: ctx.rpId, defi, autorises });
  }

  async renforcer(session, { methode, code, motDePasse, reponse, ctx, ip }) {
    const c = session.compteLigne;
    const permises = this.methodesRenfort(c);
    if (!permises.includes(methode)) throw erreur(400, 'Utilise ton facteur le plus fort.', { methodes: permises });
    const cles = [`ip:${ip}`, `compte:${c.identifiant}`];
    this.limiteur.controler(cles);
    let ok = false;
    if (methode === 'motdepasse') ok = (await verifierMdp(String(motDePasse ?? ''), c.mdp)).ok;
    else if (methode === 'totp') {
      const pas = totp.verifier(this.coffre.ouvre('totp', c.totp, c.id), code, { dernierPas: c.totp_pas, t: this.maintenant() });
      if (pas !== null) { this.db.prepare('UPDATE socle_comptes SET totp_pas = ? WHERE id = ?').run(pas, c.id); ok = true; }
    } else if (methode === 'cle') {
      this.exigerContexteCle(ctx);
      const { defi } = this.prendreDefi(session.id, 'renfort');
      const cle = this.cleEnregistree(reponse?.id);
      if (cle && cle.compte === c.id) {
        try {
          const r = wa.verifierAuthentification({ reponse, defi, origines: [ctx.origine], rpId: ctx.rpId, cle: { ...cle, handle: c.handle } });
          this.db.prepare('UPDATE socle_cles SET compteur = ?, utilisee = ? WHERE id = ?').run(r.compteur, this.maintenant(), cle.id);
          ok = true;
        } catch { ok = false; }
      }
    }
    if (!ok) {
      this.limiteur.echec(cles);
      this.trace({ acteur: c.id, action: 'renfort', ip, resultat: 'refus', details: { methode } });
      throw erreur(401, 'Vérification refusée.');
    }
    this.limiteur.reussite([cles[1]]);
    this.trace({ acteur: c.id, action: 'renfort', ip, details: { methode } });
    // Identifiant de session neuf : le privilège a changé. La session neuve
    // naît renforcée (ouvrirSession pose l'instant).
    return this.promouvoir(session, session.facteurs, { ip, appareil: session.appareil });
  }

  // REQ-AUTH-013 : le rôle administrateur ne se donne qu'à un compte qui tient
  // déjà deux facteurs dont une clé — sinon il reste membre jusqu'à inscription.
  changerRole(admin, id, role, { ip }) {
    this.exigerRenfort(admin);
    if (!ROLES.includes(role)) throw erreur(400, 'Rôle inconnu.');
    const c = this.compte(id);
    if (!c) throw erreur(404, 'Compte inconnu.');
    if (c.id === admin.compte && role !== 'admin') this.exigerUnAutreAdmin(c.id);
    if (role === 'admin') {
      const f = this.facteursDe(c);
      const n = (f.motdepasse ? 1 : 0) + (f.totp ? 1 : 0) + (f.cle ? 1 : 0);
      if (n < 2 || (!this.modeHttp && !f.cle)) throw erreur(409, 'Ce compte doit d’abord tenir deux facteurs, dont une clé d’accès.');
    }
    this.db.prepare('UPDATE socle_comptes SET role = ?, maj = ? WHERE id = ?').run(role, this.maintenant(), c.id);
    this.fermerToutes(c.id);
    this.alerter(c, 'role.change', { role, ip });
    this.trace({ acteur: admin.compte, action: 'compte.role', objet: c.id, ip, details: { role } });
  }

  exigerUnAutreAdmin(sauf) {
    const n = this.db.prepare("SELECT COUNT(*) n FROM socle_comptes WHERE role = 'admin' AND actif = 1 AND id != ?").get(sauf).n;
    if (!n) throw erreur(409, 'Il faut au moins un autre administrateur actif.');
  }

  // Un administrateur crée le compte et reçoit un lien d'invitation à
  // transmettre : c'est l'invité qui choisit son mot de passe et ses facteurs.
  inviter(admin, { identifiant, affichage, role = 'membre' }, { ip }) {
    this.exigerRenfort(admin);
    if (role === 'admin') throw erreur(400, 'Invite en membre, puis promeus une fois les facteurs inscrits.');
    const c = this.creerCompte({ identifiant, affichage, role });
    const jeton = this.emettreJeton('invitation', c.id, INVITATION_MS);
    this.trace({ acteur: admin.compte, action: 'compte.invite', objet: c.id, ip, details: { role } });
    return { compte: this.publicDe(c), jeton, expire: this.maintenant() + INVITATION_MS };
  }

  // Premier compte par le Hub : un service encore vide reçoit son
  // administrateur par invitation, sans jeton d'installation à recopier. Une
  // fois un compte créé, la route ne crée plus d'administrateur.
  premierAdmin(hub, { identifiant, affichage }, { ip }) {
    if (this.estInstalle()) throw erreur(409, 'Ce service a déjà ses comptes : invite en membre, puis promeus une fois les facteurs inscrits.');
    const c = this.creerCompte({ identifiant, affichage, role: 'admin' });
    const jeton = this.emettreJeton('invitation', c.id, INVITATION_MS);
    this.trace({ acteur: hub.compte, action: 'compte.premier_admin', objet: c.id, ip });
    return { compte: this.publicDe(c), jeton, expire: this.maintenant() + INVITATION_MS };
  }

  // Adresse d'un compte posée par un administrateur (ou le Hub) : tenue pour
  // vérifiée, comme le rôle qu'il donne. L'ancienne adresse est prévenue.
  definirCourriel(admin, id, adresse, { ip }) {
    this.exigerRenfort(admin);
    const c = this.compte(id);
    if (!c) throw erreur(404, 'Compte inconnu.');
    const ancien = c.courriel_verifie ? c.courriel : null;
    if (!adresse) {
      this.db.prepare('UPDATE socle_comptes SET courriel = NULL, courriel_verifie = NULL, maj = ? WHERE id = ?').run(this.maintenant(), c.id);
      if (ancien) this.alerter(this.compte(c.id), 'courriel.retire', { ip, ancien });
    } else {
      if (!adresseValide(adresse)) throw erreur(400, 'Adresse de courriel invalide.');
      if (adresse === ancien) return;
      const t = this.maintenant();
      this.db.prepare('UPDATE socle_comptes SET courriel = ?, courriel_verifie = ?, maj = ? WHERE id = ?').run(adresse, t, t, c.id);
      // Une première adresse n'alerte personne ; un changement prévient les deux.
      if (ancien) this.alerter(this.compte(c.id), 'courriel.change', { ip, ancien });
    }
    this.trace({ acteur: admin.compte, action: 'courriel.defini', objet: c.id, ip, details: { retire: !adresse } });
  }

  // Exiger, ou ne plus exiger, une clé d'accès de ce compte. Un administrateur
  // la garde toujours en HTTPS (REQ-AUTH-013) : rien ne la lui retire ici.
  exigerCle(admin, id, exigee, { ip }) {
    this.exigerRenfort(admin);
    const c = this.compte(id);
    if (!c) throw erreur(404, 'Compte inconnu.');
    if (!exigee && c.role === 'admin' && !this.modeHttp) throw erreur(409, 'Un administrateur garde toujours sa clé d’accès en HTTPS.');
    this.db.prepare('UPDATE socle_comptes SET cle_exigee = ?, maj = ? WHERE id = ?').run(exigee ? 1 : null, this.maintenant(), c.id);
    this.trace({ acteur: admin.compte, action: exigee ? 'compte.cle_exigee' : 'compte.cle_facultative', objet: c.id, ip });
  }

  // Réinitialisation (REQ-AUTH-006) : le jeton ne rend que le mot de passe. Les
  // autres facteurs restent en place et la connexion suivante les exige.
  reinitialiser(admin, id, { ip }) {
    this.exigerRenfort(admin);
    const c = this.compte(id);
    if (!c) throw erreur(404, 'Compte inconnu.');
    this.db.prepare("DELETE FROM socle_jetons WHERE compte = ? AND usage = 'reinit'").run(c.id);
    const jeton = this.emettreJeton('reinit', c.id, REINIT_MS);
    this.trace({ acteur: admin.compte, action: 'compte.reinit_emis', objet: c.id, ip });
    return { jeton, expire: this.maintenant() + REINIT_MS };
  }

  desactiver(admin, id, actif, { ip }) {
    this.exigerRenfort(admin);
    const c = this.compte(id);
    if (!c) throw erreur(404, 'Compte inconnu.');
    if (!actif && c.role === 'admin') this.exigerUnAutreAdmin(c.id);
    this.db.prepare('UPDATE socle_comptes SET actif = ?, maj = ? WHERE id = ?').run(actif ? 1 : 0, this.maintenant(), c.id);
    if (!actif) this.fermerToutes(c.id);
    this.trace({ acteur: admin.compte, action: actif ? 'compte.active' : 'compte.desactive', objet: c.id, ip });
  }

  supprimer(admin, id, { ip }) {
    this.exigerRenfort(admin);
    const c = this.compte(id);
    if (!c) throw erreur(404, 'Compte inconnu.');
    if (c.role === 'admin') this.exigerUnAutreAdmin(c.id);
    this.effacer(c);
    this.trace({ acteur: admin.compte, action: 'compte.supprime', objet: c.id, ip, details: { identifiant: c.identifiant } });
  }

  // Effacement demandé par le compte lui-même (SEC-PRIV-004) : renfort, et
  // l'identifiant retapé pour qu'un clic égaré n'efface rien. Le dernier
  // administrateur actif reste : l'installation n'aurait plus personne.
  supprimerSoi(session, { identifiant, ip }) {
    this.exigerRenfort(session);
    const c = this.compte(session.compte);
    if (normaliseIdentifiant(identifiant) !== c.identifiant) throw erreur(400, 'Retape ton identifiant tel quel pour confirmer.');
    if (c.role === 'admin') this.exigerUnAutreAdmin(c.id);
    this.effacer(c);
    this.trace({ acteur: c.id, action: 'compte.supprime', objet: c.id, ip, details: { identifiant: c.identifiant, soi: true } });
  }

  // Sessions, clés, codes, alertes et facteurs partent avec la ligne du
  // compte (clés étrangères) ; les jetons et les données du service, ici.
  effacer(c) {
    this.transaction(() => {
      this.db.prepare('DELETE FROM socle_comptes WHERE id = ?').run(c.id);
      this.db.prepare('DELETE FROM socle_jetons WHERE compte = ?').run(c.id);
      for (const f of this.apresSuppression) f(c.id);
    });
  }

  // Tout ce que le socle garde d'un compte, sans aucun secret : de quoi
  // répondre à une demande d'accès sans écrire de SQL à la main.
  donneesDe(compteId) {
    const c = this.compte(compteId);
    return {
      compte: { identifiant: c.identifiant, affichage: c.affichage, role: c.role, cree: c.cree, derniere: c.derniere, courriel: c.courriel_verifie ? c.courriel : null },
      facteurs: { motdepasse: !!c.mdp, totp: !!c.totp, secoursRestants: this.facteursDe(c).secours, cles: this.clesDe(c.id).map(k => ({ nom: k.nom, cree: k.cree, utilisee: k.utilisee })) },
      sessions: this.db.prepare('SELECT cree, vue, ip, appareil FROM socle_sessions WHERE compte = ?').all(c.id),
      alertes: this.alertesDe(c.id).map(({ t, type, details }) => ({ t, type, details })),
      journal: this.journal.lire({ compte: c.id, limite: 500 }).map(({ t, action, ip, resultat }) => ({ t, action, ip, resultat })),
    };
  }

  emettreJeton(usage, compteId, dureeMs, donnees = null) {
    const jeton = aleatoire(32);
    this.db.prepare('DELETE FROM socle_jetons WHERE expire < ?').run(this.maintenant());
    this.db.prepare('INSERT INTO socle_jetons(empreinte, usage, compte, expire, donnees) VALUES(?,?,?,?,?)').run(sha256hex(jeton), usage, compteId, this.maintenant() + dureeMs, donnees);
    return jeton;
  }

  // Un jeton ne sert qu'une fois : il disparaît dès qu'on le présente, valide ou non.
  prendreJeton(usage, jeton) {
    if (typeof jeton !== 'string' || jeton.length > 100) return null;
    const e = sha256hex(jeton);
    const l = this.db.prepare('SELECT compte, expire, donnees FROM socle_jetons WHERE empreinte = ? AND usage = ?').get(e, usage);
    this.db.prepare('DELETE FROM socle_jetons WHERE empreinte = ?').run(e);
    if (!l || l.expire < this.maintenant()) return null;
    const compte = this.compte(l.compte);
    return compte ? { compte, donnees: l.donnees } : null;
  }

  consommerJeton(usage, jeton) { return this.prendreJeton(usage, jeton)?.compte || null; }

  jetonValide(usage, jeton) {
    if (typeof jeton !== 'string' || jeton.length > 100) return null;
    const l = this.db.prepare('SELECT compte, expire FROM socle_jetons WHERE empreinte = ? AND usage = ?').get(sha256hex(jeton), usage);
    return l && l.expire >= this.maintenant() ? this.compte(l.compte) : null;
  }

  // Invitation ou réinitialisation : même geste, un mot de passe neuf posé par
  // la personne elle-même. L'invitation ouvre une session d'inscription ; la
  // réinitialisation n'ouvre rien, la connexion normale reprend ensuite.
  async utiliserJeton({ usage, jeton, motDePasse, ip, appareil }) {
    const cles = [`ip:${ip}`, `jeton:${usage}`];
    this.limiteur.controler(cles);
    const avant = this.jetonValide(usage, jeton);
    if (!avant) { this.limiteur.echec(cles); throw erreur(400, 'Lien invalide ou expiré.'); }
    const r = refusMdp(motDePasse, { identifiant: avant.identifiant, service: this.service.id });
    if (r) throw erreur(400, r);
    const empreinte = await hacher(motDePasse);
    const c = this.consommerJeton(usage, jeton);
    if (!c) throw erreur(400, 'Lien invalide ou expiré.');
    this.db.prepare('UPDATE socle_comptes SET mdp = ?, maj = ? WHERE id = ?').run(empreinte, this.maintenant(), c.id);
    this.fermerToutes(c.id);
    this.limiteur.liberer(`compte:${c.identifiant}`);
    this.trace({ acteur: c.id, action: usage === 'invitation' ? 'compte.invitation_acceptee' : 'compte.reinit', objet: c.id, ip });
    if (usage === 'reinit') { this.alerter(c, 'motdepasse.reinitialise', { ip }); return { etape: 'connexion' }; }
    return { ...this.ouvrirSession(this.compte(c.id), { facteurs: ['motdepasse'], ip, appareil }), etape: 'inscription' };
  }

  // « Ce n'était pas moi » : toutes les sessions tombent, y compris celle-ci.
  pasMoi(session, { ip }) {
    this.fermerToutes(session.compte);
    this.trace({ acteur: session.compte, action: 'compte.pas_moi', objet: session.compte, ip });
  }

  // Le même geste depuis le lien d'une alerte, sans session : le lien suffit,
  // puisqu'il ne fait que fermer des portes.
  pasMoiParLien(jeton, { ip }) {
    const cles = [`ip:${ip}`];
    this.limiteur.controler(cles);
    const r = this.prendreJeton('pasmoi', jeton);
    if (!r) { this.limiteur.echec(cles); throw erreur(400, 'Lien invalide ou déjà utilisé.'); }
    this.fermerToutes(r.compte.id);
    this.trace({ acteur: r.compte.id, action: 'compte.pas_moi', objet: r.compte.id, ip, details: { par: 'courriel' } });
    return r.compte.id;
  }

  // L'adresse ne sert qu'aux alertes : ni identifiant, ni récupération, ni
  // droit. Tant qu'elle n'est pas vérifiée, elle n'existe que dans le jeton
  // envoyé ; le compte ne la connaît qu'une fois le lien ouvert.
  demanderCourriel(session, adresse, { ip }) {
    this.exigerRenfort(session);
    if (!adresseValide(adresse)) throw erreur(400, 'Adresse de courriel invalide.');
    const c = this.compte(session.compte);
    this.db.prepare("DELETE FROM socle_jetons WHERE usage = 'courriel' AND compte = ?").run(c.id);
    this.trace({ acteur: c.id, action: 'courriel.demande', objet: c.id, ip });
    return this.emettreJeton('courriel', c.id, COURRIEL_MS, adresse);
  }

  verifierCourriel(jeton, { ip }) {
    const cles = [`ip:${ip}`];
    this.limiteur.controler(cles);
    const r = this.prendreJeton('courriel', jeton);
    if (!r) { this.limiteur.echec(cles); throw erreur(400, 'Lien invalide ou expiré.'); }
    const t = this.maintenant();
    const ancien = r.compte.courriel_verifie && r.compte.courriel !== r.donnees ? r.compte.courriel : null;
    this.db.prepare('UPDATE socle_comptes SET courriel = ?, courriel_verifie = ?, maj = ? WHERE id = ?').run(r.donnees, t, t, r.compte.id);
    this.alerter(this.compte(r.compte.id), 'courriel.change', { ip, ancien });
    this.trace({ acteur: r.compte.id, action: 'courriel.verifie', objet: r.compte.id, ip });
  }

  retirerCourriel(session, { ip }) {
    this.exigerRenfort(session);
    const c = this.compte(session.compte);
    if (!c.courriel) throw erreur(400, 'Aucune adresse d’alerte.');
    this.db.prepare('UPDATE socle_comptes SET courriel = NULL, courriel_verifie = NULL, maj = ? WHERE id = ?').run(this.maintenant(), c.id);
    this.alerter(this.compte(c.id), 'courriel.retire', { ip, appareil: session.appareil, ancien: c.courriel_verifie ? c.courriel : null });
    this.trace({ acteur: c.id, action: 'courriel.retire', objet: c.id, ip });
  }

  purger() {
    const t = this.maintenant();
    this.db.prepare('DELETE FROM socle_sessions WHERE expire < ? OR (niveau != ? AND vue < ?)').run(t, 'partiel', t - this.inactiviteMs);
    this.db.prepare('DELETE FROM socle_defis WHERE expire < ?').run(t);
    this.db.prepare('DELETE FROM socle_jetons WHERE expire < ?').run(t);
  }
}
