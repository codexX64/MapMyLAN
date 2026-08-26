// Petits outils partagés par les pages.
//
// Rien ici ne fabrique de donnée : ce qui n'est pas mesuré n'est pas affiché.
// C'est la raison pour laquelle certaines tuiles de la maquette n'ont pas de
// courbe de fond — le serveur ne conserve pas encore l'historique
// correspondant, et une courbe inventée serait un mensonge joliment tracé.

import { Icon, deviceIcon } from "../lib/icons";

/** Date lisible, ou tiret si l'information manque. */
export const fmtDate = (d: any) => (d ? new Date(d).toLocaleString() : "—");

/** Heure seule — pour les flux qui tiennent dans la journée. */
export const fmtHeure = (d: any) =>
  d ? new Date(d).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—";

/** Durée depuis un instant, en français, au plus près de l'usage parlé. */
export function depuis(d: any): string {
  if (!d) return "—";
  const sec = Math.max(0, Math.round((Date.now() - new Date(d).getTime()) / 1000));
  if (sec < 60) return "à l'instant";
  const min = Math.round(sec / 60);
  if (min < 60) return `il y a ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `il y a ${h} h${min % 60 ? ` ${min % 60}` : ""}`;
  const j = Math.floor(h / 24);
  return `il y a ${j} j`;
}

/** Temps de service, en jours / heures. */
export function fmtUptime(s: number): string {
  if (!s && s !== 0) return "—";
  const j = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  if (j > 0) return `${j} j ${h} h`;
  if (h > 0) return `${h} h ${m} min`;
  return `${m} min`;
}

/** Octets lisibles. */
export function fmtOctets(mo: number): string {
  if (mo == null) return "—";
  if (mo >= 1024) return `${(mo / 1024).toFixed(1)} Gio`;
  return `${Math.round(mo)} Mio`;
}

/** Nom d'affichage d'un appareil : le plus parlant d'abord. */
export const nomAppareil = (d: any) => d?.customName || d?.hostname || d?.ip || "—";

/** Picto d'un appareil, d'après son type retenu. */
export function GlypheAppareil({ d, size = 15 }: { d: any; size?: number }) {
  return <Icon name={deviceIcon(d?.customType || d?.type)} size={size}/>;
}

/** Libellé français d'un état d'appareil. */
export const ETATS: Record<string, string> = {
  online: "en ligne", offline: "hors ligne", suspect: "suspect",
  banned: "bloqué", quarantined: "isolé",
};

/** Ton de pastille associé à un état. */
export function tonEtat(etat: string): "a" | "w" | undefined {
  if (etat === "online") return "a";
  if (etat === "banned" || etat === "suspect" || etat === "quarantined") return "w";
  return undefined;
}

/** Liaison filaire ou sans fil, déduite de ce que le scanner a relevé. */
export function liaison(d: any): { label: string; icon: string } {
  const sansFil = d?.link === "wireless" || d?.wireless === true || /wifi|wlan|ap/i.test(String(d?.iface || ""));
  return sansFil ? { label: "sans fil", icon: "air" } : { label: "filaire", icon: "wired" };
}

/** Tri décroissant sans modifier le tableau d'origine. */
export function triParRisque(devices: any[]): any[] {
  return [...devices].sort((a, b) => (b.dangerScore || 0) - (a.dangerScore || 0));
}
