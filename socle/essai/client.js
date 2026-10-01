// Client HTTP d'essai : boîte à cookies, jeton anti-CSRF, preuve de travail.
import http from 'node:http';
import crypto from 'node:crypto';
import { bitsNuls } from '../src/limiteur.js';

export class Client {
  constructor(port) { this.port = port; this.cookies = new Map(); this.csrf = null; this.origine = `http://localhost:${port}`; }

  async req(methode, chemin, corps, { entetes = {}, origine = this.origine, sansCsrf = false, brut = null } = {}) {
    const h = { host: `localhost:${this.port}`, 'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/130.0', ...entetes };
    if (origine) h.origin = origine;
    if (this.cookies.size) h.cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
    if (this.csrf && !sansCsrf) h['x-csrf'] = this.csrf;
    let donnees;
    if (corps !== undefined) { donnees = JSON.stringify(corps); h['content-type'] = 'application/json'; h['content-length'] = Buffer.byteLength(donnees); }
    if (brut !== null) { donnees = brut; h['content-length'] = Buffer.byteLength(brut); }
    const reponse = await new Promise((resolve, reject) => {
      const r = http.request({ host: '127.0.0.1', port: this.port, method: methode, path: chemin, headers: h }, resolve);
      r.on('error', reject);
      if (donnees) r.write(donnees);
      r.end();
    });
    const morceaux = [];
    for await (const m of reponse) morceaux.push(m);
    for (const sc of [].concat(reponse.headers['set-cookie'] || [])) {
      const [paire] = sc.split(';');
      const i = paire.indexOf('=');
      const k = paire.slice(0, i), v = paire.slice(i + 1);
      if (/Max-Age=0/.test(sc)) this.cookies.delete(k); else this.cookies.set(k, v);
    }
    const texte = Buffer.concat(morceaux).toString('utf8');
    let json = null; try { json = JSON.parse(texte); } catch { /* corps non JSON */ }
    if (json?.csrf) this.csrf = json.csrf;
    return { status: reponse.statusCode, json, texte, entetes: reponse.headers, setCookie: [].concat(reponse.headers['set-cookie'] || []) };
  }
  get(c, o) { return this.req('GET', c, undefined, o); }
  post(c, b = {}, o) { return this.req('POST', c, b, o); }
  del(c, o) { return this.req('DELETE', c, undefined, o); }
  patch(c, b, o) { return this.req('PATCH', c, b, o); }
  put(c, b, o) { return this.req('PUT', c, b, o); }
  async etat() { const r = await this.get('/api/compte/etat'); if (r.json?.session?.csrf) this.csrf = r.json.session.csrf; return r.json; }
}

// Comme le navigateur : une preuve de travail demandée est calculée puis jointe.
export function resoudre(preuve) {
  for (let n = 0; ; n++) {
    if (bitsNuls(crypto.createHash('sha256').update(`${preuve.sel}:${n}`).digest()) >= preuve.bits) return { id: preuve.id, nonce: String(n) };
  }
}

export async function connexion(client, identifiant, motDePasse) {
  let r = await client.post('/api/compte/connexion', { identifiant, motDePasse });
  if (r.status === 428) r = await client.post('/api/compte/connexion', { identifiant, motDePasse, preuve: resoudre(r.json.details.preuve) });
  return r;
}
