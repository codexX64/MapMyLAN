// Bot commands engine — user-defined triggers like "/alert" that map to a
// server-side action (lockdown the network, scan now, ban an IP, etc.).
//
// The Telegram bot polling loop calls runBotTrigger(trigger, args, chatId) when
// it sees a matching message. Discord/webhook integrations can use the same
// entry-point later.

import { prisma } from "../db";
import { logEvent } from "./logger";
import { fullScan } from "./scanner";
import { banDevice, quarantineDevice, unbanDevice } from "./defense";
import { executeOnDevice } from "./ssh";

// ─── Catalog of bot actions ──────────────────────────────────────────────
export const BOT_ACTIONS = [
  { id: "status",          label: "Send system summary",                params: [],                                     destructive: false },
  { id: "network",         label: "Send top-risk devices",              params: [],                                     destructive: false },
  { id: "alerts",          label: "Send recent alerts",                 params: [],                                     destructive: false },
  { id: "list_suspects",   label: "List suspect devices (score > 60)",  params: [],                                     destructive: false },
  { id: "list_offline",    label: "List offline devices",               params: [],                                     destructive: false },
  { id: "list_iot",        label: "List IoT devices",                   params: [],                                     destructive: false },
  { id: "device_info",     label: "Device details for an IP",           params: [{ name: "ip", from: "arg1" }],         destructive: false },
  { id: "scan_now",        label: "Trigger an immediate full scan",     params: [],                                     destructive: false },

  { id: "lockdown",        label: "Ban every non-whitelisted device",   params: [],                                     destructive: true  },
  { id: "unlock_all",      label: "Unban every banned device",          params: [],                                     destructive: true  },

  { id: "ban_ip",          label: "Ban a device by IP",                 params: [{ name: "ip", from: "arg1" }],         destructive: true  },
  { id: "unban_ip",        label: "Unban a device by IP",               params: [{ name: "ip", from: "arg1" }],         destructive: true  },
  { id: "quarantine_ip",   label: "Quarantine a device by IP",          params: [{ name: "ip", from: "arg1" }],         destructive: true  },

  { id: "exec_ssh",        label: "Run an SSH command on a saved device",
    params: [
      { name: "deviceId", required: true, fromConfig: true },
      { name: "cmd",      required: true, fromConfig: true },
    ],
    destructive: true,
  },
  { id: "send_message",    label: "Send a plain message back",          params: [{ name: "text", fromConfig: true }],   destructive: false },
  { id: "topology_summary", label: "Send a topology summary",           params: [],                                     destructive: false },
] as const;

export type ActionId = typeof BOT_ACTIONS[number]["id"];

interface RunContext {
  chatId: string;
  args: string[];        // /command arg1 arg2 …
  cmdRecord?: any;       // the BotCommand DB row
}

// Helper: nice line for a device
function devLine(d: any): string {
  return `• <code>${d.ip}</code> — ${d.hostname || d.customName || "?"} ${d.vendor ? `(${d.vendor})` : ""} — danger ${d.dangerScore}/100`;
}

