// Adaptateurs pilotés en SSH, un par dialecte constructeur : bloquer, lever
// un blocage, isoler, lire qui est connecté. Le générique sert de filet :
// iptables et /proc/net/arp couvrent la plupart des équipements sous Linux.
//
// Chaque commande est écrite ici, en entier ; les seules valeurs qui y
// entrent sont une adresse IPv4, une MAC ou un numéro, déjà validés par
// validerCible() avant l'appel (defense.js). Rien de ce qu'un appareil
// annonce — nom, fabricant — n'entre jamais dans une commande.

const passerelleDe = t => t.gateway || t.ip.split('.').slice(0, 3).join('.') + '.1';

async function enchainer(ctx, commandes) {
  let sortie = '';
  for (const c of commandes) {
    try {
      const r = await ctx.exec(c);
      sortie += `\n$ ${c}\n${r.stdout || ''}`;
      if (r.stderr) sortie += `\nSTDERR: ${r.stderr}`;
    } catch (e) {
      sortie += `\nERREUR: ${e.message}`;
      if (e.liaison) break;
    }
  }
  return sortie.trim();
}

// Table ARP Linux : « IP HW-type Flags HW-address Mask Device ».
function lireProcArp(texte) {
  return texte.split('\n').slice(1).map(l => l.trim().split(/\s+/))
    .filter(p => p.length >= 6 && /^[0-9a-f:]{17}$/i.test(p[3]) && p[3] !== '00:00:00:00:00:00')
    .map(p => ({ ip: p[0], mac: p[3].toUpperCase(), port: p[5], medium: 'wired' }));
}

// Baux dnsmasq : « expiration mac ip nom identifiant ».
function lireBaux(texte) {
  return texte.split('\n').map(l => l.trim().split(/\s+/)).filter(p => p.length >= 4)
    .map(p => ({ mac: p[1]?.toUpperCase(), ip: p[2], hostname: p[3] === '*' ? undefined : p[3] }));
}

const testLinux = async ctx => {
  const r = await ctx.exec('uname -a; head -1 /proc/version 2>/dev/null');
  const info = (r.stdout || r.stderr || '').trim().split('\n').slice(0, 2).join(' · ');
  return { ok: !!info, info: info || undefined, error: info ? undefined : 'Aucune réponse' };
};

const clientsLinux = async ctx => {
  const arp = await ctx.exec('cat /proc/net/arp 2>/dev/null || ip neigh');
  const entrees = lireProcArp(arp.stdout || '');
  const baux = await ctx.exec('cat /tmp/dhcp.leases /var/lib/misc/dnsmasq.leases /tmp/dnsmasq.leases 2>/dev/null | head -200').catch(() => ({ stdout: '' }));
  const parMac = new Map(lireBaux(baux.stdout || '').map(b => [b.mac, b]));
  return entrees.map(e => ({ ...e, hostname: parMac.get(e.mac)?.hostname }));
};

// Une règle retirée tant qu'elle existe : iptables -D n'en retire qu'une par appel.
const retirerTant = regle => `while iptables -D ${regle} 2>/dev/null; do :; done`;

export const asusMerlin = {
  id: 'asus-merlin', label: 'Asus · Asuswrt-Merlin', transport: 'ssh',
  capabilities: ['ban', 'unban', 'quarantine', 'clients', 'arp', 'leases', 'reboot'], needs: ['password'],
  detect: p => /asuswrt|merlin/i.test(p),
  test: testLinux, clients: clientsLinux, arp: clientsLinux,
  ban: (ctx, t) => enchainer(ctx, [
    `iptables -I FORWARD 1 -s ${t.ip} -j DROP -m comment --comment mapmylan-ban`,
    `iptables -I FORWARD 1 -d ${t.ip} -j DROP -m comment --comment mapmylan-ban`,
    ...(t.mac ? [`iptables -I FORWARD 1 -m mac --mac-source ${t.mac} -j DROP -m comment --comment mapmylan-ban`] : []),
  ]),
  quarantine: (ctx, t) => enchainer(ctx, [`iptables -I FORWARD 1 -s ${t.ip} ! -d ${passerelleDe(t)} -j DROP -m comment --comment mapmylan-quar`]),
  unban: (ctx, t) => enchainer(ctx, [
    retirerTant(`FORWARD -s ${t.ip} -j DROP -m comment --comment mapmylan-ban`),
    retirerTant(`FORWARD -d ${t.ip} -j DROP -m comment --comment mapmylan-ban`),
    ...(t.mac ? [retirerTant(`FORWARD -m mac --mac-source ${t.mac} -j DROP -m comment --comment mapmylan-ban`)] : []),
    retirerTant(`FORWARD -s ${t.ip} ! -d ${passerelleDe(t)} -j DROP -m comment --comment mapmylan-quar`),
  ]),
  reboot: ctx => enchainer(ctx, ['reboot']),
};

