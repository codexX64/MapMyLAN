// Relevé des connexions sortantes.
//
// La source est l'équipement réseau enregistré dans la console SSH : c'est lui
// qui voit passer le trafic de tout le parc. On lui demande sa table de suivi
// de connexions, on ne garde que les destinations publiques, et on résout leur
// nom pour savoir d'où elles répondent.
//
// Trois principes :
//
//   1. rien n'est inventé. Une connexion affichée a été relevée sur
//      l'équipement, à la seconde près indiquée ;
//   2. rien n'est deviné. Une destination n'est placée sur le globe que si son
//      nom porte un code de ville reconnu. Sinon elle est listée sans arc ;
//   3. rien n'est injecté. Les adresses viennent du réseau, donc d'appareils
//      qui choisissent ce qu'ils déclarent : aucune n'entre dans une commande
//      sans avoir été reconnue comme adresse.

import { api } from "../api/client";
import { lieuDepuisNom, domaineDe, operateurDe, type Lieu } from "./lieux";
import { paysDe, type Pays } from "./pays";

export interface Connexion {
  cle: string;
  src: string;
  dst: string;
  port: number;
  proto: string;
  paquets?: number;
  octets?: number;
  nom?: string;
  domaine?: string;
  operateur?: string;
  logo?: string;
  /** Pays d'enregistrement du préfixe — pas une géolocalisation. */
  paysRegistre?: string;
  /** Nom du préfixe au registre, ex. CLOUDFLARENET. */
  reseau?: string;
  /** Première et dernière observation, en millisecondes. */
  premier?: number;
  dernier?: number;
  /** Nombre de relevés où ce flux est apparu. */
  vues?: number;
  lieu?: (Lieu & { code: string }) | null;
  /**
   * Point de repli, quand la ville est inconnue : le pays d'enregistrement du
   * préfixe. Ce n'est pas la position du serveur, et le dessin le distingue.
   */
  pays?: Pays | null;
  /** « sortant » : le parc est allé dehors. « entrant » : dehors est venu. */
  sens?: "sortant" | "entrant";
  /** Signalé par une règle du serveur, avec la phrase qui l'explique. */
  suspect?: boolean;
  raison?: string;
}

export interface Releve {
  connexions: Connexion[];
  commande: string;
  quand: number;
  equipement: string;
  erreur?: string;
  /** Vrai quand c'est la liaison SSH qui a lâché, pas la commande. */
  liaisonPerdue?: boolean;
}

/**
 * Une panne de liaison ne se traite pas comme une commande qui échoue.
 *
 * Si l'équipement refuse la connexion, essayer les cinq commandes à la suite
 * revient à frapper cinq fois à une porte close, toutes les quinze secondes.
 * Beaucoup de passerelles limitent le nombre de connexions SSH simultanées et
 * coupent alors avant même l'échange de bannière — c'est le sens du message
 * « Connection lost before handshake ». On s'arrête donc au premier signe.
 */
function estPanneDeLiaison(message: string): boolean {
  return /handshake|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EHOSTUNREACH|ENETUNREACH|timed out|timeout|closed by|Authentication|denied|refused|not connected|Socket/i
    .test(message);
}

// ─── Reconnaissance des adresses ───────────────────────────────────────────

export function estIPv4(v: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(v);
  if (!m) return false;
  return [1, 2, 3, 4].every((i) => {
    const n = Number(m[i]);
    // « 01 » et « 1 » désignent le même octet mais s'écrivent différemment :
    // les zéros de tête servent à contourner les filtres, on les refuse.
    return n >= 0 && n <= 255 && String(n) === m[i];
  });
}

export function estIPv6(v: string): boolean {
  if (v.length > 45 || !/^[0-9a-f:]+$/i.test(v)) return false;
  const parties = v.split("::");
  if (parties.length > 2) return false;
  const groupes = v.replace(/::/g, ":").split(":").filter(Boolean);
  if (groupes.some((g) => !/^[0-9a-f]{1,4}$/i.test(g))) return false;
  return parties.length === 2 ? groupes.length <= 7 : groupes.length === 8;
}

export const estIP = (v: string) => estIPv4(v) || estIPv6(v);

