// Routes des boîtes mail : catalogue des fournisseurs, vérification IMAP/SMTP
// et boîtes enregistrées. Le mot de passe est scellé par le coffre du socle,
// lié à sa boîte, et ne ressort jamais.
import { Debit, ErreurHttp } from '../../socle/src/index.js';
import { nouvelId } from '../db.js';
import * as F from '../formes.js';
import { detecter, lister, resoudre, SECURITES } from '../fournisseurs.js';
import { verifierBoite } from '../boites.js';
import { HOTE, ID } from './schemas.js';

const USAGE = 'boite';
const COURRIEL = { type: 'chaine', max: 254, motif: /^[^\s@]{1,64}@[^\s@]{1,253}$/ };
const SERVEUR = { type: 'objet', champs: { host: { type: 'chaine', requis: true, max: 253, motif: HOTE }, port: { type: 'entier', requis: true, min: 1, max: 65535 }, security: { type: 'chaine', requis: true, parmi: SECURITES } } };
const ROLE = { type: 'chaine', parmi: ['both', 'send', 'receive'] };
const BOITE = { email: { ...COURRIEL, requis: true }, role: ROLE, imap: SERVEUR, smtp: SERVEUR, password: { type: 'chaine', max: 512 } };
// L'autorité d'un serveur interne sert à l'essai ; la 1.4.1 ne la gardait pas.
const VERIFICATION = { ...BOITE, autorite: { type: 'chaine', max: 16384, motif: /^-----BEGIN CERTIFICATE-----[\s\S]+-----END CERTIFICATE-----\s*$/ } };

// Ce que la 1.4.1 vérifiait avant tout échange : les serveurs que le rôle exige.
function controler({ role = 'both', imap, smtp }) {
  if (role !== 'send' && !imap) throw new ErreurHttp(400, 'Réglages IMAP manquants pour une boîte qui reçoit.');
  if (role !== 'receive' && !smtp) throw new ErreurHttp(400, 'Réglages SMTP manquants pour une boîte qui envoie.');
}

export function routesMessagerie(route, s, acces) {
  const { db, coffre } = s;
  const essais = new Debit({ max: 10 });
  const parEmail = email => db.prepare('SELECT * FROM boites WHERE email = ?').get(email) || null;
  const motDePasseDe = b => {
    if (!b?.passwordEnc) return '';
    try { return coffre.ouvre(USAGE, b.passwordEnc, `${b.id}:password`); } catch {
      throw new ErreurHttp(409, 'Mot de passe de cette boîte illisible avec la clé actuelle : saisis-le à nouveau.');
    }
  };

  route.get('/api/mail/providers', () => lister(), { role: 'lecture' });

  route.post('/api/mail/resolve', ctx => {
    const { provider, email, n } = ctx.corps;
    const r = resoudre(provider, email || '', { n });
    if (!r) throw new ErreurHttp(400, 'Fournisseur inconnu.');
    return r;
  }, { role: 'lecture', corps: { provider: { type: 'chaine', requis: true, max: 40 }, email: COURRIEL, n: { type: 'entier', min: 0, max: 999 } } });

  route.post('/api/mail/detect', ctx => ({ provider: detecter(ctx.corps.email) }), { role: 'lecture', corps: { email: { ...COURRIEL, requis: true } } });

  route.post('/api/mail/verify', async ctx => {
    if (!essais.prendre(ctx.acteur.id)) throw new ErreurHttp(429, 'Trop d’essais : attends une minute.');
    const b = ctx.corps;
    controler(b);
    const email = b.email.trim().toLowerCase();
    const enPlace = parEmail(email);
    acces.tracer(ctx, 'boite.verification', enPlace?.id || null);
    const password = b.password || motDePasseDe(enPlace);
    if (!password) throw new ErreurHttp(400, 'Mot de passe manquant.');
    const r = await verifierBoite({ sortie: s.sortie, email, password, role: b.role || 'both', imap: b.imap, smtp: b.smtp, autorite: b.autorite || null });
    if (enPlace) db.prepare('UPDATE boites SET lastTestAt = ?, lastTestOk = ?, lastTestInfo = ? WHERE id = ?').run(Date.now(), r.ok ? 1 : 0, String(r.ok ? r.inbox : r.error).slice(0, 300), enPlace.id);
    if (!r.ok) ctx.statut = 502;
    return r;
  }, { role: 'admin', corps: VERIFICATION });

  route.get('/api/mail/mailboxes', () => db.prepare('SELECT * FROM boites ORDER BY createdAt').all().map(F.boite), { role: 'lecture' });

  route.post('/api/mail/mailboxes', ctx => {
    const b = ctx.corps;
    controler(b);
    const email = b.email.trim().toLowerCase();
    const enPlace = parEmail(email);
    const id = enPlace?.id || nouvelId();
    const passwordEnc = b.password ? coffre.scelle(USAGE, b.password, `${id}:password`) : enPlace?.passwordEnc ?? null;
    if (!passwordEnc) throw new ErreurHttp(400, 'Mot de passe manquant.');
    const valeurs = [b.provider || 'other', b.role || 'both', b.imap?.host || null, b.imap?.port || null, b.imap?.security || null,
      b.smtp?.host || null, b.smtp?.port || null, b.smtp?.security || null, passwordEnc, b.active === false ? 0 : 1];
    if (enPlace) {
      db.prepare('UPDATE boites SET provider=?, role=?, imapHost=?, imapPort=?, imapSecurity=?, smtpHost=?, smtpPort=?, smtpSecurity=?, passwordEnc=?, active=? WHERE id=?').run(...valeurs, id);
    } else {
      db.prepare('INSERT INTO boites(provider, role, imapHost, imapPort, imapSecurity, smtpHost, smtpPort, smtpSecurity, passwordEnc, active, id, email, createdAt) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(...valeurs, id, email, Date.now());
    }
    s.evts.journaliser('info', 'mail', `Boîte ${enPlace ? 'modifiée' : 'ajoutée'} : ${email}`);
    acces.tracer(ctx, enPlace ? 'boite.modifiee' : 'boite.ajoutee', id);
    return F.boite(db.prepare('SELECT * FROM boites WHERE id = ?').get(id));
  }, { role: 'admin', renfort: true, corps: { ...BOITE, provider: { type: 'chaine', max: 40, motif: /^[a-z0-9-]{1,40}$/ }, active: { type: 'booleen' } } });

  route.del('/api/mail/mailboxes/:id', ctx => {
    const b = ID.test(ctx.params.id) && db.prepare('SELECT * FROM boites WHERE id = ?').get(ctx.params.id);
    if (!b) throw new ErreurHttp(404, 'Boîte introuvable.');
    db.prepare('DELETE FROM boites WHERE id = ?').run(b.id);
    s.evts.journaliser('warn', 'mail', `Boîte supprimée : ${b.email}`);
    acces.tracer(ctx, 'boite.supprimee', b.id);
    return { ok: true };
  }, { role: 'admin', renfort: true });
}
