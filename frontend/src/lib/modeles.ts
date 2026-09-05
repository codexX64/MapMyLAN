// Reconnaissance du matériel par son modèle.
//
// Pourquoi ce fichier
// -------------------
// Le type d'un appareil vient du classifieur : il dit « serveur », « borne »,
// « inconnu ». C'est suffisant pour un tableau, pas pour une carte — sur un
// schéma, on reconnaît un matériel à sa silhouette avant de lire son nom, et
// deux « serveurs » peuvent être un châssis de baie et une carte nue.
//
// Or le relevé rapporte déjà deux indices que le classifieur n'exploite pas :
// le constructeur (déduit de l'OUI de la MAC) et le modèle (bannière SNMP,
// mDNS, UPnP, en-tête HTTP). Ce module s'en sert pour choisir la silhouette la
// plus proche du matériel réel.
//
// Ce qu'il ne fait PAS
// --------------------
// Il ne dessine aucune marque et n'embarque aucune image de constructeur : le
// dépôt est public et sous licence MIT, les visuels produits par Ubiquiti,
// Dell ou Cisco ne le sont pas. Ce qu'il choisit, ce sont les silhouettes
// originales de `DeviceArt`. Pour aller plus loin — la photo exacte d'un
// PowerEdge R730 sur sa vignette — il faut une image fournie par
// l'exploitant sur son installation, ce que fait déjà la photo d'appareil.
//
// Enfin, c'est une heuristique : elle affine une supposition, elle ne prétend
// pas identifier. En cas de doute, elle rend la main au type.

/** Un motif reconnu → la famille de dessin de `DeviceArt`.
 *
 *  `exige` sert aux références nues, celles qui ne portent pas de marque : un
 *  « R730 » est un châssis Dell, mais un « T480 » est un portable Lenovo. La
 *  référence seule ne suffit donc pas, il faut le constructeur avec. */
interface Regle { motif: RegExp; famille: string; exige?: RegExp }