export const openwrt = {
  id: 'openwrt', label: 'OpenWrt', transport: 'ssh',
  capabilities: ['ban', 'unban', 'quarantine', 'clients', 'arp', 'leases', 'vlans', 'reboot'], needs: ['password'],
  detect: p => /openwrt|lede/i.test(p),
  test: testLinux, clients: clientsLinux, arp: clientsLinux,
  ban: (ctx, t) => {
    const nom = `mapmylan_ban_${t.ip.replace(/\./g, '_')}`;
    return enchainer(ctx, [
      'uci add firewall rule',
      `uci set firewall.@rule[-1].name='${nom}'`,
      "uci set firewall.@rule[-1].src='lan'",
      `uci set firewall.@rule[-1].src_ip='${t.ip}'`,
      "uci set firewall.@rule[-1].target='REJECT'",
      'uci commit firewall && /etc/init.d/firewall reload',
    ]);
  },
  quarantine: (ctx, t) => enchainer(ctx, [`iptables -I FORWARD 1 -s ${t.ip} ! -d ${passerelleDe(t)} -j DROP`]),
  unban: (ctx, t) => {
    const nom = `mapmylan_ban_${t.ip.replace(/\./g, '_')}`;
    return enchainer(ctx, [
      `for n in $(uci show firewall | grep "name='${nom}'" | cut -d. -f2); do uci delete firewall.$n; done`,
      'uci commit firewall && /etc/init.d/firewall reload',
      retirerTant(`FORWARD -s ${t.ip} ! -d ${passerelleDe(t)} -j DROP`),
    ]);
  },
  reboot: ctx => enchainer(ctx, ['reboot']),
};

export const routeros = {
  id: 'routeros', label: 'MikroTik · RouterOS', transport: 'ssh',
  capabilities: ['ban', 'unban', 'quarantine', 'clients', 'arp', 'leases', 'vlans', 'reboot'], needs: ['password'],
  detect: p => /mikrotik|routeros|rosssh/i.test(p),
  test: async ctx => {
    const r = await ctx.exec('/system resource print');
    const info = (r.stdout || '').split('\n').filter(l => /version|board-name/.test(l)).map(l => l.trim()).join(' · ');
    return { ok: !!r.stdout, info: info || undefined, error: r.stdout ? undefined : r.stderr };
  },
  clients: async ctx => {
    const r = await ctx.exec('/ip dhcp-server lease print terse');
    return (r.stdout || '').split('\n').filter(Boolean).map(l => ({
      ip: /address=([\d.]+)/.exec(l)?.[1], mac: /mac-address=([0-9A-Fa-f:]+)/.exec(l)?.[1]?.toUpperCase(), hostname: /host-name="?([^"\s]+)"?/.exec(l)?.[1],
    })).filter(e => e.ip);
  },
  arp: async ctx => {
    const r = await ctx.exec('/ip arp print terse');
    return (r.stdout || '').split('\n').filter(Boolean).map(l => ({
      ip: /address=([\d.]+)/.exec(l)?.[1], mac: /mac-address=([0-9A-Fa-f:]+)/.exec(l)?.[1]?.toUpperCase(), port: /interface=(\S+)/.exec(l)?.[1],
    })).filter(e => e.ip);
  },
  ban: (ctx, t) => enchainer(ctx, [
    `/ip firewall address-list add list=mapmylan-banned address=${t.ip} comment="MapMyLAN"`,
    `/ip firewall filter add chain=forward src-address-list=mapmylan-banned action=drop place-before=0 comment="mapmylan ${t.ip}"`,
    ...(t.mac ? [`/ip firewall filter add chain=forward src-mac-address=${t.mac} action=drop comment="mapmylan ${t.ip}"`] : []),
  ]),
  quarantine: (ctx, t) => enchainer(ctx, [
    `/ip firewall address-list add list=mapmylan-quarantine address=${t.ip} timeout=24h`,
    `/ip firewall filter add chain=forward src-address-list=mapmylan-quarantine action=drop place-before=0 comment="mapmylan-quar ${t.ip}"`,
  ]),
  unban: (ctx, t) => enchainer(ctx, [
    `:foreach i in=[/ip firewall address-list find where (list="mapmylan-banned" or list="mapmylan-quarantine") and address="${t.ip}"] do={/ip firewall address-list remove $i}`,
    `:foreach i in=[/ip firewall filter find where comment~"mapmylan.*${t.ip.replace(/\./g, '\\\\.')}"] do={/ip firewall filter remove $i}`,
  ]),
  reboot: ctx => enchainer(ctx, ['/system reboot']),
};

