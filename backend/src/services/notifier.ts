// Notifications: Telegram (with bidirectional commands), Email (rich HTML),
// SMS via Twilio. Templates are responsive and branded.

import nodemailer from "nodemailer";
import twilio from "twilio";
import { prisma } from "../db";
import { decryptJSON, encryptJSON } from "./crypto";
import { logEvent } from "./logger";
import { envoyerPoste } from "./poste";

/**
 * La configuration d'un canal, ou `null` s'il est coupé.
 *
 * `enabled` est rendu avec le reste, et c'est le point de ce commentaire.
 * L'activation vit dans une colonne de la ligne, pas dans le blob chiffré :
 * une fonction qui ne rendait que le blob laissait donc `cfg.enabled` à
 * `undefined`, et tout appelant qui le testait concluait « canal éteint » sur
 * un canal parfaitement allumé.
 *
 * Ça ne se voyait pas parce que l'écran d'installation glissait par hasard un
 * `enabled` *dans* la configuration. L'éditeur de canaux, lui, ne le fait pas —
 * pas plus que le script en ligne de commande. Configurer Telegram autrement
 * que par l'installation initiale coupait donc silencieusement tout ce qui
 * vérifiait `enabled`, à commencer par le code de réinitialisation.
 *
 * On rend la valeur plutôt que de corriger chaque appelant : la ligne existe et
 * est active, sinon on serait déjà sorti sur `null`.
 */
export async function getConfig(channel: string): Promise<any | null> {
  const row = await prisma.notificationConfig.findUnique({ where: { channel } });
  if (!row || !row.enabled || !row.configEnc) return null;
  return { ...decryptJSON(row.configEnc), enabled: true };
}

export async function setConfig(channel: string, enabled: boolean, cfg: any) {
  await prisma.notificationConfig.upsert({
    where: { channel },
    update: { enabled, configEnc: cfg ? encryptJSON(cfg) : null },
    create: { channel, enabled, configEnc: cfg ? encryptJSON(cfg) : null },
  });
}

// ─── Telegram ──────────────────────────────────────────────────────────────
export async function sendTelegram(message: string, cfg?: any): Promise<{ ok: boolean; error?: string }> {
  const c = cfg || (await getConfig("telegram"));
  if (!c?.token || !c?.chatId) return { ok: false, error: "Telegram not configured" };
  try {
    const url = `https://api.telegram.org/bot${c.token}/sendMessage`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: c.chatId, text: message, parse_mode: "HTML" }),
    });
    const json = (await res.json()) as { ok?: boolean; description?: string };
    if (!json.ok) return { ok: false, error: json.description || "Telegram API error" };
    await prisma.notificationConfig.update({
      where: { channel: "telegram" },
      data: { lastSuccess: new Date(), lastTested: new Date() },
    }).catch(() => {});
    return { ok: true };
  } catch (err: any) { return { ok: false, error: err.message }; }
}

// ─── Email — premium HTML template ─────────────────────────────────────────
const SMTP_PRESETS: Record<string, { host: string; port: number; secure: boolean }> = {
  gmail:   { host: "smtp.gmail.com",        port: 465, secure: true },
  icloud:  { host: "smtp.mail.me.com",      port: 587, secure: false },
  outlook: { host: "smtp-mail.outlook.com", port: 587, secure: false },
};

