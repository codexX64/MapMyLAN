// Authentificateur logiciel pour les tests : fabrique les réponses qu'un
// navigateur renverrait, avec des vraies signatures.
import crypto from 'node:crypto';
import { encodeCbor } from '../src/cbor.js';
import { b64url, deB64url, sha256 } from '../src/outils.js';

function cose(alg, publicKey) {
  const jwk = publicKey.export({ format: 'jwk' });
  if (alg === -7) return new Map([[1, 2], [3, -7], [-1, 1], [-2, deB64url(jwk.x)], [-3, deB64url(jwk.y)]]);
  if (alg === -8) return new Map([[1, 1], [3, -8], [-1, 6], [-2, deB64url(jwk.x)]]);
  return new Map([[1, 3], [3, -257], [-1, deB64url(jwk.n)], [-2, deB64url(jwk.e)]]);
}

function signe(alg, privateKey, donnees) {
  if (alg === -7) return crypto.sign('sha256', donnees, { key: privateKey, dsaEncoding: 'der' });
  if (alg === -8) return crypto.sign(null, donnees, privateKey);
  return crypto.sign('sha256', donnees, privateKey);
}

export class Authentificateur {
  constructor({ alg = -7 } = {}) {
    this.alg = alg;
    const paire = alg === -7 ? crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' })
      : alg === -8 ? crypto.generateKeyPairSync('ed25519')
      : crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    this.privee = paire.privateKey; this.publique = paire.publicKey;
    this.credId = crypto.randomBytes(32);
    this.compteur = 0;
    this.handle = null;
  }

  authData({ rpId, flags, avecCle }) {
    const tete = Buffer.alloc(37);
    sha256(rpId).copy(tete, 0);
    tete[32] = flags;
    tete.writeUInt32BE(this.compteur, 33);
    if (!avecCle) return tete;
    const lon = Buffer.alloc(2); lon.writeUInt16BE(this.credId.length);
    return Buffer.concat([tete, Buffer.alloc(16), lon, this.credId, encodeCbor(cose(this.alg, this.publique))]);
  }

  creer(options, origine, { uv = true, up = true, rpId = options.rp.id, type = 'webauthn.create', fmt = 'none', defi = options.challenge } = {}) {
    this.handle = options.user.id;
    const clientData = Buffer.from(JSON.stringify({ type, challenge: defi, origin: origine, crossOrigin: false }));
    const flags = (up ? 0x01 : 0) | (uv ? 0x04 : 0) | 0x40;
    const ad = this.authData({ rpId, flags, avecCle: true });
    const stmt = fmt === 'packed'
      ? new Map([['alg', this.alg], ['sig', signe(this.alg, this.privee, Buffer.concat([ad, sha256(clientData)]))]])
      : new Map();
    const att = encodeCbor(new Map([['fmt', fmt], ['attStmt', stmt], ['authData', ad]]));
    return {
      id: b64url(this.credId), rawId: b64url(this.credId), type: 'public-key',
      response: { clientDataJSON: b64url(clientData), attestationObject: b64url(att), transports: ['internal'] },
    };
  }

  signer(options, origine, { uv = true, up = true, rpId = options.rpId, avancer = 1, defi = options.challenge, handle = this.handle } = {}) {
    this.compteur += avancer;
    const clientData = Buffer.from(JSON.stringify({ type: 'webauthn.get', challenge: defi, origin: origine, crossOrigin: false }));
    const ad = this.authData({ rpId, flags: (up ? 0x01 : 0) | (uv ? 0x04 : 0), avecCle: false });
    const sig = signe(this.alg, this.privee, Buffer.concat([ad, sha256(clientData)]));
    return {
      id: b64url(this.credId), rawId: b64url(this.credId), type: 'public-key',
      response: { clientDataJSON: b64url(clientData), authenticatorData: b64url(ad), signature: b64url(sig), userHandle: handle },
    };
  }
}
