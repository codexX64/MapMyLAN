// Relevé des VLAN déclarés sur l'équipement réseau.
//
// Jusqu'ici, les VLAN ne pouvaient qu'aller de MapMyLAN vers l'équipement :
// on en créait un ici, il était poussé là-bas. L'inverse n'existait pas. Un
// réseau déjà segmenté — ce qui est le cas normal — apparaissait donc
// entièrement vide côté MapMyLAN, et chaque appareil retombait sur son
// sous-réseau faute de rattachement.
//
// Ce module lit ce que la passerelle déclare et l'enregistre. Rien n'est
// inventé : une ligne écrite ici vient de `/rest/networkconf`, c'est-à-dire de
// la configuration réelle de l'équipement.
//
// Deux règles de prudence :
//
//   1. on n'écrase que ce qui vient de l'équipement — le nom et le
//      sous-réseau. La couleur, l'isolement et la description restent tels que
//      tu les as réglés ;
//   2. on ne supprime jamais. Un VLAN disparu de la passerelle est signalé,
//      pas effacé : effacer en silence une ligne que quelqu'un a peut-être
//      annotée serait pire que la laisser.

import { prisma } from "../db";
import { mainRouter } from "../adapters";
import type { ReseauEntry } from "../adapters/types";
import { logEvent } from "./logger";

export interface ResultatReleve {
  lus: number;
  ajoutes: number;
  misAJour: number;
  inchanges: number;
  /** Appareils dont le rattachement a changé. */
  rattaches: number;
  /** VLAN présents en base mais absents de l'équipement. */
  orphelins: number[];
  ignores: string[];
  erreur?: string;
}

const VIDE: ResultatReleve = {
  lus: 0, ajoutes: 0, misAJour: 0, inchanges: 0, rattaches: 0,
  orphelins: [], ignores: [],
};

// Une teinte par VLAN à la création, pour que la carte ne soit pas monochrome.
// Elle n'est posée qu'une fois : ensuite, c'est le réglage de l'utilisateur.
/** Ce qui n'a rien à faire dans la liste des VLAN internes. */
const HORS_SUJET = new Set([
  "wan", "wan2", "wan-lte-failover", "remote-user-vpn", "site-vpn", "vpn-client",
]);

const TEINTES = [
  "#1B2AFF", "#0EA5E9", "#10B981", "#F59E0B", "#EF4444",
  "#8B5CF6", "#EC4899", "#14B8A6", "#F97316", "#6366F1",
];

// ── Adresses ────────────────────────────────────────────────────────────────

function enEntier(ip: string): number | null {
  const p = ip.split(".");
  if (p.length !== 4) return null;
  let n = 0;
  for (const o of p) {
    const v = Number(o);
    if (!Number.isInteger(v) || v < 0 || v > 255) return null;
    n = (n << 8) | v;
  }
  return n >>> 0;
}

function enTexte(n: number): string {
  return [24, 16, 8, 0].map((d) => (n >>> d) & 255).join(".");
}

/**
 * L'adresse de réseau d'un CIDR.
 *
 * UniFi rend « 198.51.100.1/24 » : la partie hôte est l'adresse que la
 * passerelle porte sur ce VLAN, pas le réseau. Écrire ça tel quel donnerait un
 * sous-réseau faux à l'affichage et casserait le rattachement des appareils.
 */
export function normaliserCidr(cidr: string): { reseau: string; bits: number } | null {
  const [adresse, prefixe] = String(cidr).split("/");
  const bits = Number(prefixe);
  const n = enEntier(String(adresse).trim());
  if (n === null || !Number.isInteger(bits) || bits < 0 || bits > 32) return null;
  const masque = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return { reseau: `${enTexte((n & masque) >>> 0)}/${bits}`, bits };
}

/** L'adresse tombe-t-elle dans ce sous-réseau ? */
export function dansLeReseau(ip: string, cidr: string): boolean {
  const n = enEntier(ip);
  const c = normaliserCidr(cidr);
  if (n === null || !c) return false;
  const base = enEntier(c.reseau.split("/")[0]);
  if (base === null) return false;
  const masque = c.bits === 0 ? 0 : (0xffffffff << (32 - c.bits)) >>> 0;
  return ((n & masque) >>> 0) === base;
}

// ── Enregistrement ──────────────────────────────────────────────────────────

/**
 * Range les réseaux lus dans la table des VLAN.
 *
 * Un réseau sans étiquette VLAN est le réseau natif : il porte le numéro 1,
 * comme partout ailleurs. S'il y en a deux, le second est signalé plutôt que
 * de venir écraser le premier — deviner lequel est « le vrai » ne serait pas
 * de la lecture, ce serait de l'invention.
 */
