// Rotation de la clé maîtresse (SOCLE_CLE). Le socle rescelle les secrets
// TOTP ; ceux de MapMyLAN le sont ici, au démarrage, tant que la clé remplacée
// est posée à côté de la neuve (SOCLE_CLE_ANCIENNE). Un secret déjà sous la
// clé neuve reste tel quel ; un secret qu'aucune des deux n'ouvre reste en
// place, et l'interface demande de le ressaisir.
import { transaction } from './db.js';

// Chaque secret scellé : table, colonne, usage du coffre et lien à sa ligne.
const SCELLES = [
  ['equipements', 'passwordEnc', 'equipement', l => `${l.id}:passwordEnc`],
  ['equipements', 'privateKeyEnc', 'equipement', l => `${l.id}:privateKeyEnc`],
  ['equipements', 'passphraseEnc', 'equipement', l => `${l.id}:passphraseEnc`],
  ['boites', 'passwordEnc', 'boite', l => `${l.id}:password`],
  ['canaux', 'configEnc', 'canal', l => l.channel],
];

function ouvrir(coffre, usage, scelle, lien) {
  try { return coffre.ouvre(usage, scelle, lien); } catch {
    // Scellé sous une autre clé, ou abîmé : l'appelant essaie l'autre clé.
    return null;
  }
}

// { rescelles, illisibles } ; rien à faire sans clé remplacée.
export function resceller({ db, coffre }) {
  const bilan = { rescelles: 0, illisibles: 0 };
  if (!coffre.precedente) return bilan;
  transaction(db, () => {
    for (const [table, colonne, usage, lienDe] of SCELLES) {
      const poser = db.prepare(`UPDATE ${table} SET ${colonne} = ? WHERE id = ?`);
      for (const l of db.prepare(`SELECT * FROM ${table} WHERE ${colonne} IS NOT NULL`).all()) {
        const lien = lienDe(l);
        if (ouvrir(coffre, usage, l[colonne], lien) !== null) continue;
        const clair = ouvrir(coffre.precedente, usage, l[colonne], lien);
        if (clair === null) { bilan.illisibles++; continue; }
        poser.run(coffre.scelle(usage, clair, lien), l.id);
        bilan.rescelles++;
      }
    }
  });
  return bilan;
}
