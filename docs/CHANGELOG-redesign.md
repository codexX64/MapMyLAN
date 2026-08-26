# MapMyLAN — version redessinée + connexion aux équipements

Projet complet, prêt à reconstruire. Aucun secret inclus (.env exclu).

## Depuis la capture précédente

Ce qui a été repris de l'installation déployée, dans l'ordre où ça a été fait.

### Relevé des VLAN
- Les segments ne se saisissent plus : ils sont relevés sur l'équipement.
  `ip_subnet` porte l'adresse de la **passerelle** suivie du préfixe, pas
  l'adresse du réseau — les deux sont donc calculées, jamais recopiées.
- Ordre **numérique**. Trié comme du texte, « VLAN 10 » passait devant
  « VLAN 2 » ; le tri se fait maintenant sur le numéro.
- Les WAN, VPN et liaisons de secours sont écartés du relevé : ce ne sont pas
  des segments du réseau local.
- Un VLAN disparu de l'équipement est signalé dans le compte-rendu, jamais
  effacé en silence.
- Les **adresses de passerelle** ne sont plus créées comme appareils. Une
  passerelle porte une adresse dans chaque segment ; l'inventaire n'en gardait
  aucune trace utile, juste des doublons de la même machine.

### Réservation d'adresse
- Le préfixe est figé par le segment choisi : seule la partie hôte se saisit.
- Vérification en direct contre les bornes **réelles** du sous-réseau, calculées
  depuis le préfixe. L'adresse de la passerelle est refusée : la donner
  couperait la sortie du segment.
- Le libellé dit ce qui se passe vraiment : MapMyLAN ne réécrit pas la
  configuration de la machine, il demande à la passerelle de toujours servir
  cette adresse à cette carte réseau.

### Trafic mondial
- Les **deux** tuples de conntrack sont lus. La traduction d'adresses masque la
  source dans le tuple aller ; sans le tuple retour, aucune connexion entrante
  n'apparaissait.
- Trois règles de signalement, et trois seulement : service sensible atteint
  depuis l'extérieur, appareil déjà mis à l'écart qui communique encore, note de
  risque déjà haute. Chaque flux signalé porte sa raison.
- Les flux signalés passent en rouge sur le globe, s'épinglent en haut du
  panneau, et s'ouvrent en fiche — détachable et déplaçable.
- Destination : trait plein vers la ville quand le nom d'hôte la donne,
  pointillé vers le pays d'enregistrement du préfixe sinon. C'est une
  déclaration au registre, pas une position ; le trait le dit.

### Globe
- La calotte nord se couvrait d'arcs concentriques et de rayons : le pas en
  longitude, arrondi à l'entier, se répétait d'une rangée à l'autre.
- Le semis suit maintenant une spirale d'or — latitude tirée du **sinus**
  réparti uniformément, longitude avançant de l'angle d'or — avec un bruit
  déterministe qui casse les stries. Même globe à chaque ouverture, aucune
  trame visible.

### Console SSH
- Hauteur fixe : on défile **dans** le terminal, pas dans la page.
- `clear`, `cls`, `/clear`, `!clear`, `?clear` effacent l'écran localement et ne
  partent jamais sur le fil.
- Le garde-fou anti-enchaînement est appliqué là où l'entrée vient d'un humain,
  et le refus dit précisément ce qui est refusé.

### Second facteur
- Trois moyens : clé d'accès (WebAuthn), application d'authentification (TOTP),
  salon de messagerie. Le code envoyé au salon vaut cinq minutes, cinq essais,
  et ne part qu'au salon enregistré.
- Correction d'une régression : une configuration de canal écrite sans la clé
  `enabled` faisait taire l'envoi sans le dire. `getConfig` la renvoie
  désormais explicitement.

### Sécurité — second audit, cinq constats
- Deux routeurs étaient montés **sans authentification**, dont un exposant une
  action qui exécute une commande sur l'équipement. Fermés.
- L'exposition réseau est réglable sans rien couper d'autorité :
  `BIND_ADDRESS` côté processus, `docker-compose.override.yml.exemple` côté
  frontend, inerte tant qu'il porte son suffixe. **`BIND_ADDRESS=127.0.0.1` est
  le mauvais réglage** : nginx joint l'API par la passerelle du pont Docker, pas
  par la boucle locale de l'hôte.
- Le bot part fermé : une liste vide veut dire « le salon principal », pas
  « tout le monde ».
- `credentials` n'est plus activé sur une origine `*`.

### Publication
- Plus aucune valeur propre à une installation dans le code : le relais de
  courrier et le préfixe de regroupement sont devenus des variables, vides par
  défaut.
- `mail-providers.js` figure enfin dans le dépôt, en deux exemplaires que la CI
  vérifie identiques, et le Dockerfile du backend l'emporte dans l'image —
  `routes/mail.ts` le charge par `require()` et levait sans lui au démarrage.

## Interface
- Deux apparences d'un même langage visuel : claire par défaut, sombre en
  option, bascule en haut à droite. Les trois anciens thèmes sont retirés ;
  une préférence enregistrée en « glass » ou « enterprise » retombe proprement.
- 38 pictogrammes dessinés pour l'app, tracés inline et recentrés
  mathématiquement dans leur boîte. Plus de sprite : le décalage d'icônes sous
  Safari ne peut plus se produire.
- Français / anglais avec sélecteur, préférence mémorisée. Français par défaut.
  Le squelette et l'écran équipement sont traduits ; les libellés internes aux
  autres pages se migrent clé par clé sans rien casser.
