// Commandes « quand X arrive → faire Y ». Le reste de l'application annonce
// ses événements par declencher(id, variables) ; chaque commande active dont
// le filtre passe exécute ses actions : notifier, journaliser, isoler,
// bloquer, ou lancer une commande SSH enregistrée par un administrateur.
import { gardeCommande } from './consoles.js';

export const DECLENCHEURS = [
  ['device.new', 'Appareils', 'Nouvel appareil découvert', ['ip', 'mac', 'vendor', 'hostname']],
  ['device.online', 'Appareils', 'Appareil de retour en ligne', ['ip', 'name']],
  ['device.offline', 'Appareils', 'Appareil passé hors ligne', ['ip', 'name']],
  ['device.suspect', 'Appareils', 'Appareil devenu suspect', ['ip', 'name', 'score']],
  ['device.changed', 'Appareils', 'Adresse IP ou MAC changée', ['oldIp', 'newIp', 'name']],
  ['device.high_risk', 'Appareils', 'Score de danger au-dessus du seuil', ['ip', 'name', 'score']],
  ['device.unknown_vendor', 'Appareils', 'Appareil au fabricant inconnu', ['ip', 'mac']],
  ['device.iot', 'Appareils', 'Nouvel objet connecté', ['ip', 'name', 'vendor']],
  ['security.port_scan', 'Sécurité', 'Balayage de ports détecté', ['ip', 'ports']],
  ['security.arp_spoof', 'Sécurité', 'Usurpation ARP soupçonnée', ['ip', 'mac']],
  ['security.brute_force', 'Sécurité', 'Tentative de force brute', ['ip', 'service']],
  ['security.cve_match', 'Sécurité', 'CVE correspondant à un appareil', ['ip', 'cve', 'cvss']],
  ['security.cve_critical', 'Sécurité', 'CVE critique (CVSS ≥ 9,0)', ['ip', 'cve', 'cvss']],
  ['security.malware', 'Sécurité', 'Indice de logiciel malveillant', ['ip', 'indicator']],
  ['security.foreign_dns', 'Sécurité', 'Appareil utilisant un DNS étranger', ['ip', 'dns']],
  ['security.tor', 'Sécurité', 'Trafic de sortie Tor', ['ip']],
  ['defense.ban_success', 'Défense', 'Appareil bloqué', ['ip', 'name', 'reason']],
  ['defense.ban_failed', 'Défense', 'Blocage en échec', ['ip', 'error']],
  ['defense.quarantine_success', 'Défense', 'Appareil isolé', ['ip', 'name', 'reason']],
  ['defense.unban', 'Défense', 'Blocage levé', ['ip', 'name']],
  ['defense.rule_triggered', 'Défense', 'Règle automatique déclenchée', ['rule', 'ip']],
  ['network.new_link', 'Réseau', 'Nouveau lien découvert', ['from', 'to', 'type']],
  ['network.vlan_change', 'Réseau', 'Appareil changé de VLAN', ['ip', 'oldVlan', 'newVlan']],
  ['network.gateway_change', 'Réseau', 'Passerelle par défaut changée', ['oldGw', 'newGw']],
  ['network.dhcp_starvation', 'Réseau', 'Épuisement DHCP', ['count']],
  ['network.broadcast_storm', 'Réseau', 'Tempête de diffusion', ['pps']],
  ['ssh.exec_success', 'SSH', 'Commande SSH exécutée', ['device', 'cmd']],
  ['ssh.exec_failure', 'SSH', 'Commande SSH en échec', ['device', 'cmd', 'error']],
  ['ssh.unauthorized', 'SSH', 'Tentative SSH non autorisée', ['host', 'user']],
  ['ssh.connection_lost', 'SSH', 'Liaison SSH perdue', ['device']],
  ['host.cpu_high', 'Supervision', 'Processeur de l’hôte au-dessus du seuil', ['pct']],
  ['host.mem_high', 'Supervision', 'Mémoire de l’hôte au-dessus du seuil', ['pct']],
  ['host.disk_full', 'Supervision', 'Disque de l’hôte au-delà de 90 %', ['pct']],
  ['host.temp_high', 'Supervision', 'Température de l’hôte élevée', ['c']],
  ['host.container_down', 'Supervision', 'Conteneur Docker arrêté', ['name', 'image']],
  ['host.network_spike', 'Supervision', 'Pic de débit réseau', ['rxKBs', 'txKBs']],
  ['scan.complete', 'Balayages', 'Balayage terminé', ['devices', 'duration']],
  ['scan.failed', 'Balayages', 'Balayage en échec', ['error']],
  ['scan.deep_complete', 'Balayages', 'Balayage approfondi terminé', ['ip', 'ports']],
  ['system.boot', 'Système', 'MapMyLAN a démarré', ['version']],
  ['system.error', 'Système', 'Erreur système journalisée', ['msg']],
  ['system.update_available', 'Système', 'Mise à jour disponible', ['version']],
  ['system.backup', 'Système', 'Sauvegarde terminée', ['size']],
  ['user.login', 'Comptes', 'Connexion d’un administrateur', ['username', 'ip']],
  ['user.login_failed', 'Comptes', 'Échec de connexion', ['username', 'ip']],
  ['user.password_changed', 'Comptes', 'Mot de passe changé', ['username']],
  ['user.notif_test', 'Comptes', 'Notification d’essai envoyée', ['channel']],
  ['schedule.daily', 'Planning', 'Heure du rapport quotidien', ['date']],
  ['schedule.weekly', 'Planning', 'Heure du rapport hebdomadaire', ['week']],
  ['manual', 'Manuel', 'Déclenché à la main (bouton)', []],
].map(([id, category, label, vars]) => ({ id, category, label, vars }));
export const IDS_DECLENCHEURS = new Set(DECLENCHEURS.map(d => d.id));

