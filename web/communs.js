// Petits outils partagés par les pages.
//
// Rien ici ne fabrique de donnée : ce qui n'est pas mesuré n'est pas affiché.
// C'est la raison pour laquelle certaines tuiles n'ont pas de courbe de fond —
// le serveur ne conserve pas l'historique correspondant, et une courbe
// inventée serait un mensonge joliment tracé.
import { ic, pictoType } from './dom.js';

/** Date lisible, ou tiret si l'information manque. */
export const fmtDate = d => (d ? new Date(d).toLocaleString() : '—');

/** Durée depuis un instant, en français, au plus près de l'usage parlé. */
export function depuis(d) {
  if (!d) return '—';
  const sec = Math.max(0, Math.round((Date.now() - new Date(d).getTime()) / 1000));
  if (sec < 60) return "à l'instant";
  const min = Math.round(sec / 60);
  if (min < 60) return `il y a ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `il y a ${h} h${min % 60 ? ` ${min % 60}` : ''}`;
  return `il y a ${Math.floor(h / 24)} j`;
}

/** Temps de service, en jours / heures. */
export function fmtUptime(s) {
  if (!s && s !== 0) return '—';
  const j = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  if (j > 0) return `${j} j ${h} h`;
  if (h > 0) return `${h} h ${m} min`;
  return `${m} min`;
}

/** Mégaoctets lisibles. */
export function fmtOctets(mo) {
  if (mo == null) return '—';
  if (mo >= 1024) return `${(mo / 1024).toFixed(1)} Gio`;
  return `${Math.round(mo)} Mio`;
}

/** Nom d'affichage d'un appareil : le plus parlant d'abord. */
export const nomAppareil = d => d?.customName || d?.hostname || d?.ip || '—';

/** Picto d'un appareil, d'après son type retenu. */
export const glyphe = (d, taille = 15) => ic(pictoType(d?.customType || d?.type), taille);

/** Libellé français d'un état d'appareil. */
export const ETATS = {
  online: 'en ligne', offline: 'hors ligne', suspect: 'suspect',
  banned: 'bloqué', quarantined: 'isolé',
};

/** Ton de pastille associé à un état. */
export function tonEtat(etat) {
  if (etat === 'online') return 'a';
  if (etat === 'banned' || etat === 'suspect' || etat === 'quarantined') return 'w';
  return undefined;
}

/** Liaison filaire ou sans fil, déduite de ce que le scanner a relevé. */
export function liaison(d) {
  const sansFil = d?.link === 'wireless' || d?.wireless === true || /wifi|wlan|ap/i.test(String(d?.iface || ''));
  return sansFil ? { label: 'sans fil', icon: 'air' } : { label: 'filaire', icon: 'wired' };
}

/** Tri décroissant par risque, sans modifier le tableau d'origine. */
export const triParRisque = devices => [...devices].sort((a, b) => (b.dangerScore || 0) - (a.dangerScore || 0));

/** Segment d'appartenance d'une adresse : le /24 qui la contient. */
export function segment(ip) {
  const m = /^(\d+\.\d+\.\d+)\.\d+$/.exec(ip || '');
  return m ? `${m[1]}.0/24` : '—';
}