function emailTemplate(opts: { title: string; severity: string; body: string; details?: Record<string, string> }) {
  const colors: Record<string, string> = { critical: "#dc2626", high: "#ea580c", medium: "#d97706", low: "#2563eb", info: "#16a34a" };
  const c = colors[opts.severity?.toLowerCase()] || "#2563eb";
  const detailsRows = opts.details
    ? Object.entries(opts.details).map(([k, v]) => `<tr><td style="padding:6px 12px;color:#64748b;font-size:12px;font-family:monospace">${k}</td><td style="padding:6px 12px;color:#0f172a;font-size:13px;font-family:monospace">${v}</td></tr>`).join("")
    : "";
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:system-ui,-apple-system,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px;"><tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:white;border-radius:14px;overflow:hidden;box-shadow:0 10px 32px rgba(0,0,0,0.08);">
<tr><td style="height:5px;background:linear-gradient(90deg,${c},#0ea5e9);"></td></tr>
<tr><td style="padding:28px 32px 14px;">
  <div style="display:inline-block;padding:4px 12px;border-radius:999px;background:${c}20;color:${c};font-size:11px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;font-family:monospace;">${opts.severity}</div>
  <h1 style="margin:14px 0 8px;font-size:22px;font-weight:700;color:#0f172a;letter-spacing:-0.02em;">${opts.title}</h1>
  <p style="margin:0;color:#475569;font-size:14px;line-height:1.6;">${opts.body}</p>
</td></tr>
${detailsRows ? `<tr><td style="padding:0 32px 24px;"><table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border-radius:8px;border:1px solid #e2e8f0;">${detailsRows}</table></td></tr>` : ""}
<tr><td style="padding:16px 32px;background:#f8fafc;border-top:1px solid #e2e8f0;">
  <p style="margin:0;color:#94a3b8;font-size:11px;font-family:monospace;">MapMyLAN · ${new Date().toLocaleString()}</p>
</td></tr>
</table></td></tr></table></body></html>`;
}

export async function sendEmail(opts: { subject: string; title: string; severity: string; body: string; details?: Record<string, string> }, cfg?: any): Promise<{ ok: boolean; error?: string }> {
  const c = cfg || (await getConfig("email"));
  if (!c?.address || !c?.password) return { ok: false, error: "Email not configured" };
  const preset = SMTP_PRESETS[c.provider];
  const smtpCfg = preset || { host: c.host, port: c.port || 587, secure: c.secure || false };
  try {
    const transporter = nodemailer.createTransport({
      ...smtpCfg, auth: { user: c.address, pass: c.password },
    });
    await transporter.sendMail({
      from: c.from || c.address,
      to: c.to || c.address,
      subject: opts.subject,
      html: emailTemplate(opts),
    });
    await prisma.notificationConfig.update({
      where: { channel: "email" },
      data: { lastSuccess: new Date(), lastTested: new Date() },
    }).catch(() => {});
    return { ok: true };
  } catch (err: any) { return { ok: false, error: err.message }; }
}

// ─── Lien de réinitialisation ──────────────────────────────────────────────
//
// Un courrier à part, hors du gabarit d'alerte : ce n'est pas un incident, et
// le destinataire n'est pas forcément celui qui reçoit les alertes.
//
// Rien de sensible dans le corps hormis le lien lui-même — ni identifiant, ni
// indication sur les moyens inscrits sur le compte. Le lien ne suffit d'ailleurs
// pas : la page demandera encore une preuve.
export async function envoyerLienReinit(
  destinataire: string, lien: string, minutes: number,
): Promise<{ ok: boolean; error?: string }> {
  const c = await getConfig("email");
  if (!c?.address || !c?.password) return { ok: false, error: "Courrier non configuré" };
  const preset = SMTP_PRESETS[c.provider];
  const smtpCfg = preset || { host: c.host, port: c.port || 587, secure: c.secure || false };

  const texte =
    `Une réinitialisation de mot de passe a été demandée sur MapMyLAN.\n\n` +
    `${lien}\n\n` +
    `Ce lien est valable ${minutes} minutes et ne fonctionne qu'une fois. ` +
    `Il ne suffit pas à changer le mot de passe : une preuve vous sera encore ` +
    `demandée.\n\n` +
    `Si vous n'êtes pas à l'origine de cette demande, ignorez ce message. ` +
    `Aucun changement n'a eu lieu.`;

  try {
    const transporter = nodemailer.createTransport({
      ...smtpCfg, auth: { user: c.address, pass: c.password },
    });
    await transporter.sendMail({
      from: c.from || c.address,
      to: destinataire,
      subject: "MapMyLAN — réinitialisation du mot de passe",
      text: texte,
    });
    return { ok: true };
  } catch (err: any) { return { ok: false, error: err.message }; }
}

