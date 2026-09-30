// Routes du réseau lui-même : VLAN, équipement principal, consoles SSH et carte.
import { ErreurHttp } from '../../socle/src/index.js';
import { nouvelId, transaction } from '../db.js';
import * as F from '../formes.js';
import { adaptateur, catalogue, reconnaitre as parBanniere } from '../adaptateurs/index.js';
import { exigerUrlEquipement } from '../adaptateurs/session.js';
import { estHote } from '../cibles.js';
import { UTILISATEUR } from '../ssh.js';
import { gardeCommande } from '../consoles.js';
import { construireTopologie } from '../topologie.js';
import { CIDR, COULEUR, HOTE, ID, nom, texte, coordonnee, vide } from './schemas.js';

const EMPREINTE_HOTE = /^SHA256:[A-Za-z0-9+/]{43}$/;
const EMPREINTE_TLS = /^(?:[0-9A-F]{2}:){31}[0-9A-F]{2}$/;
const SECRET = max => ({ type: 'chaine', max });

const IDENTIFIANTS = {
  vendor: { type: 'chaine', max: 40, motif: /^[a-z0-9-]{1,40}$/ },
  transport: { type: 'chaine', parmi: ['ssh', 'api'] },
  host: { type: 'chaine', requis: true, max: 253, motif: HOTE },
  port: { type: 'entier', min: 1, max: 65535 },
  username: { type: 'chaine', requis: true, max: 128, motif: /^[^\x00-\x20]{1,128}$/ },
  password: SECRET(512), privateKey: SECRET(16384), passphrase: SECRET(512),
  apiBaseUrl: { type: 'chaine', max: 300 },
  site: { type: 'chaine', max: 64, motif: /^[A-Za-z0-9_-]{1,64}$/ },
  verifyTls: { type: 'booleen' },
  empreinteHote: { type: 'chaine', max: 60, motif: EMPREINTE_HOTE },
  empreinteTls: { type: 'chaine', max: 95, motif: EMPREINTE_TLS },
};
const RECONNAISSANCE = { ...IDENTIFIANTS, username: { ...IDENTIFIANTS.username, requis: false } };
const CONSOLE = {
  name: nom(80, true), host: IDENTIFIANTS.host, port: IDENTIFIANTS.port, username: { type: 'chaine', requis: true, max: 64, motif: UTILISATEUR },
  password: SECRET(512), privateKey: SECRET(16384), passphrase: SECRET(512), vendor: IDENTIFIANTS.vendor, isMainRouter: { type: 'booleen' },
  empreinteHote: { ...IDENTIFIANTS.empreinteHote, requis: true },
};
const ESSAI_CONSOLE = {
  ...CONSOLE, name: nom(80), empreinteHote: IDENTIFIANTS.empreinteHote,
  transport: IDENTIFIANTS.transport, apiBaseUrl: IDENTIFIANTS.apiBaseUrl, site: IDENTIFIANTS.site, verifyTls: IDENTIFIANTS.verifyTls, empreinteTls: IDENTIFIANTS.empreinteTls,
};
// Commande d'essai écrite ici : elle marche sur un Linux, un RouterOS ou un IOS.
const COMMANDE_ESSAI = 'uname -a 2>/dev/null || /system identity print 2>/dev/null || show version | head -3 2>/dev/null || echo connected';
const TYPES_LIEN = ['ethernet', 'wifi', 'vpn', 'trunk', 'wan', 'docker', 'sibling'];
const VLAN = { name: nom(60), subnet: { type: 'chaine', max: 18, motif: CIDR }, color: { type: 'chaine', max: 7, motif: COULEUR }, description: texte(500), isolated: { type: 'booleen' } };
const ZONE = { name: nom(80), color: { type: 'chaine', max: 7, motif: COULEUR }, x: coordonnee, y: coordonnee, width: { type: 'nombre', min: 10, max: 1e5 }, height: { type: 'nombre', min: 10, max: 1e5 }, notes: texte(2000) };

