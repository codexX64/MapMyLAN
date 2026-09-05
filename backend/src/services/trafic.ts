// Collecte continue du trafic sortant.
//
// Le relevé se faisait depuis le navigateur : fermer l'onglet arrêtait tout, et
// changer de page effaçait l'historique. Il est ici, dans le backend, pour deux
// raisons qui tiennent :
//
//   1. l'historique doit continuer de se construire quand personne ne regarde ;
//   2. une seule boucle interroge la passerelle, quel que soit le nombre
//      d'onglets ouverts — c'est ce qui évite de la marteler en SSH.
//
// Rien n'est inventé : une ligne enregistrée a été lue dans la table de suivi
// de connexions de l'équipement, à la seconde indiquée.

import { randomUUID } from "node:crypto";
import { prisma } from "../db";
import { executeOnDevice } from "./ssh";
import { reverse as dnsInverseRappel } from "node:dns";
import { promisify } from "node:util";
const dnsInverse = promisify(dnsInverseRappel);
import { logEvent } from "./logger";
import { eventBus } from "../ws/realtime";
import { ficheRegistre, registreActif, dansLePrefixe, type FicheReseau } from "./registre";


/**
 * Lecture SQL brute, ramenée à un tableau de lignes.
 *
 * `$queryRawUnsafe` est typé `unknown` par le client Prisma généré : chaque
 * appel devait être casté, et un cast oublié ne se voyait qu'à la compilation
 * en production. Une seule fonction, un seul cast, et l'erreur est rendue
 * impossible ailleurs.
 */
export async function lignesSql(sql: string, ...params: any[]): Promise<any[]> {
  try {
    const r = await prisma.$queryRawUnsafe(sql, ...params);
    return (r as unknown as any[]) || [];
  } catch { return []; }
}

// ── Adresses ────────────────────────────────────────────────────────────────

const IPV4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
const IPV6 = /^[0-9a-fA-F:]{2,45}$/;
export const estIP = (s: string) => IPV4.test(s) || (IPV6.test(s) && s.includes(":"));

export function estPrivee(ip: string): boolean {
  if (ip.includes(":")) {
    const b = ip.toLowerCase();
    return b === "::1" || b.startsWith("fe80") || b.startsWith("fc") || b.startsWith("fd");
  }
  const [a, b] = ip.split(".").map(Number);
  return a === 10 || a === 127 || a === 0 || a >= 224 ||
         (a === 172 && b >= 16 && b <= 31) ||
         (a === 192 && b === 168) ||
         (a === 169 && b === 254) ||
         (a === 100 && b >= 64 && b <= 127);
}

// ── Lecture des tables de suivi ─────────────────────────────────────────────

const COMMANDES = [
  "conntrack -L -p tcp --state ESTABLISHED 2>/dev/null | head -n 400",
  "conntrack -L 2>/dev/null | head -n 400",
  "cat /proc/net/nf_conntrack 2>/dev/null | head -n 400",
  "ss -tunH state established 2>/dev/null | head -n 400",
  "netstat -tun 2>/dev/null | head -n 400",
];

export interface FluxBrut {
  src: string; dst: string; port: number; proto: string;
  octets: number; paquets: number;
  /** « sortant » : le parc va vers l'extérieur. « entrant » : l'inverse. */
  direction: "sortant" | "entrant";
}

/** Un tuple de conntrack : qui parle à qui, sur quels ports. */
interface Tuple { src: string; dst: string; sport: number; dport: number }

/**
 * Une ligne de conntrack.
 *
 * Elle porte deux tuples : l'aller tel que la connexion a été ouverte, et le
 * retour tel qu'il revient. Sur une passerelle qui fait de la traduction
 * d'adresses, les deux ne se ressemblent pas, et c'est le second qui porte
 * l'information qui manquait :
 *
 *   sortie   src=<machine du parc> dst=<serveur>   src=<serveur> dst=<adresse WAN>
 *   entrée   src=<visiteur> dst=<adresse WAN>      src=<machine du parc> dst=<visiteur>
 *
 * En ne lisant que l'aller, une connexion entrante ressemblait à deux adresses
 * publiques qui se parlent — donc à rien du tout, et elle était jetée. Le parc
 * n'y apparaît que dans le retour.
 */
