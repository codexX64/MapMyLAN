// Clé maîtresse du service et chiffrement des secrets au repos (AES-256-GCM).
//
// Les secrets TOTP doivent être relus pour vérifier un code : ils sont donc
// chiffrés, pas hachés. La clé vient de SOCLE_CLE (secret Docker ou variable),
// sinon d'un fichier 0600 créé au premier démarrage dans le volume de données.
// Quand SOCLE_CLE arrive alors qu'un fichier existe encore, il doit porter la
// même clé (ou SOCLE_CLE_ANCIENNE, pendant une rotation) : il est alors retiré,
// et une copie du volume seule ne déchiffre plus rien. Une clé différente
// arrête le démarrage.
// Rotation : la clé précédente, posée à côté de la neuve, ne sert qu'à relire
// les secrets scellés avant la rotation pour les resceller (Comptes.tournerCle).
// Chaque usage dérive sa propre sous-clé (HKDF) : une fuite de l'une ne donne
// pas les autres.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export class Coffre {
  constructor({ cle, fichier, ancienne = null }) {
    let brute = null;
    this.precedente = ancienne ? new Coffre({ cle: ancienne }) : null;
    if (cle) {
      brute = Buffer.from(String(cle).trim(), 'base64');
      if (brute.length !== 32) throw new Error('SOCLE_CLE doit faire 32 octets encodés en base64.');
      if (this.precedente && crypto.timingSafeEqual(this.precedente.maitresse, brute)) throw new Error('SOCLE_CLE_ANCIENNE est la clé actuelle : pose la clé neuve dans SOCLE_CLE.');
      if (fichier && fs.existsSync(fichier)) {
        const duVolume = Buffer.from(fs.readFileSync(fichier, 'utf8').trim(), 'base64');
        const connue = k => duVolume.length === 32 && crypto.timingSafeEqual(duVolume, k);
        if (!connue(brute) && !(this.precedente && connue(this.precedente.maitresse))) throw new Error(`SOCLE_CLE diffère de la clé du volume (${fichier}) : pose la même, ou les secrets chiffrés seraient perdus.`);
        fs.rmSync(fichier);
      }
    } else {
      if (this.precedente) throw new Error('SOCLE_CLE_ANCIENNE sans SOCLE_CLE : pose la clé neuve dans SOCLE_CLE.');
      if (!fichier) throw new Error('Clé maîtresse absente : SOCLE_CLE ou fichier de clé requis.');
      fs.mkdirSync(path.dirname(fichier), { recursive: true, mode: 0o700 });
      try {
        brute = Buffer.from(fs.readFileSync(fichier, 'utf8').trim(), 'base64');
      } catch (e) {
        if (e.code !== 'ENOENT') throw e;
        brute = crypto.randomBytes(32);
        fs.writeFileSync(fichier, brute.toString('base64') + '\n', { mode: 0o600, flag: 'wx' });
      }
      if (brute.length !== 32) throw new Error(`Clé maîtresse illisible : ${fichier}`);
    }
    this.maitresse = brute;
    this.cache = new Map();
  }

  sousCle(usage) {
    if (!this.cache.has(usage)) {
      this.cache.set(usage, Buffer.from(crypto.hkdfSync('sha256', this.maitresse, Buffer.alloc(0), 'socle:' + usage, 32)));
    }
    return this.cache.get(usage);
  }

  // aad lie le chiffré à son propriétaire : un secret copié d'une ligne à une
  // autre ne se déchiffre plus.
  scelle(usage, clair, aad = '') {
    const iv = crypto.randomBytes(12);
    const c = crypto.createCipheriv('aes-256-gcm', this.sousCle(usage), iv);
    c.setAAD(Buffer.from(aad));
    const ct = Buffer.concat([c.update(String(clair), 'utf8'), c.final()]);
    return `v1.${iv.toString('base64url')}.${Buffer.concat([ct, c.getAuthTag()]).toString('base64url')}`;
  }

  ouvre(usage, scelle, aad = '') {
    const [v, iv, corps] = String(scelle || '').split('.');
    if (v !== 'v1' || !iv || !corps) throw new Error('Secret scellé illisible.');
    const tout = Buffer.from(corps, 'base64url');
    const d = crypto.createDecipheriv('aes-256-gcm', this.sousCle(usage), Buffer.from(iv, 'base64url'));
    d.setAAD(Buffer.from(aad));
    d.setAuthTag(tout.subarray(tout.length - 16));
    return Buffer.concat([d.update(tout.subarray(0, tout.length - 16)), d.final()]).toString('utf8');
  }

  empreinte(usage, valeur) {
    return crypto.createHmac('sha256', this.sousCle(usage)).update(String(valeur)).digest('hex');
  }

  // Ce qui dit, sans rien révéler de la clé, sous quelle clé une base a été écrite.
  controle() {
    return this.empreinte('controle-cle', 'socle');
  }
}