// Ce que les routes d'équipement reçoivent, ramené à la forme des adaptateurs.
function credsDe(b) {
  const transport = b.transport === 'api' ? 'api' : 'ssh';
  if (!estHote(b.host)) throw new ErreurHttp(400, 'Hôte invalide : une adresse IP ou un nom d’hôte.');
  if (transport === 'ssh' && b.username !== undefined && !UTILISATEUR.test(b.username)) throw new ErreurHttp(400, 'Identifiant SSH invalide.');
  return {
    host: b.host, port: b.port || (transport === 'api' ? 443 : 22), username: b.username, transport,
    password: b.password || undefined, privateKey: b.privateKey || undefined, passphrase: b.passphrase || undefined,
    apiBaseUrl: transport === 'api' && b.apiBaseUrl ? exigerUrlEquipement(b.apiBaseUrl, b.host) : undefined,
    site: b.site || undefined, verifyTls: b.verifyTls === true,
  };
}

// Un échec de l'équipement devient une réponse d'essai ; une erreur de la
// requête (400) ou une confirmation attendue (409) reste une erreur.
async function essayer(fn) {
  try { return await fn(); } catch (e) {
    if (e.status === 400 || e.status === 409) throw e;
    return { ok: false, error: String(e.message).slice(0, 300) };
  }
}

