import { NodeSSH } from "node-ssh";
import { prisma } from "../db";
import { decrypt } from "./crypto";
import { logEvent } from "./logger";

export interface SshTarget {
  host: string; port: number; username: string;
  password?: string; privateKey?: string; passphrase?: string;
}

const cache = new Map<string, { ssh: NodeSSH; expires: number }>();

async function connect(target: SshTarget): Promise<NodeSSH> {
  const key = `${target.username}@${target.host}:${target.port}`;
  const now = Date.now();
  const cached = cache.get(key);
  if (cached && cached.expires > now && cached.ssh.isConnected()) return cached.ssh;
  if (cached) cached.ssh.dispose();

  const ssh = new NodeSSH();
  await ssh.connect({
    host: target.host, port: target.port, username: target.username,
    password: target.password, privateKey: target.privateKey, passphrase: target.passphrase,
    readyTimeout: 10_000,
  });
  cache.set(key, { ssh, expires: now + 60_000 });
  return ssh;
}

export async function testConnection(target: SshTarget): Promise<{ ok: boolean; error?: string; banner?: string }> {
  const ssh = new NodeSSH();
  try {
    await ssh.connect({
      host: target.host, port: target.port, username: target.username,
      password: target.password, privateKey: target.privateKey, passphrase: target.passphrase,
      readyTimeout: 8_000,
    });
    const r = await ssh.execCommand("uname -a 2>/dev/null || /system identity print 2>/dev/null || show version | head -3 2>/dev/null || echo connected");
    ssh.dispose();
    return { ok: true, banner: r.stdout.slice(0, 200) };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
}

export async function executeOnDevice(deviceId: string, command: string): Promise<{ stdout: string; stderr: string; code: number | null }> {
  const dev = await prisma.sshDevice.findUnique({ where: { id: deviceId } });
  if (!dev) throw new Error("SSH device not found");

  const target: SshTarget = {
    host: dev.host, port: dev.port, username: dev.username,
    password: dev.passwordEnc ? decrypt(dev.passwordEnc) : undefined,
    privateKey: dev.privateKeyEnc ? decrypt(dev.privateKeyEnc) : undefined,
    passphrase: dev.passphraseEnc ? decrypt(dev.passphraseEnc) : undefined,
  };
  const ssh = await connect(target);
  const result = await ssh.execCommand(command, { execOptions: { pty: false } });
  await prisma.sshDevice.update({ where: { id: deviceId }, data: { lastConnected: new Date() } });
  await logEvent("info", "ssh", `Executed on ${dev.name}: ${command.slice(0, 80)}`);
  return { stdout: result.stdout, stderr: result.stderr, code: result.code };
}

// Execution with credentials supplied on the fly: used by the connection test
// before registration, when no record exists in the database yet.
export async function executeWith(target: SshTarget, command: string): Promise<{ stdout: string; stderr: string; code: number | null }> {
  const ssh = await connect(target);
  const result = await ssh.execCommand(command, { execOptions: { pty: false } });
  return { stdout: result.stdout, stderr: result.stderr, code: result.code };
}
