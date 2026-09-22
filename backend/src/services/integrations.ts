// Jetons d'intégration.
//
// Un jeton de session est lié à un compte et à son mot de passe : il dure
// douze heures et meurt au premier changement de mot de passe. Un automate qui
// interroge l'API a besoin de l'inverse — un secret durable, révocable d'un
// geste, et dont la portée est plus étroite que celle d'un humain.
//
// Ce que la base garde n'est jamais le jeton, seulement son empreinte SHA-256.
// Une base lue ne donne aucun jeton utilisable, exactement comme pour le lien
// de réinitialisation. Le clair n'existe qu'une fois, à la création.

import crypto from "crypto";
import { prisma } from "../db";

/** Ce qui distingue un jeton d'intégration d'un JWT de session, à l'œil nu. */
export const PREFIXE = "mml_";

/**
 * Les préfixes reconnus à l'entrée.
 *
 * `mml_` est celui des jetons créés depuis l'interface. `hub_` est celui de
 * l'amorce : le Hub fabrique la valeur de son côté et nous la passe par
 * l'environnement, nous ne la choisissons pas. Deux préfixes à l'entrée, un
 * seul à la sortie — `fabriquerJeton` ne produit que des `mml_`.
 */
export const PREFIXES = [PREFIXE, "hub_"] as const;

/**
 * Jamais `admin`.
 *
 * Un jeton vit dans le fichier de configuration d'un autre programme ; il n'a
 * pas la protection d'un mot de passe ni d'un second facteur. Lui ouvrir la
 * gestion des comptes reviendrait à confier l'instance entière à une ligne de
 * configuration recopiée.
 */
export const ROLES = ["viewer", "operator"] as const;
export type RoleIntegration = (typeof ROLES)[number];

/**
 * Portées.
 *
 * `service` est l'existant : piloter le réseau, lire l'inventaire, laisser les
 * comptes tranquilles. `accounts` est l'inverse exact — gérer les comptes, et
 * ne rien écrire d'autre. Deux pouvoirs séparés plutôt qu'un jeton qui peut
 * tout : celui qui fuite ne donne que la moitié.
 */
export const PORTEES = ["service", "accounts"] as const;
export type PorteeIntegration = (typeof PORTEES)[number];

/** Empreinte du jeton. C'est la seule forme qui entre en base. */
export function empreinte(jeton: string): string {
  return crypto.createHash("sha256").update(jeton, "utf8").digest("hex");
}

/**
 * Fabrique un jeton.
 *
 * 32 octets tirés du générateur du système : de quoi rendre la devinette hors
 * sujet. Le préfixe affichable est celui du clair — il sert à reconnaître une
 * ligne dans la liste, jamais à s'authentifier.
 */
export function fabriquerJeton(): { clair: string; prefix: string; hash: string } {
  const clair = PREFIXE + crypto.randomBytes(32).toString("base64url");
  return { clair, prefix: clair.slice(0, 8), hash: empreinte(clair) };
}

export function estJetonIntegration(valeur: string | null | undefined): boolean {
  return typeof valeur === "string" && PREFIXES.some((p) => valeur.startsWith(p));
}

/**
 * Comparaison de deux empreintes sans fuite de temps.
 *
 * La recherche en base porte déjà sur l'empreinte, pas sur le secret : le
 * moteur ne voit jamais le jeton. Cette comparaison ferme le dernier interstice
 * — un index qui répondrait plus vite sur un préfixe commun.
 */
