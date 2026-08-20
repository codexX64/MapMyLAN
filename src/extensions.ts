// Optional extensions.
//
// MapMyLAN stays usable on its own. Some installations do, however, want to
// graft extra behavior onto it — feeding a knowledge base, pushing to a metrics
// warehouse, mirroring alerts to an internal system. Rather than maintaining
// two versions of the code that would diverge over the course of fixes, the
// application queries this hook: if an extension is present, it's called;
// otherwise nothing happens.
//
// An extension is a module dropped into `extensions/`. It isn't declared: its
// mere presence is enough. Nothing to recompile, nothing to configure in the
// core of the application.

/** What an extension can receive. All methods are optional. */
export interface Extension {
  /** Name shown in the logs. */
  nom?: string;

  /** A device has just appeared, disappeared, or changed. */
  surAppareil?(fait: string, donnees: Record<string, unknown>): void;

  /** A scan is completing. */
  surBalayage?(resume: Record<string, unknown>): void;

  /** An alert has been emitted, whatever channels were used. */
  surAlerte?(alerte: Record<string, unknown>): void;

  /** Is the extension responding? Used for the status display, nothing else. */
  disponible?(): Promise<boolean>;
}

const chargees: Extension[] = [];
let initialise = false;

/**
 * Loads the extensions that are present.
 *
 * The absence of the folder is the normal case, not an anomaly: it therefore
 * produces no message. An extension that refuses to load, on the other hand, is
 * reported, without which one would search a long time for why it stays silent.
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
    return;                       // no extensions: the ordinary case
  }

  for (const f of fichiers) {
    try {
      const chemin = path.join(dossier, f);
      // Loading a module means executing its code with all the backend's
      // privileges (SSH credentials for the equipment, blocking actions). A
      // file writable by the group or by everyone, or that we don't own, may
      // have been replaced by a third party: we refuse to execute it rather
      // than make it a silent entry point.
      const st = fs.lstatSync(chemin);
      if (st.isSymbolicLink()) {
        journal?.("warn", `Extension ${f} skipped: symbolic link refused`);
        continue;
      }
      if ((st.mode & 0o022) !== 0) {
        journal?.("warn", `Extension ${f} skipped: file writable by group or others (chmod 600/644)`);
        continue;
      }
      if (process.getuid && st.uid !== process.getuid()) {
        journal?.("warn", `Extension ${f} skipped: unexpected owner`);
        continue;
      }
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const m = require(chemin);
      const ext: Extension = m?.default || m;
      if (ext && typeof ext === "object") {
        chargees.push(ext);
        journal?.("info", `Extension loaded: ${ext.nom || f}`);
      }
    } catch (e: any) {
      journal?.("warn", `Extension ${f} skipped: ${e?.message || "could not load"}`);
    }
  }
}

/**
 * Calls a method on all the extensions.
 *
 * A faulty extension must not interrupt a scan: each call is isolated, and an
 * error stays within its extension.
 */
function diffuser(methode: keyof Extension, ...args: unknown[]): void {
  for (const e of chargees) {
    const fn = e[methode];
    if (typeof fn !== "function") continue;
    try {
      (fn as (...a: unknown[]) => void).apply(e, args);
    } catch {
      // Silent: an extension that fails is its own problem, not that of the
      // scan in progress.
    }
  }
}

export const extensions = {
  appareil: (fait: string, d: Record<string, unknown>) => diffuser("surAppareil", fait, d),
  balayage: (r: Record<string, unknown>) => diffuser("surBalayage", r),
  alerte: (a: Record<string, unknown>) => diffuser("surAlerte", a),
  /** How many extensions are active. For the status display. */
  nombre: () => chargees.length,
  noms: () => chargees.map((e, i) => e.nom || `extension ${i + 1}`),
};
