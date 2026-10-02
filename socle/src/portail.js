// Le portail : contexte de chaque requête (adresse, HTTPS, origine, session),
// contrôle CSRF, et les routes /api/compte/* communes à tous les services.
//
// Un service l'utilise ainsi :
//   const ctx = portail.contexte(req, res);
//   if (await portail.traiter(req, res, url, ctx)) return;
//   portail.exiger(ctx, { role: 'admin' });   // avant chaque route protégée
import { Debit, adresseClient, estSecurise, hoteLocal, lireCookies, lireCorps, origineDe, poseCookie, repondreJson } from './http.js';
import { valider } from './schema.js';
import { ErreurHttp, aleatoire, egal, sha256hex } from './outils.js';
import { ROLES, NIVEAUX } from './comptes.js';
import { messageVerification } from './notifications.js';

const METHODES_SURES = new Set(['GET', 'HEAD', 'OPTIONS']);
const RANG = { lecture: 0, membre: 1, admin: 2 };
const CERE_S = 300;

const S = {
  identifiant: { type: 'chaine', requis: true, min: 3, max: 64 },
  motDePasse: { type: 'chaine', requis: true, max: 1024 },
  code6: { type: 'chaine', requis: true, max: 12 },
  secours: { type: 'chaine', requis: true, max: 40 },
  reponse: { type: 'objet', requis: true },
  preuve: { type: 'objet', champs: { id: { type: 'chaine', requis: true, max: 40 }, nonce: { type: 'chaine', requis: true, max: 32 } } },
};

export class Portail {
  constructor({ comptes, service, proxys, origines = [], jetonInstallation = null, journal = console, courriel = null, urlPublique = null, contactSecurite = null, jetonAdminHub = null }) {
    this.comptes = comptes;
    this.courriel = courriel; // { postier }, ou null sans relais SMTP
    this.urlPublique = urlPublique;
    this.contactSecurite = contactSecurite;
    // Ce que le service ajoute à l'export des données d'un compte (ses tables).
    this.exporteur = null;
    // Un courriel de vérification coûte un envoi : cinq par heure, par compte et par adresse.
    this.envois = new Debit({ max: 5, fenetreMs: 3600e3 });
    this.service = service; // { id, nom }
    this.proxys = proxys;   // BlockList des relais de confiance, ou null
    this.originesEnPlus = origines;
    this.jetonEnv = jetonInstallation;
    this.log = journal;
    // Administration des comptes déléguée au Hub (SOCLE_JETON_ADMIN_HUB) : un
    // jeton à lui seul, distinct de celui du service, et un débit qui borne
    // les essais.
    this.jetonAdminHub = jetonAdminHub;
    this.essaisHub = new Debit({ max: 60 });
  }

  nomCookie(ctx, quoi) { return `${ctx.securise ? '__Host-' : ''}${this.service.id}-${quoi}`; }

  // Lien remis à quelqu'un (invitation, réinitialisation) : l'adresse publique
  // configurée, sinon l'origine que le navigateur de l'administrateur vient
  // d'attester (contrôlée par controlerOrigine sur cette même requête).
  lienPublic(ctx) { return this.urlPublique || ctx.origine; }

  contexte(req, res) {
    const ip = adresseClient(req, this.proxys);
    const securise = estSecurise(req, this.proxys);
    const origine = origineDe(req, this.proxys);
    let rpId = null;
    try { rpId = origine ? new URL(origine).hostname : null; } catch { rpId = null; }
    // Contexte sûr au sens du navigateur : HTTPS, ou localhost.
    const sur = securise || hoteLocal(req.headers.host);
    const cookies = lireCookies(req.headers.cookie);
    const ctx = { req, res, ip, securise, sur, origine, rpId, cookies, appareil: appareilDe(req.headers['user-agent']) };
    ctx.jeton = cookies[this.nomCookie(ctx, 'sid')] || null;
    ctx.session = this.comptes.session(ctx.jeton);
    return ctx;
  }

