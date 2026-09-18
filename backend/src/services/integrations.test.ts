import { describe, it, expect, beforeEach, vi } from "vitest";

// `vi.mock` est hissé en tête de fichier : ce qu'il capture doit l'être aussi.
const { findUnique, update } = vi.hoisted(() => ({
  findUnique: vi.fn(),
  update: vi.fn(() => Promise.resolve({})),
}));
vi.mock("../db", () => ({ prisma: { integrationToken: { findUnique, update } } }));

import {
  PREFIXE, ROLES, empreinte, fabriquerJeton, estJetonIntegration, memeEmpreinte,
  porteeRefusee, debitDepasse, doitNoterUsage, reinitialiserDebit,
  verifierJeton, DEBIT_MAX,
} from "./integrations";

beforeEach(() => {
  findUnique.mockReset();
  update.mockReset();
  reinitialiserDebit();
});

describe("fabrication", () => {
  it("produit un jeton préfixé, long, et son empreinte", () => {
    const { clair, prefix, hash } = fabriquerJeton();
    expect(clair.startsWith(PREFIXE)).toBe(true);
    // 32 octets en base64url font 43 caractères, plus le préfixe.
    expect(clair.length).toBe(PREFIXE.length + 43);
    expect(prefix).toBe(clair.slice(0, 8));
    expect(hash).toBe(empreinte(clair));
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("ne produit jamais deux fois le même", () => {
    const vus = new Set(Array.from({ length: 200 }, () => fabriquerJeton().clair));
    expect(vus.size).toBe(200);
  });

  it("l'empreinte ne laisse pas retrouver le jeton dans ce qui est stocké", () => {
    const { clair, prefix, hash } = fabriquerJeton();
    expect(hash).not.toContain(clair.slice(PREFIXE.length));
    // Le préfixe affichable ne donne que ce qui est déjà commun à tous.
    expect(prefix.length).toBeLessThan(clair.length / 4);
  });

  it("reconnaît un jeton d'intégration à son préfixe", () => {
    expect(estJetonIntegration(fabriquerJeton().clair)).toBe(true);
    expect(estJetonIntegration("eyJhbGciOiJIUzI1NiJ9.abc.def")).toBe(false);
    expect(estJetonIntegration(null)).toBe(false);
    expect(estJetonIntegration("")).toBe(false);
  });

  it("n'offre que viewer et operator", () => {
    expect([...ROLES]).toEqual(["viewer", "operator"]);
    expect(ROLES).not.toContain("admin" as never);
  });
});

describe("memeEmpreinte", () => {
  it("accepte deux empreintes identiques", () => {
    const h = empreinte("mml_x");
    expect(memeEmpreinte(h, h)).toBe(true);
  });
  it("refuse deux empreintes différentes, et des longueurs différentes", () => {
    expect(memeEmpreinte(empreinte("a"), empreinte("b"))).toBe(false);
    expect(memeEmpreinte("abc", "abcd")).toBe(false);
  });
});

describe("porteeRefusee", () => {
  it("ferme la connexion, les comptes, les seconds facteurs, le SSH et les jetons", () => {
    for (const c of ["/api/auth/login", "/api/users", "/api/users/42", "/api/mfa/totp",
                     "/api/ssh/devices", "/api/integrations"]) {
      expect(porteeRefusee("GET", c)).not.toBeNull();
      expect(porteeRefusee("POST", c)).not.toBeNull();
    }
  });

  it("laisse lire le routeur mais pas l'écrire", () => {
    expect(porteeRefusee("GET", "/api/router/status")).toBeNull();
    expect(porteeRefusee("POST", "/api/router/reboot")).toBe("/api/router");
    expect(porteeRefusee("DELETE", "/api/router")).toBe("/api/router");
  });

  it("laisse passer l'inventaire et la topologie", () => {
    expect(porteeRefusee("GET", "/api/devices")).toBeNull();
    expect(porteeRefusee("POST", "/api/devices/42/quarantine")).toBeNull();
    expect(porteeRefusee("GET", "/api/topology")).toBeNull();
  });

  it("ne se laisse pas contourner par la requête, la barre finale ou un préfixe voisin", () => {
    expect(porteeRefusee("GET", "/api/users?x=1")).toBe("/api/users");
    expect(porteeRefusee("GET", "/api/users/")).toBe("/api/users");
    // Une route qui commence par les mêmes lettres sans être dessous.
    expect(porteeRefusee("GET", "/api/usersettings")).toBeNull();
  });
});

describe("débit", () => {
  it("laisse passer jusqu'à la limite, puis refuse", () => {
    const t0 = 1_000_000;
    for (let i = 0; i < DEBIT_MAX; i++) {
      expect(debitDepasse("jeton:a", t0)).toBe(false);
    }
    expect(debitDepasse("jeton:a", t0)).toBe(true);
  });

  it("repart à zéro à la fenêtre suivante", () => {
    const t0 = 2_000_000;
    for (let i = 0; i <= DEBIT_MAX; i++) debitDepasse("jeton:b", t0);
    expect(debitDepasse("jeton:b", t0 + 60_000)).toBe(false);
  });

  it("compte chaque clé séparément", () => {
    const t0 = 3_000_000;
    for (let i = 0; i <= DEBIT_MAX; i++) debitDepasse("jeton:c", t0);
    expect(debitDepasse("jeton:d", t0)).toBe(false);
  });
});

describe("dernière utilisation", () => {
  it("n'écrit qu'une fois par minute", () => {
    const t0 = 4_000_000;
    expect(doitNoterUsage("id", t0)).toBe(true);
    expect(doitNoterUsage("id", t0 + 59_000)).toBe(false);
    expect(doitNoterUsage("id", t0 + 60_000)).toBe(true);
  });
});

describe("verifierJeton", () => {
  const ligne = (extra: any = {}) => {
    const { clair, prefix, hash } = fabriquerJeton();
    return { clair, row: { id: "t1", name: "hub", role: "operator", prefix, hash,
                           revokedAt: null, expiresAt: null, ...extra } };
  };

  it("accepte un jeton valide et rend son rôle", async () => {
    const { clair, row } = ligne();
    findUnique.mockResolvedValue(row);
    const v = await verifierJeton(clair);
    expect(v).toEqual({ ok: true, jeton: { id: "t1", name: "hub", role: "operator" } });
    // La base n'est jamais interrogée avec le jeton, seulement avec son empreinte.
    expect(findUnique).toHaveBeenCalledWith({ where: { hash: empreinte(clair) } });
    expect(JSON.stringify(findUnique.mock.calls)).not.toContain(clair);
  });

  it("refuse un jeton inconnu", async () => {
    findUnique.mockResolvedValue(null);
    expect(await verifierJeton("mml_inconnu")).toEqual({ ok: false, raison: "inconnu" });
  });

  it("refuse un jeton révoqué", async () => {
    const { clair, row } = ligne({ revokedAt: new Date("2026-01-01") });
    findUnique.mockResolvedValue(row);
    expect(await verifierJeton(clair)).toEqual({ ok: false, raison: "revoque" });
  });

  it("refuse un jeton expiré", async () => {
    const { clair, row } = ligne({ expiresAt: new Date("2026-01-01") });
    findUnique.mockResolvedValue(row);
    expect(await verifierJeton(clair, new Date("2026-06-01")))
      .toEqual({ ok: false, raison: "expire" });
  });

  it("accepte un jeton dont l'échéance n'est pas atteinte", async () => {
    const { clair, row } = ligne({ expiresAt: new Date("2027-01-01") });
    findUnique.mockResolvedValue(row);
    expect((await verifierJeton(clair, new Date("2026-06-01"))).ok).toBe(true);
  });

  it("dit « révoqué » plutôt qu'« expiré » quand les deux sont vrais", async () => {
    const { clair, row } = ligne({
      revokedAt: new Date("2026-01-01"), expiresAt: new Date("2026-01-02"),
    });
    findUnique.mockResolvedValue(row);
    expect(await verifierJeton(clair, new Date("2026-06-01")))
      .toEqual({ ok: false, raison: "revoque" });
  });
});