- Carte : trame en points, trait plein pour le filaire, pointillé pour le
  sans-fil, couleur neutre sauf sur le lien sélectionné.
- Notifications : troisième état « en cours d'activation » entre inactif et
  actif, pour un canal dont le jeton est enregistré mais qui n'a encore rien
  transmis. Il bascule seul en actif au premier envoi abouti.

## Connexion aux équipements réseau (nouvel écran « Équipement réseau »)
- Neuf constructeurs : UniFi (API locale), Asus-Merlin, OpenWrt, RouterOS,
  pfSense, Cisco IOS, Zyxel, EdgeOS, et un profil SSH générique.
- L'écran affiche les capacités déclarées par chaque adaptateur (bloquer,
  isoler, lister les clients, lire l'ARP, redémarrer…) : aucun bouton ne
  promet une action que le matériel ne sait pas faire.
- Reconnaissance automatique du constructeur à partir de la bannière SSH ou de
  la réponse HTTP, test de connexion, et deux vues « ce que l'équipement voit » :
  clients associés et table ARP — cette dernière rattrape les appareils muets
  que le balayage rate.
- Les identifiants sont chiffrés au repos et ne ressortent jamais de l'API.

## Correctifs de fond
- arp-scan : repli en cascade (interface explicite → voisinage noyau →
  table ARP du routeur) au lieu d'un échec sec, plus le setcap requis dans
  l'image.
- Doublons d'IP : service de dédoublonnage qui fusionne les entrées d'une même
  IP en gardant la plus pertinente ; le scanner se rabat sur l'IP quand la MAC
  change, au lieu de créer une nouvelle entrée.

## Base de données
Aucune migration à lancer à la main : `prisma db push` au démarrage du
conteneur crée les nouveaux champs du modèle SshDevice (transport, apiBaseUrl,
site, verifyTls).

## Identification du matériel (réécrite)
Le devineur de type passe d'une cascade de regex à un système à score
(`backend/src/services/classify.ts`). Chaque signal — fabricant OUI, service
mDNS, port ouvert, bannière nmap, système, NetBIOS, nom d'hôte — vote avec un
poids pour un ou plusieurs types ; le mieux noté gagne, et une confiance 0..1
est calculée à partir de sa part et de sa marge sur le second. Vingt types
distingués au lieu de neuf : nas, hypervisor, docker, pi, camera, tv, console,
voip, imprimante, tablette… La confiance est stockée dans les métadonnées et
s'affiche dans l'infobulle de la carte (« docker · 62 % »). Un appareil sans
signal reste « unknown » avec confiance 0 plutôt que d'être rangé au hasard.

## Carte (améliorée)
- Disposition automatique alignée sur ta convention d'adressage : le troisième
  octet range les nœuds par étage (infra, dockers, inférence, postes), la face
  wifi (dizaine) retombe dans la catégorie de sa machine, et chaque étage est
  trié par dernier octet pour que les deux faces d'un même appareil soient
  voisines.
- Les nœuds réutilisent le jeu de pictos unique : caméra, NAS, Pi, imprimante,
  téléviseur, console ont enfin leur dessin propre au lieu du point
  d'interrogation générique.

## Correctifs de découverte (cette itération)
- **Doublons ARP** : une IP qui répond avec plusieurs MAC (lignes « DUP: n »
  d'arp-scan) ne crée plus plusieurs appareils. Le parseur regroupe par IP,
  retient la MAC dont le fabricant est identifié, et conserve les autres comme
  cartes secondaires du même appareil.
- **Filtre de sous-réseau** : le tri se faisait sur un préfixe à trois octets
  (« 198.51.100. »), ce qui écartait silencieusement tout ce qui débordait sur un
  /22 ou plus large. Remplacé par un vrai test d'appartenance CIDR.
- **Passerelle** : un appareil qui porte l'adresse de la route par défaut, ou
  marqué routeur principal en base, est classé « router » avec une confiance de
  0,97 quels que soient ses ports. Sans cette règle, une box exposant SMB
  ressortait en « PC Windows ».
- **OUI de box** : TP-Link, Freebox, Livebox, Bbox, Technicolor, Sagemcom et
  Arcadyan reconnus comme routeurs.
- **Gammes de commutateurs** : les switchs Zyxel (GS/XGS/XS/MG) sont distingués
  de ses pare-feu (USG/ZyWALL), et les gammes TL-SG/TL-SF de TP-Link ne sont
  plus confondues avec ses box.

## Carte déduite (nouveau)
La construction automatique ne rattache plus les appareils « au hub du même
/24 ». Elle applique la convention d'adressage :

- racine = passerelle (drapeau routeur principal, ou route par défaut) ;
- commutateurs, bornes et routeurs secondaires pendent de la passerelle ;
- un appareil dont le troisième octet est inférieur à 10 est filaire : il passe
  par le commutateur s'il en existe un, sinon directement par la passerelle —
  c'est la déduction « pas vu directement par la passerelle, donc derrière le
  switch » ;
- un appareil dont le troisième octet dépasse 10 est sans fil : il est rattaché
  à la borne, ou à défaut au routeur secondaire qui en fait office ;
- deux entrées de même catégorie et même dernier octet sont les deux faces d'un
  même boîtier : elles restent deux nœuds distincts, chacun relié à son propre
  équipement, plus un lien « sibling » très discret qui dit la parenté.

Les liens tracés à la main ne sont jamais écrasés. Quand le contrôleur UniFi
sera en place, l'interrogation réelle (port de commutation, borne d'association)
remplacera la déduction, qui restera comme repli.
