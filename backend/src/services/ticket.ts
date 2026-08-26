// Émission des alertes au format ticket structuré.
//
// Une alerte lisible par un humain et un ticket exploitable par une machine ne
// demandent pas la même chose. La phrase « unknown-c8f2 est apparu sur le
// réseau » se lit bien mais oblige le destinataire à l'interpréter : extraire
// l'hôte, deviner la gravité, décider si c'est un doublon. Le format structuré
// livre ces éléments séparés, et le système de billetterie n'a plus qu'à les
// ranger.
//
// Le schéma suit la spécification « ticket/v1 » : seul le titre est requis,
// tout le reste porte une valeur par défaut. Deux transports le véhiculent —
// le courriel, où le JSON voyage dans le corps, et l'appel direct en HTTP.
// La construction du ticket est commune aux deux : seul l'envoi diffère.

import { createHash } from "crypto";

// ── Vocabulaire ─────────────────────────────────────────────────────────────
export type Urgence = "p1" | "p2" | "p3" | "p4";
export type Impact = "bloquant" | "degrade" | "mineur";
export type Portee = "site" | "service" | "groupe" | "utilisateur";
export type TypeTicket = "incident" | "demande" | "maintenance" | "projet" | "info";

/**
 * Matrice de criticité.
 *
 * L'urgence n'est pas un jugement mais une conséquence : ce qui est bloquant à
 * l'échelle du site passe devant ce qui est dégradé pour un seul utilisateur.
 * La déduire évite qu'un émetteur automatique se déclare arbitrairement en
 * priorité maximale.
 */
const MATRICE: Record<Impact, Record<Portee, Urgence>> = {
  bloquant: { site: "p1", service: "p1", groupe: "p2", utilisateur: "p3" },
  degrade:  { site: "p2", service: "p2", groupe: "p3", utilisateur: "p3" },
  mineur:   { site: "p3", service: "p3", groupe: "p4", utilisateur: "p4" },
};

export function urgenceDe(impact: Impact, portee: Portee): Urgence {
  return MATRICE[impact][portee];
}

// ── Ce que MapMyLAN sait produire comme événements ──────────────────────────
export type Evenement =
  | "hote_inconnu"        // un appareil jamais vu répond
  | "port_ouvert"         // un port s'est ouvert sur un hôte connu
  | "risque_eleve"        // le score de risque dépasse le seuil
  | "isolement"           // une règle a isolé un appareil
  | "vulnerabilite"       // une faille connue correspond à un service exposé
  | "equipement_injoignable"  // la passerelle ne répond plus
  | "balayage_echec"      // le balayage n'a pas abouti
  | "resume";             // récapitulatif périodique

interface Profil {
  type: TypeTicket;
  impact: Impact;
  portee: Portee;
  titre: (c: Contexte) => string;
}

/**
 * Chaque événement porte sa propre gravité intrinsèque.
 *
 * Une passerelle injoignable coupe tout le monde : bloquant à l'échelle du
 * site. Un port qui s'ouvre sur une machine concerne cette machine : mineur,
 * portée utilisateur. C'est cette table qui évite d'avoir à décider au cas par
 * cas au moment de l'émission.
 */
const PROFILS: Record<Evenement, Profil> = {
  hote_inconnu: {
    type: "incident", impact: "mineur", portee: "utilisateur",
    titre: c => `Appareil inconnu sur le réseau — ${c.hote || c.ip}`,
  },
  port_ouvert: {
    type: "incident", impact: "mineur", portee: "utilisateur",
    titre: c => `Nouveau port ouvert sur ${c.hote || c.ip}`,
  },
  risque_eleve: {
    type: "incident", impact: "degrade", portee: "groupe",
    titre: c => `Risque élevé — ${c.hote || c.ip}`,
  },
  isolement: {
    type: "incident", impact: "degrade", portee: "utilisateur",
    titre: c => `Appareil isolé — ${c.hote || c.ip}`,
  },
  vulnerabilite: {
    type: "incident", impact: "degrade", portee: "service",
    titre: c => `Vulnérabilité exposée sur ${c.hote || c.ip}`,
  },
  equipement_injoignable: {
    type: "incident", impact: "bloquant", portee: "site",
    titre: () => "Équipement réseau injoignable",
  },
  balayage_echec: {
    type: "incident", impact: "degrade", portee: "service",
    titre: () => "Le balayage réseau a échoué",
  },
  resume: {
    type: "info", impact: "mineur", portee: "site",
    titre: c => `Récapitulatif — ${c.hotes ?? 0} hôtes, ${c.alertes ?? 0} alertes`,
  },
};