export function memeEmpreinte(a: string, b: string): boolean {
  const ba = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

// ─── Portée ────────────────────────────────────────────────────────────────
//
// Un jeton d'intégration n'est pas un compte. Il n'ouvre pas ce qui sert à
// devenir quelqu'un d'autre : la connexion, les comptes, les seconds facteurs,
// les identifiants d'équipement, et la fabrique de jetons elle-même — sans quoi
// un jeton `operator` s'en délivrerait un autre et la limite de rôle ne
// vaudrait rien. Le pilotage du routeur reste lisible mais non modifiable.

const FERMES = ["/api/auth", "/api/users", "/api/mfa", "/api/ssh", "/api/integrations"];
const LECTURE_SEULE = ["/api/router"];

// Portée « accounts » : les comptes s'ouvrent, le reste se referme en lecture.
// `/api/users/:id/mfa/*` vit sous `/api/users` et suit donc les comptes ;
// `/api/mfa`, qui touche au second facteur de l'appelant, reste fermé.
const COMPTES_OUVERT = ["/api/users"];
const COMPTES_FERMES = ["/api/auth", "/api/mfa", "/api/ssh", "/api/integrations"];

function sous(chemin: string, base: string): boolean {
  return chemin === base || chemin.startsWith(base + "/");
}

/**
 * Renvoie le préfixe fautif si la requête sort de la portée, sinon `null`.
 *
 * On travaille sur l'URL d'origine, pas sur `req.path` : un middleware monté
 * dans un routeur ne voit qu'un chemin relatif, et la règle porte sur la route
 * complète.
 */
export function porteeRefusee(
  methode: string, url: string, portee: PorteeIntegration = "service",
): string | null {
  const chemin = (url.split("?")[0] || "/").replace(/\/+$/, "") || "/";
  const m = (methode || "GET").toUpperCase();
  const lecture = m === "GET" || m === "HEAD";

  if (portee === "accounts") {
    for (const f of COMPTES_FERMES) if (sous(chemin, f)) return f;
    for (const o of COMPTES_OUVERT) if (sous(chemin, o)) return null;
    // Tout le reste — appareils, topologie, VLAN, routeur — se lit mais ne
    // s'écrit pas : gérer des comptes n'est pas piloter le réseau.
    return lecture ? null : chemin;
  }

  for (const f of FERMES) if (sous(chemin, f)) return f;
  if (!lecture) {
    for (const l of LECTURE_SEULE) if (sous(chemin, l)) return l;
  }
  return null;
}

// ─── Débit ─────────────────────────────────────────────────────────────────
//
// Fenêtre fixe en mémoire, pas de dépendance. Le compteur vit dans le
// processus : sur plusieurs instances chacune tient le sien, ce qui multiplie
// la limite d'autant. C'est assumé — la limite protège la base d'un automate
// emballé, elle n'est pas une facturation.

export const DEBIT_MAX = 120;
export const FENETRE_MS = 60_000;

const compteurs = new Map<string, { debut: number; n: number }>();

/** Incrémente et dit si la limite est franchie. */
export function debitDepasse(cle: string, maintenant: number = Date.now()): boolean {
  const c = compteurs.get(cle);
  if (!c || maintenant - c.debut >= FENETRE_MS) {
    compteurs.set(cle, { debut: maintenant, n: 1 });
    return false;
  }
  c.n += 1;
  return c.n > DEBIT_MAX;
}

/** Pour les tests, et pour une remise à zéro explicite. */
export function reinitialiserDebit(): void {
  compteurs.clear();
  derniereEcriture.clear();
}

// ─── Dernière utilisation ──────────────────────────────────────────────────
//
// Écrire à chaque requête ferait une écriture par appel d'API, pour une donnée
// dont la précision utile est « aujourd'hui ». Une fois par minute suffit.

const PAS_ECRITURE_MS = 60_000;
const derniereEcriture = new Map<string, number>();

export function doitNoterUsage(id: string, maintenant: number = Date.now()): boolean {
  const d = derniereEcriture.get(id);
  if (d !== undefined && maintenant - d < PAS_ECRITURE_MS) return false;
  derniereEcriture.set(id, maintenant);
  return true;
}

// ─── Vérification ──────────────────────────────────────────────────────────

export type Verdict =
  | { ok: true; jeton: { id: string; name: string; role: string; scope: PorteeIntegration } }
  | { ok: false; raison: "inconnu" | "revoque" | "expire" };

export async function verifierJeton(clair: string, maintenant: Date = new Date()): Promise<Verdict> {
  const h = empreinte(clair);
  const ligne = await prisma.integrationToken.findUnique({ where: { hash: h } });
  if (!ligne || !memeEmpreinte(ligne.hash, h)) return { ok: false, raison: "inconnu" };
  // Révoqué d'abord : un jeton révoqué puis expiré reste un jeton révoqué, et
  // c'est le motif qu'on veut lire dans le journal.
  if (ligne.revokedAt) return { ok: false, raison: "revoque" };
  if (ligne.expiresAt && ligne.expiresAt.getTime() <= maintenant.getTime()) {
    return { ok: false, raison: "expire" };
  }
  const scope: PorteeIntegration = ligne.scope === "accounts" ? "accounts" : "service";
  return { ok: true, jeton: { id: ligne.id, name: ligne.name, role: ligne.role, scope } };
}

// ─── Amorce ────────────────────────────────────────────────────────────────
//
// Installé par un programme tiers, MapMyLAN doit être utilisable sans qu'un
// humain vienne créer un jeton dans l'interface. L'installeur pose la valeur
// dans `INTEGRATION_TOKEN_SEED`, et c'est cette valeur-là qu'il présentera en
// `Authorization: Bearer` — nous ne la choisissons pas, nous l'enregistrons.
//
// La valeur elle-même n'entre pas en base : seule son empreinte, comme pour
// tout autre jeton. Elle n'apparaît dans aucun journal ni dans aucune réponse.

/** Noms réservés aux entrées créées par l'amorce. */
export const NOM_AMORCE = "hub";
export const NOM_AMORCE_COMPTES = "hub-comptes";

export type ResultatAmorce =
  | { fait: "cree" | "mis-a-jour" | "inchange" }
  | { fait: "ignore"; raison: "vide" | "prefixe" };

/**
 * Enregistre — ou met à jour — le jeton d'amorce.
 *
 * Idempotente : elle travaille sur l'entrée nommée `hub`, qu'elle crée si elle
 * manque. Redémarrer ne multiplie pas les jetons, et changer la valeur de la
 * variable remplace l'empreinte, ce qui invalide l'ancienne d'un seul coup.
 * Une entrée révoquée à la main est réactivée si l'amorce est toujours posée :
 * c'est l'environnement qui décide, pas l'état laissé en base.
 */
export async function amorcerJeton(
  valeur: string,
  { nom = NOM_AMORCE, portee = "service" as PorteeIntegration, role = "operator" } = {},
): Promise<ResultatAmorce> {
  const seed = (valeur || "").trim();
  if (!seed) return { fait: "ignore", raison: "vide" };

  // Sans préfixe reconnu, `authRequired` ne prendrait jamais la branche
  // d'intégration : la ligne serait créée pour rien et l'appelant recevrait
  // des 401 sans comprendre. Mieux vaut ne rien créer et le dire.
  if (!estJetonIntegration(seed)) return { fait: "ignore", raison: "prefixe" };

  const hash = empreinte(seed);
  const existante = await prisma.integrationToken.findFirst({
    where: { name: nom }, orderBy: { createdAt: "asc" },
  });

  if (!existante) {
    await prisma.integrationToken.create({
      data: { name: nom, role, scope: portee, prefix: seed.slice(0, 8), hash },
    });
    return { fait: "cree" };
  }

  const aJour =
    existante.hash === hash && existante.role === role
    && (existante.scope || "service") === portee && !existante.revokedAt;
  if (aJour) return { fait: "inchange" };

  await prisma.integrationToken.update({
    where: { id: existante.id },
    data: { hash, role, scope: portee, prefix: seed.slice(0, 8), revokedAt: null },
  });
  return { fait: "mis-a-jour" };
}

/** Note l'usage, au plus une fois par minute. Un échec d'écriture est sans conséquence. */
export function noterUsage(id: string): void {
  if (!doitNoterUsage(id)) return;
  prisma.integrationToken
    .update({ where: { id }, data: { lastUsedAt: new Date() } })
    .catch(() => {});
}
