// Consoles SSH : une commande tapée par un administrateur (ou enregistrée par
// lui dans une commande automatique) et envoyée à un équipement enregistré.
import { ErreurHttp } from '../socle/src/index.js';

// Une seule instruction à la fois : aucun des caractères par lesquels on en
// enchaîne une seconde. Le contrôle ne cherche pas à comprendre la commande.
const ENCHAINEMENT = /[;&|`$\n\r<>]|\$\(|\|\|/;

export function gardeCommande(commande) {
  if (typeof commande !== 'string' || !commande.trim()) throw new ErreurHttp(400, 'Commande vide.');
  if (commande.length > 4096) throw new ErreurHttp(400, 'Commande trop longue.');
  if (ENCHAINEMENT.test(commande)) throw new ErreurHttp(400, 'Commande refusée : une seule instruction à la fois, sans « ; », « | », « && », redirection ni substitution.');
  return commande;
}

export class Consoles {
  constructor(s) { this.s = s; }

  async executer(id, commande) {
    const { equipements, evts, commandes } = this.s;
    const l = equipements.ligne(id);
    if (!l) throw new ErreurHttp(404, 'Équipement introuvable.');
    if (l.transport === 'api') throw new ErreurHttp(409, 'Cet équipement se pilote par son API, pas en SSH.');
    // Le nom de l'équipement et le premier mot de la commande : de quoi
    // relire l'historique sans recopier d'argument sensible, ni au journal ni
    // dans les variables des commandes automatiques (qui peuvent l'y écrire).
    const programme = commande.trim().split(/\s+/)[0].slice(0, 40);
    try {
      const r = await equipements.contexteDe(l).exec(commande);
      equipements.noterConnexion(id);
      evts.journaliser('info', 'ssh', `Commande exécutée sur ${l.name} : ${programme}…`);
      commandes.declencher('ssh.exec_success', { device: l.name, cmd: programme });
      return { stdout: r.stdout, stderr: r.stderr, code: r.code };
    } catch (e) {
      commandes.declencher(e.liaison ? 'ssh.connection_lost' : 'ssh.exec_failure', { device: l.name, cmd: programme, error: String(e.message).slice(0, 200) });
      throw e;
    }
  }
}
