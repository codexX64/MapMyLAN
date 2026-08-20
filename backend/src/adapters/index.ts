// Adapter registry and resolution of the main device.

import { prisma } from "../db";
import { decrypt } from "../services/crypto";
import { executeOnDevice, executeWith, testConnection } from "../services/ssh";
import { ValeurRefusee } from "../services/valider";
import { RouterAdapter, AdapterContext, RouterCreds, Capability } from "./types";
import { SSH_ADAPTERS } from "./ssh-drivers";
import { unifi } from "./unifi";

export const ADAPTERS: RouterAdapter[] = [unifi, ...SSH_ADAPTERS];

export function getAdapter(id?: string | null): RouterAdapter {
  const found = ADAPTERS.find(a => a.id === id);
  if (found) return found;
  // Legacy values stored before the adapter layer existed
  const legacy: Record<string, string> = {
    asus: "asus-merlin", merlin: "asus-merlin", mikrotik: "routeros",
    cisco: "cisco-ios", opnsense: "pfsense", ubiquiti: "unifi",
  };
  return ADAPTERS.find(a => a.id === legacy[String(id).toLowerCase()])
      || ADAPTERS.find(a => a.id === "generic")!;
}

/** Identifies the vendor from an SSH banner or an HTTP response. */
export function detectAdapter(probe: string): RouterAdapter | null {
  return ADAPTERS.find(a => a.detect?.(probe)) || null;
}

export function capabilitiesOf(id?: string | null): Capability[] {
  return getAdapter(id).capabilities;
}

/** Decrypts the stored credentials and builds the execution context. */
export function contextFor(row: any): AdapterContext {
  const creds: RouterCreds = {
    host: row.host,
    port: row.port || 22,
    username: row.username,
    password: row.passwordEnc ? decrypt(row.passwordEnc) : undefined,
    privateKey: row.privateKeyEnc ? decrypt(row.privateKeyEnc) : undefined,
    passphrase: row.passphraseEnc ? decrypt(row.passphraseEnc) : undefined,
    transport: (row.transport as any) || "ssh",
    apiBaseUrl: row.apiBaseUrl || undefined,
    site: row.site || undefined,
    verifyTls: row.verifyTls === true,
  };
  return {
    creds,
    exec: (command: string) => executeOnDevice(row.id, gardeCommande(command)),
  };
}

/**
 * Last line of defense before execution.
 *
 * Every driver command passes through `exec`. Putting the check here covers all
 * twenty-four actions at once, whereas placing it in each driver would let
 * through the one you forget — and that's always the one that gets exploited.
 *
 * The check is deliberately coarse: it doesn't try to understand the command,
 * only to confirm it contains none of the characters used to chain a second one
 * onto it. A legitimate network-administration command has no need for them;
 * the drivers produce none.
 */
const ENCHAINEMENT = /[;&|`$\n\r<>]|\$\(|\|\|/;

export function gardeCommande(command: string): string {
  if (typeof command !== "string" || !command.length) {
    throw new ValeurRefusee("Command", command);
  }
  if (command.length > 4096) {
    throw new ValeurRefusee("Command — too long", command.length);
  }
  if (ENCHAINEMENT.test(command)) {
    // Drivers that legitimately chain several commands declare them
    // separately: see the arrays in `ssh-drivers`.
    throw new ValeurRefusee("Command — chaining refused", command);
  }
  return command;
}

export async function mainRouterRow(): Promise<any | null> {
  return prisma.sshDevice.findFirst({ where: { isMainRouter: true } });
}

/** Adapter + context for the main device, or an explicit error. */
export async function mainRouter(): Promise<{ row: any; adapter: RouterAdapter; ctx: AdapterContext }> {
  const row = await mainRouterRow();
  if (!row) throw new Error("No main device configured — go to Router to add one.");
  return { row, adapter: getAdapter(row.vendor), ctx: contextFor(row) };
}

/** SSH probe used by automatic detection. */
/** Context for a configuration not yet persisted to the database. */
export function contextForCreds(creds: RouterCreds): AdapterContext {
  return {
    creds,
    exec: (command: string) => executeWith({
      host: creds.host, port: creds.port, username: creds.username,
      password: creds.password, privateKey: creds.privateKey, passphrase: creds.passphrase,
    }, gardeCommande(command)),
  };
}

export async function probeSsh(creds: RouterCreds): Promise<string> {
  const r = await testConnection({
    host: creds.host, port: creds.port, username: creds.username,
    password: creds.password, privateKey: creds.privateKey, passphrase: creds.passphrase,
  } as any);
  return [r.banner, r.error].filter(Boolean).join(" ");
}

export * from "./types";
