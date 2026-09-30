// Ce que MapMyLAN raconte à SYNAPSE, au fil de l'eau : chaque alerte, chaque
// balayage dont le résultat change, et toutes les heures un bilan du réseau
// s'il a bougé. Les envois passent par une file bornée : SYNAPSE lent ou
// absent ne ralentit jamais MapMyLAN, et rien ne se perd tant que la file tient.
const FILE_MAX = 500, LOT = 50;
const GRAVITE = { critical: 'critique', high: 'élevée', medium: 'moyenne', low: 'faible', info: 'info' };

// Les étiquettes qu'une alerte demande de transmettre : courtes, sûres, quatre au plus.
export function etiquettesDe(meta) {
  const l = Array.isArray(meta?.etiquettes) ? meta.etiquettes : [];
  return l.map(x => String(x).toLowerCase()).filter(x => /^[a-z0-9][a-z0-9-]{0,23}$/.test(x)).slice(0, 4);
}

export function depuisAlerte(a) {
  return {
    kind: /^(critical|high)$/.test(a.severity) ? 'incident.network' : 'network.alert',
    title: String(a.message).slice(0, 280),
    body: `Alerte MapMyLAN, gravité ${GRAVITE[a.severity] || a.severity}${a.deviceIp ? `, appareil ${a.deviceIp}` : ''}. Origine : ${a.source}.`,
    ref: a.id ? `alerte:${a.id}` : undefined,
    tags: ['alerte', a.severity, ...etiquettesDe(a.metadata)],
    meta: { severity: a.severity, source: a.source, deviceIp: a.deviceIp || null, evenement: a.metadata?.evenement || null },
    occurred_at: a.createdAt ? new Date(a.createdAt).toISOString() : undefined,
  };
}

export class Memoire {
  constructor({ url, jeton, fetch: f = globalThis.fetch }) {
    this.url = url; this.jeton = jeton; this.fetch = f;
    this.file = []; this.attente = 5000; this.minuteur = null;
    this.etat = { envoyes: 0, echecs: 0, dernierEnvoi: null, erreur: null, perdus: 0 };
    this.dernierBalayage = null; this.dernierBilan = '';
  }

  get pret() { return !!(this.url && this.jeton); }

  public() { return { ...this.etat, enAttente: this.file.length, relie: this.pret }; }

  raconter(e) {
    if (!this.pret) return;
    this.file.push({ ...e, tags: [...new Set(['mapmylan', ...e.tags])], occurred_at: e.occurred_at || new Date().toISOString() });
    while (this.file.length > FILE_MAX) { this.file.shift(); this.etat.perdus++; }
    if (!this.minuteur) { this.minuteur = setTimeout(() => this.vider(), 2000); this.minuteur.unref(); }
  }

  async vider() {
    this.minuteur = null;
    if (!this.file.length) return;
    const lot = this.file.slice(0, LOT);
    try {
      const r = await this.fetch(`${this.url}/v1/ingest/batch`, {
        method: 'POST', signal: AbortSignal.timeout(15_000), redirect: 'error',
        headers: { authorization: `Bearer ${this.jeton}`, 'content-type': 'application/json' }, body: JSON.stringify({ events: lot }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      this.file.splice(0, lot.length);
      Object.assign(this.etat, { envoyes: this.etat.envoyes + lot.length, dernierEnvoi: new Date().toISOString(), erreur: null });
      this.attente = 5000;
    } catch (e) {
      this.etat.echecs++; this.etat.erreur = String(e.message).slice(0, 160);
      // SYNAPSE absent : on réessaie de moins en moins souvent.
      this.attente = Math.min(300_000, this.attente * 2);
    }
    if (this.file.length) { this.minuteur = setTimeout(() => this.vider(), this.etat.erreur ? this.attente : 500); this.minuteur.unref(); }
  }

  surAlerte(a) { this.raconter(depuisAlerte(a)); }

  // Un balayage qui trouve la même chose que le précédent n'apprend rien à personne.
  surBalayage({ hostsFound }) {
    if (hostsFound == null || hostsFound === this.dernierBalayage) return;
    const avant = this.dernierBalayage;
    this.dernierBalayage = hostsFound;
    this.raconter({ kind: 'network.scan', title: `Balayage du réseau : ${hostsFound} appareils trouvés${avant != null ? ` (${avant} au précédent)` : ''}`, tags: ['balayage'], meta: { hostsFound, avant, changed: true } });
  }

  surBilan(b) {
    if (b.empreinte === this.dernierBilan) return;
    this.dernierBilan = b.empreinte;
    this.raconter({ kind: 'network.snapshot', title: b.titre, body: b.corps, tags: ['bilan'], meta: { changed: true } });
  }

  arreter() { clearTimeout(this.minuteur); this.minuteur = null; }
}
