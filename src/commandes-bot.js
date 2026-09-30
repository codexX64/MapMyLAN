// Commandes du bot Telegram : « /alerte », « /scan »… associées à une action
// côté serveur. Fermées par défaut : sans liste propre à la commande, seule
// la discussion principale (celle du canal Telegram) est obéie. Les
// commandes destructrices peuvent exiger une confirmation « OUI ».
import { echapperHtml as h } from './notifications.js';
import { gardeCommande } from './consoles.js';
import { estIPv4 } from './cibles.js';

export const ACTIONS_BOT = [
  ['status', 'Résumé de l’état du réseau', [], false],
  ['network', 'Appareils les plus exposés', [], false],
  ['alerts', 'Alertes récentes', [], false],
  ['list_suspects', 'Appareils suspects (danger > 60)', [], false],
  ['list_offline', 'Appareils hors ligne', [], false],
  ['list_iot', 'Objets connectés', [], false],
  ['device_info', 'Fiche d’un appareil par son adresse', [{ name: 'ip', from: 'arg1' }], false],
  ['scan_now', 'Lancer un balayage complet', [], false],
  ['lockdown', 'Bloquer tout appareil hors liste blanche', [], true],
  ['unlock_all', 'Débloquer tous les appareils bloqués', [], true],
  ['ban_ip', 'Bloquer un appareil par son adresse', [{ name: 'ip', from: 'arg1' }], true],
  ['unban_ip', 'Débloquer un appareil par son adresse', [{ name: 'ip', from: 'arg1' }], true],
  ['quarantine_ip', 'Isoler un appareil par son adresse', [{ name: 'ip', from: 'arg1' }], true],
  ['exec_ssh', 'Lancer une commande SSH sur un équipement enregistré', [{ name: 'deviceId', required: true, fromConfig: true }, { name: 'cmd', required: true, fromConfig: true }], true],
  ['send_message', 'Répondre un message fixe', [{ name: 'text', fromConfig: true }], false],
  ['topology_summary', 'Résumé de la carte', [], false],
].map(([id, label, params, destructive]) => ({ id, label, params, destructive }));
export const IDS_ACTIONS_BOT = new Set(ACTIONS_BOT.map(a => a.id));
const DESTRUCTRICES = new Set(ACTIONS_BOT.filter(a => a.destructive).map(a => a.id));

const CONFIRMATION_MS = 30_000;

export class CommandesBot {
  constructor(s) { this.s = s; this.attentes = new Map(); }

  ligneAppareil(d) {
    return `• <code>${h(d.ip)}</code> — ${h(d.hostname || d.customName || '?')}${d.vendor ? ` (${h(d.vendor)})` : ''} — danger ${d.dangerScore}/100`;
  }

  appareilParIp(ip) { return estIPv4(ip) ? this.s.db.prepare('SELECT * FROM appareils WHERE ip = ? ORDER BY lastSeen DESC LIMIT 1').get(ip) : null; }

  // Un refus du bot compte avec les autres refus d'accès (vigie).
  refuser(commande, discussion) {
    this.s.journal.rare(`bot:${discussion}:${commande}`, { action: 'acces.refuse', objet: commande.slice(0, 40), resultat: 'refus', details: { discussion: String(discussion).slice(0, 40) } });
  }

