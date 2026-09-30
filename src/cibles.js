// Validation de ce qui vient du réseau ou d'un formulaire et finit dans une
// commande (nmap, ping, ssh vers le routeur…).
//
// Les adresses, MAC et noms que MapMyLAN manipule sont en bonne partie
// annoncés par les appareils eux-mêmes : un appareil compromis choisit ce
// qu'il déclare. Rien n'entre donc dans une commande sans avoir été reconnu
// comme appartenant exactement à son format. Refus par défaut : on n'essaie
// jamais de « nettoyer » une valeur dangereuse pour la laisser passer.
import net from 'node:net';

export class ValeurRefusee extends Error {
  constructor(quoi, valeur) {
    super(`${quoi} invalide : ${JSON.stringify(String(valeur)).slice(0, 80)}`);
    this.name = 'ValeurRefusee';
    this.status = 400;
  }
}

// Chaque octet entre 0 et 255, sans zéro de tête : « 01 » et « 1 » désignent
// le même octet mais s'écrivent différemment, et c'est ainsi qu'on contourne
// un filtre.
export function estIPv4(v) {
  if (typeof v !== 'string') return false;
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(v);
  return !!m && [1, 2, 3, 4].every(i => Number(m[i]) <= 255 && String(Number(m[i])) === m[i]);
}
export const estIPv6 = v => typeof v === 'string' && v.length <= 45 && /^[0-9a-f:]+$/i.test(v) && net.isIPv6(v);
export const estIP = v => estIPv4(v) || estIPv6(v);
export const estMAC = v => typeof v === 'string' && /^([0-9a-f]{2}[:-]){5}[0-9a-f]{2}$/i.test(v);
export const estPort = v => Number.isInteger(Number(v)) && Number(v) >= 1 && Number(v) <= 65535;
export function estCidr(v) {
  if (typeof v !== 'string') return false;
  const [ip, bits, reste] = v.split('/');
  return reste === undefined && estIPv4(ip) && /^\d{1,2}$/.test(bits || '') && Number(bits) <= 32;
}
// Nom d'hôte DNS : lettres, chiffres, tirets, points ; jamais un tiret en tête
// (il serait lu comme une option par l'outil qui le reçoit).
export const estNomHote = v => typeof v === 'string' && v.length <= 253 && /^(?!-)[A-Za-z0-9-]{1,63}(?:\.(?!-)[A-Za-z0-9-]{1,63})*\.?$/.test(v);
export const estHote = v => estIP(v) || estNomHote(v);

export function exigerIP(v, quoi = 'Adresse IP') { if (!estIP(v)) throw new ValeurRefusee(quoi, v); return v; }
export function exigerIPv4(v, quoi = 'Adresse IPv4') { if (!estIPv4(v)) throw new ValeurRefusee(quoi, v); return v; }
export function exigerMAC(v, quoi = 'Adresse MAC') { if (!estMAC(v)) throw new ValeurRefusee(quoi, v); return v.replace(/-/g, ':').toUpperCase(); }
export function exigerCidr(v, quoi = 'Plage') { if (!estCidr(v)) throw new ValeurRefusee(quoi, v); return v; }
export function exigerHote(v, quoi = 'Hôte') { if (!estHote(v)) throw new ValeurRefusee(quoi, v); return v; }

// La cible d'une action de défense : point de passage obligé avant qu'une
// adresse n'entre dans une commande du routeur.
export function validerCible({ ip, mac, gateway }) {
  const out = { ip: exigerIPv4(ip, 'Adresse de la cible') };
  if (mac) out.mac = exigerMAC(mac, 'MAC de la cible');
  if (gateway) out.gateway = exigerIPv4(gateway, 'Passerelle');
  return out;
}

// Un nom annoncé par le réseau ne peut pas être refusé (l'appareil
// disparaîtrait de l'inventaire) : il est réduit à ce qu'un nom d'hôte peut
// contenir. Il ne sert jamais dans une commande, mais traverse le journal,
// l'interface, les messages Telegram et la mémoire.
export function nettoyerNom(v, max = 63) {
  if (typeof v !== 'string') return '';
  return v.normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, '')
    .replace(/[\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/g, '')
    .replace(/[^a-zA-Z0-9._\- ]/g, '')
    .trim().slice(0, max);
}
export function nettoyerTexte(v, max = 128) {
  if (typeof v !== 'string') return '';
  return v.normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
    .replace(/[\u200b-\u200f\u2028-\u202e\ufeff]/g, '')
    .replace(/\s+/g, ' ').trim().slice(0, max);
}

export function enEntier(ip) {
  if (!estIPv4(ip)) return null;
  return ip.split('.').reduce((n, o) => n * 256 + Number(o), 0);
}
export const enTexte = n => [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
export const prefixeDe = cidr => Number(String(cidr).split('/')[1]);
const masque = bits => (bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0);

// L'adresse de réseau d'un CIDR : un équipement rend souvent « a.b.c.1/24 »,
// dont la partie hôte est sa propre adresse, pas le réseau.
export function normaliserCidr(cidr) {
  const [adresse, p] = String(cidr).split('/');
  const n = enEntier(String(adresse).trim()), bits = Number(p);
  if (n === null || !Number.isInteger(bits) || bits < 0 || bits > 32) return null;
  return { reseau: `${enTexte((n & masque(bits)) >>> 0)}/${bits}`, bits };
}

export function dansLeReseau(ip, cidr) {
  const n = enEntier(ip), c = normaliserCidr(cidr);
  if (n === null || !c) return false;
  return ((n & masque(c.bits)) >>> 0) === enEntier(c.reseau.split('/')[0]);
}

// La plage `interieure` tient-elle entière dans `exterieure` ?
export function contenue(interieure, exterieure) {
  const a = normaliserCidr(interieure), b = normaliserCidr(exterieure);
  return !!a && !!b && a.bits >= b.bits && dansLeReseau(a.reseau.split('/')[0], b.reseau);
}

// Plages non routables sur Internet : ce qui est « chez nous » pour le
// classement du trafic. Écrites en octets pour être lues comme des nombres.
const PRIVEES = [[[10, 0, 0, 0], 8], [[172, 16, 0, 0], 12], [[192, 168, 0, 0], 16], [[127, 0, 0, 0], 8], [[169, 254, 0, 0], 16], [[100, 64, 0, 0], 10], [[0, 0, 0, 0], 8]];
const PRIVEES_CIDR = PRIVEES.map(([o, b]) => `${o.join('.')}/${b}`);
export function estPrivee(ip) {
  if (String(ip).includes(':')) {
    const b = String(ip).toLowerCase();
    return b === '::1' || b.startsWith('fe80') || b.startsWith('fc') || b.startsWith('fd');
  }
  const n = enEntier(ip);
  if (n === null) return false;
  if (n >= 224 * 2 ** 24) return true;
  return PRIVEES_CIDR.some(c => dansLeReseau(ip, c));
}