// ─── SMS ───────────────────────────────────────────────────────────────────
export async function sendSMS(message: string, cfg?: any): Promise<{ ok: boolean; error?: string }> {
  const c = cfg || (await getConfig("sms"));
  if (!c?.sid || !c?.token || !c?.from || !c?.to) return { ok: false, error: "SMS not configured" };
  try {
    const client = twilio(c.sid, c.token);
    await client.messages.create({ body: message, from: c.from, to: c.to });
    await prisma.notificationConfig.update({
      where: { channel: "sms" },
      data: { lastSuccess: new Date(), lastTested: new Date() },
    }).catch(() => {});
    return { ok: true };
  } catch (err: any) { return { ok: false, error: err.message }; }
}

// ─── Broadcast helper ─────────────────────────────────────────────────────
export async function broadcastAlert(severity: string, title: string, body: string, details?: Record<string, string>) {
  const sev = severity.toLowerCase();

  // Poste — relais maison. L'objet reste stable pour que les alertes
  // répétées d'un même incident soient regroupées côté ticket.
  envoyerPoste({
    objet: title,
    corps: body,
    machine: details?.ip || details?.host || details?.machine,
    details,
  }).catch(e => logEvent("error", "poste", String(e?.message || e)));
  const tgMsg = `<b>[${severity.toUpperCase()}]</b> ${title}\n${body}${details ? "\n\n" + Object.entries(details).map(([k, v]) => `<code>${k}</code>: ${v}`).join("\n") : ""}`;

  if (sev === "critical" || sev === "high") {
    sendTelegram(tgMsg).catch(e => logEvent("error", "notifier", `Telegram: ${e.message}`));
    sendEmail({ subject: `MapMyLAN — ${title}`, title, severity, body, details })
      .catch(e => logEvent("error", "notifier", `Email: ${e.message}`));
  }
  if (sev === "critical") {
    sendSMS(`MapMyLAN ${severity.toUpperCase()}: ${title} — ${body}`)
      .catch(e => logEvent("error", "notifier", `SMS: ${e.message}`));
  }
}

// ─── Bidirectional Telegram bot — long-poll command handler ──────────────
let pollOffset = 0;
let polling = false;

export async function startTelegramBot() {
  if (polling) return;
  const cfg = await getConfig("telegram");
  if (!cfg?.token) return;
  polling = true;

  const loop = async () => {
    while (polling) {
      try {
        const cur = await getConfig("telegram");
        if (!cur?.token) { polling = false; break; }
        const url = `https://api.telegram.org/bot${cur.token}/getUpdates?offset=${pollOffset}&timeout=20`;
        const res = await fetch(url);
        const json = (await res.json()) as any;
        if (json?.ok && Array.isArray(json.result)) {
          for (const upd of json.result) {
            pollOffset = upd.update_id + 1;
            const msg = upd.message;
            if (!msg || !msg.text) continue;
            if (msg.chat.id == null) continue;
            // Global authorization: by default the bot only answers the primary
            // chatId saved at setup. Individual BotCommand entries can extend
            // permissions per-trigger via allowedChatIds.
            const incomingChatId = String(msg.chat.id);
            const isPrimary = cur.chatId && incomingChatId === String(cur.chatId);
            // First, try user-defined bot commands (handles per-command allowedChatIds)
            const { tryRunBotMessage } = await import("./botCommands");
            let reply = await tryRunBotMessage(msg.text, incomingChatId);
            // Fallback to built-in commands only for the primary chat
            if (reply == null && isPrimary) {
              reply = await handleTelegramCommand(msg.text);
            }
            if (reply) {
              await fetch(`https://api.telegram.org/bot${cur.token}/sendMessage`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ chat_id: msg.chat.id, text: reply, parse_mode: "HTML" }),
              }).catch(() => {});
            }
          }
        }
      } catch (err: any) {
        await logEvent("warn", "telegram", `Bot poll error: ${err.message}`);
        await new Promise(r => setTimeout(r, 5000));
      }
    }
  };
  loop();
  await logEvent("info", "telegram", "Bot listening for commands");
}

