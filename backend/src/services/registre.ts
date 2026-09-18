// Identification des préfixes auprès des registres (RDAP).
//
// RDAP est le whois moderne : du JSON, servi par les registres régionaux
// (RIPE, ARIN, APNIC…). Ce qu'il rend est déclaré par le titulaire du préfixe
// et opposable, pas deviné.
//
// Deux règles tenues strictement :
//
//   1. le nom affiché vient du registre, jamais d'une table écrite à la main ;
//   2. le domaine qui sert au logo doit **figurer** dans la fiche du registre —
//      typiquement l'adresse du contact abus. On ne fabrique jamais un domaine
//      à partir d'un nom d'organisation : « Machin Telecom SA » ne devient pas
//      « machin-telecom.com » par supposition.
//
// Le pays rendu est celui de l'**enregistrement** du préfixe. Ce n'est pas une
// géolocalisation : un préfixe enregistré aux États-Unis peut être annoncé
// depuis Paris. L'interface doit le présenter comme tel.

import { prisma } from "../db";

export interface FicheReseau {
  ip: string;
  reseau?: string;        // nom du préfixe, ex. CLOUDFLARENET
  organisation?: string;  // titulaire déclaré
  pays?: string;          // pays d'enregistrement, pas de géolocalisation
  domaine?: string;       // uniquement s'il figure dans la fiche
  registre?: string;      // RIPE, ARIN, APNIC…
  /** Renseigné quand le registre n'a pas pu être joint, pas quand il ne sait rien. */
  injoignable?: boolean;
  /**
   * Le PRÉFIXE que la fiche décrit, en IPv4, borné aux deux bouts.
   *
   * Le registre ne répond pas sur une adresse mais sur le bloc qui la
   * contient : la même fiche vaut donc pour toutes les adresses du bloc.
   * S'en servir divise le nombre d'interrogations par cent sur un relevé
   * ordinaire — mille sept cents destinations tiennent dans quelques dizaines
   * de préfixes — et c'est ce qui évite de se faire limiter par le registre.
   */
  debut?: number;
  fin?: number;
}

/** Une adresse IPv4 en entier, pour comparer des bornes. Rien d'autre. */
export function enEntier(ip: string): number | undefined {
  const p = ip.split(".");
  if (p.length !== 4) return undefined;
  let n = 0;
  for (const o of p) {
    const v = Number(o);
    if (!Number.isInteger(v) || v < 0 || v > 255) return undefined;
    n = n * 256 + v;
  }
  return n;
}

/** L'adresse tombe-t-elle dans le préfixe décrit par cette fiche ? */
export function dansLePrefixe(f: FicheReseau, ip: string): boolean {
  if (f.debut === undefined || f.fin === undefined) return false;
  const n = enEntier(ip);
  return n !== undefined && n >= f.debut && n <= f.fin;
}

/** Le parseur est exporté pour être vérifiable sans réseau. */
export { analyser as analyserRdap };

// Le résultat est stable pendant des mois : on le garde en mémoire pour ne pas
// réinterroger le registre à chaque relevé, toutes les quinze secondes.
const cache = new Map<string, { fiche: FicheReseau; expire: number }>();
const DUREE_CACHE = 7 * 24 * 3600_000;
const enCours = new Map<string, Promise<FicheReseau>>();

/**
 * Les préfixes déjà connus, gardés à part du cache par adresse.
 *
 * Une fiche décrit un bloc entier : la retenir par bloc évite de réinterroger
 * le registre pour chaque adresse d'un même hébergeur. C'est ce qui empêche
 * de se faire limiter, et donc ce qui fait la différence entre une liste de
 * destinations nommées et une liste de points d'interrogation.
 */
const prefixes: { fiche: FicheReseau; expire: number }[] = [];

function prefixeConnu(ip: string): FicheReseau | undefined {
  const maintenant = Date.now();
  for (let i = prefixes.length - 1; i >= 0; i--) {
    if (prefixes[i].expire <= maintenant) { prefixes.splice(i, 1); continue; }
    if (dansLePrefixe(prefixes[i].fiche, ip)) return { ...prefixes[i].fiche, ip };
  }
  return undefined;
}

/**
 * Le registre limite les rafales : au-delà, il répond 429 et on n'apprend
 * rien. On espace donc les interrogations, et on respecte l'attente qu'il
 * demande. Mieux vaut nommer lentement que ne rien nommer du tout.
 */
const ESPACEMENT_MIN = 120;
const ESPACEMENT_MAX = 2000;
let espacement = 300;
let prochaineFenetre = 0;

