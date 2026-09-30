// Balayage du réseau, par plusieurs sources : arp-scan, nmap (découverte,
// services, système), mDNS (avahi), NetBIOS (nmblookup), SNMP (snmpget), et
// l'équipement réseau lui-même. Chaque hôte est enrichi au fil des sources,
// puis classé (classement.js) et enregistré.
//
// Chaque outil est lancé par executeur.js, arguments en tableau ; la seule
// valeur variable qu'il reçoit est une adresse ou une plage validée ici, après
// « -- » quand l'outil l'accepte.
import { ErreurHttp } from '../socle/src/index.js';
import { classer } from './classement.js';
import { nouvelId, transaction } from './db.js';
import { fabricantDe } from './oui.js';
import { estIPv4, estCidr, prefixeDe, dansLeReseau, contenue, nettoyerNom, nettoyerTexte } from './cibles.js';

const INTERFACE = /^(?!-)[A-Za-z0-9_.:-]{1,15}$/;
// Au-delà d'un /22, un balayage ARP émet des dizaines de milliers de trames ;
// les tables de voisinage donnent le même résultat utile sans émettre.
const PREFIXE_MIN_ACTIF = 22;
const CONCURRENCE = 5;

function lireArpScan(sortie) {
  // Une IP qui répond avec plusieurs MAC (« DUP: n ») n'est pas plusieurs
  // appareils : une machine à plusieurs cartes, ou un pont. On garde une
  // entrée, la MAC dont le fabricant est connu de préférence.
  const parIp = new Map();
  for (const ligne of sortie.split('\n')) {
    const m = /^(\d{1,3}(?:\.\d{1,3}){3})\s+([0-9a-fA-F:]{17})(?:\s+(.+))?/.exec(ligne);
    if (!m || !estIPv4(m[1])) continue;
    const mac = m[2].toUpperCase();
    const brut = (m[3] || '').replace(/\s*\(DUP:\s*\d+\)\s*$/i, '').trim();
    const vendor = brut && !/^\(unknown\)$/i.test(brut) ? nettoyerTexte(brut, 80) : undefined;
    const cur = parIp.get(m[1]);
    if (!cur) parIp.set(m[1], { mac, vendor, alt: [] });
    else { cur.alt.push(mac); if (vendor && !cur.vendor) { cur.mac = mac; cur.vendor = vendor; } }
  }
  return [...parIp].map(([ip, e]) => ({ ip, mac: e.mac, vendor: e.vendor, ports: [], ...(e.alt.length ? { altMacs: [...new Set(e.alt)] } : {}) }));
}

export function lireNmapGrep(sortie) {
  const hotes = [];
  for (const ligne of sortie.split('\n')) {
    const m = /^Host:\s+(\S+)\s+\(([^)]*)\)\s+Status:\s+Up/.exec(ligne);
    if (m && estIPv4(m[1])) hotes.push({ ip: m[1], hostname: nettoyerNom(m[2]) || undefined, ports: [] });
  }
  return hotes;
}

export function lireNmapDetail(ip, sortie) {
  const hote = { ip, ports: [] };
  const mac = /MAC Address:\s+([0-9A-F:]{17})\s*(?:\((.+?)\))?/i.exec(sortie);
  if (mac) { hote.mac = mac[1].toUpperCase(); if (mac[2]) hote.vendor = nettoyerTexte(mac[2], 80); }
  const os = /OS details:\s+(.+)/.exec(sortie) || /Running:\s+(.+)/.exec(sortie);
  if (os) hote.os = nettoyerTexte(os[1], 200);
  const re = /^(\d+)\/(tcp|udp)\s+(\w+)\s+(\S+)(?:\s+(.+))?/gm;
  let p;
  while ((p = re.exec(sortie)) !== null) {
    if (!p[3].startsWith('open')) continue;
    const version = /^(\S+)\s*(.*)$/.exec((p[5] || '').trim());
    hote.ports.push({ port: Number(p[1]), protocol: p[2], state: p[3], service: nettoyerTexte(p[4], 60), product: version?.[1] ? nettoyerTexte(version[1], 80) : undefined, version: version?.[2] ? nettoyerTexte(version[2], 120) : undefined });
  }
  return hote;
}