/** Une adresse joignable depuis l'extérieur, par opposition au réseau local. */
export function estPublique(ip: string): boolean {
  if (estIPv6(ip)) {
    const b = ip.toLowerCase();
    if (b === "::1" || b.startsWith("fe80") || b.startsWith("ff")) return false;
    if (/^f[cd]/.test(b)) return false;          // adresses uniques locales
    return true;
  }
  if (!estIPv4(ip)) return false;
  const [a, b] = ip.split(".").map(Number);
  if (a === 10 || a === 127 || a === 0) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 169 && b === 254) return false;      // lien-local
  if (a === 100 && b >= 64 && b <= 127) return false; // partage d'adresses
  if (a >= 224) return false;                    // multidiffusion et réservé
  return true;
}

// ─── Lecture de la table de suivi ──────────────────────────────────────────

// Les commandes sont essayées dans cet ordre. Les deux premières voient tout
// le parc ; les suivantes ne voient que les connexions de l'équipement
// lui-même, ce qui reste vrai mais bien plus étroit.
const COMMANDES = [
  "conntrack -L -p tcp --state ESTABLISHED 2>/dev/null | head -n 400",
  "conntrack -L 2>/dev/null | head -n 400",
  "cat /proc/net/nf_conntrack 2>/dev/null | head -n 400",
  "ss -tunH state established 2>/dev/null | head -n 400",
  "netstat -tun 2>/dev/null | head -n 400",
];

/** Ligne de conntrack ou de /proc/net/nf_conntrack. */
function lireConntrack(ligne: string): Connexion | null {
  if (!/\bsrc=/.test(ligne)) return null;
  const src = /\bsrc=(\S+)/.exec(ligne)?.[1];
  const dst = /\bdst=(\S+)/.exec(ligne)?.[1];
  const dport = /\bdport=(\d+)/.exec(ligne)?.[1];
  const proto = /^\s*(?:ipv[46]\s+\d+\s+)?(tcp|udp|icmp)\b/.exec(ligne)?.[1] || "tcp";
  const paquets = /\bpackets=(\d+)/.exec(ligne)?.[1];
  const octets = /\bbytes=(\d+)/.exec(ligne)?.[1];
  if (!src || !dst || !estIP(src) || !estIP(dst)) return null;
  const port = Number(dport || 0);
  return {
    cle: `${src}|${dst}|${port}`,
    src, dst, port, proto,
    paquets: paquets ? Number(paquets) : undefined,
    octets: octets ? Number(octets) : undefined,
  };
}

/** Ligne de `ss` ou de `netstat`. */
function lireSocket(ligne: string): Connexion | null {
  const champs = ligne.trim().split(/\s+/);
  if (champs.length < 5) return null;
  const proto = /^(tcp|udp)/i.exec(champs[0])?.[1]?.toLowerCase() || "tcp";
  // Les deux dernières colonnes utiles sont « local » puis « distant ».
  const paire = champs.filter((c) => /:\d+$/.test(c));
  if (paire.length < 2) return null;
  const decoupe = (v: string) => {
    const i = v.lastIndexOf(":");
    const hote = v.slice(0, i).replace(/^\[|\]$/g, "");
    return { hote, port: Number(v.slice(i + 1)) };
  };
  const local = decoupe(paire[paire.length - 2]);
  const distant = decoupe(paire[paire.length - 1]);
  if (!estIP(local.hote) || !estIP(distant.hote)) return null;
  return {
    cle: `${local.hote}|${distant.hote}|${distant.port}`,
    src: local.hote, dst: distant.hote, port: distant.port, proto,
  };
}

const cacheNoms = new Map<string, string | null>();

/**
 * Résolution inverse, sur l'équipement lui-même — c'est le seul endroit d'où
 * une requête DNS peut partir, le navigateur n'en est pas capable.
 * Les adresses sont vérifiées une par une avant d'entrer dans la commande.
 */