async function attendreSonTour(): Promise<void> {
  const maintenant = Date.now();
  const quand = Math.max(maintenant, prochaineFenetre);
  prochaineFenetre = quand + espacement;
  if (quand > maintenant) await new Promise((r) => setTimeout(r, quand - maintenant));
}

/** Le registre a répondu : on peut resserrer un peu, sans jamais descendre
 *  sous le plancher. Nommer mille sept cents destinations à trois cent
 *  cinquante millisecondes l'unité prend dix minutes ; à cent vingt, trois. */
function registreContent(): void {
  espacement = Math.max(ESPACEMENT_MIN, Math.round(espacement * 0.85));
}

/** Il a dit non : on double, et on attend ce qu'il demande. */
function registreFache(attenteSecondes?: number): void {
  espacement = Math.min(ESPACEMENT_MAX, Math.round(espacement * 2));
  const pause = attenteSecondes && attenteSecondes > 0 ? Math.min(attenteSecondes, 120) * 1000 : 5000;
  prochaineFenetre = Date.now() + pause;
}

const IPV4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
const IPV6 = /^[0-9a-fA-F:]{2,45}$/;
const estIP = (s: string) => IPV4.test(s) || (IPV6.test(s) && s.includes(":"));

/** Adresses qui ne concernent aucun registre : on ne les sort jamais du réseau. */
function estPrivee(ip: string): boolean {
  if (ip.includes(":")) {
    const b = ip.toLowerCase();
    return b === "::1" || b.startsWith("fe80") || b.startsWith("fc") || b.startsWith("fd");
  }
  const [a, b] = ip.split(".").map(Number);
  return a === 10 || a === 127 || a === 0 ||
         (a === 172 && b >= 16 && b <= 31) ||
         (a === 192 && b === 168) ||
         (a === 169 && b === 254) ||
         (a === 100 && b >= 64 && b <= 127);
}


// ── Nom de pays → code ISO ──────────────────────────────────────────────────
//
// Les registres ne rendent pas tous le pays au même endroit. RIPE le met à la
// racine de la fiche, sur deux lettres. ARIN ne le met souvent que dans
// l'adresse postale du titulaire, écrit en toutes lettres — c'est pourquoi
// Apple, Google, Amazon ou Cloudflare ressortaient sans pays.
const NOMS_PAYS: Record<string, string> = {
  "france": "FR", "belgium": "BE", "belgique": "BE", "luxembourg": "LU",
  "switzerland": "CH", "suisse": "CH", "germany": "DE", "deutschland": "DE",
  "netherlands": "NL", "the netherlands": "NL", "holland": "NL",
  "united kingdom": "GB", "great britain": "GB", "england": "GB", "scotland": "GB",
  "ireland": "IE", "spain": "ES", "españa": "ES", "portugal": "PT",
  "italy": "IT", "italia": "IT", "austria": "AT", "denmark": "DK",
  "sweden": "SE", "norway": "NO", "finland": "FI", "iceland": "IS",
  "poland": "PL", "czechia": "CZ", "czech republic": "CZ", "slovakia": "SK",
  "hungary": "HU", "romania": "RO", "bulgaria": "BG", "greece": "GR",
  "croatia": "HR", "slovenia": "SI", "serbia": "RS", "estonia": "EE",
  "latvia": "LV", "lithuania": "LT", "belarus": "BY", "ukraine": "UA",
  "moldova": "MD", "russia": "RU", "russian federation": "RU", "turkey": "TR",
  "türkiye": "TR", "cyprus": "CY", "malta": "MT", "monaco": "MC",
  "united states": "US", "united states of america": "US", "usa": "US", "u.s.a.": "US",
  "canada": "CA", "mexico": "MX", "brazil": "BR", "brasil": "BR",
  "argentina": "AR", "chile": "CL", "colombia": "CO", "peru": "PE",
  "venezuela": "VE", "uruguay": "UY", "paraguay": "PY", "bolivia": "BO",
  "ecuador": "EC", "costa rica": "CR", "panama": "PA", "guatemala": "GT",
  "cuba": "CU", "dominican republic": "DO", "puerto rico": "PR", "jamaica": "JM",
  "china": "CN", "japan": "JP", "south korea": "KR", "korea": "KR",
  "korea, republic of": "KR", "taiwan": "TW", "hong kong": "HK", "singapore": "SG",
  "malaysia": "MY", "thailand": "TH", "vietnam": "VN", "viet nam": "VN",
  "philippines": "PH", "indonesia": "ID", "india": "IN", "pakistan": "PK",
  "bangladesh": "BD", "sri lanka": "LK", "nepal": "NP", "myanmar": "MM",
  "cambodia": "KH", "laos": "LA", "mongolia": "MN", "kazakhstan": "KZ",
  "uzbekistan": "UZ", "azerbaijan": "AZ", "georgia": "GE", "armenia": "AM",
  "iran": "IR", "iraq": "IQ", "saudi arabia": "SA", "united arab emirates": "AE",
  "qatar": "QA", "kuwait": "KW", "bahrain": "BH", "oman": "OM",
  "jordan": "JO", "lebanon": "LB", "israel": "IL", "syria": "SY",
  "egypt": "EG", "morocco": "MA", "algeria": "DZ", "tunisia": "TN",
  "libya": "LY", "senegal": "SN", "ivory coast": "CI", "côte d'ivoire": "CI",
  "ghana": "GH", "nigeria": "NG", "cameroon": "CM", "kenya": "KE",
  "tanzania": "TZ", "uganda": "UG", "ethiopia": "ET", "south africa": "ZA",
  "zimbabwe": "ZW", "zambia": "ZM", "angola": "AO", "mozambique": "MZ",
  "mauritius": "MU", "reunion": "RE", "réunion": "RE", "madagascar": "MG",
  "australia": "AU", "new zealand": "NZ", "fiji": "FJ",
  "papua new guinea": "PG",
};

