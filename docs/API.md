# Contrat d'API — MapMyLAN 2.0

Ce document fait foi entre le serveur (`src/`) et l'interface (`web/`). Les
chemins et les formes JSON sont ceux de la 1.4.1 partout où c'était possible ;
chaque écart est signalé par **[2.0]**.

## 1. Conventions communes

### Authentification

- **Session du socle** : cookie `mapmylan-sid` (`__Host-mapmylan-sid` en
  HTTPS), posé par les routes `/api/compte/*`. Toute écriture (POST, PUT,
  PATCH, DELETE) exige l'en-tête `X-CSRF: <jeton>` (jeton rendu par
  `GET /api/compte/etat` → `session.csrf`) et une origine identique à celle du
  service. `web/compte.js` (`Api`) le fait déjà.
- **Jeton d'intégration** : `Authorization: Bearer mml_…` (créé dans
  Réglages → Intégrations) ou `Bearer hub_…` (amorcé par le Hub). Seules les
  routes marquées **jeton** l'acceptent ; ailleurs il reçoit 401. Un jeton
  n'est jamais lu dans un cookie. Pas de CSRF sur ce chemin (aucun navigateur
  ne pose cet en-tête tout seul).
- **[2.1] Jeton dérivé** : `Authorization: Bearer cer_<nom>_<hmac>`, calculé
  par le Hub pour un service voisin avec le jeton du Hub
  (`INTEGRATION_TOKEN_SEED`) : `hex(HMAC-SHA256(semence, "cerveau:" + nom))`.
  Rien n'est stocké ; MapMyLAN le vérifie par le même calcul, et changer le
  jeton du Hub les révoque tous. Mêmes routes que les jetons d'intégration ;
  rôle **membre** pour les noms de `JETONS_DERIVES_MEMBRE` (le Hub y pose
  celui de VIGIE), **lecture** pour les autres.
- **[2.0]** Les anciennes routes de comptes disparaissent : `/api/auth/*`
  (connexion, déconnexion, 2fa, premier démarrage, réinitialisation,
  changement de mot de passe, `me`, `needs-setup`, `bootstrap`, `totp/*`),
  `/api/users/*`, `/api/mfa/*`. Tout passe par le socle : `/api/compte/*` et
  les pages Comptes et Sécurité de `web/compte.js` (`porte()`,
  `pageSecurite()`, `pageComptes()`). « Qui suis-je » :
  `GET /api/compte/etat` → `session.compte` (`id`, `identifiant`, `role`…).
- **[2.0]** JWT, jeton en `localStorage` et cookie `mapmylan_csrf` retirés.

### Rôles

| 1.4.1 | 2.0 | Peut |
|---|---|---|
| `viewer` | `lecture` | lire, déplacer les plaques de la carte, parler à l'assistant |
| `operator` | `membre` | piloter le réseau : balayer, isoler, bloquer, éditer inventaire et carte |
| `admin` | `admin` | équipement, secrets, réglages, jetons, commandes, notifications, suppressions |

Colonne « Rôle » ci-dessous : le rôle minimal. **renfort** = l'action exige en
plus une confirmation d'identité de moins de cinq minutes (sinon 403 avec
`details.renfort: true` et `details.methodes`, que `web/compte.js` sait
traiter : `POST /api/compte/renfort`, puis rejouer la requête).

### Réponses et erreurs