  async action(id, params, { discussion, args = [] }) {
    const { db, defense } = this.s;
    // Une action sur le réseau venue de Telegram laisse sa trace au journal
    // chaîné ; celle lancée depuis l'interface y est déjà, avec son compte.
    if (DESTRUCTRICES.has(id) && discussion !== 'interface') {
      this.s.journal.ecrire({
        action: 'bot.action', objet: id,
        details: { discussion: String(discussion).slice(0, 40), ...(args[0] ? { cible: String(args[0]).slice(0, 45) } : {}), ...(params?.deviceId ? { equipement: params.deviceId } : {}) },
      });
    }
    const compte = sql => db.prepare(sql).get().n;
    const ipDe = () => args[0] || params?.ip;
    switch (id) {
      case 'status':
        return `<b>État du réseau</b>\n• Appareils : <b>${compte("SELECT COUNT(*) n FROM appareils WHERE status = 'online'")}</b>/${compte('SELECT COUNT(*) n FROM appareils')} en ligne\n• Suspects : <b>${compte("SELECT COUNT(*) n FROM appareils WHERE status = 'suspect'")}</b>\n• Bloqués : <b>${compte("SELECT COUNT(*) n FROM appareils WHERE status = 'banned'")}</b>\n• Alertes ouvertes : <b>${compte('SELECT COUNT(*) n FROM alertes WHERE acknowledged = 0')}</b>`;
      case 'network': {
        const l = db.prepare("SELECT * FROM appareils WHERE status != 'offline' ORDER BY dangerScore DESC LIMIT 5").all();
        return l.length ? '<b>Les plus exposés :</b>\n' + l.map(d => this.ligneAppareil(d)).join('\n') : 'Aucun appareil actif.';
      }
      case 'alerts': {
        const l = db.prepare('SELECT * FROM alertes WHERE acknowledged = 0 ORDER BY createdAt DESC LIMIT 8').all();
        return l.length ? '<b>Alertes récentes :</b>\n' + l.map(a => `[<b>${h(a.severity)}</b>] ${h(a.message)}`).join('\n') : 'Aucune alerte ouverte.';
      }
      case 'list_suspects': {
        const l = db.prepare("SELECT * FROM appareils WHERE dangerScore >= 60 AND status != 'offline' ORDER BY dangerScore DESC LIMIT 15").all();
        return l.length ? '<b>Appareils suspects :</b>\n' + l.map(d => this.ligneAppareil(d)).join('\n') : 'Aucun appareil suspect.';
      }
      case 'list_offline': {
        const l = db.prepare("SELECT * FROM appareils WHERE status = 'offline' ORDER BY lastSeen DESC LIMIT 20").all();
        return l.length ? '<b>Hors ligne :</b>\n' + l.map(d => `• <code>${h(d.ip)}</code> — ${h(d.hostname || '?')}`).join('\n') : 'Tous les appareils sont en ligne.';
      }
      case 'list_iot': {
        const l = db.prepare("SELECT * FROM appareils WHERE type = 'iot' OR customType = 'iot' LIMIT 20").all();
        return l.length ? '<b>Objets connectés :</b>\n' + l.map(d => this.ligneAppareil(d)).join('\n') : 'Aucun objet connecté connu.';
      }
      case 'device_info': {
        const d = this.appareilParIp(ipDe());
        if (!d) return `Aucun appareil à l’adresse ${h(ipDe() || '?')}.`;
        return `<b>${h(d.customName || d.hostname || d.ip)}</b>\n• IP : <code>${h(d.ip)}</code>\n• MAC : <code>${h(d.mac || '?')}</code>\n• Fabricant : ${h(d.vendor || 'inconnu')}\n• Type : ${h(d.customType || d.type)}\n• État : ${h(d.status)}\n• Danger : ${d.dangerScore}/100`;
      }
      case 'scan_now':
        this.s.scanner.toutBalayer().catch(() => {
          // L'échec est déjà au journal de service (balayerUne) ; le bot a répondu.
        });
        return 'Balayage lancé.';
      case 'lockdown': {
        let ok = 0, echecs = 0;
        for (const d of db.prepare("SELECT id FROM appareils WHERE status != 'banned' AND whitelisted = 0 AND isMainRouter = 0").all()) {
          try { await defense.bloquer(d.id, { manuel: true, raison: 'verrouillage par le bot' }); ok++; } catch { echecs++; }
        }
        this.s.evts.journaliser('warn', 'bot', `Verrouillage demandé par le bot : ${ok} bloqué(s), ${echecs} échec(s)`);
        return `<b>Verrouillage terminé</b>\n• Bloqués : ${ok}\n• Échecs : ${echecs}`;
      }
      case 'unlock_all': {
        let ok = 0, echecs = 0;
        for (const d of db.prepare("SELECT id FROM appareils WHERE status = 'banned'").all()) {
          try { await defense.liberer(d.id); ok++; } catch { echecs++; }
        }
        return `<b>Déblocage terminé</b>\n• Débloqués : ${ok}\n• Échecs : ${echecs}`;
      }
      case 'ban_ip': case 'unban_ip': case 'quarantine_ip': {
        const d = this.appareilParIp(ipDe());
        if (!d) return `Aucun appareil à l’adresse ${h(ipDe() || '?')}.`;
        try {
          if (id === 'ban_ip') await defense.bloquer(d.id, { manuel: true, raison: 'bot' });
          else if (id === 'unban_ip') await defense.liberer(d.id);
          else await defense.isoler(d.id, { manuel: true, raison: 'bot' });
        } catch (e) { return `Échec : ${h(e.message)}`; }
        return { ban_ip: 'Bloqué', unban_ip: 'Débloqué', quarantine_ip: 'Isolé' }[id] + ` : <code>${h(d.ip)}</code>.`;
      }
      case 'exec_ssh': {
        if (!params?.deviceId || !params?.cmd) return 'Cette commande n’est pas complète (équipement ou commande manquant).';
        try {
          const r = await this.s.consoles.executer(params.deviceId, gardeCommande(params.cmd));
          return `<b>SSH</b>\n<pre>${h((r.stdout || r.stderr || '(aucune sortie)').slice(0, 600))}</pre>`;
        } catch (e) { return `SSH en échec : ${h(e.message)}`; }
      }
      case 'send_message': return h(params?.text || '(vide)');
      case 'topology_summary':
        return `<b>Carte</b>\n• ${compte('SELECT COUNT(*) n FROM appareils')} appareils\n• ${compte('SELECT COUNT(*) n FROM liens')} liens\n• ${compte('SELECT COUNT(*) n FROM zones')} zones`;
      default: return `Action inconnue : ${h(id)}`;
    }
  }

