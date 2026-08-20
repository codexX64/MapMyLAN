// Automatic background removal for device photos.
//
// The photos we fetch for a router or a switch almost always come from a
// manufacturer datasheet: solid background, white or very light. A flood fill
// from the four corners is then enough, and avoids bundling a segmentation
// model of several dozen megabytes for such a simple case.
//
// Nothing is sent anywhere: everything happens in the browser, on a canvas. An
// already-cut-out image is recognized and left as is.

export interface OptionsDetourage {
  /** Color spread tolerated around the background, 0–150. Higher = more aggressive. */
  tolerance?: number;
  /** Softens the edge over n pixels to avoid the cut-with-a-cutter look. */
  adoucissement?: number;
  /** Crops to the content once the background is removed. */
  recadrer?: boolean;
  /** Margin kept around the content, in pixels. */
  marge?: number;
}

export interface ResultatDetourage {
  /** Cut-out PNG, as a data URI. */
  dataUrl: string;
  largeur: number;
  hauteur: number;
  /** Share of the image that became transparent, 0–1. */
  retire: number;
  /** True if the image arrived already cut out: we touched nothing. */
  dejaDetouree: boolean;
}

/** Does the image already carry meaningful transparency? */
function possedeTransparence(data: Uint8ClampedArray): boolean {
  let transparents = 0;
  // We sample: no need to walk through millions of pixels.
  for (let i = 3; i < data.length; i += 4 * 17) {
    if (data[i] < 250) transparents++;
  }
  const echantillons = Math.ceil(data.length / (4 * 17));
  return transparents / echantillons > 0.04;
}

/** Rough perceptual distance between two colors. */
function ecart(
  r1: number, g1: number, b1: number,
  r2: number, g2: number, b2: number,
): number {
  // Weighting close to the eye's sensitivity: green counts double.
  const dr = r1 - r2, dg = g1 - g2, db = b1 - b2;
  return Math.sqrt(dr * dr * 0.9 + dg * dg * 1.6 + db * db * 0.5);
}

/**
 * Removes the background of an image.
 *
 * The algorithm starts from the four corners and propagates step by step as
 * long as the color stays close to that of the background. Unlike a simple
 * global threshold, this preserves the light areas *inside* the device — a
 * white router front panel does not disappear.
 */
export async function detourer(
  source: string | Blob,
  opts: OptionsDetourage = {},
): Promise<ResultatDetourage> {
  const tolerance = opts.tolerance ?? 34;
  const adoucissement = opts.adoucissement ?? 1.4;
  const recadrer = opts.recadrer !== false;
  const marge = opts.marge ?? 10;

  const img = await chargerImage(source);
  const W = img.naturalWidth || img.width;
  const H = img.naturalHeight || img.height;
  if (!W || !H) throw new Error("Unreadable image.");

  // Guard against a "decompression bomb": a PNG of a few kilobytes can declare
  // 30000×30000 pixels and reserve several gigabytes for the canvas/ImageData
  // allocation, freezing the tab. DevicePhoto's byte limit doesn't catch this
  // case (the compressed file is tiny). So we bound the dimensions themselves.
  const COTE_MAX = 10000;              // 10,000 px per side
  const PIXELS_MAX = 40 * 1000 * 1000; // 40 megapixels
  if (W > COTE_MAX || H > COTE_MAX || W * H > PIXELS_MAX) {
    throw new Error(`Image too large (${W}×${H}). Maximum ${COTE_MAX} px per side, ${PIXELS_MAX / 1_000_000} Mpx.`);
  }

  const cv = document.createElement("canvas");
  cv.width = W; cv.height = H;
  const ctx = cv.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0);

  const imageData = ctx.getImageData(0, 0, W, H);
  const px = imageData.data;

  if (possedeTransparence(px)) {
    // Already cut out: we just crop, at most.
    const sortie = recadrer ? recadrerSurContenu(ctx, cv, marge) : cv;
    return {
      dataUrl: sortie.toDataURL("image/png"),
      largeur: sortie.width, hauteur: sortie.height,
      retire: 0, dejaDetouree: true,
    };
  }

  // Background color: median of the four corners, to withstand a stray pixel.
  const coins = [
    lire(px, W, 0, 0), lire(px, W, W - 1, 0),
    lire(px, W, 0, H - 1), lire(px, W, W - 1, H - 1),
  ];
  const fond = medianeCouleur(coins);

  // Flood fill from the edges. We push positions onto a stack rather than use
  // recursion: an image of several megapixels would overflow the call stack.
  const vu = new Uint8Array(W * H);
  const pile: number[] = [];
  for (let x = 0; x < W; x++) { pile.push(x, 0); pile.push(x, H - 1); }
  for (let y = 0; y < H; y++) { pile.push(0, y); pile.push(W - 1, y); }

  let retires = 0;
  while (pile.length) {
    const y = pile.pop()!, x = pile.pop()!;
    if (x < 0 || y < 0 || x >= W || y >= H) continue;
    const idx = y * W + x;
    if (vu[idx]) continue;

    const o = idx * 4;
    if (ecart(px[o], px[o + 1], px[o + 2], fond[0], fond[1], fond[2]) > tolerance) continue;

    vu[idx] = 1;
    px[o + 3] = 0;
    retires++;

    pile.push(x + 1, y); pile.push(x - 1, y);
    pile.push(x, y + 1); pile.push(x, y - 1);
  }

  adoucirBord(px, vu, W, H, adoucissement);
  ctx.putImageData(imageData, 0, 0);

  const sortie = recadrer ? recadrerSurContenu(ctx, cv, marge) : cv;
  return {
    dataUrl: sortie.toDataURL("image/png"),
    largeur: sortie.width, hauteur: sortie.height,
    retire: retires / (W * H),
    dejaDetouree: false,
  };
}

