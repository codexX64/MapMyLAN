// Composition d'une adresse IPv4 à partir d'un sous-réseau.
//
// Le principe de l'écran : le masque décide de ce qui est figé. Sur un /24, les
// trois premiers octets ne se discutent pas — on les affiche, on ne les rend
// pas modifiables — et il ne reste qu'un nombre à écrire. Sur un /16, il en
// reste deux. Sur un /25, le masque tombe au milieu du dernier octet : le début
// figé reste de trois octets, mais la valeur écrite est bornée, et c'est la
// plage qui le dit plutôt qu'un pré-remplissage qui mentirait.
//
// Les mêmes règles existent côté serveur, dans services/vlanReleve.ts : c'est
// lui qui tranche. Ce qui est ici sert à colorer le champ avant l'envoi, pas à
// autoriser quoi que ce soit.

export interface Plage {
  reseau: string;
  diffusion: string;
  premiere: string;
  derniere: string;
  bits: number;
  octetsFiges: number;
  prefixe: string;
}

export function enEntier(ip: string): number | null {
  const p = String(ip || "").split(".");
  if (p.length !== 4) return null;
  let n = 0;
  for (const o of p) {
    if (!/^\d{1,3}$/.test(o)) return null;
    const v = Number(o);
    if (v < 0 || v > 255) return null;
    n = (n << 8) | v;
  }
  return n >>> 0;
}

/** Le début figé et la fin saisie, recollés. */
export function composer(prefixe: string, hote: string): string {
  const h = String(hote || "").trim();
  if (!prefixe) return h;
  if (!h) return "";
  return `${prefixe}.${h}`;
}

/** La partie modifiable d'une adresse, sous un masque donné. */
export function partieHote(ip: string, octetsFiges: number): string {
  const p = String(ip || "").split(".");
  if (p.length !== 4) return "";
  return p.slice(octetsFiges).join(".");
}

/** Combien d'octets restent à écrire. */
export function octetsALire(octetsFiges: number): number {
  return Math.max(1, 4 - octetsFiges);
}

export function verifier(
  ip: string, plage: Plage | null | undefined, passerelle?: string | null,
): { ok: boolean; raison?: string } {
  if (!plage) return { ok: false, raison: "Sous-réseau inconnu." };
  const n = enEntier(ip);
  if (n === null) return { ok: false, raison: "Adresse incomplète." };

  const bas = enEntier(plage.reseau);
  const haut = enEntier(plage.diffusion);
  if (bas === null || haut === null) return { ok: false, raison: "Sous-réseau illisible." };
  if (n < bas || n > haut) {
    return { ok: false, raison: `Hors du segment : de ${plage.premiere} à ${plage.derniere}.` };
  }
  if (ip === plage.reseau) return { ok: false, raison: "C'est l'adresse du réseau lui-même." };
  if (ip === plage.diffusion) return { ok: false, raison: "C'est l'adresse de diffusion." };
  if (passerelle && ip === passerelle) {
    return { ok: false, raison: "C'est la passerelle : la donner couperait la sortie du segment." };
  }
  return { ok: true };
}
