// Détourage automatique des photos d'appareils.
//
// Les photos que l'on récupère pour un routeur ou un commutateur viennent
// presque toujours d'une fiche constructeur : fond uni, blanc ou très clair.
// Un remplissage par diffusion depuis les quatre coins suffit alors, et évite
// d'embarquer un modèle de segmentation de plusieurs dizaines de mégaoctets
// pour un cas aussi simple.
//
// Rien n'est envoyé ailleurs : tout se passe dans le navigateur, sur un canevas.
// Une image déjà détourée est reconnue et laissée telle quelle.

export interface OptionsDetourage {
  /** Écart couleur toléré autour du fond, 0–150. Plus haut = plus agressif. */
  tolerance?: number;
  /** Adoucit le bord sur n pixels pour éviter l'effet découpé au cutter. */
  adoucissement?: number;
  /** Recadre sur le contenu une fois le fond retiré. */
  recadrer?: boolean;
  /** Marge conservée autour du contenu, en pixels. */
  marge?: number;
}

export interface ResultatDetourage {
  /** PNG détouré, en data-URI. */
  dataUrl: string;
  largeur: number;
  hauteur: number;
  /** Part de l'image devenue transparente, 0–1. */
  retire: number;
  /** Vrai si l'image arrivait déjà détourée : on n'a rien touché. */
  dejaDetouree: boolean;
}

/** L'image porte-t-elle déjà de la transparence utile ? */
function possedeTransparence(data: Uint8ClampedArray): boolean {
  let transparents = 0;
  // On échantillonne : inutile de parcourir des millions de pixels.
  for (let i = 3; i < data.length; i += 4 * 17) {
    if (data[i] < 250) transparents++;
  }
  const echantillons = Math.ceil(data.length / (4 * 17));
  return transparents / echantillons > 0.04;
}

/** Distance perceptuelle grossière entre deux couleurs. */
function ecart(
  r1: number, g1: number, b1: number,
  r2: number, g2: number, b2: number,
): number {
  // Pondération proche de la sensibilité de l'œil : le vert compte double.
  const dr = r1 - r2, dg = g1 - g2, db = b1 - b2;
  return Math.sqrt(dr * dr * 0.9 + dg * dg * 1.6 + db * db * 0.5);
}

/**
 * Retire le fond d'une image.
 *
 * L'algorithme part des quatre coins et propage de proche en proche tant que
 * la couleur reste proche de celle du fond. Contrairement à un simple seuil
 * global, cela préserve les zones claires *à l'intérieur* de l'appareil —
 * une façade blanche de routeur ne disparaît pas.
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
  if (!W || !H) throw new Error("Image illisible.");

  const cv = document.createElement("canvas");
  cv.width = W; cv.height = H;
  const ctx = cv.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0);

  const imageData = ctx.getImageData(0, 0, W, H);
  const px = imageData.data;

  if (possedeTransparence(px)) {
    // Déjà détourée : on se contente éventuellement de recadrer.
    const sortie = recadrer ? recadrerSurContenu(ctx, cv, marge) : cv;
    return {
      dataUrl: sortie.toDataURL("image/png"),
      largeur: sortie.width, hauteur: sortie.height,
      retire: 0, dejaDetouree: true,
    };
  }

  // Couleur de fond : médiane des quatre coins, pour résister à un pixel isolé.
  const coins = [
    lire(px, W, 0, 0), lire(px, W, W - 1, 0),
    lire(px, W, 0, H - 1), lire(px, W, W - 1, H - 1),
  ];
  const fond = medianeCouleur(coins);

  // Diffusion depuis les bords. On empile les positions plutôt que d'employer
  // la récursion : une image de plusieurs mégapixels ferait déborder la pile.
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
 * Adoucit la frontière entre le sujet et le vide.
 *
 * Sans cela, le contour est net au pixel près et l'appareil paraît découpé aux
 * ciseaux. On dégrade l'opacité des pixels conservés situés au voisinage d'un
 * pixel effacé, proportionnellement au nombre de voisins transparents.
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
      if (original[idx]) continue;          // déjà transparent

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

/** Recadre le canevas sur la zone non transparente. */
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
  // Image entièrement effacée : on rend l'originale plutôt qu'un canevas vide.
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
    img.onerror = () => rejeter(new Error("Impossible de charger l'image."));
    img.src = typeof source === "string" ? source : URL.createObjectURL(source);
  });
}

/**
 * Réduit une image détourée à une vignette carrée, prête à stocker.
 * Le sujet est centré et conserve ses proportions.
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