export function routesReseau(route, s, acces) {
  const { db, equipements, vlans } = s;

  const numeroVlan = brut => {
    const n = Number(brut);
    const v = Number.isInteger(n) && n >= 1 && n <= 4094 ? db.prepare('SELECT * FROM vlans WHERE id = ?').get(n) : null;
    if (!v) throw new ErreurHttp(404, 'VLAN introuvable.');
    return v;
  };

  route.get('/api/vlans', () => db.prepare('SELECT * FROM vlans ORDER BY id').all().map(F.vlan), { role: 'lecture', jeton: true });

  route.post('/api/vlans/relever', async ctx => {
    const r = await vlans.relever();
    acces.tracer(ctx, 'vlan.releve', null, { ajoutes: r.ajoutes, misAJour: r.misAJour });
    return r;
  }, { role: 'membre', corps: vide });

  route.post('/api/vlans', async ctx => {
    const b = ctx.corps;
    const sousReseau = vlans.valider(b);
    if (db.prepare('SELECT 1 FROM vlans WHERE id = ?').get(b.id)) throw new ErreurHttp(409, `Le VLAN ${b.id} existe déjà.`);
    db.prepare('INSERT INTO vlans(id, name, subnet, description, color, isolated, createdAt) VALUES(?,?,?,?,?,?,?)')
      .run(b.id, b.name, sousReseau, b.description || null, b.color || '#38bdf8', b.isolated ? 1 : 0, Date.now());
    const v = db.prepare('SELECT * FROM vlans WHERE id = ?').get(b.id);
    let provision = null;
    if (b.pushToRouter !== false) {
      try { provision = await vlans.pousser(v); } catch (e) { provision = { pushed: false, output: String(e.message).slice(0, 300) }; }
    }
    acces.tracer(ctx, 'vlan.cree', String(b.id), { pousse: !!provision?.pushed });
    return { vlan: F.vlan(v), provision };
  }, { role: 'membre', corps: { id: { type: 'entier', requis: true, min: 1, max: 4094 }, ...VLAN, name: nom(60, true), subnet: { ...VLAN.subnet, requis: true }, pushToRouter: { type: 'booleen' } } });

  route.patch('/api/vlans/:id', ctx => {
    const v = numeroVlan(ctx.params.id);
    const b = { ...ctx.corps };
    if (b.subnet) b.subnet = vlans.valider(b);
    const cles = ['name', 'subnet', 'color', 'description', 'isolated'].filter(k => k in b);
    if (cles.length) db.prepare(`UPDATE vlans SET ${cles.map(k => `${k} = ?`).join(', ')} WHERE id = ?`).run(...cles.map(k => (typeof b[k] === 'boolean' ? (b[k] ? 1 : 0) : b[k])), v.id);
    return F.vlan(db.prepare('SELECT * FROM vlans WHERE id = ?').get(v.id));
  }, { role: 'membre', corps: VLAN, effacables: ['description'] });

  route.del('/api/vlans/:id', async ctx => {
    const v = numeroVlan(ctx.params.id);
    let provision = null;
    if (ctx.q.removeFromRouter !== 'false') {
      try { provision = await vlans.retirer(v.id); } catch (e) { provision = { output: String(e.message).slice(0, 300) }; }
    }
    db.prepare('DELETE FROM vlans WHERE id = ?').run(v.id);
    acces.tracer(ctx, 'vlan.supprime', String(v.id), { equipement: ctx.q.removeFromRouter !== 'false' });
    return { ok: true, provision };
  }, { role: 'admin', renfort: true, requete: { removeFromRouter: { type: 'chaine', parmi: ['true', 'false'] } } });

  const publicRouteur = l => F.equipement(l, l ? adaptateur(l.vendor).capabilities : []);
  const principalOu404 = () => equipements.principal() || (() => { throw new ErreurHttp(404, 'Aucun équipement enregistré.'); })();

  route.get('/api/router/adapters', () => catalogue(), { role: 'lecture' });
  route.get('/api/router', () => publicRouteur(equipements.principal()), { role: 'lecture' });

  // Reconnaissance : ce que l'hôte présente (bannière et clé d'hôte, ou
  // certificat), sans rien lui confier. Aucun secret ne part tant que
  // l'administrateur n'a pas confirmé l'empreinte.
  route.post('/api/router/detect', async ctx => {
    const creds = credsDe(ctx.corps);
    acces.tracer(ctx, 'equipement.reconnaissance', null, { hote: creds.host, transport: creds.transport });
    const vu = await equipements.reconnaitre(creds);
    if (vu.tls) {
      return {
        ok: true, detected: 'unifi', info: `Certificat « ${vu.tls.sujet || '?'} » émis par « ${vu.tls.emetteur || '?'} »`,
        empreinteTls: vu.tls.empreinte, sujetTls: vu.tls.sujet, certificatReconnu: vu.tls.reconnu,
      };
    }
    const { cles, banniere } = vu.ssh;
    return { ok: cles.length > 0, detected: parBanniere(banniere || '')?.id || null, info: banniere, empreinteHote: cles[0]?.empreinte || null, typeCle: cles[0]?.type || null };
  }, { role: 'admin', corps: RECONNAISSANCE });

  route.post('/api/router/test', async ctx => {
    const b = ctx.corps;
    acces.tracer(ctx, 'equipement.essai', null, { hote: b.useSaved ? null : b.host || null, enregistre: b.useSaved === true });
    let l = null, a, contexte;
    if (b.useSaved) {
      ({ ligne: l, adaptateur: a, ctx: contexte } = equipements.principalPilotable());
    } else {
      if (!b.host || !b.username) throw new ErreurHttp(400, 'Hôte et identifiant requis (ou « useSaved »).');
      const creds = credsDe(b);
      const preuves = await equipements.preuves(creds, b);
      contexte = equipements.contexte(creds, { cleHote: preuves.cleHote || null, certificat: preuves.certificat || null });
      a = adaptateur(b.vendor);
      const enPlace = equipements.principal();
      if (enPlace && enPlace.host === creds.host && enPlace.transport === creds.transport) l = enPlace;
    }
    const r = await essayer(() => a.test(contexte));
    if (l) db.prepare('UPDATE equipements SET lastTestOk = ?, lastTestAt = ?, lastTestInfo = ? WHERE id = ?').run(r.ok ? 1 : 0, Date.now(), String(r.info || r.error || '').slice(0, 300) || null, l.id);
    s.evts.journaliser(r.ok ? 'info' : 'warn', 'router', `Test ${a.label} : ${r.ok ? 'réussi' : 'échec'} ${String(r.info || r.error || '').slice(0, 160)}`);
    return { ...r, adapter: a.id, capabilities: a.capabilities };
  }, { role: 'admin', corps: { ...RECONNAISSANCE, host: { ...IDENTIFIANTS.host, requis: false }, useSaved: { type: 'booleen' } } });

  route.put('/api/router', async ctx => {
    const b = ctx.corps;
    const creds = credsDe(b);
    const preuves = await equipements.preuves(creds, b);
    // La ligne marquée « principal », ou à défaut celle du même hôte : une
    // console cochée « principal » retire le drapeau aux autres.
    const existante = equipements.principal() || db.prepare('SELECT * FROM equipements WHERE transport = ? AND host = ? ORDER BY createdAt LIMIT 1').get(creds.transport, creds.host);
    const l = transaction(db, () => {
      const enregistree = equipements.enregistrer({ id: existante?.id, name: b.name || `Routeur ${creds.host}`, creds, vendor: adaptateur(b.vendor).id, isMainRouter: true, preuves });
      // Une ligne pilotée par API ne vient que d'ici : toute autre est un doublon.
      if (creds.transport === 'api') db.prepare("DELETE FROM equipements WHERE transport = 'api' AND id != ?").run(enregistree.id);
      return enregistree;
    });
    s.evts.journaliser('info', 'router', `Équipement principal enregistré : ${l.vendor} sur ${l.host}`);
    acces.tracer(ctx, 'equipement.enregistre', l.id, { vendor: l.vendor, hote: l.host, empreinte: l.empreinteHote || l.empreinteTls || null });
    return publicRouteur(l);
  }, { role: 'admin', renfort: true, corps: { ...IDENTIFIANTS, name: nom(80) } });

  route.del('/api/router', ctx => {
    const l = equipements.principal();
    const n = transaction(db, () => (l ? db.prepare('DELETE FROM equipements WHERE id = ?').run(l.id).changes : 0) + db.prepare("DELETE FROM equipements WHERE transport = 'api'").run().changes);
    if (n) s.evts.journaliser('info', 'router', 'Équipement principal supprimé');
    acces.tracer(ctx, 'equipement.supprime', l?.id || null);
    return { ok: true };
  }, { role: 'admin', renfort: true });

  const lectureEquipement = quoi => async () => {
    const l = principalOu404();
    const a = adaptateur(l.vendor);
    if (!a[quoi]) return quoi === 'clients' ? { supported: false, clients: [] } : { supported: false, entries: [] };
    const liste = await a[quoi](equipements.contexteDe(l));
    equipements.noterConnexion(l.id);
    return quoi === 'clients' ? { supported: true, clients: liste } : { supported: true, entries: liste };
  };
  route.get('/api/router/clients', lectureEquipement('clients'), { role: 'lecture' });
  route.get('/api/router/arp', lectureEquipement('arp'), { role: 'lecture' });

  const console404 = id => (ID.test(id) && equipements.ligne(id)) || (() => { throw new ErreurHttp(404, 'Équipement introuvable.'); })();

  route.get('/api/ssh', () => equipements.lister().map(F.consoleSsh), { role: 'lecture' });

  route.post('/api/ssh', async ctx => {
    const b = ctx.corps;
    const creds = credsDe({ ...b, transport: 'ssh' });
    const preuves = await equipements.preuves(creds, b);
    const l = transaction(db, () => {
      if (b.isMainRouter) db.prepare('UPDATE equipements SET isMainRouter = 0').run();
      const enregistree = equipements.enregistrer({ name: b.name, creds, vendor: adaptateur(b.vendor || 'generic').id, isMainRouter: !!b.isMainRouter, preuves });
      if (b.isMainRouter) db.prepare('UPDATE appareils SET isMainRouter = 1, whitelisted = 1 WHERE ip = ?').run(creds.host);
      return enregistree;
    });
    s.evts.journaliser('info', 'ssh', `Console SSH ajoutée : ${l.name}`);
    acces.tracer(ctx, 'console.ajoutee', l.id, { hote: l.host, empreinte: l.empreinteHote });
    return { id: l.id, name: l.name, host: l.host, vendor: l.vendor, isMainRouter: l.isMainRouter === 1 };
  }, { role: 'admin', renfort: true, corps: CONSOLE });

  // L'aiguillage se fait sur le transport demandé : la marque dit ce qu'on
  // pilote, pas par où.
  route.post('/api/ssh/test', async ctx => {
    const b = ctx.corps;
    const creds = credsDe(b);
    acces.tracer(ctx, 'console.essai', null, { hote: creds.host, transport: creds.transport });
    if (creds.transport === 'api') {
      const preuves = await equipements.preuves(creds, b);
      return essayer(() => adaptateur(b.vendor || 'unifi').test(equipements.contexte(creds, { certificat: preuves.certificat })));
    }
    if (!b.empreinteHote) {
      const { cles, banniere } = await s.ssh.lireCles(creds);
      return { ok: false, aConfirmer: true, empreinteHote: cles[0]?.empreinte || null, typeCle: cles[0]?.type || null, ...(banniere ? { banner: banniere } : {}) };
    }
    const cle = await s.ssh.cleConfirmee(creds, b.empreinteHote);
    return essayer(async () => {
      const r = await equipements.contexte(creds, { cleHote: { type: cle.type, cle: cle.cle } }).exec(COMMANDE_ESSAI);
      return { ok: true, banner: String(r.stdout || r.stderr || '').slice(0, 200) };
    });
  }, { role: 'admin', corps: ESSAI_CONSOLE });

  route.del('/api/ssh/:id', ctx => {
    const l = console404(ctx.params.id);
    if (l.transport === 'api') throw new ErreurHttp(409, 'Cet équipement est piloté par son API locale : il se supprime depuis la page Équipement réseau.');
    db.prepare('DELETE FROM equipements WHERE id = ?').run(l.id);
    s.evts.journaliser('info', 'ssh', `Console SSH retirée : ${l.name}`);
    acces.tracer(ctx, 'console.supprimee', l.id);
    return { ok: true };
  }, { role: 'admin', renfort: true });

  route.post('/api/ssh/:id/exec', async ctx => {
    const l = console404(ctx.params.id);
    const commande = gardeCommande(ctx.corps.command);
    // Le premier mot seulement : un argument peut porter un secret.
    acces.tracer(ctx, 'console.commande', l.id, { programme: commande.trim().split(/\s+/)[0].slice(0, 40) });
    return s.consoles.executer(l.id, commande);
  }, { role: 'admin', renfort: true, corps: { command: { type: 'chaine', requis: true, max: 4096 } } });

  const lien = id => (ID.test(id) && db.prepare('SELECT * FROM liens WHERE id = ?').get(id)) || (() => { throw new ErreurHttp(404, 'Lien introuvable.'); })();
  const zone = id => (ID.test(id) && db.prepare('SELECT * FROM zones WHERE id = ?').get(id)) || (() => { throw new ErreurHttp(404, 'Zone introuvable.'); })();
  const appareilExiste = id => {
    if (!ID.test(id) || !db.prepare('SELECT 1 FROM appareils WHERE id = ?').get(id)) throw new ErreurHttp(400, 'Appareil inconnu.');
    return id;
  };
  // Une interface ne s'accroche qu'à l'appareil qui la porte.
  const interfaceDe = (ifaceId, deviceId) => {
    if (ifaceId === null || ifaceId === undefined) return null;
    if (!ID.test(ifaceId) || !db.prepare('SELECT 1 FROM interfaces WHERE id = ? AND deviceId = ?').get(ifaceId, deviceId)) throw new ErreurHttp(400, 'Interface inconnue pour cet appareil.');
    return ifaceId;
  };
  const inserer = l => {
    const id = nouvelId();
    try {
      db.prepare('INSERT INTO liens(id, fromId, toId, fromIfaceId, toIfaceId, type, speed, vlan, manual, createdAt) VALUES(?,?,?,?,?,?,?,?,1,?)')
        .run(id, l.fromId, l.toId, l.fromIfaceId || null, l.toIfaceId || null, l.type || 'ethernet', l.speed || null, l.vlan || null, Date.now());
    } catch (e) {
      if (/UNIQUE/.test(e.message)) throw new ErreurHttp(409, 'Ce lien existe déjà.');
      throw e;
    }
    return db.prepare('SELECT * FROM liens WHERE id = ?').get(id);
  };
  const LIEN = { type: { type: 'chaine', parmi: TYPES_LIEN }, speed: nom(20), vlan: nom(20) };

  route.get('/api/topology', () => ({ links: db.prepare('SELECT * FROM liens ORDER BY createdAt').all().map(F.lien), zones: db.prepare('SELECT * FROM zones ORDER BY createdAt').all().map(F.zone) }), { role: 'lecture', jeton: true });
  route.post('/api/topology/auto-build', () => construireTopologie(s, { force: true }), { role: 'membre', jeton: true, corps: vide });

  route.post('/api/topology/links', ctx => {
    const b = ctx.corps;
    if (b.fromId === b.toId) throw new ErreurHttp(400, 'Un lien relie deux appareils différents.');
    const l = inserer({ ...b, fromId: appareilExiste(b.fromId), toId: appareilExiste(b.toId) });
    s.evts.emettre('topology:updated');
    return F.lien(l);
  }, { role: 'membre', corps: { fromId: { type: 'chaine', requis: true, max: 80, motif: ID }, toId: { type: 'chaine', requis: true, max: 80, motif: ID }, ...LIEN } });

  route.patch('/api/topology/links/:id', ctx => {
    const l = lien(ctx.params.id);
    const b = { ...ctx.corps };
    if ('fromIfaceId' in b) b.fromIfaceId = interfaceDe(b.fromIfaceId, l.fromId);
    if ('toIfaceId' in b) b.toIfaceId = interfaceDe(b.toIfaceId, l.toId);
    const cles = ['type', 'speed', 'vlan', 'fromIfaceId', 'toIfaceId'].filter(k => k in b);
    try {
      if (cles.length) db.prepare(`UPDATE liens SET ${cles.map(k => `${k} = ?`).join(', ')} WHERE id = ?`).run(...cles.map(k => b[k]), l.id);
    } catch (e) {
      if (/UNIQUE/.test(e.message)) throw new ErreurHttp(409, 'Ce lien existe déjà.');
      throw e;
    }
    s.evts.emettre('topology:updated');
    return F.lien(db.prepare('SELECT * FROM liens WHERE id = ?').get(l.id));
  }, { role: 'membre', corps: { ...LIEN, fromIfaceId: { type: 'chaine', max: 80, motif: ID }, toIfaceId: { type: 'chaine', max: 80, motif: ID } }, effacables: ['speed', 'vlan', 'fromIfaceId', 'toIfaceId'] });

  // Supprimé puis recréé : l'unicité (de, vers, interfaces) interdit d'échanger sur place.
  route.post('/api/topology/links/:id/reverse', ctx => {
    const l = lien(ctx.params.id);
    const nouveau = transaction(db, () => {
      db.prepare('DELETE FROM liens WHERE id = ?').run(l.id);
      return inserer({ fromId: l.toId, toId: l.fromId, fromIfaceId: l.toIfaceId, toIfaceId: l.fromIfaceId, type: l.type, speed: l.speed, vlan: l.vlan });
    });
    s.evts.emettre('topology:updated');
    return F.lien(nouveau);
  }, { role: 'membre', corps: vide });

  route.del('/api/topology/links/:id', ctx => {
    db.prepare('DELETE FROM liens WHERE id = ?').run(lien(ctx.params.id).id);
    s.evts.emettre('topology:updated');
    return { ok: true };
  }, { role: 'membre' });

  route.post('/api/topology/zones', ctx => {
    const b = ctx.corps;
    const id = nouvelId();
    db.prepare('INSERT INTO zones(id, name, color, x, y, width, height, notes, createdAt) VALUES(?,?,?,?,?,?,?,?,?)')
      .run(id, b.name, b.color || '#38bdf8', b.x, b.y, b.width ?? 200, b.height ?? 150, b.notes || null, Date.now());
    s.evts.emettre('topology:updated');
    return F.zone(zone(id));
  }, { role: 'membre', corps: { ...ZONE, name: nom(80, true), x: { ...coordonnee, requis: true }, y: { ...coordonnee, requis: true } } });

  route.patch('/api/topology/zones/:id', ctx => {
    const z = zone(ctx.params.id);
    const b = ctx.corps;
    const cles = ['name', 'color', 'x', 'y', 'width', 'height', 'notes'].filter(k => k in b);
    if (cles.length) db.prepare(`UPDATE zones SET ${cles.map(k => `${k} = ?`).join(', ')} WHERE id = ?`).run(...cles.map(k => b[k]), z.id);
    s.evts.emettre('topology:updated');
    return F.zone(zone(z.id));
  }, { role: 'membre', corps: ZONE, effacables: ['notes'] });

  route.del('/api/topology/zones/:id', ctx => {
    db.prepare('DELETE FROM zones WHERE id = ?').run(zone(ctx.params.id).id);
    s.evts.emettre('topology:updated');
    return { ok: true };
  }, { role: 'membre' });

  // La disposition de la carte est un confort de lecture, pas une
  // modification du réseau : ouverte à tout compte. Un identifiant inconnu
  // est ignoré (un appareil supprimé entre-temps).
  route.post('/api/topology/positions', ctx => {
    const poser = db.prepare('UPDATE appareils SET posX = ?, posY = ? WHERE id = ?');
    transaction(db, () => { for (const p of ctx.corps.positions || []) poser.run(p.x, p.y, p.id); });
    return { ok: true };
  }, {
    role: 'lecture',
    corps: { positions: { type: 'liste', requis: true, max: 2000, de: { type: 'objet', champs: { id: { type: 'chaine', requis: true, max: 80, motif: ID }, x: { ...coordonnee, requis: true }, y: { ...coordonnee, requis: true } } } } },
  });
}
