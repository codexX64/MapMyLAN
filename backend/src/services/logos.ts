// Logos des destinations du trafic mondial.
//
// Pourquoi le serveur et pas le navigateur. La page appelait directement
// quatre fournisseurs de favicons. Deux conséquences, toutes deux mauvaises :
// la politique de contenu servie par nginx n'autorise les images que depuis
// `'self'`, donc en production aucune ne chargeait jamais — et là où elle
// chargeait, en développement ou dans la démonstration ouverte en local, le
// navigateur annonçait à quatre tiers chaque domaine que le réseau surveillé
// contacte. Soit la fonctionnalité ne marchait pas, soit elle racontait
// l'activité du réseau à des inconnus. Souvent les deux.
//
// Le serveur va chercher l'image à la place du navigateur, la garde, et la
// sert depuis la même origine. La page ne parle plus qu'à sa propre API, la
// politique de contenu n'a pas à être desserrée, et un domaine déjà vu ne
// ressort pas une seconde fois.
//
// Reste que le serveur, lui, sort. C'est un choix, pas un détail : le réglage
// est **éteint par défaut**, et tant qu'il l'est, rien ne quitte l'installation.

import { prisma } from "../db";

/** Le réglage qui commande tout. Absent = éteint. */
export const CLE_REGLAGE = "world.logos";

/**
 * Un nom de domaine, et rien d'autre.
 *
 * Cette valeur part dans une URL construite ici. La liste des hôtes appelés
 * est figée juste en dessous, donc le domaine ne choisit jamais la destination
 * — mais une valeur fantaisiste pourrait encore tordre le chemin ou la requête.
 * On refuse donc tout ce qui n'est pas un domaine : pas de barre, pas de
 * deux-points, pas d'arobase, pas d'espace, et 253 caractères au plus.
 */
export function domaineValide(d: unknown): d is string {
  if (typeof d !== "string") return false;
  if (d.length < 4 || d.length > 253) return false;
  return /^(?=.{4,253}$)(?!-)[a-z0-9-]{1,63}(?:\.(?!-)[a-z0-9-]{1,63})+$/.test(d);
}

/**
 * Les fournisseurs, essayés dans l'ordre.
 *
 * Aucun ne couvre tout : celui qui connaît les grandes plateformes ignore les
 * sites régionaux, et inversement. On s'arrête à la première image valable.
 */
const SOURCES: ((d: string) => string)[] = [
  (d) => `https://icons.duckduckgo.com/ip3/${d}.ico`,
  (d) => `https://www.google.com/s2/favicons?domain=${d}&sz=64`,
  (d) => `https://unavatar.io/${d}?fallback=false`,
  (d) => `https://logo.clearbit.com/${d}`,
];

const DELAI_MS = 4_000;
/** Une favicon dépasse rarement 64 Kio. Au-delà, ce n'en est pas une. */
const TAILLE_MAX = 256 * 1024;
const DUREE_TROUVE_MS = 30 * 24 * 3600 * 1000;
/** Un domaine sans logo est redemandé au bout d'un jour, pas à chaque page. */
const DUREE_ABSENT_MS = 24 * 3600 * 1000;
/** Plafond du cache : au-delà, la plus ancienne entrée sort. */
const ENTREES_MAX = 2000;

type Entree = { type: string; corps: Buffer; expire: number } | { type: null; expire: number };

const cache = new Map<string, Entree>();

function ranger(domaine: string, e: Entree): void {
  if (cache.size >= ENTREES_MAX) {
    const premier = cache.keys().next();
    if (!premier.done) cache.delete(premier.value);
  }
  cache.set(domaine, e);
}

/** Pour les tests, et pour une remise à zéro explicite. */
export function viderCache(): void {
  cache.clear();
}

export async function logosActifs(): Promise<boolean> {
  try {
    const r = await prisma.setting.findUnique({ where: { key: CLE_REGLAGE } });
    return r?.value === true;
  } catch {
    return false;
  }
}

async function telecharger(url: string): Promise<{ type: string; corps: Buffer } | null> {
  const arret = new AbortController();
  const minuteur = setTimeout(() => arret.abort(), DELAI_MS);
  try {
    const rep = await fetch(url, {
      signal: arret.signal,
      redirect: "follow",
      headers: { accept: "image/*" },
    });
    if (!rep.ok) return null;
    const type = (rep.headers.get("content-type") || "").split(";")[0].trim();
    // Un fournisseur qui répond une page d'erreur en HTML ne doit pas finir
    // servi comme image : on exige le type, pas seulement le code 200.
    if (!type.startsWith("image/")) return null;
    const brut = Buffer.from(await rep.arrayBuffer());
    if (brut.length === 0 || brut.length > TAILLE_MAX) return null;
    return { type, corps: brut };
  } catch {
    return null;
  } finally {
    clearTimeout(minuteur);
  }
}

/**
 * Rend le logo d'un domaine, depuis le cache si possible.
 *
 * `null` signifie « pas de logo » — l'appelant affiche alors sa pastille. Ce
 * résultat-là est gardé lui aussi : sans cela, chaque affichage de la page
 * relancerait quatre requêtes pour les domaines qui n'en ont pas, c'est-à-dire
 * la majorité.
 */
export async function logoDe(
  domaine: string,
  maintenant: number = Date.now(),
): Promise<{ type: string; corps: Buffer } | null> {
  const garde = cache.get(domaine);
  if (garde && garde.expire > maintenant) {
    return garde.type === null ? null : { type: garde.type, corps: garde.corps };
  }

  for (const source of SOURCES) {
    const trouve = await telecharger(source(domaine));
    if (trouve) {
      ranger(domaine, { ...trouve, expire: maintenant + DUREE_TROUVE_MS });
      return trouve;
    }
  }

  ranger(domaine, { type: null, expire: maintenant + DUREE_ABSENT_MS });
  return null;
}

/** Ce que la page a le droit de mettre en cache de son côté, en secondes. */
export const CACHE_NAVIGATEUR_S = 7 * 24 * 3600;
