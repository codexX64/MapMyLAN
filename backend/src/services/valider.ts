// Validation des données venues du réseau.
//
// Les adresses, les MAC et les noms d'hôte que MapMyLAN manipule ne viennent
// pas d'un formulaire : ils sont annoncés par les appareils eux-mêmes, par
// mDNS, NetBIOS, DHCP ou une réponse ARP. Un appareil compromis choisit donc ce
// qu'il déclare.
//
// Ces valeurs finissent dans des commandes exécutées sur l'équipement réseau,
// avec les privilèges les plus élevés. Une adresse contenant `; commande`
// donnerait le contrôle du routeur à l'appareil qu'on cherche justement à
// isoler. D'où ce module : rien n'entre dans une commande sans avoir été
// reconnu comme appartenant à son format.
//
// Le principe est le refus par défaut. On ne cherche pas à retirer ce qui est
// dangereux — cette approche laisse toujours passer quelque chose — on exige
// que la valeur corresponde exactement à ce qu'elle prétend être.

export class ValeurRefusee extends Error {
  constructor(quoi: string, valeur: unknown) {
    super(`${quoi} invalide : ${JSON.stringify(String(valeur)).slice(0, 80)}`);
    this.name = "ValeurRefusee";
  }
}

/** Adresse IPv4, chaque octet entre 0 et 255. */
export function estIPv4(v: unknown): v is string {
  if (typeof v !== "string") return false;
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(v);
  if (!m) return false;
  return [1, 2, 3, 4].every(i => {
    const n = Number(m[i]);
    // « 01 » et « 1 » désignent le même octet mais s'écrivent différemment :
    // on refuse les zéros de tête, qui servent à contourner les filtres.
    return n >= 0 && n <= 255 && String(n) === m[i];
  });
}

/** Adresse IPv6, forme complète ou abrégée. */
export function estIPv6(v: unknown): v is string {
  if (typeof v !== "string" || v.length > 45) return false;
  if (!/^[0-9a-f:]+$/i.test(v)) return false;
  const parties = v.split("::");
  if (parties.length > 2) return false;
  const groupes = v.replace(/::/g, ":").split(":").filter(Boolean);
  if (groupes.some(g => !/^[0-9a-f]{1,4}$/i.test(g))) return false;
  return parties.length === 2 ? groupes.length <= 7 : groupes.length === 8;
}

export function estIP(v: unknown): v is string {
  return estIPv4(v) || estIPv6(v);
}

/** Adresse MAC. Les séparateurs admis sont le deux-points et le tiret. */
export function estMAC(v: unknown): v is string {
  return typeof v === "string" && /^([0-9a-f]{2}[:-]){5}[0-9a-f]{2}$/i.test(v);
}

/** Notation CIDR IPv4. */
export function estCIDR(v: unknown): v is string {
  if (typeof v !== "string") return false;
  const [ip, bits] = v.split("/");
  if (bits === undefined) return false;
  const n = Number(bits);
  return estIPv4(ip) && Number.isInteger(n) && n >= 0 && n <= 32;
}

/** Numéro de port. */
export function estPort(v: unknown): boolean {
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 && n <= 65535;
}

// ── Exigences : lèvent plutôt que de rendre une valeur douteuse ────────────
export function exigerIP(v: unknown, quoi = "Adresse IP"): string {
  if (!estIP(v)) throw new ValeurRefusee(quoi, v);
  return v as string;
}
export function exigerMAC(v: unknown, quoi = "Adresse MAC"): string {
  if (!estMAC(v)) throw new ValeurRefusee(quoi, v);
  return (v as string).replace(/-/g, ":").toUpperCase();
}
export function exigerCIDR(v: unknown, quoi = "Plage"): string {
  if (!estCIDR(v)) throw new ValeurRefusee(quoi, v);
  return v as string;
}
export function exigerPort(v: unknown, quoi = "Port"): number {
  if (!estPort(v)) throw new ValeurRefusee(quoi, v);
  return Number(v);
}