export class Scanner {
  constructor(s) {
    this.s = s;
    this.interfaceMemo = null;
    this.passerelleMemo = undefined;
    this.enCours = null;
  }

  get x() { return this.s.executeur; }

  // Les plages configurées, sinon le réglage scan.subnet, sinon SCAN_SUBNET.
  plagesActives() {
    const brut = this.s.reglages.lire('scan.ranges', []);
    const retenues = (Array.isArray(brut) ? brut : [])
      .filter(p => p && p.enabled !== false && estCidr(p.cidr))
      .map(p => ({ cidr: p.cidr, label: p.label, enabled: true }));
    if (retenues.length) return retenues;
    const cidr = this.s.reglages.lire('scan.subnet') || this.s.cfg.sousReseau;
    return [{ cidr, label: 'Par défaut', enabled: true }];
  }

  // Une plage que MapMyLAN a le droit de balayer : déclarée par un
  // administrateur (plages de balayage, VLAN), et pas plus large qu'un /16.
  plageAutorisee(cidr) {
    if (!estCidr(cidr) || prefixeDe(cidr) < 16) throw new ErreurHttp(400, 'Plage invalide : un CIDR IPv4 de /16 ou plus étroit.');
    const declarees = [...this.plagesActives().map(p => p.cidr), ...this.s.db.prepare('SELECT subnet FROM vlans').all().map(v => v.subnet)];
    if (!declarees.some(d => contenue(cidr, d))) throw new ErreurHttp(400, 'Plage non déclarée : ajoute-la aux plages de balayage (Réglages) ou déclare le VLAN.');
    return cidr;
  }

  // Une adresse que MapMyLAN peut sonder : dans une plage ou un VLAN déclaré.
  adresseAutorisee(ip) {
    if (!estIPv4(ip)) return false;
    const declarees = [...this.plagesActives().map(p => p.cidr), ...this.s.db.prepare('SELECT subnet FROM vlans').all().map(v => v.subnet)];
    return declarees.some(c => dansLeReseau(ip, c));
  }

  async interfacePour(cidr) {
    if (this.s.cfg.interfaceScan) return this.s.cfg.interfaceScan;
    if (this.interfaceMemo) return this.interfaceMemo;
    try {
      const r = await this.x.executer('ip', ['-4', '-o', 'addr', 'show'], { delaiMs: 8000 });
      for (const ligne of r.stdout.split('\n')) {
        const m = /^\d+:\s+(\S+)\s+inet\s+(\d{1,3}(?:\.\d{1,3}){3})/.exec(ligne);
        if (m && INTERFACE.test(m[1]) && dansLeReseau(m[2], cidr) && !/^(lo|docker|br-|veth)/.test(m[1])) return (this.interfaceMemo = m[1]);
      }
    } catch (e) { this.s.evts.journaliser('warn', 'scanner', `Interfaces illisibles : ${e.message}`); }
    return null;
  }

  async passerelleSysteme() {
    if (this.passerelleMemo !== undefined) return this.passerelleMemo;
    try {
      const r = await this.x.executer('ip', ['route', 'show', 'default'], { delaiMs: 5000 });
      const m = /default\s+via\s+(\d{1,3}(?:\.\d{1,3}){3})/.exec(r.stdout);
      this.passerelleMemo = m && estIPv4(m[1]) ? m[1] : null;
    } catch { this.passerelleMemo = null; }
    return this.passerelleMemo;
  }

  async voisinage(cidr) {
    try {
      const r = await this.x.executer('ip', ['neigh', 'show'], { delaiMs: 8000 });
      return r.stdout.split('\n').map(l => {
        const m = /^(\d{1,3}(?:\.\d{1,3}){3})\s+.*lladdr\s+([0-9a-fA-F:]{17})/.exec(l);
        if (!m || !estIPv4(m[1]) || !dansLeReseau(m[1], cidr) || /FAILED|INCOMPLETE/.test(l)) return null;
        return { ip: m[1], mac: m[2].toUpperCase(), ports: [] };
      }).filter(Boolean);
    } catch { return []; }
  }

