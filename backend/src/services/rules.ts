// Security rules engine.
// Polls active devices and applies rules whenever scores or events match.
// Whitelist + main router are always exempt.

import { prisma } from "../db";
import { banDevice, quarantineDevice } from "./defense";
import { broadcastAlert } from "./notifier";
import { logEvent } from "./logger";

export async function applyRules() {
  const rules = await prisma.securityRule.findMany({ where: { enabled: true } });
  if (rules.length === 0) return;

  const devices = await prisma.device.findMany({
    where: { status: { notIn: ["offline", "banned", "quarantined"] } },
  });

  for (const rule of rules) {
    if (rule.trigger !== "dangerScore") continue; // others triggered by event handlers
    const threshold = rule.threshold ?? 75;
    const matched = devices.filter(d => d.dangerScore >= threshold);

    for (const d of matched) {
      // Skip exempted devices
      if (d.isMainRouter) continue;
      if (rule.exceptWhitelist && d.whitelisted) continue;

      try {
        if (rule.action === "ban") {
          await banDevice(d.id, { reason: `Auto rule: ${rule.name}` });
          await broadcastAlert("critical", "Device auto-banned", `${d.hostname || d.ip} reached danger ${d.dangerScore}/100`, {
            IP: d.ip, MAC: d.mac || "?", Vendor: d.vendor || "?", Rule: rule.name,
          });
        } else if (rule.action === "quarantine") {
          await quarantineDevice(d.id, { reason: `Auto rule: ${rule.name}` });
          await broadcastAlert("high", "Device auto-quarantined", `${d.hostname || d.ip} reached danger ${d.dangerScore}/100`, {
            IP: d.ip, Rule: rule.name,
          });
        } else if (rule.action === "alert") {
          await broadcastAlert("medium", `Rule fired: ${rule.name}`, `${d.hostname || d.ip} danger ${d.dangerScore}/100`);
        }
        await logEvent("warn", "rules", `Rule '${rule.name}' fired on ${d.hostname || d.ip}`);
      } catch (err: any) {
        await logEvent("error", "rules", `Rule '${rule.name}' failed on ${d.ip}: ${err.message}`);
      }
    }
  }
}
