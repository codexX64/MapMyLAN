# Signaler une faille

Merci de **ne pas ouvrir d'issue publique** pour une vulnérabilité.

Écrivez plutôt à l'adresse indiquée sur le profil
[CodexX64](https://github.com/CodexX64), ou passez par le formulaire privé de
GitHub, onglet *Security → Report a vulnerability*.

Précisez si possible la version, les conditions de reproduction et l'impact que
vous estimez. Une réponse est apportée sous une semaine.

## Portée

MapMyLAN manipule des identifiants d'équipement réseau et peut interrompre
l'accès d'appareils. Sont particulièrement concernés :

- le contournement de l'authentification, sous toutes ses formes ;
- l'accès aux identifiants d'équipement stockés ;
- l'exécution d'actions de défense sans autorisation ;
- l'injection de commandes par les adaptateurs SSH ;
- l'élévation de privilèges entre rôles.

## Hors portée

- Les attaques exigeant un accès physique à la machine hôte.
- L'auto-signature du certificat des équipements, inévitable en réseau local.
- L'exposition de l'application nue sur Internet : elle n'est pas conçue pour
  cela, et la documentation le précise.

## Ce que le projet garantit

Aucun logiciel ne peut prétendre être exempt de vulnérabilités. Ce qui est
garanti, c'est le traitement des signalements et la publication des correctifs.

## Sécurité — état des correctifs

Les faiblesses relevées lors de la constitution de ce dépôt ont été corrigées
dans le code. Ce qui suit décrit ce qui est en place, et ce qui ne l'est pas.

### Corrigé

| Point | Auparavant | Désormais |
|---|---|---|
| Changement de mot de passe | accessible sans jeton, identifiant pris dans le corps | exige un jeton, travaille sur le compte porteur |
| Hachage | bcrypt — tronque à 72 octets, tient dans 4 Kio | Argon2id, 32 Mio et 3 passes, migration transparente |
| Politique de contenu | désactivée | active, sources restreintes à l'application |
| Limiteur de tentatives | aveugle derrière un proxy | `trust proxy` posé, deux plafonds distincts |
| Verrouillage de compte | absent | progressif : 1 min après 5 échecs, 15 min après 10 |
| Révocation des jetons | impossible avant expiration | version portée par le jeton, incrémentée à chaque changement |
| Énumération des comptes | temps de réponse distinct | temps comparable, message identique |
| Taille de requête | 5 Mo | 512 Ko |

Le changement de mot de passe invalide toutes les sessions ouvertes : un mot de
passe changé parce qu'on le croit compromis ne doit pas laisser vivre les jetons
émis avant.

### Non couvert

Ces points demandent une décision d'exploitation, pas une ligne de code.

- **Exposition publique.** L'application n'est pas conçue pour être atteinte nue
  depuis Internet. Placez-la derrière un accès authentifié.
- **Chiffrement du transport.** Assuré par le proxy qui la précède, pas par
  l'application.
- **Sauvegarde de `MASTER_KEY`.** Sa perte rend les identifiants d'équipement
  irrécupérables.
- **Second facteur.** Disponible mais non activé par défaut.

### Ce qui ne peut pas être garanti

Aucun logiciel n'est exempt de vulnérabilités, et prétendre le contraire serait
malhonnête. Ce qui est établi ici, c'est que les faiblesses connues du projet
ont été traitées, et que chaque correctif a été vérifié. Une faille inconnue
reste possible : c'est le cas de tout logiciel, y compris de ceux qui sont
audités en continu.

## Failles exploitables — traitement

### Corrigées

| Faille | Ce qu'elle permettait | Parade |
|---|---|---|
| Injection de commande par l'adresse | Un appareil annonçant `192.0.2.1; commande` faisait exécuter du code sur le routeur, en root | Validation stricte de l'IP et de la MAC avant construction, plus un garde au point d'exécution qui refuse tout caractère d'enchaînement |
| Injection par le nom d'hôte | Les noms viennent de mDNS, NetBIOS et DHCP — annoncés par l'appareil. Injection dans les journaux, l'interface, la base | Assainissement à l'entrée du scanner : contrôles, marques de direction et espaces invisibles écartés, longueur bornée |
| Requête forgée côté serveur | L'adresse d'API était libre : le backend pouvait être dirigé vers un service interne ou un point de métadonnées d'hébergeur | L'adresse doit désigner l'équipement enregistré, sans chemin, sans paramètre, sans identifiants |
| Secrets absents ou devinables | Un `JWT_SECRET` vide permettait de forger n'importe quel jeton | Refus de démarrer, avec les commandes de génération affichées |
| Dépendances vulnérables | Sept failles élevées, dont une injection de commande SMTP | Mises à jour appliquées, plus aucune élevée ni critique |

La protection contre l'injection de commande est posée **à deux niveaux** : à la
source, où l'adresse est reconnue comme telle ou refusée, et au point
d'exécution, où toute commande contenant un caractère d'enchaînement est
rejetée. Placer le contrôle au seul point de passage couvre les vingt-quatre
actions des neuf pilotes ; le poser dans chaque pilote aurait laissé passer
celui qu'on oublie.

### Non corrigeables

Ces points ne relèvent pas d'un défaut mais d'un choix, d'une contrainte
d'environnement ou d'une décision d'exploitation.

| Point | Pourquoi il subsiste | Ce qui le contient |
|---|---|---|
| Console SSH | Exécuter des commandes est sa fonction même. La supprimer reviendrait à retirer la fonctionnalité | Réservée au rôle administrateur ; toute action est journalisée |
| Vérification TLS des équipements | Les routeurs présentent des certificats auto-signés. L'exiger empêcherait toute connexion | Ne concerne que le réseau local ; l'épinglage d'empreinte reste à faire |
| Conteneur en réseau hôte | Le balayage ARP ne fonctionne pas autrement : c'est une contrainte du protocole | Surface réduite, dépendances tenues à jour |
| Session administrateur volée | Un compte administrateur peut légitimement tout faire | Second facteur disponible, jetons révocables, verrouillage après échecs |
| Perte de `MASTER_KEY` | Le chiffrement au repos n'a de sens que si la clé vit ailleurs | Sauvegarde à la charge de l'exploitant |
| Exposition publique directe | L'application suppose un accès contrôlé en amont | À placer derrière un tunnel authentifié ou un VPN |
| Vulnérabilité inconnue | Aucun logiciel n'en est exempt | Dépendances tenues à jour, surface réduite, signalement documenté |
