// Regroupement des interfaces selon la convention d'adressage.
//
// Convention (no VLANs, purely a personal naming scheme):
//   PREFIX.C.N      → device N of category C, on ETHERNET
//   PREFIX.(C*10).N → the SAME device N, on WIFI
//
// e.g. with PREFIX=10.0, MULT=10:
//   192.0.2.10  (docker #2, ethernet)  ↔  198.51.100.10 (docker #2, wifi)
//   192.0.2.15  (pc #5, ethernet)      ↔  198.51.100.15 (pc #5, wifi)
//
// The grouping key is (min(C, C/MULT), N). Two devices that resolve to the same
// key are the same physical machine seen on two media.

import { prisma } from "../db";

export interface GroupSuggestion {
  key: string;                 // canonical "cat:octet"
  category: number;            // the ethernet category (the smaller one)
  octet: number;               // last octet (device number)
  ethernet?: { id: string; ip: string; name: string };
  wifi?: { id: string; ip: string; name: string };
}

async function cfg(key: string, def: string): Promise<string> {
  const row = await prisma.setting.findFirst({ where: { key } });
  if (!row) return def;
  // settings .value is JSON; accept raw string or {value:...}
  const v: any = row.value;
  if (typeof v === "string") return v;
  if (v && typeof v === "object" && "value" in v) return String(v.value);
  return def;
}

// Parse "198.51.100.10" with prefix "10.0" → { category: 20, octet: 2 }
function parse(ip: string, prefix: string): { category: number; octet: number } | null {
  if (!ip || !ip.startsWith(prefix + ".")) return null;
  const rest = ip.slice(prefix.length + 1).split(".");
  if (rest.length !== 2) return null;
  const category = parseInt(rest[0], 10);
  const octet = parseInt(rest[1], 10);
  if (Number.isNaN(category) || Number.isNaN(octet)) return null;
  return { category, octet };
}

export async function computeGroupingSuggestions(): Promise<GroupSuggestion[]> {
  const enabled = (await cfg("grouping.enabled", "false")) === "true";
  if (!enabled) return [];
  const prefix = await cfg("grouping.prefix", "10.0");
  const mult = parseInt(await cfg("grouping.wifiMultiplier", "10"), 10) || 10;

  const devices = await prisma.device.findMany({
    select: { id: true, ip: true, hostname: true, customName: true, isMainRouter: true },
  });

  const groups = new Map<string, GroupSuggestion>();

  for (const d of devices) {
    if (!d.ip) continue;
    const p = parse(d.ip, prefix);
    if (!p) continue;

    // Determine canonical ethernet category + whether this entry is the wifi side.
    // wifi category is ethernetCat * mult. So:
    //   if category is divisible by mult AND (category/mult) is a plausible eth cat → it's wifi
    let ethCat = p.category;
    let isWifi = false;
    if (p.category % mult === 0 && p.category >= mult) {
      ethCat = p.category / mult;
      isWifi = true;
    }
    const key = `${ethCat}:${p.octet}`;
    const name = d.customName || d.hostname || d.ip;

    let g = groups.get(key);
    if (!g) { g = { key, category: ethCat, octet: p.octet }; groups.set(key, g); }
    if (isWifi) g.wifi = { id: d.id, ip: d.ip, name };
    else        g.ethernet = { id: d.id, ip: d.ip, name };
  }

  // Only suggest groups that actually have BOTH an ethernet and a wifi side
  // (i.e. a real pair to merge), and neither is the main router.
  return [...groups.values()].filter(g => g.ethernet && g.wifi);
}
