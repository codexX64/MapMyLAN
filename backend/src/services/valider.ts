// Validation of data coming from the network.
//
// The addresses, MACs and hostnames that MapMyLAN handles don't come from a
// form: they are advertised by the devices themselves, over mDNS, NetBIOS,
// DHCP or an ARP reply. A compromised device therefore chooses what it
// declares.
//
// These values end up in commands executed on the network equipment, with the
// highest privileges. An address containing `; command` would hand control of
// the router to the very device we're trying to isolate. Hence this module:
// nothing enters a command without having been recognized as matching its
// format.
//
// The principle is deny by default. We don't try to strip out what's dangerous
// — that approach always lets something through — we require that the value
// match exactly what it claims to be.

export class ValeurRefusee extends Error {
  constructor(quoi: string, valeur: unknown) {
    super(`${quoi} invalid: ${JSON.stringify(String(valeur)).slice(0, 80)}`);
    this.name = "ValeurRefusee";
  }
}

/** IPv4 address, each octet between 0 and 255. */
export function estIPv4(v: unknown): v is string {
  if (typeof v !== "string") return false;
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(v);
  if (!m) return false;
  return [1, 2, 3, 4].every(i => {
    const n = Number(m[i]);
    // "01" and "1" denote the same octet but are written differently: we
    // reject leading zeros, which are used to bypass filters.
    return n >= 0 && n <= 255 && String(n) === m[i];
  });
}

/** IPv6 address, full or abbreviated form. */
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

/** MAC address. The accepted separators are the colon and the hyphen. */
export function estMAC(v: unknown): v is string {
  return typeof v === "string" && /^([0-9a-f]{2}[:-]){5}[0-9a-f]{2}$/i.test(v);
}

/** IPv4 CIDR notation. */
export function estCIDR(v: unknown): v is string {
  if (typeof v !== "string") return false;
  const [ip, bits] = v.split("/");
  if (bits === undefined) return false;
  const n = Number(bits);
  return estIPv4(ip) && Number.isInteger(n) && n >= 0 && n <= 32;
}

/** Port number. */
export function estPort(v: unknown): boolean {
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 && n <= 65535;
}

// ── Requirements: throw rather than return a dubious value ─────────────────
export function exigerIP(v: unknown, quoi = "IP address"): string {
  if (!estIP(v)) throw new ValeurRefusee(quoi, v);
  return v as string;
}
export function exigerMAC(v: unknown, quoi = "MAC address"): string {
  if (!estMAC(v)) throw new ValeurRefusee(quoi, v);
  return (v as string).replace(/-/g, ":").toUpperCase();
}
export function exigerCIDR(v: unknown, quoi = "Range"): string {
  if (!estCIDR(v)) throw new ValeurRefusee(quoi, v);
  return v as string;
}
export function exigerPort(v: unknown, quoi = "Port"): number {
  if (!estPort(v)) throw new ValeurRefusee(quoi, v);
  return Number(v);
}

/**
 * Sanitizes a hostname.
 *
 * Unlike addresses, a name can't be refused: a misconfigured device advertises
 * whatever it likes, and rejecting it would make the device invisible. So we
 * reduce it to what a hostname can legitimately contain, discarding everything
 * else.
 *
 * The result is never used in a command — no need justifies it — but it does
 * pass through the logs, the UI and memory.
 */
export function nettoyerNom(v: unknown, max = 63): string {
  if (typeof v !== "string") return "";
  return v
    .normalize("NFKC")
    // Control characters make it possible to inject lines into a log or to
    // truncate a display.
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, "")
    // Directional marks and invisible spaces are used to disguise one name as
    // another on screen.
    .replace(/[\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/g, "")
    .replace(/[^a-zA-Z0-9._\- ]/g, "")
    .trim()
    .slice(0, max);
}

/** Sanitizes a vendor name, more permissive but still bounded. */
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
 * Verifies that an API address really targets the declared equipment.
 *
 * Without this check, the address could point to any service reachable from
 * the server — an internal access point, a hosting-provider metadata service.
 * The backend would become a relay for exploring the network from the outside.
 */
export function exigerUrlEquipement(url: unknown, hoteAttendu: string): string {
  if (typeof url !== "string" || url.length > 200) {
    throw new ValeurRefusee("API address", url);
  }
  let u: URL;
  try { u = new URL(url); } catch { throw new ValeurRefusee("API address", url); }

  if (u.protocol !== "https:" && u.protocol !== "http:") {
    throw new ValeurRefusee("Protocol", u.protocol);
  }
  // The path belongs to the adapter, not to the setting.
  if (u.pathname !== "/" && u.pathname !== "") {
    throw new ValeurRefusee("API address — path must be empty", url);
  }
  if (u.search || u.hash || u.username || u.password) {
    throw new ValeurRefusee("API address — parameters not allowed", url);
  }
  // The host must be that of the registered equipment. An API address that
  // designates anything else has no reason to exist.
  const hote = u.hostname.replace(/^\[|\]$/g, "");
  if (hote !== hoteAttendu) {
    throw new ValeurRefusee(`API address — expected ${hoteAttendu}`, hote);
  }
  return u.origin;
}

/**
 * Target of a defense action, validated before any command is built.
 *
 * This is the mandatory checkpoint: a device whose address doesn't hold up
 * simply cannot be blocked, rather than producing a dubious command.
 */
export interface CibleValidee {
  ip: string;
  mac?: string;
  gateway?: string;
}

export function validerCible(t: { ip?: unknown; mac?: unknown; gateway?: unknown }): CibleValidee {
  const out: CibleValidee = { ip: exigerIP(t.ip, "Target address") };
  if (t.mac !== undefined && t.mac !== null && t.mac !== "") {
    out.mac = exigerMAC(t.mac, "Target MAC");
  }
  if (t.gateway !== undefined && t.gateway !== null && t.gateway !== "") {
    out.gateway = exigerIP(t.gateway, "Gateway");
  }
  return out;
}
