# ASSETS.md — Inventaire des actifs et des données (GOV-002)

Inventaire de référence de MapMyLAN : routes exposées, magasins de données et leur
sensibilité, services tiers et clés employées, et emplacement de chaque secret.
À tenir à jour à chaque ajout de fonctionnalité.

_Dernière révision : 2026-08-18 (audit de sécurité)._

## 1. Surfaces exposées

| Surface | Détail |
|---------|--------|
| Frontend | SPA statique servie par nginx (port publié `8090:80`). En-têtes de sécurité + CSP posés par nginx. |
| API | `/api/*`, proxifiée par nginx vers le backend `:4000`. Toutes les routes sauf `/api/health` et `/api/auth/login` exigent une session. |
| Temps réel | WebSocket `/ws` (socket.io), authentifié par le cookie de session (vérif. signature + version de jeton). |
| Base de données | PostgreSQL, publié sur `127.0.0.1:5432` uniquement. |
| Cache | Redis, publié sur `127.0.0.1:6379` uniquement. |
| Socket Docker | Jamais monté dans le backend : accès en lecture seule via `docker-socket-proxy` (`127.0.0.1:2375`, `CONTAINERS=1` seul). |

### Routes API (préfixe `/api`)

| Montage | Auth | Rôle requis |
|---------|------|-------------|
| `/auth` (`login`, `logout`, `change-password`) | publique / session | — |
| `/devices` | session | mutations ouvertes aux utilisateurs authentifiés |
| `/vlans` | session | — |
| `/ssh` | session | `admin` (création/suppression), `admin`+`operator` (exec) |
| `/topology` | session | — |
| `/host` | session | — |
| `/commands` | session | `admin` (création/modif/suppression/déclenchement) |
| `/bot-commands` | session | `admin` (création/modif/suppression/exécution) |
| `/router` | session | `admin` |
| `/` (system : stats, settings, notifications, rules, alerts, logs, setup) | session | `admin` sur les écritures sensibles |

## 2. Magasins de données et sensibilité

| Modèle Prisma | Contenu | Sensibilité |
|---------------|---------|-------------|
| `User` | identifiants (empreinte Argon2id + poivre), rôle, version de jeton, verrouillage | **Élevée** (authentification) |
| `SshDevice` | hôte/port/utilisateur d'équipement + secrets **chiffrés** (`passwordEnc`, `privateKeyEnc`, `passphraseEnc`, AES-256-GCM) | **Critique** (accès routeur) |
| `Device`, `Interface`, `Port`, `CveMatch`, `DeviceHistory` | inventaire réseau (IP, MAC, noms, CVE) | Moyenne (données personnelles au sens RGPD : cartographie d'un réseau) |
| `TopologyLink`, `Zone`, `Vlan` | topologie et segmentation | Faible |
| `Alert`, `LogEntry`, `ScanRun`, `HostMetric` | événements, journaux, métriques | Faible→Moyenne (les journaux ne contiennent pas de secret) |
| `Setting`, `NotificationConfig` | réglages ; `NotificationConfig` porte des clés de notification (token Telegram, SMTP, Twilio) | **Élevée** (clés tierces) |
| `BotCommand`, `NotificationCommand`, `SecurityRule` | automatisations définies par l'admin (dont `exec_ssh`) | Élevée (peuvent déclencher des actions) |

## 3. Services tiers et clés employées

| Service | Usage | Clé / secret | Où |
|---------|-------|--------------|-----|
| Telegram Bot API | notifications + bot de commandes | token de bot | `NotificationConfig` (base), appelé serveur-side uniquement |
| SMTP (nodemailer) | courriels d'alerte | identifiants SMTP | `NotificationConfig` |
| Twilio | SMS d'alerte | SID + auth token | `NotificationConfig` |
| Équipements réseau (SSH/UniFi) | scan, défense, provisioning | identifiants chiffrés | `SshDevice` (`*Enc`, AES-256-GCM) |
| SYNAPSE (édition homelab uniquement) | envoi d'événements internes | `SYNAPSE_TOKEN` (Bearer) | variable d'environnement ; URL restreinte au réseau interne |

Aucune clé tierce n'est exposée au navigateur. Aucune variable `VITE_*` secrète n'est compilée dans le bundle.

## 4. Secrets et leur emplacement

| Secret | Rôle | Emplacement | Rotation |
|--------|------|-------------|----------|
| `JWT_SECRET` | signature des jetons de session | environnement (`.env`) | invalide toutes les sessions |
| `MASTER_KEY` | dérive la clé AES des identifiants d'équipement | environnement | perte = identifiants irrécupérables |
| `PASSWORD_PEPPER` | poivre HMAC des mots de passe | environnement (hors base) | change l'empreinte de tous les mots de passe |
| `POSTGRES_PASSWORD` | accès base | environnement | — |
| `DEFAULT_ADMIN_PASSWORD` | reprise en main du compte admin | environnement (vide en fonctionnement normal) | à revider après usage |
| `SYNAPSE_TOKEN` | Bearer d'ingestion (homelab) | environnement | par service |

Tous vivent dans l'environnement / un gestionnaire de secrets, jamais dans le dépôt.
`.gitignore` exclut `.env`, `.env.*`, `*.pem`, `*.key`, dumps et journaux.

## 5. Frontières de confiance (rappel)

navigateur → nginx (CDN/edge) → backend → base ; backend → API tierces ; fournisseurs (webhook Telegram) → endpoints ; fichiers importés → traitement → autres navigateurs. Chaque flèche est un point de validation/authentification/autorisation, indépendamment de ce que promet l'émetteur.