function codePays(nom?: string): string | undefined {
  if (!nom) return undefined;
  const n = nom.trim().toLowerCase().replace(/\.$/, "");
  if (/^[a-z]{2}$/.test(n)) return n.toUpperCase();
  return NOMS_PAYS[n];
}

/**
 * Le pays inscrit dans l'adresse postale du titulaire.
 *
 * jCard range l'adresse de deux façons : un tableau structuré dont la
 * septième case est le pays, ou une étiquette libre en plusieurs lignes dont
 * la dernière l'est. On essaie les deux, dans cet ordre.
 */
function paysDeAdresse(entite: any): string | undefined {
  const v = entite?.vcardArray;
  if (!Array.isArray(v) || !Array.isArray(v[1])) return undefined;
  for (const ligne of v[1]) {
    if (!Array.isArray(ligne) || ligne[0] !== "adr") continue;
    const structure = ligne[3];
    if (Array.isArray(structure) && typeof structure[6] === "string") {
      const c = codePays(structure[6]);
      if (c) return c;
    }
    const etiquette = ligne[1]?.label;
    if (typeof etiquette === "string") {
      const lignes = etiquette.split(/\r?\n/).map((x: string) => x.trim()).filter(Boolean);
      const c = codePays(lignes[lignes.length - 1]);
      if (c) return c;
    }
  }
  return undefined;
}

/** Un vCard RDAP est un tableau de tableaux : on y pioche par nom de champ. */
function champVCard(entite: any, champ: string): string | undefined {
  const v = entite?.vcardArray;
  if (!Array.isArray(v) || !Array.isArray(v[1])) return undefined;
  for (const ligne of v[1]) {
    if (Array.isArray(ligne) && ligne[0] === champ && typeof ligne[3] === "string") {
      return ligne[3];
    }
  }
  return undefined;
}

function parcourirEntites(entites: any[], visiter: (e: any) => void, profondeur = 0) {
  if (!Array.isArray(entites) || profondeur > 3) return;
  for (const e of entites) {
    visiter(e);
    parcourirEntites(e?.entities, visiter, profondeur + 1);
  }
}

const DOMAINE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/i;

