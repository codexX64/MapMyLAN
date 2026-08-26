# Guide d'installation détaillé

## 1 · Choisir la machine

MapMyLAN doit être **sur le segment qu'il surveille**. Le balayage ARP ne
traverse pas les routeurs : une machine placée derrière un routage ne verra que
son propre segment.

Préférez une liaison filaire. En Wi-Fi, l'isolation des clients — souvent
activée par défaut sur les bornes — empêche de voir les autres appareils.

## 2 · Récupérer le projet

```bash
git clone https://github.com/CodexX64/mapmylan.git
cd mapmylan
cp .env.example .env
```

## 3 · Générer les secrets

Trois secrets sont nécessaires. Ne réutilisez pas ceux d'un autre projet.

```bash
{
  echo "POSTGRES_PASSWORD=$(openssl rand -base64 24)"
  echo "JWT_SECRET=$(openssl rand -base64 48)"
  echo "MASTER_KEY=$(openssl rand -base64 32)"
  echo "PASSWORD_PEPPER=$(openssl rand -base64 32)"
} >> .env
```

Retirez ensuite les lignes vides d'origine pour éviter les doublons.

> `MASTER_KEY` chiffre les identifiants de votre équipement réseau. La perdre
> les rend irrécupérables : il faudra les ressaisir. Sauvegardez-la ailleurs
> que sur la machine.

## 4 · Déclarer l'interface réseau

```bash
ip -o link show | awk -F': ' '{print $2}'
```

Reportez le nom dans `SCAN_INTERFACE`. Sur une machine à plusieurs interfaces,
choisissez celle qui porte le réseau à surveiller — pas une interface Docker,
pas une interface de tunnel.

## 5 · Démarrer

```bash
docker compose up -d --build
docker compose logs -f backend
```

Attendez la ligne annonçant l'écoute, puis ouvrez `http://localhost:8120`.

## 6 · Suivre l'assistant

**Compte administrateur.** Choisissez une phrase longue plutôt qu'un mot de
passe court et compliqué : la longueur pèse davantage que la variété.

**Authentification.** Le mot de passe seul suffit sur un réseau fermé. Dès que
l'accès sort de chez vous, ajoutez au moins un second facteur.

**Équipement réseau.** Le formulaire s'ajuste au constructeur.

*Pour UniFi*, créez d'abord un compte **local** sur la console, dans
*Settings → Admins & Users*, avec l'option d'accès local activée. Puis
renseignez l'adresse de la passerelle, le port 443 et ces identifiants. Le
certificat étant auto-signé, laissez la vérification TLS désactivée.

*Pour les constructeurs en SSH*, vérifiez que le service est activé sur
l'équipement et que le compte a les droits d'écriture — sans quoi la lecture
fonctionnera mais le blocage échouera.

**Plages.** Déclarez tout ce que votre réseau contient réellement. Une plage
oubliée est un pan du réseau invisible.

**Alertes.** Un bot de messagerie prévient en quelques secondes ; le courriel
laisse une trace écrite. Une seconde adresse dédiée à la réinitialisation du
mot de passe limite les dégâts si la boîte d'envoi est compromise.

## 7 · Après l'installation

- Videz `DEFAULT_ADMIN_PASSWORD` s'il a servi.
- Sauvegardez `MASTER_KEY` hors de la machine.
- Créez une première règle de défense : sans elle, rien ne sera bloqué
  automatiquement.

## Dépannage

**Le balayage ne trouve qu'un hôte.** L'interface est probablement mauvaise, ou
la plage déclarée ne correspond pas au réseau réel. Vérifiez avec `ip addr` et
`ip route`.

**« Connection lost before handshake ».** Un canal SSH est ouvert vers un port
qui parle HTTPS. Vérifiez le constructeur choisi : UniFi passe par l'API, pas
par SSH.

**Identifiants UniFi refusés.** Le compte utilisé est un compte Ubiquiti en
ligne. L'API locale n'accepte que les comptes locaux.

**Le mot de passe revient après un redémarrage.** `DEFAULT_ADMIN_PASSWORD` est
renseigné dans le `.env` et se réapplique à chaque démarrage. Videz-le.
