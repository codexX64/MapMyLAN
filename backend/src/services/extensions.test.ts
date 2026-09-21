// Ce que prouve cette suite : le chargeur refuse ce qu'il doit refuser, et une
// extension défaillante n'interrompt rien.
//
// Charger un module, c'est exécuter son code avec tous les privilèges du
// backend — identifiants SSH des équipements, actions de blocage. Un fichier
// inscriptible par le groupe ou par tous, un lien symbolique, un fichier qui ne
// nous appartient pas : autant de façons pour un tiers d'obtenir cette
// exécution. Le chargeur refuse plutôt que d'en faire une porte silencieuse.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

let dossier: string;
let journal: { niveau: string; message: string }[];

/** Le module garde un état de chargement : on le recharge à chaque cas. */
async function charger() {
  vi.resetModules();
  const mod = await import("./extensions");
  mod.chargerExtensions((niveau: string, message: string) => journal.push({ niveau, message }));
  return mod.extensions;
}

function poser(nom: string, contenu: string, mode = 0o600) {
  const p = path.join(dossier, nom);
  fs.writeFileSync(p, contenu);
  fs.chmodSync(p, mode);
  return p;
}

beforeEach(() => {
  dossier = fs.mkdtempSync(path.join(os.tmpdir(), "mml-ext-"));
  process.env.EXTENSIONS_DIR = dossier;
  journal = [];
});

afterEach(() => {
  delete process.env.EXTENSIONS_DIR;
  fs.rmSync(dossier, { recursive: true, force: true });
});

describe("chargement", () => {
  it("ne dit rien quand le dossier est vide — c'est le cas ordinaire", async () => {
    const ext = await charger();
    expect(ext.nombre()).toBe(0);
    expect(journal).toEqual([]);
  });

  it("ne dit rien non plus quand le dossier n'existe pas", async () => {
    process.env.EXTENSIONS_DIR = path.join(dossier, "absent");
    const ext = await charger();
    expect(ext.nombre()).toBe(0);
    expect(journal).toEqual([]);
  });

  it("charge un module bien posé", async () => {
    poser("greffe.js", 'module.exports = { nom: "greffe", surAlerte() {} };');
    const ext = await charger();
    expect(ext.nombre()).toBe(1);
    expect(ext.noms()).toEqual(["greffe"]);
    expect(journal.some((l) => l.niveau === "info")).toBe(true);
  });
});

describe("refus", () => {
  it("refuse un fichier inscriptible par le groupe ou par tous", async () => {
    poser("large.js", "module.exports = {};", 0o666);
    const ext = await charger();
    expect(ext.nombre()).toBe(0);
    expect(journal.at(-1)?.niveau).toBe("warn");
    expect(journal.at(-1)?.message).toMatch(/inscriptible/);
  });

  it("refuse un lien symbolique", async () => {
    const cible = path.join(dossier, "_cible.txt");
    fs.writeFileSync(cible, "module.exports = {};");
    fs.symlinkSync(cible, path.join(dossier, "lien.js"));
    const ext = await charger();
    expect(ext.nombre()).toBe(0);
    expect(journal.at(-1)?.message).toMatch(/lien symbolique/);
  });

  it("signale un module qui lève au chargement, sans s'arrêter là", async () => {
    poser("casse.js", 'throw new Error("boum");');
    poser("saine.js", 'module.exports = { nom: "saine" };');
    const ext = await charger();
    expect(ext.nombre()).toBe(1);
    expect(journal.some((l) => l.niveau === "warn" && /casse\.js/.test(l.message))).toBe(true);
  });

  it("ignore ce qui n'est pas un module et ce qui commence par un tiret bas", async () => {
    poser("notes.txt", "rien");
    poser("_brouillon.js", 'module.exports = {};');
    const ext = await charger();
    expect(ext.nombre()).toBe(0);
  });
});

describe("diffusion", () => {
  it("appelle les méthodes présentes et laisse passer les absentes", async () => {
    poser("compteur.js", `
      global.__vus = [];
      module.exports = {
        nom: "compteur",
        surAlerte(a) { global.__vus.push(["alerte", a.id]); },
      };
    `);
    const ext = await charger();
    ext.alerte({ id: "a1" });
    ext.balayage({ hotes: 3 });       // méthode absente : ne doit rien casser
    ext.appareil("device.first_seen", { ip: "192.0.2.5" });
    expect((globalThis as any).__vus).toEqual([["alerte", "a1"]]);
  });

  it("une extension qui échoue n'interrompt pas les autres", async () => {
    poser("a_casse.js", 'module.exports = { nom: "casse", surAlerte() { throw new Error("boum"); } };');
    poser("b_note.js", `
      global.__note = 0;
      module.exports = { nom: "note", surAlerte() { global.__note++; } };
    `);
    const ext = await charger();
    expect(() => ext.alerte({ id: "a1" })).not.toThrow();
    expect((globalThis as any).__note).toBe(1);
  });
});
