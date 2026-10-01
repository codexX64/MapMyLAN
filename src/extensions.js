// Extensions facultatives : un module déposé dans le dossier EXTENSIONS_DIR
// (monté en lecture seule) est chargé au démarrage, sans autre déclaration :
// ESM (`export default {…}`), ou CommonJS en .cjs (celles de la 1.4.1).
// Il peut recevoir surAppareil, surBalayage et surAlerte ; une extension qui
// lève n'interrompt jamais un balayage.
//
// Charger un module, c'est exécuter son code avec les privilèges du service :
// un fichier lien symbolique, inscriptible par le groupe ou par tous, ou qui
// n'appartient pas à l'utilisateur du service, est refusé.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export class Extensions {
  constructor({ journal = () => {} } = {}) { this.chargees = []; this.journal = journal; }

  async charger(dossier) {
    if (!dossier) return;
    let fichiers;
    try { fichiers = fs.readdirSync(dossier).filter(f => /\.(?:m?js|cjs)$/.test(f) && !f.startsWith('_')).sort(); } catch { return; }
    for (const f of fichiers) {
      const chemin = path.join(dossier, f);
      try {
        const st = fs.lstatSync(chemin);
        if (st.isSymbolicLink()) { this.journal('warn', `Extension ${f} ignorée : lien symbolique refusé.`); continue; }
        if ((st.mode & 0o022) !== 0) { this.journal('warn', `Extension ${f} ignorée : inscriptible par le groupe ou par tous (chmod 644).`); continue; }
        if (process.getuid && st.uid !== process.getuid()) { this.journal('warn', `Extension ${f} ignorée : propriétaire inattendu.`); continue; }
        const m = await import(pathToFileURL(chemin).href);
        const ext = m.default || m;
        if (ext && typeof ext === 'object') { this.chargees.push(ext); this.journal('info', `Extension chargée : ${String(ext.nom || f).slice(0, 60)}`); }
      } catch (e) { this.journal('warn', `Extension ${f} ignorée : ${String(e.message).slice(0, 160)}`); }
    }
  }

  diffuser(methode, ...args) {
    for (const e of this.chargees) {
      if (typeof e[methode] !== 'function') continue;
      try {
        const r = e[methode](...args);
        if (r && typeof r.catch === 'function') r.catch(err => this.journal('warn', `Extension ${String(e.nom || '?').slice(0, 60)} : ${String(err?.message).slice(0, 120)}`));
      } catch (err) { this.journal('warn', `Extension ${String(e.nom || '?').slice(0, 60)} : ${String(err.message).slice(0, 120)}`); }
    }
  }

  appareil(fait, donnees) { this.diffuser('surAppareil', fait, donnees); }
  balayage(resume) { this.diffuser('surBalayage', resume); }
  alerte(a) { this.diffuser('surAlerte', a); }
  get nombre() { return this.chargees.length; }
}