// L'ordre compte : le premier motif qui correspond gagne. Les modèles précis
// passent donc avant les mots génériques.
const REGLES: Regle[] = [
  // ── Châssis de baie ──────────────────────────────────────────────────
  { motif: /\b(poweredge|proliant|thinksystem|primergy|ucs[cb]?|supermicro|superserver)\b/, famille: "serveur" },
  { motif: /\br\d{3}(xd|xs)?\b/, famille: "serveur", exige: /\b(dell|emc)\b/ },
  { motif: /\b(dl|ml)\d{2,3}\b/, famille: "serveur", exige: /\b(hp|hpe|compaq)\b/ },
  { motif: /\bsr\d{3}\b/, famille: "serveur", exige: /\b(lenovo|ibm)\b/ },
  // ── Stockage en réseau ───────────────────────────────────────────────
  { motif: /\b(synology|qnap|asustor|terramaster|truenas|unraid|diskstation|rackstation)\b/, famille: "serveur" },
  // Un hyperviseur se présente par son produit, pas par son châssis : c'est
  // pourtant bien une machine de baie qu'on a en face.
  { motif: /\b(proxmox|pve|esxi|vsphere|xcp-?ng|hyper-?v|xenserver)\b/, famille: "serveur" },
  { motif: /\bds\d{3,4}\b|\brs\d{3,4}\b|\bts-\d{3,4}\b/, famille: "serveur" },
  // ── Cartes nues ──────────────────────────────────────────────────────
  { motif: /\b(raspberry|rpi|orange ?pi|rock ?pi|banana ?pi|odroid|jetson|beaglebone)\b/, famille: "carte" },
  { motif: /\b(esp32|esp8266|arduino|micro:?bit)\b/, famille: "carte" },
  // ── Commutateurs ─────────────────────────────────────────────────────
  { motif: /\b(catalyst|nexus|procurve|aruba ?\d{4}|powerconnect|dgs-|gs\d{3}|tl-sg|usw|switch\d*)\b/, famille: "commutateur" },
  { motif: /\bcommutateur\b|\bpoe switch\b/, famille: "commutateur" },
  // ── Bornes sans fil ──────────────────────────────────────────────────
  { motif: /\b(uap|u6[- ]?\w*|nanohd|flexhd|unifi ?ap|iap-\d|deco|velop|eero|access ?point)\b/, famille: "borne" },
  { motif: /\bborne\b|\bpoint d'acc[eè]s\b/, famille: "borne" },
  // ── Passerelles, routeurs, pare-feu ──────────────────────────────────
  { motif: /\b(udm|usg|edgerouter|edgemax|mikrotik|rb\d{3,4}|hex|pfsense|opnsense|fortigate|sophos|watchguard)\b/, famille: "routeur" },
  { motif: /\b(fritz!?box|livebox|freebox|bbox|sagemcom|technicolor|archer|deco ?x|nighthawk)\b/, famille: "routeur" },
  { motif: /\brouteur\b|\bgateway\b|\bpasserelle\b|\bfirewall\b|\bpare-feu\b/, famille: "routeur" },
  // ── Caméras ──────────────────────────────────────────────────────────
  { motif: /\b(hikvision|dahua|reolink|foscam|amcrest|annke|axis ?[a-z]?\d{4}|wyze|tapo ?c\d)\b/, famille: "camera" },
  { motif: /\bcam(era)?\b|\bipcam\b|\bnvr\b/, famille: "camera" },
  // ── Imprimantes ──────────────────────────────────────────────────────
  { motif: /\b(laserjet|officejet|deskjet|envy|pixma|imageclass|workforce|ecotank|jetdirect)\b/, famille: "imprimante" },
  { motif: /\b(brother|kyocera|lexmark|ricoh|xerox)\b/, famille: "imprimante" },
  { motif: /\bimprimante\b|\bprinter\b/, famille: "imprimante" },
  // ── Écrans, boîtiers de salon ────────────────────────────────────────
  { motif: /\b(chromecast|apple ?tv|shield ?tv|firetv|fire ?stick|roku|bravia|smart ?tv)\b/, famille: "ecran" },
  { motif: /\b(playstation|ps[45]|xbox|switch ?(oled|lite))\b/, famille: "ecran" },
  // ── Mobiles ──────────────────────────────────────────────────────────
  { motif: /\b(iphone|ipad|galaxy|pixel ?\d|redmi|xiaomi|oneplus|huawei ?p\d|honor)\b/, famille: "mobile" },
  // ── Postes ───────────────────────────────────────────────────────────
  { motif: /\b(macbook|mbp|mba|imac|mac ?mini|mac ?studio|thinkpad|latitude|optiplex|elitebook|probook|inspiron|xps|surface|ideapad|vivobook|zenbook)\b/, famille: "ordinateur" },
  // ── Objets connectés ─────────────────────────────────────────────────
  { motif: /\b(shelly|tasmota|sonoff|tuya|zigbee|z-?wave|hue|nanoleaf|nest|tado|netatmo|withings)\b/, famille: "objet" },
  { motif: /\bprise\b|\bplug\b|\bthermostat\b/, famille: "objet" },
];

export interface IndicesAppareil {
  vendor?: string | null;
  model?: string | null;
  hostname?: string | null;
  os?: string | null;
}

/** Ce que le relevé sait dire du matériel, en une seule chaîne à examiner. */
function phrase(d: IndicesAppareil): string {
  return [d.model, d.vendor, d.hostname, d.os]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    // Les tirets et points d'un nom d'hôte cachent les mots : « poste-r730.lan »
    // doit se lire comme « poste r730 lan ».
    .replace(/[._]+/g, " ")
    .replace(/-(?=[a-z0-9])/g, "-");
}

/**
 * La famille de dessin déduite du modèle, ou `null` quand rien ne correspond —
 * l'appelant garde alors la famille déduite du type, qui reste la référence.
 */
export function familleDuModele(d: IndicesAppareil): string | null {
  const p = phrase(d);
  if (!p.trim()) return null;
  for (const r of REGLES) {
    if (!r.motif.test(p)) continue;
    if (r.exige && !r.exige.test(p)) continue;
    return r.famille;
  }
  return null;
}
