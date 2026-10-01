// Catalogue des adaptateurs constructeurs. Chacun déclare ce qu'il sait
// faire ; l'interface grise le reste plutôt que de proposer un bouton qui
// échouera.
import { PILOTES_SSH } from './pilotes-ssh.js';
import { unifi } from './unifi.js';

export const ADAPTATEURS = [unifi, ...PILOTES_SSH];

// Noms enregistrés avant la couche d'adaptateurs de la 1.x.
const ANCIENS = { asus: 'asus-merlin', merlin: 'asus-merlin', mikrotik: 'routeros', cisco: 'cisco-ios', opnsense: 'pfsense', ubiquiti: 'unifi' };

export function adaptateur(id) {
  return ADAPTATEURS.find(a => a.id === id)
    || ADAPTATEURS.find(a => a.id === ANCIENS[String(id).toLowerCase()])
    || ADAPTATEURS.find(a => a.id === 'generic');
}

export const reconnaitre = sonde => ADAPTATEURS.find(a => a.detect?.(sonde)) || null;

export const catalogue = () => ADAPTATEURS.map(a => ({ id: a.id, label: a.label, transport: a.transport, capabilities: a.capabilities, needs: a.needs || ['password'] }));