  ctxCle(ctx) { return { securise: ctx.sur, origine: ctx.origine, rpId: ctx.rpId }; }

  poserSession(ctx, s) {
    const maxAge = Math.max(0, (s.expire - Date.now()) / 1000);
    poseCookie(ctx.res, this.nomCookie(ctx, 'sid'), s.jeton, { maxAge, secure: ctx.securise });
  }
  effacerSession(ctx) { poseCookie(ctx.res, this.nomCookie(ctx, 'sid'), '', { maxAge: 0, secure: ctx.securise }); }

  // Origine de la requête : même origine que le service, ou une origine
  // déclarée. Un formulaire posté depuis un autre site n'atteint rien.
  controlerOrigine(ctx) {
    if (METHODES_SURES.has(ctx.req.method)) return;
    const o = ctx.req.headers.origin;
    const permises = [ctx.origine, ...this.originesEnPlus];
    if (o) { if (!permises.includes(o)) this.refuser(ctx, 'origine', 'Origine refusée.'); return; }
    const ref = ctx.req.headers.referer;
    if (ref) { try { if (permises.includes(new URL(ref).origin)) return; } catch { /* rejeté plus bas */ } }
    this.refuser(ctx, 'origine', 'Origine absente : requête refusée.');
  }

  controlerCsrf(ctx) {
    if (METHODES_SURES.has(ctx.req.method)) return;
    this.controlerOrigine(ctx);
    const envoye = String(ctx.req.headers['x-csrf'] || '');
    if (!ctx.session || envoye.length !== ctx.session.csrf.length || sha256hex(envoye) !== sha256hex(ctx.session.csrf)) {
      this.refuser(ctx, 'csrf', 'Jeton anti-CSRF invalide : recharge la page.');
    }
  }

  // Une requête d'un autre site ou sans jeton anti-CSRF est une tentative
  // possible : elle compte parmi les refus que la vigie surveille.
  refuser(ctx, motif, message) {
    this.comptes.journal.rare(`${motif}:${ctx.ip}`, { acteur: ctx.session?.compte ?? null, action: 'acces.refuse', objet: new URL(ctx.req.url, 'http://x').pathname, ip: ctx.ip, resultat: 'refus', details: { cause: motif } });
    throw new ErreurHttp(403, message);
  }

  // À appeler en tête de chaque route protégée du service.
  exiger(ctx, { role = 'lecture', renfort = false } = {}) {
    const s = ctx.session;
    if (!s || s.niveau === 'partiel') throw new ErreurHttp(401, 'Connexion requise.');
    if (s.niveau !== 'complet') throw new ErreurHttp(403, 'Termine d’abord l’inscription de tes facteurs.', { inscription: s.compteLigne ? this.comptes.manquants(s.compteLigne) : [] });
    this.controlerCsrf(ctx);
    if ((RANG[s.compteLigne.role] ?? -1) < RANG[role]) {
      this.comptes.journal.rare(`refus:${s.compte}:${role}`, { acteur: s.compte, action: 'acces.refuse', objet: new URL(ctx.req.url, 'http://x').pathname, ip: ctx.ip, resultat: 'refus', details: { role } });
      throw new ErreurHttp(403, 'Droits insuffisants.');
    }
    if (renfort) this.comptes.exigerRenfort(s);
    return s;
  }

  etat(ctx) {
    const c = this.comptes;
    const s = ctx.session;
    const politique = c.politique();
    return {
      service: this.service.nom, installe: c.estInstalle(), securise: ctx.securise, cles: ctx.sur && !c.modeHttp,
      modeHttp: c.modeHttp, politique,
      session: s ? {
        niveau: s.niveau, csrf: s.csrf, facteursUtilises: s.facteurs,
        compte: s.niveau === 'partiel' ? { identifiant: s.compteLigne.identifiant } : c.publicDe(s.compteLigne),
        ...(s.niveau === 'partiel' ? { methodes: c.methodesSecondes(s.compteLigne) } : {}),
        renfortJusqua: c.estRenforcee(s) ? s.renfort + 5 * 60e3 : 0,
      } : null,
    };
  }