// ── Contexte fourni par l'appelant ──────────────────────────────────────────
export interface Contexte {
  hote?: string;
  ip?: string;
  mac?: string;
  vlan?: number | null;
  fabricant?: string;
  ports?: number[];
  risque?: number;
  cve?: string;
  service?: string;
  description?: string;
  symptomes?: string[];
  attendu?: string;
  constate?: string;
  actionsFaites?: string[];
  logs?: string;
  hotes?: number;
  alertes?: number;
  /** Force l'urgence. À n'employer que si la matrice se trompe manifestement. */
  urgence?: Urgence;
}

export interface Ticket {
  /** Marqueur de version. Son nom est posé par l'aiguilleur selon la
   *  billetterie destinataire, qui s'en sert pour reconnaître son format. */
  ticket: 1;
  type: TypeTicket;
  titre: string;
  urgence: Urgence;
  impact: Impact;
  portee: Portee;
  service: string;
  composant: string;
  zone: { site: string; vlan: number | null; host: string; ip: string; url: string };
  description: string;
  symptomes: string[];
  attendu: string;
  constate: string;
  actions_faites: string[];
  logs: string;
  detecte_le: string;
  projet: string;
  labels: string[];
  metriques: { label: string; valeur: string; seuil?: string; etat: "ok" | "warn" | "ko" }[];
  liens: { label: string; url: string }[];
  dedup_key: string;
  source: { systeme: string; ref: string };
}

const S = (v: unknown, max = 512) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/**
 * Clé de regroupement.
 *
 * Un même incident qui se répète ne doit pas produire cent tickets. La clé
 * combine la nature de l'événement et son sujet — pas l'horodatage, sinon
 * chaque occurrence serait unique et le regroupement ne servirait à rien.
 */
export function cleRegroupement(ev: Evenement, c: Contexte): string {
  const sujet = c.mac || c.ip || c.hote || "global";
  const detail = ev === "port_ouvert" ? (c.ports || []).sort((a, b) => a - b).join("-")
               : ev === "vulnerabilite" ? (c.cve || "")
               : "";
  const brut = [ev, sujet, detail].filter(Boolean).join(":");
  // Une empreinte courte garde la clé lisible tout en bornant sa taille.
  return brut.length <= 128 ? brut
       : ev + ":" + createHash("sha256").update(brut).digest("hex").slice(0, 24);
}

export interface Reglages {
  /** Nom du site, tel qu'il apparaîtra dans la zone du ticket. */
  site?: string;
  /** Projet auquel rattacher les tickets. */
  projet?: string;
  /** Nom du système émetteur. */
  systeme?: string;
  /** Adresse de l'interface, pour construire les liens. */
  baseUrl?: string;
}

/** Construit le ticket. Commun aux deux transports. */
export function construireTicket(
  ev: Evenement,
  c: Contexte,
  r: Reglages = {},
): Ticket {
  const p = PROFILS[ev];
  const urgence = c.urgence || urgenceDe(p.impact, p.portee);

  const metriques: Ticket["metriques"] = [];
  if (typeof c.risque === "number") {
    metriques.push({
      label: "Risque", valeur: String(c.risque), seuil: "70",
      etat: c.risque >= 70 ? "ko" : c.risque >= 40 ? "warn" : "ok",
    });
  }
  if (c.ports && c.ports.length) {
    metriques.push({ label: "Ports ouverts", valeur: String(c.ports.length), etat: "warn" });
  }

  const liens: Ticket["liens"] = [];
  if (r.baseUrl && c.ip) {
    liens.push({ label: "Fiche de l'appareil", url: `${r.baseUrl.replace(/\/+$/, "")}/devices?ip=${encodeURIComponent(c.ip)}` });
  }

  return {
    ticket: 1,
    type: p.type,
    titre: S(p.titre(c), 200) || "Alerte réseau",
    urgence, impact: p.impact, portee: p.portee,
    service: S(c.service || "reseau", 64),
    composant: S(c.fabricant, 64),
    zone: {
      site: S(r.site, 64),
      vlan: Number.isInteger(c.vlan as number) ? (c.vlan as number) : null,
      host: S(c.hote, 64),
      ip: S(c.ip, 45),
      url: "",
    },
    description: S(c.description, 20000),
    symptomes: (c.symptomes || []).map(x => S(x)).filter(Boolean).slice(0, 20),
    attendu: S(c.attendu, 1000),
    constate: S(c.constate, 1000),
    actions_faites: (c.actionsFaites || []).map(x => S(x)).filter(Boolean).slice(0, 20),
    logs: S(c.logs, 8000),
    detecte_le: new Date().toISOString(),
    projet: S(r.projet, 64),
    labels: ["reseau", ev.replace(/_/g, "-")],
    metriques,
    liens,
    dedup_key: cleRegroupement(ev, c),
    source: { systeme: S(r.systeme || "mapmylan", 48), ref: "" },
  };
}