- Succès : 200 (201 pour la création d'un jeton), corps JSON, `Cache-Control: no-store`.
- Erreur : `{ "error": "message lisible", "details"?: {...} }` avec
  400 (corps ou paramètre invalide — champ inconnu compris), 401 (pas de
  session ou jeton refusé), 403 (rôle, renfort, origine, CSRF), 404 (objet
  inconnu, **ou** qui n'existe pas pour cet appelant : les deux répondent
  pareil), 405, 409 (conflit), 413 (corps trop gros), 415 (pas du JSON),
  429 (débit ou plafond, `details.attendre` en secondes quand connu),
  502 (équipement ou service tiers en échec), 500 (`Erreur interne (réf. xxxx).`).
- Tout corps est validé strictement : un champ non déclaré ici est refusé (400).
- **[2.0]** Dans un `PATCH`, un champ facultatif envoyé à `null` ou `""` est
  remis à nul (effacé) ; un champ absent ne change pas. Seuls les champs
  marqués « effaçable » ci-dessous l'acceptent ; ailleurs `null` vaut « absent ».
- 502 et 503 portent un message écrit par MapMyLAN (équipement injoignable,
  clé d'hôte ou certificat différent de celui épinglé, service tiers en échec),
  jamais une trace interne.
- Identifiants : chaînes aléatoires (`[A-Za-z0-9_-]`, 16 caractères pour les
  créations 2.0, 25 pour les identifiants repris de la 1.4.1). Exception
  voulue : un VLAN est désigné par son numéro (1–4094).
- Dates : chaînes ISO 8601 UTC (`2026-09-17T10:12:00.000Z`), sauf dans le
  trafic où la 1.4.1 rendait déjà des millisecondes (`premier`, `dernier`,
  `plusAncien`, `quand`).

### Débit

600 requêtes par minute et par adresse, 120 par minute et par jeton
d'intégration ; quotas propres aux actions coûteuses (balayage, balayage
approfondi, ping, registres, logos, assistant, voix) : 429 au-delà.

Aucune liste n'est rendue sans borne : les paramètres `limit`/`limite` sont
bornés par leur schéma, et les listes sans paramètre ont un plafond fixe
(appareils 10 000, balayages d'une période 5 000, liens de la carte 50 000, zones 5 000, commandes et
commandes du bot 1 000 chacune, consoles et équipements 1 000, jetons 1 000,
boîtes mail 500, règles 500).

## 2. Formes communes

```
Device {
  id, ip, mac|null, hostname|null, customName|null, vendor|null, model|null, os|null,
  type, customType|null, vlan: int|null, zone|null, tags: string[], notes|null, role|null,
  status: "online"|"offline"|"suspect"|"quarantined"|"banned",
  trustScore, activityScore, vulnScore, dangerScore: int 0-100,
  scoreReasons: { trust|activity|vuln: [{ reason, delta }] } | null,
  whitelisted: bool, isMainRouter: bool, posX|null, posY|null, pinned: bool,
  firstSeen, lastSeen, metadata: object|null,
  ports: Port[], cves: CveMatch[], interfaces: Interface[]
}
Port       { id, deviceId, port, protocol, state, service|null, product|null, version|null, detectedAt }
CveMatch   { id, deviceId, cveId, cvss, severity, description, service|null, detectedAt }
Interface  { id, deviceId, mac|null, ip|null, type, label|null, posX|null, posY|null, isPrimary, createdAt }
History    { id, deviceId, event, data: object, createdAt }
Link       { id, fromId, toId, fromIfaceId|null, toIfaceId|null, type, speed|null, vlan|null, manual, createdAt }
Zone       { id, name, color, x, y, width, height, notes|null, createdAt }
Vlan       { id: int, name, subnet, description|null, color, isolated, gateway|null, networkId|null, createdAt }
ScanRun    { id, type, subnet, status: "running"|"complete"|"failed", hostsFound, startedAt, endedAt|null, error|null }
Alert      { id, severity, source, message, deviceId|null, deviceIp|null, deviceMac|null, acknowledged, metadata|null, createdAt }
LogEntry   { id, level: "info"|"warn"|"error"|"success", source, message, metadata|null, createdAt }
HostMetric { id, cpuPct, memPct, memUsedMB, memTotalMB, diskPct, tempC|null, loadAvg, netRxKBs, netTxKBs, uptimeSec, createdAt }
```

Chaînes bornées à l'écriture : noms 1–80 caractères, notes 4000, étiquettes
20 × 40, adresses IPv4 strictes (pas de zéro de tête), MAC `AA:BB:CC:DD:EE:FF`
ou avec tirets (rendue en majuscules à deux-points).

## 3. Temps réel **[2.0]**

`GET /api/flux` — rôle `lecture`, **session seulement** (pas de jeton).
Réponse `text/event-stream`. Remplace socket.io (`/ws`).

```
event: <nom>
data: <json>

```

Liste exhaustive des noms (ceux de la 1.4.1, `backend/src/ws/realtime.ts`) :

| Événement | `data` |
|---|---|
| `devices:updated` | `null` — relire `GET /api/devices` |
| `device:updated` | `{ id, …champs changés }` (scores, `status`, fabricant…) |
| `device:deleted` | `{ id }` |
| `scan:started` | `{ runId, subnet }` |
| `scan:progress` | `{ runId, phase: "discovery", hostsFound }` ou `{ runId, phase: "enriching", done, total }` |
| `scan:complete` | `{ runId, hostsFound }` |
| `alert:new` | `Alert`, ou `{ newDevice: true, device: Device-sans-relations }` |
| `log:new` | `LogEntry` |
| `topology:updated` | `null` — relire `GET /api/topology` |
| `host:metrics` | forme de `GET /api/host/stats` (toutes les 5 s) |

Une ligne de commentaire `: ping` part toutes les 25 s. Le flux se ferme quand
la session expire ou est révoquée (vérifié toutes les 30 s) : l'interface
rouvre avec `new EventSource('/api/flux')` (le cookie part tout seul), et
retombe sur la page de connexion si la réouverture répond 401. Au plus 6 flux
ouverts par session (429 au-delà) : un par onglet.

## 4. Routes

### Santé

| Méthode | Chemin | Rôle | Réponse |
|---|---|---|---|
| GET | `/api/health` | public | anonyme : `{ ok: true }` ; avec session ou jeton : `{ ok: true, status: "ok", version, time }` **[2.0]** ; base illisible : 503 `{ ok: false }` |
| GET | `/.well-known/security.txt` | public | texte (socle) |

### Appareils — `/api/devices`

| Méthode | Chemin | Rôle | Corps | Réponse |
|---|---|---|---|---|
| GET | `/api/devices` | lecture, jeton | — | `Device[]` trié par `lastSeen` décroissant |
| GET | `/api/devices/health/score` | lecture, jeton | — | `{ score }` |
| GET | `/api/devices/scans/latest` | lecture, jeton | — | `ScanRun` ou `null` |
| GET | `/api/devices/scans?heures=24` | lecture | — | `ScanRun[]` terminés depuis `heures` (1 ≤ heures ≤ 720), du plus ancien au plus récent, 5 000 au plus |
| GET | `/api/devices/scan/ranges` | lecture, jeton | — | `[{ cidr, label, enabled }]` |
| POST | `/api/devices/scan` | membre, jeton | `{ subnet?: CIDR }` | `{ ok: true }` (balayage lancé ; suivre par le flux ; 3 par minute) |
| POST | `/api/devices/manual` | membre | voir dessous | `Device` (409 si la MAC est déjà portée) |
| GET | `/api/devices/grouping/suggestions` | lecture | — | `[{ key, category, octet, ethernet?: {id,ip,name}, wifi?: {id,ip,name} }]` |
| POST | `/api/devices/dedupe` | membre | `{}` | `{ groups, removed }` |
| GET | `/api/devices/:id` | lecture, jeton | — | `Device` + `history: History[]` (50 derniers) |
| PATCH | `/api/devices/:id` | membre (admin pour `whitelisted`, `isMainRouter`) | voir dessous | `Device` |
| DELETE | `/api/devices/:id` | admin, renfort | — | `{ ok: true }` (409 pour le routeur principal) |
| GET | `/api/devices/:id/reservation` | lecture | — | `{ mac, ip, vlan, segments: [{ id, nom, sousReseau, passerelle, plage, pousseSurEquipement }] }` |
| POST | `/api/devices/:id/reservation` | membre | `{ vlan?: int, ip?: IPv4, retirer?: bool }` | `{ ok, sortie, ipActuelle, ipReservee, appliquee, message }` |
| POST | `/api/devices/:id/relancer-bail` | membre | `{}` | `{ ok, sortie, message }` |
| GET | `/api/devices/:id/ping` | lecture, jeton | — | `{ alive, latencyMs? }` (**[2.0]** 409 hors des plages déclarées ; 30 par minute) |
| POST | `/api/devices/:id/score` | membre | `{}` | `{ trustScore, activityScore, vulnScore, dangerScore, reasons }` |
| POST | `/api/devices/:id/deep-scan` | membre, jeton | `{}` | `{ ip, mac?, vendor?, os?, ports: [{ port, protocol, state, service, product, version }] }` (**[2.0]** 409 hors des plages déclarées ; 10 par minute) |
| GET | `/api/devices/:id/history` | lecture | — | `History[]` (100 derniers) |
| POST | `/api/devices/:id/ban` | membre, jeton | `{ reason?: string ≤200 }` | `{ ok: true, output }` |
| POST | `/api/devices/:id/quarantine` | membre, jeton | `{ reason?: string ≤200 }` | `{ ok: true, output }` |
| POST | `/api/devices/:id/unban` | membre, jeton | `{}` | `{ ok: true, output }` |
| POST | `/api/devices/:id/interfaces` | membre | `{ mac?, ip?, type?: "ethernet"\|"wifi"\|"virtual"\|"other", label?, posX?, posY? }` | `Interface` |
| PATCH | `/api/devices/:id/interfaces/:ifaceId` | membre | mêmes champs + `isPrimary?` | `Interface` (404 si l'interface n'est pas à cet appareil) |
| DELETE | `/api/devices/:id/interfaces/:ifaceId` | membre | — | `{ ok: true }` |
| POST | `/api/devices/:id/merge` | membre | `{ sourceId, keepName?: "source"\|"target", ifaceType?: "wifi"\|"ethernet" }` | `Device` (avec interfaces, ports, cves) |

`POST /api/devices/manual` : `{ ip?, mac?, hostname?, customName?, vendor?, model?, type?, customType?, posX?, posY?, notes? }`,
au moins un parmi `customName`, `hostname`, `ip`, `mac`.

`PATCH /api/devices/:id` : `{ customName?, customType?, vendor?, model?, vlan?: int|null, zone?, tags?: string[], notes?, role?, whitelisted?, isMainRouter?, posX?, posY?, pinned?, type? }`.
Effaçables : `customName`, `customType`, `vendor`, `model`, `vlan`, `zone`, `notes`, `role`, `posX`, `posY`.
`vlan` doit désigner un VLAN existant (400 sinon). Interfaces : `mac`, `ip`, `label`, `posX`, `posY` effaçables.
`type` et `customType` (ici et dans `POST /api/devices/manual`) : `router`, `firewall`, `switch`, `ap`, `server`, `nas`, `hypervisor`, `docker`, `vm`, `container`, `pc`, `computer`, `laptop`, `phone`, `tablet`, `printer`, `camera`, `tv`, `console`, `pi`, `iot`, `sensor`, `voip`, `unknown` (400 sinon).

**[2.0]** `subnet` de `POST /api/devices/scan` : une plage déclarée (Réglages
→ plages de balayage, ou sous-réseau d'un VLAN), préfixe /16 ou plus étroit ;
sinon 400. Sans `subnet`, toutes les plages actives.

### VLAN — `/api/vlans`

| Méthode | Chemin | Rôle | Corps | Réponse |
|---|---|---|---|---|
| GET | `/api/vlans` | lecture, jeton | — | `Vlan[]` par numéro croissant |
| POST | `/api/vlans/relever` | membre | `{}` | `{ lus, ajoutes, misAJour, inchanges, rattaches, orphelins: int[], ignores: string[], erreur? }` |
| POST | `/api/vlans` | membre | `{ id: 1-4094, name, subnet: CIDR /8 à /30, color?: "#rrggbb", description?, isolated?, pushToRouter?: bool (défaut vrai) }` | `{ vlan: Vlan, provision: { pushed, output, vendor? } \| null }` (409 si le numéro existe) |
| PATCH | `/api/vlans/:id` | membre | `{ name?, subnet?, color?, description? (effaçable), isolated? }` | `Vlan` |
| DELETE | `/api/vlans/:id?removeFromRouter=true\|false` | admin, renfort | — | `{ ok: true, provision: { output } \| null }` |

### Équipement réseau principal — `/api/router`

| Méthode | Chemin | Rôle | Corps | Réponse |
|---|---|---|---|---|
| GET | `/api/router/adapters` | lecture | — | `[{ id, label, transport, capabilities, needs }]` |
| GET | `/api/router` | lecture | — | `Routeur` ou `null` |
| POST | `/api/router/detect` | admin | `Identifiants` (secrets facultatifs) | voir dessous |
| POST | `/api/router/test` | admin | `{ useSaved: true }` ou `Identifiants` | `{ ok, info?, error?, detected?, adapter, capabilities }` |
| PUT | `/api/router` | admin, renfort | `Identifiants` + `name?` | `Routeur` |
| DELETE | `/api/router` | admin, renfort | — | `{ ok: true }` |
| GET | `/api/router/clients` | lecture | — | `{ supported, clients: [{ mac?, ip?, hostname?, vendor?, medium?, port?, swPort?, swMac?, apMac?, essid?, radio?, rssi?, uptimeSec?, blocked? }] }` (404 sans équipement, 502 si l'équipement échoue) |
| GET | `/api/router/arp` | lecture | — | `{ supported, entries: [même forme] }` |

```
Identifiants {
  vendor: id d'adaptateur, transport: "ssh"|"api", host: IPv4 ou nom, port?: int,
  username, password?, privateKey?, passphrase?,
  apiBaseUrl?: "https://<host>[:port]" (même hôte que host), site?: string, verifyTls?: bool,
  empreinteHote?: "SHA256:…", empreinteTls?: "AA:BB:…" (SHA-256 du certificat)
}
Routeur {
  id, name, host, port, username, vendor, transport, apiBaseUrl|null, site|null, verifyTls,
  hasPassword, hasPrivateKey, lastConnected|null, lastTestOk|null, lastTestAt|null, lastTestInfo|null,
  capabilities: string[], empreinteHote|null, empreinteTls|null
}
```

**[2.0] Confiance au premier usage.** Les secrets ne ressortent jamais
(`hasPassword`, `hasPrivateKey` seulement ; un champ secret laissé vide à
l'enregistrement garde celui qui est en place).

- SSH : `POST /api/router/detect` lit la clé d'hôte de l'équipement et rend
  `{ ok, detected, info, empreinteHote, typeCle }`. L'interface montre
  l'empreinte à l'administrateur ; `test` et `PUT` exigent ensuite
  `empreinteHote` égale à celle que l'équipement présente (sinon 409
  `{ error, details: { empreinteHote } }`). Une clé d'hôte qui change plus
  tard fait échouer toute connexion (« clé d'hôte différente ») jusqu'à un
  nouvel enregistrement.
- API (UniFi) : `detect` rend `{ ok, detected, info?, empreinteTls, sujetTls, certificatReconnu }`.
  Si `certificatReconnu` est faux (auto-signé), `test` et `PUT` exigent
  `empreinteTls` ; la connexion vérifie ensuite cette empreinte à chaque
  appel. `verifyTls: true` : certificat vérifié par les autorités du système.

### Consoles SSH — `/api/ssh`

| Méthode | Chemin | Rôle | Corps | Réponse |
|---|---|---|---|---|
| GET | `/api/ssh` | lecture | — | `[{ id, name, host, port, username, vendor, isMainRouter, lastConnected, createdAt, empreinteHote }]` (tous les équipements, celui piloté par API compris, comme en 1.4.1) |
| POST | `/api/ssh` | admin, renfort | `{ name, host, port?: 22, username, password?, privateKey?, passphrase?, vendor?, isMainRouter?, empreinteHote }` | `{ id, name, host, vendor, isMainRouter }` |
| POST | `/api/ssh/test` | admin | même corps (`name`, `empreinteHote` facultatifs) + `transport?`, `apiBaseUrl?`, `site?`, `verifyTls?`, `empreinteTls?` | sans empreinte : `{ ok: false, aConfirmer: true, empreinteHote, typeCle, banner? }` ; avec : `{ ok, banner?, error? }` (409 si l'empreinte n'est pas celle présentée) |
| DELETE | `/api/ssh/:id` | admin, renfort | — | `{ ok: true }` (409 pour une entrée pilotée par API) |
| POST | `/api/ssh/:id/exec` | admin, renfort **[2.0]** | `{ command: string ≤4096 }` | `{ stdout, stderr, code }` |

`exec` refuse toute commande qui enchaîne (`;`, `|`, `&`, `` ` ``, `$(`,
redirections, retour à la ligne) : 400.

### Carte — `/api/topology`

| Méthode | Chemin | Rôle | Corps | Réponse |
|---|---|---|---|---|
| GET | `/api/topology` | lecture, jeton | — | `{ links: Link[], zones: Zone[] }` |
| POST | `/api/topology/auto-build` | membre, jeton | `{}` | `{ created, deleted }` |
| POST | `/api/topology/links` | membre | `{ fromId, toId, type?: "ethernet"\|"wifi"\|"vpn"\|"trunk"\|"wan"\|"docker"\|"sibling", speed?, vlan? }` | `Link` (400 appareil inconnu ou identique, 409 lien existant) |
| PATCH | `/api/topology/links/:id` | membre | `{ type?, speed?, vlan?, fromIfaceId?, toIfaceId? }` (tous effaçables sauf `type` ; une interface doit appartenir à l'appareil de son extrémité, 400 sinon) | `Link` |
| POST | `/api/topology/links/:id/reverse` | membre | `{}` | `Link` (nouvel identifiant) |
| DELETE | `/api/topology/links/:id` | membre | — | `{ ok: true }` |
| POST | `/api/topology/zones` | membre | `{ name, color?, x, y, width?: 200, height?: 150, notes? }` | `Zone` |
| PATCH | `/api/topology/zones/:id` | membre | mêmes champs, tous facultatifs (`notes` effaçable) | `Zone` |
| DELETE | `/api/topology/zones/:id` | membre | — | `{ ok: true }` |
| POST | `/api/topology/positions` | lecture | `{ positions: [{ id, x, y }] ≤ 2000 }` | `{ ok: true }` |

### Machine hôte — `/api/host`

| Méthode | Chemin | Rôle | Réponse |
|---|---|---|---|
| GET | `/api/host/stats` | lecture, jeton | `{ cpuPct, cores\|null, memPct, memUsedMB, memTotalMB, diskPct, diskFreeGB\|null, tempC, loadAvg, netRxKBs, netTxKBs, uptimeSec, interfaces: [{ name, address, internal, role }], containers: [{ id, name, image, state, status }] }` |
| GET | `/api/host/history?minutes=60` | lecture | `HostMetric[]` (1 ≤ minutes ≤ 1440) |

**[2.0]** `cores` (cœurs de la machine, lus dans son `/proc`), `diskFreeGB`
(espace libre de la racine, en Gio) et `interfaces` (cartes de la machine,
première adresse IPv4 en notation CIDR, à défaut une IPv6 hors lien local ;
`role` : `"balayage"`, `"boucle locale"`, `"pont de conteneurs"` ou `"autre"`) :
la page Machine hôte de la 1.4.1 les affichait, mais son serveur ne les rendait pas.

### Système — `/api`

| Méthode | Chemin | Rôle | Corps | Réponse |
|---|---|---|---|---|
| GET | `/api/stats` | lecture, jeton | — | `{ total, online, offline, suspect, banned, quarantined, vlans, alerts, openPorts, subnet }` |
| GET | `/api/alerts?limit=50` | lecture, jeton | — | `Alert[]` (1 ≤ limit ≤ 500) |
| POST | `/api/alerts/:id/ack` | membre, jeton | `{}` | `{ ok: true }` |
| GET | `/api/logs?level=&limit=200` | lecture | — | `LogEntry[]` (1 ≤ limit ≤ 1000) |
| GET | `/api/settings` | lecture | — | `{ [clé]: valeur }` |
| PUT | `/api/settings/:key` | admin (renfort pour `sortie.autorisees`) | `{ value }` | `{ ok: true }` |
| GET | `/api/setup/status` | lecture | — | `{ complete, mainRouter: { id, host, name, vendor } \| null }` |
| POST | `/api/setup/complete` | admin | `{}` | `{ ok: true }` |
| GET | `/api/rules` | lecture | — | `[{ id, name, enabled, trigger, threshold, action, exceptWhitelist, createdAt }]` |
| PATCH | `/api/rules/:id` | admin, renfort | `{ name?, enabled?, threshold?: 0-100 (effaçable), action?: "alert"\|"quarantine"\|"ban"\|"disablePort", exceptWhitelist? }` | la règle |
| GET | `/api/memoire` | lecture | — | `{ synapse: { envoyes, echecs, enAttente, dernierEnvoi, erreur, perdus, relie } }` |
| POST | `/api/poste/test` | admin | `{}` | `{ ok, error?, messageId? }` (502 si échec ; 10 essais par minute) |

**[2.0] Réglages admis** (toute autre clé : 400) :

| Clé | Valeur |
|---|---|
| `setup.complete` | booléen |
| `scan.subnet` | CIDR IPv4 (plage par défaut) |
| `scan.interval` | entier 60–86400 (secondes) |
| `scan.ranges` | `[{ cidr, label?, enabled? }]` ≤ 32, préfixe /16 ou plus étroit |
| `topology.autoBuild` | booléen |
| `grouping.enabled` | booléen |
| `grouping.prefix` | deux octets, `"203.0"` |
| `grouping.wifiMultiplier` | entier 2–100 |
| `world.rdap` | booléen (interrogation des registres) |
| `world.logos` | booléen (logos des destinations ; éteint par défaut) |
| `world.retentionDays` | entier 0–3650 |
| `world.retentionMaxMb` | entier 0–100000 |
| `world.origin` | `"latitude,longitude"` ou `"latitude,longitude,Nom"` (Nom ≤ 60 caractères) : point d'observation du globe ; sans lui, 0,0 |
| `sortie.autorisees` | `string[]` ≤ 64 : noms d'hôte, adresses ou plages privées que MapMyLAN peut joindre en sortie (billetterie interne, relais SMTP interne…) |

### Notifications — `/api/notifications`

| Méthode | Chemin | Rôle | Corps | Réponse |
|---|---|---|---|---|
| GET | `/api/notifications` | lecture | — | `[{ channel, enabled, lastTested, lastSuccess }]` |
| GET | `/api/notifications/:channel` **[2.0]** | admin | — | `{ channel, enabled, config: {champs non secrets}, secrets: { <champ>: true } }` |
| PUT | `/api/notifications/:channel` | admin, renfort | `{ enabled: bool, config?: {…} }` | `{ ok: true }` |
| POST | `/api/notifications/:channel/test` | admin | `{ config?: {…} }` | `{ ok, error? }` (10 essais par minute) |
| DELETE | `/api/notifications/:channel` | admin, renfort | — | `{ ok: true }` |

Canaux (`:channel`) et leur `config` — un secret absent ou vide garde celui qui est en place :

- `telegram` : `{ token (secret), chatId: 1 à 20 chiffres, précédés d'un « - » pour un groupe }` ;
- `email` : `{ address, password (secret), provider?: "gmail"|"outlook"|"apple"|"autre", host?, port?, secure?: bool (vrai : TLS dès la connexion ; faux : STARTTLS exigé), from?, to?, autorite?: PEM }` ;
- `billetterie` **[2.0]** : `{ url (https, ou interne autorisée), cle (secret), entete?, marqueur?, seuil?: "p1".."p4" }` — les alertes y partent au format ticket structuré (`services/ticket.ts` de la 1.4.1, jusqu'ici non branché).
- **[2.0]** `sms` retiré (le manuel interdit le SMS, REQ-AUTH-009) : 400.

### Commandes (« quand X → faire Y ») — `/api/commands`

| Méthode | Chemin | Rôle | Corps | Réponse |
|---|---|---|---|---|
| GET | `/api/commands/triggers` | lecture | — | `[{ id, category, label, vars }]` |
| GET | `/api/commands/actions` | lecture | — | `[{ kind, label, needs }]` |
| GET | `/api/commands` | lecture | — | `Commande[]` |
| POST | `/api/commands` | admin, renfort | voir dessous | `Commande` |
| PATCH | `/api/commands/:id` | admin, renfort | mêmes champs, facultatifs | `Commande` |
| DELETE | `/api/commands/:id` | admin, renfort | — | `{ ok: true }` |
| POST | `/api/commands/:id/fire` | admin, renfort | `{ vars?: {…} }` | `{ ok: true }` — **[2.0]** cette commande seule, même inactive ou dans son délai (la 1.4.1 déclenchait toutes celles du même déclencheur) |

```
Commande { id, name, enabled, trigger, filter|null, actions, template|null, cooldownSec, lastFired|null, fireCount, createdAt, updatedAt }
corps : { name, trigger (id du catalogue), filter?: { minScore?, minCvss?, minPct?, deviceType?, severity?, contains? },
          actions: 1..10 × ({ kind: "notify", channels: ("telegram"|"email"|"billetterie")[] } | { kind: "log", level? }
                            | { kind: "quarantine" } | { kind: "ban", reason? } | { kind: "exec_ssh", deviceId, cmd }),
          template?: ≤2000, cooldownSec?: 0-86400, enabled? }
```

### Commandes du bot Telegram — `/api/bot-commands`

| Méthode | Chemin | Rôle | Corps | Réponse |
|---|---|---|---|---|
| GET | `/api/bot-commands/actions` | lecture | — | `[{ id, label, params, destructive }]` |
| GET | `/api/bot-commands` | lecture | — | `CommandeBot[]` |
| POST | `/api/bot-commands` | admin, renfort | voir dessous | `CommandeBot` (déclencheur ramené à « /minuscules » ; 409 s'il est pris) |
| PATCH | `/api/bot-commands/:id` | admin, renfort | mêmes champs, facultatifs | `CommandeBot` |
| DELETE | `/api/bot-commands/:id` | admin, renfort | — | `{ ok: true }` |
| POST | `/api/bot-commands/:id/run` | admin, renfort | `{ args?: string[] ≤5 }` | `{ reply }` |

```
CommandeBot { id, trigger ("/nom"), description|null, action, params|null, enabled, confirm, allowedChatIds: string[], cooldownSec, lastFiredBy|null, lastFiredAt|null, fireCount, createdAt, updatedAt }
corps : { trigger: "/[a-z0-9_]{1,32}", description?, action (id du catalogue), params?: { deviceId?, cmd?, text?, ip? },
          enabled?, confirm?, allowedChatIds?: string[] ≤20 (même forme que chatId), cooldownSec? }
```

### Registres — `/api/net`

| Méthode | Chemin | Rôle | Corps | Réponse |
|---|---|---|---|---|
| POST | `/api/net/whois` | lecture | `{ ips: string[] ≤64 }` | `{ actif, joignable?, fiches: [{ ip, reseau?, organisation?, pays?, domaine?, registre?, injoignable? }] }` (adresses privées écartées ; 20 appels par minute) |

### Trafic — `/api/traffic`

| Méthode | Chemin | Rôle | Réponse |
|---|---|---|---|
| GET | `/api/traffic/flows?limite=300&avant=&depuis=&sens=sortant\|entrant&suspect=true` | lecture, jeton **[2.1]** | `[{ id, src, dst, port, proto, premier, dernier, octets, paquets, vues, nom?, domaine?, operateur?, logo?, paysRegistre?, sens, suspect, raison? }]` (limite ≤ 5000) |
| GET | `/api/traffic/aggregats?depuis=` | lecture, jeton **[2.1]** | `{ connexions, destinations: [{ dst, nom?, domaine?, operateur?, logo?, paysRegistre?, sens, suspect, octets, dernier }], appareils: [{ src, octets }] }` |
| GET | `/api/traffic/state` | lecture, jeton **[2.1]** | `{ equipement?, quand?, commande?, erreur?, liaisonPerdue?, fluxVus?, cible: { id, nom, hote, port } \| null, ecartees: [{ id, nom, hote, port, transport }], total, signales, entrants, tailleMo, plusAncien, retentionJours, retentionMaxMo }` |
| POST | `/api/traffic/collect` | membre | même forme que l'état de collecte (6 par minute) |
| POST | `/api/traffic/purge` | admin | `{ parAge, parTaille, mo }` |
| DELETE | `/api/traffic/flows` | admin, renfort | `{ supprimes }` |

### Jetons d'intégration — `/api/integrations`

| Méthode | Chemin | Rôle | Corps | Réponse |
|---|---|---|---|---|
| GET | `/api/integrations` | admin | — | `Jeton[]` |
| POST | `/api/integrations` | admin, renfort | `{ name: 1-60, role: "lecture"\|"membre", expiresAt?: ISO dans le futur }` | 201 `Jeton & { token }` (le clair, une seule fois) |
| DELETE | `/api/integrations/:id` | admin, renfort | — | `Jeton` révoqué |

`Jeton { id, name, prefix, role, createdAt, lastUsedAt, expiresAt, revokedAt, etat: "actif"|"expire"|"revoque" }`.
**[2.0]** rôles `lecture`/`membre` (ex-`viewer`/`operator`) ; la portée
« accounts » disparaît (un jeton ne gère jamais les comptes).

### Vigie — `/api/vigie` **[2.1]**

Relais vers VIGIE (audit de sécurité), avec le jeton que le Hub a dérivé pour
MapMyLAN (`VIGIE_URL`, `VIGIE_JETON`). Session seulement : ces routes servent
la page Vigie et la fiche d'appareil. Sans VIGIE reliée : 409 ; VIGIE muette
ou qui refuse le jeton : 502.

| Méthode | Chemin | Rôle | Réponse |
|---|---|---|---|
| GET | `/api/vigie` | lecture | `{ relie }` |
| GET | `/api/vigie/etat` | lecture | état de VIGIE (`GET /api/etat` de VIGIE) |
| GET | `/api/vigie/evenements` | lecture | événements de la veille, gravité faible et plus |
| GET | `/api/vigie/audits/:id` | lecture | `{ audit, constats, priorites }` |
| GET | `/api/vigie/audits/:id/pdf` | lecture | le rapport PDF |
| GET | `/api/vigie/appareils/:id` | lecture | `{ audit, constats }` du dernier audit pour cet appareil |
| POST | `/api/vigie/audit` | membre | `{ id, deja }` |

### Logos — `/api/logos`

| Méthode | Chemin | Rôle | Réponse |
|---|---|---|---|
| GET | `/api/logos/:domaine` | lecture | image (PNG, ICO, JPEG, GIF, WebP — **[2.0]** jamais SVG), `Cache-Control: no-store`, 404 si éteint ou absent, 400 si le domaine est invalide, 429 au-delà de 60 domaines jamais cherchés par minute et par compte |

### Boîtes mail — `/api/mail`

| Méthode | Chemin | Rôle | Corps | Réponse |
|---|---|---|---|---|
| GET | `/api/mail/providers` | lecture | — | `[{ id, nom, besoins: string[], note }]` |
| POST | `/api/mail/resolve` | lecture | `{ provider, email, n? }` | `{ provider, nom, note, imap: {host,port,security}\|null, smtp, needs: string[] }` |
| POST | `/api/mail/detect` | lecture | `{ email }` | `{ provider \| null }` |
| POST | `/api/mail/verify` | admin | `{ email, role?: "both"\|"send"\|"receive", imap?: {host,port,security}, smtp?: {…}, password?, autorite? }` | `{ ok, inbox?, error?, details? }` (502 si échec ; sans `password`, celui de la boîte enregistrée ; 10 essais par minute) |
| GET | `/api/mail/mailboxes` | lecture | — | `Boite[]` |
| POST | `/api/mail/mailboxes` | admin, renfort | même corps sans `autorite`, + `provider?`, `active?` (une boîte existe par adresse : même adresse, mise à jour) | `Boite` |
| DELETE | `/api/mail/mailboxes/:id` | admin, renfort | — | `{ ok: true }` |

`Boite { id, email, provider, role, imap, smtp, active, hasPassword, lastTestAt, lastTestOk, lastTestInfo }`.
**[2.0]** `security` vaut `"ssl"` ou `"starttls"` ; `"none"` (identifiants en
clair) est refusé. Certificats toujours vérifiés.

### Assistant — `/api/assistant`

| Méthode | Chemin | Rôle | Corps | Réponse |
|---|---|---|---|---|
| GET | `/api/assistant` | lecture | — | `{ fil: Tour[], encours, ia: { prete, modele }, voix: { disponible, raison }, cerveau: { synapse, nom }, relances: string[], quota: { jour, restant } }` |
| POST | `/api/assistant/ask` | lecture | `{ text: 1-2000, voix?: bool }` | `Tour` |
| POST | `/api/assistant/stop` | lecture | `{}` | `{ arrete }` |
| POST | `/api/assistant/nouvelle` | lecture | `{}` | `{ ok: true }` |
| GET | `/api/assistant/voix` | lecture | — | `{ disponible, raison }` |
| POST | `/api/assistant/voix/transcrire` | lecture | audio brut, `Content-Type: audio/*` (415 sinon), ≤ 12 Mo | `{ texte, arret, ms }` (409 sans VOX, 502 si VOX échoue ; 20 par minute avec `dire`, **[2.0]** plafond journalier de la voix) |
| POST | `/api/assistant/voix/dire` | lecture | `{ text: 1-1500 }` | audio (`Content-Type` de VOX) |

`Tour { id, request, reply, widgets, duree, modele, voix, parole?, relais?, sources?, le }` — le fil est
propre à chaque compte. **[2.0]** Plafond journalier d'appels à l'IA par
compte et pour l'instance (429 au-delà, les administrateurs sont prévenus une
fois par jour), et par minute par compte. Les réponses directes (sans modèle)
ne comptent pas. **[2.0]** La voix a son propre plafond journalier, par compte
et pour l'instance : chaque transcription et chaque lecture confiée à VOX
compte (429 au-delà, les administrateurs sont prévenus).

### Comptes — `/api/compte/*` (socle)

Routes du socle, inchangées : `etat`, `installation`, `connexion` (+ `/totp`,
`/secours`, `/cle`), `deconnexion`, `securite`, `renfort`, `totp`, `cles`,
`secours`, `motdepasse`, `sessions`, `courriel`, `pas-moi`, `jeton`,
`export` (sous renfort : ajoute `mapmylan: { assistant, jetonsCrees }`),
`supprimer`, `admin/comptes`, `admin/politique`, `admin/journal`,
`admin/sessions/fermer-tout`. Voir `socle/README.md` et `socle/src/portail.js`.

## 5. Fichiers statiques

- `/` et `/<chemin>` : `web/` (`index.html` porte `__NONCE__`, remplacé par le
  nonce de la politique de contenu). Un chemin sans extension inconnu rend
  `index.html` (lien gardé en favori) ; tout autre fichier absent : 404 JSON.
- `/socle/<chemin>` : `socle/web/` (SOMA, `compte.js`, polices).
- `/confidentialite.txt` : `web/confidentialite.txt`.
- Politique de contenu : celle du socle (`script-src 'self' 'nonce-…'`,
  aucune source tierce), plus `img-src blob:` pour le détourage local d'un
  logo choisi par l'utilisateur.
- Politique des permissions : celle du socle (toutes les fonctions refusées),
  sauf `microphone=(self)` pour la dictée vocale de l'assistant.
