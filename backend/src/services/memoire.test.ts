import { describe, it, expect, vi, beforeEach } from "vitest";

const alertes: any[] = [];
vi.mock("../db", () => ({
  prisma: { alert: { findMany: async ({ where }: any) => alertes.filter(a => a.createdAt >= where.createdAt.gte).sort((a, b) => a.createdAt - b.createdAt) } },
}));
vi.mock("../config", () => ({ config: { assistant: { synapseUrl: "http://synapse.test", synapseJeton: "cer_mapmylan_test" } } }));
vi.mock("../ws/realtime", () => ({ eventBus: { on: () => {} } }));

describe("mémoire : les alertes partent à SYNAPSE depuis la base", () => {
  beforeEach(() => { alertes.length = 0; });

  it("n'envoie que les alertes écrites après le démarrage, une seule fois, même à la même milliseconde", async () => {
    const { lireAlertes, etatMemoire } = await import("./memoire");
    const passe = new Date(Date.now() - 60_000);
    alertes.push({ id: "vieille", severity: "high", source: "scanner", message: "ancienne", createdAt: passe });
    const t = new Date(Date.now() + 1000);
    alertes.push({ id: "a1", severity: "critical", source: "scanner", message: "Port 23 ouvert", createdAt: t });
    alertes.push({ id: "a2", severity: "low", source: "scanner", message: "Imprimante hors ligne", createdAt: t });
    expect(await lireAlertes()).toBe(2);
    expect(await lireAlertes()).toBe(0);
    alertes.push({ id: "a3", severity: "medium", source: "scanner", message: "Nouvel appareil", createdAt: t });
    expect(await lireAlertes()).toBe(1);
    expect(etatMemoire().enAttente).toBe(3);
  });

  it("transmet les étiquettes demandées, et seulement des étiquettes sûres", async () => {
    const { depuisAlerte, etiquettesDe } = await import("./memoire");
    expect(etiquettesDe({ etiquettes: ["Essai", "bad tag", "x".repeat(40), "ok-2", "a", "b", "c"] })).toEqual(["essai", "ok-2", "a", "b"]);
    const e = depuisAlerte({ id: "z", severity: "critical", source: "scanner", message: "CVE", metadata: { etiquettes: ["essai"] } });
    expect(e.kind).toBe("incident.network");
    expect(e.tags).toEqual(["alerte", "critical", "essai"]);
    expect(etiquettesDe(null)).toEqual([]);
  });
});
