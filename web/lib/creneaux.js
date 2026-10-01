// Créneaux du graphe « Appareils vus », calculés sans le DOM : ce module se
// vérifie seul (test/interface.test.js).
const HEURE = 3_600_000;
export const PERIODES = {
  '24h': { heures: 24, creneaux: 24, pas: HEURE },
  '7d': { heures: 168, creneaux: 28, pas: 6 * HEURE },
  '30d': { heures: 720, creneaux: 30, pas: 24 * HEURE },
};

// Créneaux d'une période, chacun avec les appareils vus (somme, plage par
// plage, du plus grand nombre trouvé) et ceux apparus pour la première fois.
export function creneaux(balayages, appareils, periode, maintenant = Date.now()) {
  const { creneaux: n, pas } = PERIODES[periode];
  const debut = maintenant - n * pas;
  const rang = quand => Math.floor((quand - debut) / pas);
  const parPlage = Array.from({ length: n }, () => new Map());
  for (const b of balayages) {
    const i = rang(Date.parse(b.startedAt));
    if (i < 0 || i >= n) continue;
    parPlage[i].set(b.subnet, Math.max(parPlage[i].get(b.subnet) || 0, Number(b.hostsFound) || 0));
  }
  const nouveaux = new Array(n).fill(0);
  for (const d of appareils) {
    const i = rang(Date.parse(d.firstSeen));
    if (i >= 0 && i < n) nouveaux[i]++;
  }
  return parPlage.map((plages, i) => {
    const vus = plages.size ? [...plages.values()].reduce((a, b) => a + b, 0) : null;
    return { debut: debut + i * pas, fin: debut + (i + 1) * pas, vus, nouveaux: nouveaux[i], connus: vus === null ? 0 : Math.max(0, vus - nouveaux[i]) };
  });
}

// Un plafond rond, divisible en quatre graduations entières.
export const plafond = max => Math.max(4, Math.ceil(max / 4) * 4);
