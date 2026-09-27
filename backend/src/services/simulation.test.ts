// Ce que prouve cette suite : le mode simulation est éteint par défaut, ses
// événements sont plausibles et ne visent que ses propres appareils, son
// rythme ralentit la nuit, et ce qui part vers SYNAPSE porte l'étiquette
// « simulation » quand c'est simulé — et seulement dans ce cas.

import { describe, it, expect, vi } from "vitest";

vi.mock("../db", () => ({ prisma: {} }));
vi.mock("../ws/realtime", () => ({ eventBus: { emit() {}, on() {} } }));
vi.mock("./logger", () => ({ createAlert: async () => ({}), logEvent: async () => {} }));
vi.mock("./scoring", () => ({ scoreDevice: async () => ({}) }));

import { vitesse, choisir, prochainDelai, MODELES, type AppareilSimule } from "./simulation";
import { depuisAlerte } from "./memoire";

const graine = (s: number) => () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
const app = (x: Partial<AppareilSimule>): AppareilSimule => ({ id: x.ip || "a", nom: "camera-120", ip: "192.0.2.120", type: "camera", vendeur: "Hikvision", etat: "online", ports: [80, 554], cves: [], ...x });

describe("mode simulation", () => {
  it("éteint par défaut ; seules des valeurs explicites l'allument", () => {
    expect(vitesse(undefined)).toBe("off");
    expect(vitesse("")).toBe("off");
    expect(vitesse("n'importe quoi")).toBe("off");
    expect(vitesse("normal")).toBe("normal");
    expect(vitesse("rapide")).toBe("rapide");
  });

  it("un réseau presque vide se remplit d'abord", () => {
    expect(choisir([], graine(3)).type).toBe("arrivee");
    expect(choisir([app({})], graine(5)).type).toBe("arrivee");
  });

  it("sur 500 tirages : tous les types d'événements, jamais d'incohérence", () => {
    const parc = [
      app({ ip: "192.0.2.101" }), app({ ip: "192.0.2.102", etat: "offline", horsLigneDepuis: Date.now() - 60_000 }),
      app({ ip: "192.0.2.103", type: "laptop", vendeur: "Dell", ports: [135, 3389] }), app({ ip: "192.0.2.104", type: "nas", vendeur: "Synology", ports: [5000] }),
      app({ ip: "192.0.2.105", type: "phone", vendeur: "Apple", ports: [62078] }),
    ];
    const r = graine(42), vus = new Set<string>();
    for (let i = 0; i < 500; i++) {
      const e = choisir(parc, r);
      vus.add(e.type);
      if (e.type === "retour") expect(e.appareil.etat).toBe("offline");
      if (e.type === "depart" || e.type === "intrusion") expect(e.appareil.etat).toBe("online");
      if (e.type === "port_ouvert") expect(e.appareil.ports).not.toContain(e.service[0]);
      if (e.type === "port_ferme") expect(e.appareil.ports).toContain(e.port);
      if (e.type === "cve") expect(e.appareil.cves).not.toContain(e.cve[0]);
    }
    expect([...vus].sort()).toEqual(["arrivee", "balayage", "cve", "depart", "intrusion", "port_ferme", "port_ouvert", "retour"]);
  });

  it("un réseau plein se vide par ses absents de longue date", () => {
    const plein = Array.from({ length: 24 }, (_, i) => app({ ip: `192.0.2.${110 + i}`, id: `d${i}`, etat: i === 3 ? "offline" : "online", horsLigneDepuis: i === 3 ? Date.now() - 7 * 3600_000 : undefined }));
    const e = choisir(plein, graine(9));
    expect(e).toMatchObject({ type: "retrait", appareil: { id: "d3" } });
  });

  it("rythme : 1 à 5 min, 10 à 40 s en rapide, trois fois plus lent la nuit", () => {
    const d = prochainDelai("normal", 14, () => 0.5), n = prochainDelai("normal", 3, () => 0.5);
    expect(d).toBe(180_000); expect(n).toBe(540_000);
    expect(prochainDelai("rapide", 14, () => 0)).toBe(10_000);
  });

  it("chaque modèle est cohérent : ports sûrs et risqués distincts, CVE au format officiel", () => {
    for (const m of MODELES) {
      for (const [p] of m.risques) expect(m.ports.map(x => x[0])).not.toContain(p);
      for (const [id, cvss] of m.cves) { expect(id).toMatch(/^CVE-\d{4}-\d{4,}$/); expect(cvss).toBeGreaterThan(0); expect(cvss).toBeLessThanOrEqual(10); }
    }
  });
});

describe("envoi à SYNAPSE", () => {
  it("une alerte simulée porte l'étiquette ; une vraie, non", () => {
    const s = depuisAlerte({ id: "x", severity: "high", source: "simulation", message: "Port 23 (telnet) ouvert sur camera-120", deviceIp: "192.0.2.120", metadata: { simulation: true, evenement: "port_ouvert" } });
    expect(s).toMatchObject({ kind: "incident.network", ref: "alerte:x", tags: ["alerte", "high", "simulation"], meta: { evenement: "port_ouvert" } });
    const v = depuisAlerte({ severity: "medium", source: "scanner", message: "Nouvel appareil" });
    expect(v.kind).toBe("network.alert");
    expect(v.tags).not.toContain("simulation");
  });
});
