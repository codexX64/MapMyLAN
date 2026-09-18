import { describe, it, expect } from "vitest";
import { analyserRdap, enEntier, dansLePrefixe } from "./registre";

describe("les bornes d'un préfixe", () => {
  it("convertit une adresse en entier", () => {
    expect(enEntier("0.0.0.0")).toBe(0);
    expect(enEntier("1.2.3.4")).toBe(16909060);
    expect(enEntier("255.255.255.255")).toBe(4294967295);
  });

  it("refuse ce qui n'est pas une adresse v4", () => {
    expect(enEntier("2001:db8::1")).toBeUndefined();
    expect(enEntier("1.2.3")).toBeUndefined();
    expect(enEntier("1.2.3.999")).toBeUndefined();
  });

  it("dit si une adresse tombe dans le bloc décrit", () => {
    const f = { ip: "203.0.113.1", debut: enEntier("203.0.113.0")!, fin: enEntier("203.0.113.255")! };
    expect(dansLePrefixe(f, "203.0.113.200")).toBe(true);
    expect(dansLePrefixe(f, "203.0.114.1")).toBe(false);
    expect(dansLePrefixe(f, "202.0.113.1")).toBe(false);
  });

  // Sans bornes, aucune adresse ne tombe dedans : une fiche sans préfixe ne
  // doit jamais servir à nommer une autre adresse.
  it("ne prétend rien sans bornes", () => {
    expect(dansLePrefixe({ ip: "203.0.113.1" }, "203.0.113.1")).toBe(false);
  });
});

describe("la lecture d'une fiche RDAP", () => {
  // Forme réelle d'une réponse : bornes du bloc, nom du réseau, titulaire dans
  // les entités, pays dans l'adresse postale.
  const reponse = {
    startAddress: "198.51.100.0",
    endAddress: "198.51.100.255",
    name: "EXEMPLE-NET",
    entities: [{
      roles: ["registrant"],
      vcardArray: ["vcard", [
        ["version", {}, "text", "4.0"],
        ["fn", {}, "text", "Exemple Hébergement SAS"],
        ["adr", { label: "1 rue de l'Exemple\nParis\nFrance" }, "text", ["", "", "", "", "", "", "France"]],
        ["email", {}, "text", "abuse@exemple.fr"],
      ]],
    }],
  };

  it("retient les bornes du bloc", () => {
    const f = analyserRdap(reponse, "198.51.100.10");
    expect(f.debut).toBe(enEntier("198.51.100.0"));
    expect(f.fin).toBe(enEntier("198.51.100.255"));
    expect(dansLePrefixe(f, "198.51.100.200")).toBe(true);
  });

  it("lit le titulaire, le pays et le domaine inscrit", () => {
    const f = analyserRdap(reponse, "198.51.100.10");
    expect(f.reseau).toBe("EXEMPLE-NET");
    expect(f.organisation).toBe("Exemple Hébergement SAS");
    expect(f.pays).toBe("FR");
    // Le domaine vient de l'adresse de contact inscrite au registre, jamais
    // d'une transformation du nom de l'organisation.
    expect(f.domaine).toBe("exemple.fr");
  });

  it("ne fabrique pas de bornes quand le registre n'en donne pas", () => {
    const f = analyserRdap({ name: "SANS-BORNES" }, "198.51.100.10");
    expect(f.debut).toBeUndefined();
    expect(f.fin).toBeUndefined();
  });
});
