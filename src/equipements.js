// Les équipements pilotés : le routeur principal et les consoles SSH (même
// table, comme en 1.4.1). Les secrets sont scellés par le coffre du socle,
// sous une sous-clé propre à cet usage et liés à leur ligne : copiés sur une
// autre ligne, ils ne se déchiffrent plus. Ils ne sortent d'ici que pour
// ouvrir une connexion, jamais vers le navigateur ni le journal.
import { ErreurHttp } from '../socle/src/index.js';
import { nouvelId } from './db.js';
import { adaptateur } from './adaptateurs/index.js';
import { SessionHttp, exigerUrlEquipement } from './adaptateurs/session.js';
import { lireCertificat, tlsEpingle } from './certificat.js';

const USAGE = 'equipement';

export class Equipements {
  constructor({ db, coffre, ssh, sortie }) {
    Object.assign(this, { db, coffre, ssh, sortie });
  }

  ligne(id) { return this.db.prepare('SELECT * FROM equipements WHERE id = ?').get(id) || null; }
  principal() { return this.db.prepare('SELECT * FROM equipements WHERE isMainRouter = 1 ORDER BY createdAt LIMIT 1').get() || null; }
  lister() { return this.db.prepare('SELECT * FROM equipements ORDER BY createdAt LIMIT 1000').all(); }

  sceller(id, champ, valeur) { return valeur ? this.coffre.scelle(USAGE, String(valeur), `${id}:${champ}`) : null; }
  ouvrir(ligne, champ) {
    if (!ligne[champ]) return undefined;
    try { return this.coffre.ouvre(USAGE, ligne[champ], `${ligne.id}:${champ}`); } catch {
      throw new ErreurHttp(409, `Secret de « ${ligne.name} » illisible avec la clé actuelle : saisis-le à nouveau.`);
    }
  }

  identifiants(l) {
    return {
      host: l.host, port: l.port, username: l.username, transport: l.transport || 'ssh',
      password: this.ouvrir(l, 'passwordEnc'), privateKey: this.ouvrir(l, 'privateKeyEnc'), passphrase: this.ouvrir(l, 'passphraseEnc'),
      apiBaseUrl: l.apiBaseUrl || undefined, site: l.site || undefined, verifyTls: l.verifyTls === 1,
    };
  }

  // Le contexte qu'un adaptateur reçoit : de quoi exécuter une commande (SSH,
  // clé d'hôte épinglée) ou appeler l'API (certificat épinglé ou vérifié).
  contexte(creds, { cleHote = null, certificat = null, alias = 'essai' } = {}) {
    const ssh = this.ssh;
    return {
      creds,
      exec: commande => {
        if (creds.transport === 'api') return Promise.reject(new ErreurHttp(400, 'Cet équipement se pilote par son API, pas en SSH.'));
        return ssh.executer({ ...creds, cleHote, alias }, commande);
      },
      http: () => {
        const origine = exigerUrlEquipement(creds.apiBaseUrl || `https://${creds.host}`, creds.host);
        if (!creds.verifyTls && !certificat) throw new ErreurHttp(409, 'Certificat de l’équipement non épinglé : relance la reconnaissance et confirme son empreinte.');
        return new SessionHttp({ sortie: this.sortie, origine, tls: creds.verifyTls ? null : tlsEpingle(certificat) });
      },
    };
  }

  contexteDe(l) {
    return this.contexte(this.identifiants(l), {
      alias: l.id,
      cleHote: l.cleHote ? { type: l.cleHote.split(' ')[0], cle: l.cleHote.split(' ')[1] } : null,
      certificat: l.certificatTls ? { pem: l.certificatTls, empreinte: l.empreinteTls } : null,
    });
  }

  principalPilotable() {
    const l = this.principal();
    if (!l) throw new ErreurHttp(409, 'Aucun équipement principal configuré : ajoute-le dans Équipement réseau.');
    return { ligne: l, adaptateur: adaptateur(l.vendor), ctx: this.contexteDe(l) };
  }

  noterConnexion(id) { this.db.prepare('UPDATE equipements SET lastConnected = ? WHERE id = ?').run(Date.now(), id); }