// Run a single action — returns the text reply to send back to the user.
export async function runAction(actionId: string, params: any, ctx: RunContext): Promise<string> {
  switch (actionId) {
    case "status": {
      const [total, online, suspect, banned, alerts] = await Promise.all([
        prisma.device.count(),
        prisma.device.count({ where: { status: "online" } }),
        prisma.device.count({ where: { status: "suspect" } }),
        prisma.device.count({ where: { status: "banned" } }),
        prisma.alert.count({ where: { acknowledged: false } }),
      ]);
      return `<b>📊 System Status</b>\n• Devices: <b>${online}</b>/${total} online\n• Suspects: <b>${suspect}</b>\n• Banned: <b>${banned}</b>\n• Open alerts: <b>${alerts}</b>`;
    }

    case "network": {
      const top = await prisma.device.findMany({ orderBy: { dangerScore: "desc" }, take: 5, where: { status: { not: "offline" } } });
      if (!top.length) return "No active devices.";
      return "<b>🔥 Top risk devices:</b>\n" + top.map(devLine).join("\n");
    }

    case "alerts": {
      const list = await prisma.alert.findMany({ where: { acknowledged: false }, orderBy: { createdAt: "desc" }, take: 8 });
      if (!list.length) return "✅ No active alerts.";
      return "<b>🚨 Recent alerts:</b>\n" + list.map(a => `[<b>${a.severity}</b>] ${a.message}`).join("\n");
    }

    case "list_suspects": {
      const list = await prisma.device.findMany({ where: { dangerScore: { gte: 60 }, status: { not: "offline" } }, orderBy: { dangerScore: "desc" }, take: 15 });
      if (!list.length) return "✅ No suspect devices.";
      return "<b>⚠️ Suspect devices:</b>\n" + list.map(devLine).join("\n");
    }

    case "list_offline": {
      const list = await prisma.device.findMany({ where: { status: "offline" }, orderBy: { lastSeen: "desc" }, take: 20 });
      if (!list.length) return "All devices are online.";
      return "<b>🔌 Offline:</b>\n" + list.map((d: any) => `• <code>${d.ip}</code> — ${d.hostname || "?"}`).join("\n");
    }

    case "list_iot": {
      const list = await prisma.device.findMany({ where: { OR: [{ type: "iot" }, { customType: "iot" }] }, take: 20 });
      if (!list.length) return "No IoT devices known.";
      return "<b>⚡ IoT devices:</b>\n" + list.map(devLine).join("\n");
    }

    case "device_info": {
      const ip = ctx.args[0] || params?.ip;
      if (!ip) return "Usage: /command &lt;ip&gt;";
      const d = await prisma.device.findFirst({ where: { ip } });
      if (!d) return `❌ No device with IP ${ip}.`;
      return `<b>📱 ${d.customName || d.hostname || d.ip}</b>\n• IP: <code>${d.ip}</code>\n• MAC: <code>${d.mac || "?"}</code>\n• Vendor: ${d.vendor || "Unknown"}\n• Type: ${d.customType || d.type}\n• Status: ${d.status}\n• Danger: ${d.dangerScore}/100`;
    }

    case "scan_now": {
      fullScan().catch(() => {});
      return "🔄 Scan triggered.";
    }

    case "lockdown": {
      const targets = await prisma.device.findMany({
        where: {
          status: { notIn: ["banned"] },
          whitelisted: false,
          isMainRouter: false,
        },
      });
      let ok = 0, fail = 0;
      for (const d of targets) {
        try { await banDevice(d.id, { manual: true, reason: `lockdown by ${ctx.chatId}` }); ok++; }
        catch { fail++; }
      }
      await logEvent("warn", "bot", `LOCKDOWN by chat ${ctx.chatId}: ${ok} banned, ${fail} failed`);
      return `🔒 <b>Lockdown complete</b>\n• Banned: ${ok}\n• Failed: ${fail}`;
    }

    case "unlock_all": {
      const list = await prisma.device.findMany({ where: { status: "banned" } });
      let ok = 0, fail = 0;
      for (const d of list) {
        try { await unbanDevice(d.id); ok++; } catch { fail++; }
      }
      return `🔓 <b>Unlock complete</b>\n• Unbanned: ${ok}\n• Failed: ${fail}`;
    }

    case "ban_ip": {
      const ip = ctx.args[0] || params?.ip;
      if (!ip) return "Usage: /command &lt;ip&gt;";
      const d = await prisma.device.findFirst({ where: { ip } });
      if (!d) return `❌ No device with IP ${ip}.`;
      try { await banDevice(d.id, { manual: true, reason: `bot by ${ctx.chatId}` }); }
      catch (err: any) { return `❌ ${err.message}`; }
      return `🚫 Banned <code>${ip}</code>.`;
    }

    case "unban_ip": {
      const ip = ctx.args[0] || params?.ip;
      if (!ip) return "Usage: /command &lt;ip&gt;";
      const d = await prisma.device.findFirst({ where: { ip } });
      if (!d) return `❌ No device with IP ${ip}.`;
      try { await unbanDevice(d.id); }
      catch (err: any) { return `❌ ${err.message}`; }
      return `✅ Unbanned <code>${ip}</code>.`;
    }

    case "quarantine_ip": {
      const ip = ctx.args[0] || params?.ip;
      if (!ip) return "Usage: /command &lt;ip&gt;";
      const d = await prisma.device.findFirst({ where: { ip } });
      if (!d) return `❌ No device with IP ${ip}.`;
      try { await quarantineDevice(d.id, { manual: true, reason: `bot by ${ctx.chatId}` }); }
      catch (err: any) { return `❌ ${err.message}`; }
      return `🟡 Quarantined <code>${ip}</code>.`;
    }

    case "exec_ssh": {
      const deviceId = params?.deviceId;
      const cmd = params?.cmd;
      if (!deviceId || !cmd) return "❌ This command isn't fully configured (deviceId/cmd missing).";
      try {
        const r = await executeOnDevice(deviceId, cmd);
        const out = (r.stdout || r.stderr || "").slice(0, 600);
        return `<b>SSH ${deviceId}</b>\n<pre>${out || "(no output)"}</pre>`;
      } catch (err: any) { return `❌ SSH failed: ${err.message}`; }
    }

    case "send_message": {
      return params?.text || "(empty)";
    }

    case "topology_summary": {
      const links = await prisma.topologyLink.count();
      const zones = await prisma.zone.count();
      const total = await prisma.device.count();
      return `<b>🗺 Topology</b>\n• ${total} devices\n• ${links} links\n• ${zones} zones`;
    }

    default:
      return `❌ Unknown action: ${actionId}`;
  }
}