export const pfsense = {
  id: 'pfsense', label: 'pfSense · OPNsense', transport: 'ssh',
  capabilities: ['ban', 'unban', 'quarantine', 'clients', 'arp', 'reboot'], needs: ['password'],
  detect: p => /pfsense|opnsense|freebsd/i.test(p),
  test: async ctx => {
    const r = await ctx.exec('uname -a');
    return { ok: !!r.stdout, info: (r.stdout || '').trim() || undefined, error: r.stdout ? undefined : r.stderr };
  },
  arp: async ctx => {
    const r = await ctx.exec('arp -an');
    return (r.stdout || '').split('\n').map(l => {
      const m = /\(([\d.]+)\) at ([0-9a-f:]{17})(?:.*on (\S+))?/i.exec(l);
      return m ? { ip: m[1], mac: m[2].toUpperCase(), port: m[3] } : null;
    }).filter(Boolean);
  },
  clients: async ctx => {
    const r = await ctx.exec('arp -an');
    return (r.stdout || '').split('\n').map(l => {
      const m = /\(([\d.]+)\) at ([0-9a-f:]{17})/i.exec(l);
      return m ? { ip: m[1], mac: m[2].toUpperCase() } : null;
    }).filter(Boolean);
  },
  ban: (ctx, t) => enchainer(ctx, [`pfctl -t mapmylan_banned -T add ${t.ip}`]),
  quarantine: (ctx, t) => enchainer(ctx, [`pfctl -t mapmylan_quarantine -T add ${t.ip}`]),
  unban: (ctx, t) => enchainer(ctx, [
    `pfctl -t mapmylan_banned -T delete ${t.ip} 2>/dev/null || true`,
    `pfctl -t mapmylan_quarantine -T delete ${t.ip} 2>/dev/null || true`,
  ]),
  reboot: ctx => enchainer(ctx, ['shutdown -r now']),
};

const macCisco = m => m.replace(/\./g, '').replace(/(..)(?=.)/g, '$1:').toUpperCase();

export const ciscoIos = {
  id: 'cisco-ios', label: 'Cisco · IOS / IOS-XE', transport: 'ssh',
  capabilities: ['ban', 'unban', 'clients', 'arp', 'ports', 'vlans'], needs: ['password'],
  detect: p => /cisco ios|ios-xe|catalyst|cisco-/i.test(p),
  test: async ctx => {
    const r = await ctx.exec('show version | include Version');
    return { ok: !!r.stdout, info: (r.stdout || '').trim().split('\n')[0], error: r.stdout ? undefined : r.stderr };
  },
  arp: async ctx => {
    const r = await ctx.exec('show ip arp');
    return (r.stdout || '').split('\n').map(l => {
      const m = /Internet\s+([\d.]+)\s+\S+\s+([0-9a-f.]{14})\s+\S+\s+(\S+)/i.exec(l);
      return m ? { ip: m[1], mac: macCisco(m[2]), port: m[3] } : null;
    }).filter(Boolean);
  },
  clients: async ctx => {
    const r = await ctx.exec('show mac address-table');
    return (r.stdout || '').split('\n').map(l => {
      const m = /(\d+)\s+([0-9a-f.]{14})\s+\S+\s+(\S+)/i.exec(l);
      return m ? { mac: macCisco(m[2]), port: m[3] } : null;
    }).filter(Boolean);
  },
  ban: (ctx, t) => enchainer(ctx, [`configure terminal\nip access-list extended MAPMYLAN_BAN\n deny ip host ${t.ip} any\n permit ip any any\nend\nwrite memory`]),
  quarantine: (ctx, t) => enchainer(ctx, [`configure terminal\nip access-list extended MAPMYLAN_QUAR\n permit udp host ${t.ip} any eq 67 68\n permit udp host ${t.ip} host ${passerelleDe(t)} eq 53\n deny ip host ${t.ip} any\n permit ip any any\nend\nwrite memory`]),
  unban: (ctx, t) => enchainer(ctx, [`configure terminal\nip access-list extended MAPMYLAN_BAN\n no deny ip host ${t.ip} any\nend\nwrite memory`]),
};

