// VLAN provisioning over SSH.
// Each vendor has a different model for VLANs:
//   - MikroTik: /interface vlan add + bridge vlan filtering
//   - OpenWrt: uci network.vlan + firewall zones
//   - pfSense: /etc/inc/vlans persistent, can't easily script — limit to alert
//   - Cisco IOS: vlan database
//   - Asus Merlin: nvram + robocfg (model-specific, best-effort)
//
// On creation: also pushes to router if compatible.
// On delete: removes from router as well.

import { prisma } from "../db";
import { executeOnDevice } from "./ssh";
import { logEvent } from "./logger";

export interface VlanData {
  id: number; name: string; subnet: string;
  description?: string; color?: string; isolated?: boolean;
}

async function getMainRouter() {
  return prisma.sshDevice.findFirst({ where: { isMainRouter: true } });
}

function createCmds(vendor: string, v: VlanData): string[] {
  const vlan = v.id;
  const subnet = v.subnet;
  const gw = subnet.split("/")[0].split(".").slice(0, 3).join(".") + ".1";
  const cidr = subnet.split("/")[1] || "24";
  switch (vendor.toLowerCase()) {
    case "mikrotik":
      return [
        `/interface vlan add name=vlan${vlan} vlan-id=${vlan} interface=bridge1 comment="${v.name}"`,
        `/ip address add address=${gw}/${cidr} interface=vlan${vlan}`,
        `/ip pool add name=vlan${vlan}-pool ranges=${gw.replace(/\.1$/, ".100")}-${gw.replace(/\.1$/, ".250")}`,
        `/ip dhcp-server add name=dhcp-vlan${vlan} interface=vlan${vlan} address-pool=vlan${vlan}-pool disabled=no`,
        `/ip dhcp-server network add address=${subnet} gateway=${gw} dns-server=${gw}`,
      ];
    case "openwrt":
      return [
        `uci set network.vlan${vlan}=interface`,
        `uci set network.vlan${vlan}.proto='static'`,
        `uci set network.vlan${vlan}.ifname='br-lan.${vlan}'`,
        `uci set network.vlan${vlan}.ipaddr='${gw}'`,
        `uci set network.vlan${vlan}.netmask='255.255.255.0'`,
        `uci commit network && /etc/init.d/network reload`,
      ];
    case "cisco":
      return [
        `configure terminal\nvlan ${vlan}\n name ${v.name.replace(/\s+/g, "_")}\nexit\nend\nwrite memory`,
      ];
    case "asus-merlin":
    case "asus":
      // Asus VLAN configuration is highly model-specific. Most Asus routers don't expose
      // CLI VLAN config at all. We mark it as "manual" and just record in DB without pushing.
      return [];
    case "pfsense":
      // pfSense VLAN over SSH requires editing config.xml — out of scope for v2.1.
      return [];
    default:
      return [];
  }
}

function deleteCmds(vendor: string, vlan: number): string[] {
  switch (vendor.toLowerCase()) {
    case "mikrotik":
      return [
        `:foreach i in=[/ip dhcp-server find name="dhcp-vlan${vlan}"] do={/ip dhcp-server remove $i}`,
        `:foreach i in=[/ip pool find name="vlan${vlan}-pool"] do={/ip pool remove $i}`,
        `:foreach i in=[/ip address find interface=vlan${vlan}] do={/ip address remove $i}`,
        `:foreach i in=[/interface vlan find name="vlan${vlan}"] do={/interface vlan remove $i}`,
      ];
    case "openwrt":
      return [
        `uci delete network.vlan${vlan} 2>/dev/null || true`,
        `uci commit network && /etc/init.d/network reload`,
      ];
    case "cisco":
      return [`configure terminal\nno vlan ${vlan}\nend\nwrite memory`];
    default:
      return [];
  }
}

export async function provisionVlanOnRouter(v: VlanData): Promise<{ pushed: boolean; output: string; vendor?: string }> {
  const router = await getMainRouter();
  if (!router) return { pushed: false, output: "No main router configured" };
  const cmds = createCmds(router.vendor, v);
  if (cmds.length === 0) {
    return { pushed: false, output: `Vendor "${router.vendor}" does not support automated VLAN push — VLAN saved in DB only`, vendor: router.vendor };
  }
  let output = "";
  for (const c of cmds) {
    try {
      const r = await executeOnDevice(router.id, c);
      output += `\n$ ${c}\n${r.stdout || ""}`;
      if (r.stderr) output += `\nSTDERR: ${r.stderr}`;
    } catch (err: any) {
      output += `\nERROR running '${c}': ${err.message}`;
    }
  }
  await logEvent("success", "vlans", `VLAN ${v.id} (${v.name}) provisioned on ${router.vendor}`);
  return { pushed: true, output, vendor: router.vendor };
}

export async function deprovisionVlanOnRouter(vlanId: number): Promise<{ output: string }> {
  const router = await getMainRouter();
  if (!router) return { output: "No main router configured" };
  const cmds = deleteCmds(router.vendor, vlanId);
  if (cmds.length === 0) return { output: `Vendor "${router.vendor}" does not support automated VLAN delete` };
  let output = "";
  for (const c of cmds) {
    try {
      const r = await executeOnDevice(router.id, c);
      output += `\n$ ${c}\n${r.stdout || ""}`;
    } catch (err: any) {
      output += `\nERROR: ${err.message}`;
    }
  }
  await logEvent("info", "vlans", `VLAN ${vlanId} deprovisioned on ${router.vendor}`);
  return { output };
}
