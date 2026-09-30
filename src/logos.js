// Logos des destinations du trafic, servis depuis notre propre origine.
//
// Le navigateur ne va chercher aucune image chez un tiers : il annoncerait à
// ce tiers chaque domaine que le réseau contacte, et la politique de contenu
// l'interdit. Le serveur les récupère, les garde et les sert. Il sort donc,
// et c'est un choix : le réglage world.logos est éteint par défaut.
export const domaineValide = d => typeof d === 'string' && d.length >= 4 && d.length <= 253 && /^(?!-)[a-z0-9-]{1,63}(?:\.(?!-)[a-z0-9-]{1,63})+$/.test(d);

// Les fournisseurs, essayés dans l'ordre ; le domaine est validé avant d'entrer dans l'adresse.
export const SOURCES = [
  d => `https://icons.duckduckgo.com/ip3/${d}.ico`,
  d => `https://www.google.com/s2/favicons?domain=${d}&sz=64`,
  d => `https://unavatar.io/${d}?fallback=false`,
  d => `https://logo.clearbit.com/${d}`,
];
// Images matricielles seulement : un SVG peut porter du script.
const TYPES = new Set(['image/png', 'image/x-icon', 'image/vnd.microsoft.icon', 'image/jpeg', 'image/gif', 'image/webp']);
const TAILLE_MAX = 256 * 1024;
const DUREE_TROUVE = 30 * 86400e3, DUREE_ABSENT = 86400e3;
const ENTREES_MAX = 2000;

export class Logos {
  constructor({ sortie, reglages }) { this.sortie = sortie; this.reglages = reglages; this.cache = new Map(); }

  actifs() { try { return this.reglages.lire('world.logos') === true; } catch { return false; } }

  ranger(domaine, entree) {
    if (this.cache.size >= ENTREES_MAX) this.cache.delete(this.cache.keys().next().value);
    this.cache.set(domaine, entree);
  }

  async telecharger(url) {
    try {
      const r = await this.sortie.sortir(url, { headers: { accept: 'image/*' } }, { confiance: 'publique', taille: TAILLE_MAX, delai: 4000 });
      const type = (r.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
      // Une page d'erreur en HTML ne doit pas finir servie comme image.
      if (!r.ok || !TYPES.has(type)) { await r.body?.cancel(); return null; }
      const corps = Buffer.from(await r.arrayBuffer());
      return corps.length ? { type, corps } : null;
    } catch { return null; }
  }

  // Déjà cherché, logo trouvé ou non : servi sans sortir.
  connu(domaine, maintenant = Date.now()) { return (this.cache.get(domaine)?.expire || 0) > maintenant; }

  // null : pas de logo, l'interface affiche sa pastille. Ce résultat est gardé
  // aussi, sinon chaque affichage relancerait quatre requêtes.
  async logo(domaine, maintenant = Date.now()) {
    const garde = this.cache.get(domaine);
    if (garde && garde.expire > maintenant) return garde.type ? { type: garde.type, corps: garde.corps } : null;
    for (const source of SOURCES) {
      const trouve = await this.telecharger(source(domaine));
      if (trouve) { this.ranger(domaine, { ...trouve, expire: maintenant + DUREE_TROUVE }); return trouve; }
    }
    this.ranger(domaine, { type: null, expire: maintenant + DUREE_ABSENT });
    return null;
  }
}
