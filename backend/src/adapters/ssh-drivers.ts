// Adaptateurs pilotés en SSH.
//
// Chacun encapsule le dialecte de son constructeur : la façon de bloquer, de
// lever un blocage, d'isoler, et de lire qui est connecté. Le pilote générique
// sert de filet : il applique de l'iptables standard et lit /proc/net/arp, ce
// qui couvre la plupart des équipements sous Linux.

import { RouterAdapter, AdapterContext, Target, ClientEntry, gatewayOf } from "./types";

async function runAll(ctx: AdapterContext, cmds: string[]): Promise<string> {
  let out = "";
  for (const c of cmds) {
    try {
      const r = await ctx.exec(c);
      out += `\n$ ${c}\n${r.stdout || ""}`;
      if (r.stderr) out += `\nSTDERR: ${r.stderr}`;
    } catch (err: any) {
      out += `\nERREUR: ${err.message}`;
    }
  }
  return out.trim();
}

// Table ARP Linux : « IP HW type Flags HW address Mask Device »
function parseProcArp(text: string): ClientEntry[] {
  return text.split("\n").slice(1).map(l => l.trim().split(/\s+/))
    .filter(p => p.length >= 6 && p[3] !== "00:00:00:00:00:00")
    .map(p => ({ ip: p[0], mac: p[3].toUpperCase(), port: p[5], medium: "wired" as const }));
}

// Baux DHCP dnsmasq : « expiry mac ip hostname clientid »
function parseLeases(text: string): ClientEntry[] {
  return text.split("\n").map(l => l.trim().split(/\s+/))
    .filter(p => p.length >= 4)
    .map(p => ({ mac: p[1]?.toUpperCase(), ip: p[2], hostname: p[3] === "*" ? undefined : p[3] }));
}

const linuxTest = async (ctx: AdapterContext) => {
  const r = await ctx.exec("uname -a; cat /proc/version 2>/dev/null | head -1");
  const info = (r.stdout || r.stderr || "").trim().split("\n").slice(0, 2).join(" · ");
  return { ok: !!info, info: info || undefined, error: info ? undefined : "Aucune réponse" };
};

const linuxClients = async (ctx: AdapterContext): Promise<ClientEntry[]> => {
  const arp = await ctx.exec("cat /proc/net/arp 2>/dev/null || ip neigh");
  const entries = parseProcArp(arp.stdout || "");
  const leases = await ctx.exec(
    "cat /tmp/dhcp.leases /var/lib/misc/dnsmasq.leases /tmp/dnsmasq.leases 2>/dev/null | head -200",
  ).catch(() => ({ stdout: "" } as any));
  const byMac = new Map(parseLeases(leases.stdout || "").map(l => [l.mac, l]));
  return entries.map(e => ({ ...e, hostname: byMac.get(e.mac!)?.hostname }));
};

// ─── Asus / Asuswrt-Merlin ────────────────────────────────────────────────
export const asusMerlin: RouterAdapter = {
  id: "asus-merlin",
  label: "Asus · Asuswrt-Merlin",
  transport: "ssh",
  capabilities: ["ban", "unban", "quarantine", "clients", "arp", "leases", "reboot"],
  needs: ["password"],
  detect: p => /asuswrt|merlin/i.test(p),
  test: linuxTest,
  clients: linuxClients,
  arp: linuxClients,
  ban: (ctx, t) => runAll(ctx, [
    `iptables -I FORWARD 1 -s ${t.ip} -j DROP -m comment --comment "mapmylan-ban-${t.ip}"`,
    `iptables -I FORWARD 1 -d ${t.ip} -j DROP -m comment --comment "mapmylan-ban-${t.ip}"`,
    ...(t.mac ? [`iptables -I FORWARD 1 -m mac --mac-source ${t.mac} -j DROP -m comment --comment "mapmylan-ban-mac"`] : []),
  ]),
  quarantine: (ctx, t) => runAll(ctx, [
    `iptables -I FORWARD 1 -s ${t.ip} ! -d ${gatewayOf(t.ip, t.gateway)} -j DROP -m comment --comment "mapmylan-quar-${t.ip}"`,
  ]),
  unban: (ctx, t) => runAll(ctx, [
    `while iptables -D FORWARD -s ${t.ip} -j DROP 2>/dev/null; do :; done`,
    `while iptables -D FORWARD -d ${t.ip} -j DROP 2>/dev/null; do :; done`,
    ...(t.mac ? [`while iptables -D FORWARD -m mac --mac-source ${t.mac} -j DROP 2>/dev/null; do :; done`] : []),
    `while iptables -D FORWARD -s ${t.ip} ! -d ${gatewayOf(t.ip, t.gateway)} -j DROP 2>/dev/null; do :; done`,
  ]),
  reboot: ctx => runAll(ctx, ["reboot"]),
};

