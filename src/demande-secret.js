#!/usr/bin/env node
// Programme SSH_ASKPASS : le client ssh le lance quand il lui faut un mot de
// passe ou la phrase d'une clé. Le secret n'est jamais un argument ni une
// variable d'environnement : ssh.js l'écrit dans un fichier 0600 d'un dossier
// 0700, dont ce programme ne reçoit que le chemin. Le fichier est effacé à la
// première lecture ; une seconde invite (mauvais mot de passe) ne reçoit rien.
import fs from 'node:fs';

const invite = String(process.argv[2] || '');
const fichier = /passphrase/i.test(invite) ? process.env.MAPMYLAN_SECRET_PHRASE : process.env.MAPMYLAN_SECRET_MDP;
if (!fichier) process.exit(1);
let secret;
try { secret = fs.readFileSync(fichier, 'utf8'); } catch { process.exit(1); }
fs.rmSync(fichier, { force: true });
process.stdout.write(secret + '\n');
