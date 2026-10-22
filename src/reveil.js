// Réveil par le réseau (Wake-on-LAN) : le paquet magique, six octets 0xFF
// puis l'adresse MAC seize fois, en diffusion UDP sur les ports 9 et 7.
//
// MapMyLAN tourne sur le réseau de la machine (balayage ARP) : sa diffusion
// atteint le segment où il voit les appareils, éteints compris. Elle part sur
// l'adresse de diffusion de chaque interface du réseau local (les ponts et
// interfaces virtuelles de Docker exceptés) et sur 255.255.255.255. Une
// diffusion ne franchit pas un routeur : un appareil d'un autre VLAN demande
// un MapMyLAN (ou un relais) dans ce VLAN.
import dgram from 'node:dgram';
import os from 'node:os';

const MAC_RE = /^(?:[0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}$/;
const VIRTUELLES = /^(docker\d*|br-|veth|virbr|lo$|tailscale|wg|tun|tap|cni|flannel|kube)/;

// Une MAC d'appareil : six octets, ni diffusion ni multidiffusion (bit de
// poids faible du premier octet), ni zéros.
export function macReveil(mac) {
  const m = String(mac || '').trim();
  if (!MAC_RE.test(m)) return null;
  const propre = m.replace(/[:-]/g, '').toLowerCase();
  if (parseInt(propre.slice(0, 2), 16) & 1 || /^0{12}$/.test(propre)) return null;
  return propre.match(/../g).join(':');
}

export function paquetMagique(mac) {
  const m = macReveil(mac);
  if (!m) throw new Error('adresse MAC invalide');
  const corps = Buffer.from(m.replace(/:/g, ''), 'hex');
  const pkt = Buffer.alloc(6 + 16 * 6, 0xff);
  for (let i = 0; i < 16; i++) corps.copy(pkt, 6 + i * 6);
  return pkt;
}

const versEntier = ip => ip.split('.').reduce((n, o) => (n * 256) + Number(o), 0);
const versIp = n => [24, 16, 8, 0].map(d => Math.floor(n / 2 ** d) % 256).join('.');

// Les adresses de diffusion du réseau local, une par interface IPv4 réelle ;
// l'interface de balayage seule quand elle est réglée.
export function diffusions(interfaces = os.networkInterfaces(), { seule = '' } = {}) {
  const sorties = new Set();
  for (const [nom, adresses] of Object.entries(interfaces)) {
    if (seule ? nom !== seule : VIRTUELLES.test(nom)) continue;
    for (const a of adresses || []) {
      if (a.family !== 'IPv4' && a.family !== 4) continue;
      if (a.internal || !a.netmask) continue;
      const ip = versEntier(a.address), masque = versEntier(a.netmask);
      if (masque === 0xffffffff) continue;
      sorties.add(versIp((ip | (~masque >>> 0)) >>> 0));
    }
  }
  return [...sorties];
}

// Envoie le paquet sur chaque adresse et chaque port ; rend les adresses où
// au moins un envoi est parti. Un envoi refusé n'arrête pas les autres.
export function emettre(mac, adresses, { ports = [9, 7], creer = () => dgram.createSocket('udp4') } = {}) {
  const pkt = paquetMagique(mac);
  const cibles = [...new Set([...adresses, '255.255.255.255'])];
  return new Promise((resolve, reject) => {
    const s = creer();
    const parties = new Set();
    let restants = cibles.length * ports.length;
    const fermer = () => { try { s.close(); } catch { /* déjà fermé */ } };
    s.once('error', e => { fermer(); reject(e); });
    s.bind(0, () => {
      s.setBroadcast(true);
      for (const adresse of cibles) for (const port of ports) {
        s.send(pkt, port, adresse, e => {
          if (!e) parties.add(adresse);
          if (--restants === 0) { fermer(); resolve([...parties]); }
        });
      }
    });
  });
}
