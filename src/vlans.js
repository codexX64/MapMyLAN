// Les VLAN, dans les deux sens : relevés sur l'équipement (ce qu'il déclare
// est rangé ici) et poussés vers lui (création et retrait, pour les
// constructeurs qui le permettent).
import { ErreurHttp } from '../socle/src/index.js';
import { transaction } from './db.js';
import { normaliserCidr, dansLeReseau, enEntier, enTexte, estIPv4, nettoyerTexte } from './cibles.js';

// Ce qui n'a rien à faire dans la liste des VLAN internes.
const HORS_SUJET = new Set(['wan', 'wan2', 'wan-lte-failover', 'remote-user-vpn', 'site-vpn', 'vpn-client']);
// Une teinte par VLAN à la création ; ensuite, c'est le réglage de l'utilisateur.
const TEINTES = ['#1B2AFF', '#0EA5E9', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#14B8A6', '#F97316', '#6366F1'];

// Ce qu'un sous-réseau permet d'attribuer. `octetsFiges` : le début que
// l'interface peut pré-remplir sans mentir sur ce qui est modifiable.
export function plageUtilisable(cidr) {
  const c = normaliserCidr(cidr);
  if (!c) return null;
  const base = enEntier(c.reseau.split('/')[0]);
  const taille = c.bits >= 31 ? 0 : 2 ** (32 - c.bits);
  const diffusion = taille ? base + taille - 1 : base;
  const octetsFiges = Math.floor(c.bits / 8);
  return {
    reseau: enTexte(base), diffusion: enTexte(diffusion >>> 0), premiere: enTexte((base + (taille ? 1 : 0)) >>> 0),
    derniere: enTexte((diffusion - (taille ? 1 : 0)) >>> 0), bits: c.bits, octetsFiges, prefixe: enTexte(base).split('.').slice(0, octetsFiges).join('.'),
  };
}

// Réservable dans ce VLAN ? Ni hors du sous-réseau, ni réseau, ni diffusion,
// ni l'adresse de la passerelle (la donner coupe la sortie du segment).
export function verifierAdresse(ip, cidr, passerelle) {
  const p = plageUtilisable(cidr);
  if (!p) return { ok: false, raison: 'Sous-réseau illisible.' };
  if (!estIPv4(ip)) return { ok: false, raison: `« ${String(ip).slice(0, 40)} » n’est pas une adresse IPv4.` };
  if (!dansLeReseau(ip, cidr)) return { ok: false, raison: `${ip} est hors de ${cidr}.` };
  if (ip === p.reseau) return { ok: false, raison: `${ip} est l’adresse du réseau lui-même.` };
  if (ip === p.diffusion) return { ok: false, raison: `${ip} est l’adresse de diffusion.` };
  if (passerelle && ip === passerelle) return { ok: false, raison: `${ip} est la passerelle du segment : la donner couperait la sortie.` };
  return { ok: true };
}

// Nom d'un VLAN tel qu'il entre dans une commande d'équipement : lettres,
// chiffres, tiret et souligné, rien d'autre.
const nomCommande = nom => String(nom).normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, '_').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32) || 'vlan';
const masqueDe = bits => enTexte(bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0);

// Commandes de création par constructeur. Les valeurs : un numéro de VLAN
// (entier 1–4094), des adresses recalculées ici, un nom réduit par nomCommande.
function commandesCreation(vendeur, v) {
  const c = normaliserCidr(v.subnet);
  const base = enEntier(c.reseau.split('/')[0]);
  const passerelle = enTexte(base + 1), debut = enTexte(base + Math.min(100, 2 ** (32 - c.bits) - 3)), fin = enTexte(base + Math.min(250, 2 ** (32 - c.bits) - 2));
  const n = Number(v.id), nom = nomCommande(v.name);
  switch (vendeur) {
    case 'routeros': return [
      `/interface vlan add name=vlan${n} vlan-id=${n} interface=bridge1 comment="${nom}"`,
      `/ip address add address=${passerelle}/${c.bits} interface=vlan${n}`,
      `/ip pool add name=vlan${n}-pool ranges=${debut}-${fin}`,
      `/ip dhcp-server add name=dhcp-vlan${n} interface=vlan${n} address-pool=vlan${n}-pool disabled=no`,
      `/ip dhcp-server network add address=${c.reseau} gateway=${passerelle} dns-server=${passerelle}`,
    ];
    case 'openwrt': return [
      `uci set network.vlan${n}=interface`, `uci set network.vlan${n}.proto='static'`, `uci set network.vlan${n}.ifname='br-lan.${n}'`,
      `uci set network.vlan${n}.ipaddr='${passerelle}'`, `uci set network.vlan${n}.netmask='${masqueDe(c.bits)}'`,
      'uci commit network && /etc/init.d/network reload',
    ];
    case 'cisco-ios': return [`configure terminal\nvlan ${n}\n name ${nom}\nexit\nend\nwrite memory`];
    default: return [];
  }
}

