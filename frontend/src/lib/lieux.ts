// Codes de ville → coordonnées.
//
// Les grands hébergeurs nomment leurs points de présence d'après le code AITA
// de l'aéroport le plus proche : `par21s04-in-f14.1e100.net` sort de Paris,
// `edge-star-mini-shv-01-cdg4.facebook.com` aussi, `1.1.1.1` répond depuis un
// nom en `ams`, `fra`, `lhr` selon l'endroit d'où on l'interroge.
//
// C'est le seul repère géographique honnête dont on dispose sans base de
// géolocalisation : il vient du nom que la destination elle-même annonce.
// Quand le nom ne porte aucun code connu, la connexion est listée mais n'est
// pas tracée sur le globe — on ne devine pas.
//
// Coordonnées arrondies au dixième de degré, soit une dizaine de kilomètres :
// à l'échelle d'un globe, c'est le même pixel.

export interface Lieu { ville: string; lat: number; lon: number }

export const LIEUX: Record<string, Lieu> = {
  // ── Europe ──────────────────────────────────────────────────────────────
  ams: { ville: "Amsterdam", lat: 52.3, lon: 4.8 },
  cdg: { ville: "Paris", lat: 49.0, lon: 2.5 },
  par: { ville: "Paris", lat: 48.9, lon: 2.4 },
  ory: { ville: "Paris", lat: 48.7, lon: 2.4 },
  mrs: { ville: "Marseille", lat: 43.4, lon: 5.2 },
  lys: { ville: "Lyon", lat: 45.7, lon: 5.1 },
  bod: { ville: "Bordeaux", lat: 44.8, lon: -0.7 },
  lil: { ville: "Lille", lat: 50.6, lon: 3.1 },
  rbx: { ville: "Roubaix", lat: 50.7, lon: 3.2 },
  gra: { ville: "Gravelines", lat: 51.0, lon: 2.1 },
  sbg: { ville: "Strasbourg", lat: 48.5, lon: 7.6 },
  lhr: { ville: "Londres", lat: 51.5, lon: -0.5 },
  lon: { ville: "Londres", lat: 51.5, lon: -0.1 },
  man: { ville: "Manchester", lat: 53.4, lon: -2.3 },
  dub: { ville: "Dublin", lat: 53.4, lon: -6.3 },
  fra: { ville: "Francfort", lat: 50.0, lon: 8.6 },
  dus: { ville: "Düsseldorf", lat: 51.3, lon: 6.8 },
  muc: { ville: "Munich", lat: 48.4, lon: 11.8 },
  ber: { ville: "Berlin", lat: 52.4, lon: 13.5 },
  ham: { ville: "Hambourg", lat: 53.6, lon: 10.0 },
  zrh: { ville: "Zurich", lat: 47.5, lon: 8.5 },
  gva: { ville: "Genève", lat: 46.2, lon: 6.1 },
  vie: { ville: "Vienne", lat: 48.1, lon: 16.6 },
  bru: { ville: "Bruxelles", lat: 50.9, lon: 4.5 },
  mad: { ville: "Madrid", lat: 40.5, lon: -3.6 },
  bcn: { ville: "Barcelone", lat: 41.3, lon: 2.1 },
  lis: { ville: "Lisbonne", lat: 38.8, lon: -9.1 },
  mxp: { ville: "Milan", lat: 45.6, lon: 8.7 },
  mil: { ville: "Milan", lat: 45.5, lon: 9.2 },
  fco: { ville: "Rome", lat: 41.8, lon: 12.3 },
  cph: { ville: "Copenhague", lat: 55.6, lon: 12.6 },
  arn: { ville: "Stockholm", lat: 59.7, lon: 18.0 },
  osl: { ville: "Oslo", lat: 60.2, lon: 11.1 },
  hel: { ville: "Helsinki", lat: 60.3, lon: 25.0 },
  waw: { ville: "Varsovie", lat: 52.2, lon: 21.0 },
  prg: { ville: "Prague", lat: 50.1, lon: 14.3 },
  bud: { ville: "Budapest", lat: 47.4, lon: 19.3 },
  ath: { ville: "Athènes", lat: 37.9, lon: 23.9 },
  ist: { ville: "Istanbul", lat: 41.3, lon: 28.7 },
  otp: { ville: "Bucarest", lat: 44.6, lon: 26.1 },
  sof: { ville: "Sofia", lat: 42.7, lon: 23.4 },
  kbp: { ville: "Kiev", lat: 50.3, lon: 30.9 },
  svo: { ville: "Moscou", lat: 56.0, lon: 37.4 },
  dme: { ville: "Moscou", lat: 55.4, lon: 37.9 },
  led: { ville: "Saint-Pétersbourg", lat: 59.8, lon: 30.3 },
  kef: { ville: "Reykjavik", lat: 64.0, lon: -22.6 },

  // ── Amérique du Nord ────────────────────────────────────────────────────
  jfk: { ville: "New York", lat: 40.6, lon: -73.8 },
  ewr: { ville: "Newark", lat: 40.7, lon: -74.2 },
  nyc: { ville: "New York", lat: 40.7, lon: -74.0 },
  lga: { ville: "New York", lat: 40.8, lon: -73.9 },
  iad: { ville: "Washington", lat: 38.9, lon: -77.5 },
  dca: { ville: "Washington", lat: 38.9, lon: -77.0 },
  bwi: { ville: "Baltimore", lat: 39.2, lon: -76.7 },
  atl: { ville: "Atlanta", lat: 33.6, lon: -84.4 },
  mia: { ville: "Miami", lat: 25.8, lon: -80.3 },
  ord: { ville: "Chicago", lat: 42.0, lon: -87.9 },
  dfw: { ville: "Dallas", lat: 32.9, lon: -97.0 },
  iah: { ville: "Houston", lat: 30.0, lon: -95.3 },
  den: { ville: "Denver", lat: 39.9, lon: -104.7 },
  phx: { ville: "Phoenix", lat: 33.4, lon: -112.0 },
  lax: { ville: "Los Angeles", lat: 33.9, lon: -118.4 },
  sjc: { ville: "San José", lat: 37.4, lon: -121.9 },
  sfo: { ville: "San Francisco", lat: 37.6, lon: -122.4 },
  pao: { ville: "Palo Alto", lat: 37.5, lon: -122.1 },
  sea: { ville: "Seattle", lat: 47.4, lon: -122.3 },
  pdx: { ville: "Portland", lat: 45.6, lon: -122.6 },
  slc: { ville: "Salt Lake City", lat: 40.8, lon: -112.0 },
  msp: { ville: "Minneapolis", lat: 44.9, lon: -93.2 },
  dtw: { ville: "Détroit", lat: 42.2, lon: -83.4 },
  bos: { ville: "Boston", lat: 42.4, lon: -71.0 },
  phl: { ville: "Philadelphie", lat: 39.9, lon: -75.2 },
  clt: { ville: "Charlotte", lat: 35.2, lon: -80.9 },
  yyz: { ville: "Toronto", lat: 43.7, lon: -79.6 },
  yul: { ville: "Montréal", lat: 45.5, lon: -73.7 },
  yvr: { ville: "Vancouver", lat: 49.2, lon: -123.2 },
  mex: { ville: "Mexico", lat: 19.4, lon: -99.1 },

  // ── Amérique du Sud ─────────────────────────────────────────────────────
  gru: { ville: "São Paulo", lat: -23.4, lon: -46.5 },
  gig: { ville: "Rio de Janeiro", lat: -22.8, lon: -43.2 },
  eze: { ville: "Buenos Aires", lat: -34.8, lon: -58.5 },
  scl: { ville: "Santiago", lat: -33.4, lon: -70.8 },
  bog: { ville: "Bogota", lat: 4.7, lon: -74.1 },
  lim: { ville: "Lima", lat: -12.0, lon: -77.1 },

  // ── Asie ────────────────────────────────────────────────────────────────
  nrt: { ville: "Tokyo", lat: 35.8, lon: 140.4 },
  hnd: { ville: "Tokyo", lat: 35.5, lon: 139.8 },
  tyo: { ville: "Tokyo", lat: 35.7, lon: 139.7 },
  kix: { ville: "Osaka", lat: 34.4, lon: 135.2 },
  itm: { ville: "Osaka", lat: 34.8, lon: 135.4 },
  icn: { ville: "Séoul", lat: 37.5, lon: 126.4 },
  sel: { ville: "Séoul", lat: 37.6, lon: 127.0 },
  pek: { ville: "Pékin", lat: 40.1, lon: 116.6 },
  pvg: { ville: "Shanghai", lat: 31.1, lon: 121.8 },
  can: { ville: "Canton", lat: 23.4, lon: 113.3 },
  hkg: { ville: "Hong Kong", lat: 22.3, lon: 113.9 },
  tpe: { ville: "Taipei", lat: 25.1, lon: 121.2 },
  sin: { ville: "Singapour", lat: 1.4, lon: 104.0 },
  kul: { ville: "Kuala Lumpur", lat: 2.7, lon: 101.7 },
  bkk: { ville: "Bangkok", lat: 13.7, lon: 100.7 },
  cgk: { ville: "Jakarta", lat: -6.1, lon: 106.7 },
  mnl: { ville: "Manille", lat: 14.5, lon: 121.0 },
  bom: { ville: "Bombay", lat: 19.1, lon: 72.9 },
  del: { ville: "Delhi", lat: 28.6, lon: 77.1 },
  maa: { ville: "Chennai", lat: 13.0, lon: 80.2 },
  blr: { ville: "Bangalore", lat: 13.2, lon: 77.7 },
  hyd: { ville: "Hyderabad", lat: 17.2, lon: 78.4 },
  ccu: { ville: "Calcutta", lat: 22.7, lon: 88.4 },

  // ── Moyen-Orient ────────────────────────────────────────────────────────
  dxb: { ville: "Dubaï", lat: 25.3, lon: 55.4 },
  auh: { ville: "Abou Dabi", lat: 24.4, lon: 54.7 },
  doh: { ville: "Doha", lat: 25.3, lon: 51.6 },
  ruh: { ville: "Riyad", lat: 25.0, lon: 46.7 },
  jed: { ville: "Djeddah", lat: 21.7, lon: 39.2 },
  tlv: { ville: "Tel-Aviv", lat: 32.0, lon: 34.9 },
  bah: { ville: "Bahreïn", lat: 26.3, lon: 50.6 },

  // ── Afrique ─────────────────────────────────────────────────────────────
  jnb: { ville: "Johannesbourg", lat: -26.1, lon: 28.2 },
  cpt: { ville: "Le Cap", lat: -34.0, lon: 18.6 },
  los: { ville: "Lagos", lat: 6.6, lon: 3.3 },
  nbo: { ville: "Nairobi", lat: -1.3, lon: 36.9 },
  cai: { ville: "Le Caire", lat: 30.1, lon: 31.4 },
  cmn: { ville: "Casablanca", lat: 33.4, lon: -7.6 },
  tun: { ville: "Tunis", lat: 36.9, lon: 10.2 },
  alg: { ville: "Alger", lat: 36.7, lon: 3.2 },

  // ── Océanie ─────────────────────────────────────────────────────────────
  syd: { ville: "Sydney", lat: -33.9, lon: 151.2 },
  mel: { ville: "Melbourne", lat: -37.7, lon: 144.8 },
  bne: { ville: "Brisbane", lat: -27.4, lon: 153.1 },
  per: { ville: "Perth", lat: -31.9, lon: 116.0 },
  akl: { ville: "Auckland", lat: -37.0, lon: 174.8 },
};