// Pending-confirmation map: chatId → { trigger, expiresAt }.
// When a command has confirm=true, the bot stores the request here; the user
// must reply YES within 30s to actually execute.
const pendingConfirms = new Map<string, { commandId: string; args: string[]; expiresAt: number }>();

// Try to match an incoming Telegram message text to a configured bot command.
// Returns the reply string, or null if nothing matches.
export async function tryRunBotMessage(text: string, chatId: string): Promise<string | null> {
  const trimmed = text.trim();
  if (!trimmed) return null;

  // Confirmation flow
  const pending = pendingConfirms.get(chatId);
  if (pending && pending.expiresAt > Date.now()) {
    const yes = /^(y|yes|yep|oui|confirm)$/i.test(trimmed);
    const no  = /^(n|no|cancel|nope|non)$/i.test(trimmed);
    if (yes) {
      pendingConfirms.delete(chatId);
      const cmd = await prisma.botCommand.findUnique({ where: { id: pending.commandId } });
      if (!cmd) return "❌ Command no longer exists.";
      return await actuallyRun(cmd, pending.args, chatId);
    }
    if (no) { pendingConfirms.delete(chatId); return "Cancelled."; }
  }

  // Built-in /help — list the user's custom commands too
  if (/^\/(help|start)\b/i.test(trimmed)) {
    const list = await prisma.botCommand.findMany({ where: { enabled: true } });
    let body = "<b>MapMyLAN bot</b>\n\nBuilt-in commands:\n/status /network /alerts /scan\n/ban &lt;ip&gt; /unban &lt;ip&gt; /quarantine &lt;ip&gt;\n/device &lt;ip&gt; /score &lt;ip&gt;\n";
    if (list.length) {
      body += "\n<b>Your commands:</b>\n";
      for (const c of list) body += `${c.trigger}${c.confirm ? " ⚠️" : ""} — ${c.description || c.action}\n`;
    }
    body += "\nFor destructive commands, the bot will ask you to reply YES.";
    return body;
  }

  // Match a user-defined command
  const parts = trimmed.split(/\s+/);
  const head = parts[0].toLowerCase();
  const args = parts.slice(1);
  const cmd = await prisma.botCommand.findFirst({ where: { trigger: head, enabled: true } });
  if (!cmd) return null;

  // Authorization
  const allowed = (cmd.allowedChatIds && cmd.allowedChatIds.length > 0) ? cmd.allowedChatIds : null;
  if (allowed && !allowed.map(String).includes(String(chatId))) {
    await logEvent("warn", "bot", `Unauthorized ${cmd.trigger} from chat ${chatId}`);
    return "🚫 Not authorized.";
  }

  // Cooldown
  if (cmd.cooldownSec > 0 && cmd.lastFiredAt) {
    const elapsed = (Date.now() - cmd.lastFiredAt.getTime()) / 1000;
    if (elapsed < cmd.cooldownSec) {
      return `⏱ Cooldown: try again in ${Math.ceil(cmd.cooldownSec - elapsed)}s.`;
    }
  }

  // Confirmation needed?
  if (cmd.confirm) {
    pendingConfirms.set(chatId, { commandId: cmd.id, args, expiresAt: Date.now() + 30_000 });
    return `⚠️ <b>${cmd.trigger}</b> — ${cmd.description || cmd.action}\n\nReply <b>YES</b> within 30s to confirm, or <b>NO</b> to cancel.`;
  }

  return await actuallyRun(cmd, args, chatId);
}

async function actuallyRun(cmd: any, args: string[], chatId: string): Promise<string> {
  await prisma.botCommand.update({
    where: { id: cmd.id },
    data: { lastFiredAt: new Date(), lastFiredBy: chatId, fireCount: { increment: 1 } },
  });
  await logEvent("info", "bot", `${cmd.trigger} executed by ${chatId} → ${cmd.action}`);
  try {
    return await runAction(cmd.action, cmd.params || {}, { chatId, args, cmdRecord: cmd });
  } catch (err: any) {
    return `❌ Error: ${err.message}`;
  }
}