function commandesRetrait(vendeur, id) {
  const n = Number(id);
  switch (vendeur) {
    case 'routeros': return [
      `:foreach i in=[/ip dhcp-server find name="dhcp-vlan${n}"] do={/ip dhcp-server remove $i}`,
      `:foreach i in=[/ip pool find name="vlan${n}-pool"] do={/ip pool remove $i}`,
      `:foreach i in=[/ip address find interface=vlan${n}] do={/ip address remove $i}`,
      `:foreach i in=[/interface vlan find name="vlan${n}"] do={/interface vlan remove $i}`,
    ];
    case 'openwrt': return [`uci delete network.vlan${n} 2>/dev/null || true`, 'uci commit network && /etc/init.d/network reload'];
    case 'cisco-ios': return [`configure terminal\nno vlan ${n}\nend\nwrite memory`];
    default: return [];
  }
}

export class Vlans {
  constructor(s) { this.s = s; }

  async executer(commandes) {
    const { ligne, ctx } = this.s.equipements.principalPilotable();
    let sortie = '';
    for (const c of commandes) {
      try {
        const r = await ctx.exec(c);
        sortie += `\n$ ${c}\n${r.stdout || ''}${r.stderr ? `\nSTDERR: ${r.stderr}` : ''}`;
      } catch (e) {
        sortie += `\nERREUR : ${e.message}`;
        if (e.liaison) break;
      }
    }
    this.s.equipements.noterConnexion(ligne.id);
    return sortie.trim();
  }

  async pousser(v) {
    const principal = this.s.equipements.principal();
    if (!principal) return { pushed: false, output: 'Aucun équipement principal configuré.' };
    const vendeur = principal.vendor;
    const commandes = principal.transport === 'api' ? [] : commandesCreation(vendeur, v);
    if (!commandes.length) return { pushed: false, output: `« ${vendeur} » ne permet pas de pousser un VLAN depuis MapMyLAN : il est enregistré ici seulement.`, vendor: vendeur };
    const output = await this.executer(commandes);
    this.s.evts.journaliser('success', 'vlans', `VLAN ${v.id} (${nettoyerTexte(v.name, 40)}) poussé sur ${vendeur}`);
    return { pushed: true, output, vendor: vendeur };
  }

  async retirer(id) {
    const principal = this.s.equipements.principal();
    if (!principal) return { output: 'Aucun équipement principal configuré.' };
    const commandes = principal.transport === 'api' ? [] : commandesRetrait(principal.vendor, id);
    if (!commandes.length) return { output: `« ${principal.vendor} » ne permet pas de retirer un VLAN depuis MapMyLAN.` };
    const output = await this.executer(commandes);
    this.s.evts.journaliser('info', 'vlans', `VLAN ${id} retiré de ${principal.vendor}`);
    return { output };
  }

  // Range ce que l'équipement déclare. On n'écrase que ce qui vient de lui
  // (nom, sous-réseau, passerelle, identifiant) et on ne supprime jamais : un
  // VLAN disparu de l'équipement est signalé, pas effacé.
  enregistrerReseaux(reseaux) {
    const { db } = this.s;
    const r = { lus: 0, ajoutes: 0, misAJour: 0, inchanges: 0, rattaches: 0, orphelins: [], ignores: [] };
    const vus = new Set();
    transaction(db, () => {
      for (const reseau of reseaux) {
        if (HORS_SUJET.has(String(reseau.role || '').toLowerCase())) continue;
        const nomBrut = nettoyerTexte(reseau.nom || '', 60);
        if (!reseau.cidr) { r.ignores.push(`${nomBrut || 'sans nom'} : VLAN sans sous-réseau routé sur la passerelle, rien à enregistrer`); continue; }
        const c = normaliserCidr(reseau.cidr);
        if (!c) { r.ignores.push(`${nomBrut || 'sans nom'} : sous-réseau illisible`); continue; }
        // Un réseau sans étiquette est le réseau natif : le numéro 1.
        const id = Number.isInteger(reseau.vlan) && reseau.vlan >= 1 && reseau.vlan <= 4094 ? reseau.vlan : 1;
        if (vus.has(id)) { r.ignores.push(`${nomBrut || c.reseau} : le VLAN ${id} est déjà pris`); continue; }
        vus.add(id); r.lus++;
        const nom = nomBrut || `VLAN ${id}`;
        const passerelle = estIPv4(reseau.passerelle || '') ? reseau.passerelle : null;
        const idConstructeur = /^[\w-]{1,64}$/.test(reseau.id || '') ? reseau.id : null;
        const existant = db.prepare('SELECT * FROM vlans WHERE id = ?').get(id);
        if (!existant) {
          db.prepare('INSERT INTO vlans(id, name, subnet, gateway, networkId, color, description, isolated, createdAt) VALUES(?,?,?,?,?,?,?,0,?)')
            .run(id, nom, c.reseau, passerelle, idConstructeur, TEINTES[id % TEINTES.length], 'Relevé sur l’équipement réseau.', Date.now());
          r.ajoutes++;
        } else if (existant.name !== nom || existant.subnet !== c.reseau || existant.gateway !== passerelle || existant.networkId !== idConstructeur) {
          db.prepare('UPDATE vlans SET name = ?, subnet = ?, gateway = ?, networkId = ? WHERE id = ?').run(nom, c.reseau, passerelle, idConstructeur, id);
          r.misAJour++;
        } else r.inchanges++;
      }
      r.orphelins = db.prepare('SELECT id FROM vlans ORDER BY id').all().map(v => v.id).filter(id => !vus.has(id));
      r.rattaches = this.rattacherAppareils();
    });
    return r;
  }