/**
 * Cherche un code de ville dans un nom d'hôte.
 *
 * Les codes apparaissent en début d'étiquette, souvent suivis d'un numéro de
 * salle : `par21s04-in-f14`, `cdg4`, `ams16s32`, `fra-01`. On balaie donc les
 * étiquettes du nom et on retient le premier groupe de trois lettres reconnu.
 * On s'arrête avant le domaine enregistrable, pour ne pas prendre le « com »
 * d'un `.com` ou le « net » d'un `.net` pour une ville.
 */
export function lieuDepuisNom(nom?: string | null): (Lieu & { code: string }) | null {
  if (!nom) return null;
  const etiquettes = nom.toLowerCase().replace(/\.$/, "").split(".");
  const utiles = etiquettes.slice(0, Math.max(1, etiquettes.length - 2));
  for (const etq of utiles) {
    for (const morceau of etq.split(/[^a-z0-9]+/)) {
      const m = /^([a-z]{3})\d*$/.exec(morceau);
      const code = m ? m[1] : morceau.slice(0, 3);
      if (m && LIEUX[code]) return { ...LIEUX[code], code };
      // `par21s04` : le code colle au numéro de salle.
      const m2 = /^([a-z]{3})\d/.exec(morceau);
      if (m2 && LIEUX[m2[1]]) return { ...LIEUX[m2[1]], code: m2[1] };
    }
  }
  return null;
}

