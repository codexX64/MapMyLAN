// Canaux de notification : Telegram (avec les commandes du bot), courriel,
// billetterie (tickets structurés), et le relais d'envoi « Poste ».
//
// La configuration d'un canal est scellée par le coffre du socle ; ses
// secrets (jeton du bot, mot de passe SMTP, clé de billetterie) ne ressortent
// jamais vers le navigateur. Le SMS de la 1.4.1 est retiré : le manuel
// l'interdit comme canal (REQ-AUTH-009).
import { ErreurHttp } from '../socle/src/index.js';
import { nouvelId } from './db.js';
import { iso } from './formes.js';
import { envoyerCourriel } from './courriel.js';
import { construireTicket, envoyerApi, marquer, rendreLisible, EVENEMENTS } from './ticket.js';

export const CANAUX = ['telegram', 'email', 'billetterie'];
// Les champs secrets de chaque canal : jamais rendus, gardés s'ils sont omis.
export const SECRETS = { telegram: ['token'], email: ['password'], billetterie: ['cle'] };
export const JETON_BOT = /^\d{5,15}:[A-Za-z0-9_-]{30,50}$/;
export const DISCUSSION = /^-?\d{1,20}$/;
const GRAVITES = ['critical', 'high', 'medium', 'low', 'info'];
const RANG_URGENCE = { p1: 1, p2: 2, p3: 3, p4: 4 };