function tuplesConntrack(ligne: string): { proto: string; octets: number; paquets: number; tuples: Tuple[] } | null {
  if (!/src=/.test(ligne)) return null;
  const proto = /^\s*(tcp|udp)/i.exec(ligne)?.[1]?.toLowerCase()
             || /\b(tcp|udp)\b/i.exec(ligne)?.[1]?.toLowerCase() || "tcp";

  const src = [...ligne.matchAll(/src=(\S+)/g)].map((m) => m[1]);
  const dst = [...ligne.matchAll(/dst=(\S+)/g)].map((m) => m[1]);
  const sport = [...ligne.matchAll(/sport=(\d+)/g)].map((m) => Number(m[1]));
  const dport = [...ligne.matchAll(/dport=(\d+)/g)].map((m) => Number(m[1]));

  const tuples: Tuple[] = [];
  for (let i = 0; i < Math.min(src.length, dst.length); i++) {
    tuples.push({ src: src[i], dst: dst[i], sport: sport[i] || 0, dport: dport[i] || 0 });
  }
  if (!tuples.length) return null;

  // Les compteurs n'existent que si le noyau les tient ; on prend la somme des
  // deux sens quand ils sont là, zéro sinon. Jamais d'estimation.
  const octets = [...ligne.matchAll(/bytes=(\d+)/g)].reduce((t, m) => t + Number(m[1]), 0);
  const paquets = [...ligne.matchAll(/packets=(\d+)/g)].reduce((t, m) => t + Number(m[1]), 0);
  return { proto, octets, paquets, tuples };
}

/**
 * Range une ligne de conntrack du bon côté.
 *
 * Deux règles, et elles s'excluent : une connexion ne peut pas être sortante et
 * entrante à la fois, donc rien n'est compté deux fois.
 *
 *   sortante — l'aller part d'une adresse du parc vers une adresse publique.
 *              Le port qui compte est celui atteint au loin.
 *   entrante — le retour part d'une adresse du parc vers une adresse publique.
 *              Le port qui compte est celui **ouvert chez nous**, c'est-à-dire
 *              le port source du retour.
 */
function classer(
  l: { proto: string; octets: number; paquets: number; tuples: Tuple[] },
  estLocale: (ip: string) => boolean,
): FluxBrut | null {
  const [aller, retour] = l.tuples;
  const commun = { proto: l.proto, octets: l.octets, paquets: l.paquets };

  if (aller && estIP(aller.src) && estIP(aller.dst)
      && estLocale(aller.src) && !estLocale(aller.dst)) {
    return { ...commun, src: aller.src, dst: aller.dst, port: aller.dport, direction: "sortant" };
  }

  if (retour && estIP(retour.src) && estIP(retour.dst)
      && estLocale(retour.src) && !estLocale(retour.dst)) {
    return { ...commun, src: retour.src, dst: retour.dst, port: retour.sport, direction: "entrant" };
  }

  return null;
}

/** Une ligne de « ss » ou « netstat » : adresse:port de part et d'autre. */
function lireSocket(ligne: string): FluxBrut | null {
  const champs = ligne.trim().split(/\s+/);
  if (champs.length < 5) return null;
  const proto = /udp/i.test(champs[0]) ? "udp" : "tcp";
  const coupe = (s: string) => {
    const i = s.lastIndexOf(":");
    if (i < 0) return null;
    return { ip: s.slice(0, i).replace(/^\[|\]$/g, ""), port: Number(s.slice(i + 1)) };
  };
  const a = coupe(champs[champs.length - 2]);
  const b = coupe(champs[champs.length - 1]);
  if (!a || !b || !estIP(a.ip) || !estIP(b.ip)) return null;
  // « ss » et « netstat » ne disent pas qui a ouvert la connexion : on ne peut
  // donc pas distinguer une entrée d'une sortie. On ne devine pas, on range en
  // sortant — c'est ce que ce recours donnait déjà avant.
  return { src: a.ip, dst: b.ip, port: b.port, proto, octets: 0, paquets: 0, direction: "sortant" };
}