/** Domaine enregistrable, pour regrouper les destinations par opérateur. */
export function domaineDe(nom?: string | null): string | null {
  if (!nom) return null;
  const p = nom.toLowerCase().replace(/\.$/, "").split(".");
  if (p.length < 2) return null;
  // Suffixes à deux niveaux les plus courants.
  const doubles = ["co.uk", "com.au", "co.jp", "com.br", "co.kr", "com.cn", "net.cn", "org.uk", "gov.uk"];
  const deux = p.slice(-2).join(".");
  const trois = p.slice(-3).join(".");
  return doubles.includes(deux) && p.length >= 3 ? trois : deux;
}

// ─── Opérateurs ────────────────────────────────────────────────────────────
//
// Les grands réseaux répondent sous un domaine d'infrastructure qui ne dit
// rien à personne : `1e100.net` est à Google, `a-msedge.net` à Microsoft,
// `aaplimg.com` à Apple. Ce sont des faits publics, pas des suppositions : on
// les nomme, et on va chercher le logo sur le domaine que le public connaît.

export interface Operateur { nom: string; logo: string }

const OPERATEURS: Record<string, Operateur> = {
  "1e100.net": { nom: "Google", logo: "google.com" },
  "gstatic.com": { nom: "Google", logo: "google.com" },
  "googleusercontent.com": { nom: "Google", logo: "google.com" },
  "googlevideo.com": { nom: "YouTube", logo: "youtube.com" },
  "ytimg.com": { nom: "YouTube", logo: "youtube.com" },
  "gvt1.com": { nom: "Google", logo: "google.com" },
  "gvt2.com": { nom: "Google", logo: "google.com" },
  "a-msedge.net": { nom: "Microsoft", logo: "microsoft.com" },
  "msedge.net": { nom: "Microsoft", logo: "microsoft.com" },
  "trafficmanager.net": { nom: "Microsoft", logo: "microsoft.com" },
  "windowsupdate.com": { nom: "Microsoft", logo: "microsoft.com" },
  "aaplimg.com": { nom: "Apple", logo: "apple.com" },
  "apple-dns.net": { nom: "Apple", logo: "apple.com" },
  "icloud-content.com": { nom: "iCloud", logo: "icloud.com" },
  "fbcdn.net": { nom: "Meta", logo: "facebook.com" },
  "facebook.com": { nom: "Meta", logo: "facebook.com" },
  "instagram.com": { nom: "Instagram", logo: "instagram.com" },
  "whatsapp.net": { nom: "WhatsApp", logo: "whatsapp.com" },
  "akamaitechnologies.com": { nom: "Akamai", logo: "akamai.com" },
  "akamaiedge.net": { nom: "Akamai", logo: "akamai.com" },
  "akamai.net": { nom: "Akamai", logo: "akamai.com" },
  "cloudflare.com": { nom: "Cloudflare", logo: "cloudflare.com" },
  "cloudflare-dns.com": { nom: "Cloudflare", logo: "cloudflare.com" },
  "amazonaws.com": { nom: "Amazon Web Services", logo: "aws.amazon.com" },
  "cloudfront.net": { nom: "Amazon CloudFront", logo: "aws.amazon.com" },
  "fastly.net": { nom: "Fastly", logo: "fastly.com" },
  "fastly.com": { nom: "Fastly", logo: "fastly.com" },
  "edgecastcdn.net": { nom: "Edgio", logo: "edg.io" },
  "llnwd.net": { nom: "Edgio", logo: "edg.io" },
  "ovh.net": { nom: "OVHcloud", logo: "ovhcloud.com" },
  "scw.cloud": { nom: "Scaleway", logo: "scaleway.com" },
  "your-server.de": { nom: "Hetzner", logo: "hetzner.com" },
  "digitalocean.com": { nom: "DigitalOcean", logo: "digitalocean.com" },
  "linode.com": { nom: "Akamai (Linode)", logo: "linode.com" },
  "github.com": { nom: "GitHub", logo: "github.com" },
  "githubusercontent.com": { nom: "GitHub", logo: "github.com" },
  "netflix.com": { nom: "Netflix", logo: "netflix.com" },
  "nflxvideo.net": { nom: "Netflix", logo: "netflix.com" },
  "spotify.com": { nom: "Spotify", logo: "spotify.com" },
  "scdn.co": { nom: "Spotify", logo: "spotify.com" },
  "tiktokcdn.com": { nom: "TikTok", logo: "tiktok.com" },
  "ui.com": { nom: "Ubiquiti", logo: "ui.com" },
  "unifi.ui.com": { nom: "Ubiquiti", logo: "ui.com" },
  "synology.com": { nom: "Synology", logo: "synology.com" },
  "tuyaeu.com": { nom: "Tuya", logo: "tuya.com" },
  "tuya.com": { nom: "Tuya", logo: "tuya.com" },
  "debian.org": { nom: "Debian", logo: "debian.org" },
  "ubuntu.com": { nom: "Ubuntu", logo: "ubuntu.com" },
  "docker.com": { nom: "Docker", logo: "docker.com" },
  "docker.io": { nom: "Docker", logo: "docker.com" },
  "npmjs.org": { nom: "npm", logo: "npmjs.com" },
  "pool.ntp.org": { nom: "NTP Pool", logo: "ntppool.org" },
  "ntp.se": { nom: "Netnod (NTP)", logo: "netnod.se" },
};

/** Nom public d'un opérateur, quand son domaine d'infrastructure est connu. */
export function operateurDe(domaine?: string | null): Operateur | null {
  if (!domaine) return null;
  return OPERATEURS[domaine.toLowerCase()] || null;
}
