// Collecte continue du trafic vers et depuis l'extérieur, lue dans la table
// de suivi des connexions de la passerelle (conntrack), en SSH. Une seule
// boucle côté serveur : l'historique se construit onglet fermé, et
// l'équipement n'est interrogé qu'une fois quel que soit le nombre de pages.
import dns from 'node:dns/promises';
import { nouvelId, transaction } from './db.js';
import { estIP, estPrivee, enEntier, estIPv4 } from './cibles.js';
import { dansLePrefixe, adresseDeRegistre } from './registre.js';

// Commandes de relevé, écrites ici en entier : rien d'extérieur n'y entre.
const COMMANDES = [
  'conntrack -L -p tcp --state ESTABLISHED 2>/dev/null | head -n 400',
  'conntrack -L 2>/dev/null | head -n 400',
  'cat /proc/net/nf_conntrack 2>/dev/null | head -n 400',
  'ss -tunH state established 2>/dev/null | head -n 400',
  'netstat -tun 2>/dev/null | head -n 400',
];
const PORTS_WEB = new Set([80, 443, 8080, 8443, 8843, 8880]);
const NOMS_PAR_TOUR = 400, NOMS_EN_PARALLELE = 24;
const PERIODE_MS = 20_000, PERIODES_ECHEC = [60_000, 120_000, 300_000, 600_000];

// Ports qui n'ont rien à faire ouverts sur l'extérieur.
const PORTS_SENSIBLES = new Map([[21, 'FTP'], [22, 'SSH'], [23, 'Telnet'], [135, 'RPC'], [139, 'NetBIOS'], [445, 'SMB'], [1433, 'SQL Server'], [3306, 'MySQL'],
  [3389, 'Bureau à distance'], [5432, 'PostgreSQL'], [5900, 'VNC'], [6379, 'Redis'], [9200, 'Elasticsearch'], [11211, 'Memcached'], [27017, 'MongoDB']]);

// Une ligne de conntrack porte l'aller et le retour. Derrière une traduction
// d'adresses, c'est le retour qui montre la machine du parc d'une connexion entrante.
export function lireConntrack(ligne) {
  if (!/src=/.test(ligne)) return null;
  const proto = /^\s*(?:ipv[46]\s+\d+\s+)?(tcp|udp)/i.exec(ligne)?.[1]?.toLowerCase() || /\b(tcp|udp)\b/i.exec(ligne)?.[1]?.toLowerCase() || 'tcp';
  const tous = re => [...ligne.matchAll(re)].map(m => m[1]);
  const src = tous(/src=(\S+)/g), dst = tous(/dst=(\S+)/g), sport = tous(/sport=(\d+)/g).map(Number), dport = tous(/dport=(\d+)/g).map(Number);
  const tuples = [];
  for (let i = 0; i < Math.min(src.length, dst.length); i++) tuples.push({ src: src[i], dst: dst[i], sport: sport[i] || 0, dport: dport[i] || 0 });
  if (!tuples.length) return null;
  const somme = re => [...ligne.matchAll(re)].reduce((t, m) => t + Number(m[1]), 0);
  return { proto, octets: somme(/bytes=(\d+)/g), paquets: somme(/packets=(\d+)/g), tuples };
}

// Sortante : l'aller part du parc vers le public (le port compte est celui
// atteint au loin). Entrante : le retour part du parc vers le public (le port
// qui compte est celui ouvert chez nous). Les deux s'excluent.
export function classerFlux(l, estLocale) {
  const [aller, retour] = l.tuples;
  const commun = { proto: l.proto, octets: l.octets, paquets: l.paquets };
  if (aller && estIP(aller.src) && estIP(aller.dst) && estLocale(aller.src) && !estLocale(aller.dst)) return { ...commun, src: aller.src, dst: aller.dst, port: aller.dport, direction: 'sortant' };
  if (retour && estIP(retour.src) && estIP(retour.dst) && estLocale(retour.src) && !estLocale(retour.dst)) return { ...commun, src: retour.src, dst: retour.dst, port: retour.sport, direction: 'entrant' };
  return null;
}

// « ss » et « netstat » ne disent pas qui a ouvert la connexion : rangé en sortant.
function lireSocket(ligne) {
  const c = ligne.trim().split(/\s+/);
  if (c.length < 5) return null;
  const coupe = s => { const i = s.lastIndexOf(':'); return i < 0 ? null : { ip: s.slice(0, i).replace(/^\[|\]$/g, ''), port: Number(s.slice(i + 1)) }; };
  const a = coupe(c.at(-2)), b = coupe(c.at(-1));
  if (!a || !b || !estIP(a.ip) || !estIP(b.ip)) return null;
  return { src: a.ip, dst: b.ip, port: b.port, proto: /udp/i.test(c[0]) ? 'udp' : 'tcp', octets: 0, paquets: 0, direction: 'sortant' };
}