  // RFC 9116 : où signaler une faille. L'échéance glisse avec le service en
  // marche ; le contact, lui, doit être lu par quelqu'un.
  securityTxt() {
    const expire = new Date(Date.now() + 180 * 86400e3).toISOString().replace(/\.\d{3}Z$/, 'Z');
    return `Contact: ${this.contactSecurite}\nExpires: ${expire}\nPreferred-Languages: fr, en\n`;
  }

  async traiter(req, res, url, ctx) {
    const p = url.pathname;
    if (p === '/.well-known/security.txt' && this.contactSecurite && ['GET', 'HEAD'].includes(req.method)) {
      const corps = this.securityTxt();
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-cache', 'Content-Length': Buffer.byteLength(corps) });
      res.end(req.method === 'HEAD' ? undefined : corps);
      return true;
    }
    if (!p.startsWith('/api/compte/') && p !== '/api/compte') return false;
    const r = await this.router(req, p, ctx);
    if (r === undefined) throw new ErreurHttp(404, 'Route inconnue.');
    repondreJson(res, 200, r);
    return true;
  }

  async corps(ctx, schema) { return valider(await lireCorps(ctx.req, { limite: 32 * 1024 }), schema); }

  async router(req, p, ctx) {
    if (p.startsWith('/api/compte/hub/')) return this.delegue(req, p, ctx);
    const c = this.comptes, m = req.method;
    const ip = ctx.ip, appareil = ctx.appareil;
    const ouvre = s => { this.poserSession(ctx, s); return { ok: true, etape: s.etape, niveau: s.niveau, csrf: s.csrf, ...(s.methodes ? { methodes: s.methodes } : {}), ...(s.codes ? { codes: s.codes } : {}), ...(s.restants !== undefined ? { restants: s.restants } : {}) }; };
    const sessionPleine = () => {
      const s = ctx.session;
      if (!s || s.niveau === 'partiel') throw new ErreurHttp(401, 'Connexion requise.');
      this.controlerCsrf(ctx);
      return s;
    };

    // --- publiques ---
    if (m === 'GET' && p === '/api/compte/etat') return this.etat(ctx);

    if (m === 'POST' && p === '/api/compte/installation') {
      this.controlerOrigine(ctx);
      const b = await this.corps(ctx, { jeton: { type: 'chaine', requis: true, max: 200 }, identifiant: S.identifiant, motDePasse: S.motDePasse, affichage: { type: 'chaine', max: 80 } });
      return ouvre(await c.installer({ ...b, jetonAttendu: c.jetonInstallation(this.jetonEnv), ip, appareil }));
    }

    if (m === 'POST' && p === '/api/compte/connexion') {
      this.controlerOrigine(ctx);
      const b = await this.corps(ctx, { identifiant: S.identifiant, motDePasse: S.motDePasse, preuve: S.preuve });
      const s = await c.connexionMotDePasse({ ...b, ip, appareil });
      if (ctx.session) c.fermerSession(ctx.session.id);
      return ouvre(s);
    }

    if (m === 'POST' && p === '/api/compte/connexion/totp') {
      this.controlerOrigine(ctx);
      const b = await this.corps(ctx, { code: S.code6 });
      return ouvre(c.connexionTotp(ctx.session, b.code, { ip, appareil }));
    }

    if (m === 'POST' && p === '/api/compte/connexion/secours') {
      this.controlerOrigine(ctx);
      const b = await this.corps(ctx, { code: S.secours });
      return ouvre(await c.connexionSecours(ctx.session, b.code, { ip, appareil }));
    }

    // Cérémonie de connexion par clé : liée à la session partielle s'il y en a
    // une, sinon à un cookie de cérémonie à usage unique.
    if (m === 'POST' && p === '/api/compte/connexion/cle/options') {
      this.controlerOrigine(ctx);
      await this.corps(ctx, {});
      let lien;
      if (ctx.session?.niveau === 'partiel') lien = ctx.session.id;
      else {
        const cere = aleatoire(24);
        poseCookie(ctx.res, this.nomCookie(ctx, 'cer'), cere, { maxAge: CERE_S, secure: ctx.securise });
        lien = 'cer:' + sha256hex(cere);
      }
      return c.optionsConnexionCle({ lien, session: ctx.session, ctx: this.ctxCle(ctx) });
    }

    if (m === 'POST' && p === '/api/compte/connexion/cle') {
      this.controlerOrigine(ctx);
      const b = await this.corps(ctx, { reponse: S.reponse });
      let lien;
      if (ctx.session?.niveau === 'partiel') lien = ctx.session.id;
      else {
        const cere = ctx.cookies[this.nomCookie(ctx, 'cer')];
        if (!cere) throw new ErreurHttp(400, 'Délai dépassé : recommence.');
        poseCookie(ctx.res, this.nomCookie(ctx, 'cer'), '', { maxAge: 0, secure: ctx.securise });
        lien = 'cer:' + sha256hex(cere);
      }
      const s = c.connexionCle({ lien, session: ctx.session, reponse: b.reponse, ctx: this.ctxCle(ctx), ip, appareil });
      if (ctx.session && ctx.session.niveau !== 'partiel') c.fermerSession(ctx.session.id);
      return ouvre(s);
    }

    if (m === 'POST' && p === '/api/compte/jeton/verifier') {
      this.controlerOrigine(ctx);
      const b = await this.corps(ctx, { usage: { type: 'chaine', requis: true, parmi: ['invitation', 'reinit'] }, jeton: { type: 'chaine', requis: true, max: 100 } });
      const compte = c.jetonValide(b.usage, b.jeton);
      return compte ? { valide: true, identifiant: compte.identifiant } : { valide: false };
    }

    if (m === 'POST' && p === '/api/compte/jeton') {
      this.controlerOrigine(ctx);
      const b = await this.corps(ctx, { usage: { type: 'chaine', requis: true, parmi: ['invitation', 'reinit'] }, jeton: { type: 'chaine', requis: true, max: 100 }, motDePasse: S.motDePasse });
      const r = await c.utiliserJeton({ ...b, ip, appareil });
      return r.jeton ? ouvre(r) : r;
    }

    if (m === 'POST' && p === '/api/compte/courriel/verifier') {
      this.controlerOrigine(ctx);
      const b = await this.corps(ctx, { jeton: { type: 'chaine', requis: true, max: 100 } });
      c.verifierCourriel(b.jeton, { ip });
      return { ok: true };
    }

    if (m === 'POST' && p === '/api/compte/pas-moi/lien') {
      this.controlerOrigine(ctx);
      const b = await this.corps(ctx, { jeton: { type: 'chaine', requis: true, max: 100 } });
      const compte = c.pasMoiParLien(b.jeton, { ip });
      if (ctx.session?.compte === compte) this.effacerSession(ctx);
      return { ok: true };
    }

    if (m === 'POST' && p === '/api/compte/deconnexion') {
      this.controlerOrigine(ctx);
      if (ctx.session) { c.fermerSession(ctx.session.id); c.trace({ acteur: ctx.session.compte, action: 'deconnexion', ip }); }
      this.effacerSession(ctx);
      return { ok: true };
    }

    // --- session (inscription ou complète) ---
    if (m === 'GET' && p === '/api/compte/securite') {
      const s = ctx.session;
      if (!s || s.niveau === 'partiel') throw new ErreurHttp(401, 'Connexion requise.');
      return {
        compte: c.publicDe(s.compteLigne), cles: c.clesDe(s.compte), sessions: c.sessionsDe(s.compte, s.id),
        alertes: c.alertesDe(s.compte), politique: c.politique(), methodesRenfort: c.methodesRenfort(s.compteLigne), envoiCourriel: !!this.courriel,
        renfortJusqua: c.estRenforcee(s) ? s.renfort + 5 * 60e3 : 0, clesPossibles: ctx.sur && !c.modeHttp, modeHttp: c.modeHttp,
      };
    }

    if (m === 'POST' && p === '/api/compte/renfort/options') { const s = sessionPleine(); await this.corps(ctx, {}); return c.optionsRenfortCle(s, this.ctxCle(ctx)); }
    if (m === 'POST' && p === '/api/compte/renfort') {
      const s = sessionPleine();
      const b = await this.corps(ctx, { methode: { type: 'chaine', requis: true, parmi: ['motdepasse', 'totp', 'cle'] }, code: { type: 'chaine', max: 12 }, motDePasse: { type: 'chaine', max: 1024 }, reponse: { type: 'objet' } });
      return ouvre(await c.renforcer(s, { ...b, ctx: this.ctxCle(ctx), ip }));
    }

    if (m === 'POST' && p === '/api/compte/totp') { const s = sessionPleine(); await this.corps(ctx, {}); return c.debutTotp(s); }
    if (m === 'POST' && p === '/api/compte/totp/confirmer') { const s = sessionPleine(); const b = await this.corps(ctx, { code: S.code6 }); return ouvre(c.confirmerTotp(s, b.code, { ip })); }
    if (m === 'DELETE' && p === '/api/compte/totp') { const s = sessionPleine(); return ouvre(c.retirerTotp(s, { ip })); }

    if (m === 'POST' && p === '/api/compte/cles/options') { const s = sessionPleine(); await this.corps(ctx, {}); return c.optionsNouvelleCle(s, this.ctxCle(ctx)); }
    if (m === 'POST' && p === '/api/compte/cles') {
      const s = sessionPleine();
      const b = await this.corps(ctx, { reponse: S.reponse, nom: { type: 'chaine', max: 60 } });
      return ouvre(c.ajouterCle(s, { ...b, ctx: this.ctxCle(ctx), ip }));
    }
    let mm = /^\/api\/compte\/cles\/(k_[\w-]{16})$/.exec(p);
    if (mm && m === 'PATCH') { const s = sessionPleine(); const b = await this.corps(ctx, { nom: { type: 'chaine', requis: true, max: 60 } }); c.renommerCle(s, mm[1], b.nom); return { ok: true }; }
    if (mm && m === 'DELETE') { const s = sessionPleine(); return ouvre(c.retirerCle(s, mm[1], { ip })); }

    if (m === 'POST' && p === '/api/compte/secours') { const s = sessionPleine(); await this.corps(ctx, {}); return ouvre(await c.regenererSecours(s, { ip })); }
    if (m === 'POST' && p === '/api/compte/motdepasse') { const s = sessionPleine(); const b = await this.corps(ctx, { nouveau: S.motDePasse }); return ouvre(await c.changerMotDePasse(s, b.nouveau, { ip })); }
    if (m === 'DELETE' && p === '/api/compte/motdepasse') { const s = sessionPleine(); return ouvre(c.retirerMotDePasse(s, { ip })); }

    mm = /^\/api\/compte\/sessions\/([0-9a-f]{16})$/.exec(p);
    if (mm && m === 'DELETE') { const s = sessionPleine(); c.fermerParPrefixe(s.compte, mm[1]); c.trace({ acteur: s.compte, action: 'session.fermee', ip }); return { ok: true }; }
    if (m === 'DELETE' && p === '/api/compte/sessions') { const s = sessionPleine(); c.fermerAutres(s.compte, s.id); c.trace({ acteur: s.compte, action: 'sessions.autres_fermees', ip }); return { ok: true }; }
    if (m === 'POST' && p === '/api/compte/pas-moi') { const s = sessionPleine(); await this.corps(ctx, {}); c.pasMoi(s, { ip }); this.effacerSession(ctx); return { ok: true }; }
    if (m === 'POST' && p === '/api/compte/courriel') {
      const s = sessionPleine();
      const b = await this.corps(ctx, { adresse: { type: 'chaine', requis: true, max: 254 } });
      if (!this.courriel) throw new ErreurHttp(409, 'Ce service n’envoie pas de courriel : aucun relais SMTP n’est configuré.');
      const adresse = b.adresse.trim();
      if (!this.envois.prendre(`compte:${s.compte}`) || !this.envois.prendre(`ip:${ip}`)) throw new ErreurHttp(429, 'Trop d’envois : réessaie dans une heure.');
      const jeton = c.demanderCourriel(s, adresse, { ip });
      const message = messageVerification({ service: this.service, compte: s.compteLigne, lien: `${this.urlPublique}/#courriel=${jeton}` });
      try { await this.courriel.postier.envoyer({ a: adresse, ...message }); } catch (e) {
        this.log.warn?.(`[courriel] vérification non envoyée : ${e.message}`);
        throw new ErreurHttp(502, 'Le relais SMTP a refusé l’envoi : réessaie plus tard ou préviens l’administrateur.');
      }
      return { ok: true, attente: adresse };
    }
    if (m === 'DELETE' && p === '/api/compte/courriel') { const s = sessionPleine(); c.retirerCourriel(s, { ip }); return { ok: true }; }
    // Export de ses propres données (SEC-PRIV-004) : une action sensible, donc sous renfort.
    if (m === 'GET' && p === '/api/compte/export') {
      const s = sessionPleine();
      c.exigerRenfort(s);
      c.trace({ acteur: s.compte, action: 'compte.export', objet: s.compte, ip });
      return { service: this.service.nom, exporte: new Date().toISOString(), ...c.donneesDe(s.compte), ...(this.exporteur ? { [this.service.id]: await this.exporteur(s.compte) } : {}) };
    }
    if (m === 'POST' && p === '/api/compte/supprimer') {
      const s = sessionPleine();
      const b = await this.corps(ctx, { identifiant: { type: 'chaine', requis: true, max: 80 } });
      c.supprimerSoi(s, { identifiant: b.identifiant, ip });
      this.effacerSession(ctx);
      return { ok: true };
    }
    if (m === 'POST' && p === '/api/compte/alertes/vues') { const s = sessionPleine(); await this.corps(ctx, {}); c.marquerAlertesVues(s.compte); return { ok: true }; }

    // --- administration ---
    if (p.startsWith('/api/compte/admin/')) return this.admin(req, p, ctx);
    return undefined;
  }

