// Extensions facultatives.
//
// MapMyLAN reste utilisable seul. Certaines installations veulent cependant lui
// greffer un comportement supplémentaire — alimenter une base de connaissances,
// pousser vers un entrepôt de métriques, doubler les alertes vers un système
// interne. Plutôt que d'entretenir deux versions du code qui divergeraient au
// fil des correctifs, l'application interroge ce point d'accroche : si une
// extension est présente, elle est appelée ; sinon il ne se passe rien.
//
// Une extension est un module déposé dans `extensions/`. Elle n'est pas
// déclarée : sa seule présence suffit. Rien à recompiler, rien à configurer
// dans le cœur de l'application.

/** Ce qu'une extension peut recevoir. Toutes les méthodes sont facultatives. */
export interface Extension {
  /** Nom affiché dans les journaux. */
  nom?: string;

  /** Un appareil vient d'apparaître, de disparaître ou de changer. */
  surAppareil?(fait: string, donnees: Record<string, unknown>): void;

  /** Un balayage s'achève. */
  surBalayage?(resume: Record<string, unknown>): void;

  /** Une alerte a été émise, quels que soient les canaux employés. */
  surAlerte?(alerte: Record<string, unknown>): void;

  /** L'extension répond-elle ? Sert à l'affichage d'état, à rien d'autre. */
  disponible?(): Promise<boolean>;
}

const chargees: Extension[] = [];
let initialise = false;

/**
 * Charge les extensions présentes.
 *
 * L'absence du dossier est le cas normal, pas une anomalie : elle ne produit
 * donc aucun message. Une extension qui refuse de se charger est en revanche
 * signalée, sans quoi on chercherait longtemps pourquoi elle reste muette.
 */
export function chargerExtensions(journal?: (n: string, m: string) => void): void {
  if (initialise) return;
  initialise = true;

  let fs: typeof import("fs"), path: typeof import("path");
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    fs = require("fs"); path = require("path");
  } catch { return; }

  const dossier = path.join(__dirname, "..", "extensions");
  let fichiers: string[];
  try {
    fichiers = fs.readdirSync(dossier).filter(f => /\.(js|ts)$/.test(f) && !f.startsWith("_"));
  } catch {
    return;                       // pas d'extensions : le cas ordinaire
  }

  for (const f of fichiers) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const m = require(path.join(dossier, f));
      const ext: Extension = m?.default || m;
      if (ext && typeof ext === "object") {
        chargees.push(ext);
        journal?.("info", `Extension chargée : ${ext.nom || f}`);
      }
    } catch (e: any) {
      journal?.("warn", `Extension ${f} ignorée : ${e?.message || "chargement impossible"}`);
    }
  }
}

/**
 * Appelle une méthode sur toutes les extensions.
 *
 * Une extension défaillante ne doit pas interrompre un balayage : chaque appel
 * est isolé, et une erreur reste dans son extension.
 */
function diffuser(methode: keyof Extension, ...args: unknown[]): void {
  for (const e of chargees) {
    const fn = e[methode];
    if (typeof fn !== "function") continue;
    try {
      (fn as (...a: unknown[]) => void).apply(e, args);
    } catch {
      // Silencieux : une extension qui échoue est son problème, pas celui du
      // balayage en cours.
    }
  }
}

export const extensions = {
  appareil: (fait: string, d: Record<string, unknown>) => diffuser("surAppareil", fait, d),
  balayage: (r: Record<string, unknown>) => diffuser("surBalayage", r),
  alerte: (a: Record<string, unknown>) => diffuser("surAlerte", a),
  /** Combien d'extensions sont actives. Pour l'affichage d'état. */
  nombre: () => chargees.length,
  noms: () => chargees.map((e, i) => e.nom || `extension ${i + 1}`),
};