// ── Transports ──────────────────────────────────────────────────────────────
export interface Destination {
  /** Adresse de l'API de billetterie. Vide = transport par courriel. */
  url?: string;
  /** Clé d'accès, transmise dans l'en-tête convenu. */
  cle?: string;
  /** Nom de l'en-tête portant la clé. Configurable selon la billetterie. */
  entete?: string;
}

export interface Resultat {
  ok: boolean;
  id?: number;
  ref?: string;
  regroupe?: boolean;
  erreur?: string;
}

/**
 * Envoie le ticket à l'API.
 *
 * Les erreurs sont distinguées plutôt que réduites à un échec : une clé
 * refusée, un quota dépassé et une panne du serveur appellent trois réactions
 * différentes.
 */
export async function envoyerApi(t: Ticket, d: Destination): Promise<Resultat> {
  if (!d.url) return { ok: false, erreur: "Aucune adresse d'API configurée." };
  const entete = d.entete || "X-Ticket-Key";

  try {
    const rep = await fetch(d.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        [entete]: d.cle || "",
        // Rejouer la même requête ne doit pas créer deux tickets.
        "Idempotency-Key": createHash("sha256")
          .update(t.dedup_key + "|" + t.detecte_le.slice(0, 16))
          .digest("hex").slice(0, 32),
      },
      body: JSON.stringify(t),
      signal: AbortSignal.timeout(10_000),
    });

    // Le corps d'une réponse est typé « inconnu » : on le déclare pour
    // pouvoir en lire les champs sans que le compilateur s'y oppose.
    const corps: any = await rep.json().catch(() => ({}));

    if (rep.status === 401) return { ok: false, erreur: "Clé refusée par la billetterie." };
    if (rep.status === 429) {
      const attente = rep.headers.get("Retry-After");
      return { ok: false, erreur: `Quota dépassé${attente ? `, réessayer dans ${attente} s` : ""}.` };
    }
    if (rep.status === 400) {
      return { ok: false, erreur: `Ticket refusé : ${corps?.detail || corps?.erreur || "format invalide"}.` };
    }
    if (!rep.ok) return { ok: false, erreur: `La billetterie a répondu ${rep.status}.` };

    return {
      ok: true,
      id: corps?.id,
      ref: corps?.ref,
      // Le code 200 signale un regroupement, 201 une création.
      regroupe: rep.status === 200 || corps?.dedup === true,
    };
  } catch (e: any) {
    const nom = e?.name === "TimeoutError" ? "délai dépassé" : (e?.message || "échec");
    return { ok: false, erreur: `Contact impossible : ${nom}.` };
  }
}

/**
 * Prépare le courriel équivalent.
 *
 * Le JSON voyage dans le corps, précédé de rien : la spécification prévoit
 * qu'un corps commençant par une accolade soit reconnu comme structuré. L'objet
 * reste lisible pour un humain qui ouvrirait le message.
 */
export function preparerCourriel(t: Ticket): { objet: string; corps: string; entetes: Record<string, string> } {
  return {
    objet: `[${t.urgence.toUpperCase()}] ${t.titre}`,
    corps: JSON.stringify(t, null, 2),
    entetes: { "X-Ticket-Format": "json" },
  };
}

/** Rendu lisible, pour les destinataires qui n'attendent pas de structure. */
export function rendreLisible(t: Ticket): string {
  const l: string[] = [t.titre];
  if (t.description) l.push("", t.description);
  if (t.zone.host || t.zone.ip) {
    l.push("", `Appareil : ${[t.zone.host, t.zone.ip].filter(Boolean).join(" · ")}`);
  }
  if (t.metriques.length) {
    l.push("", ...t.metriques.map(m => `${m.label} : ${m.valeur}${m.seuil ? ` (seuil ${m.seuil})` : ""}`));
  }
  if (t.symptomes.length) l.push("", ...t.symptomes.map(s => `— ${s}`));
  return l.join("\n");
}
