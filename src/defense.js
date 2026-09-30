// Défense active : bloquer, isoler, lever le blocage, par l'équipement
// principal. Ce module décide si l'on a le droit d'agir et ce qu'on en garde ;
// le dialecte du constructeur vit dans les adaptateurs.
import { ErreurHttp } from '../socle/src/index.js';
import { validerCible, ValeurRefusee } from './cibles.js';

const LIBELLES = { ban: 'bloquer', quarantine: 'isoler', unban: 'lever le blocage' };

export class Defense {
  constructor(s) { this.s = s; }

  async agir(genre, appareil) {
    const { ligne, adaptateur, ctx } = this.s.equipements.principalPilotable();
    if (!adaptateur.capabilities.includes(genre)) throw new ErreurHttp(409, `${adaptateur.label} ne sait pas ${LIBELLES[genre]} depuis MapMyLAN.`);
    let cible;
    // Une adresse qui ne tient pas la route n'entre pas dans une commande du
    // routeur : l'appareil ne peut pas être bloqué, plutôt que mal.
    try { cible = validerCible({ ip: appareil.ip, mac: appareil.mac }); } catch (e) {
      if (e instanceof ValeurRefusee) throw new ErreurHttp(409, `Action impossible : ${e.message}`);
      throw e;
    }
    const output = await adaptateur[genre](ctx, cible);
    this.s.equipements.noterConnexion(ligne.id);
    return { output: String(output).slice(0, 20000), vendor: adaptateur.id };
  }

  appareil(id) {
    const d = this.s.appareils.ligne(id);
    if (!d) throw new ErreurHttp(404, 'Appareil introuvable.');
    return d;
  }

  async bloquer(id, { manuel = false, raison } = {}) {
    const d = this.appareil(id);
    if (d.isMainRouter) throw new ErreurHttp(409, 'Le routeur principal ne se bloque pas.');
    if (d.whitelisted && !manuel) throw new ErreurHttp(409, 'Appareil en liste blanche : action manuelle requise.');
    let r;
    try { r = await this.agir('ban', d); } catch (e) {
      this.s.commandes.declencher('defense.ban_failed', { ip: d.ip, error: String(e.message).slice(0, 200) });
      throw e;
    }
    this.s.appareils.modifier(id, { status: 'banned' });
    this.s.appareils.noter(id, 'action_taken', { action: 'ban', manual: manuel, reason: raison, vendor: r.vendor, output: r.output.slice(0, 2000) });
    this.s.evts.alerter('high', 'defense', `Appareil bloqué : ${d.hostname || d.ip}${raison ? ` — ${raison}` : ''}`, { deviceId: d.id, deviceIp: d.ip, deviceMac: d.mac });
    this.s.evts.emettre('device:updated', { id, status: 'banned' });
    this.s.commandes.declencher('defense.ban_success', { deviceId: d.id, ip: d.ip, name: d.hostname || d.customName || d.ip, reason: raison || 'manual' });
    return { ok: true, output: r.output };
  }

  async isoler(id, { manuel = false, raison } = {}) {
    const d = this.appareil(id);
    if (d.isMainRouter) throw new ErreurHttp(409, 'Le routeur principal ne s’isole pas.');
    if (d.whitelisted && !manuel) throw new ErreurHttp(409, 'Appareil en liste blanche : action manuelle requise.');
    const r = await this.agir('quarantine', d);
    this.s.appareils.modifier(id, { status: 'quarantined' });
    this.s.appareils.noter(id, 'action_taken', { action: 'quarantine', manual: manuel, reason: raison, vendor: r.vendor, output: r.output.slice(0, 2000) });
    this.s.evts.alerter('medium', 'defense', `Appareil isolé : ${d.hostname || d.ip}`, { deviceId: d.id, deviceIp: d.ip, deviceMac: d.mac });
    this.s.evts.emettre('device:updated', { id, status: 'quarantined' });
    this.s.commandes.declencher('defense.quarantine_success', { deviceId: d.id, ip: d.ip, name: d.hostname || d.customName || d.ip, reason: raison || 'manual' });
    return { ok: true, output: r.output };
  }

  async liberer(id) {
    const d = this.appareil(id);
    const r = await this.agir('unban', d);
    this.s.appareils.modifier(id, { status: 'online' });
    this.s.appareils.noter(id, 'action_taken', { action: 'unban', vendor: r.vendor, output: r.output.slice(0, 1000) });
    this.s.evts.journaliser('info', 'defense', `Blocage levé : ${d.hostname || d.ip}`);
    this.s.evts.emettre('device:updated', { id, status: 'online' });
    this.s.commandes.declencher('defense.unban', { ip: d.ip, name: d.hostname || d.customName || d.ip });
    return { ok: true, output: r.output };
  }
}

// Règles de sécurité automatiques. Seul le déclencheur « dangerScore » est
// évalué ici ; les autres sont portés par les événements qui les concernent.
// Liste blanche et routeur principal sont toujours exemptés.
export async function appliquerRegles(s) {
  const regles = s.db.prepare('SELECT * FROM regles WHERE enabled = 1').all();
  if (!regles.length) return;
  const appareils = s.db.prepare("SELECT * FROM appareils WHERE status NOT IN ('offline', 'banned', 'quarantined')").all();
  for (const regle of regles) {
    if (regle.trigger !== 'dangerScore') continue;
    const seuil = regle.threshold ?? 75;
    for (const d of appareils.filter(a => a.dangerScore >= seuil)) {
      if (d.isMainRouter || (regle.exceptWhitelist && d.whitelisted)) continue;
      const nom = d.hostname || d.ip;
      try {
        if (regle.action === 'ban') {
          await s.defense.bloquer(d.id, { raison: `Règle automatique : ${regle.name}` });
          await s.notifications.diffuser('critical', 'Appareil bloqué automatiquement', `${nom} a atteint un danger de ${d.dangerScore}/100`, { IP: d.ip, MAC: d.mac || '?', Fabricant: d.vendor || '?', Règle: regle.name }, { evenement: 'isolement', ip: d.ip, hote: d.hostname, risque: d.dangerScore });
        } else if (regle.action === 'quarantine') {
          await s.defense.isoler(d.id, { raison: `Règle automatique : ${regle.name}` });
          await s.notifications.diffuser('high', 'Appareil isolé automatiquement', `${nom} a atteint un danger de ${d.dangerScore}/100`, { IP: d.ip, Règle: regle.name }, { evenement: 'isolement', ip: d.ip, hote: d.hostname, risque: d.dangerScore });
        } else if (regle.action === 'alert') {
          await s.notifications.diffuser('medium', `Règle déclenchée : ${regle.name}`, `${nom} : danger ${d.dangerScore}/100`, null, { evenement: 'risque_eleve', ip: d.ip, hote: d.hostname, risque: d.dangerScore });
        }
        s.evts.journaliser('warn', 'rules', `Règle « ${regle.name} » appliquée à ${nom}`);
        s.commandes.declencher('defense.rule_triggered', { rule: regle.name, ip: d.ip });
      } catch (e) {
        s.evts.journaliser('error', 'rules', `Règle « ${regle.name} » en échec sur ${d.ip} : ${e.message}`);
      }
    }
  }
}
