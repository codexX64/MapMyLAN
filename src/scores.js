// Notation d'un appareil sur quatre axes, de 0 à 100 :
//   confiance (trustScore)  — connu, stable, identifié ? plus haut = mieux ;
//   activité (activityScore) — alertes récentes qui le visent ;
//   exposition (vulnScore)   — ports à risque, CVE connues ;
//   danger (dangerScore)     — la synthèse, qui pilote les règles automatiques.
import { nouvelId } from './db.js';
import { lireJson } from './formes.js';

const PORTS_RISQUES = {
  21: [8, 'FTP (en clair)'], 23: [18, 'Telnet (en clair, obsolète)'], 69: [8, 'TFTP (sans authentification)'], 111: [6, 'Portmap/RPC exposé'],
  135: [8, 'MS-RPC exposé'], 139: [10, 'NetBIOS-SSN'], 445: [14, 'SMB (vérifier que v1 est coupé)'], 512: [16, 'rexec (obsolète)'],
  513: [16, 'rlogin (obsolète)'], 514: [12, 'rsh / syslog UDP'], 1433: [10, 'MSSQL exposé'], 1900: [6, 'UPnP/SSDP'], 3306: [10, 'MySQL exposé'],
  3389: [14, 'RDP (cible de force brute)'], 5900: [14, 'VNC (souvent non chiffré)'], 6379: [12, 'Redis (sans authentification par défaut)'],
  9200: [8, 'Elasticsearch'], 27017: [12, 'MongoDB'],
};

const VULNERABILITES = [
  { motif: /OpenSSH 7\.[0-2]/i, cve: 'CVE-2016-0777', cvss: 5.9, severity: 'medium', description: 'OpenSSH client info leak' },
  { motif: /OpenSSH 8\.[0-3]/i, cve: 'CVE-2020-15778', cvss: 7.8, severity: 'high', description: 'scp argument injection' },
  { motif: /OpenSSH 8\.4/i, cve: 'CVE-2023-38408', cvss: 9.8, severity: 'high', description: 'ssh-agent forwarding RCE' },
  { motif: /Apache\/2\.4\.4[0-9]/i, cve: 'CVE-2021-41773', cvss: 7.5, severity: 'high', description: 'Apache path traversal' },
  { motif: /vsftpd\/2\.3\.4/i, cve: 'CVE-2011-2523', cvss: 9.8, severity: 'high', description: 'vsftpd backdoor' },
  { motif: /Samba\s*3\./i, cve: 'CVE-2017-7494', cvss: 9.8, severity: 'high', description: 'SambaCry RCE' },
  { motif: /microsoft.*iis\/[5-7]/i, cve: 'CVE-2017-7269', cvss: 9.8, severity: 'high', description: 'IIS WebDAV RCE' },
];

const borner = n => Math.max(0, Math.min(100, Math.round(n)));

export class Scores {
  constructor(s) { this.s = s; }

