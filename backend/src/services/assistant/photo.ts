// La photo du réseau que l'assistant lit avant de répondre.
//
// Une seule lecture de la base par question : les chiffres des widgets, le
// texte des chemins rapides et le contexte donné au modèle viennent tous de la
// même photo. Deux lectures séparées pouvaient dire « 12 appareils » dans la
// phrase et 13 dans la tuile d'à côté.

import { prisma } from "../../db";
import { globalHealthScore } from "../scoring";

const JOUR = 86_400_000;

export interface Appareil {
  id: string;
  nom: string;
  ip: string;
  mac: string | null;
  type: string;
  fabricant: string | null;
  vlan: number | null;
  etat: string;
  danger: number;
  cves: number;
  ports: number;
  premiereVue: Date;
  derniereVue: Date;
  routeur: boolean;
}

export interface Alerte {
  gravite: string;
  message: string;
  source: string;
  appareil: string | null;
  lue: boolean;
  le: Date;
}

export interface Photo {
  prise: Date;
  appareils: Appareil[];
  enLigne: number;
  horsLigne: Appareil[];
  nouveaux: Appareil[];
  risque: Appareil[];
  bloques: Appareil[];
  alertes: Alerte[];
  nonLues: Alerte[];
  vlans: { id: number; nom: string; plage: string; isole: boolean; appareils: number }[];
  dernierBalayage: { type: string; plage: string; etat: string; trouves: number; le: Date } | null;
  machine: { cpu: number; memoire: number; disque: number; temperature: number | null } | null;
  sante: number;
  cves: number;
  parJour: { jour: string; nouveaux: number; alertes: number }[];
}

/** Le nom qu'un humain reconnaît : celui qu'il a donné, sinon l'hôte, sinon l'adresse. */
export function nomAppareil(d: { customName?: string | null; hostname?: string | null; vendor?: string | null; ip: string }): string {
  return (d.customName || d.hostname || (d.vendor ? `${d.vendor} (${d.ip})` : d.ip)).slice(0, 60);
}

const jourCourt = (d: Date) => d.toLocaleDateString("fr-FR", { weekday: "short", day: "numeric" }).replace(".", "");

export async function prendrePhoto(): Promise<Photo> {
  const depuis7j = new Date(Date.now() - 7 * JOUR);
  const [bruts, alertesBrutes, vlans, balayage, metrique, sante] = await Promise.all([
    prisma.device.findMany({
      select: {
        id: true, ip: true, mac: true, hostname: true, customName: true, vendor: true, type: true, customType: true,
        vlan: true, status: true, dangerScore: true, firstSeen: true, lastSeen: true, isMainRouter: true,
        _count: { select: { cves: true, ports: true } },
      },
      orderBy: { lastSeen: "desc" },
      take: 5000,
    }),
    prisma.alert.findMany({ where: { createdAt: { gte: depuis7j } }, orderBy: { createdAt: "desc" }, take: 500 }),
    prisma.vlan.findMany({ select: { id: true, name: true, subnet: true, isolated: true }, orderBy: { id: "asc" } }),
    prisma.scanRun.findFirst({ orderBy: { startedAt: "desc" } }),
    prisma.hostMetric.findFirst({ orderBy: { createdAt: "desc" } }),
    globalHealthScore(),
  ]);

  const appareils: Appareil[] = bruts.map(d => ({
    id: d.id, nom: nomAppareil(d), ip: d.ip, mac: d.mac, type: d.customType || d.type, fabricant: d.vendor,
    vlan: d.vlan, etat: d.status, danger: d.dangerScore, cves: d._count.cves, ports: d._count.ports,
    premiereVue: d.firstSeen, derniereVue: d.lastSeen, routeur: d.isMainRouter,
  }));
  const parId = new Map(appareils.map(a => [a.id, a]));
  const alertes: Alerte[] = alertesBrutes.map(a => ({
    gravite: a.severity, message: a.message, source: a.source,
    appareil: (a.deviceId && parId.get(a.deviceId)?.nom) || a.deviceIp || null,
    lue: a.acknowledged, le: a.createdAt,
  }));

  const il24h = Date.now() - JOUR;
  const parJour = Array.from({ length: 7 }, (_, i) => {
    const debut = new Date(); debut.setHours(0, 0, 0, 0); debut.setDate(debut.getDate() - (6 - i));
    const fin = debut.getTime() + JOUR;
    return {
      jour: jourCourt(debut),
      nouveaux: appareils.filter(a => a.premiereVue.getTime() >= debut.getTime() && a.premiereVue.getTime() < fin).length,
      alertes: alertes.filter(a => a.le.getTime() >= debut.getTime() && a.le.getTime() < fin).length,
    };
  });

  return {
    prise: new Date(),
    appareils,
    enLigne: appareils.filter(a => a.etat === "online").length,
    horsLigne: appareils.filter(a => a.etat === "offline"),
    nouveaux: appareils.filter(a => a.premiereVue.getTime() >= il24h).sort((a, b) => b.premiereVue.getTime() - a.premiereVue.getTime()),
    risque: appareils.filter(a => a.danger > 0 && a.etat !== "offline").sort((a, b) => b.danger - a.danger),
    bloques: appareils.filter(a => a.etat === "banned" || a.etat === "quarantined"),
    alertes,
    nonLues: alertes.filter(a => !a.lue),
    vlans: vlans.map(v => ({ id: v.id, nom: v.name, plage: v.subnet, isole: v.isolated, appareils: appareils.filter(a => a.vlan === v.id).length })),
    dernierBalayage: balayage ? { type: balayage.type, plage: balayage.subnet, etat: balayage.status, trouves: balayage.hostsFound, le: balayage.endedAt || balayage.startedAt } : null,
    machine: metrique ? { cpu: Math.round(metrique.cpuPct), memoire: Math.round(metrique.memPct), disque: Math.round(metrique.diskPct), temperature: metrique.tempC } : null,
    sante,
    cves: appareils.reduce((n, a) => n + a.cves, 0),
    parJour,
  };
}

/** Un appareil nommé dans la question : par adresse IP, MAC, ou par son nom. */
export function appareilsCites(question: string, photo: Photo): Appareil[] {
  const q = question.toLowerCase();
  const out = new Set<Appareil>();
  for (const ip of question.match(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g) || []) photo.appareils.filter(a => a.ip === ip).forEach(a => out.add(a));
  for (const mac of question.match(/\b[0-9a-f]{2}(?:[:-][0-9a-f]{2}){5}\b/gi) || []) photo.appareils.filter(a => a.mac?.toLowerCase() === mac.toLowerCase().replace(/-/g, ":")).forEach(a => out.add(a));
  for (const a of photo.appareils) {
    const n = a.nom.toLowerCase();
    if (n.length >= 3 && !/^\d/.test(n) && q.includes(n)) out.add(a);
    if (out.size >= 5) break;
  }
  return [...out].slice(0, 5);
}