/**
 * Assainit un nom d'hôte.
 *
 * Contrairement aux adresses, un nom ne peut pas être refusé : un appareil mal
 * configuré en annonce n'importe lequel, et le rejeter le rendrait invisible.
 * On le réduit donc à ce qu'un nom d'hôte peut légitimement contenir, en
 * écartant tout le reste.
 *
 * Le résultat ne sert jamais dans une commande — aucun besoin ne le justifie —
 * mais il traverse les journaux, l'interface et la mémoire.
 */
export function nettoyerNom(v: unknown, max = 63): string {
  if (typeof v !== "string") return "";
  return v
    .normalize("NFKC")
    // Les caractères de contrôle permettent d'injecter des lignes dans un
    // journal ou de tronquer un affichage.
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, "")
    // Les marques de direction et espaces invisibles servent à déguiser un nom
    // en un autre à l'écran.
    .replace(/[\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/g, "")
    .replace(/[^a-zA-Z0-9._\- ]/g, "")
    .trim()
    .slice(0, max);
}

/** Assainit un nom de fabricant, plus permissif mais borné. */
export function nettoyerTexte(v: unknown, max = 128): string {
  if (typeof v !== "string") return "";
  return v
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
    .replace(/[\u200b-\u200f\u2028-\u202e\ufeff]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

/**
 * Vérifie qu'une adresse d'API vise bien l'équipement déclaré.
 *
 * Sans ce contrôle, l'adresse pourrait pointer vers n'importe quel service
 * atteignable depuis le serveur — un point d'accès interne, un service de
 * métadonnées d'hébergeur. Le backend deviendrait un relais pour explorer le
 * réseau depuis l'extérieur.
 */
export function exigerUrlEquipement(url: unknown, hoteAttendu: string): string {
  if (typeof url !== "string" || url.length > 200) {
    throw new ValeurRefusee("Adresse d'API", url);
  }
  let u: URL;
  try { u = new URL(url); } catch { throw new ValeurRefusee("Adresse d'API", url); }

  if (u.protocol !== "https:" && u.protocol !== "http:") {
    throw new ValeurRefusee("Protocole", u.protocol);
  }
  // Le chemin appartient à l'adaptateur, pas au réglage.
  if (u.pathname !== "/" && u.pathname !== "") {
    throw new ValeurRefusee("Adresse d'API — le chemin doit être vide", url);
  }
  if (u.search || u.hash || u.username || u.password) {
    throw new ValeurRefusee("Adresse d'API — paramètres non admis", url);
  }
  // L'hôte doit être celui de l'équipement enregistré. Une adresse d'API qui
  // désigne autre chose n'a aucune raison d'être.
  const hote = u.hostname.replace(/^\[|\]$/g, "");
  if (hote !== hoteAttendu) {
    throw new ValeurRefusee(`Adresse d'API — attendu ${hoteAttendu}`, hote);
  }
  return u.origin;
}

/**
 * Cible d'une action de défense, validée avant toute construction de commande.
 *
 * C'est le point de passage obligé : un appareil dont l'adresse ne tient pas la
 * route ne peut pas être bloqué, plutôt que de produire une commande douteuse.
 */
export interface CibleValidee {
  ip: string;
  mac?: string;
  gateway?: string;
}

export function validerCible(t: { ip?: unknown; mac?: unknown; gateway?: unknown }): CibleValidee {
  const out: CibleValidee = { ip: exigerIP(t.ip, "Adresse de la cible") };
  if (t.mac !== undefined && t.mac !== null && t.mac !== "") {
    out.mac = exigerMAC(t.mac, "MAC de la cible");
  }
  if (t.gateway !== undefined && t.gateway !== null && t.gateway !== "") {
    out.gateway = exigerIP(t.gateway, "Passerelle");
  }
  return out;
}