// ── Choix de l'équipement ───────────────────────────────────────────────────

const PORTS_WEB = new Set([80, 443, 8080, 8443, 8843, 8880]);

export async function cibleDeReleve() {
  const liste = await prisma.sshDevice.findMany({
    select: { id: true, name: true, host: true, port: true, transport: true, isMainRouter: true },
  });
  const utiles = liste.filter((d) => d.transport !== "api" && !PORTS_WEB.has(d.port));
  return utiles.find((d) => d.isMainRouter) || utiles[0] || null;
}

// ── Résolution des noms inverses ────────────────────────────────────────────
//
// Le nom inverse (l'enregistrement PTR) est ce qui donne un DOMAINE à une
// adresse, et un domaine est ce qui donne un logo. C'est donc la source la
// plus rentable de la page, avant même le registre : « 17.253.37.195 » devient
// « apple.com », « 18.213.159.67 » devient « amazonaws.com ».
//
// Ces lectures se faisaient sur la passerelle, par SSH, quarante adresses par
// tour. Une passerelle n'apporte pourtant rien ici : un PTR d'adresse publique
// est le même depuis n'importe où. Le détour coûtait une connexion SSH, une
// dépendance à `dig` ou `nslookup` sur un micrologiciel qu'on ne choisit pas,
// et surtout ce plafond de quarante — mille quatre cents destinations
// demandaient alors trois heures. On résout donc ici, en parallèle, avec le
// résolveur du conteneur.

const cacheNoms = new Map<string, string>();

/** Nombre d'adresses résolues par tour et parallélisme. Le résolveur local
 *  encaisse sans difficulté ; c'est le réseau qui décide, pas nous. */
const NOMS_PAR_TOUR = 400;
const NOMS_EN_PARALLELE = 24;

/** Un PTR, ou la chaîne vide si l'adresse n'en a pas. Jamais d'exception. */
async function nomInverse(ip: string): Promise<string> {
  try {
    const noms = await Promise.race([
      dnsInverse(ip),
      new Promise<string[]>((r) => setTimeout(() => r([]), 2500)),
    ]);
    return (noms[0] || "").replace(/\.$/, "");
  } catch {
    // « Pas de PTR » est une réponse, pas une panne : on la retient comme
    // telle pour ne pas redemander à chaque relevé.
    return "";
  }
}

async function resoudreNoms(_sshId: string, ips: string[]): Promise<void> {
  const manquants = ips.filter((ip) => !cacheNoms.has(ip) && estIP(ip)).slice(0, NOMS_PAR_TOUR);
  if (!manquants.length) return;

  let i = 0;
  const ouvriers = Array.from({ length: Math.min(NOMS_EN_PARALLELE, manquants.length) }, async () => {
    for (;;) {
      const k = i++;
      if (k >= manquants.length) return;
      const ip = manquants[k];
      cacheNoms.set(ip, await nomInverse(ip));
    }
  });
  await Promise.all(ouvriers);
}

/** Le domaine enregistrable d'un nom d'hôte, sans la table publique des suffixes. */
function domaineDe(nom?: string): string | undefined {
  if (!nom) return undefined;
  const p = nom.toLowerCase().replace(/\.$/, "").split(".");
  if (p.length < 2) return undefined;
  const deuxNiveaux = /^(co|com|net|org|gov|edu|ac|or|ne)\.[a-z]{2}$/;
  const fin2 = p.slice(-2).join(".");
  return deuxNiveaux.test(fin2) && p.length >= 3 ? p.slice(-3).join(".") : fin2;
}

// ── Ce qui est signalé, et pourquoi ─────────────────────────────────────────
//
// Trois règles, écrites ici et nulle part ailleurs. Aucune note composite,
// aucun seuil deviné : un flux est signalé parce qu'une phrase vraie peut être
// écrite à côté, et cette phrase est celle que l'écran affiche.
//
// Ce qui n'est **pas** une règle, et pourquoi : une connexion entrante n'est
// pas suspecte en soi. Un service publié, un tunnel, un jeu en ligne en
// ouvrent en permanence. La signaler systématiquement noierait les trois cas
// qui méritent un regard sous des dizaines qui n'en méritent aucun.

