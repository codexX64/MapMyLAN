// Le flux temps réel (SSE, GET /api/flux) : il remplace socket.io et émet
// les mêmes noms d'événements. Session exigée (vérifiée avant l'ouverture,
// puis toutes les trente secondes : un flux ne survit ni à une révocation ni
// à l'expiration), au plus six flux par session (un par onglet) et un
// plafond pour l'instance.
import { ErreurHttp } from '../socle/src/index.js';
import { NOMS_FLUX } from './evenements.js';

const BATTEMENT_MS = 25_000;
const CONTROLE_MS = 30_000;
// Un client qui ne lit plus : au-delà, le flux est fermé et il se reconnectera.
const RETARD_MAX = 1024 * 1024;

export class Flux {
  constructor({ evts, comptes, parSession = 6, total = 200, controleMs = CONTROLE_MS }) {
    Object.assign(this, { evts, comptes, parSession, total, controleMs });
    this.ouverts = new Set();
  }

  ouvrir(ctx) {
    const session = ctx.session;
    const miens = [...this.ouverts].filter(f => f.session === session.id).length;
    if (miens >= this.parSession) throw new ErreurHttp(429, 'Trop de flux ouverts pour cette session : ferme un onglet.');
    if (this.ouverts.size >= this.total) throw new ErreurHttp(429, 'Trop de flux ouverts sur le service.');
    const { res, req } = ctx;
    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store, no-transform', 'X-Accel-Buffering': 'no', Connection: 'keep-alive' });
    res.write(': ouvert\n\n');
    const flux = { session: session.id };
    const fermer = () => {
      if (!this.ouverts.delete(flux)) return;
      for (const [nom, f] of ecouteurs) this.evts.bus.off(nom, f);
      clearInterval(battement); clearInterval(controle);
      if (!res.writableEnded) res.end();
    };
    const ecrire = texte => {
      if (res.writableEnded) return;
      if (res.writableLength > RETARD_MAX) { fermer(); return; }
      res.write(texte);
    };
    const ecouteurs = NOMS_FLUX.map(nom => [nom, donnees => ecrire(`event: ${nom}\ndata: ${JSON.stringify(donnees ?? null)}\n\n`)]);
    for (const [nom, f] of ecouteurs) this.evts.bus.on(nom, f);
    const battement = setInterval(() => ecrire(': ping\n\n'), BATTEMENT_MS);
    const controle = setInterval(() => { if (!this.comptes.sessionVivante(ctx.jeton)) fermer(); }, this.controleMs);
    battement.unref(); controle.unref();
    flux.fermer = fermer;
    this.ouverts.add(flux);
    req.on('close', fermer);
    res.on('close', fermer);
  }

  // À l'arrêt, ou quand l'administrateur ferme toutes les sessions.
  fermerTout() { for (const f of [...this.ouverts]) f.fermer(); }
}
