// Session HTTP vers l'API d'un équipement : cookies gardés d'un appel à
// l'autre, JSON, et tout par la garde de sortie. L'hôte joint est celui de
// l'équipement déclaré, et lui seul : une adresse d'API qui désignerait un
// autre hôte ferait du service un relais vers le réseau interne.
import { ErreurHttp } from '../../socle/src/index.js';

export function exigerUrlEquipement(url, hoteAttendu) {
  let u;
  try { u = new URL(String(url)); } catch { throw new ErreurHttp(400, 'Adresse d’API invalide.'); }
  if (u.protocol !== 'https:') throw new ErreurHttp(400, 'Adresse d’API : https exigé.');
  if ((u.pathname !== '/' && u.pathname !== '') || u.search || u.hash || u.username || u.password) throw new ErreurHttp(400, 'Adresse d’API : l’origine seule (https://hôte[:port]).');
  if (u.hostname.replace(/^\[|\]$/g, '').toLowerCase() !== String(hoteAttendu).toLowerCase()) throw new ErreurHttp(400, `Adresse d’API : l’hôte doit être celui de l’équipement (${hoteAttendu}).`);
  return u.origin;
}

export class SessionHttp {
  constructor({ sortie, origine, tls = null, delai = 10_000 }) {
    this.sortie = sortie; this.origine = origine; this.tls = tls; this.delai = delai;
    this.cookies = new Map(); this.entetes = {};
  }

  poserEntete(k, v) { this.entetes[k] = String(v).slice(0, 512); }

  async requete(url, { methode = 'GET', corps } = {}) {
    if (new URL(url).origin !== this.origine) throw new ErreurHttp(400, 'Requête hors de l’équipement déclaré.');
    const entetes = { accept: 'application/json', ...this.entetes };
    if (this.cookies.size) entetes.cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
    if (corps !== undefined) entetes['content-type'] = 'application/json';
    let r;
    try {
      r = await this.sortie.sortir(url, { method: methode, headers: entetes, body: corps === undefined ? undefined : JSON.stringify(corps), redirect: 'manual' },
        { confiance: 'equipement', taille: 8 * 1048576, delai: this.delai, tls: this.tls });
    } catch (e) {
      if (e instanceof ErreurHttp) throw e;
      const code = String(e.code || '');
      // Un certificat qui n'est plus celui épinglé : l'équipement a été remplacé, ou quelqu'un se fait passer pour lui.
      if (/CERT|SELF_SIGNED|ERR_TLS/.test(code) || /épinglé/.test(e.message)) throw new ErreurHttp(502, 'Certificat de l’équipement refusé : ce n’est plus celui confirmé à l’enregistrement. Si le changement est voulu, réenregistre l’équipement.');
      throw new ErreurHttp(502, `Équipement injoignable : ${e.name === 'TimeoutError' ? 'délai dépassé' : code || e.message}.`);
    }
    for (const c of r.headers.getSetCookie()) {
      const [paire] = c.split(';');
      const i = paire.indexOf('=');
      if (i > 0) this.cookies.set(paire.slice(0, i).trim(), paire.slice(i + 1).trim());
    }
    const texte = await r.text();
    return { status: r.status, entetes: r.headers, texte, json: () => { try { return JSON.parse(texte); } catch { return null; } } };
  }
}
