// Identification des destinations publiques auprès des registres (RDAP).
//
// Deux règles : le nom affiché vient du registre, jamais d'une table écrite à
// la main ; le domaine qui sert au logo doit figurer dans la fiche (l'adresse
// du contact abus, typiquement), jamais fabriqué à partir d'un nom
// d'organisation. Le pays est celui de l'enregistrement du préfixe, pas une
// géolocalisation.
import { enEntier, estIPv4, estIP, estPrivee } from './cibles.js';

export const dansLePrefixe = (f, ip) => f.debut !== undefined && f.fin !== undefined && (n => n !== null && n >= f.debut && n <= f.fin)(enEntier(ip));

const NOMS_PAYS = {
  france: 'FR', belgium: 'BE', belgique: 'BE', luxembourg: 'LU', switzerland: 'CH', suisse: 'CH', germany: 'DE', deutschland: 'DE',
  netherlands: 'NL', 'the netherlands': 'NL', holland: 'NL', 'united kingdom': 'GB', 'great britain': 'GB', england: 'GB', scotland: 'GB',
  ireland: 'IE', spain: 'ES', 'españa': 'ES', portugal: 'PT', italy: 'IT', italia: 'IT', austria: 'AT', denmark: 'DK', sweden: 'SE',
  norway: 'NO', finland: 'FI', iceland: 'IS', poland: 'PL', czechia: 'CZ', 'czech republic': 'CZ', slovakia: 'SK', hungary: 'HU',
  romania: 'RO', bulgaria: 'BG', greece: 'GR', croatia: 'HR', slovenia: 'SI', serbia: 'RS', estonia: 'EE', latvia: 'LV', lithuania: 'LT',
  belarus: 'BY', ukraine: 'UA', moldova: 'MD', russia: 'RU', 'russian federation': 'RU', turkey: 'TR', 'türkiye': 'TR', cyprus: 'CY',
  malta: 'MT', monaco: 'MC', 'united states': 'US', 'united states of america': 'US', usa: 'US', 'u.s.a.': 'US', canada: 'CA',
  mexico: 'MX', brazil: 'BR', brasil: 'BR', argentina: 'AR', chile: 'CL', colombia: 'CO', peru: 'PE', venezuela: 'VE', uruguay: 'UY',
  paraguay: 'PY', bolivia: 'BO', ecuador: 'EC', 'costa rica': 'CR', panama: 'PA', guatemala: 'GT', cuba: 'CU', 'dominican republic': 'DO',
  'puerto rico': 'PR', jamaica: 'JM', china: 'CN', japan: 'JP', 'south korea': 'KR', korea: 'KR', 'korea, republic of': 'KR', taiwan: 'TW',
  'hong kong': 'HK', singapore: 'SG', malaysia: 'MY', thailand: 'TH', vietnam: 'VN', 'viet nam': 'VN', philippines: 'PH', indonesia: 'ID',
  india: 'IN', pakistan: 'PK', bangladesh: 'BD', 'sri lanka': 'LK', nepal: 'NP', myanmar: 'MM', cambodia: 'KH', laos: 'LA', mongolia: 'MN',
  kazakhstan: 'KZ', uzbekistan: 'UZ', azerbaijan: 'AZ', georgia: 'GE', armenia: 'AM', iran: 'IR', iraq: 'IQ', 'saudi arabia': 'SA',
  'united arab emirates': 'AE', qatar: 'QA', kuwait: 'KW', bahrain: 'BH', oman: 'OM', jordan: 'JO', lebanon: 'LB', israel: 'IL', syria: 'SY',
  egypt: 'EG', morocco: 'MA', algeria: 'DZ', tunisia: 'TN', libya: 'LY', senegal: 'SN', 'ivory coast': 'CI', "côte d'ivoire": 'CI',
  ghana: 'GH', nigeria: 'NG', cameroon: 'CM', kenya: 'KE', tanzania: 'TZ', uganda: 'UG', ethiopia: 'ET', 'south africa': 'ZA',
  zimbabwe: 'ZW', zambia: 'ZM', angola: 'AO', mozambique: 'MZ', mauritius: 'MU', reunion: 'RE', 'réunion': 'RE', madagascar: 'MG',
  australia: 'AU', 'new zealand': 'NZ', fiji: 'FJ', 'papua new guinea': 'PG',
};

function codePays(nom) {
  if (!nom) return undefined;
  const n = String(nom).trim().toLowerCase().replace(/\.$/, '');
  return /^[a-z]{2}$/.test(n) ? n.toUpperCase() : NOMS_PAYS[n];
}

// jCard range l'adresse de deux façons : un tableau dont la septième case est
// le pays, ou une étiquette en plusieurs lignes dont la dernière l'est.
function paysDeAdresse(e) {
  const v = e?.vcardArray;
  if (!Array.isArray(v) || !Array.isArray(v[1])) return undefined;
  for (const l of v[1]) {
    if (!Array.isArray(l) || l[0] !== 'adr') continue;
    if (Array.isArray(l[3]) && typeof l[3][6] === 'string') { const c = codePays(l[3][6]); if (c) return c; }
    if (typeof l[1]?.label === 'string') {
      const lignes = l[1].label.split(/\r?\n/).map(x => x.trim()).filter(Boolean);
      const c = codePays(lignes.at(-1)); if (c) return c;
    }
  }
  return undefined;
}

const champVCard = (e, champ) => {
  const v = e?.vcardArray;
  if (!Array.isArray(v) || !Array.isArray(v[1])) return undefined;
  const l = v[1].find(x => Array.isArray(x) && x[0] === champ && typeof x[3] === 'string');
  return l?.[3];
};

