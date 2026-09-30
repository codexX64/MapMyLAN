// Routes des automatismes : commandes « quand X → faire Y » et commandes du
// bot Telegram. Toutes deux peuvent agir sur le réseau (isoler, bloquer,
// lancer une commande SSH) : leur écriture est réservée aux administrateurs,
// sous renfort.
import { ErreurHttp } from '../../socle/src/index.js';
import { modifierLigne, nouvelId } from '../db.js';
import * as F from '../formes.js';
import { ACTIONS, DECLENCHEURS, IDS_DECLENCHEURS } from '../commandes.js';
import { ACTIONS_BOT, IDS_ACTIONS_BOT } from '../commandes-bot.js';
import { CANAUX, DISCUSSION } from '../notifications.js';
import { gardeCommande } from '../consoles.js';
import { ID, IPV4, TYPES_APPAREIL, nom, texte } from './schemas.js';

const NIVEAUX = ['info', 'warn', 'error', 'success'];
const DELAI = { type: 'entier', min: 0, max: 86400 };
const ACTION = {
  type: 'objet',
  champs: {
    kind: { type: 'chaine', requis: true, parmi: ACTIONS.map(a => a.kind) },
    channels: { type: 'liste', max: CANAUX.length, de: { type: 'chaine', parmi: CANAUX } },
    level: { type: 'chaine', parmi: NIVEAUX }, reason: texte(200),
    deviceId: { type: 'chaine', max: 80, motif: ID }, cmd: { type: 'chaine', max: 4096 },
  },
};
const COMMANDE = {
  name: nom(80), trigger: { type: 'chaine', max: 60, parmi: [...IDS_DECLENCHEURS] },
  filter: {
    type: 'objet', champs: {
      minScore: { type: 'nombre', min: 0, max: 100 }, minCvss: { type: 'nombre', min: 0, max: 10 }, minPct: { type: 'nombre', min: 0, max: 100 },
      deviceType: { type: 'chaine', parmi: TYPES_APPAREIL }, severity: { type: 'chaine', parmi: ['critical', 'high', 'medium', 'low', 'info'] }, contains: nom(100),
    },
  },
  actions: { type: 'liste', max: 10, de: ACTION }, template: texte(2000), cooldownSec: DELAI, enabled: { type: 'booleen' },
};
const COMMANDE_BOT = {
  trigger: { type: 'chaine', max: 33, motif: /^\/?[A-Za-z0-9_]{1,32}$/ }, description: texte(200),
  action: { type: 'chaine', max: 40, parmi: [...IDS_ACTIONS_BOT] },
  params: { type: 'objet', champs: { deviceId: { type: 'chaine', max: 80, motif: ID }, cmd: { type: 'chaine', max: 4096 }, text: texte(1000), ip: { type: 'chaine', max: 15, motif: IPV4 } } },
  enabled: { type: 'booleen' }, confirm: { type: 'booleen' },
  allowedChatIds: { type: 'liste', max: 20, de: { type: 'chaine', max: 21, motif: DISCUSSION } }, cooldownSec: DELAI,
};

