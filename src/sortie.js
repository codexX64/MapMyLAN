// Toute connexion sortante vers une adresse fournie par un utilisateur passe
// ici (SEC-CSRF-004) : billetterie, API d'un équipement, relais SMTP ou IMAP
// d'une boîte, registres et logos. Reprise de la garde du Hub.
//
//   - http et https seulement ; une destination publique en https ;
//   - le nom est résolu, chaque adresse est classée, puis la connexion part
//     vers l'adresse contrôlée, jamais vers une seconde résolution ;
//   - métadonnées de nuage, lien local, multicast et plages réservées :
//     toujours refusés ;
//   - adresse privée ou boucle locale : seulement si un administrateur l'a
//     autorisée — l'équipement réseau qu'il a déclaré, ou la liste
//     « destinations internes » des réglages (sortie.autorisees) ;
//   - redirections revérifiées à chaque saut, délai et taille bornés.
import http from 'node:http';
import https from 'node:https';
import dns from 'node:dns';
import net from 'node:net';
import { Readable, Transform } from 'node:stream';
import { ErreurHttp } from '../socle/src/index.js';

const plage = (octets, bits) => [octets.join('.'), bits];
const INTERDITES = new net.BlockList();
for (const [a, p] of [plage([0, 0, 0, 0], 8), plage([169, 254, 0, 0], 16), plage([192, 0, 0, 0], 24), plage([192, 0, 2, 0], 24), plage([198, 18, 0, 0], 15), plage([198, 51, 100, 0], 24), plage([203, 0, 113, 0], 24), plage([224, 0, 0, 0], 4), plage([240, 0, 0, 0], 4)]) INTERDITES.addSubnet(a, p, 'ipv4');
for (const [a, p] of [['::', 128], ['::', 96], ['64:ff9b::', 96], ['100::', 64], ['2001::', 32], ['2001:db8::', 32], ['2002::', 16], ['fe80::', 10], ['fec0::', 10], ['ff00::', 8]]) INTERDITES.addSubnet(a, p, 'ipv6');
// Métadonnées de nuage logées dans une plage privée : refusées avant tout.
const METADONNEES = new net.BlockList();
METADONNEES.addAddress('100.100.100.200', 'ipv4');
METADONNEES.addAddress('fd00:ec2::254', 'ipv6');
const INTERNES = new net.BlockList();
for (const [a, p] of [plage([10, 0, 0, 0], 8), plage([100, 64, 0, 0], 10), plage([127, 0, 0, 0], 8), plage([172, 16, 0, 0], 12), plage([192, 168, 0, 0], 16)]) INTERNES.addSubnet(a, p, 'ipv4');
INTERNES.addAddress('::1', 'ipv6');
INTERNES.addSubnet('fc00::', 7, 'ipv6');

