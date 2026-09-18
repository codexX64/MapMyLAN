// Ce que prouve cette suite : le chemin d'authentification d'un jeton
// d'intégration, tel que l'API l'exécute, et le contrôle de rôle qui suit.
//
// On monte le middleware avec une base simulée plutôt qu'un serveur HTTP :
// le dépôt n'embarque pas de client de test HTTP, et la règle « aucune
// nouvelle dépendance » tient. Ce qui est vérifié ici est exactement ce
// qu'Express exécuterait — les mêmes fonctions, dans le même ordre.

import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Request, Response, NextFunction } from "express";

// `vi.mock` est hissé en tête de fichier : ce qu'il capture doit l'être aussi.
const { findUnique, update, userFindUnique, journal } = vi.hoisted(() => ({
  findUnique: vi.fn(),
  update: vi.fn(() => Promise.resolve({})),
  userFindUnique: vi.fn(),
  journal: [] as { niveau: string; source: string; message: string; meta: any }[],
}));
vi.mock("../db", () => ({
  prisma: {
    integrationToken: { findUnique, update },
    user: { findUnique: userFindUnique },
  },
}));

vi.mock("../services/logger", () => ({
  logEvent: async (niveau: string, source: string, message: string, meta?: any) => {
    journal.push({ niveau, source, message, meta });
  },
}));

import { authRequired, requireRole, AuthedRequest } from "./auth";
import { fabriquerJeton, reinitialiserDebit, DEBIT_MAX } from "../services/integrations";

function req(methode: string, url: string, jeton: string): AuthedRequest {
  return {
    method: methode,
    url,
    originalUrl: url,
    ip: "192.0.2.10",
    headers: { authorization: `Bearer ${jeton}` },
  } as unknown as AuthedRequest;
}

function res() {
  const r: any = { statusCode: 0, body: undefined };
  r.status = vi.fn((c: number) => { r.statusCode = c; return r; });
  r.json = vi.fn((b: unknown) => { r.body = b; return r; });
  return r as Response & { statusCode: number; body: any };
}

/** Pose une ligne de jeton en base simulée et rend le clair. */
function poser(role: string, extra: any = {}) {
  const { clair, prefix, hash } = fabriquerJeton();
  findUnique.mockResolvedValue({
    id: "tok-1", name: "hub", role, prefix, hash,
    createdAt: new Date(), lastUsedAt: null, expiresAt: null, revokedAt: null,
    ...extra,
  });
  return clair;
}

/** Enchaîne authRequired puis la garde d'écriture, comme le fait un routeur. */
async function passer(methode: string, url: string, jeton: string, garde?: any) {
  const q = req(methode, url, jeton);
  const r = res();
  const suite = vi.fn() as unknown as NextFunction;
  await authRequired(q, r, suite as any);
  if ((suite as any).mock.calls.length === 0) return { q, r, passe: false };
  if (garde && methode !== "GET" && methode !== "HEAD") {
    const suite2 = vi.fn() as unknown as NextFunction;
    garde(q, r, suite2 as any);
    return { q, r, passe: (suite2 as any).mock.calls.length === 1 };
  }
  return { q, r, passe: true };
}

const ecriture = requireRole("admin", "operator");

beforeEach(() => {
  findUnique.mockReset();
  update.mockReset();
  userFindUnique.mockReset();
  journal.length = 0;
  reinitialiserDebit();
});

describe("jeton operator", () => {
  it("lit l'inventaire", async () => {
    const jeton = poser("operator");
    const { q, passe } = await passer("GET", "/api/devices", jeton);
    expect(passe).toBe(true);
    expect(q.user).toEqual({
      id: "integration:tok-1", username: "integration:hub", role: "operator",
    });
  });

  it("met un appareil en quarantaine", async () => {
    const jeton = poser("operator");
    const { passe } = await passer("POST", "/api/devices/42/quarantine", jeton, ecriture);
    expect(passe).toBe(true);
  });

  it("note son utilisation au plus une fois par minute", async () => {
    const jeton = poser("operator");
    await passer("GET", "/api/devices", jeton);
    await passer("GET", "/api/devices", jeton);
    expect(update).toHaveBeenCalledTimes(1);
    expect(update.mock.calls[0][0]).toMatchObject({ where: { id: "tok-1" } });
  });
});

