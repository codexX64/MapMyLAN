# Installation par le Hub

Le Hub installe MapMyLAN de deux façons. Le manifeste `hub.json`, à la racine, décrit les deux.

| Mode | Quand | Ce qui se passe |
| --- | --- | --- |
| Installé par le Hub | Le segment à cartographier est celui de la machine du Hub. | Le Hub télécharge `deploy/compose.hub.yml`, génère les secrets, démarre PostgreSQL, Redis, l'API et l'interface, puis amorce son jeton d'intégration. Rien à configurer à la main. |
| Distant | MapMyLAN tourne déjà ailleurs, ou surveille un autre segment. | Le Hub demande l'adresse et un jeton créé dans Réglages → Intégrations. |

## Ce que l'installation demande

L'API a besoin du réseau de la machine : le balayage ARP ne traverse pas un pont Docker. Le manifeste le déclare, et le Hub le fait valider avant d'installer :

- `permissions.hostNetwork` — l'API partage la pile réseau de l'hôte ;
- `permissions.capAdd: [NET_ADMIN, NET_RAW]` — sockets bruts pour `arp-scan` et `nmap`.

Aucune autre permission n'est demandée : ni `privileged`, ni le socket Docker.

## Répartition des conteneurs

- **api** — réseau de la machine, écoute sur `BIND_ADDRESS` (par défaut la passerelle du pont Docker, jamais le réseau local).
- **web** — sur le réseau du Hub, c'est lui que le Hub interroge. `API_UPSTREAM` lui dit où joindre l'API.
- **db** et **cache** — sur le réseau du Hub, publiés seulement sur la boucle locale, l'API en réseau hôte les y retrouve.

## Le jeton

Le Hub génère une valeur préfixée `hub_`, la passe en `INTEGRATION_TOKEN_SEED` et s'en sert ensuite en `Authorization: Bearer`. MapMyLAN enregistre son empreinte sous le nom `hub`, rôle `operator`. Elle est révocable depuis Réglages → Intégrations, et changer la variable remplace l'ancienne.

## Images

`deploy/compose.hub.yml` tire `ghcr.io/codexx64/mapmylan-backend` et `ghcr.io/codexx64/mapmylan-frontend`, étiquette réglable par `IMAGE_TAG`. Le Hub ne construit rien : sans ces images publiées, l'installation s'arrête au téléchargement.

## Comptes gérés depuis le Hub

Le manifeste déclare un bloc `accounts` : le Hub sait lister les comptes, en créer, changer un rôle, remplacer un mot de passe, exiger le second facteur et supprimer. Il le fait avec un jeton de portée `accounts`, distinct du jeton de service, et demande un code TOTP à chaque entrée dans MapMyLAN, valable cinq minutes.

Le compte fondateur — le premier créé — n'est supprimable ni depuis le Hub ni par un jeton d'intégration : c'est par lui qu'on reprend la main si le Hub se trompe ou perd ses droits.

Installé par le Hub, le jeton est semé par `ADMIN_TOKEN_SEED`. En mode distant, il se crée dans Réglages → Intégrations.