// Une IPv4 glissée dans une IPv6 (::ffff:a.b.c.d, ou sa forme hexadécimale
// que produit l'analyseur d'URL) est jugée comme l'IPv4 qu'elle porte.
function ipv4Portee(ip) {
  const m = /^::ffff:(?:(\d+\.\d+\.\d+\.\d+)|([0-9a-f]{1,4}):([0-9a-f]{1,4}))$/i.exec(ip);
  if (!m) return null;
  if (m[1]) return m[1];
  const n = (parseInt(m[2], 16) << 16 >>> 0) + parseInt(m[3], 16);
  return [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
}

/** « interdite », « interne » ou « publique ». */
export function classer(ip) {
  let adresse = String(ip).replace(/^\[|\]$/g, '').toLowerCase();
  const v4 = ipv4Portee(adresse);
  if (v4) adresse = v4;
  const famille = net.isIPv4(adresse) ? 'ipv4' : net.isIPv6(adresse) ? 'ipv6' : null;
  if (!famille) return 'interdite';
  if (METADONNEES.check(adresse, famille)) return 'interdite';
  if (INTERNES.check(adresse, famille)) return 'interne';
  if (INTERDITES.check(adresse, famille)) return 'interdite';
  if (famille === 'ipv6' && !/^[23][0-9a-f]{0,3}:/.test(adresse)) return 'interdite';
  return 'publique';
}

// Une entrée de la liste : un nom d'hôte, une adresse ou une plage privée.
const NOM = /^(?=.{1,253}$)[a-z0-9_](?:[a-z0-9_-]{0,62}[a-z0-9_])?(?:\.[a-z0-9_](?:[a-z0-9_-]{0,62}[a-z0-9_])?)*$/i;
export function lireEntree(brut) {
  const e = String(brut || '').trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (!e) throw new Error('entrée vide');
  const [base, bits] = e.split('/');
  if (net.isIP(base)) {
    const famille = net.isIPv4(base) ? 'ipv4' : 'ipv6';
    const max = famille === 'ipv4' ? 32 : 128;
    const p = bits === undefined ? max : Number(bits);
    if (!Number.isInteger(p) || p < (famille === 'ipv4' ? 8 : 32) || p > max) throw new Error(`${brut} : plage trop large ou invalide`);
    if (classer(base) !== 'interne') throw new Error(`${brut} : seules les adresses privées ou de boucle locale s'autorisent ici`);
    return { type: 'plage', base, p, famille };
  }
  if (bits !== undefined || !NOM.test(e)) throw new Error(`${brut} : ni un nom d'hôte, ni une adresse, ni une plage`);
  return { type: 'nom', nom: e };
}

export class DestinationRefusee extends ErreurHttp {
  constructor(message) { super(403, message); this.name = 'DestinationRefusee'; }
}

function lireUrl(brut) {
  let url;
  try { url = new URL(String(brut)); } catch { throw new DestinationRefusee(`Adresse invalide : ${String(brut).slice(0, 120)}`); }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new DestinationRefusee(`Schéma refusé : ${url.protocol} (http ou https seulement)`);
  if (url.username || url.password) throw new DestinationRefusee('Identifiants dans l’adresse refusés.');
  return url;
}

function borne(max) {
  let n = 0;
  return new Transform({ transform(c, _e, cb) { n += c.length; if (n > max) cb(new Error(`réponse trop volumineuse (plus de ${Math.round(max / 1024)} Kio)`)); else cb(null, c); } });
}

const SANS_CORPS = new Set([101, 204, 205, 304]);

/*
 * internes : qui fournit la liste des destinations internes autorisées
 * (appelé à chaque connexion). transport : remplace la connexion elle-même
 * (essais sans réseau).
 *
 * confiance :
 *   'liste'      — interne seulement si la liste l'autorise ;
 *   'equipement' — l'hôte est celui d'un équipement déclaré par un
 *                  administrateur : interne admis, jamais une plage interdite ;
 *   'publique'   — jamais interne (logos, registres).
 */
export class Sortie {
  constructor({ internes = () => [], transport = null } = {}) {
    this.internes = internes; this.transport = transport;
  }

  autorisees(extra = []) {
    const noms = new Set(), plages = new net.BlockList();
    for (const brut of [...this.internes(), ...extra]) {
      let e; try { e = lireEntree(brut); } catch { continue; }
      if (e.type === 'nom') noms.add(e.nom); else plages.addSubnet(e.base, e.p, e.famille);
    }
    return { noms, plages };
  }

  juge(url, confiance, { tcp = false } = {}) {
    const autorise = this.autorisees();
    const hote = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    const nomAutorise = autorise.noms.has(hote);
    return adresse => {
      const classe = classer(adresse);
      if (classe === 'interdite') return `adresse ${adresse} toujours refusée (métadonnées, lien local ou plage réservée)`;
      if (classe === 'interne') {
        if (confiance === 'publique') return `adresse privée ${adresse} refusée`;
        const v4 = ipv4Portee(adresse) || adresse;
        const ok = confiance === 'equipement' || nomAutorise || autorise.plages.check(v4, net.isIPv4(v4) ? 'ipv4' : 'ipv6');
        if (!ok) return `destination interne non autorisée : ${hote}. Un administrateur peut l’ajouter aux destinations internes (réglage sortie.autorisees)`;
        return null;
      }
      if (!tcp && url.protocol !== 'https:') return `${hote} est public : https exigé`;
      return null;
    };
  }

  // L'adresse vérifiée à laquelle ouvrir une connexion TCP (SMTP, IMAP).
  async destinationTcp(hote, { confiance = 'liste' } = {}) {
    const brut = String(hote).replace(/^\[|\]$/g, '');
    const url = lireUrl(`http://${net.isIPv6(brut) ? `[${brut}]` : brut}/`);
    const verdict = this.juge(url, confiance, { tcp: true });
    const nu = url.hostname.replace(/^\[|\]$/g, '');
    const adresses = net.isIP(nu) ? [{ address: nu, family: net.isIPv4(nu) ? 4 : 6 }]
      : await dns.promises.lookup(nu, { all: true }).catch(e => { throw new DestinationRefusee(`${nu} : résolution impossible (${e.code || e.message})`); });
    const motifs = adresses.map(a => verdict(a.address));
    const bonne = adresses.find((_, i) => !motifs[i]);
    if (!bonne) throw new DestinationRefusee(motifs[0] || `${nu} : aucune adresse`);
    return bonne.address;
  }

  async unSaut(url, { methode, entetes, corps, signal, confiance, taille, tls }) {
    const verdict = this.juge(url, confiance);
    const brut = url.hostname.replace(/^\[|\]$/g, '');
    if (net.isIP(brut)) { const m = verdict(brut); if (m) throw new DestinationRefusee(m); }
    // Résoudre, contrôler, épingler : la connexion part vers l'adresse jugée.
    const lookup = (nom, options, cb) => {
      dns.lookup(nom, { all: true, family: options?.family || 0 }, (err, adresses) => {
        if (err) return cb(err);
        const motifs = adresses.map(a => verdict(a.address));
        const retenues = adresses.filter((_, i) => !motifs[i]);
        if (!retenues.length) return cb(new DestinationRefusee(motifs[0] || `${nom} : aucune adresse`));
        if (options?.all) cb(null, retenues); else cb(null, retenues[0].address, retenues[0].family);
      });
    };
    const module = url.protocol === 'https:' ? https : http;
    // Certificat épinglé d'un équipement : son PEM sert d'autorité et son
    // empreinte est vérifiée à la place du nom. La vérification n'est jamais
    // désactivée.
    const options = { method: methode, headers: entetes, lookup, agent: false, signal, ...(url.protocol === 'https:' && tls ? { ca: tls.ca, checkServerIdentity: tls.checkServerIdentity } : {}) };
    return new Promise((ok, ko) => {
      const req = module.request(url, options, res => {
        const statut = res.statusCode;
        const h = new Headers();
        for (const [k, v] of Object.entries(res.headers)) for (const x of [].concat(v)) h.append(k, x);
        if (SANS_CORPS.has(statut) || methode === 'HEAD') { res.resume(); return ok(new Response(null, { status: statut === 101 ? 502 : statut, headers: h })); }
        const flux = res.pipe(borne(taille));
        res.on('error', e => flux.destroy(e));
        signal.addEventListener('abort', () => flux.destroy(signal.reason), { once: true });
        ok(new Response(Readable.toWeb(flux), { status: statut < 200 || statut > 599 ? 502 : statut, headers: h }));
      });
      req.on('error', e => ko(signal.aborted ? signal.reason : e.cause instanceof DestinationRefusee ? e.cause : e));
      if (corps?.length) req.end(corps); else req.end();
    });
  }

  /**
   * Comme fetch, avec la politique ci-dessus. En plus : { confiance, taille
   * (octets), delai (ms), tls: { ca, checkServerIdentity } }.
   */
  async sortir(adresse, init = {}, { confiance = 'liste', taille = 1048576, delai = 15000, tls = null } = {}) {
    let url = lireUrl(adresse);
    const mode = init.redirect || 'follow';
    const signal = init.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(delai)]) : AbortSignal.timeout(delai);
    const requete = new Request(url, { method: init.method || 'GET', headers: init.headers, body: init.body });
    let methode = requete.method;
    let corps = requete.body ? Buffer.from(await requete.arrayBuffer()) : null;
    const entetes = Object.fromEntries(requete.headers);
    entetes['user-agent'] ??= 'MapMyLAN';
    if (corps) entetes['content-length'] = String(corps.length);
    for (let saut = 0; ; saut++) {
      const res = await (this.transport || ((u, o) => this.unSaut(u, o)))(url, { methode, entetes, corps, signal, confiance, taille, tls });
      const lieu = res.headers.get('location');
      if (![301, 302, 303, 307, 308].includes(res.status) || !lieu || mode === 'manual') return res;
      await res.body?.cancel();
      if (mode === 'error') throw new DestinationRefusee(`redirection refusée vers ${lieu.slice(0, 120)}`);
      if (saut >= 4) throw new DestinationRefusee('trop de redirections');
      const suivante = lireUrl(new URL(lieu, url).href);
      // Une autre origine ne reçoit ni les identifiants ni les cookies, ni le
      // certificat épinglé d'un équipement.
      if (suivante.origin !== url.origin) {
        for (const k of ['authorization', 'cookie', 'proxy-authorization', 'x-api-key', 'x-ticket-key', 'x-csrf-token']) delete entetes[k];
        tls = null;
      }
      if (res.status === 303 || ((res.status === 301 || res.status === 302) && methode === 'POST')) {
        methode = 'GET'; corps = null; delete entetes['content-length']; delete entetes['content-type'];
      }
      url = suivante;
    }
  }
}
