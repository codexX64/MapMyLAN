/* ATTENTION — ce fichier existe en DEUX exemplaires qui doivent rester
 * identiques : `backend/mail-providers.js` (chargé par require) et
 * `frontend/public/mail-providers.js` (servi au navigateur). Les contextes de
 * construction Docker sont séparés — ./backend et ./frontend — un fichier
 * unique à la racine ne serait dans aucun des deux. La CI vérifie l'égalité.
 */
/* Catalogue des fournisseurs de courrier — fichier partagé.
 *
 * Le backend le charge par `require()` depuis la racine du projet ; le frontend
 * le charge par <script src="/mail-providers.js"> et le lit dans
 * `window.MailProviders`. Les deux côtés lisent donc rigoureusement la même
 * table, ce qui évite qu'un réglage diverge entre l'écran et le serveur.
 *
 * Il n'est pas écrit en TypeScript à dessein : `tsc` n'émet que du TypeScript
 * et ne recopierait pas un .js dans dist/.
 *
 * Quatre fonctions, et rien d'autre :
 *   list()                       → le catalogue, pour peupler un menu
 *   detect(email)                → l'identifiant du fournisseur, ou null
 *   resolve(id, email, {n})      → { imap, smtp, needs } ou null
 *   validate({email, role, imap, smtp}) → { ok, errors }
 *
 * `needs` énumère ce qui manque encore : chez OVH Pro, par exemple, le numéro
 * du serveur mutualisé ne se devine pas depuis l'adresse.
 *
 * Les réglages ci-dessous sont ceux que les fournisseurs publient. Un
 * fournisseur absent n'est pas un problème : « other » laisse saisir les
 * serveurs à la main, et c'est le test de connexion qui tranche — aucune
 * configuration non vérifiée n'entre en base.
 */
