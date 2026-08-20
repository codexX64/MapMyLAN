// Notification commands engine.
//
// A "command" is a user-defined rule: "when <trigger> happens, do <actions>".
// Triggers are emitted by the rest of the app via fireCommand("trigger.id", payload).
// Actions are the verbs that can be executed in response — currently:
//   - notify({ channels })      send the rendered message via the named channels
//   - log({ level })            write a log entry
//   - quarantine                quarantine the device referenced in the payload
//   - ban                       ban the device referenced in the payload
//   - exec_ssh({ deviceId, cmd }) run a custom SSH command on a saved device
//
// Future actions (placeholders): webhook, runScript, addTag, sendEmailDigest…
//
// The catalog of TRIGGERS is the source of truth for what events the user can
// listen to. The frontend pulls it via GET /commands/triggers.

import { prisma } from "../db";
import { sendTelegram, sendEmail, sendSMS } from "./notifier";
import { logEvent } from "./logger";
import { banDevice, quarantineDevice } from "./defense";
import { executeOnDevice } from "./ssh";

// ─── Catalog of triggers ─────────────────────────────────────────────────
// Each entry has an id, label, category, and the placeholders available in
// the message template. The frontend uses this to build the visual builder.
export const TRIGGERS = [
  // Device lifecycle
  { id: "device.new",                category: "Devices", label: "New device discovered",        vars: ["ip", "mac", "vendor", "hostname"] },
  { id: "device.online",             category: "Devices", label: "Device came back online",      vars: ["ip", "name"] },
  { id: "device.offline",            category: "Devices", label: "Device went offline",          vars: ["ip", "name"] },
  { id: "device.suspect",            category: "Devices", label: "Device became suspect",        vars: ["ip", "name", "score"] },
  { id: "device.changed",            category: "Devices", label: "Device IP / MAC changed",      vars: ["oldIp", "newIp", "name"] },
  { id: "device.high_risk",          category: "Devices", label: "Device dangerScore ≥ threshold", vars: ["ip", "name", "score"] },
  { id: "device.unknown_vendor",     category: "Devices", label: "Device with unknown vendor",   vars: ["ip", "mac"] },
  { id: "device.iot",                category: "Devices", label: "New IoT device detected",      vars: ["ip", "name", "vendor"] },

  // Security
  { id: "security.port_scan",        category: "Security", label: "Port scan detected",          vars: ["ip", "ports"] },
  { id: "security.arp_spoof",        category: "Security", label: "ARP spoofing suspected",      vars: ["ip", "mac"] },
  { id: "security.brute_force",      category: "Security", label: "Brute force attempt",         vars: ["ip", "service"] },
  { id: "security.cve_match",        category: "Security", label: "CVE match found on device",   vars: ["ip", "cve", "cvss"] },
  { id: "security.cve_critical",     category: "Security", label: "Critical CVE (CVSS ≥ 9.0)",   vars: ["ip", "cve", "cvss"] },
  { id: "security.malware",          category: "Security", label: "Malware indicator",           vars: ["ip", "indicator"] },
  { id: "security.foreign_dns",      category: "Security", label: "Device using foreign DNS",    vars: ["ip", "dns"] },
  { id: "security.tor",              category: "Security", label: "Tor exit traffic detected",   vars: ["ip"] },

  // Defense actions
  { id: "defense.ban_success",       category: "Defense", label: "Device banned successfully",   vars: ["ip", "name", "reason"] },
  { id: "defense.ban_failed",        category: "Defense", label: "Ban command failed",           vars: ["ip", "error"] },
  { id: "defense.quarantine_success", category: "Defense", label: "Device quarantined",          vars: ["ip", "name", "reason"] },
  { id: "defense.unban",             category: "Defense", label: "Device unbanned",              vars: ["ip", "name"] },
  { id: "defense.rule_triggered",    category: "Defense", label: "Auto-rule fired",              vars: ["rule", "ip"] },

  // Network
  { id: "network.new_link",          category: "Network", label: "New link discovered",          vars: ["from", "to", "type"] },
  { id: "network.vlan_change",       category: "Network", label: "Device changed VLAN",          vars: ["ip", "oldVlan", "newVlan"] },
  { id: "network.gateway_change",    category: "Network", label: "Default gateway changed",      vars: ["oldGw", "newGw"] },
  { id: "network.dhcp_starvation",   category: "Network", label: "DHCP starvation pattern",      vars: ["count"] },
  { id: "network.broadcast_storm",   category: "Network", label: "Broadcast storm",              vars: ["pps"] },

  // SSH
  { id: "ssh.exec_success",          category: "SSH", label: "SSH command executed OK",          vars: ["device", "cmd"] },
  { id: "ssh.exec_failure",          category: "SSH", label: "SSH command failed",               vars: ["device", "cmd", "error"] },
  { id: "ssh.unauthorized",          category: "SSH", label: "Unauthorized SSH attempt",         vars: ["host", "user"] },
  { id: "ssh.connection_lost",       category: "SSH", label: "Lost SSH to managed device",       vars: ["device"] },

  // Host / monitoring
  { id: "host.cpu_high",             category: "Monitoring", label: "Host CPU > threshold",      vars: ["pct"] },
  { id: "host.mem_high",             category: "Monitoring", label: "Host memory > threshold",   vars: ["pct"] },
  { id: "host.disk_full",            category: "Monitoring", label: "Host disk > 90%",           vars: ["pct"] },
  { id: "host.temp_high",            category: "Monitoring", label: "Host temperature high",     vars: ["c"] },
  { id: "host.container_down",       category: "Monitoring", label: "Docker container exited",   vars: ["name", "image"] },
  { id: "host.network_spike",        category: "Monitoring", label: "Network throughput spike",  vars: ["rxKBs", "txKBs"] },

  // Scans
  { id: "scan.complete",             category: "Scans", label: "Scan completed",                 vars: ["devices", "duration"] },
  { id: "scan.failed",               category: "Scans", label: "Scan failed",                    vars: ["error"] },
  { id: "scan.deep_complete",        category: "Scans", label: "Deep scan complete",             vars: ["ip", "ports"] },

  // System
  { id: "system.boot",               category: "System", label: "MapMyLAN started",              vars: ["version"] },
  { id: "system.error",              category: "System", label: "System error logged",           vars: ["msg"] },
  { id: "system.update_available",   category: "System", label: "Update available",              vars: ["version"] },
  { id: "system.backup",             category: "System", label: "Backup completed",              vars: ["size"] },

  // User actions
  { id: "user.login",                category: "Users", label: "Admin logged in",                vars: ["username", "ip"] },
  { id: "user.login_failed",         category: "Users", label: "Failed login attempt",           vars: ["username", "ip"] },
  { id: "user.password_changed",     category: "Users", label: "Password changed",               vars: ["username"] },
  { id: "user.notif_test",           category: "Users", label: "Notification test sent",         vars: ["channel"] },

  // Misc
  { id: "schedule.daily",            category: "Schedule", label: "Daily report time",           vars: ["date"] },
  { id: "schedule.weekly",           category: "Schedule", label: "Weekly report time",          vars: ["week"] },
  { id: "manual",                    category: "Manual",   label: "Manually fired (button)",     vars: [] },
] as const;

