// v2.1 seed: admin user + default security rules. NO fake VLANs.

import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { randomBytes } from "crypto";

const prisma = new PrismaClient();

// Obviously weak passwords: rejected for the administrator account.
const MOTS_FAIBLES = new Set([
  "admin", "password", "changeme", "change-me", "motdepasse", "mapmylan",
  "administrator", "root", "1234", "12345678", "azerty", "qwerty",
]);

async function main() {
  const adminUser = process.env.DEFAULT_ADMIN_USER || "admin";
  const envPass = process.env.DEFAULT_ADMIN_PASSWORD;

  const existant = await prisma.user.findUnique({ where: { username: adminUser } });

  // A password supplied by the environment must be strong. "admin/admin" on an
  // interface that drives the network firewall is a one-request takeover:
  // scanners try it within the first minute.
  if (envPass !== undefined && envPass !== "") {
    if (envPass.length < 12 || MOTS_FAIBLES.has(envPass.toLowerCase())) {
      console.error("\n  DEFAULT_ADMIN_PASSWORD is too weak (≥ 12 characters, not a common value).");
      console.error("  Generate one:  openssl rand -base64 18\n");
      process.exit(1);
    }
    const hash = await bcrypt.hash(envPass, 10);
    await prisma.user.upsert({
      where: { username: adminUser },
      update: { password: hash },   // explicit takeover from .env
      create: { username: adminUser, password: hash, role: "admin" },
    });
    console.log(`✔ Admin user ready: ${adminUser} (password set from .env)`);
  } else if (!existant) {
    // No password supplied and no account: we create one with a random secret,
    // shown only once. Never a default "admin/admin".
    const genere = randomBytes(15).toString("base64url");
    const hash = await bcrypt.hash(genere, 10);
    await prisma.user.create({ data: { username: adminUser, password: hash, role: "admin" } });
    console.log("\n  ┌──────────────────────────────────────────────────────────────┐");
    console.log("  │  Administrator account created                               │");
    console.log(`  │  Username: ${adminUser.padEnd(50)}│`);
    console.log(`  │  Password: ${genere.padEnd(50)}│`);
    console.log("  │  Write it down: it will not be shown again. Change it after  │");
    console.log("  │  the first login.                                            │");
    console.log("  └──────────────────────────────────────────────────────────────┘\n");
  } else {
    // Account already present, no password enforced: we touch nothing.
    console.log(`✔ Admin user ready: ${adminUser} (unchanged)`);
  }

  // Default security rules (only created once)
  const ruleCount = await prisma.securityRule.count();
  if (ruleCount === 0) {
    await prisma.securityRule.createMany({
      data: [
        { name: "Auto-quarantine high danger", trigger: "dangerScore", threshold: 75, action: "quarantine" },
        { name: "Auto-ban critical danger",    trigger: "dangerScore", threshold: 85, action: "ban" },
        { name: "Alert on port scan",          trigger: "portScan",    action: "alert" },
        { name: "Alert on ARP spoofing",       trigger: "arpSpoof",    action: "alert" },
        { name: "Alert on critical CVE",       trigger: "cve",         threshold: 9.0, action: "alert" },
        { name: "Alert on new device",         trigger: "newDevice",   action: "alert" },
      ],
    });
    console.log("✔ Default security rules created");
  }

  // Settings (only initialize if missing)
  await prisma.setting.upsert({
    where: { key: "setup.complete" },
    update: {},
    create: { key: "setup.complete", value: false },
  });
  await prisma.setting.upsert({
    where: { key: "scan.subnet" },
    update: {},
    create: { key: "scan.subnet", value: process.env.SCAN_SUBNET || "192.168.1.0/24" },
  });
  await prisma.setting.upsert({
    where: { key: "scan.interval" },
    update: {},
    create: { key: "scan.interval", value: parseInt(process.env.SCAN_INTERVAL || "300") },
  });
  await prisma.setting.upsert({
    where: { key: "topology.autoBuild" },
    update: {},
    create: { key: "topology.autoBuild", value: true },
  });

  console.log("✔ Seed complete");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