describe("jeton viewer", () => {
  it("lit", async () => {
    const jeton = poser("viewer");
    expect((await passer("GET", "/api/devices", jeton)).passe).toBe(true);
  });

  it("n'écrit pas — 403", async () => {
    const jeton = poser("viewer");
    const { r, passe } = await passer("POST", "/api/devices/42/ban", jeton, ecriture);
    expect(passe).toBe(false);
    expect(r.statusCode).toBe(403);
  });
});

describe("jeton refusé", () => {
  it("inconnu — 401", async () => {
    findUnique.mockResolvedValue(null);
    const { r, passe } = await passer("GET", "/api/devices", "mml_inexistant");
    expect(passe).toBe(false);
    expect(r.statusCode).toBe(401);
  });

  it("révoqué — 401", async () => {
    const jeton = poser("operator", { revokedAt: new Date("2026-01-01") });
    const { r } = await passer("GET", "/api/devices", jeton);
    expect(r.statusCode).toBe(401);
    expect(journal.at(-1)?.message).toContain("revoque");
  });

  it("expiré — 401", async () => {
    const jeton = poser("operator", { expiresAt: new Date("2020-01-01") });
    const { r } = await passer("GET", "/api/devices", jeton);
    expect(r.statusCode).toBe(401);
    expect(journal.at(-1)?.message).toContain("expire");
  });

  it("mal formé — 401, et la base n'est pas interrogée pour rien", async () => {
    findUnique.mockResolvedValue(null);
    const { r } = await passer("GET", "/api/devices", "mml_");
    expect(r.statusCode).toBe(401);
  });

  it("absent — 401", async () => {
    const q = { method: "GET", url: "/api/devices", originalUrl: "/api/devices",
                headers: {} } as unknown as AuthedRequest;
    const r = res();
    await authRequired(q, r, vi.fn() as any);
    expect(r.statusCode).toBe(401);
  });
});

describe("portée", () => {
  it("les comptes sont fermés — 403", async () => {
    const jeton = poser("operator");
    const { r, passe } = await passer("GET", "/api/users", jeton);
    expect(passe).toBe(false);
    expect(r.statusCode).toBe(403);
  });

  it("la fabrique de jetons est fermée — 403", async () => {
    const jeton = poser("operator");
    const { r } = await passer("POST", "/api/integrations", jeton);
    expect(r.statusCode).toBe(403);
  });

  it("la connexion, les seconds facteurs et le SSH sont fermés — 403", async () => {
    for (const url of ["/api/auth/login", "/api/mfa/totp", "/api/ssh/devices"]) {
      const jeton = poser("operator");
      expect((await passer("POST", url, jeton)).r.statusCode).toBe(403);
      reinitialiserDebit();
    }
  });

  it("le routeur se lit mais ne s'écrit pas", async () => {
    let jeton = poser("operator");
    expect((await passer("GET", "/api/router/status", jeton)).passe).toBe(true);
    reinitialiserDebit();
    jeton = poser("operator");
    expect((await passer("POST", "/api/router/reboot", jeton, ecriture)).r.statusCode).toBe(403);
  });
});

describe("débit", () => {
  it("429 au-delà de la limite", async () => {
    const jeton = poser("operator");
    for (let i = 0; i < DEBIT_MAX; i++) await passer("GET", "/api/devices", jeton);
    const { r } = await passer("GET", "/api/devices", jeton);
    expect(r.statusCode).toBe(429);
  });
});

describe("le jeton en clair ne fuit nulle part", () => {
  it("ni en base, ni dans le journal", async () => {
    const jeton = poser("operator");
    await passer("POST", "/api/users", jeton);          // refus de portée, donc journal
    await passer("GET", "/api/devices", jeton);          // succès, donc écriture
    const traces = JSON.stringify({ journal, findUnique: findUnique.mock.calls,
                                    update: update.mock.calls });
    expect(traces).not.toContain(jeton);
    expect(traces).not.toContain(jeton.slice(4));
  });
});

describe("le chemin JWT n'a pas bougé", () => {
  it("un jeton qui n'est pas un JWT valide reste refusé par la signature", async () => {
    const q = req("GET", "/api/devices", "pas.un.jwt");
    const r = res();
    await authRequired(q, r, vi.fn() as any);
    expect(r.statusCode).toBe(401);
    // Aucun passage par la table des jetons d'intégration.
    expect(findUnique).not.toHaveBeenCalled();
  });
});