  /*
   * Administration des comptes par le Hub. Le Hub présente son jeton
   * d'administration (jamais celui du service) ; il a lui-même exigé le
   * renfort de son opérateur avant d'entrer ici, et le dit dans X-Hub-Operateur,
   * repris au journal. Rien ici ne pose ni ne lit de mot de passe : le Hub
   * reçoit des liens d'invitation et de réinitialisation, et la personne
   * choisit elle-même son mot de passe et ses facteurs.
   */
  async delegue(req, p, ctx) {
    const c = this.comptes, m = req.method, ip = ctx.ip;
    if (!this.jetonAdminHub) throw new ErreurHttp(404, 'Route inconnue.');
    const refuser = cause => {
      c.journal.rare(`hub:${ip}`, { action: 'connexion.jeton_hub', objet: p, ip, resultat: 'refus', details: { cause } });
      throw new ErreurHttp(401, 'Jeton refusé.');
    };
    if (!this.essaisHub.prendre(ip)) throw new ErreurHttp(429, 'Trop de requêtes.');
    const m1 = /^Bearer (\S{32,512})$/.exec(String(req.headers.authorization || ''));
    if (!m1) refuser('forme');
    if (!egal(m1[1], this.jetonAdminHub)) refuser('inconnu');
    const operateur = String(req.headers['x-hub-operateur'] || '').replace(/[^\p{L}\p{N}_.@ -]/gu, '').slice(0, 64) || null;
    const hub = { compte: 'hub', delegue: true, operateur };
    // L'adresse des liens est connue avant d'agir : sans elle, rien n'est créé.
    const base = () => this.urlPublique || this.lienDelegue(req);
    const tracer = (action, objet, details = {}) => c.trace({ acteur: 'hub', action, objet, ip, details: { ...details, ...(operateur ? { operateur } : {}) } });
    // a2f : un second facteur au moins (application ou clé), lu d'un coup d'œil dans le Hub.
    if (m === 'GET' && p === '/api/compte/hub/comptes') return c.lister().map(x => ({ ...x, a2f: !!(x.facteurs.totp || x.facteurs.cles) }));
    if (m === 'POST' && p === '/api/compte/hub/comptes') {
      const b = await this.corps(ctx, { identifiant: S.identifiant, affichage: { type: 'chaine', max: 80 }, role: { type: 'chaine', parmi: ['membre', 'lecture'], defaut: 'membre' } });
      const adresse = base();
      const r = c.inviter(hub, b, { ip });
      tracer('hub.compte_invite', r.compte.id, { role: b.role });
      return { compte: r.compte, lien: `${adresse}/#invitation=${r.jeton}`, expire: r.expire, message: `Lien d’invitation à transmettre à ${r.compte.identifiant} : il choisit lui-même son mot de passe et ses facteurs.` };
    }
    const mm = /^\/api\/compte\/hub\/comptes\/(c_[\w-]{16})(\/reinit)?$/.exec(p);
    if (mm && !mm[2] && m === 'PATCH') {
      const b = await this.corps(ctx, { role: { type: 'chaine', parmi: ROLES }, actif: { type: 'booleen' } });
      if (b.role) c.changerRole(hub, mm[1], b.role, { ip });
      if (b.actif !== undefined) c.desactiver(hub, mm[1], b.actif, { ip });
      tracer('hub.compte_modifie', mm[1], b);
      return { ok: true };
    }
    if (mm && !mm[2] && m === 'DELETE') { c.supprimer(hub, mm[1], { ip }); tracer('hub.compte_supprime', mm[1]); return { ok: true }; }
    if (mm && mm[2] && m === 'POST') {
      await this.corps(ctx, {});
      const adresse = base();
      const r = c.reinitialiser(hub, mm[1], { ip });
      tracer('hub.compte_reinit', mm[1]);
      return { lien: `${adresse}/#reinit=${r.jeton}`, expire: r.expire, message: 'Lien de réinitialisation à transmettre : il ne rend que le mot de passe, les autres facteurs restent exigés.' };
    }
    throw new ErreurHttp(404, 'Route inconnue.');
  }