async function handleTelegramCommand(text: string): Promise<string | null> {
  const parts = text.trim().split(/\s+/);
  const cmd = parts[0].toLowerCase();
  switch (cmd) {
    case "/start":
    case "/help": {
      return `<b>MapMyLAN bot</b>\n\nCommands:\n/status — system summary\n/network — network overview\n/alerts — recent alerts\n/score &lt;ip&gt; — device scores\n/device &lt;ip&gt; — device details\n/scan — trigger full scan\n/ban &lt;ip&gt; — ban device\n/quarantine &lt;ip&gt; — quarantine device`;
    }
    case "/status": {
      const [total, online, suspect, alerts] = await Promise.all([
        prisma.device.count(), prisma.device.count({ where: { status: "online" } }),
        prisma.device.count({ where: { status: "suspect" } }),
        prisma.alert.count({ where: { acknowledged: false } }),
      ]);
      return `<b>System Status</b>\n• Devices: ${online}/${total} online\n• Suspects: ${suspect}\n• Open alerts: ${alerts}`;
    }
    case "/network": {
      const top = await prisma.device.findMany({ orderBy: { dangerScore: "desc" }, take: 5, where: { status: { not: "offline" } } });
      if (!top.length) return "No active devices.";
      return "<b>Top risk devices:</b>\n" + top.map(d => `• ${d.hostname || d.ip} — danger ${d.dangerScore}/100`).join("\n");
    }
    case "/alerts": {
      const list = await prisma.alert.findMany({ where: { acknowledged: false }, orderBy: { createdAt: "desc" }, take: 5 });
      if (!list.length) return "✅ No active alerts.";
      return "<b>Recent alerts:</b>\n" + list.map(a => `[${a.severity}] ${a.message}`).join("\n");
    }
    case "/score":
    case "/device": {
      const ip = parts[1];
      if (!ip) return "Usage: /score &lt;ip&gt;";
      const d = await prisma.device.findFirst({ where: { ip } });
      if (!d) return `No device with IP ${ip}`;
      return `<b>${d.hostname || d.ip}</b>\nVendor: ${d.vendor || "?"}\nMAC: ${d.mac || "?"}\nStatus: ${d.status}\n\n<b>Scores</b>\n• Trust: ${d.trustScore}/100\n• Activity: ${d.activityScore}/100\n• Vulnerability: ${d.vulnScore}/100\n• <b>Danger: ${d.dangerScore}/100</b>`;
    }
    case "/scan": {
      const { fullScan } = await import("./scanner");
      fullScan().catch(() => {});
      return "🔍 Full scan triggered.";
    }
    case "/ban": {
      const ip = parts[1];
      if (!ip) return "Usage: /ban &lt;ip&gt;";
      const d = await prisma.device.findFirst({ where: { ip } });
      if (!d) return `No device with IP ${ip}`;
      const { banDevice } = await import("./defense");
      try { await banDevice(d.id, { manual: true, reason: "Telegram command" }); return `✅ ${ip} banned.`; }
      catch (e: any) { return `❌ ${e.message}`; }
    }
    case "/quarantine": {
      const ip = parts[1];
      if (!ip) return "Usage: /quarantine &lt;ip&gt;";
      const d = await prisma.device.findFirst({ where: { ip } });
      if (!d) return `No device with IP ${ip}`;
      const { quarantineDevice } = await import("./defense");
      try { await quarantineDevice(d.id, { manual: true, reason: "Telegram command" }); return `✅ ${ip} quarantined.`; }
      catch (e: any) { return `❌ ${e.message}`; }
    }
    default:
      return null;
  }
}
