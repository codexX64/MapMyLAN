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


// ── Contrôle des secrets au démarrage ───────────────────────────────────────
//
// Un JWT_SECRET vide ou deviné permet de forger n'importe quel jeton, donc de
// se faire passer pour l'administrateur sans connaître son mot de passe. Le
// service refuse de démarrer plutôt que de fonctionner en apparence tout en
// étant ouvert.
const SECRETS_FAIBLES = new Set([
  "", "secret", "changeme", "change-me", "password", "mapmylan",
  "jwt-secret", "supersecret", "dev", "test", "votre-secret-ici",
]);

export function verifierSecrets(): void {
  const manques: string[] = [];
  const jwt = String(process.env.JWT_SECRET || "");
  const master = String(process.env.MASTER_KEY || "");

  if (SECRETS_FAIBLES.has(jwt.toLowerCase()) || jwt.length < 32) {
    manques.push("JWT_SECRET doit faire au moins 32 caractères et ne pas être une valeur courante");
  }
  if (!master || master.length < 16) manques.push("MASTER_KEY est absente ou trop courte");

  if (manques.length) {
    console.error("\n  Démarrage refusé — la configuration n'est pas sûre :\n");
    for (const m of manques) console.error("    · " + m);
    console.error("\n    openssl rand -base64 48   → JWT_SECRET");
    console.error("    openssl rand -base64 32   → MASTER_KEY\n");
    process.exit(1);
  }
}
