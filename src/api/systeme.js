// Routes du service : santé, tableau de bord, alertes, journal, réglages,
// règles, notifications, machine hôte, jetons d'intégration et flux temps réel.
import { Debit, ErreurHttp, valider } from '../../socle/src/index.js';
import * as F from '../formes.js';
import { VERSION } from '../config.js';
import { CLES } from '../reglages.js';
import { CANAUX, DISCUSSION, JETON_BOT } from '../notifications.js';
import { ROLES_JETON } from '../jetons.js';
import { HOTE, ID, nom, vide } from './schemas.js';

const COURRIEL = /^[^\s@]{1,64}@[^\s@]{1,253}$/;
const CONFIG_CANAL = {
  telegram: { token: { type: 'chaine', max: 60, motif: JETON_BOT }, chatId: { type: 'chaine', max: 21, motif: DISCUSSION } },
  email: {
    address: { type: 'chaine', max: 254, motif: COURRIEL }, password: { type: 'chaine', max: 512 },
    provider: { type: 'chaine', parmi: ['gmail', 'outlook', 'apple', 'autre'] }, host: { type: 'chaine', max: 253, motif: HOTE },
    port: { type: 'entier', min: 1, max: 65535 }, secure: { type: 'booleen' },
    from: { type: 'chaine', max: 254, motif: COURRIEL }, to: { type: 'chaine', max: 254, motif: COURRIEL },
    autorite: { type: 'chaine', max: 16384, motif: /^-----BEGIN CERTIFICATE-----[\s\S]+-----END CERTIFICATE-----\s*$/ },
  },
  billetterie: {
    url: { type: 'chaine', max: 500, motif: /^https?:\/\/[^\s]+$/ }, cle: { type: 'chaine', max: 512 },
    entete: { type: 'chaine', max: 40, motif: /^[A-Za-z0-9-]{1,40}$/ }, marqueur: { type: 'chaine', max: 40 },
    seuil: { type: 'chaine', parmi: ['p1', 'p2', 'p3', 'p4'] },
  },
};
const NIVEAUX = ['info', 'warn', 'error', 'success'];

