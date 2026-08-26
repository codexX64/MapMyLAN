// Déduplication des appareils.
//
// Une IP ne doit désigner qu'un seul appareil. Des doublons apparaissaient
// quand une machine changeait d'adresse MAC — adaptateur USB-C, bascule
// filaire/sans-fil, MAC aléatoire — parce que la recherche se faisait d'abord
// par MAC et créait une fiche neuve en cas d'échec.
//
// Ce nettoyage élit la fiche la plus pertinente pour chaque IP, y rapatrie
// ports, interfaces, historique, CVE et liens de topologie, puis supprime les
// autres. Il tourne au démarrage et peut être relancé depuis l'interface.

import { prisma } from "../db";
import { logEvent } from "./logger";

const rank = (d: any) => {
  const status = d.status === "online" ? 0 : d.status === "suspect" ? 1 : d.status === "banned" ? 2 : 3;
  return [
    d.isMainRouter ? 0 : 1,          // le routeur principal l'emporte toujours
    status,                          // puis ce qui est vivant
    d.mac ? 0 : 1,                   // puis ce qui a une adresse matérielle
    d.customName ? 0 : 1,            // puis ce que l'utilisateur a nommé
    -(new Date(d.lastSeen || 0).getTime()), // puis le plus récemment vu
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
      // L'adresse MAC est unique en base : on la libère avant de déplacer quoi
      // que ce soit, sinon la reprise échoue sur la contrainte.
      await prisma.device.update({ where: { id: loser.id }, data: { mac: null } }).catch(() => {});

      await prisma.port.updateMany({ where: { deviceId: loser.id }, data: { deviceId: keeper.id } }).catch(() => {});
      await prisma.deviceHistory.updateMany({ where: { deviceId: loser.id }, data: { deviceId: keeper.id } }).catch(() => {});
      await prisma.cveMatch.updateMany({ where: { deviceId: loser.id }, data: { deviceId: keeper.id } }).catch(() => {});
      await prisma.interface.updateMany({ where: { deviceId: loser.id }, data: { deviceId: keeper.id } }).catch(() => {});
      await prisma.topologyLink.updateMany({ where: { fromId: loser.id }, data: { fromId: keeper.id } }).catch(() => {});
      await prisma.topologyLink.updateMany({ where: { toId: loser.id }, data: { toId: keeper.id } }).catch(() => {});

      // La MAC du doublon devient une interface supplémentaire de la fiche
      // conservée : on ne perd pas l'information, on la range au bon endroit.
      if (loser.mac && loser.mac !== keeper.mac) {
        await prisma.interface.create({
          data: {
            deviceId: keeper.id, mac: loser.mac, ip: loser.ip,
            type: "ethernet", label: "reprise doublon",
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
    await logEvent("info", "dedupe", `${removed} doublons fusionnés sur ${groups} adresses`);
  }
  return { groups, removed };
}
