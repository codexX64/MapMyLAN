// Active defense actions: ban, quarantine, isolate, disable port.
// Executes vendor-specific SSH commands on the configured main router.
// Refuses to act on whitelisted/main-router devices.

import { prisma } from "../db";
import { mainRouter } from "../adapters";
import { createAlert, logEvent } from "./logger";
import { eventBus } from "../ws/realtime";

async function deviceById(id: string) {
  const d = await prisma.device.findUnique({ where: { id } });
  if (!d) throw new Error("Device not found");
  return d;
}

// Les dialectes constructeurs vivent dans src/adapters : ce fichier ne décide
// plus *comment* on bloque, seulement *si* on a le droit de bloquer et ce qu'on
// enregistre ensuite.
async function act(kind: "ban" | "quarantine" | "unban", dev: any): Promise<{ output: string; vendor: string }> {
  const { row, adapter, ctx } = await mainRouter();
  if (!adapter.capabilities.includes(kind as any)) {
    throw new Error(`${adapter.label} ne sait pas faire « ${kind} » depuis MapMyLAN`);
  }
  const target = { ip: dev.ip, mac: dev.mac || undefined };
  const output = await adapter[kind](ctx, target);
  await prisma.sshDevice.update({ where: { id: row.id }, data: { lastConnected: new Date() } }).catch(() => {});
  return { output, vendor: adapter.id };
}

export async function banDevice(deviceId: string, opts: { manual?: boolean; reason?: string } = {}) {
  const dev = await deviceById(deviceId);
  if (dev.isMainRouter) throw new Error("Cannot ban the main router");
  if (dev.whitelisted && !opts.manual) throw new Error("Device is whitelisted (manual override required)");

  const { output, vendor } = await act("ban", dev);

  await prisma.device.update({ where: { id: deviceId }, data: { status: "banned" } });
  await prisma.deviceHistory.create({
    data: { deviceId, event: "action_taken", data: { action: "ban", manual: opts.manual, reason: opts.reason, vendor, output: output.slice(0, 2000) } },
  });
  await createAlert("high", "defense", `Device banned: ${dev.hostname || dev.ip}${opts.reason ? ` — ${opts.reason}` : ""}`, {
    deviceId: dev.id, deviceIp: dev.ip, deviceMac: dev.mac || undefined,
  });
  eventBus.emit("device:updated", { id: deviceId, status: "banned" });
  // Fire user commands (best-effort, non-blocking)
  import("./commands").then(({ fireCommand }) => {
    fireCommand("defense.ban_success", {
      deviceId: dev.id, ip: dev.ip, name: dev.hostname || dev.customName || dev.ip,
      reason: opts.reason || "manual",
    }).catch(() => {});
  });
  return { ok: true, output };
}

export async function quarantineDevice(deviceId: string, opts: { manual?: boolean; reason?: string } = {}) {
  const dev = await deviceById(deviceId);
  if (dev.isMainRouter) throw new Error("Cannot quarantine the main router");
  if (dev.whitelisted && !opts.manual) throw new Error("Device is whitelisted");

  const { output, vendor } = await act("quarantine", dev);

  await prisma.device.update({ where: { id: deviceId }, data: { status: "quarantined" } });
  await prisma.deviceHistory.create({
    data: { deviceId, event: "action_taken", data: { action: "quarantine", manual: opts.manual, reason: opts.reason, vendor, output: output.slice(0, 2000) } },
  });
  await createAlert("medium", "defense", `Device quarantined: ${dev.hostname || dev.ip}`, {
    deviceId: dev.id, deviceIp: dev.ip, deviceMac: dev.mac || undefined,
  });
  eventBus.emit("device:updated", { id: deviceId, status: "quarantined" });
  return { ok: true, output };
}

export async function unbanDevice(deviceId: string) {
  const dev = await deviceById(deviceId);
  const { output, vendor } = await act("unban", dev);

  await prisma.device.update({ where: { id: deviceId }, data: { status: "online" } });
  await prisma.deviceHistory.create({ data: { deviceId, event: "action_taken", data: { action: "unban", vendor, output: output.slice(0, 1000) } } });
  await logEvent("info", "defense", `Device unbanned: ${dev.hostname || dev.ip}`);
  eventBus.emit("device:updated", { id: deviceId, status: "online" });
  return { ok: true, output };
}