  noter(id) {
    const { db, evts, appareils } = this.s;
    const d = appareils.ligne(id);
    if (!d) return null;
    const meta = lireJson(d.metadata, {}) || {};
    const raisons = { trust: [], activity: [], vuln: [] };
    const plus = (axe, reason, delta) => raisons[axe].push({ reason, delta });

    let confiance = 50;
    if (d.whitelisted) { confiance += 30; plus('trust', 'Liste blanche', 30); }
    if (d.isMainRouter) { confiance += 30; plus('trust', 'Routeur principal (protégé)', 30); }
    if (d.vendor && d.vendor !== 'Unknown') { confiance += 15; plus('trust', `Fabricant identifié : ${d.vendor}`, 15); } else { confiance -= 20; plus('trust', 'Fabricant inconnu', -20); }
    if (d.hostname || meta.netbios || meta.mdnsName) { confiance += 10; plus('trust', 'Nom identifié', 10); }
    if (!d.mac) { confiance -= 15; plus('trust', 'Aucune MAC relevée', -15); }
    const age = Date.now() - d.firstSeen;
    if (age > 7 * 86400e3) { confiance += 15; plus('trust', 'Connu depuis plus d’une semaine', 15); }
    else if (age > 86400e3) { confiance += 5; plus('trust', 'Connu depuis plus d’un jour', 5); }
    else { confiance -= 5; plus('trust', 'Découvert récemment', -5); }
    const changementsIp = db.prepare("SELECT COUNT(*) n FROM (SELECT event FROM historique WHERE deviceId = ? ORDER BY createdAt DESC LIMIT 50) WHERE event = 'ip_change'").get(id).n;
    if (changementsIp > 3) { confiance -= 10; plus('trust', `${changementsIp} changements d’adresse récents`, -10); }
    confiance = borner(confiance);

    let activite = 0;
    const alertes = db.prepare('SELECT severity, source, message FROM alertes WHERE createdAt > ? AND (deviceId = ? OR deviceIp = ? OR (deviceMac IS NOT NULL AND deviceMac = ?))')
      .all(Date.now() - 86400e3, id, d.ip, d.mac || '');
    for (const a of alertes) {
      const pts = { critical: 25, high: 15, medium: 8, low: 3 }[String(a.severity).toLowerCase()] || 0;
      if (!pts) continue;
      activite += pts;
      plus('activity', `${a.source} : ${String(a.message).slice(0, 60)}`, pts);
      if (activite > 100) break;
    }
    activite = borner(activite);

    let exposition = 0;
    const ports = db.prepare("SELECT * FROM ports WHERE deviceId = ? AND state = 'open'").all(id);
    for (const p of ports) {
      const r = PORTS_RISQUES[p.port];
      if (r) { exposition += r[0]; plus('vuln', `Port ${p.port} ouvert : ${r[1]}`, r[0]); }
    }
    if (ports.length > 10) { const extra = Math.min(20, (ports.length - 10) * 2); exposition += extra; plus('vuln', `${ports.length} ports ouverts (excessif)`, extra); }
    const inserer = db.prepare(`INSERT INTO cves(id, deviceId, cveId, cvss, severity, description, service, detectedAt) VALUES(?,?,?,?,?,?,?,?)
      ON CONFLICT(deviceId, cveId) DO UPDATE SET detectedAt = excluded.detectedAt`);
    for (const p of ports) {
      const version = `${p.product || ''} ${p.version || ''}`.trim();
      if (!version) continue;
      for (const v of VULNERABILITES) {
        if (!v.motif.test(version)) continue;
        const pts = Math.round(v.cvss * 3);
        exposition += pts;
        plus('vuln', `${v.cve} (CVSS ${v.cvss})`, pts);
        inserer.run(nouvelId(), id, v.cve, v.cvss, v.severity, v.description, p.service, Date.now());
      }
    }
    exposition = borner(exposition);

    // L'activité pèse le plus, l'exposition ensuite, la confiance à l'inverse.
    // Liste blanche et routeur principal plafonnent le danger très bas.
    const danger = d.isMainRouter || d.whitelisted
      ? Math.min(30, Math.round(exposition * 0.3 + activite * 0.2))
      : borner(activite * 0.5 + exposition * 0.35 + (100 - confiance) * 0.15);

    appareils.modifier(id, { trustScore: confiance, activityScore: activite, vulnScore: exposition, dangerScore: danger, scoreReasons: raisons });
    if (danger >= 70 && d.dangerScore < 70 && !d.isMainRouter) {
      evts.alerter('high', 'scoring', `Score de danger ${danger} : ${d.hostname || d.ip}`, { deviceId: id, deviceIp: d.ip, deviceMac: d.mac });
      this.s.commandes.declencher('device.high_risk', { deviceId: id, ip: d.ip, name: d.hostname || d.customName || d.ip, score: danger });
    }
    evts.emettre('device:updated', { id, trustScore: confiance, activityScore: activite, vulnScore: exposition, dangerScore: danger });
    return { trustScore: confiance, activityScore: activite, vulnScore: exposition, dangerScore: danger, reasons: raisons };
  }

  toutNoter() {
    for (const { id } of this.s.db.prepare("SELECT id FROM appareils WHERE status != 'offline'").all()) {
      try { this.noter(id); } catch (e) { this.s.evts.journaliser('warn', 'scoring', `Notation impossible : ${e.message}`); }
    }
  }

  // Santé du réseau : 100 moins le danger moyen des appareils en service.
  sante() {
    const r = this.s.db.prepare("SELECT AVG(dangerScore) m, COUNT(*) n FROM appareils WHERE status != 'offline'").get();
    return r.n ? Math.max(0, 100 - Math.round(r.m)) : 100;
  }
}
