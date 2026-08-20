import { prisma } from "../db";
import { eventBus } from "../ws/realtime";

export type LogLevel = "info" | "warn" | "error" | "success";

export async function logEvent(level: LogLevel, source: string, message: string, metadata?: any) {
  try {
    const entry = await prisma.logEntry.create({
      data: { level, source, message, metadata: metadata || undefined },
    });
    eventBus.emit("log:new", entry);
    const tag = `[${level.toUpperCase()}][${source}]`;
    if (level === "error") console.error(tag, message);
    else console.log(tag, message);
  } catch (err) { console.error("Failed to log:", err); }
}

export async function createAlert(severity: string, source: string, message: string, opts: { deviceId?: string; deviceIp?: string; deviceMac?: string; metadata?: any } = {}) {
  const alert = await prisma.alert.create({
    data: {
      severity, source, message,
      deviceId: opts.deviceId, deviceIp: opts.deviceIp, deviceMac: opts.deviceMac,
      metadata: opts.metadata || undefined,
    },
  });
  eventBus.emit("alert:new", alert);
  await logEvent(severity === "info" ? "info" : (severity === "low" ? "warn" : "error"), source, message);
  return alert;
}