export function routesAutomatisation(route, s, acces) {
  const { db } = s;
  // Une commande SSH enregistrée vise une console existante et passe la même
  // garde qu'une commande tapée à la main.
  const verifierSsh = (deviceId, cmd) => {
    if (!deviceId || !cmd) throw new ErreurHttp(400, 'Une commande SSH demande un équipement et une commande.');
    if (!s.equipements.ligne(deviceId)) throw new ErreurHttp(400, 'Équipement SSH inconnu.');
    gardeCommande(cmd);
  };
  const verifierActions = actions => {
    if (!actions.length) throw new ErreurHttp(400, 'Au moins une action.');
    for (const a of actions) {
      if (a.kind === 'notify' && !a.channels?.length) throw new ErreurHttp(400, 'Une notification demande au moins un canal.');
      if (a.kind === 'exec_ssh') verifierSsh(a.deviceId, a.cmd);
    }
  };
  const commande = id => (ID.test(id) && db.prepare('SELECT * FROM commandes WHERE id = ?').get(id)) || (() => { throw new ErreurHttp(404, 'Commande introuvable.'); })();
  const commandeBot = id => (ID.test(id) && db.prepare('SELECT * FROM commandes_bot WHERE id = ?').get(id)) || (() => { throw new ErreurHttp(404, 'Commande introuvable.'); })();
  const unique = fn => {
    try { return fn(); } catch (e) {
      if (/UNIQUE/.test(e.message)) throw new ErreurHttp(409, 'Ce déclencheur est déjà pris.');
      throw e;
    }
  };
  const declencheur = t => (t.startsWith('/') ? t : `/${t}`).toLowerCase();

  route.get('/api/commands/triggers', () => DECLENCHEURS, { role: 'lecture' });
  route.get('/api/commands/actions', () => ACTIONS, { role: 'lecture' });
  route.get('/api/commands', () => db.prepare('SELECT * FROM commandes ORDER BY createdAt DESC LIMIT 1000').all().map(F.commande), { role: 'lecture' });

  route.post('/api/commands', ctx => {
    const b = ctx.corps;
    verifierActions(b.actions);
    const id = nouvelId(), t = Date.now();
    db.prepare('INSERT INTO commandes(id, name, enabled, trigger, filter, actions, template, cooldownSec, createdAt, updatedAt) VALUES(?,?,?,?,?,?,?,?,?,?)')
      .run(id, b.name, b.enabled === false ? 0 : 1, b.trigger, b.filter ? JSON.stringify(b.filter) : null, JSON.stringify(b.actions), b.template || null, b.cooldownSec || 0, t, t);
    acces.tracer(ctx, 'commande.creee', id, { declencheur: b.trigger, actions: b.actions.map(a => a.kind) });
    return F.commande(commande(id));
  }, { role: 'admin', renfort: true, corps: { ...COMMANDE, name: nom(80, true), trigger: { ...COMMANDE.trigger, requis: true }, actions: { ...COMMANDE.actions, requis: true } } });

  route.patch('/api/commands/:id', ctx => {
    const c = commande(ctx.params.id);
    const b = ctx.corps;
    if (b.actions) verifierActions(b.actions);
    const valeurs = {
      name: b.name, trigger: b.trigger, template: b.template, cooldownSec: b.cooldownSec, enabled: b.enabled,
      filter: b.filter === undefined ? undefined : b.filter === null ? null : JSON.stringify(b.filter),
      actions: b.actions === undefined ? undefined : JSON.stringify(b.actions),
    };
    modifierLigne(db, 'commandes', c.id, valeurs, Object.keys(valeurs), { updatedAt: Date.now() });
    acces.tracer(ctx, 'commande.modifiee', c.id, { champs: Object.keys(valeurs).filter(k => valeurs[k] !== undefined) });
    return F.commande(commande(c.id));
  }, { role: 'admin', renfort: true, corps: COMMANDE, effacables: ['filter', 'template'] });

  route.del('/api/commands/:id', ctx => {
    const c = commande(ctx.params.id);
    db.prepare('DELETE FROM commandes WHERE id = ?').run(c.id);
    acces.tracer(ctx, 'commande.supprimee', c.id);
    return { ok: true };
  }, { role: 'admin', renfort: true });

  // Le bouton « déclencher » lance cette commande-là, pas ses voisines du même déclencheur.
  route.post('/api/commands/:id/fire', async ctx => {
    const c = commande(ctx.params.id);
    acces.tracer(ctx, 'commande.declenchee', c.id);
    await s.commandes.executer(c.trigger, ctx.corps.vars || { test: true }, { seule: c.id });
    return { ok: true };
  }, { role: 'admin', renfort: true, corps: { vars: { type: 'objet', profondeur: 1 } } });

  route.get('/api/bot-commands/actions', () => ACTIONS_BOT, { role: 'lecture' });
  route.get('/api/bot-commands', () => db.prepare('SELECT * FROM commandes_bot ORDER BY createdAt DESC LIMIT 1000').all().map(F.commandeBot), { role: 'lecture' });

  route.post('/api/bot-commands', ctx => {
    const b = ctx.corps;
    if (b.action === 'exec_ssh') verifierSsh(b.params?.deviceId, b.params?.cmd);
    const id = nouvelId(), t = Date.now();
    unique(() => db.prepare(`INSERT INTO commandes_bot(id, trigger, description, action, params, enabled, confirm, allowedChatIds, cooldownSec, createdAt, updatedAt)
      VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(id, declencheur(b.trigger), b.description || null, b.action, b.params ? JSON.stringify(b.params) : null,
      b.enabled === false ? 0 : 1, b.confirm ? 1 : 0, JSON.stringify(b.allowedChatIds || []), b.cooldownSec || 0, t, t));
    acces.tracer(ctx, 'commande-bot.creee', id, { declencheur: declencheur(b.trigger), action: b.action });
    return F.commandeBot(commandeBot(id));
  }, { role: 'admin', renfort: true, corps: { ...COMMANDE_BOT, trigger: { ...COMMANDE_BOT.trigger, requis: true }, action: { ...COMMANDE_BOT.action, requis: true } } });

  route.patch('/api/bot-commands/:id', ctx => {
    const c = commandeBot(ctx.params.id);
    const b = ctx.corps;
    const action = b.action || c.action;
    const params = b.params === undefined ? JSON.parse(c.params || 'null') : b.params;
    if (action === 'exec_ssh') verifierSsh(params?.deviceId, params?.cmd);
    const valeurs = {
      trigger: b.trigger === undefined ? undefined : declencheur(b.trigger), description: b.description, action: b.action,
      params: b.params === undefined ? undefined : b.params === null ? null : JSON.stringify(b.params),
      enabled: b.enabled, confirm: b.confirm,
      allowedChatIds: b.allowedChatIds === undefined ? undefined : JSON.stringify(b.allowedChatIds), cooldownSec: b.cooldownSec,
    };
    unique(() => modifierLigne(db, 'commandes_bot', c.id, valeurs, Object.keys(valeurs), { updatedAt: Date.now() }));
    acces.tracer(ctx, 'commande-bot.modifiee', c.id, { champs: Object.keys(valeurs).filter(k => valeurs[k] !== undefined) });
    return F.commandeBot(commandeBot(c.id));
  }, { role: 'admin', renfort: true, corps: COMMANDE_BOT, effacables: ['description', 'params'] });

  route.del('/api/bot-commands/:id', ctx => {
    const c = commandeBot(ctx.params.id);
    db.prepare('DELETE FROM commandes_bot WHERE id = ?').run(c.id);
    acces.tracer(ctx, 'commande-bot.supprimee', c.id);
    return { ok: true };
  }, { role: 'admin', renfort: true });

  route.post('/api/bot-commands/:id/run', async ctx => {
    const c = commandeBot(ctx.params.id);
    acces.tracer(ctx, 'commande-bot.lancee', c.id, { action: c.action });
    return { reply: await s.bot.executer(c, ctx.corps.args || [], 'interface') };
  }, { role: 'admin', renfort: true, corps: { args: { type: 'liste', max: 5, de: { type: 'chaine', max: 64 } } } });
}
