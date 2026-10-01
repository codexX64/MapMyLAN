// Des lignes de la base aux objets JSON de l'API (docs/API.md, section 2).
// Les dates passent en ISO, les entiers 0/1 en booléens, le JSON rangé en
// texte redevient un objet. Une colonne interne ne sort jamais d'ici : chaque
// forme énumère ce qu'elle rend.
const iso = t => (t === null || t === undefined ? null : new Date(Number(t)).toISOString());
const bool = v => v === 1 || v === true;
export const lireJson = (texte, defaut = null) => {
  if (texte === null || texte === undefined || texte === '') return defaut;
  try { return JSON.parse(texte); } catch { return defaut; }
};

export const port = p => ({ id: p.id, deviceId: p.deviceId, port: p.port, protocol: p.protocol, state: p.state, service: p.service, product: p.product, version: p.version, detectedAt: iso(p.detectedAt) });
export const cve = c => ({ id: c.id, deviceId: c.deviceId, cveId: c.cveId, cvss: c.cvss, severity: c.severity, description: c.description, service: c.service, detectedAt: iso(c.detectedAt) });
export const interfaceReseau = i => ({ id: i.id, deviceId: i.deviceId, mac: i.mac, ip: i.ip, type: i.type, label: i.label, posX: i.posX, posY: i.posY, isPrimary: bool(i.isPrimary), createdAt: iso(i.createdAt) });
export const evenementHistorique = h => ({ id: h.id, deviceId: h.deviceId, event: h.event, data: lireJson(h.data, {}), createdAt: iso(h.createdAt) });

export function appareil(d, { ports = [], cves = [], interfaces = [] } = {}) {
  return {
    id: d.id, ip: d.ip, mac: d.mac, hostname: d.hostname, customName: d.customName, vendor: d.vendor, model: d.model, os: d.os,
    type: d.type, customType: d.customType, vlan: d.vlan, zone: d.zone, tags: lireJson(d.tags, []), notes: d.notes, role: d.role,
    status: d.status, trustScore: d.trustScore, activityScore: d.activityScore, vulnScore: d.vulnScore, dangerScore: d.dangerScore,
    scoreReasons: lireJson(d.scoreReasons), whitelisted: bool(d.whitelisted), isMainRouter: bool(d.isMainRouter),
    posX: d.posX, posY: d.posY, pinned: bool(d.pinned), firstSeen: iso(d.firstSeen), lastSeen: iso(d.lastSeen),
    metadata: lireJson(d.metadata), ports: ports.map(port), cves: cves.map(cve), interfaces: interfaces.map(interfaceReseau),
  };
}

