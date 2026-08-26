// v2.1 seed: admin user + default security rules. NO fake VLANs.

import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  // Si DEFAULT_ADMIN_PASSWORD est renseigné, on l'applique — c'est le mode de
  // reprise en main après un oubli. Sinon on ne crée personne : l'interface
  // affichera son écran de création au premier lancement, ce qui évite d'avoir
  // un mot de passe en clair sur le disque.
  const adminUser = process.env.DEFAULT_ADMIN_USER || "admin";
  const adminPass = process.env.DEFAULT_ADMIN_PASSWORD || "";

  const hash = await bcrypt.hash(adminPass, 10);
  await prisma.user.upsert({
    where: { username: adminUser },
    update: {},
    create: { username: adminUser, password: hash, role: "admin" },
  });
  console.log(`✔ Admin user ready: ${adminUser}`);

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
