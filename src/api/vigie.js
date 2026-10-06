// La page Vigie : ce que VIGIE (l'audit de sécurité) dit du réseau, relu par
// MapMyLAN avec le jeton que le Hub a dérivé pour lui. Lecture pour tous les
// comptes, lancement d'un audit pour les membres ; jamais de jeton d'intégration
// ici : ces routes servent l'interface, pas les programmes.
import { ErreurHttp } from '../../socle/src/index.js';
import { vide } from './schemas.js';

const REF = /^[A-Za-z0-9_-]{12}$/;
const APPAREIL = /^[A-Za-z0-9_-]{1,64}$/;

export function routesVigie(route, s, acces) {
  const { cfg } = s;
  const relie = () => !!(cfg.vigieUrl && cfg.vigieJeton);
  const appeler = async (methode, chemin, { corps, brut = false, delai = 15_000 } = {}) => {
    if (!relie()) throw new ErreurHttp(409, 'VIGIE n’est pas reliée à MapMyLAN : installe-la depuis le Hub.');
    let r;
    try {
      r = await (s.fetch || globalThis.fetch)(cfg.vigieUrl + chemin, {
        method: methode, redirect: 'error', signal: AbortSignal.timeout(delai),
        headers: { authorization: `Bearer ${cfg.vigieJeton}`, accept: brut ? 'application/pdf' : 'application/json', ...(corps !== undefined ? { 'content-type': 'application/json' } : {}) },
        body: corps === undefined ? undefined : JSON.stringify(corps),
      });
    } catch { throw new ErreurHttp(502, 'VIGIE ne répond pas.'); }
    if (brut && r.ok) return r;
    const j = await r.json().catch(() => null);
    if (r.status === 404) throw new ErreurHttp(404, 'Introuvable dans VIGIE.');
    if (r.status === 401 || r.status === 403) throw new ErreurHttp(502, 'VIGIE refuse le jeton de MapMyLAN : redéploie MapMyLAN depuis le Hub.');
    if (!r.ok) throw new ErreurHttp(502, `VIGIE : ${String(j?.error || `erreur ${r.status}`).slice(0, 160)}`);
    return j;
  };
  const ref = v => { if (!REF.test(v)) throw new ErreurHttp(404, 'Introuvable.'); return v; };

  route.get('/api/vigie', () => ({ relie: relie() }), { role: 'lecture' });
  route.get('/api/vigie/etat', () => appeler('GET', '/api/etat'), { role: 'lecture' });
  route.get('/api/vigie/evenements', () => appeler('GET', '/api/evenements?limite=30&min=faible'), { role: 'lecture' });
  route.get('/api/vigie/audits/:id', ctx => appeler('GET', `/api/audits/${ref(ctx.params.id)}`), { role: 'lecture' });
  route.get('/api/vigie/appareils/:id', ctx => {
    if (!APPAREIL.test(ctx.params.id)) throw new ErreurHttp(404, 'Introuvable.');
    return appeler('GET', `/api/constats?appareil=${encodeURIComponent(ctx.params.id)}`);
  }, { role: 'lecture' });
  route.get('/api/vigie/audits/:id/pdf', async ctx => {
    const r = await appeler('GET', `/api/audits/${ref(ctx.params.id)}/pdf`, { brut: true, delai: 60_000 });
    const pdf = Buffer.from(await r.arrayBuffer());
    if (pdf.subarray(0, 5).toString('latin1') !== '%PDF-' || pdf.length > 20 * 1048576) throw new ErreurHttp(502, 'VIGIE a rendu autre chose qu’un PDF.');
    ctx.res.writeHead(200, { 'content-type': 'application/pdf', 'content-length': pdf.length, 'cache-control': 'no-store', 'content-disposition': `attachment; filename="vigie-audit-${ctx.params.id}.pdf"` });
    ctx.res.end(pdf);
  }, { role: 'lecture' });
  route.post('/api/vigie/audit', ctx => {
    acces.tracer(ctx, 'vigie.audit', null, {});
    return appeler('POST', '/api/audits', { corps: {} });
  }, { role: 'membre', corps: vide });
}