// Trois règles, et une phrase vraie pour chacune : un point rouge sans raison n'apprend rien.
export function juger(f, appareil) {
  if (f.direction === 'entrant' && PORTS_SENSIBLES.has(f.port)) return { suspect: true, raison: `${PORTS_SENSIBLES.get(f.port)} (port ${f.port}) atteint depuis l’extérieur` };
  const etat = String(appareil?.status || '');
  if (['banned', 'quarantined', 'suspect'].includes(etat)) return { suspect: true, raison: `l’appareil est ${{ banned: 'bloqué', quarantined: 'en quarantaine', suspect: 'signalé' }[etat]} et communique encore` };
  const note = Number(appareil?.dangerScore || 0);
  if (note >= 75) return { suspect: true, raison: `note de risque de l’appareil : ${note}/100` };
  return { suspect: false, raison: null };
}

// Le domaine enregistrable d'un nom d'hôte, sans la liste publique des suffixes.
export function domaineDe(nom) {
  if (!nom) return undefined;
  const p = nom.toLowerCase().replace(/\.$/, '').split('.');
  if (p.length < 2) return undefined;
  return /^(co|com|net|org|gov|edu|ac|or|ne)\.[a-z]{2}$/.test(p.slice(-2).join('.')) && p.length >= 3 ? p.slice(-3).join('.') : p.slice(-2).join('.');
}

export class Trafic {
  constructor(s) {
    this.s = s;
    this.etat = {};
    this.noms = new Map();
    this.retenue = null;
    this.echecs = 0;
    this.minuteur = null;
  }

  // Les équipements écartés du relevé : pilotés par API, ou dont le port
  // déclaré est celui d'une interface web (pas un SSH).
  ecartees() {
    return this.s.db.prepare('SELECT id, name, host, port, transport FROM equipements ORDER BY createdAt').all()
      .filter(d => d.transport === 'api' || PORTS_WEB.has(d.port))
      .map(d => ({ id: d.id, nom: d.name, hote: d.host, port: d.port, transport: d.transport === 'api' ? 'api' : 'ssh' }));
  }

  // De quoi afficher l'en-tête : équipement, dernier relevé, volume conservé.
  etatPublic() {
    const { db, reglages } = this.s;
    const n = sql => db.prepare(sql).get().n;
    const c = this.cible();
    const ancien = db.prepare('SELECT MIN(lastSeen) d FROM flux_trafic').get().d;
    return {
      ...this.etat,
      cible: c ? { id: c.id, nom: c.name, hote: c.host, port: c.port } : null,
      ecartees: this.ecartees(),
      total: n('SELECT COUNT(*) n FROM flux_trafic'), signales: n('SELECT COUNT(*) n FROM flux_trafic WHERE suspect = 1'),
      entrants: n("SELECT COUNT(*) n FROM flux_trafic WHERE direction = 'entrant'"),
      tailleMo: Number(this.mesure().mo.toFixed(2)), plusAncien: ancien ?? null,
      retentionJours: Number(reglages.lire('world.retentionDays', 30)), retentionMaxMo: Number(reglages.lire('world.retentionMaxMb', 0)),
    };
  }

  cible() {
    const utiles = this.s.db.prepare('SELECT id, name, host, port, transport, isMainRouter FROM equipements ORDER BY createdAt').all()
      .filter(d => d.transport !== 'api' && !PORTS_WEB.has(d.port));
    return utiles.find(d => d.isMainRouter) || utiles[0] || null;
  }

  async nomInverse(ip) {
    try {
      const noms = await Promise.race([dns.reverse(ip), new Promise(r => setTimeout(() => r([]), 2500).unref())]);
      return String(noms[0] || '').replace(/\.$/, '').slice(0, 253);
    } catch { return ''; }
  }

  // Un PTR d'adresse publique est le même depuis n'importe où : résolu ici,
  // en parallèle, et gardé.
  async resoudreNoms(ips) {
    const manquants = ips.filter(ip => !this.noms.has(ip) && adresseDeRegistre(ip)).slice(0, NOMS_PAR_TOUR);
    let i = 0;
    await Promise.all(Array.from({ length: Math.min(NOMS_EN_PARALLELE, manquants.length) }, async () => {
      while (i < manquants.length) { const ip = manquants[i++]; this.noms.set(ip, await this.nomInverse(ip)); }
    }));
    if (this.noms.size > 50000) this.noms.clear();
  }

