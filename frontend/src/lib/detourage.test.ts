// Ce que prouve cette suite : le plafond de dimensions, avant toute allocation.
//
// Un PNG de quelques kilo-octets peut déclarer 30000×30000 pixels. Le canvas
// réserve alors quatre octets par pixel — plusieurs gigaoctets — et l'onglet
// gèle avant qu'aucune de nos lignes ne s'exécute. Le contrôle doit donc venir
// en premier, et c'est ce qui est vérifié ici : l'image refusée ne crée jamais
// de canvas.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { detourer } from "./detourage";

/** Image dont on choisit les dimensions déclarées. */
function fausseImage(largeur: number, hauteur: number) {
  return { naturalWidth: largeur, naturalHeight: hauteur, width: largeur, height: hauteur };
}

let canvasCrees = 0;

beforeEach(() => {
  canvasCrees = 0;
  // `chargerImage` passe par `new Image()` puis attend `onload`.
  vi.stubGlobal("Image", class {
    naturalWidth = 0; naturalHeight = 0; width = 0; height = 0;
    crossOrigin = ""; onload: any = null; onerror: any = null;
    #src = "";
    set src(v: string) {
      this.#src = v;
      const [l, h] = v.split("x").map(Number);
      Object.assign(this, fausseImage(l || 0, h || 0));
      queueMicrotask(() => this.onload?.());
    }
    get src() { return this.#src; }
  });
  vi.stubGlobal("document", {
    createElement: () => {
      canvasCrees++;
      return {
        width: 0, height: 0,
        getContext: () => ({
          drawImage: () => {},
          getImageData: (_x: number, _y: number, w: number, h: number) =>
            ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
          putImageData: () => {},
        }),
        toDataURL: () => "data:image/png;base64,",
      };
    },
  });
});

describe("plafond de dimensions", () => {
  it("refuse un côté démesuré sans rien allouer", async () => {
    await expect(detourer("30000x100" as any)).rejects.toThrow(/trop grande/i);
    expect(canvasCrees).toBe(0);
  });

  it("refuse un nombre de pixels démesuré sans rien allouer", async () => {
    // 9000 × 9000 = 81 Mpx : chaque côté passe, le produit non.
    await expect(detourer("9000x9000" as any)).rejects.toThrow(/trop grande/i);
    expect(canvasCrees).toBe(0);
  });

  it("nomme la limite dans le message, pour qu'elle soit actionnable", async () => {
    await expect(detourer("30000x100" as any)).rejects.toThrow(/10000 px par côté/);
    await expect(detourer("30000x100" as any)).rejects.toThrow(/40 Mpx/);
  });

  it("refuse une image sans dimensions lisibles", async () => {
    await expect(detourer("0x0" as any)).rejects.toThrow(/illisible/i);
    expect(canvasCrees).toBe(0);
  });

  it("laisse passer une image de taille ordinaire", async () => {
    await expect(detourer("800x600" as any)).resolves.toBeTruthy();
    expect(canvasCrees).toBeGreaterThan(0);
  });
});