export const zyxel = {
  id: 'zyxel', label: 'Zyxel · GS / XGS', transport: 'ssh',
  capabilities: ['ban', 'unban', 'clients', 'arp', 'ports'], needs: ['password'],
  detect: p => /zyxel|zynos/i.test(p),
  test: async ctx => {
    const r = await ctx.exec('show version');
    return { ok: !!r.stdout, info: (r.stdout || '').trim().split('\n')[0], error: r.stdout ? undefined : r.stderr };
  },
  arp: async ctx => {
    const r = await ctx.exec('show arp');
    return (r.stdout || '').split('\n').map(l => {
      const m = /([\d.]+)\s+([0-9a-f:]{17})\s*(\S+)?/i.exec(l);
      return m ? { ip: m[1], mac: m[2].toUpperCase(), port: m[3] } : null;
    }).filter(Boolean);
  },
  clients: async ctx => {
    const r = await ctx.exec('show mac address-table all');
    return (r.stdout || '').split('\n').map(l => {
      const m = /([0-9a-f:]{17})\s+(\d+)\s+(\S+)/i.exec(l);
      return m ? { mac: m[1].toUpperCase(), port: m[3] } : null;
    }).filter(Boolean);
  },
  // Le filtre Zyxel porte sur la MAC : sans elle, rien à bloquer.
  ban: (ctx, t) => (t.mac ? enchainer(ctx, ['configure', `mac-filter ${t.mac} deny`, 'exit', 'write memory']) : Promise.reject(new Error('Zyxel filtre par adresse MAC : aucune MAC connue pour cet appareil.'))),
  quarantine: (ctx, t) => (t.mac ? enchainer(ctx, ['configure', `mac-filter ${t.mac} deny`, 'exit']) : Promise.reject(new Error('Zyxel filtre par adresse MAC : aucune MAC connue pour cet appareil.'))),
  unban: (ctx, t) => (t.mac ? enchainer(ctx, ['configure', `no mac-filter ${t.mac}`, 'exit', 'write memory']) : Promise.reject(new Error('Zyxel filtre par adresse MAC : aucune MAC connue pour cet appareil.'))),
};

export const edgeos = {
  id: 'edgeos', label: 'Ubiquiti · EdgeOS', transport: 'ssh',
  capabilities: ['ban', 'unban', 'quarantine', 'clients', 'arp', 'leases', 'reboot'], needs: ['password'],
  detect: p => /edgeos|edgerouter|vyatta/i.test(p),
  test: testLinux, clients: clientsLinux, arp: clientsLinux,
  ban: (ctx, t) => enchainer(ctx, [`sudo iptables -I FORWARD 1 -s ${t.ip} -j DROP`]),
  quarantine: (ctx, t) => enchainer(ctx, [`sudo iptables -I FORWARD 1 -s ${t.ip} ! -d ${passerelleDe(t)} -j DROP`]),
  unban: (ctx, t) => enchainer(ctx, [
    `while sudo iptables -D FORWARD -s ${t.ip} -j DROP 2>/dev/null; do :; done`,
    `while sudo iptables -D FORWARD -s ${t.ip} ! -d ${passerelleDe(t)} -j DROP 2>/dev/null; do :; done`,
  ]),
  reboot: ctx => enchainer(ctx, ['sudo reboot']),
};

export const generique = {
  id: 'generic', label: 'Générique · Linux / iptables', transport: 'ssh',
  capabilities: ['ban', 'unban', 'quarantine', 'clients', 'arp'], needs: ['password'],
  test: testLinux, clients: clientsLinux, arp: clientsLinux,
  ban: (ctx, t) => enchainer(ctx, [`iptables -I FORWARD 1 -s ${t.ip} -j DROP`, `iptables -I FORWARD 1 -d ${t.ip} -j DROP`]),
  quarantine: (ctx, t) => enchainer(ctx, [`iptables -I FORWARD 1 -s ${t.ip} ! -d ${passerelleDe(t)} -j DROP`]),
  unban: (ctx, t) => enchainer(ctx, [
    retirerTant(`FORWARD -s ${t.ip} -j DROP`),
    retirerTant(`FORWARD -d ${t.ip} -j DROP`),
    retirerTant(`FORWARD -s ${t.ip} ! -d ${passerelleDe(t)} -j DROP`),
  ]),
};

export const PILOTES_SSH = [asusMerlin, openwrt, routeros, pfsense, ciscoIos, zyxel, edgeos, generique];
