# Modules fournis

Ces fichiers sont à déposer dans l'arborescence du projet. Ils ne constituent
pas une application autonome.

| Fichier | Destination | Rôle |
|---|---|---|
| `password.ts` | `backend/src/services/` | Hachage Argon2id, migration bcrypt transparente, comparaison en temps constant |
| `detourage.ts` | `frontend/src/lib/` | Détourage d'image sans dépendance, par diffusion depuis les bords |
| `DevicePhoto.tsx` | `frontend/src/components/device/` | Import et détourage d'une photo d'appareil |
| `WorldTrafficView.tsx` | `frontend/src/components/world/` | Globe orthographique et journal des connexions |
| `ticket.ts` | `backend/src/services/` | Construction du ticket structuré et transports |
| `alerte.ts` | `backend/src/services/` | Aiguillage des alertes vers les canaux, selon le format de chacun |
| `extensions.ts` | `backend/src/services/` | Point d'accroche pour les extensions facultatives |

## Dépendance à ajouter

`password.ts` requiert :

```bash
npm install @node-rs/argon2
```

Cette implémentation fournit des binaires précompilés, contrairement au paquet
`argon2` qui exige une chaîne de compilation dans l'image Docker.

## Alertes

`ticket.ts` produit un objet normalisé plutôt qu'une phrase : gravité, appareil
concerné, métriques et clé de regroupement sont des champs séparés, ce qui
permet à un système de billetterie de créer le ticket sans interpréter le texte.

**Le format lisible est celui par défaut.** Le format structuré ne sert que si
une billetterie est branchée : envoyer du JSON à quelqu'un qui ouvre son
courrier serait une régression. Chaque canal a son propre réglage, et le bot
reste toujours lisible — personne ne lit du JSON sur son téléphone.

La billetterie est facultative. Sans elle, les alertes partent quand même par
les autres canaux. Si elle répond, la référence du ticket est citée dans les
messages destinés aux humains ; si elle échoue, les autres canaux partent
malgré tout.

L'urgence se déduit d'une matrice croisant l'impact et la portée. Une passerelle
injoignable est bloquante à l'échelle du site, donc P1 ; un port qui s'ouvre sur
une machine concerne cette machine, donc P4. Rien n'est laissé à l'appréciation
de l'émetteur, ce qui évite qu'un automate se déclare en priorité maximale.

La clé de regroupement combine la nature de l'événement et son sujet, sans
horodatage : un incident qui se répète incrémente un compteur au lieu de créer
cent tickets.

Le nom de l'en-tête portant la clé est configurable, l'adresse de destination
aussi. Le module ne présume donc pas de la billetterie employée.

## Extensions

`extensions.ts` charge ce que contient le dossier `extensions/` à la racine.
Une extension y est reconnue par sa seule présence : rien à déclarer, rien à
recompiler.

Ce mécanisme évite d'entretenir deux versions du code pour deux usages. Une
installation qui veut greffer un comportement particulier dépose son module ;
les autres n'ont rien à faire, et le code partagé reste identique.
