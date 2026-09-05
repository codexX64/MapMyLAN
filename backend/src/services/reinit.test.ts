import { describe, it, expect } from "vitest";
import {
  empreinte, nouveauSecret, lienUtilisable, destinataire, moyensAExiger, exigenceDe,
} from "./reinit";

describe("empreinte du lien", () => {
  it("ne laisse jamais transparaître le secret", () => {
    const s = nouveauSecret();
    const h = empreinte(s);
    expect(h).toHaveLength(64);
    expect(h).not.toContain(s);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  it("est stable et distingue deux secrets", () => {
    expect(empreinte("abc")).toBe(empreinte("abc"));
    expect(empreinte("abc")).not.toBe(empreinte("abd"));
  });

  it("tire des secrets qui ne se répètent pas et passent dans une URL", () => {
    const vus = new Set(Array.from({ length: 200 }, () => nouveauSecret()));
    expect(vus.size).toBe(200);
    for (const s of vus) expect(s).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

describe("un lien ne sert qu'une fois", () => {
  const dans = (min: number) => new Date(Date.now() + min * 60_000);

  it("accepte un lien neuf et encore valide", () => {
    expect(lienUtilisable({ consumed: false, expiresAt: dans(15) })).toBe(true);
  });

  it("refuse un lien absent", () => {
    expect(lienUtilisable(null)).toBe(false);
    expect(lienUtilisable(undefined)).toBe(false);
  });

  it("refuse une demande déjà consommée", () => {
    expect(lienUtilisable({ consumed: true, expiresAt: dans(15) })).toBe(false);
  });

  it("refuse un lien expiré", () => {
    expect(lienUtilisable({ consumed: false, expiresAt: dans(-1) })).toBe(false);
  });

  // Le cas qui compte : rouvrir un lien déjà ouvert ne donne plus rien, même
  // si la preuve demandée derrière avait échoué.
  it("refuse un lien déjà ouvert", () => {
    expect(lienUtilisable({
      consumed: false, expiresAt: dans(15), lienUtiliseLe: new Date(),
    })).toBe(false);
  });
});

describe("destinataire du lien", () => {
  it("prend l'adresse du compte", () => {
    expect(destinataire({ email: "a@exemple.local" })).toBe("a@exemple.local");
  });

  // L'adresse commune ENVOIE, elle ne reçoit pas : la prendre comme repli
  // enverrait les liens de tous les comptes dans la même boîte.
  it("ne retombe sur aucune adresse commune", () => {
    expect(destinataire({ email: null })).toBeNull();
    expect(destinataire({})).toBeNull();
    expect(destinataire({ email: "   " })).toBeNull();
    expect(destinataire(null)).toBeNull();
  });
});

describe("moyens exigés", () => {
  // Le défaut corrigé : Telegram était réclamé même sans être inscrit.
  it("ne demande que ce qui est inscrit", () => {
    expect(moyensAExiger(["trousseau"])).toEqual(["trousseau"]);
    expect(moyensAExiger(["application"])).toEqual(["application"]);
    expect(moyensAExiger([])).toEqual([]);
  });

  it("classe du plus solide au moins solide", () => {
    expect(moyensAExiger(["telegram", "application", "trousseau"]))
      .toEqual(["trousseau", "application", "telegram"]);
  });

  it("ignore un moyen inconnu plutôt que de le proposer", () => {
    expect(moyensAExiger(["sms", "trousseau"])).toEqual(["trousseau"]);
  });
});

describe("combien de preuves", () => {
  const tous = ["trousseau", "application", "telegram"];

  // Se connecter : une seule, la plus solide disponible.
  it("connexion : une preuve, la clé d'accès en priorité", () => {
    expect(exigenceDe("connexion", tous)).toEqual(["trousseau"]);
    expect(exigenceDe("connexion", ["telegram", "application"])).toEqual(["application"]);
    expect(exigenceDe("connexion", ["telegram"])).toEqual(["telegram"]);
  });

  // Réinitialiser : toutes. Il n'y a plus de mot de passe pour compléter.
  it("réinitialisation : toutes les preuves inscrites", () => {
    expect(exigenceDe("reinit", tous)).toEqual(["trousseau", "application", "telegram"]);
    expect(exigenceDe("reinit", ["telegram", "trousseau"])).toEqual(["trousseau", "telegram"]);
  });

  it("réinitialisation avec un seul moyen : ce moyen", () => {
    expect(exigenceDe("reinit", ["trousseau"])).toEqual(["trousseau"]);
  });

  it("aucun moyen inscrit : rien à exiger, donc rien à ouvrir", () => {
    expect(exigenceDe("reinit", [])).toEqual([]);
    expect(exigenceDe("connexion", [])).toEqual([]);
  });
});