async function resoudreNoms(sshId: string, adresses: string[]): Promise<void> {
  const aFaire = adresses.filter((ip) => !cacheNoms.has(ip) && estIP(ip)).slice(0, 40);
  if (!aFaire.length) return;

  const liste = aFaire.join(" ");
  const commande =
    `for i in ${liste}; do ` +
    `r=$(dig +short -x $i 2>/dev/null | head -n 1); ` +
    `[ -z "$r" ] && r=$(nslookup $i 2>/dev/null | awk '/name =/{print $NF; exit}'); ` +
    `[ -z "$r" ] && r=$(getent hosts $i 2>/dev/null | awk '{print $2; exit}'); ` +
    `echo "$i ${"${r%.}"}"; done`;

  try {
    const r = await api.execSsh(sshId, commande);
    for (const ligne of String(r.stdout || "").split("\n")) {
      const [ip, nom] = ligne.trim().split(/\s+/);
      if (!ip || !estIP(ip)) continue;
      cacheNoms.set(ip, nom && nom !== ip && /^[a-z0-9.-]+$/i.test(nom) ? nom : null);
    }
  } catch {
    // Pas de résolveur sur l'équipement, ou liaison coupée : les destinations
    // resteront des adresses, listées mais non situées. On ne réessaie pas
    // dans la foulée — ce serait une connexion SSH de plus pour rien.
  }
  for (const ip of aFaire) if (!cacheNoms.has(ip)) cacheNoms.set(ip, null);
}

/** Adresse appartenant à un espace privé, au sens des RFC. */
export function estPrivee(ip: string): boolean {
  return estIP(ip) && !estPublique(ip);
}

/**
 * Un relevé complet : connexions sortantes vues par l'équipement, nommées et
 * situées quand c'est possible.
 *
 * `estLocale` dit quelles adresses sources appartiennent au parc. Par défaut
 * ce sont les espaces privés, mais un réseau peut fort bien utiliser d'autres
 * plages : la page fournit alors les adresses réellement recensées, ce qui
 * évite de jeter des connexions parfaitement légitimes.
 */

// ── Identification par les registres ────────────────────────────────────────
//
// Le DNS inverse ne répond pas pour tout : un préfixe Cloudflare ou Apple n'a
// souvent aucun PTR, et l'adresse reste nue. Le registre, lui, sait toujours à
// qui le préfixe est attribué. On le lui demande, par le backend — le
// navigateur n'a ni le droit ni les moyens d'interroger un service RDAP.
//
// Ce qui en revient est déclaré au registre, pas supposé : le nom de
// l'organisation, le nom du préfixe, et un domaine seulement s'il figure
// vraiment dans la fiche.
export interface FicheRegistre {
  ip: string;
  reseau?: string;
  organisation?: string;
  pays?: string;
  domaine?: string;
  registre?: string;
}

const cacheRegistre = new Map<string, FicheRegistre>();
let registreCoupe = false;

async function identifier(ips: string[]): Promise<void> {
  if (registreCoupe) return;
  const manquants = ips.filter((ip) => !cacheRegistre.has(ip));
  if (manquants.length === 0) return;

  for (let i = 0; i < manquants.length; i += 32) {
    const lot = manquants.slice(i, i + 32);
    try {
      const r = await api.whois(lot);
      if (r && r.actif === false) { registreCoupe = true; return; }
      for (const f of r?.fiches || []) cacheRegistre.set(f.ip, f);
      // Une adresse sans réponse est mémorisée vide : on ne la redemande pas
      // à chaque relevé.
      for (const ip of lot) if (!cacheRegistre.has(ip)) cacheRegistre.set(ip, { ip });
    } catch {
      return;   // backend muet : on garde les adresses telles quelles
    }
  }
}


// ── Lecture de l'historique tenu par le serveur ─────────────────────────────
//
// La collecte ne se fait plus ici : elle tourne dans le backend, en continu.
// L'interface ne fait que lire, ce qui a trois conséquences visibles — le
// journal survit à un changement de page, il continue de se remplir onglet
// fermé, et la passerelle n'est interrogée qu'une fois quel que soit le nombre
// d'onglets ouverts.

export interface EtatTrafic {
  equipement?: string;
  quand?: number;
  commande?: string;
  erreur?: string;
  liaisonPerdue?: boolean;
  fluxVus?: number;
  cible: { id: string; nom: string; hote: string; port: number } | null;
  ecartees: { id: string; nom: string; hote: string; port: number; transport: string }[];
  total: number;
  tailleMo: number;
  plusAncien: number | null;
  retentionJours: number;
  retentionMaxMo: number;
}

