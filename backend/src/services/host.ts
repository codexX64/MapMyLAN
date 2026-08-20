// Host monitoring: reads /proc, /sys for CPU/mem/disk/temp, queries Docker via socket.

import fs from "fs";
import { exec } from "child_process";
import { promisify } from "util";
import Docker from "dockerode";
import { config } from "../config";

const execAsync = promisify(exec);

let docker: Docker | null = null;
function getDocker(): Docker | null {
  if (docker) return docker;
  try {
    // We no longer mount the raw Docker socket in this container (huge attack
    // surface if compromised). In production, DOCKER_HOST points to a
    // read-only proxy (docker-socket-proxy) that only exposes the container
    // list. Otherwise, we fall back to the local socket for development.
    const host = process.env.DOCKER_HOST;
    if (host) {
      const u = new URL(host);
      docker = new Docker({ host: u.hostname, port: u.port ? Number(u.port) : 2375, protocol: (u.protocol.replace(":", "") as any) || "http" });
    } else {
      docker = new Docker({ socketPath: "/var/run/docker.sock" });
    }
    return docker;
  } catch { return null; }
}

let lastCpu: { idle: number; total: number } | null = null;
let lastNet: { rx: number; tx: number; t: number } | null = null;

function readFile(p: string): string {
  try { return fs.readFileSync(p, "utf8"); } catch { return ""; }
}

export async function readCpuUsage(): Promise<number> {
  const stat = readFile(`${config.hostProc}/stat`);
  const line = stat.split("\n")[0];
  const fields = line.trim().split(/\s+/).slice(1).map(Number);
  const idle = fields[3] + fields[4];
  const total = fields.reduce((a, b) => a + b, 0);
  if (!lastCpu) { lastCpu = { idle, total }; return 0; }
  const dIdle = idle - lastCpu.idle;
  const dTotal = total - lastCpu.total;
  lastCpu = { idle, total };
  if (dTotal === 0) return 0;
  return Math.max(0, Math.min(100, ((dTotal - dIdle) / dTotal) * 100));
}

export function readMemory(): { pct: number; usedMB: number; totalMB: number } {
  const meminfo = readFile(`${config.hostProc}/meminfo`);
  const total = parseInt(meminfo.match(/MemTotal:\s+(\d+) kB/)?.[1] || "0");
  const avail = parseInt(meminfo.match(/MemAvailable:\s+(\d+) kB/)?.[1] || "0");
  const used = total - avail;
  return {
    pct: total ? (used / total) * 100 : 0,
    usedMB: Math.round(used / 1024),
    totalMB: Math.round(total / 1024),
  };
}

export async function readDisk(): Promise<number> {
  try {
    const { stdout } = await execAsync("df -P / | tail -1", { timeout: 3000 });
    const m = stdout.match(/(\d+)%/);
    return m ? parseInt(m[1]) : 0;
  } catch { return 0; }
}

export function readTemperature(): number | null {
  const paths = [
    `${config.hostSys}/class/thermal/thermal_zone0/temp`,
    `${config.hostSys}/class/hwmon/hwmon0/temp1_input`,
    `${config.hostSys}/class/hwmon/hwmon1/temp1_input`,
    `${config.hostSys}/class/hwmon/hwmon2/temp1_input`,
  ];
  for (const p of paths) {
    const v = readFile(p).trim();
    if (v) {
      const n = parseInt(v);
      if (!isNaN(n) && n > 1000) return Math.round(n / 1000);
      if (!isNaN(n) && n > 0) return n;
    }
  }
  return null;
}

export function readLoadAvg(): number {
  const v = readFile(`${config.hostProc}/loadavg`).split(" ")[0];
  return parseFloat(v) || 0;
}

export function readUptime(): number {
  const v = readFile(`${config.hostProc}/uptime`).split(" ")[0];
  return parseInt(v) || 0;
}

export function readNetwork(): { rxKBs: number; txKBs: number } {
  const dev = readFile(`${config.hostProc}/net/dev`);
  let rx = 0, tx = 0;
  for (const line of dev.split("\n").slice(2)) {
    const m = line.match(/^\s*(\S+):\s+(\d+)\s+\d+\s+\d+\s+\d+\s+\d+\s+\d+\s+\d+\s+\d+\s+(\d+)/);
    if (m && !["lo", "docker0"].includes(m[1])) {
      rx += parseInt(m[2]);
      tx += parseInt(m[3]);
    }
  }
  const now = Date.now();
  if (!lastNet) { lastNet = { rx, tx, t: now }; return { rxKBs: 0, txKBs: 0 }; }
  const dt = (now - lastNet.t) / 1000;
  const rxKBs = dt > 0 ? (rx - lastNet.rx) / 1024 / dt : 0;
  const txKBs = dt > 0 ? (tx - lastNet.tx) / 1024 / dt : 0;
  lastNet = { rx, tx, t: now };
  return { rxKBs: Math.max(0, rxKBs), txKBs: Math.max(0, txKBs) };
}

export async function readDockerContainers(): Promise<any[]> {
  const d = getDocker(); if (!d) return [];
  try {
    const list = await d.listContainers({ all: true });
    return list.map(c => ({
      id: c.Id.slice(0, 12),
      name: (c.Names[0] || "").replace(/^\//, ""),
      image: c.Image,
      state: c.State,
      status: c.Status,
    }));
  } catch { return []; }
}

export async function readAllStats() {
  const [cpu, disk, containers] = await Promise.all([
    readCpuUsage(), readDisk(), readDockerContainers(),
  ]);
  const mem = readMemory();
  const net = readNetwork();
  return {
    cpuPct: Math.round(cpu * 10) / 10,
    memPct: Math.round(mem.pct * 10) / 10,
    memUsedMB: mem.usedMB,
    memTotalMB: mem.totalMB,
    diskPct: disk,
    tempC: readTemperature(),
    loadAvg: readLoadAvg(),
    netRxKBs: Math.round(net.rxKBs * 10) / 10,
    netTxKBs: Math.round(net.txKBs * 10) / 10,
    uptimeSec: readUptime(),
    containers,
  };
}