  async arpEquipement() {
    try {
      const { adaptateur, ctx } = this.s.equipements.principalPilotable();
      if (!adaptateur.arp) return [];
      return (await adaptateur.arp(ctx)).filter(e => estIPv4(e.ip) && /^[0-9A-F:]{17}$/i.test(e.mac || ''))
        .map(e => ({ ip: e.ip, mac: e.mac.toUpperCase(), vendor: e.vendor ? nettoyerTexte(e.vendor, 80) : undefined, ports: [] }));
    } catch { return []; }
  }

  async balayageArp(cidr) {
    if (prefixeDe(cidr) < PREFIXE_MIN_ACTIF) {
      this.s.evts.journaliser('warn', 'scanner', `${cidr} est trop large pour un balayage ARP : lecture des tables de voisinage à la place.`);
      const v = await this.voisinage(cidr);
      return v.length ? v : this.arpEquipement();
    }
    const iface = await this.interfacePour(cidr);
    const essais = [
      ...(iface ? [['-I', iface, '-q', '--', cidr]] : []),
      ['-q', '--', cidr],
      ['-q', '--localnet'],
    ];
    for (const args of essais) {
      try {
        const hotes = lireArpScan((await this.x.executer('arp-scan', args, { delaiMs: 60_000 })).stdout);
        if (hotes.length) {
          if (args !== essais[0]) this.s.evts.journaliser('info', 'scanner', `arp-scan par repli : ${args.join(' ')}`);
          return hotes.filter(h => dansLeReseau(h.ip, cidr) || args.includes('--localnet'));
        }
      } catch (e) {
        // Un délai dépassé dit une cible trop large, pas une commande à
        // reformuler : réessayer empilerait les processus.
        if (e.delaiDepasse) break;
      }
    }
    const v = await this.voisinage(cidr);
    if (v.length) { this.s.evts.journaliser('info', 'scanner', `arp-scan indisponible, ${v.length} voisins lus dans le noyau`); return v; }
    const e = await this.arpEquipement();
    if (e.length) { this.s.evts.journaliser('info', 'scanner', `arp-scan indisponible, ${e.length} entrées lues sur l’équipement`); return e; }
    this.s.evts.journaliser('warn', 'scanner', 'Aucune découverte couche 2 : ni arp-scan, ni voisinage du noyau, ni équipement.');
    return [];
  }

  async balayagePing(cidr) {
    if (prefixeDe(cidr) < PREFIXE_MIN_ACTIF) { this.s.evts.journaliser('warn', 'scanner', `${cidr} trop large pour un balayage ping, ignoré.`); return []; }
    try {
      const r = await this.x.executer('nmap', ['--privileged', '-sn', '-n', '-PE', '-PA80,443', '-PS22,80,443', '-T4', '--max-retries', '1', '-oG', '-', '--', cidr], { delaiMs: 60_000 });
      return lireNmapGrep(r.stdout);
    } catch (e) { this.s.evts.journaliser('warn', 'scanner', `Balayage ping en échec : ${e.message}`); return []; }
  }

  async approfondi(ip) {
    if (!estIPv4(ip)) throw new ErreurHttp(400, 'Adresse invalide.');
    const r = await this.x.executer('nmap', ['--privileged', '-F', '-sV', '-O', '--osscan-guess', '-T4', '--max-retries', '2', '--host-timeout', '60s', '-n', '--', ip], { delaiMs: 90_000 });
    return lireNmapDetail(ip, r.stdout);
  }