export async function etatTrafic(): Promise<EtatTrafic> {
  return api.trafficState();
}

/** Complète une ligne du serveur avec ce qui se déduit côté interface. */
function habiller(f: any): Connexion {
  const c: Connexion = {
    cle: f.id,
    src: f.src, dst: f.dst, port: f.port, proto: f.proto,
    octets: f.octets || undefined,
    paquets: f.paquets || undefined,
    nom: f.nom, domaine: f.domaine,
    operateur: f.operateur, logo: f.logo,
    paysRegistre: f.paysRegistre,
    premier: f.premier, dernier: f.dernier, vues: f.vues,
    sens: f.sens === "entrant" ? "entrant" : "sortant",
    suspect: f.suspect === true,
    raison: f.raison,
  };
  // Deux niveaux, jamais confondus :
  //   la ville, déduite d'un nom d'hôte portant un code d'aéroport reconnu —
  //   c'est une position ;
  //   à défaut, le pays d'enregistrement du préfixe au registre — c'est une
  //   déclaration administrative, pas une position.
  c.lieu = lieuDepuisNom(f.nom);
  if (!c.lieu) c.pays = paysDe(f.paysRegistre) || null;
  const op = operateurDe(c.domaine);
  if (op) { c.operateur = op.nom; c.logo = op.logo || c.logo; }
  return c;
}

/**
 * Les flux, du plus récemment vu au plus ancien.
 *   depuis — ne rend que ce qui a bougé après cet instant (rafraîchissement)
 *   avant  — ne rend que ce qui est plus ancien (descente dans l'historique)
 */
export async function lireFlux(opts: { limite?: number; depuis?: number; avant?: number } = {}): Promise<Connexion[]> {
  const flux = await api.trafficFlows(opts);
  return (flux || []).map(habiller);
}

export async function relever(
  sshId: string,
  nomEquipement: string,
  estLocale: (ip: string) => boolean = estPrivee,
  commandePreferee?: string,
): Promise<Releve> {
  let brut = "";
  let commande = "";
  let derniereErreur = "";
  let liaisonPerdue = false;

  // Une fois qu'une commande a fonctionné, c'est elle qu'on rappelle. Le
  // parcours des cinq possibilités n'a lieu qu'à la première ouverture.
  const aEssayer = commandePreferee
    ? [commandePreferee, ...COMMANDES.filter((c) => c !== commandePreferee)]
    : COMMANDES;

  for (const c of aEssayer) {
    try {
      const r = await api.execSsh(sshId, c);
      const sortie = String(r.stdout || "").trim();
      if (sortie.length > 0) { brut = sortie; commande = c; break; }
      if (r.stderr) derniereErreur = String(r.stderr).trim().slice(0, 200);
    } catch (e: any) {
      derniereErreur = e?.message || String(e);
      if (estPanneDeLiaison(derniereErreur)) { liaisonPerdue = true; break; }
    }
  }

  if (!brut) {
    return {
      connexions: [], commande: commande || aEssayer[0], quand: Date.now(),
      equipement: nomEquipement, liaisonPerdue,
      erreur: derniereErreur || "Aucune des commandes de relevé n'a produit de sortie.",
    };
  }

  const parPaire = new Map<string, Connexion>();
  for (const ligne of brut.split("\n")) {
    const c = lireConntrack(ligne) || lireSocket(ligne);
    if (!c) continue;
    if (!estPublique(c.dst)) continue;
    if (estLocale(c.dst)) continue;     // une machine du parc n'est pas l'extérieur
    if (!estLocale(c.src)) continue;    // on ne garde que ce qui sort du parc
    const existant = parPaire.get(c.cle);
    if (existant) {
      existant.octets = (existant.octets || 0) + (c.octets || 0);
      existant.paquets = (existant.paquets || 0) + (c.paquets || 0);
    } else {
      parPaire.set(c.cle, c);
    }
  }

  const connexions = [...parPaire.values()];
  const destinations = [...new Set(connexions.map((c) => c.dst))];
  await resoudreNoms(sshId, destinations);

  // Ce que le DNS inverse n'a pas nommé, le registre le nommera peut-être.
  await identifier(destinations.filter((ip) => !cacheNoms.get(ip)));

  for (const c of connexions) {
    const nom = cacheNoms.get(c.dst) || undefined;
    c.nom = nom;
    c.domaine = domaineDe(nom) || undefined;
    const op = operateurDe(c.domaine);
    c.operateur = op?.nom;
    c.logo = op?.logo || c.domaine;
    c.lieu = lieuDepuisNom(nom);

    // Sans nom d'hôte, on retombe sur la fiche du registre. Elle donne le
    // titulaire du préfixe et, quand il y figure, le domaine de son contact —
    // de quoi afficher un nom et un logo au lieu d'une adresse nue.
    if (!c.operateur) {
      const f = cacheRegistre.get(c.dst);
      if (f) {
        c.reseau = f.reseau;
        c.paysRegistre = f.pays;
        if (f.organisation || f.reseau) c.operateur = f.organisation || f.reseau;
        if (!c.logo && f.domaine) {
          c.logo = f.domaine;
          if (!c.domaine) c.domaine = f.domaine;
        }
      }
    }
  }

  return { connexions, commande, quand: Date.now(), equipement: nomEquipement };
}

