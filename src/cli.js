// Administration en ligne de commande, dans le conteneur :
//
//   node src/cli.js importer-v1 < export.json
//   node src/cli.js lien-reinit <identifiant>
//   node src/cli.js sauvegarde < cle-publique.pem > mapmylan.sauv
//   node src/cli.js restaurer <cle-privee.pem> <cible.db> < mapmylan.sauv   (sur une autre machine)
//
// Chaque geste laisse sa trace au journal chaîné du socle. La sauvegarde est
// chiffrée pour une clé publique : la clé privée qui la relit ne vit pas ici.
import fs from 'node:fs';
import { Journal, demarrerSocle, sauvegarder, dechiffrer, lireConfig } from '../socle/src/index.js';
import { lireConfigMapmylan, VERSION } from './config.js';
import { ouvrirBase } from './db.js';
import { importerV1, lireExport } from './migration.js';

const REINIT_MS = 20 * 60e3;
const SILENCE = { info: () => {}, warn: m => console.error(m), error: m => console.error(m) };
const [, , commande, ...args] = process.argv;

function stop(message) { console.error(`erreur : ${message}`); process.exit(1); }

async function socle() {
  const cfg = lireConfigMapmylan();
  const db = ouvrirBase(cfg.donnees);
  // s.cfg : la configuration du socle (adresse publique comprise).
  const s = await demarrerSocle({ service: { id: 'mapmylan', nom: 'MapMyLAN' }, db, dossier: cfg.donnees, log: SILENCE });
  return { db, ...s };
}

// L'entrée lue en flux : readFileSync(0) lève EAGAIN quand l'entrée est non
// bloquante, ce qu'elle est derrière « ssh … docker run -i ».
async function lireEntree() {
  const morceaux = [];
  for await (const m of process.stdin) morceaux.push(m);
  return Buffer.concat(morceaux);
}

async function importer() {
  if (process.stdin.isTTY) stop('donne l’export sur l’entrée : node src/cli.js importer-v1 < export.json');
  const e = lireExport((await lireEntree()).toString('utf8'));
  const { cleV1 } = lireConfig({ cleV1: { env: 'MAPMYLAN_V1_MASTER_KEY', type: 'chaine' } });
  const s = await socle();
  try {
    const b = importerV1({ db: s.db, comptes: s.comptes, coffre: s.coffre, journal: s.journal, export: e, cleV1 });
    console.log(`Reprise de la 1.4.1 terminée : ${b.comptes} compte(s), ${b.totp} secret(s) TOTP scellé(s).`);
    for (const [t, n] of Object.entries(b.lignes)) console.log(`  ${t.padEnd(18)} ${n}`);
    if (b.sansMotDePasse.length) {
      console.log(`\n${b.sansMotDePasse.length} compte(s) sans mot de passe réutilisable (empreinte bcrypt) : ${b.sansMotDePasse.join(', ')}`);
      console.log('  → node src/cli.js lien-reinit <identifiant>, ou « Réinitialiser » dans la page Comptes.');
    }
    if (b.clesNonReprises) console.log(`\n${b.clesNonReprises} clé(s) d’accès non reprise(s) : chacun en recrée une depuis la page Sécurité.`);
    if (b.secretsLaisses) console.log(`\n${b.secretsLaisses} secret(s) laissé(s) de côté faute de MAPMYLAN_V1_MASTER_KEY : à ressaisir.`);
    if (b.lignes.equipements) console.log('\nÉquipements repris : réenregistre chacun (Équipement réseau, Consoles SSH) pour confirmer l’empreinte de sa clé d’hôte ou de son certificat.');
    if (b.jetonsIgnores) console.log(`\n${b.jetonsIgnores} jeton(s) d’intégration non repris (portée « comptes » ou rôle inconnu).`);
    if (b.reglagesIgnores.length) console.log(`\nRéglages ignorés : ${b.reglagesIgnores.join(', ')}`);
    if (b.canauxIgnores.length) console.log(`Canaux ignorés : ${b.canauxIgnores.join(', ')} (le SMS n’existe plus).`);
    if (b.boitesARevoir) console.log(`${b.boitesARevoir} réglage(s) de boîte mail sans chiffrement passé(s) en STARTTLS exigé : à vérifier.`);
  } finally { s.arreter(); s.db.close(); }
}

async function lienReinit(identifiant) {
  if (!identifiant) stop('usage : node src/cli.js lien-reinit <identifiant>');
  const s = await socle();
  try {
    const c = s.comptes.parIdentifiant(identifiant);
    if (!c) stop(`aucun compte « ${String(identifiant).slice(0, 64)} »`);
    s.db.prepare("DELETE FROM socle_jetons WHERE compte = ? AND usage = 'reinit'").run(c.id);
    const jeton = s.comptes.emettreJeton('reinit', c.id, REINIT_MS);
    s.journal.ecrire({ action: 'compte.reinit_emis', objet: c.id, details: { par: 'ligne de commande' } });
    console.log(`Lien de réinitialisation pour « ${c.identifiant} », valable 20 minutes et une seule fois :\n`);
    console.log(`  ${s.cfg.urlPublique || '<adresse de MapMyLAN>'}/#reinit=${jeton}\n`);
    console.log('Il ne rend que le mot de passe : les autres facteurs inscrits restent exigés.');
  } finally { s.arreter(); s.db.close(); }
}

async function sauvegarde() {
  if (process.stdout.isTTY) stop('redirige la sortie : node src/cli.js sauvegarde < cle-publique.pem > mapmylan.sauv');
  const cfg = lireConfigMapmylan();
  const db = ouvrirBase(cfg.donnees);
  try {
    const sortie = await sauvegarder(db, (await lireEntree()).toString('utf8'), { service: 'mapmylan', version: VERSION });
    new Journal(db).ecrire({ action: 'sauvegarde.faite', details: { octets: sortie.length, par: 'ligne de commande' } });
    process.stdout.write(sortie);
  } finally { db.close(); }
}

async function restaurer(prive, cible) {
  if (!prive || !cible) stop('usage : node src/cli.js restaurer <cle-privee.pem> <cible.db> < mapmylan.sauv');
  if (fs.existsSync(cible)) stop(`${cible} existe déjà : la restauration écrit un fichier neuf`);
  const { entete, base } = dechiffrer(await lireEntree(), fs.readFileSync(prive, 'utf8'));
  if (entete.service !== 'mapmylan') stop(`sauvegarde de ${entete.service}, pas de MapMyLAN`);
  fs.writeFileSync(cible, base, { mode: 0o600, flag: 'wx' });
  console.error(`Base de MapMyLAN ${entete.version} du ${entete.date} restaurée dans ${cible}.`);
}

const AIDE = `MapMyLAN ${VERSION} — administration

  importer-v1 < export.json          reprend un export de la 1.4.1 (outils/exporter-v1.sh) dans une base neuve
  lien-reinit <identifiant>          lien de réinitialisation du mot de passe (20 minutes, une fois)
  sauvegarde < cle.pub > f.sauv      sauvegarde chiffrée pour une clé publique RSA (3072 bits au moins)
  restaurer <cle.pem> <cible.db> < f.sauv   relit une sauvegarde, sur une autre machine

Les comptes se gèrent dans l'interface (page Comptes).`;

try {
  if (commande === 'importer-v1') await importer();
  else if (commande === 'lien-reinit') await lienReinit(args[0]);
  else if (commande === 'sauvegarde') await sauvegarde();
  else if (commande === 'restaurer') await restaurer(args[0], args[1]);
  else console.log(AIDE);
} catch (e) { stop(e.message); }