function analyser(j: any, ip: string): FicheReseau {
  const fiche: FicheReseau = { ip };
  if (typeof j?.name === "string") fiche.reseau = j.name.slice(0, 80);
  // Les bornes du bloc décrit. Le registre les donne toujours ; on ne les
  // retient qu'en IPv4, où la comparaison est un simple entier.
  const d = typeof j?.startAddress === "string" ? enEntier(j.startAddress) : undefined;
  const f = typeof j?.endAddress === "string" ? enEntier(j.endAddress) : undefined;
  if (d !== undefined && f !== undefined && f >= d) { fiche.debut = d; fiche.fin = f; }
  if (typeof j?.country === "string") fiche.pays = codePays(j.country);
  if (Array.isArray(j?.rdapConformance)) {
    const src = String(j?.port43 || j?.links?.[0]?.value || "");
    const m = /(ripe|arin|apnic|lacnic|afrinic)/i.exec(src);
    if (m) fiche.registre = m[1].toUpperCase();
  }

  // Titulaire : la première entité qui porte un rôle de détenteur.
  let organisation: string | undefined;
  let domaine: string | undefined;
  parcourirEntites(j?.entities || [], (e) => {
    const roles: string[] = Array.isArray(e?.roles) ? e.roles : [];
    const nom = champVCard(e, "fn");
    if (!organisation && nom &&
        (roles.includes("registrant") || roles.includes("administrative") || roles.includes("technical"))) {
      organisation = nom.slice(0, 80);
    }
    // Le pays, quand il n'est pas à la racine de la fiche : dans l'adresse
    // postale du titulaire. C'est le cas de tout ce qui est enregistré chez
    // ARIN — Apple, Google, Amazon, Cloudflare.
    if (!fiche.pays) {
      const p = paysDeAdresse(e);
      if (p) fiche.pays = p;
    }
    // Le domaine ne peut venir que d'une adresse réellement inscrite au registre.
    const courriel = champVCard(e, "email");
    if (!domaine && typeof courriel === "string" && courriel.includes("@")) {
      const d = courriel.split("@").pop()!.trim().toLowerCase();
      if (DOMAINE.test(d)) domaine = d;
    }
  });
  if (organisation) fiche.organisation = organisation;
  if (domaine) fiche.domaine = domaine;
  return fiche;
}

async function interroger(ip: string): Promise<FicheReseau> {
  await attendreSonTour();
  const stop = new AbortController();
  const minuteur = setTimeout(() => stop.abort(), 6000);
  try {
    // rdap.org redirige vers le registre compétent : un seul point d'entrée
    // plutôt qu'une table des plages à tenir à jour.
    const r = await fetch(`https://rdap.org/ip/${encodeURIComponent(ip)}`, {
      signal: stop.signal,
      redirect: "follow",
      headers: { accept: "application/rdap+json, application/json" },
    });
    // 429 (trop de requêtes) et 5xx ne veulent pas dire « adresse inconnue » :
    // ils veulent dire « redemande plus tard ». Les confondre gravait un point
    // d'interrogation pour une heure sur une adresse parfaitement connue du
    // registre.
    if (r.status === 429 || r.status >= 500) {
      registreFache(Number(r.headers.get("retry-after")));
      return { ip, injoignable: true };
    }
    registreContent();
    if (!r.ok) return { ip };
    return analyser(await r.json(), ip);
  } catch {
    // Registre injoignable : ce n'est pas « cette adresse est inconnue », et
    // ça ne doit pas être mis en cache longuement.
    return { ip, injoignable: true };
  } finally {
    clearTimeout(minuteur);
  }
}

async function fiche(ip: string): Promise<FicheReseau> {
  const vu = cache.get(ip);
  if (vu && vu.expire > Date.now()) return vu.fiche;
  // Le bloc auquel appartient cette adresse a peut-être déjà été demandé pour
  // une autre : la réponse est la même, et elle ne coûte rien.
  const parBloc = prefixeConnu(ip);
  if (parBloc) return parBloc;
  const deja = enCours.get(ip);
  if (deja) return deja;

  const p = interroger(ip).then((f) => {
    // Une réponse vide est mise en cache brièvement : inutile de marteler le
    // registre pour une adresse qu'il ne connaît pas.
    const duree = f.organisation || f.reseau ? DUREE_CACHE : f.injoignable ? 60_000 : 3600_000;
    cache.set(ip, { fiche: f, expire: Date.now() + duree });
    if ((f.organisation || f.reseau) && f.debut !== undefined) {
      prefixes.push({ fiche: f, expire: Date.now() + DUREE_CACHE });
    }
    enCours.delete(ip);
    return f;
  }).catch(() => {
    enCours.delete(ip);
    return { ip } as FicheReseau;
  });
  enCours.set(ip, p);
  return p;
}

/** Ce que le service sait déjà, pour l'afficher plutôt que de le taire. */
export function etatRegistre() {
  return {
    prefixes: prefixes.length,
    adresses: cache.size,
    espacementMs: espacement,
    enAttente: prochaineFenetre > Date.now() ? prochaineFenetre - Date.now() : 0,
  };
}


/** Le réglage « world.rdap » à false coupe toute interrogation extérieure. */
export async function registreActif(): Promise<boolean> {
  const r = await prisma.setting.findUnique({ where: { key: "world.rdap" } }).catch(() => null);
  return !(r && r.value === false);
}

export { fiche as ficheRegistre, estIP as estIPPublique, estPrivee as estPriveeRdap };