  async mdns() {
    const carte = {};
    try {
      const r = await this.x.executer('avahi-browse', ['-p', '-t', '-r', '-a'], { delaiMs: 15_000 });
      for (const ligne of r.stdout.split('\n')) {
        // =;eth0;IPv4;<service>;<type>;<domaine>;<hôte>;<adresse>;<port>;<txt>
        if (!ligne.startsWith('=;')) continue;
        const p = ligne.split(';');
        const adresse = p[7];
        if (!estIPv4(adresse)) continue;
        carte[adresse] ??= { name: nettoyerNom(String(p[6] || '').replace(/\.local$/, '')) || undefined, services: [] };
        if (p[4] && carte[adresse].services.length < 30) carte[adresse].services.push(nettoyerTexte(p[4], 60));
      }
    } catch { /* avahi absent ou muet : les autres sources suffisent */ }
    return carte;
  }

  async netbios(ip) {
    try {
      const r = await this.x.executer('nmblookup', ['-A', '--', ip], { delaiMs: 6000 });
      const m = /(\S+)\s+<00>\s+-\s+\S?\s*<ACTIVE>/.exec(r.stdout);
      return m ? nettoyerNom(m[1]) || null : null;
    } catch { return null; }
  }

  async snmp(ip) {
    try {
      const r = await this.x.executer('snmpget', ['-v', '2c', '-c', 'public', '-t', '2', '-r', '0', '--', ip, '1.3.6.1.2.1.1.1.0', '1.3.6.1.2.1.1.5.0'], { delaiMs: 5000 });
      const descr = /sysDescr\.0 = STRING:\s+(.+)/.exec(r.stdout)?.[1];
      const nom = /sysName\.0 = STRING:\s+(.+)/.exec(r.stdout)?.[1];
      return { sysDescr: descr ? nettoyerTexte(descr, 200) : undefined, sysName: nom ? nettoyerNom(nom) || undefined : undefined };
    } catch { return {}; }
  }

  async ping(ip) {
    if (!estIPv4(ip)) return { alive: false };
    try {
      const r = await this.x.executer('ping', ['-c', '2', '-W', '1', '-n', '--', ip], { delaiMs: 5000 });
      if (r.code !== 0) return { alive: false };
      const m = /min\/avg\/max\/(?:mdev|stddev)\s*=\s*[\d.]+\/([\d.]+)/.exec(r.stdout);
      return { alive: true, ...(m ? { latencyMs: Number(m[1]) } : {}) };
    } catch { return { alive: false }; }
  }

  // Ce que l'équipement réseau sait : ses clients (port, borne, signal), son
  // infrastructure (passerelle, commutateurs, bornes) et ses réseaux.
  async vueEquipement() {
    const vues = new Map();
    let infra = 0;
    let pilote;
    try { pilote = this.s.equipements.principalPilotable(); } catch { return { hotes: [], vues, infra }; }
    const { adaptateur, ctx } = pilote;
    if (!adaptateur.clients) return { hotes: [], vues, infra };
    const hotes = [];
    try {
      if (adaptateur.infrastructure) {
        const equipements = await adaptateur.infrastructure(ctx).catch(() => []);
        for (const e of equipements) {
          if (!estIPv4(e.ip)) continue;
          hotes.push({ ip: e.ip, mac: e.mac, hostname: nettoyerNom(e.name || '') || undefined, vendor: 'Ubiquiti', ports: [] });
          vues.set(e.ip, { infra: true, infraKind: e.kind, modele: e.model ? nettoyerTexte(e.model, 60) : undefined, uplinkMac: e.uplinkMac, uplinkPort: e.uplinkPort, uplinkMedium: e.uplinkMedium, wanIp: e.wanIp, medium: e.uplinkMedium });
          infra++;
          // La box de l'opérateur, en amont de la passerelle : recensée pour
          // que la liaison montante existe sur la carte.
          if (estIPv4(e.wanGateway || '') && !vues.has(e.wanGateway)) {
            hotes.push({ ip: e.wanGateway, ports: [] });
            vues.set(e.wanGateway, { operateur: true, infraKind: 'router', medium: 'wired' });
          }
        }
        // Les adresses que la passerelle porte sur chaque VLAN ne sont pas des
        // machines : la carte doit savoir qu'elles lui appartiennent.
        if (adaptateur.networks) {
          const passerelle = equipements.find(e => e.kind === 'router');
          for (const r of await adaptateur.networks(ctx).catch(() => [])) {
            if (!estIPv4(r.passerelle || '') || vues.get(r.passerelle)?.infra) continue;
            vues.set(r.passerelle, { ...(vues.get(r.passerelle) || {}), passerelleDe: passerelle?.mac, vlanDeclare: r.vlan, nomReseau: r.nom ? nettoyerTexte(r.nom, 60) : undefined, infraKind: 'router', medium: 'wired' });
          }
        }
      }
      for (const c of await adaptateur.clients(ctx)) {
        if (!estIPv4(c.ip || '')) continue;
        const mac = /^[0-9a-f:]{17}$/i.test(c.mac || '') ? c.mac.toUpperCase() : undefined;
        hotes.push({ ip: c.ip, mac, hostname: nettoyerNom(c.hostname || '') || undefined, vendor: c.vendor ? nettoyerTexte(c.vendor, 80) : undefined, ports: [] });
        vues.set(c.ip, {
          swPort: c.swPort, swMac: c.swMac ? String(c.swMac).toUpperCase() : undefined, apMac: c.apMac ? String(c.apMac).toUpperCase() : undefined,
          essid: c.essid ? nettoyerTexte(c.essid, 32) : undefined, radio: c.radio, rssi: c.rssi, medium: c.medium, blocked: c.blocked,
        });
      }
      return { hotes, vues, infra };
    } catch { return { hotes: [], vues, infra: 0 }; }
  }

