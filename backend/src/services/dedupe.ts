// Device deduplication.
//
// An IP must designate only one device. Duplicates appeared when a machine
// changed its MAC address — USB-C adapter, wired/wireless switchover, random
// MAC — because the lookup was done by MAC first and created a fresh record on
// failure.
//
// This cleanup elects the most relevant record for each IP, pulls ports,
// interfaces, history, CVEs and topology links into it, then deletes the
// others. It runs at startup and can be re-triggered from the UI.

import { prisma } from "../db";
import { logEvent } from "./logger";

const rank = (d: any) => {
  const status = d.status === "online" ? 0 : d.status === "suspect" ? 1 : d.status === "banned" ? 2 : 3;
  return [
    d.isMainRouter ? 0 : 1,          // the main router always wins
    status,                          // then whatever is alive
    d.mac ? 0 : 1,                   // then whatever has a hardware address
    d.customName ? 0 : 1,            // then whatever the user has named
    -(new Date(d.lastSeen || 0).getTime()), // then the most recently seen
  ];
};

const better = (a: any, b: any) => {
  const ra = rank(a), rb = rank(b);
  for (let i = 0; i < ra.length; i++) if (ra[i] !== rb[i]) return ra[i] < rb[i] ? a : b;
  return a;
};

export async function dedupeDevices(): Promise<{ groups: number; removed: number }> {
  const devices = await prisma.device.findMany();
  const byIp = new Map<string, any[]>();
  for (const d of devices) {
    if (!d.ip) continue;
    (byIp.get(d.ip) || byIp.set(d.ip, []).get(d.ip)!).push(d);
  }

  let groups = 0, removed = 0;

  for (const [ip, list] of byIp) {
    if (list.length < 2) continue;
    groups++;
    const keeper = list.reduce(better);
    const losers = list.filter(d => d.id !== keeper.id);

    for (const loser of losers) {
      // The MAC address is unique in the database: we free it before moving
      // anything, otherwise the merge fails on the constraint.
      await prisma.device.update({ where: { id: loser.id }, data: { mac: null } }).catch(() => {});

      await prisma.port.updateMany({ where: { deviceId: loser.id }, data: { deviceId: keeper.id } }).catch(() => {});
      await prisma.deviceHistory.updateMany({ where: { deviceId: loser.id }, data: { deviceId: keeper.id } }).catch(() => {});
      await prisma.cveMatch.updateMany({ where: { deviceId: loser.id }, data: { deviceId: keeper.id } }).catch(() => {});
      await prisma.interface.updateMany({ where: { deviceId: loser.id }, data: { deviceId: keeper.id } }).catch(() => {});
      await prisma.topologyLink.updateMany({ where: { fromId: loser.id }, data: { fromId: keeper.id } }).catch(() => {});
      await prisma.topologyLink.updateMany({ where: { toId: loser.id }, data: { toId: keeper.id } }).catch(() => {});

      // The duplicate's MAC becomes an additional interface of the kept
      // record: we don't lose the information, we file it in the right place.
      if (loser.mac && loser.mac !== keeper.mac) {
        await prisma.interface.create({
          data: {
            deviceId: keeper.id, mac: loser.mac, ip: loser.ip,
            type: "ethernet", label: "duplicate merge",
          },
        }).catch(() => {});
      }

      await prisma.device.delete({ where: { id: loser.id } }).catch(() => {});
      removed++;
    }

    await prisma.deviceHistory.create({
      data: {
        deviceId: keeper.id, event: "action_taken",
        data: { action: "dedupe", ip, absorbed: losers.map(l => ({ id: l.id, mac: l.mac })) },
      },
    }).catch(() => {});
  }

  if (removed) {
    await logEvent("info", "dedupe", `${removed} duplicates merged across ${groups} addresses`);
  }
  return { groups, removed };
}