  async collecter() {
    const { db } = this.s;
    const cible = this.cible();
    if (!cible) { this.etat = { erreur: 'Aucun équipement interrogeable.' }; return this.etat; }
    const aEssayer = this.retenue ? [this.retenue, ...COMMANDES.filter(c => c !== this.retenue)] : COMMANDES;
    let brut = '', commande = '', erreur = '', liaisonPerdue = false;
    for (const c of aEssayer) {
      try {
        const r = await this.s.equipements.contexteDe(this.s.equipements.ligne(cible.id)).exec(c);
        if (r.stdout.trim()) { brut = r.stdout.trim(); commande = c; break; }
        if (r.stderr) erreur = r.stderr.trim().slice(0, 200);
      } catch (e) {
        erreur = e.message;
        // Un équipement qui refuse la connexion la refusera encore : pas cinq ouvertures pour rien.
        if (e.liaison) { liaisonPerdue = true; break; }
      }
    }
    if (!brut) { this.etat = { equipement: cible.name, quand: Date.now(), liaisonPerdue, erreur: erreur || 'Aucune commande de relevé n’a produit de sortie.' }; return this.etat; }
    this.retenue = commande;
    this.s.equipements.noterConnexion(cible.id);
    const appareils = db.prepare('SELECT ip, status, dangerScore FROM appareils').all();
    const duParc = new Set(appareils.map(d => d.ip));
    const parIp = new Map(appareils.map(d => [d.ip, d]));
    const estLocale = ip => estPrivee(ip) || duParc.has(ip);
    const parCle = new Map();
    for (const ligne of brut.split('\n').slice(0, 2000)) {
      const l = lireConntrack(ligne);
      const f = l ? classerFlux(l, estLocale) : lireSocket(ligne);
      if (!f || !estIP(f.dst) || !estIP(f.src) || estLocale(f.dst) || !estLocale(f.src)) continue;
      const cle = `${f.src}|${f.dst}|${f.port}|${f.proto}`;
      const vu = parCle.get(cle);
      if (vu) { vu.octets += f.octets; vu.paquets += f.paquets; } else parCle.set(cle, { ...f });
    }
    const flux = [...parCle.values()];
    const destinations = [...new Set(flux.map(f => f.dst))];
    await this.resoudreNoms(destinations);
    const fiches = await this.nommer(flux, destinations);
    if (flux.length) {
      const t = Date.now();
      const ecrire = db.prepare(`INSERT INTO flux_trafic(id, srcIp, dstIp, port, proto, firstSeen, lastSeen, bytes, packets, hits, host, domain, operator, logo, country, direction, suspect, raison)
        VALUES(?,?,?,?,?,?,?,?,?,1,?,?,?,?,?,?,?,?)
        ON CONFLICT(srcIp, dstIp, port, proto) DO UPDATE SET lastSeen = excluded.lastSeen, hits = hits + 1, bytes = bytes + excluded.bytes, packets = packets + excluded.packets,
          host = COALESCE(excluded.host, host), domain = COALESCE(excluded.domain, domain), operator = COALESCE(excluded.operator, operator),
          logo = COALESCE(excluded.logo, logo), country = COALESCE(excluded.country, country),
          direction = excluded.direction, suspect = excluded.suspect, raison = excluded.raison`);
      transaction(db, () => {
        for (const f of flux) {
          const hote = this.noms.get(f.dst) || null;
          const fiche = fiches.get(f.dst);
          const domaine = domaineDe(hote || undefined) || fiche?.domaine || null;
          const marque = juger(f, parIp.get(f.src));
          ecrire.run(nouvelId(), f.src, f.dst, f.port, f.proto, t, t, f.octets, f.paquets, hote, domaine, fiche?.organisation || fiche?.reseau || null, domaine, fiche?.pays || null, f.direction, marque.suspect ? 1 : 0, marque.raison);
        }
      });
    }
    this.etat = { equipement: cible.name, quand: Date.now(), commande, fluxVus: flux.length };
    return this.etat;
  }