(function (racine) {
  "use strict";

  var CATALOGUE = [
    { id: "gmail",    nom: "Gmail",             domaines: ["gmail.com", "googlemail.com"],
      imap: { host: "imap.gmail.com",        port: 993, security: "ssl" },
      smtp: { host: "smtp.gmail.com",        port: 465, security: "ssl" },
      note: "Mot de passe d'application requis : la validation en deux étapes doit être active." },

    { id: "icloud",   nom: "iCloud",            domaines: ["icloud.com", "me.com", "mac.com"],
      imap: { host: "imap.mail.me.com",      port: 993, security: "ssl" },
      smtp: { host: "smtp.mail.me.com",      port: 587, security: "starttls" },
      note: "Mot de passe pour application requis." },

    { id: "outlook",  nom: "Outlook / Hotmail", domaines: ["outlook.com", "hotmail.com", "live.com", "msn.com"],
      imap: { host: "outlook.office365.com", port: 993, security: "ssl" },
      smtp: { host: "smtp-mail.outlook.com", port: 587, security: "starttls" },
      note: "Les comptes professionnels peuvent exiger OAuth : vérifiez auprès de votre administrateur." },

    { id: "yahoo",    nom: "Yahoo Mail",        domaines: ["yahoo.com", "yahoo.fr", "ymail.com"],
      imap: { host: "imap.mail.yahoo.com",   port: 993, security: "ssl" },
      smtp: { host: "smtp.mail.yahoo.com",   port: 465, security: "ssl" },
      note: "Mot de passe d'application requis." },

    { id: "fastmail", nom: "Fastmail",          domaines: ["fastmail.com", "fastmail.fm"],
      imap: { host: "imap.fastmail.com",     port: 993, security: "ssl" },
      smtp: { host: "smtp.fastmail.com",     port: 465, security: "ssl" },
      note: "Mot de passe d'application requis." },

    { id: "ovh",      nom: "OVH — mutualisé",   domaines: [],
      // Le numéro du serveur ne se devine pas depuis l'adresse : on le demande.
      imap: { host: "ssl{n}.ovh.net",        port: 993, security: "ssl" },
      smtp: { host: "ssl{n}.ovh.net",        port: 465, security: "ssl" },
      besoins: ["n"],
      note: "Le numéro du serveur figure dans l'espace client OVH (ssl0, ssl1, …)." },

    { id: "other",    nom: "Autre — saisie manuelle", domaines: [],
      imap: null, smtp: null,
      note: "Saisissez les serveurs ; le test de connexion valide avant enregistrement." },
  ];

  function fiche(id) {
    for (var i = 0; i < CATALOGUE.length; i++) if (CATALOGUE[i].id === id) return CATALOGUE[i];
    return null;
  }

  function list() {
    return CATALOGUE.map(function (f) {
      return { id: f.id, nom: f.nom, besoins: f.besoins || [], note: f.note || "" };
    });
  }

  function domaineDe(email) {
    var s = String(email || "").trim().toLowerCase();
    var i = s.lastIndexOf("@");
    return i === -1 ? "" : s.slice(i + 1);
  }

  function detect(email) {
    var d = domaineDe(email);
    if (!d) return null;
    for (var i = 0; i < CATALOGUE.length; i++) {
      if ((CATALOGUE[i].domaines || []).indexOf(d) !== -1) return CATALOGUE[i].id;
    }
    return null;
  }

  // Remplit les gabarits « ssl{n}.ovh.net ». Sans la valeur, le champ reste tel
  // quel et le nom du manque part dans `needs` : l'écran sait quoi demander.
  function garnir(hote, options, manques) {
    if (!hote) return hote;
    return String(hote).replace(/\{(\w+)\}/g, function (tout, cle) {
      var v = options && options[cle];
      if (v === undefined || v === null || String(v) === "") {
        if (manques.indexOf(cle) === -1) manques.push(cle);
        return tout;
      }
      return String(v);
    });
  }

  function resolve(id, email, options) {
    var f = fiche(id);
    if (!f) return null;
    var manques = [];
    var out = { provider: f.id, nom: f.nom, note: f.note || "", imap: null, smtp: null, needs: manques };
    if (f.imap) out.imap = { host: garnir(f.imap.host, options, manques), port: f.imap.port, security: f.imap.security };
    if (f.smtp) out.smtp = { host: garnir(f.smtp.host, options, manques), port: f.smtp.port, security: f.smtp.security };
    // « other » n'a pas de gabarit : la saisie est libre, rien ne manque.
    return out;
  }

  var SECURITES = ["ssl", "starttls", "none"];

  function verifierServeur(nom, s, errors) {
    if (!s || typeof s !== "object") { errors.push("Réglages " + nom + " manquants."); return; }
    if (!s.host || !String(s.host).trim()) errors.push("Serveur " + nom + " manquant.");
    else if (/\{\w+\}/.test(String(s.host))) errors.push("Serveur " + nom + " incomplet : " + s.host);
    var p = Number(s.port);
    if (!Number.isInteger(p) || p < 1 || p > 65535) errors.push("Port " + nom + " invalide.");
    if (SECURITES.indexOf(String(s.security)) === -1) errors.push("Chiffrement " + nom + " inconnu.");
  }

  function validate(cfg) {
    var errors = [];
    var c = cfg || {};
    var email = String(c.email || "").trim();
    // Volontairement permissif sur la forme de l'adresse : c'est le serveur qui
    // tranche à l'authentification, pas une expression régulière.
    if (!email || email.indexOf("@") < 1 || email.lastIndexOf(".") < email.indexOf("@"))
      errors.push("Adresse invalide.");

    var role = String(c.role || "both");
    if (["both", "receive", "send"].indexOf(role) === -1) errors.push("Rôle inconnu.");

    if (role !== "send") verifierServeur("IMAP", c.imap, errors);
    if (role !== "receive") verifierServeur("SMTP", c.smtp, errors);

    return { ok: errors.length === 0, errors: errors };
  }

  var API = { list: list, detect: detect, resolve: resolve, validate: validate, SECURITES: SECURITES };

  if (typeof module === "object" && module.exports) module.exports = API;
  else racine.MailProviders = API;
})(typeof globalThis !== "undefined" ? globalThis : this);