/**
 * Une entrée de la console SSH, avec ce qu'on sait de sa joignabilité.
 *
 * Le routeur principal et les connexions SSH partagent la même table côté
 * serveur. Un contrôleur UniFi y est donc enregistré comme « équipement
 * principal » alors qu'il ne parle pas SSH sur le port stocké : son transport
 * est « api » et son port est 443. Lancer un relevé dessus ne peut produire
 * qu'un « Connection lost before handshake ». On le repère avant d'essayer.
 */
export interface Cible {
  id: string;
  name: string;
  host: string;
  port: number;
  principal: boolean;
  /** Voie de pilotage enregistrée : « ssh » ou « api ». */
  transport: string;
  /** Faux pour un équipement joint par API locale, ou sur un port web. */
  interrogeable: boolean;
}

/** Ports où un service web répond, jamais un shell. */
const PORTS_WEB = new Set([80, 443, 8080, 8443, 8843, 8880]);

/**
 * Cette entrée porte-t-elle un shell ?
 *
 * Règle unique, partagée avec la console SSH : un équipement joint par son API
 * locale, ou déclaré sur un port web, n'a rien à quoi ouvrir une session. Il n'a
 * donc à apparaître ni dans le relevé de trafic ni dans la liste des consoles.
 */
export function estInterrogeable(entree: any): boolean {
  const port = Number(entree?.port) || 22;
  return entree?.transport !== "api" && !PORTS_WEB.has(port);
}

export const CLE_CIBLE = "mapmylan_trafic_cible";

export async function ciblesDeReleve(): Promise<Cible[]> {
  const liste = await api.listSsh();
  if (!Array.isArray(liste)) return [];
  return liste.map((d: any) => {
    const port = Number(d.port) || 22;
    return {
      id: d.id,
      name: d.name || d.host,
      host: d.host,
      port,
      principal: !!d.isMainRouter,
      transport: d.transport === "api" ? "api" : "ssh",
      interrogeable: estInterrogeable(d),
    };
  });
}

/**
 * Choisit l'équipement à interroger : celui retenu la dernière fois s'il tient
 * toujours, sinon l'équipement principal, sinon la première entrée utilisable.
 */
export async function choisirCible(prefere?: string): Promise<{ cibles: Cible[]; cible: Cible | null }> {
  const cibles = await ciblesDeReleve();
  const utiles = cibles.filter((c) => c.interrogeable);
  const cible =
    (prefere ? utiles.find((c) => c.id === prefere) : undefined) ||
    utiles.find((c) => c.principal) ||
    utiles[0] ||
    null;
  return { cibles, cible };
}

/** Compatibilité : l'ancien point d'entrée, sans choix explicite. */
export async function equipementDeReleve(): Promise<{ id: string; name: string } | null> {
  const { cible } = await choisirCible();
  return cible ? { id: cible.id, name: cible.name } : null;
}
