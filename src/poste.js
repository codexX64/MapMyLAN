// Envoi des alertes vers « Poste », un relais HTTP d'envoi de courrier.
//
// Aucun identifiant SMTP ici : une clé d'envoi à portée limitée, lue dans
// l'environnement (POSTE_SEND_KEY ou son _FILE), vers une adresse fixée par
// l'environnement (POSTE_URL, https). Sans elles, l'envoi est inactif et le
// reste continue. L'objet reste stable pour un même incident : le relais
// regroupe les alertes de même machine et même objet.
const DELAI_MS = 10_000;
const TENTATIVES = 2;
const ATTENTE_MS = 3000;

export class Poste {
  constructor({ cfg, evts, fetch: f = globalThis.fetch }) {
    this.url = cfg.posteUrl; this.de = cfg.posteDe; this.a = cfg.posteAlias || cfg.posteDe; this.cle = cfg.posteCle;
    this.evts = evts; this.fetch = f;
  }

  get actif() { return !!(this.url && this.de && this.cle); }

  corps({ corps, machine, details }) {
    const l = [];
    if (machine) l.push(`Machine : ${String(machine).slice(0, 80)}`);
    l.push('Service : MapMyLAN', `Horodatage : ${new Date().toISOString()}`, '', String(corps).trim());
    const utiles = Object.entries(details || {}).filter(([, v]) => v !== undefined && v !== '');
    if (utiles.length) l.push('', ...utiles.map(([k, v]) => `${k} : ${v}`));
    return l.join('\n');
  }

  // Ne lève jamais : un envoi raté n'interrompt pas la tâche en cours.
  async envoyer(alerte) {
    if (!this.actif) return { ok: false, error: 'POSTE_URL, POSTE_FROM ou POSTE_SEND_KEY absente.' };
    const charge = JSON.stringify({ from: this.de, to: this.a, subject: String(alerte.objet).replace(/[\r\n]+/g, ' ').slice(0, 200), text: this.corps(alerte) });
    let derniere = '';
    for (let essai = 1; essai <= TENTATIVES; essai++) {
      try {
        const rep = await this.fetch(this.url, { method: 'POST', headers: { 'x-poste-key': this.cle, 'content-type': 'application/json' }, body: charge, redirect: 'error', signal: AbortSignal.timeout(DELAI_MS) });
        const brut = (await rep.text()).slice(0, 2000);
        let j = null;
        try { j = JSON.parse(brut); } catch { /* réponse non JSON : rapportée telle quelle ci-dessous */ }
        if (rep.ok && j?.ok) return { ok: true, messageId: typeof j.messageId === 'string' ? j.messageId.slice(0, 100) : undefined };
        derniere = String(j?.error || brut || `HTTP ${rep.status}`).slice(0, 300);
      } catch (e) {
        derniere = e.name === 'TimeoutError' ? `délai de ${DELAI_MS} ms dépassé` : String(e.message).slice(0, 200);
      }
      if (essai < TENTATIVES) await new Promise(r => setTimeout(r, ATTENTE_MS).unref());
    }
    this.evts.journaliser('error', 'poste', derniere);
    return { ok: false, error: derniere };
  }

  essayer() {
    return this.envoyer({ objet: 'Test de la liaison Poste', corps: 'Message de vérification envoyé depuis MapMyLAN. Aucune action requise.', machine: 'mapmylan' });
  }
}
