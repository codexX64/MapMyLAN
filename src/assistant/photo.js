// La photo du réseau que l'assistant lit avant de répondre : une seule
// lecture de la base par question, pour que les widgets, les réponses rapides
// et le contexte du modèle disent les mêmes chiffres.
const JOUR = 86400e3;

export const nomAppareil = d => String(d.customName || d.hostname || (d.vendor ? `${d.vendor} (${d.ip})` : d.ip)).slice(0, 60);
const jourCourt = d => d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', timeZone: 'UTC' }).replace('.', '');

export function prendrePhoto(s) {
  const { db } = s;
  const depuis7j = Date.now() - 7 * JOUR;
  const bruts = db.prepare('SELECT * FROM appareils ORDER BY lastSeen DESC LIMIT 5000').all();
  const ports = new Map(), cves = new Map();
  for (const p of db.prepare("SELECT deviceId, port, protocol, service FROM ports WHERE state = 'open' ORDER BY port").all()) (ports.get(p.deviceId) || ports.set(p.deviceId, []).get(p.deviceId)).push(p);
  for (const c of db.prepare('SELECT deviceId, cveId, cvss, severity FROM cves ORDER BY cvss DESC').all()) (cves.get(c.deviceId) || cves.set(c.deviceId, []).get(c.deviceId)).push(c);
  const appareils = bruts.map(d => {
    const p = ports.get(d.id) || [], c = cves.get(d.id) || [];
    return {
      id: d.id, nom: nomAppareil(d), ip: d.ip, mac: d.mac, type: d.customType || d.type, fabricant: d.vendor, vlan: d.vlan, etat: d.status,
      danger: d.dangerScore, cves: c.length, ports: p.length, premiereVue: new Date(d.firstSeen), derniereVue: new Date(d.lastSeen), routeur: d.isMainRouter === 1,
      portsDetail: p.slice(0, 25).map(x => ({ port: x.port, proto: x.protocol, service: x.service })),
      cvesDetail: c.slice(0, 5).map(x => ({ id: x.cveId, cvss: x.cvss, gravite: x.severity })),
    };
  });
  const parId = new Map(appareils.map(a => [a.id, a]));
  const alertes = db.prepare('SELECT * FROM alertes WHERE createdAt >= ? ORDER BY createdAt DESC LIMIT 500').all(depuis7j).map(a => ({
    gravite: a.severity, message: a.message, source: a.source, appareil: (a.deviceId && parId.get(a.deviceId)?.nom) || a.deviceIp || null,
    lue: a.acknowledged === 1, le: new Date(a.createdAt),
  }));
  const vlans = db.prepare('SELECT id, name, subnet, isolated FROM vlans ORDER BY id').all();
  const balayage = db.prepare('SELECT * FROM balayages ORDER BY startedAt DESC LIMIT 1').get();
  const mesure = db.prepare('SELECT * FROM mesures_hote ORDER BY createdAt DESC LIMIT 1').get();
  const il24h = Date.now() - JOUR;
  const parJour = Array.from({ length: 7 }, (_, i) => {
    const debut = new Date(); debut.setUTCHours(0, 0, 0, 0); debut.setUTCDate(debut.getUTCDate() - (6 - i));
    const d0 = debut.getTime(), d1 = d0 + JOUR;
    return {
      jour: jourCourt(debut),
      nouveaux: appareils.filter(a => a.premiereVue.getTime() >= d0 && a.premiereVue.getTime() < d1).length,
      alertes: alertes.filter(a => a.le.getTime() >= d0 && a.le.getTime() < d1).length,
    };
  });
  return {
    prise: new Date(), appareils,
    enLigne: appareils.filter(a => a.etat === 'online').length,
    horsLigne: appareils.filter(a => a.etat === 'offline'),
    nouveaux: appareils.filter(a => a.premiereVue.getTime() >= il24h).sort((a, b) => b.premiereVue - a.premiereVue),
    risque: appareils.filter(a => a.danger > 0 && a.etat !== 'offline').sort((a, b) => b.danger - a.danger),
    bloques: appareils.filter(a => a.etat === 'banned' || a.etat === 'quarantined'),
    alertes, nonLues: alertes.filter(a => !a.lue),
    vlans: vlans.map(v => ({ id: v.id, nom: v.name, plage: v.subnet, isole: v.isolated === 1, appareils: appareils.filter(a => a.vlan === v.id).length })),
    dernierBalayage: balayage ? { type: balayage.type, plage: balayage.subnet, etat: balayage.status, trouves: balayage.hostsFound, le: new Date(balayage.endedAt || balayage.startedAt) } : null,
    machine: mesure ? { cpu: Math.round(mesure.cpuPct), memoire: Math.round(mesure.memPct), disque: Math.round(mesure.diskPct), temperature: mesure.tempC } : null,
    sante: s.scores.sante(),
    santeSur: appareils.filter(a => a.etat !== 'offline').length,
    cves: appareils.reduce((n, a) => n + a.cves, 0),
    parJour,
  };
}

// Un appareil nommé dans la question : par adresse, par MAC ou par son nom.
export function appareilsCites(question, photo) {
  const q = question.toLowerCase();
  const out = new Set();
  for (const ip of question.match(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g) || []) photo.appareils.filter(a => a.ip === ip).forEach(a => out.add(a));
  for (const mac of question.match(/\b[0-9a-f]{2}(?:[:-][0-9a-f]{2}){5}\b/gi) || []) photo.appareils.filter(a => a.mac?.toLowerCase() === mac.toLowerCase().replace(/-/g, ':')).forEach(a => out.add(a));
  for (const a of photo.appareils) {
    const n = a.nom.toLowerCase();
    if (n.length >= 3 && !/^\d/.test(n) && q.includes(n)) out.add(a);
    if (out.size >= 5) break;
  }
  return [...out].slice(0, 5);
}