  // Le registre, une adresse à la fois (il limite les rafales), les plus gros
  // échanges d'abord, une minute au plus par tour. Une fiche décrit un bloc :
  // elle nomme aussi les autres destinations du bloc, anciennes comprises.
  async nommer(flux, destinations) {
    const fiches = new Map();
    const registre = this.s.registre;
    if (!destinations.length || !registre.actif()) return fiches;
    const connues = new Set();
    const lire = this.s.db.prepare("SELECT 1 FROM flux_trafic WHERE dstIp = ? AND COALESCE(operator, '') != '' AND COALESCE(country, '') != '' LIMIT 1");
    for (const ip of destinations) if (lire.get(ip)) connues.add(ip);
    const volume = new Map();
    for (const f of flux) volume.set(f.dst, (volume.get(f.dst) || 0) + (f.octets || 0));
    const aNommer = destinations.filter(ip => !connues.has(ip) && adresseDeRegistre(ip)).sort((a, b) => (volume.get(b) || 0) - (volume.get(a) || 0));
    const echeance = Date.now() + 60_000;
    const blocs = [];
    for (const ip of aNommer) {
      if (fiches.has(ip)) continue;
      const f = await registre.fiche(ip);
      fiches.set(ip, f);
      if (f.organisation || f.reseau) {
        for (const autre of aNommer) if (!fiches.has(autre) && dansLePrefixe(f, autre)) fiches.set(autre, { ...f, ip: autre });
        if (f.debut !== undefined) blocs.push(f);
      }
      if (Date.now() > echeance) break;
    }
    if (blocs.length) this.rattraper(blocs);
    return fiches;
  }

  // Les destinations déjà en base, du même bloc et sans titulaire : nommées sans rien redemander.
  rattraper(blocs) {
    const { db } = this.s;
    const poser = db.prepare("UPDATE flux_trafic SET operator = COALESCE(NULLIF(operator, ''), ?), country = COALESCE(country, ?), domain = COALESCE(domain, ?), logo = COALESCE(logo, ?) WHERE id = ?");
    transaction(db, () => {
      for (const l of db.prepare("SELECT id, dstIp FROM flux_trafic WHERE operator IS NULL OR operator = ''").all()) {
        if (!estIPv4(l.dstIp)) continue;
        const n = enEntier(l.dstIp);
        const f = blocs.find(b => n >= b.debut && n <= b.fin);
        if (f) poser.run(f.organisation || f.reseau, f.pays || null, f.domaine || null, f.domaine || null, l.id);
      }
    });
  }

  // Taille approchée des lignes vivantes : la somme de ce qu'elles portent.
  mesure() {
    const r = this.s.db.prepare(`SELECT COUNT(*) lignes, COALESCE(SUM(LENGTH(id) + LENGTH(srcIp) + LENGTH(dstIp) + LENGTH(proto) + LENGTH(direction)
      + COALESCE(LENGTH(host), 0) + COALESCE(LENGTH(domain), 0) + COALESCE(LENGTH(operator), 0) + COALESCE(LENGTH(logo), 0)
      + COALESCE(LENGTH(country), 0) + COALESCE(LENGTH(raison), 0) + 64), 0) octets FROM flux_trafic`).get();
    return { mo: r.octets / 1048576, lignes: r.lignes };
  }

  // Deux limites facultatives : l'âge (world.retentionDays, 30 par défaut)
  // puis la taille (world.retentionMaxMb), en retirant les plus anciens.
  purger() {
    const { db, reglages, evts } = this.s;
    const jours = Number(reglages.lire('world.retentionDays', 30)), maxMo = Number(reglages.lire('world.retentionMaxMb', 0));
    const parAge = jours > 0 ? db.prepare('DELETE FROM flux_trafic WHERE lastSeen < ?').run(Date.now() - jours * 86400e3).changes : 0;
    let parTaille = 0;
    let { mo, lignes } = this.mesure();
    if (maxMo > 0 && mo > maxMo && lignes > 0) {
      const garder = Math.max(1, Math.floor(maxMo / (mo / lignes)));
      if (garder < lignes) {
        parTaille = db.prepare('DELETE FROM flux_trafic WHERE id IN (SELECT id FROM flux_trafic ORDER BY lastSeen ASC LIMIT ?)').run(lignes - garder).changes;
        ({ mo, lignes } = this.mesure());
      }
    }
    if (parAge || parTaille) evts.journaliser('info', 'trafic', `Purge du trafic : ${parAge} flux hors délai, ${parTaille} au-delà de la taille — ${lignes} flux conservés, ${mo.toFixed(2)} Mo`);
    return { parAge, parTaille, mo };
  }

  demarrer() {
    if (this.minuteur) return;
    const tour = async () => {
      try { this.echecs = (await this.collecter()).erreur ? this.echecs + 1 : 0; } catch { this.echecs++; }
      this.minuteur = setTimeout(tour, this.echecs ? PERIODES_ECHEC[Math.min(this.echecs - 1, PERIODES_ECHEC.length - 1)] : PERIODE_MS);
      this.minuteur.unref();
    };
    this.minuteur = setTimeout(tour, 12_000);
    this.minuteur.unref();
  }

  arreter() { clearTimeout(this.minuteur); this.minuteur = null; }

  relancer() { this.echecs = 0; return this.collecter(); }
}
