// Identifiant de la requête en cours, sans le passer de main en main : le
// journal le recopie sur chaque ligne et une erreur interne le donne comme
// référence, ce qui relie ce que voit l'utilisateur à ce que garde le serveur.
import { AsyncLocalStorage } from 'node:async_hooks';
import crypto from 'node:crypto';

const stockage = new AsyncLocalStorage();

export const requeteCourante = () => stockage.getStore() ?? null;

// À placer autour du gestionnaire HTTP du service.
export const envelopper = gestion => (req, res) => stockage.run(crypto.randomBytes(6).toString('hex'), () => gestion(req, res));