// ─── OpenWrt ──────────────────────────────────────────────────────────────
export const openwrt: RouterAdapter = {
  id: "openwrt",
  label: "OpenWrt",
  transport: "ssh",
  capabilities: ["ban", "unban", "quarantine", "clients", "arp", "leases", "vlans", "reboot"],
  needs: ["password"],
  detect: p => /openwrt|lede/i.test(p),
  test: linuxTest,
  clients: linuxClients,
  arp: linuxClients,
  ban: (ctx, t) => {
    const name = `mapmylan_ban_${t.ip.replace(/\./g, "_")}`;
    return runAll(ctx, [
      `uci add firewall rule`,
      `uci set firewall.@rule[-1].name='${name}'`,
      `uci set firewall.@rule[-1].src='lan'`,
      `uci set firewall.@rule[-1].src_ip='${t.ip}'`,
      `uci set firewall.@rule[-1].target='REJECT'`,
      `uci commit firewall && /etc/init.d/firewall reload`,
    ]);
  },
  quarantine: (ctx, t) => runAll(ctx, [
    `iptables -I FORWARD 1 -s ${t.ip} ! -d ${gatewayOf(t.ip, t.gateway)} -j DROP`,
  ]),
  unban: (ctx, t) => {
    const name = `mapmylan_ban_${t.ip.replace(/\./g, "_")}`;
    return runAll(ctx, [
      `for n in $(uci show firewall | grep "name='${name}'" | cut -d. -f2); do uci delete firewall.$n; done`,
      `uci commit firewall && /etc/init.d/firewall reload`,
      `while iptables -D FORWARD -s ${t.ip} ! -d ${gatewayOf(t.ip, t.gateway)} -j DROP 2>/dev/null; do :; done`,
    ]);
  },
  reboot: ctx => runAll(ctx, ["reboot"]),
};

// ─── MikroTik RouterOS ────────────────────────────────────────────────────
export const routeros: RouterAdapter = {
  id: "routeros",
  label: "MikroTik · RouterOS",
  transport: "ssh",
  capabilities: ["ban", "unban", "quarantine", "clients", "arp", "leases", "vlans", "reboot"],
  needs: ["password"],
  detect: p => /mikrotik|routeros/i.test(p),
  test: async ctx => {
    const r = await ctx.exec("/system resource print");
    const info = (r.stdout || "").split("\n").filter(l => /version|board-name/.test(l))
      .map(l => l.trim()).join(" · ");
    return { ok: !!r.stdout, info: info || undefined, error: r.stdout ? undefined : r.stderr };
  },
  clients: async ctx => {
    const r = await ctx.exec("/ip dhcp-server lease print terse");
    return (r.stdout || "").split("\n").filter(Boolean).map(line => ({
      ip: /address=([\d.]+)/.exec(line)?.[1],
      mac: /mac-address=([0-9A-Fa-f:]+)/.exec(line)?.[1]?.toUpperCase(),
      hostname: /host-name="?([^"\s]+)"?/.exec(line)?.[1],
    })).filter(e => e.ip);
  },
  arp: async ctx => {
    const r = await ctx.exec("/ip arp print terse");
    return (r.stdout || "").split("\n").filter(Boolean).map(line => ({
      ip: /address=([\d.]+)/.exec(line)?.[1],
      mac: /mac-address=([0-9A-Fa-f:]+)/.exec(line)?.[1]?.toUpperCase(),
      port: /interface=(\S+)/.exec(line)?.[1],
    })).filter(e => e.ip);
  },
  ban: (ctx, t) => runAll(ctx, [
    `/ip firewall address-list add list=mapmylan-banned address=${t.ip} comment="MapMyLAN"`,
    `/ip firewall filter add chain=forward src-address-list=mapmylan-banned action=drop place-before=0 comment="mapmylan ${t.ip}"`,
    ...(t.mac ? [`/ip firewall filter add chain=forward src-mac-address=${t.mac} action=drop comment="mapmylan ${t.ip}"`] : []),
  ]),
  quarantine: (ctx, t) => runAll(ctx, [
    `/ip firewall address-list add list=mapmylan-quarantine address=${t.ip} timeout=24h`,
    `/ip firewall filter add chain=forward src-address-list=mapmylan-quarantine action=drop place-before=0 comment="mapmylan-quar ${t.ip}"`,
  ]),
  unban: (ctx, t) => runAll(ctx, [
    `:foreach i in=[/ip firewall address-list find where (list="mapmylan-banned" or list="mapmylan-quarantine") and address="${t.ip}"] do={/ip firewall address-list remove $i}`,
    `:foreach i in=[/ip firewall filter find where comment~"mapmylan.*${t.ip}"] do={/ip firewall filter remove $i}`,
  ]),
  reboot: ctx => runAll(ctx, ["/system reboot"]),
};