function parcourir(entites, visiter, profondeur = 0) {
  if (!Array.isArray(entites) || profondeur > 3) return;
  for (const e of entites.slice(0, 50)) { visiter(e); parcourir(e?.entities, visiter, profondeur + 1); }
}

const DOMAINE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/i;

export function analyserRdap(j, ip) {
  const f = { ip };
  if (typeof j?.name === 'string') f.reseau = j.name.slice(0, 80);
  const d = typeof j?.startAddress === 'string' ? enEntier(j.startAddress) : null;
  const fin = typeof j?.endAddress === 'string' ? enEntier(j.endAddress) : null;
  if (d !== null && fin !== null && fin >= d) { f.debut = d; f.fin = fin; }
  if (typeof j?.country === 'string') f.pays = codePays(j.country);
  if (Array.isArray(j?.rdapConformance)) {
    const m = /(ripe|arin|apnic|lacnic|afrinic)/i.exec(String(j?.port43 || j?.links?.[0]?.value || ''));
    if (m) f.registre = m[1].toUpperCase();
  }
  let organisation, domaine;
  parcourir(j?.entities || [], e => {
    const roles = Array.isArray(e?.roles) ? e.roles : [];
    const nom = champVCard(e, 'fn');
    if (!organisation && nom && roles.some(r => ['registrant', 'administrative', 'technical'].includes(r))) organisation = nom.slice(0, 80);
    if (!f.pays) { const p = paysDeAdresse(e); if (p) f.pays = p; }
    const courriel = champVCard(e, 'email');
    if (!domaine && typeof courriel === 'string' && courriel.includes('@')) {
      const dom = courriel.split('@').pop().trim().toLowerCase();
      if (DOMAINE.test(dom)) domaine = dom;
    }
  });
  if (organisation) f.organisation = organisation;
  if (domaine) f.domaine = domaine;
  return f;
}

const DUREE_CACHE = 7 * 86400e3;
const ESPACEMENT_MIN = 120, ESPACEMENT_MAX = 2000;

export class Registre {
  constructor({ sortie, reglages, base = 'https://rdap.org' }) {
    Object.assign(this, { sortie, reglages, base });
    this.cache = new Map(); this.enCours = new Map(); this.prefixes = [];
    this.espacement = 300; this.prochaine = 0;
  }

  // world.rdap à faux coupe toute interrogation extérieure.
  actif() { return this.reglages.lire('world.rdap') !== false; }

  prefixeConnu(ip) {
    const t = Date.now();
    this.prefixes = this.prefixes.filter(p => p.expire > t);
    const p = this.prefixes.find(x => dansLePrefixe(x.fiche, ip));
    return p ? { ...p.fiche, ip } : undefined;
  }

  // Le registre limite les rafales : on espace, et on respecte l'attente demandée.
  async attendreSonTour() {
    const t = Date.now(), quand = Math.max(t, this.prochaine);
    this.prochaine = quand + this.espacement;
    if (quand > t) await new Promise(r => setTimeout(r, quand - t).unref());
  }

  async interroger(ip) {
    await this.attendreSonTour();
    try {
      // rdap.org redirige vers le registre compétent ; chaque saut est revérifié.
      const r = await this.sortie.sortir(`${this.base}/ip/${encodeURIComponent(ip)}`, { headers: { accept: 'application/rdap+json, application/json' } }, { confiance: 'publique', taille: 512 * 1024, delai: 6000 });
      // 429 et 5xx veulent dire « plus tard », pas « adresse inconnue ».
      if (r.status === 429 || r.status >= 500) {
        this.espacement = Math.min(ESPACEMENT_MAX, this.espacement * 2);
        const attente = Number(r.headers.get('retry-after'));
        this.prochaine = Date.now() + (attente > 0 ? Math.min(attente, 120) * 1000 : 5000);
        await r.body?.cancel();
        return { ip, injoignable: true };
      }
      this.espacement = Math.max(ESPACEMENT_MIN, Math.round(this.espacement * 0.85));
      if (!r.ok) { await r.body?.cancel(); return { ip }; }
      return analyserRdap(await r.json(), ip);
    } catch { return { ip, injoignable: true }; }
  }

  fiche(ip) {
    const vu = this.cache.get(ip);
    if (vu && vu.expire > Date.now()) return Promise.resolve(vu.fiche);
    const parBloc = this.prefixeConnu(ip);
    if (parBloc) return Promise.resolve(parBloc);
    if (this.enCours.has(ip)) return this.enCours.get(ip);
    const p = this.interroger(ip).then(f => {
      // Une réponse vide est gardée brièvement : inutile de marteler le
      // registre pour une adresse qu'il ne connaît pas.
      const duree = f.organisation || f.reseau ? DUREE_CACHE : f.injoignable ? 60e3 : 3600e3;
      if (this.cache.size > 20000) this.cache.clear();
      this.cache.set(ip, { fiche: f, expire: Date.now() + duree });
      if ((f.organisation || f.reseau) && f.debut !== undefined) this.prefixes.push({ fiche: f, expire: Date.now() + DUREE_CACHE });
      return f;
    }).finally(() => this.enCours.delete(ip));
    this.enCours.set(ip, p);
    return p;
  }
}

// Une adresse qui concerne un registre : publique, jamais du réseau local.
export const adresseDeRegistre = ip => estIP(ip) && !estPrivee(ip) && (estIPv4(ip) || !/^(fe80|fc|fd|::1)/i.test(ip));
