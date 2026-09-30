// Motifs et morceaux de schémas partagés par les routes.
export const IPV4 = /^(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/;
export const MAC = /^(?:[0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}$/;
export const CIDR = /^(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\/(?:[0-9]|[12]\d|3[0-2])$/;
export const ID = /^[A-Za-z0-9_-]{6,80}$/;
export const COULEUR = /^#[0-9a-fA-F]{6}$/;
export const HOTE = /^(?!-)[A-Za-z0-9.-]{1,253}$/;
// Ceux que le classement produit, plus ceux que la 1.4.1 proposait à la main :
// « vm » et « container » à l'ajout, « computer » et « sensor » dans la fiche.
// Une reprise de la 1.4.1 en garde donc qui doivent rester enregistrables.
export const TYPES_APPAREIL = ['router', 'firewall', 'switch', 'ap', 'server', 'nas', 'hypervisor', 'docker', 'vm', 'container', 'pc', 'computer', 'laptop', 'phone', 'tablet', 'printer', 'camera', 'tv', 'console', 'pi', 'iot', 'sensor', 'voip', 'unknown'];

export const nom = (max = 80, requis = false) => ({ type: 'chaine', max, ...(requis ? { requis, min: 1 } : {}) });
export const texte = (max = 4000) => ({ type: 'chaine', max });
export const coordonnee = { type: 'nombre', min: -1e6, max: 1e6 };
export const vide = {};