export async function enregistrerReseaux(reseaux: ReseauEntry[]): Promise<ResultatReleve> {
  const r: ResultatReleve = { ...VIDE, orphelins: [], ignores: [] };
  const vus = new Set<number>();

  for (const reseau of reseaux) {
    // Un WAN ou un tunnel n'est pas un VLAN interne. Sans cette distinction,
    // le WAN — qui n'a pas d'étiquette VLAN — viendrait se faire enregistrer
    // comme réseau natif et prendre la place du vrai.
    const role = String(reseau.role || "").toLowerCase();
    if (HORS_SUJET.has(role)) continue;

    if (!reseau.cidr) {
      r.ignores.push(
        `${reseau.nom || "sans nom"} : VLAN sans sous-réseau routé sur la passerelle, ` +
        `rien à enregistrer`);
      continue;
    }
    const c = normaliserCidr(reseau.cidr);
    if (!c) { r.ignores.push(`${reseau.nom || "sans nom"} : sous-réseau illisible (${reseau.cidr})`); continue; }

    const brut = reseau.vlan;
    const id = Number.isInteger(brut) && (brut as number) >= 1 && (brut as number) <= 4094
      ? (brut as number)
      : 1;

    if (vus.has(id)) {
      r.ignores.push(`${reseau.nom || c.reseau} : le VLAN ${id} est déjà pris`);
      continue;
    }
    vus.add(id);
    r.lus++;

    const nom = (reseau.nom || "").trim() || `VLAN ${id}`;
    const passerelle = reseau.passerelle || null;
    const idConstructeur = reseau.id || null;
    const existant = await prisma.vlan.findUnique({ where: { id } });

    if (!existant) {
      await prisma.vlan.create({
        data: {
          id, name: nom, subnet: c.reseau,
          gateway: passerelle, networkId: idConstructeur,
          color: TEINTES[id % TEINTES.length],
          description: "Relevé sur l'équipement réseau.",
        },
      });
      r.ajoutes++;
    } else if (existant.name !== nom || existant.subnet !== c.reseau
            || existant.gateway !== passerelle || existant.networkId !== idConstructeur) {
      // Le nom, le sous-réseau, la passerelle et l'identifiant constructeur
      // viennent de l'équipement. La couleur, l'isolement et la description
      // restent ce que l'utilisateur en a fait.
      await prisma.vlan.update({
        where: { id },
        data: { name: nom, subnet: c.reseau, gateway: passerelle, networkId: idConstructeur },
      });
      r.misAJour++;
    } else {
      r.inchanges++;
    }
  }

  const tous = await prisma.vlan.findMany({ select: { id: true } });
  r.orphelins = tous.map((v: any) => v.id).filter((id: number) => !vus.has(id)).sort((a: number, b: number) => a - b);

  r.rattaches = await rattacherAppareils();
  return r;
}

/**
 * Range chaque appareil dans le VLAN dont il porte l'adresse.
 *
 * Le sous-réseau déclaré sur la passerelle fait autorité : une adresse qui
 * tombe dedans appartient à ce VLAN, il n'y a pas à en débattre. En revanche,
 * une adresse qui ne tombe dans aucun sous-réseau connu garde l'étiquette
 * qu'elle a — on ne va pas effacer un rattachement posé à la main sous prétexte
 * qu'on ne sait pas mieux.
 */
export async function rattacherAppareils(): Promise<number> {
  const vlans = await prisma.vlan.findMany();
  if (!vlans.length) return 0;

  // Préfixe le plus long d'abord : un /24 l'emporte sur le /16 qui le contient.
  const candidats = vlans
    .map((v: any) => ({ id: v.id, cidr: v.subnet, bits: normaliserCidr(v.subnet)?.bits ?? -1 }))
    .filter((v: any) => v.bits >= 0)
    .sort((a: any, b: any) => b.bits - a.bits);

  const appareils = await prisma.device.findMany({ select: { id: true, ip: true, vlan: true } });
  const parVlan = new Map<number, string[]>();

  for (const a of appareils) {
    if (!a.ip) continue;
    const trouve = candidats.find((c: any) => dansLeReseau(a.ip, c.cidr));
    if (!trouve || a.vlan === trouve.id) continue;
    if (!parVlan.has(trouve.id)) parVlan.set(trouve.id, []);
    parVlan.get(trouve.id)!.push(a.id);
  }

  let total = 0;
  for (const [vlan, ids] of parVlan) {
    const n = await prisma.device.updateMany({ where: { id: { in: ids } }, data: { vlan } });
    total += n.count ?? ids.length;
  }
  return total;
}

/** Interroge l'équipement principal et enregistre ce qu'il déclare. */
export async function relever(): Promise<ResultatReleve> {
  let adapter, ctx;
  try { ({ adapter, ctx } = await mainRouter()); }
  catch (e: any) {
    return { ...VIDE, orphelins: [], ignores: [], erreur: e?.message || "Aucun équipement principal." };
  }

  if (!adapter.networks) {
    return {
      ...VIDE, orphelins: [], ignores: [],
      erreur: `${adapter.label} ne sait pas énumérer ses réseaux depuis MapMyLAN. ` +
              `Les VLAN restent à déclarer à la main.`,
    };
  }

  let reseaux: ReseauEntry[];
  try { reseaux = await adapter.networks(ctx); }
  catch (e: any) {
    return { ...VIDE, orphelins: [], ignores: [], erreur: e?.message || "L'équipement n'a pas répondu." };
  }

  const r = await enregistrerReseaux(reseaux);
  await logEvent("info", "vlan",
    `Relevé des VLAN : ${r.ajoutes} ajouté(s), ${r.misAJour} mis à jour, ` +
    `${r.inchanges} inchangé(s), ${r.rattaches} appareil(s) rattaché(s)`);
  return r;
}