export const lien = l => ({ id: l.id, fromId: l.fromId, toId: l.toId, fromIfaceId: l.fromIfaceId, toIfaceId: l.toIfaceId, type: l.type, speed: l.speed, vlan: l.vlan, manual: bool(l.manual), createdAt: iso(l.createdAt) });
export const zone = z => ({ id: z.id, name: z.name, color: z.color, x: z.x, y: z.y, width: z.width, height: z.height, notes: z.notes, createdAt: iso(z.createdAt) });
export const vlan = v => ({ id: v.id, name: v.name, subnet: v.subnet, description: v.description, color: v.color, isolated: bool(v.isolated), gateway: v.gateway, networkId: v.networkId, createdAt: iso(v.createdAt) });
export const balayage = b => (b ? { id: b.id, type: b.type, subnet: b.subnet, status: b.status, hostsFound: b.hostsFound, startedAt: iso(b.startedAt), endedAt: iso(b.endedAt), error: b.error } : null);
export const alerte = a => ({ id: a.id, severity: a.severity, source: a.source, message: a.message, deviceId: a.deviceId, deviceIp: a.deviceIp, deviceMac: a.deviceMac, acknowledged: bool(a.acknowledged), metadata: lireJson(a.metadata), createdAt: iso(a.createdAt) });
export const ligneJournal = l => ({ id: l.id, level: l.level, source: l.source, message: l.message, metadata: lireJson(l.metadata), createdAt: iso(l.createdAt) });
export const mesureHote = m => ({ id: m.id, cpuPct: m.cpuPct, memPct: m.memPct, memUsedMB: m.memUsedMB, memTotalMB: m.memTotalMB, diskPct: m.diskPct, tempC: m.tempC, loadAvg: m.loadAvg, netRxKBs: m.netRxKBs, netTxKBs: m.netTxKBs, uptimeSec: m.uptimeSec, createdAt: iso(m.createdAt) });
export const regle = r => ({ id: r.id, name: r.name, enabled: bool(r.enabled), trigger: r.trigger, threshold: r.threshold, action: r.action, exceptWhitelist: bool(r.exceptWhitelist), createdAt: iso(r.createdAt) });
export const commande = c => ({ id: c.id, name: c.name, enabled: bool(c.enabled), trigger: c.trigger, filter: lireJson(c.filter), actions: lireJson(c.actions, []), template: c.template, cooldownSec: c.cooldownSec, lastFired: iso(c.lastFired), fireCount: c.fireCount, createdAt: iso(c.createdAt), updatedAt: iso(c.updatedAt) });
export const commandeBot = c => ({ id: c.id, trigger: c.trigger, description: c.description, action: c.action, params: lireJson(c.params), enabled: bool(c.enabled), confirm: bool(c.confirm), allowedChatIds: lireJson(c.allowedChatIds, []), cooldownSec: c.cooldownSec, lastFiredBy: c.lastFiredBy, lastFiredAt: iso(c.lastFiredAt), fireCount: c.fireCount, createdAt: iso(c.createdAt), updatedAt: iso(c.updatedAt) });

// Un équipement tel que l'interface le voit : la présence d'un secret, jamais
// le secret ni sa longueur.
export const equipement = (e, capacites = []) => (e ? {
  id: e.id, name: e.name, host: e.host, port: e.port, username: e.username, vendor: e.vendor, transport: e.transport || 'ssh',
  apiBaseUrl: e.apiBaseUrl, site: e.site, verifyTls: bool(e.verifyTls), hasPassword: !!e.passwordEnc, hasPrivateKey: !!e.privateKeyEnc,
  lastConnected: iso(e.lastConnected), lastTestOk: e.lastTestOk === null || e.lastTestOk === undefined ? null : bool(e.lastTestOk),
  lastTestAt: iso(e.lastTestAt), lastTestInfo: e.lastTestInfo, capabilities: capacites,
  empreinteHote: e.empreinteHote || null, empreinteTls: e.empreinteTls || null,
} : null);
export const consoleSsh = e => ({ id: e.id, name: e.name, host: e.host, port: e.port, username: e.username, vendor: e.vendor, isMainRouter: bool(e.isMainRouter), lastConnected: iso(e.lastConnected), createdAt: iso(e.createdAt), empreinteHote: e.empreinteHote || null });

export function jetonIntegration(j, maintenant = Date.now()) {
  return {
    id: j.id, name: j.name, prefix: j.prefix, role: j.role, createdAt: iso(j.createdAt), lastUsedAt: iso(j.lastUsedAt),
    expiresAt: iso(j.expiresAt), revokedAt: iso(j.revokedAt),
    etat: j.revokedAt ? 'revoque' : j.expiresAt && j.expiresAt <= maintenant ? 'expire' : 'actif',
  };
}

export const boite = b => ({
  id: b.id, email: b.email, provider: b.provider, role: b.role,
  imap: b.imapHost ? { host: b.imapHost, port: b.imapPort, security: b.imapSecurity } : null,
  smtp: b.smtpHost ? { host: b.smtpHost, port: b.smtpPort, security: b.smtpSecurity } : null,
  active: bool(b.active), hasPassword: !!b.passwordEnc, lastTestAt: iso(b.lastTestAt),
  lastTestOk: b.lastTestOk === null || b.lastTestOk === undefined ? null : bool(b.lastTestOk), lastTestInfo: b.lastTestInfo,
});

export { iso, bool };
