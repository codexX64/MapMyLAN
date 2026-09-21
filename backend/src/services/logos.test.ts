// Ce que prouve cette suite : le serveur ne sort pas sans qu'on le lui
// demande, il ne sort qu'une fois par domaine, et il ne sert que des images.

import { describe, it, expect, beforeEach, vi } from "vitest";

const { settingFindUnique } = vi.hoisted(() => ({ settingFindUnique: vi.fn() }));
vi.mock("../db", () => ({ prisma: { setting: { findUnique: settingFindUnique } } }));

import {
  domaineValide, logosActifs, logoDe, viderCache, CLE_REGLAGE,
} from "./logos";

/** Réponse de fournisseur, telle que `fetch` la rendrait. */
function reponse(
  { ok = true, type = "image/png", corps = Buffer.from([1, 2, 3, 4]) } = {},
) {
  return {
    ok,
    headers: { get: (n: string) => (n.toLowerCase() === "content-type" ? type : null) },
    arrayBuffer: async () => corps.buffer.slice(corps.byteOffset, corps.byteOffset + corps.length),
  };
}

let appels: string[] = [];

beforeEach(() => {
  settingFindUnique.mockReset();
  viderCache();
  appels = [];
});

/** Installe un `fetch` qui note les URL appelées et répond selon la règle donnée. */
function poserFetch(regle: (url: string) => any) {
  vi.stubGlobal("fetch", async (url: string) => {
    appels.push(url);
    const r = regle(url);
    if (r instanceof Error) throw r;
    return r;
  });
}

describe("domaineValide", () => {
  it("accepte un nom de domaine ordinaire", () => {
    for (const d of ["example.com", "sous.example.com", "a-b.example.co.uk", "xn--80ak6aa92e.com"]) {
      expect(domaineValide(d)).toBe(true);
    }
  });

  it("refuse tout ce qui n'est pas un domaine", () => {
    for (const d of [
      "", "a", "example", "exa mple.com", "example.com/chemin", "example.com:8080",
      "user@example.com", "../etc/passwd", "http://example.com", "-example.com",
      "example.com?x=1", "exemple.com#a", "\nexample.com",
    ]) {
      expect(domaineValide(d), d).toBe(false);
    }
  });

  it("refuse ce qui n'est pas une chaîne, et ce qui est démesuré", () => {
    expect(domaineValide(null)).toBe(false);
    expect(domaineValide(42 as any)).toBe(false);
    expect(domaineValide("a".repeat(250) + ".com")).toBe(false);
  });
});

describe("le réglage commande tout", () => {
  it("éteint quand il est absent", async () => {
    settingFindUnique.mockResolvedValue(null);
    expect(await logosActifs()).toBe(false);
  });

  it("éteint tant qu'il ne vaut pas exactement vrai", async () => {
    for (const value of [false, "true", 1, null]) {
      settingFindUnique.mockResolvedValue({ key: CLE_REGLAGE, value });
      expect(await logosActifs()).toBe(false);
    }
  });

  it("allumé quand il vaut vrai", async () => {
    settingFindUnique.mockResolvedValue({ key: CLE_REGLAGE, value: true });
    expect(await logosActifs()).toBe(true);
  });

  it("éteint si la base ne répond pas — on ne sort pas par accident", async () => {
    settingFindUnique.mockRejectedValue(new Error("base absente"));
    expect(await logosActifs()).toBe(false);
  });
});

describe("récupération", () => {
  it("s'arrête au premier fournisseur qui rend une image", async () => {
    poserFetch(() => reponse());
    const r = await logoDe("example.com");
    expect(r?.type).toBe("image/png");
    expect(appels.length).toBe(1);
  });

  it("passe au suivant quand un fournisseur refuse, et les essaie tous", async () => {
    poserFetch((u) => (u.includes("duckduckgo") ? reponse({ ok: false }) : reponse()));
    const r = await logoDe("example.com");
    expect(r).not.toBeNull();
    expect(appels.length).toBe(2);
    expect(appels[0]).toContain("duckduckgo");
  });

  it("refuse une réponse qui n'est pas une image", async () => {
    poserFetch(() => reponse({ type: "text/html" }));
    expect(await logoDe("example.com")).toBeNull();
    // Les quatre fournisseurs ont été essayés avant d'abandonner.
    expect(appels.length).toBe(4);
  });

  it("refuse une image vide ou démesurée", async () => {
    poserFetch(() => reponse({ corps: Buffer.alloc(0) }));
    expect(await logoDe("vide.example.com")).toBeNull();
    viderCache(); appels = [];
    poserFetch(() => reponse({ corps: Buffer.alloc(300 * 1024) }));
    expect(await logoDe("gros.example.com")).toBeNull();
  });

  it("survit à un fournisseur qui tombe", async () => {
    poserFetch((u) => (u.includes("duckduckgo") ? new Error("réseau") : reponse()));
    expect(await logoDe("example.com")).not.toBeNull();
  });
});

describe("cache", () => {
  it("ne ressort pas une seconde fois pour un domaine déjà trouvé", async () => {
    poserFetch(() => reponse());
    await logoDe("example.com");
    await logoDe("example.com");
    expect(appels.length).toBe(1);
  });

  it("ne ressort pas non plus pour un domaine sans logo", async () => {
    poserFetch(() => reponse({ ok: false }));
    expect(await logoDe("rien.example.com")).toBeNull();
    const apresPremier = appels.length;
    expect(await logoDe("rien.example.com")).toBeNull();
    expect(appels.length).toBe(apresPremier);
  });

  it("redemande une fois l'entrée périmée", async () => {
    poserFetch(() => reponse());
    const t0 = 1_000_000_000_000;
    await logoDe("example.com", t0);
    await logoDe("example.com", t0 + 31 * 24 * 3600 * 1000);
    expect(appels.length).toBe(2);
  });

  it("ne grandit pas sans fin", async () => {
    poserFetch(() => reponse());
    for (let i = 0; i < 2100; i++) await logoDe(`h${i}.example.com`);
    // Le premier domaine a été évincé : il faut ressortir pour lui.
    const avant = appels.length;
    await logoDe("h0.example.com");
    expect(appels.length).toBe(avant + 1);
  });
});