// ── Adresses réservables ────────────────────────────────────────────────────

export interface Plage {
  /** Adresse du réseau : celle du sous-réseau lui-même, jamais attribuable. */
  reseau: string;
  /** Adresse de diffusion : jamais attribuable non plus. */
  diffusion: string;
  premiere: string;
  derniere: string;
  bits: number;
  /** Nombre d'octets figés par le masque, donc le début que l'on peut pré-remplir. */
  octetsFiges: number;
  prefixe: string;
}

/**
 * Ce qu'un sous-réseau permet d'attribuer.
 *
 * `octetsFiges` est ce qui rend le champ de saisie honnête : sur un /24, les
 * trois premiers octets sont figés et il ne reste qu'un nombre à écrire. Sur un
 * /25, le masque tombe au milieu du dernier octet — le début pré-rempli reste
 * de trois octets, mais la valeur écrite est bornée, et c'est la plage rendue
 * ici qui le dit. Pré-remplir plus serait mentir sur ce qui est modifiable.
 */
export function plageUtilisable(cidr: string): Plage | null {
  const c = normaliserCidr(cidr);
  if (!c) return null;
  const base = enEntier(c.reseau.split("/")[0]);
  if (base === null) return null;

  const taille = c.bits >= 31 ? 0 : 2 ** (32 - c.bits);
  const diffusion = taille ? base + taille - 1 : base;
  const octetsFiges = Math.floor(c.bits / 8);

  return {
    reseau: enTexte(base),
    diffusion: enTexte(diffusion >>> 0),
    premiere: enTexte((base + (taille ? 1 : 0)) >>> 0),
    derniere: enTexte((diffusion - (taille ? 1 : 0)) >>> 0),
    bits: c.bits,
    octetsFiges,
    prefixe: enTexte(base).split(".").slice(0, octetsFiges).join("."),
  };
}

/**
 * Une adresse est-elle réservable dans ce VLAN ?
 *
 * On refuse trois choses : ce qui sort du sous-réseau, les deux adresses que
 * le protocole se réserve, et l'adresse de la passerelle. Cette dernière n'est
 * pas un détail : la donner à une machine coupe la sortie du segment entier.
 */
export function verifierAdresse(
  ip: string, cidr: string, passerelle?: string | null,
): { ok: true } | { ok: false; raison: string } {
  const plage = plageUtilisable(cidr);
  if (!plage) return { ok: false, raison: "Sous-réseau illisible." };
  if (enEntier(ip) === null) return { ok: false, raison: `« ${ip} » n'est pas une adresse IPv4.` };
  if (!dansLeReseau(ip, cidr)) {
    return { ok: false, raison: `${ip} est hors de ${cidr}.` };
  }
  if (ip === plage.reseau) return { ok: false, raison: `${ip} est l'adresse du réseau lui-même.` };
  if (ip === plage.diffusion) return { ok: false, raison: `${ip} est l'adresse de diffusion.` };
  if (passerelle && ip === passerelle) {
    return { ok: false, raison: `${ip} est la passerelle du segment : la donner couperait la sortie.` };
  }
  return { ok: true };
}


// ── Ce que la passerelle porte, et qui n'est pas une machine ────────────────

/**
 * Les adresses que la passerelle porte sur chaque VLAN.
 *
 * Ce ne sont pas des appareils. C'est le même boîtier, vu depuis chaque
 * segment : une adresse par VLAN, toutes derrière la même carte. Les inscrire
 * à l'inventaire revenait à compter le routeur autant de fois qu'il y a de
 * réseaux, et à faire pendre ces doublons au premier voisin venu sur la carte.
 */
export async function adressesDePasserelle(): Promise<Set<string>> {
  const lignes = await prisma.vlan.findMany({ select: { gateway: true } });
  return new Set(
    lignes.map((v: any) => v.gateway).filter((ip: any): ip is string => !!ip),
  );
}

/**
 * Efface les fiches déjà créées pour ces adresses.
 *
 * `garder` est l'adresse du routeur lui-même : elle est bien celle d'une
 * passerelle, mais c'est aussi la fiche réelle de l'équipement, et c'est la
 * racine de la carte. Elle reste.
 */
export async function purgerPasserelles(garder?: string | null): Promise<number> {
  const a = await adressesDePasserelle();
  if (garder) a.delete(garder);
  if (!a.size) return 0;

  const n = await prisma.device.deleteMany({
    // Un équipement marqué « routeur principal » n'est jamais effacé, quelle
    // que soit son adresse : ce serait supprimer la racine.
    where: { ip: { in: [...a] }, isMainRouter: false },
  });
  const combien = n.count ?? 0;
  if (combien) {
    await logEvent("info", "scanner",
      `${combien} fiche(s) d'adresse de passerelle retirée(s) de l'inventaire`);
  }
  return combien;
}