// ─── pfSense / OPNsense ───────────────────────────────────────────────────
export const pfsense: RouterAdapter = {
  id: "pfsense",
  label: "pfSense · OPNsense",
  transport: "ssh",
  capabilities: ["ban", "unban", "quarantine", "clients", "arp", "reboot"],
  needs: ["password"],
  detect: p => /pfsense|opnsense|freebsd/i.test(p),
  test: async ctx => {
    const r = await ctx.exec("uname -a");
    return { ok: !!r.stdout, info: (r.stdout || "").trim() || undefined, error: r.stdout ? undefined : r.stderr };
  },
  arp: async ctx => {
    const r = await ctx.exec("arp -an");
    return (r.stdout || "").split("\n").map(l => {
      const m = /\(([\d.]+)\) at ([0-9a-f:]+)(?:.*on (\S+))?/i.exec(l);
      return m ? { ip: m[1], mac: m[2].toUpperCase(), port: m[3] } : null;
    }).filter(Boolean) as ClientEntry[];
  },
  clients: async ctx => {
    const r = await ctx.exec("arp -an");
    return (r.stdout || "").split("\n").map(l => {
      const m = /\(([\d.]+)\) at ([0-9a-f:]+)/i.exec(l);
      return m ? { ip: m[1], mac: m[2].toUpperCase() } : null;
    }).filter(Boolean) as ClientEntry[];
  },
  ban: (ctx, t) => runAll(ctx, [`pfctl -t mapmylan_banned -T add ${t.ip}`]),
  quarantine: (ctx, t) => runAll(ctx, [`pfctl -t mapmylan_quarantine -T add ${t.ip}`]),
  unban: (ctx, t) => runAll(ctx, [
    `pfctl -t mapmylan_banned -T delete ${t.ip} 2>/dev/null || true`,
    `pfctl -t mapmylan_quarantine -T delete ${t.ip} 2>/dev/null || true`,
  ]),
  reboot: ctx => runAll(ctx, ["shutdown -r now"]),
};

// ─── Cisco IOS / IOS-XE ───────────────────────────────────────────────────
export const ciscoIos: RouterAdapter = {
  id: "cisco-ios",
  label: "Cisco · IOS / IOS-XE",
  transport: "ssh",
  capabilities: ["ban", "unban", "clients", "arp", "ports", "vlans"],
  needs: ["password"],
  detect: p => /cisco ios|ios-xe|catalyst/i.test(p),
  test: async ctx => {
    const r = await ctx.exec("show version | include Version");
    return { ok: !!r.stdout, info: (r.stdout || "").trim().split("\n")[0], error: r.stdout ? undefined : r.stderr };
  },
  arp: async ctx => {
    const r = await ctx.exec("show ip arp");
    return (r.stdout || "").split("\n").map(l => {
      const m = /Internet\s+([\d.]+)\s+\S+\s+([0-9a-f.]{14})\s+\S+\s+(\S+)/i.exec(l);
      return m ? { ip: m[1], mac: m[2].replace(/\./g, "").replace(/(..)(?=.)/g, "$1:").toUpperCase(), port: m[3] } : null;
    }).filter(Boolean) as ClientEntry[];
  },
  clients: async ctx => {
    const r = await ctx.exec("show mac address-table");
    return (r.stdout || "").split("\n").map(l => {
      const m = /(\d+)\s+([0-9a-f.]{14})\s+\S+\s+(\S+)/i.exec(l);
      return m ? { mac: m[2].replace(/\./g, "").replace(/(..)(?=.)/g, "$1:").toUpperCase(), port: m[3] } : null;
    }).filter(Boolean) as ClientEntry[];
  },
  ban: (ctx, t) => runAll(ctx, [
    `configure terminal\nip access-list extended MAPMYLAN_BAN\n deny ip host ${t.ip} any\n permit ip any any\nend\nwrite memory`,
  ]),
  quarantine: (ctx, t) => runAll(ctx, [
    `configure terminal\nip access-list extended MAPMYLAN_QUAR\n permit udp host ${t.ip} any eq 67 68\n permit udp host ${t.ip} host ${gatewayOf(t.ip, t.gateway)} eq 53\n deny ip host ${t.ip} any\n permit ip any any\nend\nwrite memory`,
  ]),
  unban: (ctx, t) => runAll(ctx, [
    `configure terminal\nip access-list extended MAPMYLAN_BAN\n no deny ip host ${t.ip} any\nend\nwrite memory`,
  ]),
};