function lire(px: Uint8ClampedArray, W: number, x: number, y: number): [number, number, number] {
  const o = (y * W + x) * 4;
  return [px[o], px[o + 1], px[o + 2]];
}

function medianeCouleur(couleurs: [number, number, number][]): [number, number, number] {
  const med = (i: number) => {
    const v = couleurs.map(c => c[i]).sort((a, b) => a - b);
    return v[Math.floor(v.length / 2)];
  };
  return [med(0), med(1), med(2)];
}

/**
 * Softens the boundary between the subject and the void.
 *
 * Without this, the outline is sharp to the pixel and the device looks cut out
 * with scissors. We lower the opacity of the kept pixels that sit near an
 * erased pixel, proportionally to the number of transparent neighbors.
 */
function adoucirBord(
  px: Uint8ClampedArray, vu: Uint8Array,
  W: number, H: number, rayon: number,
): void {
  if (rayon <= 0) return;
  const r = Math.max(1, Math.round(rayon));
  const original = new Uint8Array(vu);

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const idx = y * W + x;
      if (original[idx]) continue;          // already transparent

      let vides = 0, total = 0;
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          total++;
          if (original[ny * W + nx]) vides++;
        }
      }
      if (!vides) continue;
      const part = vides / total;
      px[idx * 4 + 3] = Math.round(255 * (1 - Math.min(1, part * 1.35)));
    }
  }
}

/** Crops the canvas to the non-transparent area. */
function recadrerSurContenu(
  ctx: CanvasRenderingContext2D,
  cv: HTMLCanvasElement,
  marge: number,
): HTMLCanvasElement {
  const W = cv.width, H = cv.height;
  const px = ctx.getImageData(0, 0, W, H).data;

  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (px[(y * W + x) * 4 + 3] > 12) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  // Fully erased image: we return the original rather than an empty canvas.
  if (x1 < 0) return cv;

  x0 = Math.max(0, x0 - marge); y0 = Math.max(0, y0 - marge);
  x1 = Math.min(W - 1, x1 + marge); y1 = Math.min(H - 1, y1 + marge);

  const w = x1 - x0 + 1, h = y1 - y0 + 1;
  const out = document.createElement("canvas");
  out.width = w; out.height = h;
  out.getContext("2d")!.drawImage(cv, x0, y0, w, h, 0, 0, w, h);
  return out;
}

function chargerImage(source: string | Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, rejeter) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => rejeter(new Error("Could not load the image."));
    img.src = typeof source === "string" ? source : URL.createObjectURL(source);
  });
}

/**
 * Reduces a cut-out image to a square thumbnail, ready to store.
 * The subject is centered and keeps its proportions.
 */
export async function vignette(dataUrl: string, cote = 256): Promise<string> {
  const img = await chargerImage(dataUrl);
  const cv = document.createElement("canvas");
  cv.width = cote; cv.height = cote;
  const ctx = cv.getContext("2d")!;
  const e = Math.min(cote / img.width, cote / img.height);
  const w = img.width * e, h = img.height * e;
  ctx.drawImage(img, (cote - w) / 2, (cote - h) / 2, w, h);
  return cv.toDataURL("image/png");
}