export const ACTIONS = [
  { kind: 'notify', label: 'Envoyer une notification', needs: ['channels'] },
  { kind: 'log', label: 'Écrire au journal', needs: [] },
  { kind: 'quarantine', label: 'Isoler l’appareil', needs: [] },
  { kind: 'ban', label: 'Bloquer l’appareil', needs: ['reason?'] },
  { kind: 'exec_ssh', label: 'Lancer une commande SSH', needs: ['deviceId', 'cmd'] },
];

// Les variables d'un événement viennent en partie du réseau (noms annoncés) :
// elles sont rendues en texte, jamais interprétées.
export function rendre(gabarit, vars) {
  if (!gabarit) return JSON.stringify(vars).slice(0, 2000);
  return gabarit.replace(/\{\{(\w+)\}\}/g, (_, k) => String(vars[k] ?? '').slice(0, 300));
}

export function passeFiltre(f, vars) {
  if (!f || typeof f !== 'object') return true;
  if (f.minScore != null && (vars.score == null || vars.score < f.minScore)) return false;
  if (f.minCvss != null && (vars.cvss == null || vars.cvss < f.minCvss)) return false;
  if (f.minPct != null && (vars.pct == null || vars.pct < f.minPct)) return false;
  if (f.deviceType && vars.type && f.deviceType !== vars.type) return false;
  if (f.severity && vars.severity && f.severity !== vars.severity) return false;
  if (f.contains && !JSON.stringify(vars).toLowerCase().includes(String(f.contains).toLowerCase())) return false;
  return true;
}

export class Commandes {
  constructor(s) { this.s = s; }

  // Asynchrone et sans lever : un événement n'attend pas ses commandes.
  declencher(id, vars = {}) {
    this.executer(id, vars).catch(e => this.s.evts.journaliser('warn', 'command', `Déclencheur ${id} : ${e.message}`));
  }

  // seule : une commande précise, déclenchée à la main par un administrateur
  // (ni l'état actif ni le délai entre deux déclenchements ne la retiennent).
  async executer(id, vars = {}, { seule = null } = {}) {
    const { db, evts, notifications } = this.s;
    const liste = seule ? db.prepare('SELECT * FROM commandes WHERE id = ?').all(seule) : db.prepare('SELECT * FROM commandes WHERE trigger = ? AND enabled = 1').all(id);
    for (const cmd of liste) {
      if (!seule && cmd.cooldownSec > 0 && cmd.lastFired && (Date.now() - cmd.lastFired) / 1000 < cmd.cooldownSec) continue;
      let filtre = null, actions = [];
      try { filtre = cmd.filter ? JSON.parse(cmd.filter) : null; actions = JSON.parse(cmd.actions); } catch { continue; }
      if (!passeFiltre(filtre, vars)) continue;
      const message = rendre(cmd.template || `[{{trigger}}] ${id} : ${JSON.stringify(vars).slice(0, 1000)}`, { trigger: id, ...vars });
      for (const a of Array.isArray(actions) ? actions : []) {
        try {
          if (a.kind === 'notify') {
            for (const canal of a.channels || []) {
              if (canal === 'telegram') await notifications.telegram(message.replace(/[&<>"]/g, c => `&#${c.charCodeAt(0)};`));
              else if (canal === 'email') await notifications.courriel({ sujet: `[${id}] ${cmd.name}`, titre: cmd.name, gravite: 'info', corps: message });
              else if (canal === 'billetterie') await notifications.diffuser('medium', cmd.name, message, null, { evenement: 'risque_eleve', ip: vars.ip, hote: vars.name || vars.hostname });
            }
          } else if (a.kind === 'log') {
            evts.journaliser(['info', 'warn', 'error', 'success'].includes(a.level) ? a.level : 'info', 'command', `[${cmd.name}] ${message}`);
          } else if (a.kind === 'quarantine' && vars.deviceId) {
            await this.s.defense.isoler(vars.deviceId, { raison: `commande : ${cmd.name}` });
          } else if (a.kind === 'ban' && vars.deviceId) {
            await this.s.defense.bloquer(vars.deviceId, { raison: a.reason || `commande : ${cmd.name}` });
          } else if (a.kind === 'exec_ssh' && a.deviceId && a.cmd) {
            await this.s.consoles.executer(a.deviceId, gardeCommande(a.cmd));
          }
        } catch (e) {
          evts.journaliser('warn', 'command', `Action « ${a.kind} » de « ${cmd.name} » en échec : ${String(e.message).slice(0, 160)}`);
        }
      }
      db.prepare('UPDATE commandes SET lastFired = ?, fireCount = fireCount + 1 WHERE id = ?').run(Date.now(), cmd.id);
    }
  }
}