export const echapperHtml = t => String(t ?? '').replace(/[&<>"]/g, c => `&#${c.charCodeAt(0)};`);

export class Notifications {
  constructor(s) {
    this.s = s;
    this.bot = { actif: false, decalage: 0, arret: null };
    // L'API Telegram ; les essais la remplacent par un faux serveur local.
    this.telegramBase = s.options.telegramBase || 'https://api.telegram.org';
  }

  ligne(canal) { return this.s.db.prepare('SELECT * FROM canaux WHERE channel = ?').get(canal) || null; }

  config(canal, { memeEteint = false } = {}) {
    const l = this.ligne(canal);
    if (!l || !l.configEnc || (!l.enabled && !memeEteint)) return null;
    try { return JSON.parse(this.s.coffre.ouvre('canal', l.configEnc, canal)); } catch { return null; }
  }

  lister() {
    return this.s.db.prepare('SELECT channel, enabled, lastTested, lastSuccess FROM canaux ORDER BY channel').all()
      .map(c => ({ channel: c.channel, enabled: c.enabled === 1, lastTested: iso(c.lastTested), lastSuccess: iso(c.lastSuccess) }));
  }

  // Pour l'écran d'édition : les champs en clair, et la présence des secrets.
  public(canal) {
    const l = this.ligne(canal);
    const c = this.config(canal, { memeEteint: true }) || {};
    const secrets = {};
    for (const k of SECRETS[canal]) { if (c[k]) secrets[k] = true; delete c[k]; }
    return { channel: canal, enabled: l?.enabled === 1, config: c, secrets };
  }

  // Un secret omis garde la valeur en place.
  fusionner(canal, config = {}) {
    const avant = this.config(canal, { memeEteint: true }) || {};
    const net = { ...config };
    for (const k of SECRETS[canal]) if (!net[k] && avant[k]) net[k] = avant[k];
    return net;
  }

  enregistrer(canal, enabled, config) {
    const net = config ? this.fusionner(canal, config) : this.config(canal, { memeEteint: true });
    if (enabled) this.verifier(canal, net || {});
    const scelle = net ? this.s.coffre.scelle('canal', JSON.stringify(net), canal) : null;
    this.s.db.prepare(`INSERT INTO canaux(id, channel, enabled, configEnc) VALUES(?,?,?,?)
      ON CONFLICT(channel) DO UPDATE SET enabled = excluded.enabled, configEnc = excluded.configEnc`).run(nouvelId(), canal, enabled ? 1 : 0, scelle);
    if (canal === 'telegram') { if (enabled) this.demarrerBot(); else this.arreterBot(); }
  }

  supprimer(canal) {
    this.s.db.prepare('DELETE FROM canaux WHERE channel = ?').run(canal);
    if (canal === 'telegram') this.arreterBot();
  }

  verifier(canal, c) {
    const faux = m => { throw new ErreurHttp(400, m); };
    if (canal === 'telegram') {
      if (!JETON_BOT.test(c.token || '')) faux('Jeton du bot Telegram invalide.');
      if (!DISCUSSION.test(String(c.chatId || ''))) faux('Identifiant de discussion Telegram invalide.');
    } else if (canal === 'email') {
      if (!c.address || !c.password) faux('Adresse et mot de passe du compte SMTP requis.');
      if (!c.provider && !c.host) faux('Relais SMTP : un fournisseur ou un hôte.');
    } else if (canal === 'billetterie') {
      if (!c.url) faux('Adresse de l’API de billetterie requise.');
    }
  }

  noter(canal, ok) {
    const t = Date.now();
    this.s.db.prepare(`UPDATE canaux SET lastTested = ?${ok ? ', lastSuccess = ?' : ''} WHERE channel = ?`).run(...(ok ? [t, t] : [t]), canal);
  }

  async telegram(texte, config = null) {
    const c = config || this.config('telegram');
    if (!c || !JETON_BOT.test(c.token || '') || !DISCUSSION.test(String(c.chatId || ''))) return { ok: false, error: 'Telegram n’est pas configuré.' };
    return this.envoyerTelegram(c.token, c.chatId, texte);
  }

  async envoyerTelegram(jeton, discussion, texte) {
    try {
      const r = await fetch(`${this.telegramBase}/bot${jeton}/sendMessage`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(12_000),
        body: JSON.stringify({ chat_id: discussion, text: String(texte).slice(0, 4000), parse_mode: 'HTML', disable_web_page_preview: true }),
      });
      const j = await r.json().catch(() => ({}));
      if (!j.ok) return { ok: false, error: String(j.description || `Telegram : HTTP ${r.status}`).slice(0, 200) };
      return { ok: true };
    } catch (e) { return { ok: false, error: `Telegram injoignable : ${e.name === 'TimeoutError' ? 'délai dépassé' : e.message}` }; }
  }

  async courriel({ sujet, titre, gravite, corps, details }, config = null) {
    const c = config || this.config('email');
    if (!c?.address || !c?.password) return { ok: false, error: 'Le courriel n’est pas configuré.' };
    const texte = [`[${String(gravite).toUpperCase()}] ${titre}`, '', corps, ...(details ? ['', ...Object.entries(details).map(([k, v]) => `${k} : ${v}`)] : []), '', `MapMyLAN · ${new Date().toISOString()}`].join('\n');
    try {
      await envoyerCourriel({ config: c, sortie: this.s.sortie, a: c.to || c.address, sujet, texte });
      return { ok: true };
    } catch (e) { return { ok: false, error: String(e.message).slice(0, 200) }; }
  }

  async billetterie(ticket, config = null) {
    const c = config || this.config('billetterie');
    if (!c?.url) return { ok: false, error: 'La billetterie n’est pas configurée.' };
    const r = await envoyerApi(this.s.sortie, marquer(ticket, c.marqueur), { url: c.url, cle: c.cle, entete: c.entete });
    return r.ok ? { ok: true, ref: r.ref } : { ok: false, error: r.erreur };
  }

  // Une alerte vers les canaux actifs. critical et high partent sur Telegram
  // et par courriel ; la billetterie reçoit ce qui passe son seuil ; le
  // relais Poste reçoit tout, avec un objet stable pour le regroupement.
  async diffuser(gravite, titre, corps, details = null, contexte = {}) {
    const g = GRAVITES.includes(String(gravite).toLowerCase()) ? String(gravite).toLowerCase() : 'medium';
    const envois = [];
    // envoyer ne lève pas ; le filet évite qu'un rejet imprévu n'arrête le processus.
    this.s.poste.envoyer({ objet: titre, corps, machine: details?.IP || details?.ip, details }).catch(e => this.s.evts.journaliser('warn', 'poste', String(e.message).slice(0, 160)));
    const bill = this.config('billetterie');
    if (bill) {
      const ev = EVENEMENTS.includes(contexte.evenement) ? contexte.evenement : 'risque_eleve';
      const t = construireTicket(ev, { ...contexte, description: corps }, { systeme: 'mapmylan', baseUrl: this.s.cfg.serviceUi });
      if (!bill.seuil || RANG_URGENCE[t.urgence] <= RANG_URGENCE[bill.seuil]) envois.push(this.billetterie(t, bill).then(r => { this.noter('billetterie', r.ok); return r; }));
    }
    if (g === 'critical' || g === 'high') {
      const lignes = details ? '\n\n' + Object.entries(details).map(([k, v]) => `<code>${echapperHtml(k)}</code> : ${echapperHtml(v)}`).join('\n') : '';
      envois.push(this.telegram(`<b>[${echapperHtml(g.toUpperCase())}]</b> ${echapperHtml(titre)}\n${echapperHtml(corps)}${lignes}`).then(r => { if (this.ligne('telegram')) this.noter('telegram', r.ok); return r; }));
      envois.push(this.courriel({ sujet: `MapMyLAN — ${titre}`, titre, gravite: g, corps, details }).then(r => { if (this.ligne('email')) this.noter('email', r.ok); return r; }));
    }
    const resultats = await Promise.all(envois);
    for (const r of resultats) if (!r.ok && !/n’est pas configuré/.test(r.error || '')) this.s.evts.journaliser('warn', 'notifier', r.error);
    return resultats;
  }

  async essayer(canal, config) {
    const c = config ? this.fusionner(canal, config) : this.config(canal, { memeEteint: true });
    if (!c) return { ok: false, error: 'Canal non configuré.' };
    this.verifier(canal, c);
    let r;
    if (canal === 'telegram') r = await this.telegram('MapMyLAN : message d’essai. Si tu le lis, le canal fonctionne.', c);
    else if (canal === 'email') r = await this.courriel({ sujet: 'MapMyLAN — essai', titre: 'Message d’essai', gravite: 'info', corps: 'Si ce message est arrivé, le relais SMTP fonctionne.' }, c);
    else {
      const t = construireTicket('resume', { hotes: 0, alertes: 0, description: 'Ticket d’essai envoyé depuis MapMyLAN.' }, { systeme: 'mapmylan' });
      r = await this.billetterie(t, c);
    }
    if (this.ligne(canal)) this.noter(canal, r.ok);
    this.s.commandes.declencher('user.notif_test', { channel: canal });
    return r;
  }

  // La relève du bot est une tâche de fond : sans planificateur (planifier:
  // false), elle ne démarre pas davantage quand on enregistre le canal.
  demarrerBot() {
    if (this.s.options.planifier === false || this.bot.actif || !this.config('telegram')) return;
    this.bot.actif = true;
    this.bot.arret = new AbortController();
    const signal = this.bot.arret.signal;
    const boucle = async () => {
      while (this.bot.actif && !signal.aborted) {
        const c = this.config('telegram');
        if (!c || !JETON_BOT.test(c.token || '')) { this.bot.actif = false; break; }
        try {
          const r = await fetch(`${this.telegramBase}/bot${c.token}/getUpdates?offset=${this.bot.decalage}&timeout=20`, { signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]) });
          const j = await r.json();
          for (const maj of Array.isArray(j?.result) ? j.result : []) {
            this.bot.decalage = Number(maj.update_id) + 1;
            const m = maj.message;
            if (!m?.text || m.chat?.id === undefined) continue;
            const reponse = await this.s.bot.message(String(m.text).slice(0, 500), String(m.chat.id));
            if (reponse) await this.envoyerTelegram(c.token, m.chat.id, reponse);
          }
        } catch (e) {
          if (signal.aborted) break;
          this.s.evts.journaliser('warn', 'telegram', `Relève du bot en échec : ${String(e.message).slice(0, 120)}`);
          await new Promise(r => setTimeout(r, 5000).unref());
        }
      }
    };
    boucle();
    this.s.evts.journaliser('info', 'telegram', 'Le bot écoute les commandes.');
  }

  arreterBot() { this.bot.actif = false; this.bot.arret?.abort(); }
}
