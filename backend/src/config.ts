import dotenv from "dotenv";
dotenv.config();

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

export const config = {
  port: parseInt(process.env.PORT || "4000"),
  nodeEnv: process.env.NODE_ENV || "development",
  databaseUrl: required("DATABASE_URL"),
  redisUrl: process.env.REDIS_URL || "redis://127.0.0.1:6379",
  masterKey: required("MASTER_KEY"),
  jwtSecret: required("JWT_SECRET"),
  corsOrigin: process.env.CORS_ORIGIN || "*",
  hostProc: process.env.HOST_PROC || "/proc",
  hostSys: process.env.HOST_SYS || "/sys",
  scan: {
    subnet: process.env.SCAN_SUBNET || "192.168.1.0/24",
    interval: parseInt(process.env.SCAN_INTERVAL || "300"),
    iface: process.env.SCAN_INTERFACE || "",
  },
};

if (config.masterKey.length < 32) throw new Error("MASTER_KEY must be at least 32 characters");


// ── Secret checks at startup ────────────────────────────────────────────────
//
// An empty or guessable JWT_SECRET lets anyone forge any token, and therefore
// impersonate the administrator without ever knowing their password. The
// service refuses to start rather than appearing to run while being wide open.
const SECRETS_FAIBLES = new Set([
  "", "secret", "changeme", "change-me", "password", "mapmylan",
  "jwt-secret", "supersecret", "dev", "test", "votre-secret-ici",
]);

export function verifierSecrets(): void {
  const manques: string[] = [];
  const jwt = String(process.env.JWT_SECRET || "");
  const master = String(process.env.MASTER_KEY || "");

  if (SECRETS_FAIBLES.has(jwt.toLowerCase()) || jwt.length < 32) {
    manques.push("JWT_SECRET must be at least 32 characters and not a common value");
  }
  if (!master || master.length < 16) {
    manques.push("MASTER_KEY is missing or too short");
  }
  if (!process.env.POSTGRES_PASSWORD) {
    manques.push("POSTGRES_PASSWORD is missing");
  }

  if (manques.length) {
    console.error("\n  Startup refused — the configuration is not secure:\n");
    for (const m of manques) console.error("    · " + m);
    console.error("\n  Generate them like this:\n");
    console.error("    openssl rand -base64 48   → JWT_SECRET");
    console.error("    openssl rand -base64 32   → MASTER_KEY");
    console.error("    openssl rand -base64 24   → POSTGRES_PASSWORD\n");
    process.exit(1);
  }
}