  // Sans adresse publique configurée, le Hub dit à quelle adresse il ouvre le
  // service (X-Hub-Adresse) : c'est elle qui part dans les liens.
  lienDelegue(req) {
    const a = String(req.headers['x-hub-adresse'] || '');
    try {
      const u = new URL(a);
      if ((u.protocol === 'https:' || u.protocol === 'http:') && !u.username && !u.password) return u.origin;
    } catch { /* adresse absente ou invalide */ }
    throw new ErreurHttp(409, 'Adresse publique du service inconnue : pose SOCLE_URL_PUBLIQUE, ou ouvre le service une fois depuis le Hub.');
  }

  async admin(req, p, ctx) {
    const c = this.comptes, m = req.method, ip = ctx.ip;
    if (m === 'GET' && p === '/api/compte/admin/comptes') { this.exiger(ctx, { role: 'admin' }); return { comptes: c.lister() }; }
    if (m === 'POST' && p === '/api/compte/admin/comptes') {
      const s = this.exiger(ctx, { role: 'admin' });
      const b = await this.corps(ctx, { identifiant: S.identifiant, affichage: { type: 'chaine', max: 80 }, role: { type: 'chaine', parmi: ['membre', 'lecture'], defaut: 'membre' } });
      const r = c.inviter(s, b, { ip });
      return { ...r, lien: `${this.lienPublic(ctx)}/#invitation=${r.jeton}` };
    }
    let mm = /^\/api\/compte\/admin\/comptes\/(c_[\w-]{16})(\/reinit)?$/.exec(p);
    if (mm && !mm[2] && m === 'PATCH') {
      const s = this.exiger(ctx, { role: 'admin' });
      const b = await this.corps(ctx, { role: { type: 'chaine', parmi: ROLES }, actif: { type: 'booleen' } });
      if (b.role) c.changerRole(s, mm[1], b.role, { ip });
      if (b.actif !== undefined) c.desactiver(s, mm[1], b.actif, { ip });
      return { ok: true };
    }
    if (mm && !mm[2] && m === 'DELETE') { const s = this.exiger(ctx, { role: 'admin' }); c.supprimer(s, mm[1], { ip }); return { ok: true }; }
    if (mm && mm[2] && m === 'POST') {
      const s = this.exiger(ctx, { role: 'admin' });
      await this.corps(ctx, {});
      const r = c.reinitialiser(s, mm[1], { ip });
      return { ...r, lien: `${this.lienPublic(ctx)}/#reinit=${r.jeton}` };
    }
    if (m === 'GET' && p === '/api/compte/admin/politique') { this.exiger(ctx, { role: 'admin' }); return c.politique(); }
    if (m === 'PUT' && p === '/api/compte/admin/politique') {
      const s = this.exiger(ctx, { role: 'admin', renfort: true });
      const n = { type: 'chaine', requis: true, parmi: NIVEAUX };
      const b = await this.corps(ctx, { motdepasse: n, totp: n, cle: n });
      return c.definirPolitique(b, { acteur: s.compte, ip });
    }
    if (m === 'GET' && p === '/api/compte/admin/journal') {
      this.exiger(ctx, { role: 'admin' });
      const avant = Number(new URL(req.url, 'http://x').searchParams.get('avant')) || null;
      return { lignes: c.journal.lire({ avant, limite: 100 }), integrite: c.journal.verifier() };
    }
    // Incident : toutes les sessions de tous les comptes tombent, sauf celle-ci.
    if (m === 'POST' && p === '/api/compte/admin/sessions/fermer-tout') {
      const s = this.exiger(ctx, { role: 'admin', renfort: true });
      await this.corps(ctx, {});
      c.db.prepare('DELETE FROM socle_sessions WHERE id != ?').run(s.id);
      c.trace({ acteur: s.compte, action: 'sessions.toutes_fermees', ip });
      return { ok: true };
    }
    return undefined;
  }
}

// Ce qu'on garde du User-Agent : de quoi reconnaître un appareil dans la liste
// des sessions, pas une empreinte.
export function appareilDe(ua = '') {
  const s = String(ua);
  const nav = /Edg\//.test(s) ? 'Edge' : /Firefox\//.test(s) ? 'Firefox' : /Chrome\//.test(s) ? 'Chrome' : /Safari\//.test(s) ? 'Safari' : /curl\//.test(s) ? 'curl' : 'Navigateur';
  const os = /iPhone|iPad/.test(s) ? 'iOS' : /Android/.test(s) ? 'Android' : /Mac OS X/.test(s) ? 'macOS' : /Windows/.test(s) ? 'Windows' : /Linux/.test(s) ? 'Linux' : '';
  return os ? `${nav} · ${os}` : nav;
}