/** Ports qui n'ont rien à faire ouverts sur l'extérieur. */
const PORTS_SENSIBLES = new Map<number, string>([
  [21, "FTP"], [22, "SSH"], [23, "Telnet"], [135, "RPC"], [139, "NetBIOS"],
  [445, "SMB"], [1433, "SQL Server"], [3306, "MySQL"], [3389, "Bureau à distance"],
  [5432, "PostgreSQL"], [5900, "VNC"], [6379, "Redis"], [9200, "Elasticsearch"],
  [11211, "Memcached"], [27017, "MongoDB"],
]);

export interface Marque { suspect: boolean; raison: string | null }

export function juger(f: FluxBrut, appareil?: any): Marque {
  // 1. Un service sensible atteint depuis l'extérieur. C'est le cas qui doit
  //    sauter aux yeux : une base de données ou un accès distant joignable
  //    depuis Internet est une porte, qu'elle soit voulue ou non.
  if (f.direction === "entrant" && PORTS_SENSIBLES.has(f.port)) {
    return {
      suspect: true,
      raison: `${PORTS_SENSIBLES.get(f.port)} (port ${f.port}) atteint depuis l'extérieur`,
    };
  }

  // 2. L'appareil est déjà tenu à l'écart dans MapMyLAN. S'il parle encore,
  //    c'est en soi ce qu'on voulait savoir.
  const etat = String(appareil?.status || "");
  if (etat === "banned" || etat === "quarantined" || etat === "suspect") {
    const mot = etat === "banned" ? "banni" : etat === "quarantined" ? "en quarantaine" : "signalé";
    return { suspect: true, raison: `l'appareil est ${mot} et communique encore` };
  }

  // 3. Une note de risque déjà haute, calculée ailleurs par le moteur de
  //    scoring. On ne la recalcule pas ici, on la relaie.
  const note = Number(appareil?.dangerScore || 0);
  if (note >= 75) {
    return { suspect: true, raison: `note de risque de l'appareil : ${note}/100` };
  }

  return { suspect: false, raison: null };
}

// ── État observable ─────────────────────────────────────────────────────────

export interface EtatCollecte {
  equipement?: string;
  quand?: number;
  commande?: string;
  erreur?: string;
  liaisonPerdue?: boolean;
  fluxVus?: number;
}
let etat: EtatCollecte = {};
export const etatCollecte = () => etat;

function estPanneDeLiaison(message: string): boolean {
  return /handshake|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EHOSTUNREACH|ENETUNREACH|timed out|timeout|closed by|Authentication|denied|refused|not connected|Socket/i
    .test(message);
}

// ── Un tour de collecte ─────────────────────────────────────────────────────

let commandeRetenue: string | undefined;

/**
 * Applique une fiche de registre à tout ce qui dort déjà en base dans le même
 * bloc et n'a pas de titulaire.
 *
 * Sans ça, une destination écrite avant que le registre ne réponde reste un
 * point d'interrogation pour toujours : elle n'est réinterrogée que si du
 * trafic repart vers elle. Le registre a déclaré le bloc entier — l'appliquer
 * au bloc entier n'ajoute aucune supposition.
 */
