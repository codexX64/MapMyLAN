// Les services que l'assistant appelle, tous facultatifs et fixés par
// l'environnement (IA_URL, VOX_URL, SYNAPSE_URL) : Ollama pour répondre, VOX
// pour entendre et parler, SYNAPSE pour ce que les services voisins savent.
// Sans eux, l'assistant répond quand même aux questions directes.
const CTX = 16384;
const MOTS_ARRET = /^\s*(stop|arr[êe]te(-toi)?|c'?est bon|c'?est tout|merci c'?est tout|laisse tomber|au revoir|bye|termin[ée])\s*[.!]*\s*$/i;

export class ErreurLiaison extends Error {
  constructor(message, status = 502) { super(message); this.status = status; }
}

// Un petit modèle qui boucle répète la même ligne : on garde la première
// occurrence et on coupe à la troisième.
export function dedoublonner(texte) {
  const vues = new Map(), out = [];
  for (const ligne of texte.split('\n')) {
    const cle = ligne.trim().toLowerCase().replace(/[\s*_`-]+/g, ' ').trim();
    if (!cle) { if (out.length && out.at(-1) !== '') out.push(''); continue; }
    const n = (vues.get(cle) || 0) + 1;
    vues.set(cle, n);
    if (n >= 3) break;
    if (n === 1) out.push(ligne);
  }
  return out.join('\n').trim();
}

// Ce qui se dit d'une réponse écrite : sans markdown, sans puces, en phrases.
export function aDire(texte, max = 600) {
  let t = String(texte || '')
    .replace(/\*\*([^*]+)\*\*/g, '$1').replace(/`([^`]+)`/g, '$1').replace(/^#+\s*/gm, '')
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}]/gu, '')
    .replace(/^\s*[-•*]\s+(.*)$/gm, (_m, x) => (/[.!?:]$/.test(x.trim()) ? x.trim() : x.trim() + '.'))
    .replace(/^\s*\d+[.)]\s+/gm, '').replace(/\s*\n+\s*/g, ' ').replace(/\s{2,}/g, ' ').trim();
  if (t.length > max) {
    const coupe = t.slice(0, max);
    const fin = Math.max(coupe.lastIndexOf('. '), coupe.lastIndexOf('! '), coupe.lastIndexOf('? '));
    t = fin > max * 0.4 ? coupe.slice(0, fin + 1) : coupe.replace(/\s+\S*$/, '') + '…';
  }
  return t;
}

export class Liaisons {
  constructor({ cfg, fetch: f = globalThis.fetch }) {
    this.cfg = cfg; this.fetch = f; this.voixMemo = null; this.signale = false;
  }

  get iaPrete() { return !!(this.cfg.iaUrl && this.cfg.iaModeleRetenu); }
  get modele() { return this.cfg.iaModeleRetenu; }
  get synapsePrete() { return !!(this.cfg.synapseUrl && this.cfg.synapseJeton); }
  get nomCerveau() { return /^cer_([a-z0-9][a-z0-9-]{1,30})_[0-9a-f]{64}$/.exec(this.cfg.synapseJeton || '')?.[1] || 'mapmylan'; }

  async discuter(messages, signal) {
    if (!this.iaPrete) throw new ErreurLiaison('Aucun modèle de langage relié à MapMyLAN.', 409);
    const delai = AbortSignal.timeout(120_000);
    let r;
    try {
      r = await this.fetch(`${this.cfg.iaUrl}/api/chat`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, redirect: 'error',
        signal: signal ? AbortSignal.any([signal, delai]) : delai,
        // Même fenêtre que les services voisins : Ollama recharge un modèle
        // dès qu'on lui demande une autre taille.
        body: JSON.stringify({ model: this.modele, messages, stream: false, think: false, keep_alive: '30m', options: { num_ctx: CTX, temperature: 0.3, repeat_penalty: 1.1, num_predict: 1800 } }),
      });
    } catch (e) {
      if (signal?.aborted) throw new ErreurLiaison('Réponse interrompue.', 499);
      throw new ErreurLiaison(e.name === 'TimeoutError' ? 'Le modèle n’a pas répondu en deux minutes.' : 'Le modèle de langage est injoignable.');
    }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new ErreurLiaison(`Le modèle a répondu une erreur (HTTP ${r.status}).`);
    let texte = dedoublonner(String(j.message?.content || '').trim()).slice(0, 12000);
    if (j.done_reason === 'length') texte += '\n\n*(Réponse coupée : demande la suite, ou une version plus courte.)*';
    return { texte, modele: this.modele };
  }

  entetesVox() { return this.cfg.voxJeton ? { authorization: `Bearer ${this.cfg.voxJeton}` } : {}; }

  async etatVoix() {
    if (!this.cfg.voxUrl) return { disponible: false, raison: 'VOX n’est pas relié à MapMyLAN : installe-le depuis le Hub, MapMyLAN est redéployé pour le trouver.' };
    if (!this.cfg.voxJeton) return { disponible: false, raison: 'VOX est relié sans son jeton : redéploie MapMyLAN depuis le Hub.' };
    if (this.voixMemo && Date.now() - this.voixMemo.t < 10_000) return this.voixMemo.etat;
    let etat;
    try {
      const r = await this.fetch(`${this.cfg.voxUrl}/health`, { signal: AbortSignal.timeout(3000), redirect: 'error' });
      etat = r.ok ? { disponible: true, raison: null } : { disponible: false, raison: `VOX répond HTTP ${r.status}.` };
    } catch { etat = { disponible: false, raison: 'VOX est injoignable.' }; }
    this.voixMemo = { t: Date.now(), etat };
    return etat;
  }

  async transcrire(audio) {
    if (!audio?.length) throw new ErreurLiaison('Audio vide.', 400);
    if (!this.cfg.voxUrl) throw new ErreurLiaison('VOX n’est pas relié à MapMyLAN.', 409);
    let r;
    try { r = await this.fetch(`${this.cfg.voxUrl}/v1/transcrire`, { method: 'POST', redirect: 'error', headers: { ...this.entetesVox(), 'content-type': 'audio/wav' }, body: audio, signal: AbortSignal.timeout(45_000) }); } catch { throw new ErreurLiaison('VOX est injoignable.'); }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new ErreurLiaison(`VOX a répondu une erreur (HTTP ${r.status}).`);
    const texte = String(j.text || '').trim().slice(0, 2000);
    return { texte, arret: MOTS_ARRET.test(texte), ms: Number.isFinite(j.ms) ? j.ms : null };
  }

  async dire(texte) {
    const t = String(texte || '').trim();
    if (!t) throw new ErreurLiaison('Rien à dire.', 400);
    if (!this.cfg.voxUrl) throw new ErreurLiaison('VOX n’est pas relié à MapMyLAN.', 409);
    let r;
    try { r = await this.fetch(`${this.cfg.voxUrl}/v1/dire`, { method: 'POST', redirect: 'error', headers: { ...this.entetesVox(), 'content-type': 'application/json' }, body: JSON.stringify({ text: t.slice(0, 1500) }), signal: AbortSignal.timeout(30_000) }); } catch { throw new ErreurLiaison('VOX est injoignable.'); }
    if (!r.ok) throw new ErreurLiaison(`VOX a répondu une erreur (HTTP ${r.status}).`);
    const type = (r.headers.get('content-type') || 'audio/wav').split(';')[0].trim();
    const son = Buffer.from(await r.arrayBuffer());
    if (!/^audio\/[\w.+-]+$/.test(type) || son.length > 20 * 1048576) throw new ErreurLiaison('VOX a rendu autre chose que du son.');
    return { son, type };
  }

  async synapse(methode, chemin, corps, delai) {
    const r = await this.fetch(`${this.cfg.synapseUrl}${chemin}`, {
      method: methode, redirect: 'error', signal: AbortSignal.timeout(delai),
      headers: { authorization: `Bearer ${this.cfg.synapseJeton}`, 'content-type': 'application/json' },
      body: corps === undefined ? undefined : JSON.stringify(corps),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`SYNAPSE : HTTP ${r.status}`);
    return j;
  }

  async briefer(question) {
    if (!this.synapsePrete) return null;
    try {
      const r = await this.synapse('POST', '/v1/brief', { agent: this.nomCerveau, q: question, budget: 1200 }, 3000);
      return { texte: String(r.texte || '').slice(0, 5000), cerveaux: Array.isArray(r.cerveaux) ? r.cerveaux.slice(0, 20) : [] };
    } catch { return null; }
  }

  async orienter(question) {
    if (!this.synapsePrete) return null;
    try { return await this.synapse('POST', '/v1/cerveaux/orienter', { q: question }, 2000); } catch { return null; }
  }

  remonter(question, reponse) {
    if (!this.synapsePrete) return;
    this.synapse('POST', '/v1/echange', { agent: this.nomCerveau, question: question.slice(0, 2000), reponse: reponse.slice(0, 4000) }, 5000).catch(() => {
      // Un échange que SYNAPSE n'a pas reçu ne concerne pas la personne qui a posé la question.
    });
  }

  async publier(fiche, etat) {
    if (!this.synapsePrete) return false;
    try {
      await this.synapse('PUT', '/v1/cerveaux/moi', fiche, 8000);
      await this.synapse('PUT', '/v1/cerveaux/moi/etat', { etat }, 8000);
      this.signale = false;
      return true;
    } catch { this.signale = true; return false; }
  }
}
