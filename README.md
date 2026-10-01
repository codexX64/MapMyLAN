# MapMyLAN

**Cartographie, surveille et défend le réseau local.** Découverte des
appareils, topologie mesurée, vulnérabilités, blocage sur l'équipement réseau,
alertes en direct, et un assistant qui répond au clavier ou à voix haute.

Projet [CodexX64](https://github.com/CodexX64). Licence MIT.

La version 2 est une réécriture du serveur : Node 24 seul, aucune dépendance
npm, base SQLite (`node:sqlite`), interface statique sans construction, et le
socle commun des services pour les comptes et la sécurité. Le contrat entre
serveur et interface est dans [docs/API.md](docs/API.md).

## Ce que fait MapMyLAN

- **Découverte** par trois sources fusionnées : balayage ARP (ce qui a parlé),
  balayage ping (ce qui répond) et l'équipement réseau (ce qu'il porte, muets
  compris). Chaque appareil est identifié par un classement pondéré (fabricant,
  services mDNS, ports, bannières, système, nom) qui donne une confiance.
- **Scores** de confiance, d'activité, de vulnérabilité et de danger, avec
  leurs raisons ; **CVE** rapprochées des services vus ; **historique** par
  appareil.
- **Topologie mesurée** : port de commutation et borne de chaque client quand
  l'équipement les donne, commutateur non géré déduit quand plusieurs MAC
  partagent un port. Les liens tracés à la main ne sont jamais touchés.
- **VLAN relevés** sur la passerelle (jamais effacés en silence), poussés vers
  elle pour les constructeurs qui le permettent ; **réservations** d'adresse.
- **Défense** : bloquer, isoler, lever un blocage, à la main ou par règle
  (seuil de danger), exécuté sur l'équipement.
- **Trafic** vers et depuis l'extérieur, lu dans la table conntrack de la
  passerelle (les deux sens), titulaires des destinations par RDAP.
- **Alertes** par Telegram (avec des commandes du bot), courriel, billetterie
  (ticket structuré) et le relais « Poste » ; **commandes** « quand X, faire Y ».
- **Supervision de la machine** : processeur, mémoire, disque, température,
  débit, conteneurs Docker (lecture seule, par proxy).
- **Assistant** : réponses directes sans modèle, ou par l'Ollama du Hub ; voix
  par VOX ; mémoire partagée par SYNAPSE. Plafond d'appels par compte et par jour.
- **Jetons d'intégration** (rôle lecture ou membre) pour le Hub et les scripts.

## Équipements pris en charge

| Constructeur | Transport | Blocage | Clients |
|---|---|:-:|:-:|
| Ubiquiti UniFi | API locale HTTPS | oui | oui |
| Asus / Merlin, OpenWrt, Ubiquiti EdgeOS | SSH | oui | oui |
| MikroTik RouterOS, Cisco IOS | SSH | oui | oui |
| pfSense / OPNsense | SSH | oui | oui |
| Zyxel | SSH | oui | — |
| Générique (Linux, iptables) | SSH | oui | oui |

UniFi exige un compte **local** du contrôleur. Une clé d'hôte SSH ou un
certificat auto-signé est montré à l'administrateur à l'enregistrement : il en
confirme l'empreinte, et seule cette clé (ce certificat) est ensuite admise.

## Comptes et sécurité

MapMyLAN repose sur le socle commun des services : comptes nominatifs, rôles
`admin`, `membre` (piloter le réseau) et `lecture`, au moins deux facteurs
(clé d'accès exigée pour un administrateur en HTTPS, application TOTP, mot de
passe Argon2id selon la politique, codes de secours), sessions côté serveur,
en-tête anti-CSRF, politique de contenu à nonce, journal de sécurité chaîné.
Les actions sensibles (secrets d'équipement, commandes à distance,
suppressions, réglages de sécurité, jetons) demandent une confirmation
d'identité de moins de cinq minutes.

Les secrets (équipements, boîtes mail, canaux de notification) sont scellés
par le coffre du socle et ne redescendent jamais vers le navigateur. Toute
connexion vers une adresse fournie par un utilisateur passe par une garde :
http(s) seulement, métadonnées de nuage et plages réservées toujours refusées,
adresses internes seulement pour l'équipement déclaré ou la liste
`sortie.autorisees` (Réglages). Les outils réseau sont lancés sans shell,
arguments en tableau et cibles validées.

Chaque compte peut exporter ses données (page Sécurité) ; supprimer un compte
efface son fil de l'assistant et ses compteurs. Voir `web/confidentialite.txt`.

## Installation par le Hub

Extensions → MapMyLAN → Installer. Le Hub génère la clé maîtresse, le poivre
et le jeton d'intégration, branche Ollama, VOX et SYNAPSE s'ils sont installés.
L'API tourne dans le réseau de la machine (le balayage ARP ne traverse pas un
pont Docker) et n'écoute que sur l'adresse du pont (`BIND_ADDRESS`) ; un relais
lancé depuis la même image, sur le réseau du Hub, lui transmet les requêtes.