  fusionner(base, detail, mdns, netbios, snmp) {
    const h = {
      ...base, ...(detail || {}),
      mac: detail?.mac || base.mac, vendor: detail?.vendor || base.vendor,
      hostname: detail?.hostname || base.hostname || mdns?.name || netbios || snmp?.sysName,
      os: detail?.os || base.os || snmp?.sysDescr,
      ports: detail?.ports || base.ports || [],
      mdnsName: mdns?.name, mdnsServices: mdns?.services, netbios: netbios || undefined,
    };
    if ((!h.vendor || /^unknown$/i.test(h.vendor)) && h.mac) h.vendor = fabricantDe(h.mac) || h.vendor;
    return h;
  }

  // Enregistre un hôte : par MAC d'abord, par adresse ensuite — une machine
  // dont la MAC change (adaptateur, MAC aléatoire) met à jour sa fiche au lieu
  // d'en créer une seconde. Une adresse, un appareil.
  async enregistrer(h, vue, passerelle) {
    const A = this.s.appareils;
    if (!h.mac && !h.ip) return null;
    let existant = h.mac ? A.parMac(h.mac) : null;
    if (!existant && h.ip) existant = A.parIp(h.ip);
    const signale = this.s.db.prepare('SELECT 1 FROM appareils WHERE ip = ? AND isMainRouter = 1').get(h.ip);
    const cls = classer({ ...h, isGateway: (!!passerelle && passerelle === h.ip) || !!signale });
    // Ce que le constructeur déclare l'emporte sur la reconnaissance.
    const type = vue?.infra || vue?.operateur || vue?.passerelleDe ? (vue.infraKind || cls.type) : cls.type;
    const metadata = {
      mdnsName: h.mdnsName, mdnsServices: h.mdnsServices, netbios: h.netbios,
      ...(vue ? {
        swPort: vue.swPort, swMac: vue.swMac, apMac: vue.apMac, essid: vue.essid, radio: vue.radio, rssi: vue.rssi, medium: vue.medium,
        infra: vue.infra, infraKind: vue.infraKind, modele: vue.modele, uplinkMac: vue.uplinkMac, uplinkPort: vue.uplinkPort,
        uplinkMedium: vue.uplinkMedium, operateur: vue.operateur, wanIp: vue.wanIp, passerelleDe: vue.passerelleDe,
        vlanDeclare: vue.vlanDeclare, nomReseau: vue.nomReseau,
      } : {}),
      typeConfidence: cls.confidence, typeReasons: cls.reasons, typeRunnerUp: cls.runnerUp,
    };
    const champs = { ip: h.ip, mac: h.mac || existant?.mac || null, hostname: h.hostname || null, vendor: h.vendor || null, os: h.os || null, type, status: 'online', lastSeen: Date.now(), metadata };
    if (!existant && !h.mac) return null;
    // La fiche, son historique et ses ports ensemble ; les avis partent ensuite.
    let nouveau = null;
    const d = transaction(this.s.db, () => {
      let ligne;
      if (existant) {
        if (existant.ip !== h.ip) A.noter(existant.id, 'ip_change', { from: existant.ip, to: h.ip });
        if (h.mac && existant.mac && existant.mac !== h.mac) A.noter(existant.id, 'mac_change', { from: existant.mac, to: h.mac });
        // Une MAC déjà portée par une autre fiche (doublon ancien) : on garde la
        // fiche et on ne lui vole pas sa MAC.
        if (h.mac && h.mac !== existant.mac && A.parMac(h.mac)) champs.mac = existant.mac;
        ligne = A.modifier(existant.id, champs);
      } else {
        ligne = A.creer({ ...champs, metadata: JSON.stringify(metadata) });
        A.noter(ligne.id, 'first_seen', { ip: h.ip, vendor: h.vendor || 'Unknown' });
        // L'avis d'arrivée montre l'appareil tel qu'il est découvert, avant ses ports.
        nouveau = A.complet(ligne.id);
      }
      if (h.ports.length) A.remplacerPorts(ligne.id, h.ports);
      return ligne;
    });
    const id = d.id;
    if (nouveau) {
      this.s.extensions.appareil('device.first_seen', { id, ip: h.ip, mac: h.mac, vendor: h.vendor || null });
      this.s.evts.emettre('alert:new', { newDevice: true, device: nouveau });
      const nom = d.hostname || d.ip;
      this.s.commandes.declencher('device.new', { deviceId: id, ip: d.ip, mac: d.mac, vendor: d.vendor || 'Unknown', hostname: d.hostname || '', type: d.type });
      if (!d.vendor || d.vendor === 'Unknown') this.s.commandes.declencher('device.unknown_vendor', { deviceId: id, ip: d.ip, mac: d.mac });
      if (d.type === 'iot') this.s.commandes.declencher('device.iot', { deviceId: id, ip: d.ip, name: nom, vendor: d.vendor });
    }
    return id;
  }