// ─── Zyxel ────────────────────────────────────────────────────────────────
export const zyxel: RouterAdapter = {
  id: "zyxel",
  label: "Zyxel · GS / XGS",
  transport: "ssh",
  capabilities: ["ban", "unban", "clients", "arp", "ports"],
  needs: ["password"],
  detect: p => /zyxel|zynos/i.test(p),
  test: async ctx => {
    const r = await ctx.exec("show version");
    return { ok: !!r.stdout, info: (r.stdout || "").trim().split("\n")[0], error: r.stdout ? undefined : r.stderr };
  },
  arp: async ctx => {
    const r = await ctx.exec("show arp");
    return (r.stdout || "").split("\n").map(l => {
      const m = /([\d.]+)\s+([0-9a-f:]{17})\s*(\S+)?/i.exec(l);
      return m ? { ip: m[1], mac: m[2].toUpperCase(), port: m[3] } : null;
    }).filter(Boolean) as ClientEntry[];
  },
  clients: async ctx => {
    const r = await ctx.exec("show mac address-table all");
    return (r.stdout || "").split("\n").map(l => {
      const m = /([0-9a-f:]{17})\s+(\d+)\s+(\S+)/i.exec(l);
      return m ? { mac: m[1].toUpperCase(), port: m[3] } : null;
    }).filter(Boolean) as ClientEntry[];
  },
  ban: (ctx, t) => runAll(ctx, [
    `configure`,
    `mac-filter ${t.mac || ""} deny`,
    `exit`,
    `write memory`,
  ]),
  quarantine: (ctx, t) => runAll(ctx, [`configure`, `mac-filter ${t.mac || ""} deny`, `exit`]),
  unban: (ctx, t) => runAll(ctx, [`configure`, `no mac-filter ${t.mac || ""}`, `exit`, `write memory`]),
};

// ─── EdgeOS (EdgeRouter) ──────────────────────────────────────────────────
export const edgeos: RouterAdapter = {
  id: "edgeos",
  label: "Ubiquiti · EdgeOS",
  transport: "ssh",
  capabilities: ["ban", "unban", "quarantine", "clients", "arp", "leases", "reboot"],
  needs: ["password"],
  detect: p => /edgeos|edgerouter|vyatta/i.test(p),
  test: linuxTest,
  clients: linuxClients,
  arp: linuxClients,
  ban: (ctx, t) => runAll(ctx, [`sudo iptables -I FORWARD 1 -s ${t.ip} -j DROP`]),
  quarantine: (ctx, t) => runAll(ctx, [
    `sudo iptables -I FORWARD 1 -s ${t.ip} ! -d ${gatewayOf(t.ip, t.gateway)} -j DROP`,
  ]),
  unban: (ctx, t) => runAll(ctx, [
    `while sudo iptables -D FORWARD -s ${t.ip} -j DROP 2>/dev/null; do :; done`,
  ]),
  reboot: ctx => runAll(ctx, ["sudo reboot"]),
};

// ─── Générique Linux / iptables ───────────────────────────────────────────
export const generic: RouterAdapter = {
  id: "generic",
  label: "Générique · Linux / iptables",
  transport: "ssh",
  capabilities: ["ban", "unban", "quarantine", "clients", "arp"],
  needs: ["password"],
  test: linuxTest,
  clients: linuxClients,
  arp: linuxClients,
  ban: (ctx, t) => runAll(ctx, [
    `iptables -I FORWARD 1 -s ${t.ip} -j DROP`,
    `iptables -I FORWARD 1 -d ${t.ip} -j DROP`,
  ]),
  quarantine: (ctx, t) => runAll(ctx, [
    `iptables -I FORWARD 1 -s ${t.ip} ! -d ${gatewayOf(t.ip, t.gateway)} -j DROP`,
  ]),
  unban: (ctx, t) => runAll(ctx, [
    `while iptables -D FORWARD -s ${t.ip} -j DROP 2>/dev/null; do :; done`,
    `while iptables -D FORWARD -d ${t.ip} -j DROP 2>/dev/null; do :; done`,
  ]),
};

export const SSH_ADAPTERS = [asusMerlin, openwrt, routeros, pfsense, ciscoIos, zyxel, edgeos, generic];