Au premier démarrage, MapMyLAN écrit son **jeton d'installation** dans ses
journaux : il sert une fois, à créer le premier compte administrateur.

## Installation seule

```bash
cp .env.example .env
mkdir -p secrets extensions && openssl rand -base64 32 > secrets/socle_cle && : > secrets/socle_cle_ancienne && chmod 600 secrets/socle_cle secrets/socle_cle_ancienne
docker compose up -d --build
docker compose logs mapmylan | grep "Jeton d'installation"
```

La clé maîtresse vit hors du volume de données (secret Docker). Renseigner
`SCAN_INTERFACE` (`ip -o link show`) et `SCAN_SUBNET`, puis ouvrir
`http://<hôte>:8090` (ou l'adresse du relais inverse), coller le jeton, créer
le compte et ses facteurs.

**Pourquoi ces capacités.** `nmap`, `arp-scan` et `ping` ont besoin des
sockets bruts (`NET_RAW`) et de rien d'autre. Docker ne donne aucune capacité
à un processus lancé sous un autre compte que root, et `no-new-privileges`
(posé) écarte les capacités de fichier : le conteneur part donc en root avec
`NET_RAW`, `SETUID`, `SETGID` et `SETPCAP`, et `setpriv` passe aussitôt au
compte `node` en ne gardant que `NET_RAW`, transmise aux outils. MapMyLAN
tourne sous `node`, les trois autres capacités retirées de l'ensemble limite.
L'image ne contient ni programme setuid ni capacité de fichier. Une commande
lancée dans le conteneur prend `-u node` (voir « Sauvegardes »).

Sans Docker : Node 24.7 ou plus récent, les outils `nmap arp-scan iputils-ping
openssh-client avahi-utils samba-common-bin snmp iproute2`, puis `npm start`.

## Mise à jour depuis la 1.4.1

La 2.0 part d'une base neuve, remplie par la reprise de l'ancienne, en une
transaction (tout ou rien) :

```bash
# 1. Export, dans le conteneur PostgreSQL de la 1.4.1 :
docker exec -i <conteneur-db-1.4.1> sh -s < outils/exporter-v1.sh > export.json
chmod 600 export.json
# 2. Reprise, avant le premier démarrage de la 2.0 :
docker compose run --rm -T mapmylan node src/cli.js importer-v1 < export.json
# 3. Une fois vérifié :
shred -u export.json
```

- **Mots de passe** : les empreintes Argon2id de la 1.4.1 sont reprises telles
  quelles, à condition de garder le même poivre : `SOCLE_POIVRE` = l'ancien
  `PASSWORD_PEPPER` (le Hub le fait tout seul), ou, pour en changer,
  `SOCLE_POIVRE_ANCIEN` = l'ancien (`aucun` s'il n'y en avait pas). Elles
  passent aux paramètres actuels à la première connexion.
- **Comptes sans mot de passe réutilisable** (empreinte bcrypt, antérieure à
  Argon2id) : ils sont repris sans mot de passe. Un administrateur leur remet
  un lien de réinitialisation (page Comptes → Réinitialiser) ; si c'est le seul
  administrateur, `node src/cli.js lien-reinit <identifiant>` en donne un,
  valable vingt minutes. La reprise les liste.
- **TOTP** : les secrets actifs sont scellés ; **clés d'accès** non reprises
  (chacun en recrée une, obligatoire pour un administrateur).
- **Secrets** d'équipements, de boîtes mail et de canaux : rouverts avec
  `MAPMYLAN_V1_MASTER_KEY` (l'ancien `MASTER_KEY`), puis scellés. Sans elle,
  ils sont laissés de côté et se ressaisissent.
- **Équipements** : la 1.4.1 n'épinglait ni clé d'hôte ni certificat ; chaque
  équipement repris se réenregistre une fois pour en confirmer l'empreinte.
- **Rôles** : `operator` → `membre`, `viewer` → `lecture`. Les jetons de portée
  « comptes » ne sont pas repris (un jeton ne gère plus les comptes), le SMS non
  plus (canal retiré), et une boîte mail sans chiffrement passe en STARTTLS exigé.
- Tout le reste est repris : inventaire, ports, CVE, historique, carte, zones,
  VLAN, alertes, journal, réglages valides, commandes, règles, balayages,
  mesures, trafic, fil de l'assistant de chaque compte.

## Configuration

Chaque secret peut venir d'un fichier : `NOM_FILE=/chemin`. Une valeur
invalide arrête MapMyLAN au démarrage avec la liste des erreurs.

| Variable | Rôle | Défaut |
|---|---|---|
| `PORT` / `HOTE` | écoute | `8090` / `0.0.0.0` |
| `DATA_DIR` | base et clés | `/app/data` |
| `SCAN_SUBNET` / `SCAN_INTERVAL` / `SCAN_INTERFACE` | plage de départ, intervalle (s, `0` : à la main), interface | — / `300` / auto |
| `HOST_PROC` / `HOST_SYS` | `/proc` et `/sys` de la machine, montés en lecture | `/proc` / `/sys` |
| `DOCKER_HOST` | proxy du socket Docker en lecture seule (`tcp://…` ou `unix:///…`) | — |
| `INTEGRATION_TOKEN_SEED` | jeton du Hub (`hub_…` ou `mml_…`), rôle membre | — |
| `IA_URL` / `IA_MODELE` / `IA_MODELE_DEFAUT` | Ollama et modèle de l'assistant | — |
| `VOX_URL` / `VOX_JETON` | voix | — |
| `SYNAPSE_URL` / `SYNAPSE_JETON` | mémoire partagée | — |
| `MAPMYLAN_IA_JOUR` / `_JOUR_TOTAL` / `_MINUTE` | plafonds d'appels au modèle : par compte et par jour, instance par jour, par compte et par minute | `200` / `1000` / `10` |
| `MAPMYLAN_VOIX_JOUR` / `_JOUR_TOTAL` | plafonds de transcriptions et de lectures par VOX : par compte et par jour, instance par jour | `400` / `2000` |
| `POSTE_URL` / `POSTE_FROM` / `POSTE_SEND_KEY` / `POSTE_ALIAS` | relais d'envoi « Poste » (https) | — |
| `SERVICE_UI` | adresse de MapMyLAN pour un humain | — |
| `EXTENSIONS_DIR` | dossier des extensions (lecture seule) | — |
| `MAPMYLAN_V1_MASTER_KEY` | reprise de la 1.4.1 seulement | — |
| `SOCLE_THEME` | thème de l'interface : `console` (noir et vert, ou blanc et bleu par la bascule clair ou sombre) ou `soma` (clair ou sombre) ; dans le Hub, champ « Thème de l'interface » du service, `console` par défaut | `soma` |
| `SOCLE_*` | comptes, clé maîtresse, poivre, relais SMTP des alertes, relais de confiance : voir le socle | — |

Réglages de l'interface, validés un par un (toute autre clé est refusée) :
plages de balayage (préfixe /16 ou plus étroit), intervalle, construction
automatique de la carte, regroupement, registres RDAP, logos (éteints par
défaut), rétention du trafic, destinations internes autorisées en sortie.

## Extensions

Un module déposé dans `EXTENSIONS_DIR` est chargé au démarrage : ESM
(`export default { nom, surAppareil, surBalayage, surAlerte }`), ou CommonJS en
`.cjs` (celles de la 1.4.1, renommées). Toutes les méthodes sont facultatives ;
une extension qui lève n'interrompt rien. Un fichier lien symbolique,
inscriptible par le groupe ou par tous, ou d'un autre propriétaire, est refusé.

## Sauvegardes

```bash
docker compose exec -u node -T mapmylan node src/cli.js sauvegarde < cle-publique.pem > mapmylan.sauv
node src/cli.js restaurer cle-privee.pem mapmylan.db < mapmylan.sauv   # sur une autre machine
```

La sauvegarde est chiffrée pour une clé publique RSA (3072 bits au moins) : la
clé privée qui la relit ne vit pas sur la machine de MapMyLAN.

## Tourner la clé maîtresse

Dans le Hub (réglages avancés de MapMyLAN) ou dans `secrets/` installé seul :
la clé actuelle dans `SOCLE_CLE_ANCIENNE` (`socle_cle_ancienne`), une neuve
(`openssl rand -base64 32`) dans `SOCLE_CLE` (`socle_cle`), puis redémarrer.
Au démarrage, les secrets TOTP, ceux des équipements, des boîtes mail et des
canaux de notification passent sous la clé neuve (journal : `coffre.rescelle`) ;
personne ne ressaisit rien. Vider ensuite `SOCLE_CLE_ANCIENNE` et redémarrer.
Une clé que la base ne connaît pas arrête le démarrage.

## Derrière un relais inverse

Déclarer l'adresse du relais dans `SOCLE_PROXYS` ; sans cela, MapMyLAN ignore
`X-Forwarded-For` et `X-Forwarded-Proto`, et compte les débits par l'adresse
du relais. `SOCLE_ORIGINES` accepte une origine de plus quand le relais
réécrit l'hôte. MapMyLAN n'est pas fait pour être exposé nu sur Internet.

## Vérifier

```bash
npm test                                   # tests du service
(cd socle && node --test)                  # tests du socle embarqué
node outils/parcours-navigateur.mjs        # parcours de l'interface dans Chromium (Playwright requis)
node outils/faux-api.mjs                   # l'interface devant des données inventées, sans réseau
```

Les essais démarrent de vrais serveurs locaux : droits de chaque route par
rôle, objets d'autrui, corps invalides, sorties vers l'interne et les
métadonnées, injections dans les arguments des outils, clé d'hôte SSH changée,
certificat épinglé changé, flux temps réel, reprise de la 1.4.1, export et
effacement d'un compte.

## Licence

MIT — voir [LICENSE](LICENSE).
