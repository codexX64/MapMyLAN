import { describe, it, expect, vi, beforeEach } from "vitest";
import jwt from "jsonwebtoken";

// La base est remplacée par un double : ces tests portent sur une décision de
// sécurité, pas sur PostgreSQL. `tokenVersion` est ce qu'on fait varier.
const compte = { id: "u1", tokenVersion: 0 };
let trouve: any = compte;
let leve = false;

vi.mock("../db", () => ({
  prisma: {
    user: {
      findUnique: async () => {
        if (leve) throw new Error("base injoignable");
        return trouve;
      },
    },
  },
}));

import { verifierPoigneeDeMain } from "./realtime";
import { config } from "../config";

function jeton(charge: Record<string, unknown>, secret = config.jwtSecret) {
  return jwt.sign(charge, secret, { expiresIn: "12h" });
}

describe("poignée de main du flux temps réel", () => {
  beforeEach(() => { trouve = compte; leve = false; compte.tokenVersion = 0; });

  it("refuse l'absence de jeton", async () => {
    expect(await verifierPoigneeDeMain(undefined)).toBe("No auth token");
    expect(await verifierPoigneeDeMain("")).toBe("No auth token");
  });

  it("refuse une signature étrangère", async () => {
    const faux = jeton({ id: "u1", tv: 0 }, "un-autre-secret-de-32-caracteres-au-moins");
    expect(await verifierPoigneeDeMain(faux)).toBe("Invalid token");
  });

  it("refuse un jeton qui n'est pas un jeton de session", async () => {
    expect(await verifierPoigneeDeMain(jeton({ id: "u1", tv: 0, typ: "reset" }))).toBe("Invalid token");
  });

  it("admet un jeton de session dont la version correspond", async () => {
    expect(await verifierPoigneeDeMain(jeton({ id: "u1", tv: 0, typ: "session" }))).toBeNull();
    expect(await verifierPoigneeDeMain(jeton({ id: "u1", tv: 0 }))).toBeNull();
  });

  // C'est le cas qui manquait : la signature restait valide, et le flux
  // continuait de servir appareils, alertes et journaux après une révocation.
  it("refuse un jeton révoqué par un changement de mot de passe", async () => {
    const avant = jeton({ id: "u1", tv: 0, typ: "session" });
    compte.tokenVersion = 1;                       // le mot de passe a changé
    expect(await verifierPoigneeDeMain(avant)).toBe("Session expiree");
  });

  it("refuse un jeton dont le compte n'existe plus", async () => {
    trouve = null;
    expect(await verifierPoigneeDeMain(jeton({ id: "u1", tv: 0 }))).toBe("Session expiree");
  });

  // Base injoignable : on refuse, on n'ouvre pas « en attendant ».
  it("refuse quand la vérification est impossible", async () => {
    leve = true;
    expect(await verifierPoigneeDeMain(jeton({ id: "u1", tv: 0 }))).toBe("Verification impossible");
  });
});