  // Chaque appareil dans le VLAN dont il porte l'adresse, le préfixe le plus
  // long l'emportant. Une adresse hors de tout VLAN garde son étiquette.
  rattacherAppareils() {
    const { db } = this.s;
    const candidats = db.prepare('SELECT id, subnet FROM vlans').all().map(v => ({ id: v.id, cidr: v.subnet, bits: normaliserCidr(v.subnet)?.bits ?? -1 }))
      .filter(v => v.bits >= 0).sort((a, b) => b.bits - a.bits);
    if (!candidats.length) return 0;
    let total = 0;
    const poser = db.prepare('UPDATE appareils SET vlan = ? WHERE id = ?');
    for (const a of db.prepare('SELECT id, ip, vlan FROM appareils').all()) {
      const trouve = candidats.find(c => dansLeReseau(a.ip, c.cidr));
      if (trouve && a.vlan !== trouve.id) total += poser.run(trouve.id, a.id).changes;
    }
    return total;
  }

  async relever() {
    const vide = { lus: 0, ajoutes: 0, misAJour: 0, inchanges: 0, rattaches: 0, orphelins: [], ignores: [] };
    let pilote;
    try { pilote = this.s.equipements.principalPilotable(); } catch (e) { return { ...vide, erreur: e.message }; }
    const { adaptateur, ctx } = pilote;
    if (!adaptateur.networks) return { ...vide, erreur: `${adaptateur.label} ne sait pas énumérer ses réseaux depuis MapMyLAN : les VLAN se déclarent à la main.` };
    let reseaux;
    try { reseaux = await adaptateur.networks(ctx); } catch (e) { return { ...vide, erreur: e.message || 'L’équipement n’a pas répondu.' }; }
    const r = this.enregistrerReseaux(reseaux);
    this.s.evts.journaliser('info', 'vlan', `Relevé des VLAN : ${r.ajoutes} ajouté(s), ${r.misAJour} mis à jour, ${r.inchanges} inchangé(s), ${r.rattaches} appareil(s) rattaché(s)`);
    return r;
  }

  // Les adresses que la passerelle porte sur chaque VLAN : pas des machines.
  adressesDePasserelle() {
    return new Set(this.s.db.prepare('SELECT gateway FROM vlans WHERE gateway IS NOT NULL').all().map(v => v.gateway));
  }

  // Efface les fiches déjà créées pour ces adresses, sauf la racine et le routeur principal.
  purgerPasserelles(garder) {
    const adresses = this.adressesDePasserelle();
    if (garder) adresses.delete(garder);
    let n = 0;
    const effacer = this.s.db.prepare('DELETE FROM appareils WHERE ip = ? AND isMainRouter = 0');
    for (const ip of adresses) n += effacer.run(ip).changes;
    if (n) this.s.evts.journaliser('info', 'scanner', `${n} fiche(s) d’adresse de passerelle retirée(s) de l’inventaire`);
    return n;
  }

  valider(v) {
    const c = normaliserCidr(v.subnet);
    if (!c || c.bits < 8 || c.bits > 30) throw new ErreurHttp(400, 'Sous-réseau invalide : un CIDR IPv4 entre /8 et /30.');
    return c.reseau;
  }
}
