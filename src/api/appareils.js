// Routes de l'inventaire : /api/devices.
import { Debit, ErreurHttp } from '../../socle/src/index.js';
import { modifierLigne, nouvelId, transaction } from '../db.js';
import * as F from '../formes.js';
import { dedoublonner, fusionner, suggestionsRegroupement } from '../inventaire.js';
import { plageUtilisable, verifierAdresse } from '../vlans.js';
import { nettoyerNom } from '../cibles.js';
import { IPV4, MAC, CIDR, ID, TYPES_APPAREIL, nom, texte, coordonnee, vide } from './schemas.js';

const CHAMPS_APPAREIL = {
  customName: nom(80), customType: { type: 'chaine', max: 20, parmi: TYPES_APPAREIL }, vendor: nom(80), model: nom(80),
  vlan: { type: 'entier', min: 1, max: 4094 }, zone: nom(60), tags: { type: 'liste', max: 20, de: nom(40, true) }, notes: texte(4000),
  role: { type: 'chaine', max: 20, parmi: ['gateway', 'core', 'edge', 'client'] }, whitelisted: { type: 'booleen' }, isMainRouter: { type: 'booleen' },
  posX: coordonnee, posY: coordonnee, pinned: { type: 'booleen' }, type: { type: 'chaine', max: 20, parmi: TYPES_APPAREIL },
};
const INTERFACE = { mac: { type: 'chaine', max: 17, motif: MAC }, ip: { type: 'chaine', max: 15, motif: IPV4 }, type: { type: 'chaine', parmi: ['ethernet', 'wifi', 'virtual', 'other'] }, label: nom(40), posX: coordonnee, posY: coordonnee };
const RAISON = { reason: texte(200) };