  discussionPrincipale() { return String(this.s.notifications.config('telegram')?.chatId || ''); }

  async executer(cmd, args, discussion) {
    this.s.db.prepare('UPDATE commandes_bot SET lastFiredAt = ?, lastFiredBy = ?, fireCount = fireCount + 1 WHERE id = ?').run(Date.now(), String(discussion).slice(0, 40), cmd.id);
    this.s.evts.journaliser('info', 'bot', `${cmd.trigger} exécutée → ${cmd.action}`);
    let params = null;
    try { params = cmd.params ? JSON.parse(cmd.params) : null; } catch { params = null; }
    try { return await this.action(cmd.action, params, { discussion, args }); } catch (e) { return `Erreur : ${h(e.message)}`; }
  }

  // Un message reçu : la réponse à renvoyer, ou null s'il ne concerne pas le bot.
  async message(texte, discussion) {
    const t = texte.trim();
    if (!t) return null;
    const attente = this.attentes.get(discussion);
    if (attente && attente.expire > Date.now()) {
      if (/^(y|yes|oui|confirm)$/i.test(t)) {
        this.attentes.delete(discussion);
        const cmd = this.s.db.prepare('SELECT * FROM commandes_bot WHERE id = ?').get(attente.id);
        return cmd ? this.executer(cmd, attente.args, discussion) : 'Cette commande n’existe plus.';
      }
      if (/^(n|no|non|annule|cancel)$/i.test(t)) { this.attentes.delete(discussion); return 'Annulé.'; }
    }
    const principale = this.discussionPrincipale();
    const estPrincipale = !!principale && principale === discussion;
    // La liste des commandes dit ce que le bot sait faire sur le réseau : elle
    // ne se donne qu'à la discussion principale.
    if (/^\/(help|start|aide)\b/i.test(t)) {
      if (!estPrincipale) {
        this.s.evts.journaliser('warn', 'bot', 'Aide demandée depuis une discussion inconnue.');
        this.refuser(t.split(/\s+/)[0], discussion);
        return 'Non autorisé.';
      }
      const liste = this.s.db.prepare('SELECT trigger, description, action, confirm FROM commandes_bot WHERE enabled = 1 ORDER BY trigger').all();
      return '<b>Bot MapMyLAN</b>\n\nCommandes intégrées :\n/status /network /alerts /scan\n/ban &lt;ip&gt; /unban &lt;ip&gt; /quarantine &lt;ip&gt;\n/device &lt;ip&gt;\n'
        + (liste.length ? '\n<b>Tes commandes :</b>\n' + liste.map(c => `${h(c.trigger)}${c.confirm ? ' (confirmation)' : ''} — ${h(c.description || c.action)}`).join('\n') : '')
        + '\n\nUne commande destructrice demande de répondre OUI.';
    }
    const [tete, ...args] = t.split(/\s+/);
    const declencheur = tete.toLowerCase();
    const cmd = this.s.db.prepare('SELECT * FROM commandes_bot WHERE trigger = ? AND enabled = 1').get(declencheur);
    if (cmd) {
      let permises = [];
      try { permises = JSON.parse(cmd.allowedChatIds || '[]').map(String); } catch { permises = []; }
      if (!(permises.length ? permises : [principale].filter(Boolean)).includes(discussion)) {
        this.s.evts.journaliser('warn', 'bot', `${cmd.trigger} refusée à une discussion non autorisée.`);
        this.refuser(cmd.trigger, discussion);
        return 'Non autorisé.';
      }
      if (cmd.cooldownSec > 0 && cmd.lastFiredAt && (Date.now() - cmd.lastFiredAt) / 1000 < cmd.cooldownSec) return `Patience : réessaie dans ${Math.ceil(cmd.cooldownSec - (Date.now() - cmd.lastFiredAt) / 1000)} s.`;
      if (cmd.confirm) {
        this.attentes.set(discussion, { id: cmd.id, args: args.slice(0, 5), expire: Date.now() + CONFIRMATION_MS });
        return `<b>${h(cmd.trigger)}</b> — ${h(cmd.description || cmd.action)}\n\nRéponds <b>OUI</b> dans les 30 s pour confirmer, ou <b>NON</b>.`;
      }
      return this.executer(cmd, args.slice(0, 5), discussion);
    }
    // Commandes intégrées : la discussion principale seulement.
    if (!estPrincipale) return null;
    const INTEGREES = { '/status': 'status', '/network': 'network', '/alerts': 'alerts', '/scan': 'scan_now', '/device': 'device_info', '/score': 'device_info', '/ban': 'ban_ip', '/unban': 'unban_ip', '/quarantine': 'quarantine_ip' };
    const action = INTEGREES[declencheur];
    return action ? this.action(action, null, { discussion, args: args.slice(0, 5) }) : null;
  }
}
