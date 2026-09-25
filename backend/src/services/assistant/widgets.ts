// Les widgets de l'assistant : les mêmes que ceux du Hub (tuiles, barres,
// classement, liste), remplis avec le réseau.
//
// Ils viennent de la question, pas de la réponse : « combien d'appareils ? »
// appelle les tuiles, « les nouveaux ? » la liste des nouveaux. Un bonjour
// n'en appelle aucun, et une réponse n'en porte jamais plus de deux (trois
// pour un tableau de bord demandé comme tel) — des widgets à chaque message
// finissent par ne plus être regardés.

import type { Photo, Appareil } from "./photo";

export type Widget =
  | { type: "stats"; titre: string; tuiles: { label: string; valeur: number; sous?: string; etat?: "err" | "warn" }[] }
  | { type: "activite"; titre: string; legende: { ok: string; err: string }; barres: { jour: string; ok: number; err: number }[]; ok: number; err: number }
  | { type: "rang"; titre: string; lignes: { nom: string; valeur: number; detail: string; niveau: "ok" | "warn" | "err" }[] }
  | { type: "liste"; titre: string; lignes: { nom: string; detail: string; etat: "ok" | "warn" | "err" }[]; reste: number; vide: string };

export type TypeWidget = "stats" | "nouveaux" | "alertes" | "risque" | "horsligne" | "activite" | "vlans" | "bloques";

const REGLES: [TypeWidget, RegExp][] = [
  ["stats", /\b(état|etat|résumé|resume|situation|sant[ée]|combien|tableau de bord|dashboard|vue d.ensemble|comment va|bilan|point sur)\b/i],
  ["nouveaux", /\b(nouveaux?|nouvel(le)?s?|apparus?|inconnus?|arriv[ée]s?)\b/i],
  ["alertes", /\b(alertes?|incidents?|critiques?|attaques?|intrus(ion)?s?)\b/i],
  ["risque", /\b(risques?|dangereu[xs]e?s?|dangers?|vuln[ée]rab\w*|cves?|failles?|menaces?|suspects?)\b/i],
  ["horsligne", /\b(hors[- ]ligne|déconnect\w*|deconnect\w*|offline|éteints?|eteints?|injoignables?|down)\b/i],
  ["activite", /\b(activit[ée]|historique|semaine|tendance|graphique|évolution|evolution|7 jours)\b/i],
  ["vlans", /\bvlans?\b/i],
  ["bloques", /\b(bloqu[ée]s?|bann[ie]s?|quarantaine|isol[ée]s?)\b/i],
];

/** Les widgets que la question appelle, dans l'ordre où elle les nomme. */
export function devine(question: string, { sobre = false } = {}): TypeWidget[] {
  if (sobre) return [];
  const trouves = REGLES
    .map(([t, re]) => ({ t, i: question.search(re) }))
    .filter(x => x.i >= 0)
    .sort((a, b) => a.i - b.i)
    .map(x => x.t);
  const max = /tableau de bord|dashboard|vue d.ensemble/i.test(question) ? 3 : 2;
  return [...new Set(trouves)].slice(0, max);
}

const niveau = (danger: number): "ok" | "warn" | "err" => (danger >= 60 ? "err" : danger >= 30 ? "warn" : "ok");
const MOT_ETAT: Record<string, string> = { online: "en ligne", offline: "hors ligne", suspect: "suspect", quarantined: "en quarantaine", banned: "bloqué" };
const heure = (d: Date) => d.toLocaleString("fr-FR", { weekday: "short", hour: "2-digit", minute: "2-digit" });

function liste(titre: string, appareils: Appareil[], detail: (a: Appareil) => string, etat: (a: Appareil) => "ok" | "warn" | "err", vide: string): Widget {
  return {
    type: "liste", titre, vide,
    lignes: appareils.slice(0, 8).map(a => ({ nom: a.nom, detail: detail(a), etat: etat(a) })),
    reste: Math.max(0, appareils.length - 8),
  };
}

export function construire(t: TypeWidget, p: Photo): Widget | null {
  switch (t) {
    case "stats":
      return {
        type: "stats", titre: "Le réseau en ce moment",
        tuiles: [
          { label: "Appareils", valeur: p.appareils.length, sous: `${p.enLigne} en ligne` },
          { label: "Nouveaux (24 h)", valeur: p.nouveaux.length, ...(p.nouveaux.length ? { etat: "warn" as const } : {}) },
          { label: "Alertes non lues", valeur: p.nonLues.length, ...(p.nonLues.some(a => /crit|high|haute/i.test(a.gravite)) ? { etat: "err" as const } : {}) },
          { label: "Santé", valeur: p.sante, sous: "sur 100", ...(p.sante < 60 ? { etat: "err" as const } : {}) },
        ],
      };
    case "nouveaux":
      return liste("Nouveaux appareils · 24 h", p.nouveaux, a => `${a.ip} · vu ${heure(a.premiereVue)}`, a => niveau(a.danger), "Aucun nouvel appareil depuis hier.");
    case "horsligne":
      return liste("Hors ligne", p.horsLigne, a => `${a.ip} · dernière fois ${heure(a.derniereVue)}`, () => "err", "Tout répond.");
    case "bloques":
      return liste("Bloqués ou en quarantaine", p.bloques, a => `${a.ip} · ${MOT_ETAT[a.etat] || a.etat}`, () => "err", "Aucun appareil bloqué.");
    case "risque":
      return {
        type: "rang", titre: "Les plus exposés",
        lignes: p.risque.slice(0, 6).map(a => ({
          nom: a.nom, valeur: a.danger, niveau: niveau(a.danger),
          detail: `${a.ip} · danger ${a.danger}/100${a.cves ? ` · ${a.cves} CVE` : ""}${a.ports ? ` · ${a.ports} port${a.ports > 1 ? "s" : ""} ouvert${a.ports > 1 ? "s" : ""}` : ""}`,
        })),
      };
    case "alertes":
      return {
        type: "liste", titre: "Alertes non lues", vide: "Aucune alerte en attente.",
        lignes: p.nonLues.slice(0, 8).map(a => ({
          nom: a.message.slice(0, 90), detail: `${a.gravite}${a.appareil ? ` · ${a.appareil}` : ""} · ${heure(a.le)}`,
          etat: /crit|high|haute|élev/i.test(a.gravite) ? "err" : /med|moy|warn/i.test(a.gravite) ? "warn" : "ok",
        })),
        reste: Math.max(0, p.nonLues.length - 8),
      };
    case "activite": {
      const barres = p.parJour.map(j => ({ jour: j.jour, ok: j.nouveaux, err: j.alertes }));
      return { type: "activite", titre: "Sept derniers jours", legende: { ok: "Nouveaux appareils", err: "Alertes" }, barres,
        ok: barres.reduce((n, b) => n + b.ok, 0), err: barres.reduce((n, b) => n + b.err, 0) };
    }
    case "vlans":
      return {
        type: "liste", titre: "VLAN", vide: "Aucun VLAN déclaré.",
        lignes: p.vlans.slice(0, 10).map(v => ({ nom: `${v.id} · ${v.nom}`, detail: `${v.plage} · ${v.appareils} appareil${v.appareils > 1 ? "s" : ""}${v.isole ? " · isolé" : ""}`, etat: "ok" as const })),
        reste: Math.max(0, p.vlans.length - 10),
      };
  }
}

export function widgetsPour(question: string, p: Photo, opts: { sobre?: boolean } = {}): Widget[] {
  return devine(question, opts).map(t => construire(t, p)).filter((w): w is Widget => !!w);
}
