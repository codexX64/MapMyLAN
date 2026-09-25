// Les pictos du panneau : le jeu au trait commun au Hub et à MapMyLAN, en
// chaînes SVG (le panneau se dessine hors de React, comme celui du Hub).

const P: Record<string, string> = {
  sparkle: "<path d=\"M12 3.5c.6 3.8 2.2 5.4 6 6-3.8.6-5.4 2.2-6 6-.6-3.8-2.2-5.4-6-6 3.8-.6 5.4-2.2 6-6z\"/><path d=\"M18.5 15.5c.3 1.7 1 2.4 2.5 2.7-1.5.3-2.2 1-2.5 2.7-.3-1.7-1-2.4-2.5-2.7 1.5-.3 2.2-1 2.5-2.7z\"/>",
  mic: "<rect x=\"9\" y=\"3.5\" width=\"6\" height=\"10.5\" rx=\"3\"/><path d=\"M5.8 11.5a6.2 6.2 0 0 0 12.4 0M12 17.7v2.8\"/>",
  plus: "<path d=\"M12 5.5v13M5.5 12h13\"/>",
  x: "<path d=\"M6 6l12 12M18 6 6 18\"/>",
  arrow: "<path d=\"M5 12h14M13 6l6 6-6 6\"/>",
  play: "<path d=\"M8 5.5v13l10-6.5z\"/>",
  check: "<path d=\"M4.5 12.5 9.5 17.5 19.5 7\"/>",
  minus: "<path d=\"M5.5 12h13\"/>",
  fit: "<path d=\"M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5\"/>",
  server: "<rect x=\"3.5\" y=\"4.5\" width=\"17\" height=\"6\" rx=\"1.8\"/><rect x=\"3.5\" y=\"13.5\" width=\"17\" height=\"6\" rx=\"1.8\"/><path d=\"M7 7.5h.01M7 16.5h.01M16 7.5h2M16 16.5h2\"/>",
  refresh: "<path d=\"M20 11.4a8.2 8.2 0 1 0-1.9 6.2\"/><path d=\"M20.5 5v5h-5\"/>",
};

export const I = (n: string, s = 16): string =>
  `<svg class="i" width="${s}" height="${s}" viewBox="0 0 24 24" aria-hidden="true">${P[n] || P.sparkle}</svg>`;