async function rattraperLePasse(f: FicheReseau): Promise<void> {
  if (f.debut === undefined || f.fin === undefined) return;
  const nom = f.organisation || f.reseau;
  if (!nom) return;
  const enTexte = (n: number) =>
    [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join(".");
  try {
    await prisma.$executeRawUnsafe(
      `UPDATE "TrafficFlow"
          SET "operator" = COALESCE("operator", $1),
              "country"  = COALESCE("country", $2),
              "domain"   = COALESCE("domain", $3),
              "logo"     = COALESCE("logo", $3)
        WHERE "dstIp" ~ '^[0-9.]+$'
          AND "dstIp"::inet >= $4::inet
          AND "dstIp"::inet <= $5::inet
          AND ("operator" IS NULL OR "operator" = '')`,
      nom, f.pays || null, f.domaine || null, enTexte(f.debut), enTexte(f.fin),
    );
  } catch { /* le rattrapage est un confort, jamais un bloquant */ }
}

export async function collecter(): Promise<EtatCollecte> {
  const cible = await cibleDeReleve();
  if (!cible) { etat = { erreur: "Aucun équipement interrogeable." }; return etat; }

  const aEssayer = commandeRetenue
    ? [commandeRetenue, ...COMMANDES.filter((c) => c !== commandeRetenue)]
    : COMMANDES;

  let brut = "", commande = "", derniereErreur = "", liaisonPerdue = false;
  for (const c of aEssayer) {
    try {
      const r = await executeOnDevice(cible.id, c);
      const sortie = String(r.stdout || "").trim();
      if (sortie) { brut = sortie; commande = c; break; }
      if (r.stderr) derniereErreur = String(r.stderr).trim().slice(0, 200);
    } catch (e: any) {
      derniereErreur = e?.message || String(e);
      // Un équipement qui refuse la connexion la refusera encore : on n'essaie
      // pas les cinq commandes, ce serait cinq ouvertures SSH pour rien.
      if (estPanneDeLiaison(derniereErreur)) { liaisonPerdue = true; break; }
    }
  }

  if (!brut) {
    etat = {
      equipement: cible.name, quand: Date.now(), liaisonPerdue,
      erreur: derniereErreur || "Aucune des commandes de relevé n'a produit de sortie.",
    };
    return etat;
  }
  commandeRetenue = commande;

  // Les adresses du parc : une destination qui en fait partie n'est pas
  // « l'extérieur », et une source qui n'en fait pas partie n'est pas à nous.
  const appareils = await prisma.device.findMany({
    select: { ip: true, status: true, dangerScore: true, customName: true, hostname: true },
  });
  const duParc = new Set(appareils.map((d) => d.ip).filter(Boolean) as string[]);
  const parIp = new Map(appareils.map((d: any) => [d.ip, d]));
  const estLocale = (ip: string) => estPrivee(ip) || duParc.has(ip);

  const parCle = new Map<string, FluxBrut>();
  for (const ligne of brut.split("\n")) {
    const l = tuplesConntrack(ligne);
    const f = l ? classer(l, estLocale) : lireSocket(ligne);
    if (!f) continue;
    if (!estIP(f.dst) || !estIP(f.src)) continue;
    // Le classement a déjà tranché pour conntrack ; ce garde-fou couvre le
    // recours par « ss », qui ne dit pas qui a ouvert la connexion.
    if (estLocale(f.dst) || !estLocale(f.src)) continue;
    const cle = `${f.src}|${f.dst}|${f.port}|${f.proto}`;
    const vu = parCle.get(cle);
    if (vu) { vu.octets += f.octets; vu.paquets += f.paquets; }
    else parCle.set(cle, { ...f });
  }
  const flux = [...parCle.values()];

  // Enrichissement des seules destinations nouvelles.
  const destinations = [...new Set(flux.map((f) => f.dst))];
  // « Déjà nommée » veut dire : on lui connaît un titulaire **et** un pays.
  // Une destination identifiée mais sans pays doit être repassée au registre,
  // sans quoi les fiches d'avant ce correctif resteraient à jamais sans point.
  const connues = destinations.length
    ? await lignesSql(
        `SELECT DISTINCT "dstIp" FROM "TrafficFlow"
          WHERE "dstIp" = ANY($1::text[])
            AND COALESCE("operator", '') <> ''
            AND COALESCE("country", '') <> ''`,
        destinations,
      )
    : [];
  const dejaNommees = new Set(connues.map((c) => c.dstIp));
  // Les plus gros échanges d'abord.
  //
  // Nommer se fait par tours successifs : quand mille quatre cents
  // destinations attendent, l'ordre décide de ce qu'on voit à l'écran au bout
  // de cinq minutes. Une destination qui a échangé cinq cents gigaoctets est
  // en haut de la liste de l'utilisateur ; c'est elle qu'il faut nommer en
  // premier, pas une adresse contactée une fois pour deux kilooctets.
  const volume = new Map<string, number>();
  for (const f of flux) volume.set(f.dst, (volume.get(f.dst) || 0) + (f.octets || 0));
  const aNommer = destinations
    .filter((ip) => !dejaNommees.has(ip))
    .sort((a, b) => (volume.get(b) || 0) - (volume.get(a) || 0));

  // Toutes les destinations du relevé, pas seulement celles qui n'ont pas de
  // titulaire : une adresse nommée par le registre peut n'avoir toujours pas
  // de DOMAINE, et c'est le domaine qui porte le logo. Le cache fait que les
  // adresses déjà vues ne coûtent rien.
  await resoudreNoms(cible.id, destinations);

  // Le registre est interrogé pour **toutes** les destinations nouvelles, et
  // plus seulement pour celles sans nom inverse. Un nom inverse donne rarement
  // le pays, et jamais le titulaire ; sans cette lecture, la quasi-totalité des
  // destinations restait sans pays et donc sans point sur le globe. Les fiches
  // sont mises en cache une semaine : le coût est payé une fois par préfixe.
  const fiches = new Map<string, Awaited<ReturnType<typeof ficheRegistre>>>();
  if (aNommer.length && await registreActif()) {
    // Une par une, et pas huit à la fois.
    //
    // Le registre limite les rafales : en paralléliser huit revenait à se
    // faire répondre 429, donc à ne rien apprendre — c'est ce qui laissait des
    // centaines de destinations en point d'interrogation. Le service espace
    // désormais ses appels lui-même ; ici on se contente de ne pas bloquer le
    // relevé : ce qui n'a pas pu être nommé dans le temps imparti le sera au
    // tour suivant, et les blocs déjà connus ne coûtent rien.
    // Une minute par tour, et un tour toutes les cinq minutes : le relevé n'est
    // jamais retardé, et la liste se remplit quatre fois plus vite qu'avec les
    // vingt-cinq secondes précédentes.
    const echeance = Date.now() + 60_000;
    for (const ip of aNommer) {
      const f = await ficheRegistre(ip);
      fiches.set(f.ip, f);
      // Une fiche décrit un bloc entier : toutes les autres destinations du
      // même bloc sont nommées sans rien redemander.
      if (f.organisation || f.reseau) {
        for (const autre of aNommer) {
          if (fiches.has(autre) || !dansLePrefixe(f, autre)) continue;
          fiches.set(autre, { ...f, ip: autre });
        }
        await rattraperLePasse(f);
      }
      if (Date.now() > echeance) break;
    }
  }

  // Écriture.
  //
  // Un seul ordre pour tout le lot, en SQL : la table est jeune et n'existe pas
  // dans les migrations du projet, on ne dépend donc pas du client généré.
  // COALESCE tient la règle qui compte : une information déjà connue n'est
  // jamais écrasée par un vide au relevé suivant.
  if (flux.length) {
    const maintenant = new Date();
    const valeurs: any[] = [];
    const lignes: string[] = [];
    for (const f of flux) {
      const host = cacheNoms.get(f.dst) || null;
      const domain = domaineDe(host || undefined) || null;
      const fiche = fiches.get(f.dst);
      const marque = juger(f, parIp.get(f.src));
      const i = valeurs.length;
      valeurs.push(
        randomUUID(), f.src, f.dst, f.port, f.proto, maintenant, maintenant,
        f.octets, f.paquets,
        host,
        domain || fiche?.domaine || null,
        fiche?.organisation || fiche?.reseau || null,
        domain || fiche?.domaine || null,
        fiche?.pays || null,
        f.direction, marque.suspect, marque.raison,
      );
      lignes.push(`($${i + 1},$${i + 2},$${i + 3},$${i + 4},$${i + 5},$${i + 6},$${i + 7},` +
                  `$${i + 8},$${i + 9},1,$${i + 10},$${i + 11},$${i + 12},$${i + 13},$${i + 14},` +
                  `$${i + 15},$${i + 16},$${i + 17})`);
    }
    await prisma.$executeRawUnsafe(
      `INSERT INTO "TrafficFlow"
         ("id","srcIp","dstIp","port","proto","firstSeen","lastSeen","bytes","packets","hits",
          "host","domain","operator","logo","country","direction","suspect","raison")
       VALUES ${lignes.join(",")}
       ON CONFLICT ("srcIp","dstIp","port","proto") DO UPDATE SET
         "lastSeen" = EXCLUDED."lastSeen",
         "hits"     = "TrafficFlow"."hits" + 1,
         "bytes"    = "TrafficFlow"."bytes" + EXCLUDED."bytes",
         "packets"  = "TrafficFlow"."packets" + EXCLUDED."packets",
         "host"     = COALESCE(EXCLUDED."host",     "TrafficFlow"."host"),
         "domain"   = COALESCE(EXCLUDED."domain",   "TrafficFlow"."domain"),
         "operator" = COALESCE(EXCLUDED."operator", "TrafficFlow"."operator"),
         "logo"     = COALESCE(EXCLUDED."logo",     "TrafficFlow"."logo"),
         "country"  = COALESCE(EXCLUDED."country",  "TrafficFlow"."country"),
         -- Le jugement est refait à chaque relevé : un appareil qu'on vient de
         -- bannir doit teinter ses flux, et un appareil blanchi doit les
         -- laisser repartir au gris.
         "direction" = EXCLUDED."direction",
         "suspect"   = EXCLUDED."suspect",
         "raison"    = EXCLUDED."raison"`,
      ...valeurs,
    ).catch(async (e: any) => {
      await logEvent("error", "trafic", `Écriture du trafic refusée : ${e?.message || e}`);
    });
  }

  etat = { equipement: cible.name, quand: Date.now(), commande, fluxVus: flux.length };
  if (flux.length) eventBus.emit("traffic:updated", { flux: flux.length });
  return etat;
}

// ── Rétention ───────────────────────────────────────────────────────────────

async function reglageNombre(cle: string, defaut: number): Promise<number> {
  const r = await prisma.setting.findUnique({ where: { key: cle } }).catch(() => null);
  const v = Number(r?.value);
  return Number.isFinite(v) && v >= 0 ? v : defaut;
}

/**
 * Taille des données réellement conservées, et nombre de flux.
 *
 * On somme la taille des lignes vivantes plutôt que de lire la taille du
 * fichier : après une suppression, Postgres garde la place pour la réutiliser,
 * et `pg_total_relation_size` resterait au plus haut atteint. Ce serait mentir
 * sur ce qui est conservé — et, pire, faire tourner la purge dans le vide
 * jusqu'à tout effacer.
 */
export async function mesure(): Promise<{ mo: number; lignes: number }> {
  const r = await lignesSql(
    `SELECT COALESCE(SUM(pg_column_size(t.*)), 0)::bigint AS octets,
            COUNT(*)::int AS lignes
       FROM "TrafficFlow" t`,
  );
  return {
    mo: Number(r?.[0]?.octets || 0) / (1024 * 1024),
    lignes: Number(r?.[0]?.lignes || 0),
  };
}

/** Compatibilité : la taille seule. */
export async function tailleTableMo(): Promise<number> {
  return (await mesure()).mo;
}

/**
 * Purge selon deux limites, l'une comme l'autre facultatives :
 *   world.retentionDays — âge maximal, en jours (0 = sans limite)
 *   world.retentionMaxMb — taille maximale de la table, en Mo (0 = sans limite)
 *
 * L'âge passe d'abord. Si la table dépasse encore, on retire les flux les plus
 * anciennement vus, par tranches, jusqu'à repasser sous la limite.
 */
export async function purger(): Promise<{ parAge: number; parTaille: number; mo: number }> {
  const jours = await reglageNombre("world.retentionDays", 30);
  const maxMo = await reglageNombre("world.retentionMaxMb", 0);

  let parAge = 0;
  if (jours > 0) {
    const limite = new Date(Date.now() - jours * 86400_000);
    parAge = Number(await prisma.$executeRawUnsafe(
      `DELETE FROM "TrafficFlow" WHERE "lastSeen" < $1`, limite,
    ).catch(() => 0));
  }

  let parTaille = 0;
  let { mo, lignes } = await mesure();
  if (maxMo > 0 && mo > maxMo && lignes > 0) {
    // On ne boucle pas en remesurant : on calcule combien de lignes tiennent
    // dans la limite, à partir de la taille moyenne observée, et on retire le
    // reste en un seul ordre. Au moins une ligne est toujours conservée.
    const octetsParLigne = (mo * 1024 * 1024) / lignes;
    const aGarder = Math.max(1, Math.floor((maxMo * 1024 * 1024) / octetsParLigne));
    if (aGarder < lignes) {
      parTaille = Number(await prisma.$executeRawUnsafe(
        `DELETE FROM "TrafficFlow" WHERE "id" IN (
           SELECT "id" FROM "TrafficFlow" ORDER BY "lastSeen" ASC LIMIT $1)`,
        lignes - aGarder,
      ).catch(() => 0));
      // Sans VACUUM, la place libérée n'est pas réutilisable et le fichier
      // continue de grossir au relevé suivant.
      await prisma.$executeRawUnsafe(`VACUUM "TrafficFlow"`).catch(() => {});
      ({ mo, lignes } = await mesure());
    }
  }

  if (parAge || parTaille) {
    await logEvent("info", "trafic",
      `Purge du trafic : ${parAge} flux hors délai, ${parTaille} au-delà de la taille — ` +
      `${lignes} flux conservés, ${mo.toFixed(2)} Mo`);
  }
  return { parAge, parTaille, mo };
}

// ── Table ───────────────────────────────────────────────────────────────────

/**
 * La table est créée ici plutôt que par une migration : le projet n'en utilise
 * pas, et un CREATE IF NOT EXISTS est sans effet quand elle existe déjà.
 */
export async function preparerTable(): Promise<void> {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "TrafficFlow" (
      "id"        TEXT PRIMARY KEY,
      "srcIp"     TEXT NOT NULL,
      "dstIp"     TEXT NOT NULL,
      "port"      INTEGER NOT NULL DEFAULT 0,
      "proto"     TEXT NOT NULL DEFAULT 'tcp',
      "firstSeen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "lastSeen"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "bytes"     DOUBLE PRECISION NOT NULL DEFAULT 0,
      "packets"   DOUBLE PRECISION NOT NULL DEFAULT 0,
      "hits"      INTEGER NOT NULL DEFAULT 1,
      "host"      TEXT,
      "domain"    TEXT,
      "operator"  TEXT,
      "logo"      TEXT,
      "country"   TEXT
    )`).catch(() => {});
  await prisma.$executeRawUnsafe(
    `CREATE UNIQUE INDEX IF NOT EXISTS "TrafficFlow_srcIp_dstIp_port_proto_key"
       ON "TrafficFlow" ("srcIp", "dstIp", "port", "proto")`).catch(() => {});
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "TrafficFlow_lastSeen_idx" ON "TrafficFlow" ("lastSeen")`).catch(() => {});
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "TrafficFlow_dstIp_idx" ON "TrafficFlow" ("dstIp")`).catch(() => {});
}

// ── Boucle ──────────────────────────────────────────────────────────────────

const PERIODE_MS = 20_000;
const PERIODES_ECHEC = [60_000, 120_000, 300_000, 600_000];
let echecs = 0;
let minuteur: NodeJS.Timeout | null = null;

export function demarrerCollecteTrafic(): void {
  if (minuteur) return;
  const tour = async () => {
    try {
      const e = await collecter();
      echecs = e.erreur ? echecs + 1 : 0;
    } catch { echecs++; }
    const delai = echecs === 0
      ? PERIODE_MS
      : PERIODES_ECHEC[Math.min(echecs - 1, PERIODES_ECHEC.length - 1)];
    minuteur = setTimeout(tour, delai);
  };
  preparerTable()
    .then(() => { minuteur = setTimeout(tour, 12_000); })
    .catch(() => { minuteur = setTimeout(tour, 60_000); });

  // Purge à l'heure ronde : ce n'est pas urgent, et ça ne doit pas coïncider
  // avec un relevé.
  setInterval(() => { purger().catch(() => {}); }, 3600_000);
  setTimeout(() => { purger().catch(() => {}); }, 120_000);
}

/** Relance immédiate, demandée depuis l'interface. */
export async function relancerCollecte(): Promise<EtatCollecte> {
  echecs = 0;
  return collecter();
}