export function routesSysteme(route, s, acces) {
  const { db, reglages, notifications, jetons } = s;
  const essais = new Debit({ max: 10 });
  const compter = (sql, ...a) => db.prepare(sql).get(...a).n;

  // Anonyme : de quoi savoir que le service répond, rien d'autre. Un jeton
  // présenté et refusé ne change rien ici : la route reste publique.
  route.get('/api/health', ctx => {
    try { db.prepare('SELECT 1').get(); } catch (e) {
      s.log.error?.('[sante]', e.message);
      ctx.statut = 503;
      return { ok: false };
    }
    let connu = ctx.session?.niveau === 'complet';
    if (!connu && ctx.req.headers.authorization !== undefined) {
      try { acces.principal(ctx, { role: 'lecture', jeton: true }); connu = true; } catch { connu = false; /* refus déjà journalisé par l'accès */ }
    }
    return connu ? { ok: true, status: 'ok', version: VERSION, time: new Date().toISOString() } : { ok: true };
  }, { public: true });

  route.get('/api/stats', () => ({
    total: compter('SELECT COUNT(*) n FROM appareils'),
    online: compter("SELECT COUNT(*) n FROM appareils WHERE status = 'online'"),
    offline: compter("SELECT COUNT(*) n FROM appareils WHERE status = 'offline'"),
    suspect: compter("SELECT COUNT(*) n FROM appareils WHERE status = 'suspect'"),
    banned: compter("SELECT COUNT(*) n FROM appareils WHERE status = 'banned'"),
    quarantined: compter("SELECT COUNT(*) n FROM appareils WHERE status = 'quarantined'"),
    vlans: compter('SELECT COUNT(*) n FROM vlans'),
    alerts: compter('SELECT COUNT(*) n FROM alertes WHERE acknowledged = 0'),
    openPorts: compter("SELECT COUNT(*) n FROM ports WHERE state = 'open'"),
    subnet: reglages.lire('scan.subnet') || s.cfg.sousReseau,
  }), { role: 'lecture', jeton: true });

  route.get('/api/alerts', ctx => db.prepare('SELECT * FROM alertes ORDER BY createdAt DESC LIMIT ?').all(ctx.q.limit).map(F.alerte),
    { role: 'lecture', jeton: true, requete: { limit: { type: 'entier', min: 1, max: 500, defaut: 50 } } });

  route.post('/api/alerts/:id/ack', ctx => {
    const id = ctx.params.id;
    if (!ID.test(id) || !db.prepare('UPDATE alertes SET acknowledged = 1 WHERE id = ?').run(id).changes) throw new ErreurHttp(404, 'Alerte introuvable.');
    return { ok: true };
  }, { role: 'membre', jeton: true, corps: vide });

  route.get('/api/logs', ctx => {
    const { level, limit } = ctx.q;
    const lignes = level ? db.prepare('SELECT * FROM journal_service WHERE level = ? ORDER BY createdAt DESC LIMIT ?').all(level, limit)
      : db.prepare('SELECT * FROM journal_service ORDER BY createdAt DESC LIMIT ?').all(limit);
    return lignes.map(F.ligneJournal);
  }, { role: 'lecture', requete: { level: { type: 'chaine', parmi: NIVEAUX }, limit: { type: 'entier', min: 1, max: 1000, defaut: 200 } } });

  route.get('/api/settings', () => reglages.tous(), { role: 'lecture' });

  route.put('/api/settings/:key', ctx => {
    const cle = ctx.params.key;
    // Élargir les destinations internes ouvre une porte vers le réseau : renfort exigé.
    if (CLES[cle]?.securite) acces.exiger(ctx, 'admin', { renfort: true });
    const valeur = reglages.ecrire(cle, ctx.corps.value);
    acces.tracer(ctx, 'reglage.modifie', cle, CLES[cle].securite ? { entrees: valeur.length } : { valeur });
    return { ok: true };
  }, { role: 'admin', corps: { value: { type: 'json', requis: true, profondeur: 3 } } });

  route.get('/api/setup/status', () => {
    const r = s.equipements.principal();
    return { complete: reglages.lire('setup.complete') === true, mainRouter: r ? { id: r.id, host: r.host, name: r.name, vendor: r.vendor } : null };
  }, { role: 'lecture' });

  route.post('/api/setup/complete', ctx => {
    reglages.poser('setup.complete', true);
    acces.tracer(ctx, 'installation.terminee');
    return { ok: true };
  }, { role: 'admin', corps: vide });

  route.get('/api/rules', () => db.prepare('SELECT * FROM regles ORDER BY createdAt LIMIT 500').all().map(F.regle), { role: 'lecture' });

  route.patch('/api/rules/:id', ctx => {
    const r = ID.test(ctx.params.id) && db.prepare('SELECT * FROM regles WHERE id = ?').get(ctx.params.id);
    if (!r) throw new ErreurHttp(404, 'Règle introuvable.');
    const b = ctx.corps;
    const cles = ['name', 'enabled', 'threshold', 'action', 'exceptWhitelist'].filter(k => k in b);
    if (cles.length) db.prepare(`UPDATE regles SET ${cles.map(k => `${k} = ?`).join(', ')} WHERE id = ?`).run(...cles.map(k => (typeof b[k] === 'boolean' ? (b[k] ? 1 : 0) : b[k])), r.id);
    acces.tracer(ctx, 'regle.modifiee', r.id, b);
    return F.regle(db.prepare('SELECT * FROM regles WHERE id = ?').get(r.id));
  }, {
    role: 'admin', renfort: true, effacables: ['threshold'],
    corps: { name: nom(80), enabled: { type: 'booleen' }, threshold: { type: 'nombre', min: 0, max: 100 }, action: { type: 'chaine', parmi: ['alert', 'quarantine', 'ban', 'disablePort'] }, exceptWhitelist: { type: 'booleen' } },
  });

  route.get('/api/memoire', () => ({ synapse: s.memoire.public() }), { role: 'lecture' });

  route.post('/api/poste/test', async ctx => {
    if (!essais.prendre(ctx.acteur.id)) throw new ErreurHttp(429, 'Trop d’essais : attends une minute.');
    acces.tracer(ctx, 'poste.essai');
    const r = await s.poste.essayer();
    if (!r.ok) ctx.statut = 502;
    return r;
  }, { role: 'admin', corps: vide });

  const canal = ctx => {
    const c = ctx.params.channel;
    if (c === 'sms') throw new ErreurHttp(400, 'Le SMS n’est plus un canal : utilise Telegram ou le courriel.');
    if (!CANAUX.includes(c)) throw new ErreurHttp(400, 'Canal inconnu.');
    return c;
  };
  const configDe = (c, brut) => (brut === undefined ? undefined : valider(brut, CONFIG_CANAL[c]));

  route.get('/api/notifications', () => notifications.lister(), { role: 'lecture' });
  route.get('/api/notifications/:channel', ctx => notifications.public(canal(ctx)), { role: 'admin' });

  route.put('/api/notifications/:channel', ctx => {
    const c = canal(ctx);
    notifications.enregistrer(c, ctx.corps.enabled, configDe(c, ctx.corps.config));
    acces.tracer(ctx, 'notification.modifiee', c, { actif: ctx.corps.enabled });
    return { ok: true };
  }, { role: 'admin', renfort: true, corps: { enabled: { type: 'booleen', requis: true }, config: { type: 'objet', profondeur: 1 } } });

  route.post('/api/notifications/:channel/test', async ctx => {
    const c = canal(ctx);
    if (!essais.prendre(ctx.acteur.id)) throw new ErreurHttp(429, 'Trop d’essais : attends une minute.');
    acces.tracer(ctx, 'notification.essai', c);
    return notifications.essayer(c, configDe(c, ctx.corps.config));
  }, { role: 'admin', corps: { config: { type: 'objet', profondeur: 1 } } });

  route.del('/api/notifications/:channel', ctx => {
    const c = canal(ctx);
    notifications.supprimer(c);
    acces.tracer(ctx, 'notification.supprimee', c);
    return { ok: true };
  }, { role: 'admin', renfort: true });

  route.get('/api/host/stats', () => s.hote.mesures(), { role: 'lecture', jeton: true });
  route.get('/api/host/history', ctx => db.prepare('SELECT * FROM mesures_hote WHERE createdAt > ? ORDER BY createdAt').all(Date.now() - ctx.q.minutes * 60_000).map(F.mesureHote),
    { role: 'lecture', requete: { minutes: { type: 'entier', min: 1, max: 1440, defaut: 60 } } });

  route.get('/api/integrations', () => jetons.lister().map(j => F.jetonIntegration(j)), { role: 'admin' });

  route.post('/api/integrations', ctx => {
    const { name, role, expiresAt } = ctx.corps;
    const echeance = expiresAt ? Date.parse(expiresAt) : null;
    if (expiresAt && (!Number.isFinite(echeance) || echeance <= Date.now())) throw new ErreurHttp(400, 'Échéance invalide : une date ISO dans le futur.');
    const { ligne, clair } = jetons.creer({ name: name.trim(), role, expiresAt: echeance, createdById: ctx.acteur.compte });
    s.evts.journaliser('info', 'integrations', `Jeton d’intégration « ${ligne.name} » créé (${role})`, { prefix: ligne.prefix });
    acces.tracer(ctx, 'jeton.cree', ligne.id, { role, prefixe: ligne.prefix });
    ctx.statut = 201;
    return { ...F.jetonIntegration(ligne), token: clair };
  }, {
    role: 'admin', renfort: true,
    corps: { name: nom(60, true), role: { type: 'chaine', requis: true, parmi: ROLES_JETON }, expiresAt: { type: 'chaine', max: 30, motif: /^\d{4}-\d{2}-\d{2}T[\d:.]+(?:Z|[+-]\d{2}:\d{2})$/ } },
  });

  route.del('/api/integrations/:id', ctx => {
    const j = ID.test(ctx.params.id) && jetons.ligne(ctx.params.id);
    if (!j) throw new ErreurHttp(404, 'Jeton introuvable.');
    if (j.revokedAt) return F.jetonIntegration(j);
    const r = jetons.revoquer(j.id);
    s.evts.journaliser('warn', 'integrations', `Jeton d’intégration « ${j.name} » révoqué`, { prefix: j.prefix });
    acces.tracer(ctx, 'jeton.revoque', j.id, { prefixe: j.prefix });
    return F.jetonIntegration(r);
  }, { role: 'admin', renfort: true });

  route.get('/api/flux', ctx => { s.flux.ouvrir(ctx); }, { role: 'lecture' });
}
