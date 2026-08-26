// Couche d'adaptateurs constructeurs.
//
// Un adaptateur sait parler à un équipement réseau par le moyen que cet
// équipement propose : SSH pour la plupart, API HTTP pour UniFi, les deux pour
// certains. Il déclare ce qu'il sait faire, et l'interface grise le reste
// plutôt que de proposer un bouton qui échouera.

export type Capability =
  | "ban"          // bloquer un appareil
  | "unban"        // lever le blocage
  | "quarantine"   // isoler sans couper complètement
  | "clients"      // lister les appareils vus par l'équipement
  | "arp"          // lire la table ARP
  | "leases"       // lire les baux DHCP
  | "ports"        // état des ports physiques
  | "vlans"        // lire et créer des VLAN
  | "reservation"  // réserver une adresse pour une machine (bail fixe)
  | "reboot";      // redémarrer l'équipement

export type Transport = "ssh" | "api";

export interface RouterCreds {
  host: string;
  port: number;
  username: string;
  password?: string;
  privateKey?: string;
  passphrase?: string;
  transport: Transport;
  /** UniFi et consorts : base de l'API, site, tolérance au certificat autosigné */
  apiBaseUrl?: string;
  site?: string;
  verifyTls?: boolean;
}

export interface ExecResult { stdout: string; stderr: string; code: number | null }

export interface AdapterContext {
  creds: RouterCreds;
  /** Disponible uniquement pour les adaptateurs SSH */
  exec: (command: string) => Promise<ExecResult>;
}

export interface ClientEntry {
  mac?: string;
  ip?: string;
  hostname?: string;
  vendor?: string;
  medium?: "wired" | "wireless";
  /** Champ historique : port de commutation, ou MAC de borne à défaut. */
  port?: string | number;
  /** Port physique du commutateur auquel l'appareil est raccordé. */
  swPort?: number;
  /** MAC du commutateur qui porte ce port. */
  swMac?: string;
  /** MAC de la borne Wi-Fi à laquelle l'appareil est associé. */
  apMac?: string;
  /** Réseau sans fil et bande, quand l'appareil est associé. */
  essid?: string;
  radio?: string;
  /** Niveau de signal en dBm. */
  rssi?: number;
  uptimeSec?: number;
  blocked?: boolean;
}

/**
 * Un équipement d'infrastructure rapporté par le contrôleur.
 *
 * C'est une catégorie distincte des clients : un contrôleur UniFi ne range pas
 * sa passerelle, ses commutateurs et ses bornes dans la liste des clients. Ne
 * lire que les clients, c'est ne jamais voir l'UDM ni le commutateur — et donc
 * accrocher tout le parc au premier appareil venu.
 */
export interface InfraEntry {
  mac: string;
  ip?: string;
  name?: string;
  model?: string;
  /** Rôle physique, tel que le contrôleur le déclare. */
  kind: "router" | "switch" | "ap";
  /** MAC de l'équipement amont : c'est lui qui donne la vraie hiérarchie. */
  uplinkMac?: string;
  /** Port de l'équipement amont sur lequel celui-ci est branché. */
  uplinkPort?: number;
  /** Liaison amont filaire, ou sans fil pour une borne en maillage. */
  uplinkMedium?: "wired" | "wireless";
  /** Adresse WAN de la passerelle — informative, ce n'est pas son adresse LAN. */
  wanIp?: string;
  /** Passerelle vue côté WAN : la box de l'opérateur, quand elle est connue. */
  wanGateway?: string;
  version?: string;
  uptimeSec?: number;
}

/**
 * Un réseau déclaré sur l'équipement : un VLAN, son sous-réseau, et l'adresse
 * que la passerelle y porte.
 *
 * Ces adresses-là ne sont pas des machines : c'est la passerelle elle-même, vue
 * depuis chaque VLAN. Les recenser comme des appareils indépendants donne une
 * carte fausse — un « serveur » par VLAN, pendu au hasard.
 */
export interface ReseauEntry {
  nom?: string;
  vlan?: number;
  /** Sous-réseau au format CIDR, tel que déclaré. */
  cidr?: string;
  /** Adresse de la passerelle sur ce réseau. */
  passerelle?: string;
  /** Identifiant du réseau chez le constructeur. C'est lui qu'il faut rendre
   *  pour poser une réservation d'adresse : le contrôleur veut savoir de quel
   *  réseau l'adresse relève, pas seulement laquelle. */
  id?: string;
  /** À quoi sert ce réseau, tel que l'équipement le nomme : « corporate »,
   *  « guest », « wan », « vlan-only »… Un WAN n'est pas un VLAN interne, et
   *  sans cette distinction il viendrait prendre la place du réseau natif. */
  role?: string;
}

/**
 * Une réservation d'adresse.
 *
 * Ce n'est pas « changer l'IP d'une machine » : personne ne peut réécrire
 * l'adresse d'un appareil à distance. On demande à la passerelle de toujours
 * servir la même adresse à cette carte réseau. L'appareil la prendra à son
 * prochain bail.
 */
export interface Reservation {
  mac: string;
  /** Absente : on retire la réservation et l'appareil repasse en dynamique. */
  ip?: string;
  /** Le réseau auquel l'adresse appartient, au sens du constructeur. */
  networkId?: string;
}

export interface TestResult {
  ok: boolean;
  error?: string;
  /** Ce que l'équipement a répondu : bannière SSH, modèle, version */
  info?: string;
  /** Constructeur reconnu à partir de la réponse, s'il diffère du choix manuel */
  detected?: string;
}

export interface Target {
  ip: string;
  mac?: string | null;
  gateway?: string;
}

export interface RouterAdapter {
  id: string;
  label: string;
  transport: Transport | "both";
  capabilities: Capability[];
  /** Champs à demander dans le formulaire, en plus de l'hôte et de l'identifiant */
  needs?: ("password" | "privateKey" | "apiBaseUrl" | "site")[];
  /** Reconnaissance à partir d'une bannière SSH ou d'une réponse HTTP */
  detect?: (probe: string) => boolean;

  test: (ctx: AdapterContext) => Promise<TestResult>;
  ban: (ctx: AdapterContext, target: Target) => Promise<string>;
  unban: (ctx: AdapterContext, target: Target) => Promise<string>;
  quarantine: (ctx: AdapterContext, target: Target) => Promise<string>;
  clients?: (ctx: AdapterContext) => Promise<ClientEntry[]>;
  /** Les équipements du constructeur eux-mêmes : passerelle, commutateurs, bornes. */
  infrastructure?: (ctx: AdapterContext) => Promise<InfraEntry[]>;
  /** Les réseaux déclarés, avec l'adresse que la passerelle y porte. */
  networks?: (ctx: AdapterContext) => Promise<ReseauEntry[]>;
  /** Pose ou retire une réservation d'adresse. Rend ce que l'équipement a dit. */
  reserver?: (ctx: AdapterContext, r: Reservation) => Promise<string>;
  /** Coupe la session d'un client : il refait un bail, donc il prend l'adresse
   *  réservée tout de suite au lieu d'attendre l'expiration du sien. */
  relancerBail?: (ctx: AdapterContext, t: Target) => Promise<string>;
  arp?: (ctx: AdapterContext) => Promise<ClientEntry[]>;
  reboot?: (ctx: AdapterContext) => Promise<string>;
}

/** Passerelle déduite d'une adresse : utile pour l'isolement partiel. */
export function gatewayOf(ip: string, explicit?: string): string {
  if (explicit) return explicit;
  return ip.split(".").slice(0, 3).join(".") + ".1";
}
