<div align="center">

<img src="docs/logo.png" alt="MapMyLAN" height="120">

# MapMyLAN

**Cartographie, surveille et défend ton réseau local.**

Découverte automatique des appareils · Topologie mesurée · Détection de vulnérabilités
Blocage sur ton propre routeur · Alertes en direct

[**Essayer la démonstration →**](https://demo.codex64.fr/mapmylan)

</div>

---

## Éditions

**MapMyLAN Codex64** est l'édition publique, celle de ce dépôt. C'est le seul
code : il fonctionne seul et n'a besoin d'aucun service annexe.

Une installation qui veut greffer un comportement qui lui est propre — base de
connaissances, entrepôt de métriques, billetterie interne — dépose un module
dans `extensions/` plutôt que de forker le projet. Rien à déclarer, rien à
recompiler. Voir [extensions/README.md](extensions/README.md).

## Ce que fait MapMyLAN

MapMyLAN parcourt les plages que tu lui déclares, identifie chaque appareil,
surveille ses ports ouverts et te prévient quand quelque chose sort de
l'ordinaire. Quand une règle se déclenche, l'action est exécutée **sur ton
équipement réseau** — le blocage est réel, pas symbolique.

Trois sources de découverte sont interrogées en parallèle et fusionnées :

| Source | Ce qu'elle apporte |
|---|---|
| Balayage ARP | Ce qui a communiqué récemment sur le segment |
| Balayage ping | Ce qui répond aux sollicitations |
| Équipement réseau | Ce qu'il porte réellement, y compris les appareils muets |

L'équipement fournit en outre le **port de commutation** et la **borne
d'association** de chaque client, ce qui permet de construire une topologie
mesurée plutôt que déduite. Quand plusieurs adresses MAC apparaissent derrière
un même port, un commutateur non géré est inséré automatiquement à cet endroit.

## Les segments viennent de l'équipement

Les VLAN ne se saisissent pas : ils sont **relevés** sur la passerelle. Le nom et
le sous-réseau viennent d'elle, l'ordre est numérique — trié comme du texte,
« VLAN 10 » passerait devant « VLAN 2 » — et un segment disparu est signalé dans
le compte-rendu du relevé, jamais effacé en silence. Les adresses de passerelle
sont écartées de l'inventaire : ce ne sont pas des appareils.

Réserver une adresse suit la même logique. Le préfixe est figé par le segment
choisi, seule la partie hôte se saisit, et elle est vérifiée en direct contre
les bornes réelles du sous-réseau. MapMyLAN ne réécrit pas la configuration de
la machine — personne ne peut faire ça à distance : il demande à la passerelle
de toujours servir cette adresse à cette carte réseau.

## Le trafic, dans les deux sens

Les connexions relevées sur la passerelle sont lues dans les **deux tuples** de
conntrack : quand la traduction d'adresses masque le tuple aller, c'est le tuple
retour qui porte la vraie source. Sans cela, les connexions **entrantes** —
celles qui comptent le plus — restent invisibles.

Trois règles, et trois seulement, font passer un flux en rouge : un service
sensible atteint depuis l'extérieur, un appareil déjà mis à l'écart qui
communique encore, une note de risque déjà haute. Chaque flux signalé porte la
raison qui l'a signalé — aucun score global, aucune appréciation.

## Équipements pris en charge

| Constructeur | Transport | Blocage | Clients | Ports |
|---|---|:-:|:-:|:-:|
| Ubiquiti UniFi | API locale HTTPS | ✅ | ✅ | ✅ |
| Asus / Merlin | SSH | ✅ | ✅ | — |
| OpenWrt | SSH | ✅ | ✅ | — |
| MikroTik RouterOS | SSH | ✅ | ✅ | ✅ |
| pfSense / OPNsense | SSH | ✅ | ✅ | — |
| Cisco IOS | SSH | ✅ | ✅ | ✅ |
| Ubiquiti EdgeOS | SSH | ✅ | ✅ | — |
| Zyxel | SSH | ✅ | — | — |
| Générique | SSH | commandes libres | — | — |

> **UniFi** exige un compte **local**, créé dans *Settings → Admins & Users*
> avec l'option d'accès local. Les identifiants du compte Ubiquiti en ligne
> sont refusés par l'API locale.

---

> **Note du mainteneur** — ce dépôt ne contient pas encore la totalité du
> travail réalisé. Voir [docs/ETAT.md](docs/ETAT.md) pour la liste des éléments
> à récupérer, dont plusieurs correctifs de sécurité.

## Installation

### Prérequis

- Docker et Docker Compose
- Une machine sur le réseau à surveiller, reliée en filaire de préférence
- Un accès administrateur à ton routeur

### Mise en route

```bash
git clone https://github.com/CodexX64/mapmylan.git
cd mapmylan
cp .env.example .env
```

Ouvre le `.env` et renseigne au minimum les trois secrets. Ils se génèrent
ainsi :

```bash
echo "POSTGRES_PASSWORD=$(openssl rand -base64 24)"
echo "JWT_SECRET=$(openssl rand -base64 48)"
echo "MASTER_KEY=$(openssl rand -base64 32)"
```

Puis :

```bash
docker compose up -d --build
```

L'interface écoute sur `http://localhost:8120`. Au premier lancement, un
assistant te guide : création du compte, choix de l'authentification, connexion
à l'équipement, déclaration des plages, premier balayage.

### Interface réseau

Le balayage ARP a besoin d'être sur le même segment que les appareils. Le
conteneur backend tourne donc en réseau hôte. Précise l'interface à utiliser :

```bash
ip -o link show | awk -F': ' '{print $2}'
```

Reporte le nom dans `SCAN_INTERFACE`.

---

## Configuration

Tout se règle depuis l'interface, sauf ce qui doit exister avant le premier
démarrage. Le fichier `.env` ne contient que cela.

| Variable | Rôle |
|---|---|
| `POSTGRES_PASSWORD` | Mot de passe de la base |
| `JWT_SECRET` | Signature des jetons de session |
| `MASTER_KEY` | Chiffrement des identifiants d'équipement au repos |
| `PASSWORD_PEPPER` | Facultatif — poivre ajouté au hachage des mots de passe |
| `SCAN_INTERFACE` | Interface réseau du balayage |
| `SCAN_SUBNET` | Plage initiale, remplacée ensuite par celles de l'interface |
| `DEFAULT_ADMIN_USER` | Reprise en main après oubli — laisser vide en usage normal |
| `DEFAULT_ADMIN_PASSWORD` | Idem. **Vide par défaut**, sinon réappliqué à chaque démarrage |

> `DEFAULT_ADMIN_PASSWORD` doit rester **vide** en fonctionnement normal.
> Renseigné, il réécrit le mot de passe du compte à chaque redémarrage du
> conteneur, ce qui annule tout changement fait depuis l'interface.

### Plages balayées

Un réseau tient rarement dans un seul sous-réseau. Déclare-en autant que
nécessaire depuis *Réglages → Plages balayées* : le DHCP sur l'une,
l'infrastructure sur une autre, un équipement resté sur son adressage d'usine
sur une troisième.

Elles sont parcourues **l'une après l'autre**, jamais simultanément : deux
balayages ARP en parallèle saturent la carte réseau et faussent les résultats.

---

## Sécurité

MapMyLAN manipule des identifiants d'équipement réseau et peut couper l'accès à
des appareils. Les choix suivants en découlent.

**Mots de passe.** Hachés en Argon2id — 32 Mio de mémoire, trois passes — ce qui
rend les attaques par matériel dédié inintéressantes. Les empreintes bcrypt
héritées d'une version antérieure sont vérifiées puis réencodées silencieusement
à la première connexion réussie. Un poivre facultatif, tiré de l'environnement,
rend une base exfiltrée seule inexploitable.

**Authentification.** Trois preuves peuvent se combiner : mot de passe, clé
d'accès et second facteur. La clé d'accès s'appuie sur WebAuthn — la partie
privée ne quitte jamais l'appareil, et la clé est liée à l'origine, donc
inutilisable sur un site qui imiterait le tien.

**Identifiants d'équipement.** Chiffrés au repos en AES-256-GCM avec `MASTER_KEY`.
Ils ne redescendent jamais vers le navigateur.

**Exposition publique.** Si tu ouvres MapMyLAN sur un domaine, place-le derrière
un accès authentifié — tunnel avec contrôle d'accès, ou VPN. L'application n'est
pas conçue pour être exposée nue sur Internet.

Une faille à signaler ? Voir [SECURITY.md](SECURITY.md).

---

## Démonstration

Une démonstration complète est disponible sur
**[demo.codex64.fr/mapmylan](https://demo.codex64.fr/mapmylan)** — assistant
de première configuration, carte, trafic mondial, inventaire, réglages. Toutes
les données y sont fictives et les adresses appartiennent aux plages réservées à
la documentation.

Elle est aussi dans ce dépôt : `demo/index.html`, à ouvrir directement dans un
navigateur.

---

## Licence

MIT — voir [LICENSE](LICENSE).

La mention de copyright doit être conservée dans toute redistribution, y compris
dans les travaux dérivés. C'est une obligation de la licence, pas une
convention.

---

<div align="center">

**MapMyLAN Codex64** — [CodexX64](https://github.com/CodexX64) · [codex64.fr](https://codex64.fr)

</div>