export function routesAppareils(route, s, acces) {
  const { db, appareils, scanner, defense } = s;
  const quotas = { balayage: new Debit({ max: 3 }), approfondi: new Debit({ max: 10 }), ping: new Debit({ max: 30 }) };
  const payer = (quota, ctx, message) => { if (!quotas[quota].prendre(ctx.acteur.id)) throw new ErreurHttp(429, message); };
  // Un identifiant inconnu et un identifiant mal formé répondent pareil.
  const ligne = id => (ID.test(id) && appareils.ligne(id)) || (() => { throw new ErreurHttp(404, 'Appareil introuvable.'); })();

  route.get('/api/devices', () => appareils.lister(), { role: 'lecture', jeton: true });
  route.get('/api/devices/health/score', () => ({ score: s.scores.sante() }), { role: 'lecture', jeton: true });
  route.get('/api/devices/scans/latest', () => F.balayage(db.prepare('SELECT * FROM balayages ORDER BY startedAt DESC LIMIT 1').get()), { role: 'lecture', jeton: true });
  route.get('/api/devices/scan/ranges', () => scanner.plagesActives(), { role: 'lecture', jeton: true });
  // Les balayages terminés d'une période, pour le graphe « Appareils vus » :
  // ce que le scanner a réellement trouvé, plage par plage.
  route.get('/api/devices/scans', ctx => db.prepare("SELECT * FROM balayages WHERE status = 'complete' AND startedAt > ? ORDER BY startedAt LIMIT 5000")
    .all(Date.now() - ctx.q.heures * 3_600_000).map(F.balayage), { role: 'lecture', requete: { heures: { type: 'entier', min: 1, max: 720, defaut: 24 } } });

  route.post('/api/devices/scan', ctx => {
    payer('balayage', ctx, 'Trop de balayages demandés : attends une minute.');
    const cidr = ctx.corps.subnet ? scanner.plageAutorisee(ctx.corps.subnet) : null;
    acces.tracer(ctx, 'balayage.lance', cidr || 'toutes les plages');
    scanner.balayer(cidr).then(() => s.scores.toutNoter()).catch(e => s.evts.journaliser('error', 'scanner', `Balayage demandé en échec : ${e.message}`));
    return { ok: true };
  }, { role: 'membre', jeton: true, corps: { subnet: { type: 'chaine', max: 18, motif: CIDR } } });

  route.post('/api/devices/manual', ctx => {
    const b = ctx.corps;
    if (!b.customName && !b.hostname && !b.ip && !b.mac) throw new ErreurHttp(400, 'Au moins un nom, un nom d’hôte, une adresse IP ou une MAC.');
    const mac = b.mac ? b.mac.replace(/-/g, ':').toUpperCase() : null;
    if (mac && appareils.parMac(mac)) throw new ErreurHttp(409, 'Cette MAC est déjà portée par un appareil de l’inventaire.');
    const d = transaction(db, () => {
      const cree = appareils.creer({
        ip: b.ip || '0.0.0.0', mac, hostname: b.hostname ? nettoyerNom(b.hostname) : null, customName: b.customName || null, vendor: b.vendor || null, model: b.model || null,
        type: b.type || b.customType || 'unknown', customType: b.customType || null, posX: b.posX ?? null, posY: b.posY ?? null, notes: b.notes || null,
        metadata: JSON.stringify({ manual: true, createdBy: ctx.acteur.nom }),
      });
      appareils.noter(cree.id, 'first_seen', { manual: true, vendor: b.vendor || 'Unknown' });
      return cree;
    });
    s.evts.emettre('devices:updated');
    return appareils.complet(d.id);
  }, { role: 'membre', corps: { ip: { type: 'chaine', max: 15, motif: IPV4 }, mac: { type: 'chaine', max: 17, motif: MAC }, hostname: nom(63), customName: nom(80), vendor: nom(80), model: nom(80), type: CHAMPS_APPAREIL.type, customType: CHAMPS_APPAREIL.customType, posX: coordonnee, posY: coordonnee, notes: texte(4000) } });

  route.get('/api/devices/grouping/suggestions', () => suggestionsRegroupement(s), { role: 'lecture' });
  route.post('/api/devices/dedupe', ctx => { acces.tracer(ctx, 'inventaire.dedoublonne'); return dedoublonner(s); }, { role: 'membre', corps: vide });

  route.get('/api/devices/:id', ctx => appareils.complet(ligne(ctx.params.id).id, { historique: 50 }), { role: 'lecture', jeton: true });

  route.patch('/api/devices/:id', ctx => {
    const d = ligne(ctx.params.id);
    const b = ctx.corps;
    // Liste blanche et routeur principal exemptent des règles automatiques :
    // un réglage de sécurité, réservé aux administrateurs.
    if ('whitelisted' in b || 'isMainRouter' in b) acces.exiger(ctx, 'admin');
    if (b.vlan != null && !db.prepare('SELECT 1 FROM vlans WHERE id = ?').get(b.vlan)) throw new ErreurHttp(400, `VLAN ${b.vlan} inconnu.`);
    transaction(db, () => {
      appareils.modifier(d.id, b);
      if (['notes', 'customName', 'customType', 'tags'].some(k => k in b)) appareils.noter(d.id, 'note_added', { changes: b });
    });
    if ('whitelisted' in b || 'isMainRouter' in b) acces.tracer(ctx, 'appareil.protection', d.id, { listeBlanche: b.whitelisted, routeurPrincipal: b.isMainRouter });
    s.evts.emettre('device:updated', { id: d.id, ...b });
    return appareils.complet(d.id);
  }, { role: 'membre', corps: CHAMPS_APPAREIL, effacables: ['customName', 'customType', 'vendor', 'model', 'vlan', 'zone', 'notes', 'role', 'posX', 'posY'] });

  route.del('/api/devices/:id', ctx => {
    const d = ligne(ctx.params.id);
    if (d.isMainRouter) throw new ErreurHttp(409, 'Le routeur principal ne se supprime pas.');
    appareils.supprimer(d.id);
    acces.tracer(ctx, 'appareil.supprime', d.id, { ip: d.ip });
    s.evts.emettre('device:deleted', { id: d.id });
    return { ok: true };
  }, { role: 'admin', renfort: true });

  // La réservation demande à la passerelle de toujours servir cette adresse à
  // cette carte : elle ne réécrit pas la configuration de la machine, qui la
  // prendra à son prochain bail. Le VLAN choisi dit de quel réseau l'adresse
  // relève ; il ne déplace pas l'appareil de segment.
  route.get('/api/devices/:id/reservation', ctx => {
    const d = ligne(ctx.params.id);
    return {
      mac: d.mac, ip: d.ip, vlan: d.vlan,
      segments: db.prepare('SELECT * FROM vlans ORDER BY id').all().map(v => ({ id: v.id, nom: v.name, sousReseau: v.subnet, passerelle: v.gateway, plage: plageUtilisable(v.subnet), pousseSurEquipement: !!v.networkId })),
    };
  }, { role: 'lecture' });

  route.post('/api/devices/:id/reservation', async ctx => {
    const d = ligne(ctx.params.id);
    if (!d.mac) throw new ErreurHttp(400, 'Aucune adresse MAC relevée pour cet appareil : une réservation se pose sur une carte réseau.');
    const { retirer = false, ip, vlan: vlanId } = ctx.corps;
    let vlan = null;
    if (!retirer) {
      if (!vlanId) throw new ErreurHttp(400, 'Choisis le VLAN auquel l’adresse appartient.');
      vlan = db.prepare('SELECT * FROM vlans WHERE id = ?').get(vlanId);
      if (!vlan) throw new ErreurHttp(400, `VLAN ${vlanId} inconnu.`);
      const v = verifierAdresse(ip || '', vlan.subnet, vlan.gateway);
      if (!v.ok) throw new ErreurHttp(400, v.raison);
      const occupant = db.prepare('SELECT ip, hostname, customName, mac FROM appareils WHERE ip = ? AND id != ?').get(ip, d.id);
      if (occupant) throw new ErreurHttp(409, `${ip} est déjà portée par ${occupant.customName || occupant.hostname || occupant.mac || occupant.ip}.`);
    }
    const { adaptateur, ctx: c, ligne: equipement } = s.equipements.principalPilotable();
    if (!adaptateur.reserver) throw new ErreurHttp(409, `${adaptateur.label} ne sait pas poser de réservation depuis MapMyLAN : déclare-la sur l’équipement.`);
    const sortie = await adaptateur.reserver(c, { mac: d.mac, ip: retirer ? undefined : ip, networkId: vlan?.networkId || undefined });
    s.equipements.noterConnexion(equipement.id);
    // On note le VLAN voulu, jamais l'adresse : tant que l'appareil n'a pas
    // repris de bail, il porte encore l'ancienne.
    transaction(db, () => {
      if (!retirer) appareils.modifier(d.id, { vlan: vlanId });
      appareils.noter(d.id, 'note_added', { reservation: retirer ? null : ip, vlan: vlanId ?? null, sortie: String(sortie).slice(0, 500) });
    });
    s.evts.journaliser('info', 'devices', retirer ? `Réservation retirée pour ${d.mac}` : `Adresse ${ip} réservée pour ${d.mac}`);
    acces.tracer(ctx, retirer ? 'reservation.retiree' : 'reservation.posee', d.id, { ip: retirer ? null : ip });
    return {
      ok: true, sortie, ipActuelle: d.ip, ipReservee: retirer ? null : ip, appliquee: retirer ? false : d.ip === ip,
      message: retirer ? 'Réservation retirée. L’appareil repassera en adresse dynamique à son prochain bail.'
        : d.ip === ip ? 'L’appareil porte déjà cette adresse : elle est maintenant garantie.'
          : `Réservation posée. L’appareil porte encore ${d.ip} et prendra ${ip} à son prochain bail — « forcer la reprise de bail » l’y oblige tout de suite.`,
    };
  }, { role: 'membre', corps: { vlan: { type: 'entier', min: 1, max: 4094 }, ip: { type: 'chaine', max: 15, motif: IPV4 }, retirer: { type: 'booleen' } } });

  route.post('/api/devices/:id/relancer-bail', async ctx => {
    const d = ligne(ctx.params.id);
    const { adaptateur, ctx: c, ligne: equipement } = s.equipements.principalPilotable();
    if (!adaptateur.relancerBail) throw new ErreurHttp(409, `${adaptateur.label} ne sait pas faire ça depuis MapMyLAN.`);
    const sortie = await adaptateur.relancerBail(c, { ip: d.ip, mac: d.mac || undefined });
    s.equipements.noterConnexion(equipement.id);
    s.evts.journaliser('warn', 'devices', `Bail relancé pour ${d.mac || d.ip}`);
    acces.tracer(ctx, 'bail.relance', d.id);
    return { ok: true, sortie, message: 'Session coupée : l’appareil redemande un bail. Compte quelques secondes.' };
  }, { role: 'membre', corps: vide });

  route.get('/api/devices/:id/ping', async ctx => {
    const d = ligne(ctx.params.id);
    payer('ping', ctx, 'Trop de pings : attends une minute.');
    if (!scanner.adresseAutorisee(d.ip)) throw new ErreurHttp(409, 'Adresse hors des plages déclarées : MapMyLAN ne la sonde pas.');
    return scanner.ping(d.ip);
  }, { role: 'lecture', jeton: true });

  route.post('/api/devices/:id/score', ctx => s.scores.noter(ligne(ctx.params.id).id), { role: 'membre', corps: vide });

  route.post('/api/devices/:id/deep-scan', async ctx => {
    const d = ligne(ctx.params.id);
    payer('approfondi', ctx, 'Trop de balayages approfondis : attends une minute.');
    if (!scanner.adresseAutorisee(d.ip)) throw new ErreurHttp(409, 'Adresse hors des plages déclarées : MapMyLAN ne la sonde pas.');
    const r = await scanner.approfondi(d.ip);
    s.commandes.declencher('scan.deep_complete', { ip: d.ip, ports: r.ports.map(p => p.port).join(',') });
    return r;
  }, { role: 'membre', jeton: true, corps: vide });

  route.get('/api/devices/:id/history', ctx => appareils.historique(ligne(ctx.params.id).id, 100), { role: 'lecture' });

  route.post('/api/devices/:id/ban', async ctx => {
    const d = ligne(ctx.params.id);
    const r = await defense.bloquer(d.id, { manuel: true, raison: ctx.corps.reason });
    acces.tracer(ctx, 'appareil.bloque', d.id, { ip: d.ip });
    return r;
  }, { role: 'membre', jeton: true, corps: RAISON });
  route.post('/api/devices/:id/quarantine', async ctx => {
    const d = ligne(ctx.params.id);
    const r = await defense.isoler(d.id, { manuel: true, raison: ctx.corps.reason });
    acces.tracer(ctx, 'appareil.isole', d.id, { ip: d.ip });
    return r;
  }, { role: 'membre', jeton: true, corps: RAISON });
  route.post('/api/devices/:id/unban', async ctx => {
    const d = ligne(ctx.params.id);
    const r = await defense.liberer(d.id);
    acces.tracer(ctx, 'appareil.libere', d.id, { ip: d.ip });
    return r;
  }, { role: 'membre', jeton: true, corps: vide });

  // Une interface n'est désignée qu'à travers son appareil : celle d'un autre répond 404.
  const iface = (deviceId, id) => (ID.test(id) && db.prepare('SELECT * FROM interfaces WHERE id = ? AND deviceId = ?').get(id, deviceId)) || (() => { throw new ErreurHttp(404, 'Interface introuvable.'); })();
  const macLibre = (mac, sauf = null) => {
    if (mac && (db.prepare('SELECT 1 FROM interfaces WHERE mac = ? AND id != ?').get(mac, sauf || '') || false)) throw new ErreurHttp(409, 'Cette MAC est déjà portée par une autre interface.');
  };

  route.post('/api/devices/:id/interfaces', ctx => {
    const d = ligne(ctx.params.id);
    const b = ctx.corps;
    const mac = b.mac ? b.mac.replace(/-/g, ':').toUpperCase() : null;
    macLibre(mac);
    const id = nouvelId();
    db.prepare('INSERT INTO interfaces(id, deviceId, mac, ip, type, label, posX, posY, createdAt) VALUES(?,?,?,?,?,?,?,?,?)').run(id, d.id, mac, b.ip || null, b.type || 'ethernet', b.label || null, b.posX ?? null, b.posY ?? null, Date.now());
    s.evts.emettre('topology:updated');
    return F.interfaceReseau(db.prepare('SELECT * FROM interfaces WHERE id = ?').get(id));
  }, { role: 'membre', corps: INTERFACE });

  route.patch('/api/devices/:id/interfaces/:ifaceId', ctx => {
    const d = ligne(ctx.params.id);
    const i = iface(d.id, ctx.params.ifaceId);
    const b = { ...ctx.corps };
    if (b.mac) { b.mac = b.mac.replace(/-/g, ':').toUpperCase(); macLibre(b.mac, i.id); }
    modifierLigne(db, 'interfaces', i.id, b, ['mac', 'ip', 'type', 'label', 'posX', 'posY', 'isPrimary']);
    s.evts.emettre('topology:updated');
    return F.interfaceReseau(db.prepare('SELECT * FROM interfaces WHERE id = ?').get(i.id));
  }, { role: 'membre', corps: { ...INTERFACE, isPrimary: { type: 'booleen' } }, effacables: ['mac', 'ip', 'label', 'posX', 'posY'] });

  route.del('/api/devices/:id/interfaces/:ifaceId', ctx => {
    const d = ligne(ctx.params.id);
    db.prepare('DELETE FROM interfaces WHERE id = ?').run(iface(d.id, ctx.params.ifaceId).id);
    s.evts.emettre('topology:updated');
    return { ok: true };
  }, { role: 'membre' });

  route.post('/api/devices/:id/merge', ctx => {
    const cible = ligne(ctx.params.id);
    const source = ligne(ctx.corps.sourceId);
    const r = fusionner(s, cible.id, { ...ctx.corps, sourceId: source.id });
    acces.tracer(ctx, 'appareil.fusionne', cible.id, { absorbe: source.id });
    return r;
  }, { role: 'membre', corps: { sourceId: { type: 'chaine', requis: true, max: 80, motif: ID }, keepName: { type: 'chaine', parmi: ['source', 'target'] }, ifaceType: { type: 'chaine', parmi: ['wifi', 'ethernet'] } } });
}