  // Toutes les plages, l'une après l'autre : plusieurs balayages ARP
  // simultanés saturent la carte réseau et faussent les résultats.
  async toutBalayer() {
    if (this.enCours) return this.enCours;
    this.enCours = (async () => {
      const plages = this.plagesActives();
      let total = 0, dernier = null;
      for (const p of plages) {
        const r = await this.balayerUne(p.cidr);
        total += r.hostsFound; dernier = r.runId;
      }
      if (plages.length > 1) this.s.evts.journaliser('info', 'scanner', `${plages.length} plages balayées · ${total} hôte(s) au total`);
      return { hostsFound: total, runId: dernier };
    })().finally(() => { this.enCours = null; });
    return this.enCours;
  }

  async balayer(cidr) {
    if (!cidr) return this.toutBalayer();
    if (this.enCours) return this.enCours;
    this.enCours = this.balayerUne(cidr).finally(() => { this.enCours = null; });
    return this.enCours;
  }

  async balayerUne(cidr) {
    const { db, evts } = this.s;
    const run = { id: nouvelId(), startedAt: Date.now() };
    db.prepare("INSERT INTO balayages(id, type, subnet, status, hostsFound, startedAt) VALUES(?, 'full', ?, 'running', 0, ?)").run(run.id, cidr, run.startedAt);
    evts.journaliser('info', 'scanner', `Balayage complet de ${cidr}`);
    evts.emettre('scan:started', { runId: run.id, subnet: cidr });
    try {
      // Découverte : ARP, ping et équipement au même rang. L'ARP voit ce qui
      // a parlé, le ping ce qui répond, l'équipement ce qu'il porte.
      const [arp, ping, mdns, equipement] = await Promise.all([this.balayageArp(cidr), this.balayagePing(cidr), this.mdns(), this.vueEquipement()]);
      const parIp = new Map();
      const ajouter = h => {
        const e = parIp.get(h.ip);
        if (!e) { parIp.set(h.ip, { ...h }); return; }
        e.mac ||= h.mac; e.hostname ||= h.hostname; e.vendor ||= h.vendor;
      };
      for (const h of [...arp, ...ping, ...equipement.hotes]) ajouter(h);
      // La racine de la carte : la passerelle que déclare l'équipement, sinon
      // celle du système.
      const racine = [...equipement.vues].find(([, v]) => v.infra && v.infraKind === 'router')?.[0];
      const passerelle = await this.passerelleSysteme();
      if (!racine && passerelle && !parIp.has(passerelle) && dansLeReseau(passerelle, cidr)) parIp.set(passerelle, { ip: passerelle, ports: [] });
      // Les autres adresses de la passerelle ne sont pas des appareils.
      const garder = racine || passerelle || null;
      const adressesPasserelle = this.s.vlans.adressesDePasserelle();
      if (garder) adressesPasserelle.delete(garder);
      if (adressesPasserelle.size) {
        for (const ip of adressesPasserelle) parIp.delete(ip);
        this.s.vlans.purgerPasserelles(garder);
      }
      const hotes = [...parIp.values()];
      if (equipement.hotes.length) evts.journaliser('info', 'scanner', `Équipement réseau : ${equipement.hotes.length - equipement.infra} client(s) et ${equipement.infra} équipement(s) d’infrastructure rapporté(s)`);
      evts.emettre('scan:progress', { runId: run.id, phase: 'discovery', hostsFound: hotes.length });
      // Enrichissement par lots : nmap détaillé, NetBIOS, SNMP.
      const enrichis = [];
      for (let i = 0; i < hotes.length; i += CONCURRENCE) {
        const lot = hotes.slice(i, i + CONCURRENCE);
        enrichis.push(...await Promise.all(lot.map(async h => {
          const [detail, nb, sn] = await Promise.all([this.approfondi(h.ip).catch(() => undefined), this.netbios(h.ip), this.snmp(h.ip)]);
          return this.fusionner(h, detail, mdns[h.ip], nb, sn);
        })));
        evts.emettre('scan:progress', { runId: run.id, phase: 'enriching', done: enrichis.length, total: hotes.length });
      }
      for (const h of enrichis) await this.enregistrer(h, equipement.vues.get(h.ip), passerelle);
      // Ce qui n'a pas été vu depuis dix minutes passe hors ligne.
      db.prepare("UPDATE appareils SET status = 'offline' WHERE lastSeen < ? AND status = 'online'").run(Date.now() - 10 * 60e3);
      db.prepare("UPDATE balayages SET status = 'complete', hostsFound = ?, endedAt = ? WHERE id = ?").run(enrichis.length, Date.now(), run.id);
      evts.journaliser('success', 'scanner', `Balayage terminé : ${enrichis.length} hôte(s)`);
      evts.emettre('scan:complete', { runId: run.id, hostsFound: enrichis.length });
      this.s.extensions.balayage({ runId: run.id, hotes: enrichis.length, enLigne: enrichis.length, plage: cidr, duree: Date.now() - run.startedAt });
      this.s.commandes.declencher('scan.complete', { devices: enrichis.length, duration: Math.round((Date.now() - run.startedAt) / 1000) });
      evts.emettre('devices:updated');
      return { hostsFound: enrichis.length, runId: run.id };
    } catch (e) {
      db.prepare("UPDATE balayages SET status = 'failed', error = ?, endedAt = ? WHERE id = ?").run(String(e.message).slice(0, 300), Date.now(), run.id);
      evts.journaliser('error', 'scanner', `Balayage en échec : ${e.message}`);
      this.s.commandes.declencher('scan.failed', { error: String(e.message).slice(0, 200) });
      throw e;
    }
  }
}
