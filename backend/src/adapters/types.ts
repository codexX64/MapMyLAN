// Vendor adapter layer.
//
// An adapter knows how to talk to a network device by whatever means that
// device offers: SSH for most, HTTP API for UniFi, both for some. It declares
// what it can do, and the interface grays out the rest rather than offering a
// button that will fail.

export type Capability =
  | "ban"          // block a device
  | "unban"        // lift the block
  | "quarantine"   // isolate without cutting off completely
  | "clients"      // list the devices seen by the equipment
  | "arp"          // read the ARP table
  | "leases"       // read the DHCP leases
  | "ports"        // physical port status
  | "vlans"        // read and create VLANs
  | "reboot";      // reboot the equipment

export type Transport = "ssh" | "api";

export interface RouterCreds {
  host: string;
  port: number;
  username: string;
  password?: string;
  privateKey?: string;
  passphrase?: string;
  transport: Transport;
  /** UniFi and the like: API base URL, site, tolerance for self-signed certificates */
  apiBaseUrl?: string;
  site?: string;
  verifyTls?: boolean;
}

export interface ExecResult { stdout: string; stderr: string; code: number | null }

export interface AdapterContext {
  creds: RouterCreds;
  /** Available only for SSH adapters */
  exec: (command: string) => Promise<ExecResult>;
}

export interface ClientEntry {
  mac?: string;
  ip?: string;
  hostname?: string;
  vendor?: string;
  medium?: "wired" | "wireless";
  port?: string | number;
  uptimeSec?: number;
  blocked?: boolean;
}

export interface TestResult {
  ok: boolean;
  error?: string;
  /** What the equipment responded with: SSH banner, model, version */
  info?: string;
  /** Vendor identified from the response, if it differs from the manual choice */
  detected?: string;
}

export interface Target {
  ip: string;
  mac?: string | null;
  gateway?: string;
}

export interface RouterAdapter {
  id: string;
  label: string;
  transport: Transport | "both";
  capabilities: Capability[];
  /** Fields to request in the form, in addition to the host and the username */
  needs?: ("password" | "privateKey" | "apiBaseUrl" | "site")[];
  /** Detection from an SSH banner or an HTTP response */
  detect?: (probe: string) => boolean;

  test: (ctx: AdapterContext) => Promise<TestResult>;
  ban: (ctx: AdapterContext, target: Target) => Promise<string>;
  unban: (ctx: AdapterContext, target: Target) => Promise<string>;
  quarantine: (ctx: AdapterContext, target: Target) => Promise<string>;
  clients?: (ctx: AdapterContext) => Promise<ClientEntry[]>;
  arp?: (ctx: AdapterContext) => Promise<ClientEntry[]>;
  reboot?: (ctx: AdapterContext) => Promise<string>;
}

/** Gateway inferred from an address: useful for partial isolation. */
export function gatewayOf(ip: string, explicit?: string): string {
  if (explicit) return explicit;
  return ip.split(".").slice(0, 3).join(".") + ".1";
}