  // Ce que l'hôte présente, pour que l'administrateur le confirme.
  async reconnaitre({ host, port, transport, apiBaseUrl }) {
    if (transport === 'api') {
      const origine = new URL(exigerUrlEquipement(apiBaseUrl || `https://${host}`, host));
      const adresse = await this.sortie.destinationTcp(host, { confiance: 'equipement' });
      return { tls: await lireCertificat({ host, port: Number(origine.port) || 443, adresse }) };
    }
    return { ssh: await this.ssh.lireCles({ host, port }) };
  }

  // Les preuves épinglées pour une configuration : la clé d'hôte (SSH) ou le
  // certificat (API) que l'hôte présente maintenant et que l'administrateur a
  // confirmés. Sans confirmation, 409 avec l'empreinte à montrer.
  async preuves(creds, { empreinteHote, empreinteTls }) {
    if (creds.transport === 'api') {
      if (creds.verifyTls) return { certificat: null };
      const { tls } = await this.reconnaitre(creds);
      if (!empreinteTls || empreinteTls !== tls.empreinte) {
        throw new ErreurHttp(409, empreinteTls ? 'Le certificat présenté n’est pas celui que tu as confirmé.' : 'Confirme d’abord l’empreinte du certificat de l’équipement.', { empreinteTls: tls.empreinte, sujetTls: tls.sujet, certificatReconnu: tls.reconnu });
      }
      return { certificat: { pem: tls.pem, empreinte: tls.empreinte } };
    }
    if (!empreinteHote) {
      const { cles } = await this.ssh.lireCles(creds);
      throw new ErreurHttp(409, 'Confirme d’abord l’empreinte de la clé d’hôte de l’équipement.', { empreinteHote: cles[0]?.empreinte || null, typeCle: cles[0]?.type || null });
    }
    const cle = await this.ssh.cleConfirmee(creds, empreinteHote);
    return { cleHote: { type: cle.type, cle: cle.cle }, empreinteHote: cle.empreinte };
  }

  // Enregistre (ou met à jour) un équipement. Un secret absent garde celui en place.
  enregistrer({ id = null, name, creds, vendor, isMainRouter, preuves }) {
    const t = Date.now();
    const cible = id || nouvelId();
    const avant = id ? this.ligne(id) : null;
    const secrets = {
      passwordEnc: creds.password ? this.sceller(cible, 'passwordEnc', creds.password) : avant?.passwordEnc ?? null,
      privateKeyEnc: creds.privateKey ? this.sceller(cible, 'privateKeyEnc', creds.privateKey) : avant?.privateKeyEnc ?? null,
      passphraseEnc: creds.passphrase ? this.sceller(cible, 'passphraseEnc', creds.passphrase) : avant?.passphraseEnc ?? null,
    };
    const pin = {
      cleHote: preuves.cleHote ? `${preuves.cleHote.type} ${preuves.cleHote.cle}` : null, empreinteHote: preuves.empreinteHote || null,
      certificatTls: preuves.certificat?.pem || null, empreinteTls: preuves.certificat?.empreinte || null,
    };
    const valeurs = [name, creds.host, creds.port, creds.username, secrets.passwordEnc, secrets.privateKeyEnc, secrets.passphraseEnc, vendor, creds.transport,
      creds.apiBaseUrl || null, creds.site || null, creds.verifyTls ? 1 : 0, isMainRouter ? 1 : 0, pin.cleHote, pin.empreinteHote, pin.certificatTls, pin.empreinteTls];
    if (avant) {
      this.db.prepare(`UPDATE equipements SET name=?, host=?, port=?, username=?, passwordEnc=?, privateKeyEnc=?, passphraseEnc=?, vendor=?, transport=?,
        apiBaseUrl=?, site=?, verifyTls=?, isMainRouter=?, cleHote=?, empreinteHote=?, certificatTls=?, empreinteTls=? WHERE id=?`).run(...valeurs, cible);
    } else {
      this.db.prepare(`INSERT INTO equipements(name, host, port, username, passwordEnc, privateKeyEnc, passphraseEnc, vendor, transport,
        apiBaseUrl, site, verifyTls, isMainRouter, cleHote, empreinteHote, certificatTls, empreinteTls, id, createdAt) VALUES(${'?,'.repeat(18)}?)`).run(...valeurs, cible, t);
    }
    return this.ligne(cible);
  }
}
