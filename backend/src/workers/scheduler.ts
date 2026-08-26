// Background scheduler. Runs scans, scoring, host metrics polling, and rule engine.

import cron from "node-cron";
import { fullScanAll, plagesActives } from "../services/scanner";
import { scoreAllDevices } from "../services/scoring";
import { applyRules } from "../services/rules";
import { autoBuildTopology } from "../services/topology";
import { readAllStats } from "../services/host";
import { runEnrichmentSweep } from "../services/enrichment";
import { prisma } from "../db";
import { config } from "../config";
import { eventBus } from "../ws/realtime";
import { logEvent } from "../services/logger";
import { demarrerCollecteTrafic } from "../services/trafic";
import { relever as releverVlans } from "../services/vlanReleve";

let scanRunning = false;

export function startScheduler() {
  // ── Collecte du trafic sortant ──
  // Une seule boucle, côté serveur : l'historique se construit même quand
  // personne ne regarde, et la passerelle n'est interrogée qu'une fois.
  demarrerCollecteTrafic();

  // ── Scan loop ──
  if (config.scan.interval > 0) {
    const intervalMs = config.scan.interval * 1000;
    setTimeout(runScan, 8000); // first scan 8s after boot
    setInterval(runScan, intervalMs);
    console.log(`[scheduler] Balayage complet toutes les ${config.scan.interval}s`);
  }

  // ── Scoring + rules every minute ──
  cron.schedule("* * * * *", async () => {
    try { await scoreAllDevices(); await applyRules(); } catch {}
  });

  // ── Topology auto-build is NOT scheduled.
  //    It runs once on first boot if the DB has no links yet, and otherwise only
  //    on explicit user request (the "↻ Auto-rebuild" button on the map).
  //    This protects manual links from being clobbered after each scan.

  // ── Vendor / model / OS enrichment every 2 minutes ──
  cron.schedule("*/2 * * * *", async () => {
    try { await runEnrichmentSweep(); } catch {}
  });
  // First sweep 30s after boot
  setTimeout(() => runEnrichmentSweep().catch(() => {}), 30_000);

  // ── Host metrics every 5s, persist every minute ──
  let lastPersist = 0;
  setInterval(async () => {
    try {
      const stats = await readAllStats();
      eventBus.emit("host:metrics", stats);
      const now = Date.now();
      if (now - lastPersist > 60_000) {
        lastPersist = now;
        await prisma.hostMetric.create({
          data: {
            cpuPct: stats.cpuPct, memPct: stats.memPct,
            memUsedMB: stats.memUsedMB, memTotalMB: stats.memTotalMB,
            diskPct: stats.diskPct, tempC: stats.tempC,
            loadAvg: stats.loadAvg, netRxKBs: stats.netRxKBs, netTxKBs: stats.netTxKBs,
            uptimeSec: stats.uptimeSec,
          },
        });
        // Cleanup: keep last 24h of metrics
        await prisma.hostMetric.deleteMany({
          where: { createdAt: { lt: new Date(Date.now() - 24 * 3600_000) } },
        });
      }
    } catch (err: any) { /* host metrics best effort */ }
  }, 5000);
}

async function runScan() {
  if (scanRunning) return;
  scanRunning = true;
  try {
    await fullScanAll();
    // Les VLAN déclarés sur la passerelle, relevés au même rythme que le reste.
    // Sans ça, un réseau déjà segmenté restait vide côté MapMyLAN et chaque
    // appareil retombait sur son sous-réseau faute de rattachement.
    await releverVlans().catch(() => ({}));
    await scoreAllDevices();
    // Topology auto-build is NEVER triggered here. The user builds it once
    // via the "↻ Auto-rebuild" button on the map (or the onboarding wizard).
    // After that, links — manual or auto — stay as-is across scans.
    await applyRules();
  } catch (e: any) {
    await logEvent("error", "scheduler", `Scan cycle failed: ${e.message}`);
  } finally { scanRunning = false; }
}