export type TriggerId = typeof TRIGGERS[number]["id"];

// ─── Action catalog (for the builder UI) ─────────────────────────────────
export const ACTIONS = [
  { kind: "notify",     label: "Send notification", needs: ["channels"] },
  { kind: "log",        label: "Log event",         needs: [] },
  { kind: "quarantine", label: "Quarantine device", needs: [] },
  { kind: "ban",        label: "Ban device",        needs: ["reason?"] },
  { kind: "exec_ssh",   label: "Run SSH command",   needs: ["deviceId", "cmd"] },
] as const;

// ─── Template renderer ───────────────────────────────────────────────────
function render(tpl: string | null | undefined, vars: Record<string, any>): string {
  if (!tpl) return JSON.stringify(vars);
  return tpl.replace(/\{\{(\w+)\}\}/g, (_, k) => String(vars[k] ?? ""));
}

// ─── Filter matcher ──────────────────────────────────────────────────────
function passesFilter(filter: any, vars: Record<string, any>): boolean {
  if (!filter || typeof filter !== "object") return true;
  // Numeric thresholds
  if (filter.minScore != null && (vars.score == null || vars.score < filter.minScore)) return false;
  if (filter.minCvss  != null && (vars.cvss  == null || vars.cvss  < filter.minCvss)) return false;
  if (filter.minPct   != null && (vars.pct   == null || vars.pct   < filter.minPct)) return false;
  // String equals
  if (filter.deviceType && vars.type && filter.deviceType !== vars.type) return false;
  if (filter.severity && vars.severity && filter.severity !== vars.severity) return false;
  // Substring contains
  if (filter.contains && !JSON.stringify(vars).toLowerCase().includes(String(filter.contains).toLowerCase())) return false;
  return true;
}

// ─── Dispatcher ──────────────────────────────────────────────────────────
// Called by the rest of the codebase whenever an event happens.
// e.g. fireCommand("device.new", { ip, mac, vendor, hostname })
export async function fireCommand(triggerId: string, vars: Record<string, any>) {
  const cmds = await prisma.notificationCommand.findMany({
    where: { trigger: triggerId, enabled: true },
  });
  if (cmds.length === 0) return;

  for (const cmd of cmds) {
    // Cooldown check
    if (cmd.cooldownSec > 0 && cmd.lastFired) {
      const elapsed = (Date.now() - cmd.lastFired.getTime()) / 1000;
      if (elapsed < cmd.cooldownSec) continue;
    }
    if (!passesFilter(cmd.filter as any, vars)) continue;

    const message = render(cmd.template || `[{{trigger}}] ${triggerId}: ${JSON.stringify(vars)}`, { trigger: triggerId, ...vars });
    const actions = Array.isArray(cmd.actions) ? cmd.actions as any[] : [];

    for (const action of actions) {
      try {
        if (action.kind === "notify" && Array.isArray(action.channels)) {
          for (const ch of action.channels) {
            try {
              if (ch === "telegram") await sendTelegram(message);
              else if (ch === "email") await sendEmail({ subject: `[${triggerId}] ${cmd.name}`, title: cmd.name, severity: "info", body: message });
              else if (ch === "sms") await sendSMS(message);
            } catch {}
          }
        } else if (action.kind === "log") {
          await logEvent(action.level || "info", "command", `[${cmd.name}] ${message}`);
        } else if (action.kind === "quarantine" && vars.deviceId) {
          await quarantineDevice(vars.deviceId, { reason: `cmd:${cmd.name}` }).catch(() => {});
        } else if (action.kind === "ban" && vars.deviceId) {
          await banDevice(vars.deviceId, { reason: action.reason || `cmd:${cmd.name}` }).catch(() => {});
        } else if (action.kind === "exec_ssh" && action.deviceId && action.cmd) {
          await executeOnDevice(action.deviceId, action.cmd).catch(() => {});
        }
      } catch (err: any) {
        await logEvent("warn", "command", `Action failed for ${cmd.name}: ${err.message}`);
      }
    }

    await prisma.notificationCommand.update({
      where: { id: cmd.id },
      data: { lastFired: new Date(), fireCount: { increment: 1 } },
    });
  }
}
