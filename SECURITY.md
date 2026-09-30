# Security compliance — MapMyLAN

Standard: Project Baseline Requirements & Security Manual, Edition 2.0 (258 controls)
Audited: 2026-09-30   ·   Owner: Codex64   ·   Status: NON-COMPLIANT

## Summary
| Part | Controls | Pass | Fail | N/A | Unknown |
|---|---|---|---|---|---|
| I — Baseline requirements | 68 | 38 | 24 | 1 | 5 |
| II — Security controls | 190 | 88 | 38 | 63 | 1 |
| Total | 258 | 126 | 62 | 64 | 6 |

## Authentication posture
Deux publics. Les humains passent par le socle commun, embarqué avec ses essais : quatre facteurs cumulables sur chaque compte — mot de passe (Argon2id, 64 Mio, 3 passes, parallélisme 4, plancher 19 Mio / 2 / 1, rehachage transparent, empreintes Argon2id de la 1.4.1 reprises avec leur poivre, liste de fuites locale, 12 à 1024 caractères), application TOTP (RFC 6238, secret généré côté serveur et scellé AES-256-GCM, QR code dessiné dans le navigateur, rejeu refusé), clés d’accès WebAuthn (résidentes, vérification de l’utilisateur exigée, jusqu’à vingt, nommées et révocables) et dix codes de secours de 100 bits hachés. Politique par facteur : mot de passe et TOTP facultatifs, clé requise pour les administrateurs, qui tiennent deux facteurs dont une clé (deux facteurs sans clé en mode HTTP dégradé, affiché partout). Un mot de passe seul n’ouvre qu’une session d’inscription. Sessions serveur (jeton de 256 bits, empreinte seule en base), renouvelées à chaque changement de niveau, 12 heures au plus et 60 minutes d’inactivité, listées et révocables une à une ou toutes ; le flux temps réel d’une session fermée est coupé. Renfort de cinq minutes avec le facteur le plus fort avant tout changement de facteur, de rôle, d’adresse d’alerte, avant un export, une suppression, l’enregistrement d’un équipement ou d’une boîte mail, une commande à distance, un jeton d’intégration ou un réglage de sécurité. Rôles : lecture (voit le réseau), membre (pilote le réseau : balayer, bloquer, isoler, cartographier), administrateur (équipements, consoles, canaux, automatismes, comptes). Les programmes (le Hub, un script) présentent un jeton d’intégration Bearer de 256 bits (`mml_…`, ou celui du Hub semé par INTEGRATION_TOKEN_SEED), gardé en SHA-256, montré une fois, au rôle lecture ou membre, jamais administrateur, avec une échéance facultative, révocable d’un geste, admis seulement sur les routes marquées ; un jeton présenté et refusé n’est jamais remplacé par la session. Limiteur persistant par adresse et par compte, preuve de travail après trois échecs, paliers de verrouillage.

## Findings (audit before fixes)
Relevés en lecture seule avant toute correction, classés par gravité ; chacun est corrigé dans cette passe, un sujet par commit, avec son essai.

| # | Gravité | Contrôles | Constat | Correction prévue |
|---|---|---|---|---|
| C1 | CRITICAL | SEC-SECRETS-003, REQ-CFG-001 | Toute adresse sans extension reçoit l’interface : `/.env` et `/.git/config` répondent 200 (annexe B.2, B.4). Aucun fichier n’est lu, mais une sonde conclut à une fuite et la règle « tout segment caché → 404 » n’est pas tenue. | aucun repli vers l’interface pour un chemin dont un segment commence par un point ; 404 |
| C2 | HIGH | REQ-CFG-005, SEC-SECRETS-006, SEC-LOG-007 | La rotation de SOCLE_CLE ne rescelle que les secrets TOTP : les secrets des équipements, des boîtes mail et des canaux deviennent illisibles une fois la clé ancienne retirée, alors que le manifeste annonce le contraire. | rescellement au démarrage sous la clé neuve, en une transaction ; exercice de bout en bout dans les essais ; procédure au README |
| C3 | HIGH | SEC-LLM-003 | L’état du réseau (noms d’appareils, messages d’alerte, bannières : texte choisi par n’importe quel appareil du réseau) et le texte rendu par SYNAPSE entrent dans le message système sans clôture. | données cloisonnées entre marqueurs qu’elles ne peuvent pas contenir, consigne qui le dit |
| C4 | HIGH | REQ-DATA-004, REQ-DATA-005, SEC-LOG-001, SEC-LOG-004 | Six routes d’administration sans trace (reconnaissance et essai d’équipement, essai de console, essais de canal, de boîte et du relais) ; les 429 des quotas propres aux routes ne sont pas journalisés, donc pas vus de la vigie ; les actions destructrices du bot Telegram ne vont qu’au journal de service, que l’application réécrit. | trace au journal chaîné ; 429 journalisés au même endroit ; actions du bot tracées |
| C5 | HIGH | REQ-WEB-003, SEC-HDR-005, SEC-BE-001 | Les logos, réponses authentifiées, sont gardés une semaine par le navigateur ; une réponse 429 du débit global part sans en-tête de sécurité. | no-store ; en-têtes posés avant le débit |
| C6 | MEDIUM | REQ-WEB-008, SEC-API-002, SEC-API-003 | Sept listes sans borne (commandes, commandes du bot, liens et zones de la carte, consoles, jetons, boîtes) ; les logos déclenchent jusqu’à quatre requêtes sortantes par domaine inconnu, sans quota. | plafond sur chaque liste ; quota par compte des recherches de logo |
| C7 | MEDIUM | SEC-API-007 | Écritures multiples hors transaction : ports d’un appareil effacés puis réinsérés un à un ; fiche et historique écrits séparément à l’ajout manuel, à la modification, au blocage et au relevé d’un balayage. | transactions |
| C8 | MEDIUM | SEC-INFRA-004 | Le conteneur reçoit NET_ADMIN, que rien n’exige (nmap, arp-scan et ping fonctionnent avec NET_RAW seul), et tourne sans no-new-privileges ; nmap, lancé par le service, tient NET_RAW et NET_ADMIN dans l’espace réseau de l’hôte. | NET_RAW seul, no-new-privileges posé, capacité ambiante transmise par le point d’entrée |
| C9 | MEDIUM | SEC-PRIV-003, SEC-PRIV-006 | La notice de confidentialité décrit les destinataires par catégorie sans les nommer. | nommer chaque destinataire |
| C10 | MEDIUM | REQ-ANON-002, REQ-ANON-007 | Deux chemins personnels dans un outil de développement, un nom de machine réaliste dans un commentaire d’exemple. | chemins relatifs au dépôt, argument obligatoire ; exemple générique |

Écarts d’anonymat de l’historique publié (REQ-ANON-001, -002, -004, -006, -008) : hors de portée d’une correction, action H12.


## Control status
| ID | Severity | Status | Evidence | Notes |
|---|---|---|---|---|
| REQ-AUTH-001 | CRITICAL | PASS | `socle/src/comptes.js:24` ; mot de passe, TOTP, clés et codes de secours cumulables : essai `socle/test/parcours.test.js:135` | socle embarqué, ses essais rejoués par la vérification de MapMyLAN (`.github/workflows/verification.yml:31`) ; QR code du TOTP dessiné dans le navigateur (`socle/web/qr.js:240`) |
| REQ-AUTH-002 | CRITICAL | PASS | `socle/src/comptes.js:27` ; `socle/src/index.js:49` ; réglable sans déploiement : `socle/src/portail.js:363` | défaut : mot de passe et TOTP facultatifs, clé requise pour les administrateurs |
| REQ-AUTH-003 | CRITICAL | PASS | `socle/src/webauthn.js:26` ; vingt clés nommées : `socle/src/comptes.js:35` ; renommer et retirer : `socle/src/portail.js:291` | liste avec dates de création et d’usage dans la page Sécurité ; les clés de la 1.4.1, liées à l’origine de l’ancienne interface, ne sont pas reprises (`src/migration.js:11`) |
| REQ-AUTH-004 | CRITICAL | PASS | `socle/src/webauthn.js:46` ; origine `socle/src/webauthn.js:47` ; rpIdHash `socle/src/webauthn.js:103` | défi à usage unique lié à la session, UP et UV exigés, signature et compteur vérifiés |
| REQ-AUTH-005 | CRITICAL | PASS | `socle/src/comptes.js:623` ; renfort et fermeture des autres sessions : `socle/src/comptes.js:639` | la notification part à l’adresse vérifiée quand un relais existe (voir REQ-AUTH-014) |
| REQ-AUTH-006 | CRITICAL | PASS | `socle/src/comptes.js:828` ; jeton de 20 minutes, haché, unique : `socle/src/comptes.js:33` | essai `socle/test/parcours.test.js:218` ; lien émis en ligne de commande, tracé : `src/cli.js:61` |
| REQ-AUTH-007 | HIGH | PASS | `socle/src/comptes.js:36` ; 100 bits, haché Argon2id, usage unique : `socle/src/comptes.js:423` | alerte « secours.utilise » (courriel si relais, voir REQ-AUTH-014) |
| REQ-AUTH-008 | HIGH | PASS | `socle/src/totp.js:35` ; rejeu refusé : `socle/src/comptes.js:515` | RFC 6238, 6 chiffres, 30 s, ±1 pas, secret scellé AES-256-GCM ; les secrets TOTP de la 1.4.1, en clair, sont scellés à la reprise (`src/migration.js:11`) |
| REQ-AUTH-009 | CRITICAL | PASS | aucune voie SMS ni code par courriel : `grep -rniE "twilio\|sendSms\|vonage" socle/src src` → 0 ; le canal SMS de la 1.4.1 est refusé (`src/api/systeme.js:126`) ; connexions possibles : `socle/src/comptes.js:356`, `socle/src/comptes.js:382`, `socle/src/comptes.js:404`, `socle/src/comptes.js:469` | un mot de passe seul n’ouvre qu’une session d’inscription |
| REQ-AUTH-010 | CRITICAL | PASS | `socle/src/limiteur.js:20` (SQLite, par adresse et par compte, paliers de verrou, preuve de travail) ; appliqué à mot de passe, TOTP, secours, clé, adresse d’alerte ; jetons d’intégration inconnus : `src/api/acces.js:17` | annexe B.4 : 401 trois fois, puis 428 (preuve de travail exigée) ; essai `socle/test/parcours.test.js:156` |
| REQ-AUTH-011 | HIGH | PASS | vérification leurre : `socle/src/argon.js:110` ; message unique | essai `socle/test/parcours.test.js:81` |
| REQ-AUTH-012 | HIGH | PASS | `socle/src/comptes.js:867` : l’adresse n’existe que dans le jeton haché tant qu’elle n’est pas vérifiée ; `socle/src/comptes.js:876` | l’adresse ne sert qu’aux alertes : ni identifiant, ni récupération, ni droit ; pas d’inscription libre (invitation seulement) |
| REQ-AUTH-013 | HIGH | PASS | `socle/src/comptes.js:709` | un administrateur repris de la 1.4.1 doit inscrire une clé avant tout accès complet ; essai `test/migration.test.js:107` |
| REQ-AUTH-014 | MEDIUM | FAIL | `socle/src/notifications.js:78` ; « ce n’était pas moi » : `socle/src/comptes.js:854` | implémenté et essayé (essai `socle/test/courriel.test.js:63`, par courriel) ; ne part que si un relais SMTP est configuré (`deploy/compose.hub.yml:71`) → action H2 |
| REQ-CRYPT-001 | CRITICAL | PASS | `socle/src/argon.js:15` ; 64 Mio, t=3, p=4 par défaut : `socle/src/index.js:42` | Argon2id natif de Node, sel de 16 octets par empreinte ; les essais de MapMyLAN tournent aux paramètres de production, sans réglage abaissé (`test/aides.js:26`) |
| REQ-CRYPT-002 | HIGH | PASS | `socle/src/argon.js:72` ; écrit dans la même requête : `socle/src/argon.js:129` | les empreintes Argon2id de la 1.4.1 sont reprises telles quelles, poivre compris (`src/migration.js:94`), et rehachées aux paramètres courants à la connexion |
| REQ-CRYPT-003 | MEDIUM | N/A | bcrypt jamais utilisé pour hacher ni vérifier : `grep -rnE "bcrypt\.(hash\|compare)\|from .bcrypt\|require\(.bcrypt" src socle/src` → 0 ; Argon2id seul ; une empreinte bcrypt de la 1.4.1 n’est pas reprise, le compte reçoit un lien de réinitialisation (`src/migration.js:95`) |  |
| REQ-CRYPT-004 | HIGH | PASS | `socle/src/motdepasse.js:12`, `socle/src/motdepasse.js:13`, liste de fuites locale `socle/src/motdepasse.js:18`, suivie par git et vérifiée par empreinte (`socle/EMPREINTES:1`) | contrôlé côté serveur, sans règle de composition ni rotation forcée |
| REQ-CRYPT-005 | HIGH | PASS | `socle/src/outils.js:16` ; identifiants publics : `src/db.js:16` ; jetons d’intégration : `src/jetons.js:23` ; comparaison en temps constant : `src/jetons.js:36` | annexe B.3 : Math.random seulement dans deux animations de l’interface (traînées du globe, particules de la voix) |
| REQ-CRYPT-006 | MEDIUM | PASS | jetons d’intégration : `src/jetons.js:19` ; sessions : `socle/src/comptes.js:259` ; jetons du socle : `socle/src/comptes.js:802` | jeton montré une fois à sa création : `src/api/systeme.js:169` |
| REQ-SESS-001 | CRITICAL | PASS | `socle/src/http.js:103` ; __Host- en HTTPS : `socle/src/portail.js:44` | aucune session dans le stockage du navigateur |
| REQ-SESS-002 | CRITICAL | PASS | `socle/src/comptes.js:269` à la connexion, au renfort et à chaque changement de facteur ou de rôle | pas de jeton de rafraîchissement : sessions serveur ; les sessions de la 1.4.1 ne sont pas reprises |
| REQ-SESS-003 | HIGH | PASS | `socle/src/comptes.js:305` ; révocation : `socle/src/portail.js:301` et incident : `socle/src/portail.js:376` | appareil, adresse IP, première et dernière vue ; le flux temps réel d’une session fermée est coupé : essai `test/service.test.js:430` |
| REQ-SESS-004 | HIGH | PASS | `socle/src/comptes.js:641` ; déconnexion serveur : `socle/src/portail.js:258` |  |
| REQ-SESS-005 | HIGH | PASS | `socle/src/comptes.js:321` ; routes de MapMyLAN sous renfort : 23, figées dans l’essai `test/service.test.js:70` (secrets d’équipement, consoles et commandes à distance, suppressions, jetons, boîtes mail, canaux, règles de défense) ; réglages de sécurité : `src/api/systeme.js:83` | essai `test/service.test.js:112` |
| REQ-SESS-006 | MEDIUM | PASS | 12 h absolues, 60 min d’inactivité : `socle/src/index.js:40` | pas de JWT |
| REQ-ANON-001 | CRITICAL | FAIL | `git log --all --format="%an <%ae>" \| sort -u` → 3 lignes : le pseudonyme, et deux autres identités dans les commits publiés de la 1.x (annexe B.1) | identité posée dans le dépôt ; tous les commits de la 2.0 portent le pseudonyme seul ; historique publié : action H12 |
| REQ-ANON-002 | CRITICAL | FAIL | arbre : deux chemins personnels dans un outil de développement (`outils/faux-api.mjs:25`, `outils/faux-api.mjs:28`) et un nom de machine réaliste dans un commentaire d’exemple (`web/lib/modeles.js:83`), hors des faux positifs de l’annexe B.1 ; historique publié : termes de l’infrastructure personnelle, captures d’écran | arbre : à corriger dans cette passe ; historique publié : action H12 |
| REQ-ANON-003 | CRITICAL | FAIL | liste et crochet global à poser sur le poste de développement ; contrôle CI par secret : `.github/workflows/verification.yml:86` | action H4 |
| REQ-ANON-004 | CRITICAL | FAIL | commande de REQ-ANON-004 sur tout l’historique : le mot « assistant » (nom d’une fonction du produit) dans des messages de commits, et 5 commits publiés de la 1.x dont l’auteur est une identité d’outil (annexe B.1, `git log --all --format="%an" \| sort \| uniq -c`) | aucune ligne de fin ni mention d’outil dans les commits de la 2.0 ; contrôlé en CI (`.github/workflows/verification.yml:61`) ; historique publié : action H12 |
| REQ-ANON-005 | HIGH | PASS | `package.json:6` sans champ auteur ; `LICENSE:3` ; étiquettes de l’image posées explicitement (`.github/workflows/publish.yml:75`) | le README décrit le logiciel, jamais une machine ni une personne ; contact de sécurité : le signalement privé du dépôt (`src/main.js:44`) |
| REQ-ANON-006 | HIGH | FAIL | arbre : 7 images de l’interface (icônes et logo), réduites aux blocs IHDR, IDAT et IEND, sans aucun bloc de métadonnées (annexe B.1) ; historique publié : les captures d’écran et images de la 1.x, dont certaines portent des blocs de métadonnées (comptes dans la section « Anonymity ») | captures du parcours gardées hors dépôt ; historique publié : action H12 |
| REQ-ANON-007 | HIGH | FAIL | le commentaire d’exemple de `web/lib/modeles.js:83` cite un modèle de serveur réel accolé à un nom de poste ; le reste des essais et fixtures est fabriqué | à remplacer par un exemple générique |
| REQ-ANON-008 | MEDIUM | FAIL | `git log --all --format=%aI \| grep -v "+00:00$" \| wc -l` → 40, `git log --all --format=%cI \| grep -v "+00:00$" \| wc -l` → 46 : commits publiés de la 1.x | tous les commits de la 2.0 sont en UTC (annexe B.1) ; les anciens sont publiés : décision H12 |
| REQ-ANON-009 | MEDIUM | FAIL | pages d’erreur sans chemin : `socle/src/http.js:163` ; domaine et WHOIS hors dépôt | action H13 |
| REQ-ANON-010 | MEDIUM | PASS | identité stable et unique pour la 2.0, dates réelles (TZ=UTC, jamais antidatées) | aucune politique de contribution externe |
| REQ-CFG-001 | CRITICAL | FAIL | gitleaks sur tout l’historique (65 commits) → aucune fuite ; `git grep` de l’annexe B.2 → valeurs d’essai fabriquées ; `-----BEGIN … PRIVATE` → 0 ; mais le serveur rend l’interface pour toute adresse sans extension, `/.env` compris (annexe B.2 : 200) | un fichier .env posé à côté de web/ ne serait pas servi, mais la réponse 200 masque la règle et trompe les sondes : à corriger (voir SEC-SECRETS-003) |
| REQ-CFG-002 | CRITICAL | PASS | secrets d’équipement, de boîte et de canal jamais rendus : `src/formes.js:43` ; `src/notifications.js:50` ; aucune construction : web/ servi tel quel, `grep -rnE "sk_live\|service_role\|-----BEGIN (RSA\|EC\|OPENSSH) PRIVATE KEY-----[A-Za-z0-9]" web socle/web` → 0 | les trois correspondances de l’annexe B.2 dans web/ sont des indications de saisie (placeholder) d’un champ de clé privée, pas une clé |
| REQ-CFG-003 | HIGH | FAIL | clés par environnement : aucune clé de fournisseur payant (le modèle est l’Ollama de l’exploitant) ; jetons du Hub, de VOX et de SYNAPSE propres à chaque installation | séparer les jetons et comptes de l’instance d’essai et de la production, et les vérifier : action H6 |
| REQ-CFG-004 | HIGH | PASS | `src/config.js:47` sur `socle/src/config.js:14` ; ensemble : `socle/src/index.js:66` | essai `test/unitaires.test.js:322` |
| REQ-CFG-005 | HIGH | FAIL | SOCLE_CLE se tourne pour les secrets TOTP (`socle/src/comptes.js:106`) ; mais les secrets propres à MapMyLAN (équipements, boîtes mail, canaux) ne sont pas rescellés : après la rotation, ils deviennent illisibles (`src/equipements.js:28`), contrairement à ce qu’annonce `hub.json:164` | à corriger : rescellement au démarrage et exercice de bout en bout |
| REQ-CI-001 | CRITICAL | FAIL | `.github/workflows/verification.yml:49` | Actions, crochet local et protection de poussée à activer : actions H3, H4 |
| REQ-CI-002 | HIGH | FAIL | `.github/workflows/verification.yml:110` | bloquant une fois les Actions rétablies et le contrôle requis : action H3 |
| REQ-CI-003 | HIGH | FAIL | aucune dépendance npm, vérifié en CI (`.github/workflows/verification.yml:39`) ; image de base épinglée `Dockerfile:5` ; paquets Debian d’un instantané daté `Dockerfile:11` ; SBOM : `.github/workflows/publish.yml:88` ; crible de l’image : `.github/workflows/publish.yml:49` | exécution en CI et contrôle requis : action H3 |
| REQ-CI-004 | HIGH | FAIL | `.github/workflows/verification.yml:86` | échoue tant que le secret n’existe pas : action H4 |
| REQ-CI-005 | MEDIUM | FAIL | permissions minimales `.github/workflows/verification.yml:16` ; actions épinglées par commit | protection de branche : action H3 |
| REQ-CI-006 | MEDIUM | PASS | `test/service.test.js:58` : listes des routes admin, sous renfort et ouvertes aux jetons figées dans l’essai, puis chaque route appelée sans session (401), par un jeton (403 hors de sa portée), en lecture et en membre (403) ; objets d’un autre appareil : `test/service.test.js:142` | cassures volontaires détectées : NO-VIBE.md |
| REQ-WEB-001 | CRITICAL | FAIL | HSTS dès que la requête est chiffrée : `socle/src/http.js:86` | MapMyLAN est servi en HTTP sur le réseau local : action H1 |
| REQ-WEB-002 | HIGH | PASS | `socle/src/http.js:62` ; `src/main.js:150` ; `curl -sI /` → script-src 'self' 'nonce-…', style-src 'self', object-src 'none', frame-ancestors 'none' (annexe B.4) | parcours Chromium de toutes les pages : 0 violation de la politique, 0 erreur console (outils/parcours-navigateur.mjs) ; styles posés par propriété, jamais en attribut (`web/dom.js:5`) |
| REQ-WEB-003 | HIGH | FAIL | `socle/src/http.js:79`, no-store sur l’API ; mais les logos, réponses authentifiées, partent en cache privé d’une semaine (`src/api/trafic.js:90`), et une réponse 429 du débit global part sans aucun en-tête de sécurité (`src/main.js:143` avant `src/main.js:150`) | à corriger |
| REQ-WEB-004 | HIGH | PASS | aucun en-tête CORS émis : `curl -sI -H "Origin: https://evil.example" /api/devices` → aucun Access-Control-* (annexe B.4) ; OPTIONS → 404 | API de même origine ; le Hub et les scripts appellent de serveur à serveur avec un jeton |
| REQ-WEB-005 | HIGH | PASS | CSRF : `socle/src/portail.js:86` ; JSON exigé : `socle/src/http.js:120` ; aucune écriture sur GET (`src/api/index.js:20`) ; sorties vers une adresse fournie : `src/sortie.js:106` (http(s), métadonnées et plages réservées refusées, interne sur liste blanche d’un administrateur, chaque saut revérifié) ; aucune redirection pilotée par paramètre (annexe B.4) | essais `test/service.test.js:361`, `test/unitaires.test.js:147` ; aucun webhook reçu |
| REQ-WEB-006 | CRITICAL | PASS | schéma de chaque requête et de chaque corps : `src/api/index.js:50` ; démarrage refusé sans schéma : `src/api/index.js:30` ; refus par défaut : `src/api/index.js:49` ; objets rattachés vérifiés dans la requête : `src/api/appareils.js:177` ; champs réservés : `src/api/appareils.js:64` | essais `test/service.test.js:194` et balayage des droits ; erreurs génériques : `socle/src/http.js:163` |
| REQ-WEB-007 | HIGH | PASS | requêtes préparées partout ; noms de colonnes interpolés pris dans une liste fermée : `src/appareils.js:60` ; outils lancés sans shell, arguments en tableau : `src/executeur.js:26` ; `innerHTML` seulement dans le gabarit du socle (`socle/web/gabarit.js:115`), où le balisage est écrit dans le code et les valeurs posées en nœuds | annexe B.3 relue ligne à ligne ; eval et Function absents |
| REQ-WEB-008 | MEDIUM | FAIL | débit global `src/main.js:138`, corps bornés (`src/api/index.js:54`), quotas des actions coûteuses (`src/api/appareils.js:21`) et plafond de l’assistant ; mais des listes sans borne (`src/api/automatisation.js:71`, `src/api/reseau.js:281`) et les logos, qui déclenchent jusqu’à quatre requêtes sortantes par domaine inconnu, sans quota (`src/api/trafic.js:87`) | à corriger |
| REQ-DATA-001 | CRITICAL | PASS | SQLite embarqué, aucun port : `src/db.js:189` ; dossier en 0700 et base en 0600 : `src/db.js:185` | le proxy du socket Docker n’écoute que la boucle locale et en lecture seule (`docker-compose.yml:72`, `docker-compose.yml:61`) |
| REQ-DATA-002 | HIGH | FAIL | secrets d’équipement, de boîte et de canal, secrets TOTP scellés AES-256-GCM, sous-clé par usage : `socle/src/chiffre.js:60` ; SSH à clé d’hôte épinglée, TLS vérifié ou épinglé vers les équipements ; aucune connexion réseau à la base | chiffrement du disque des hôtes : action H7 |
| REQ-DATA-003 | HIGH | FAIL | instantané chiffré pour une clé publique RSA, la clé privée hors de la machine : `src/cli.js:68` sur `socle/src/sauvegarde.js:26` ; restauration vers un fichier neuf, ailleurs : `src/cli.js:79` | planification quotidienne, copie hors hôte, durée de garde et restauration réelle datée : action H8 |
| REQ-DATA-004 | HIGH | FAIL | socle : connexions, facteurs, rôles, refus (`socle/src/portail.js:98`) ; MapMyLAN : refus 403 (`src/api/index.js:66`), jetons refusés (`src/api/acces.js:33`), débit global (`src/main.js:144`), actions d’administration (`src/api/acces.js:60`) ; mais six routes d’administration ne laissent aucune trace (reconnaissance et essai d’équipement, essai de console, essais de canal, de boîte et du relais Poste : `src/api/reseau.js:130`), les 429 des quotas propres aux routes ne sont pas journalisés (`src/api/appareils.js:22`), et les actions destructrices du bot Telegram ne vont qu’au journal de service, que l’application réécrit (`src/commandes-bot.js:82`) | à corriger |
| REQ-DATA-005 | MEDIUM | FAIL | vigie : `socle/src/vigie.js:11` (connexions, refus, limites, erreurs) ; runbook ci-dessous ; mais les limites des routes n’arrivent pas au journal, donc pas à la vigie (voir REQ-DATA-004) | à corriger ; exercice du runbook à dater : action H8 |
| REQ-DATA-006 | MEDIUM | PASS | `web/confidentialite.txt:7` avec finalité et durée par donnée ; trafic purgé selon sa rétention (`src/api/trafic.js:54`) ; fil de l’assistant borné à trente tours (`src/assistant/index.js:14`) et effacé avec le compte (`src/main.js:117`) ; export : `src/main.js:120` | violation : délai de 72 h dans le runbook ; essai `test/service.test.js:473` |
| REQ-DATA-007 | MEDIUM | PASS | le seul contenu envoyé par un utilisateur est le son de la dictée : type exigé (`src/api/index.js:53`), taille bornée (`src/api/assistant.js:52`), débit par compte, transmis une fois à VOX et jamais gardé ni servi ; les photos d’appareils ne quittent pas le navigateur (`web/composants/photo.js:6`) ; aucun import depuis une adresse |  |
| REQ-CODE-001 | HIGH | UNKNOWN | passe de qualité pas encore menée | phase 6 |
| REQ-CODE-002 | HIGH | UNKNOWN | passe de qualité pas encore menée | phase 6 |
| REQ-CODE-003 | HIGH | UNKNOWN | passe de qualité pas encore menée | phase 6 |
| REQ-CODE-004 | HIGH | UNKNOWN | passe de qualité pas encore menée | phase 6 |
| REQ-CODE-005 | MEDIUM | UNKNOWN | cassures volontaires pas encore menées | phase 6 |
| REQ-CODE-006 | MEDIUM | PASS | `git log --stat` : un sujet par commit pour la 2.0, style du dépôt, aucune ligne de fin |  |
| GOV-001 | HIGH | PASS | ce document : revue datée, périmètre (258 contrôles), résolution ligne par ligne, chaque preuve résolue et chaque commande relancée à sa génération | à refaire à chaque changement généré important |
| GOV-002 | MEDIUM | PASS | section « Inventory » ci-dessous : routes, données, tiers, secrets |  |
| GOV-003 | LOW | FAIL | `socle/src/portail.js:134` ; contact : `src/main.js:44` | `curl /.well-known/security.txt` → Contact et Expires ; activer le signalement privé sur le dépôt : action H3 |
| GOV-004 | MEDIUM | FAIL | instance d’essai distincte de la production ; données d’essai fabriquées | secrets et comptes tiers distincts à confirmer : action H6 |
| GOV-005 | HIGH | FAIL | jeton CI éphémère et limité : `.github/workflows/publish.yml:26` | 2FA sur GitHub et consoles des fournisseurs : action H3 |
| SEC-SECRETS-001 | CRITICAL | PASS | gitleaks sur tout l’historique → aucune fuite ; `git grep` de l’annexe B.2 → valeurs d’essai fabriquées seulement | gitleaks en CI (H3) |
| SEC-SECRETS-002 | CRITICAL | PASS | aucune variable publique ni construction : web/ servi tel quel, `grep -rnE "\bsk-[A-Za-z0-9_-]{20}\|sk_live\|service_role" web socle/web` → 0 | rien n’est injecté dans le code servi, sauf le nonce CSP : `web/index.html:16` |
| SEC-SECRETS-003 | CRITICAL | FAIL | `.gitignore:3` ; mais toute adresse sans extension reçoit l’interface : `src/main.js:158` ; `/.env` et `/.git/config` répondent 200 (annexe B.2, B.4) | CRITIQUE à corriger : aucun segment caché ne doit recevoir de réponse autre que 404 |
| SEC-SECRETS-004 | HIGH | PASS | installé par le Hub : secrets posés depuis son coffre (`deploy/compose.hub.yml:63`) ; seul : secret Docker hors du volume (`docker-compose.yml:20`) ; fichiers acceptés : `socle/src/config.js:5` | jamais dans la CI ni dans un fichier du volume |
| SEC-SECRETS-005 | HIGH | FAIL | aucune clé de fournisseur payant ; jetons de VOX et de SYNAPSE propres à ce service, dérivés par le Hub (`deploy/compose.hub.yml:57`) | restreindre les identifiants d’équipement (compte dédié en lecture et défense sur le routeur) et séparer ceux de l’essai : action H6 |
| SEC-SECRETS-006 | HIGH | FAIL | procédures de rotation ci-dessous ; mais la rotation de SOCLE_CLE rend illisibles les secrets d’équipement, de boîte et de canal (voir REQ-CFG-005) | à corriger ; secrets vus pendant le développement : action H5 |
| SEC-SECRETS-007 | HIGH | PASS | clé maîtresse 32 octets aléatoires : `socle/src/chiffre.js:24` ; jeton du Hub : `src/config.js:24` ; valeurs d’exemple refusées : `socle/src/config.js:54` | aucun repli de secret par défaut |
| SEC-SECRETS-008 | MEDIUM | PASS | `src/config.js:47` ; mode dégradé affiché en permanence : `socle/web/compte.js:684` | aucun mode débogage, aucun compte de démonstration : jeton d’installation exigé pour le premier compte |
| SEC-AUTH-001 | CRITICAL | PASS | voir REQ-CRYPT-001 |  |
| SEC-AUTH-002 | MEDIUM | PASS | voir REQ-CRYPT-004 |  |
| SEC-AUTH-003 | CRITICAL | PASS | voir REQ-AUTH-010 |  |
| SEC-AUTH-004 | MEDIUM | PASS | voir REQ-AUTH-011 |  |
| SEC-AUTH-005 | CRITICAL | PASS | voir REQ-AUTH-006 ; lien depuis l’adresse publique : `socle/src/portail.js:49` | sans adresse publique, l’origine attestée par le navigateur de l’administrateur, contrôlée sur la même requête |
| SEC-AUTH-006 | MEDIUM | PASS | confirmation sur la nouvelle adresse et avis à l’ancienne : `socle/src/comptes.js:882` | essai `socle/test/courriel.test.js:122` |
| SEC-AUTH-007 | HIGH | PASS | TOTP et clés pour tous, second facteur imposé aux administrateurs : `socle/src/comptes.js:158` | codes de secours toujours émis |
| SEC-AUTH-008 | HIGH | N/A | aucune connexion par fournisseur externe : `grep -rniE "openid\|id_token\|redirect_uri\|authorization_code" socle/src src` → 0 |  |
| SEC-AUTH-009 | HIGH | PASS | les liens reçus par courriel demandent un geste : `socle/web/compte.js:430` ; uniques et courts : `socle/src/comptes.js:34` | aucune connexion sans mot de passe par courriel |
| SEC-AUTH-010 | CRITICAL | PASS | chaque route non publique résout son principal avant tout : `src/api/index.js:49` ; session du socle : `src/api/acces.js:24` | essai `test/service.test.js:58` |
| SEC-AUTH-011 | HIGH | PASS | jeton présenté et refusé → 401, jamais la session à la place : `src/api/acces.js:23` ; `socle/src/http.js:163` | essai `test/service.test.js:123` |
| SEC-SESS-001 | CRITICAL | PASS | voir REQ-SESS-001 |  |
| SEC-SESS-002 | HIGH | PASS | `grep -rn "localStorage" web socle/web` → thème, langue, disposition de la carte, photos d’appareils et inventaire du matériel (`web/etat.js:11`), jamais une session ni un jeton | listés dans `web/confidentialite.txt:61` |
| SEC-SESS-003 | HIGH | PASS | 256 bits : `socle/src/comptes.js:254` | renouvelé à chaque changement de niveau |
| SEC-SESS-004 | HIGH | PASS | voir REQ-SESS-003, REQ-SESS-004 et REQ-SESS-006 |  |
| SEC-SESS-005 | CRITICAL | N/A | aucun JWT : `grep -rniE "jsonwebtoken\|jwt\.(sign\|verify\|decode)\|from .jose" src web socle` → 0 |  |
| SEC-SESS-006 | MEDIUM | N/A | aucun jeton de rafraîchissement : sessions serveur ; jetons d’intégration sans rafraîchissement, avec échéance facultative et révocation (`src/jetons.js:38`) |  |
| SEC-SESS-007 | MEDIUM | PASS | voir REQ-SESS-005 ; avis par courriel via le canal d’alerte du socle | courriel : H2 |
| SEC-AUTHZ-001 | CRITICAL | PASS | les objets propres à un compte sont filtrés par le compte tiré de la session : fil de l’assistant (`src/assistant/index.js:201`), quotas (`src/api/assistant.js:22`), sessions et facteurs (socle) ; les objets du réseau sont communs à l’instance et gardés par rôle ; un objet rattaché n’est désigné qu’à travers son parent, dans la requête : `src/api/appareils.js:177` | essais `test/service.test.js:453`, `test/service.test.js:142` |
| SEC-AUTHZ-002 | CRITICAL | PASS | rôle lu en base à chaque requête par le socle (`socle/src/portail.js:108`) ou pour un jeton (`src/jetons.js:35`) ; un jeton ne dépasse jamais « membre » (`src/jetons.js:13`) | balayage : lecture sur route de membre → 403, membre sur route d’administrateur → 403, jeton sur route d’administrateur → 403 |
| SEC-AUTHZ-003 | HIGH | PASS | schémas stricts, champ inconnu refusé : `socle/src/schema.js:69` ; mises à jour limitées à une liste fermée de colonnes : `src/appareils.js:63` ; champs de protection réservés aux administrateurs : `src/api/appareils.js:64` | essai `test/service.test.js:194` |
| SEC-AUTHZ-004 | HIGH | PASS | route /api inconnue → 404, méthode inconnue → 405 avec Allow : `src/api/index.js:44` ; une seule route publique de MapMyLAN, figée dans l’essai : `test/service.test.js:85` | aucune route de débogage ni de semis ; inventaire ci-dessous |
| SEC-AUTHZ-005 | CRITICAL | N/A | instance à un seul locataire, sans organisation, équipe ni espace : `grep -rniwE "tenants?\|workspaces?\|locataires?\|orgId\|organizationId" src socle/src` → 0 |  |
| SEC-AUTHZ-006 | LOW | PASS | identifiants publics de 96 bits aléatoires : `src/db.js:16` ; ceux de la 1.4.1 (cuid) restent opaques | seuls les numéros de VLAN (1 à 4094, norme IEEE 802.1Q) sont des entiers, et leur valeur est la donnée elle-même |
| SEC-AUTHZ-007 | HIGH | PASS | invariants côté serveur : routeur principal ni bloqué ni supprimé (`src/defense.js:35`), plages de balayage /16 au plus (`src/reglages.js:16`), adresse réservée dans son VLAN et libre (`src/api/appareils.js:105`), plafond de l’assistant en transaction (`src/assistant/plafond.js:24`) | aucun prix, aucun crédit |
| SEC-AUTHZ-008 | MEDIUM | PASS | aucune fonction cachée côté client : chaque bouton appelle une route contrôlée côté serveur, balayée par rôle ; les pages réservées sont masquées aux rôles qui n’y ont pas droit et refusées par le serveur | voir REQ-CI-006 |
| SEC-INJ-001 | CRITICAL | PASS | requêtes préparées ; seuls les noms de colonnes d’une liste fermée sont interpolés (`src/api/systeme.js:106`) ; conditions faites de marqueurs liés (`src/api/trafic.js:18`) | annexe B.3 : 0 ligne pour les motifs de concaténation SQL |
| SEC-INJ-002 | HIGH | N/A | aucun ORM : node:sqlite, requêtes préparées seulement ; tout import est un module de Node ou un fichier du dépôt : `grep -rhoE "from '[^']+'" src socle/src \| sort -u \| grep -vE "from '(node:\|\.)" \| wc -l` → 0 |  |
| SEC-INJ-003 | HIGH | N/A | aucune base documentaire : SQLite seulement ; `grep -rniE "mongodb://\|\$where" src socle/src` → 0 |  |
| SEC-INJ-004 | CRITICAL | PASS | un seul point de lancement, sans shell, sur une liste de programmes : `src/executeur.js:9` ; arguments en tableau, la cible après « -- » (`src/scanner.js:180`) ; commande SSH d’un administrateur passée comme un seul argument, une instruction à la fois (`src/consoles.js:7`) | essais `test/unitaires.test.js:298`, `test/service.test.js:226` |
| SEC-INJ-005 | HIGH | PASS | `socle/src/http.js:182` ; fichiers de SSH nommés par le serveur, dans un dossier 0700 éphémère (`src/ssh.js:91`) | aucun nom de fichier fourni par une requête n’est ouvert ; le dossier des extensions vient de la configuration |
| SEC-INJ-006 | HIGH | PASS | aucun moteur de gabarit côté serveur (`grep -rniwE "handlebars\|ejs\|nunjucks\|mustache\|pug" src socle/src` → 0) ; le texte d’une commande automatique ne fait que remplacer des noms de variables, sans expression : `src/commandes.js:73` | essai `test/unitaires.test.js:278` |
| SEC-INJ-007 | HIGH | PASS | aucun analyseur XML (`grep -rniE "xml2js\|sax\|libxml\|fast-xml\|DOMParser\|parseFromString" src socle/src` → 0) ; la description UPnP d’un appareil est lue par une expression bornée, sans entité : `src/enrichissement.js:84` |  |
| SEC-INJ-008 | HIGH | PASS | JSON seulement ; clés de prototype refusées : `socle/src/schema.js:6` ; objets libres bornés en profondeur (`src/api/systeme.js:87`) | aucune fusion récursive d’un corps de requête |
| SEC-XSS-001 | CRITICAL | PASS | `grep -rnE "innerHTML\|outerHTML\|insertAdjacentHTML\|document.write" web socle/web --include=*.js` → 2 lignes, le gabarit du socle (balisage du code, valeurs en nœuds) ; `web/dom.js:4` | noms d’appareils, messages d’alerte, réponses du modèle : nœuds texte |
| SEC-XSS-002 | HIGH | PASS | texte riche limité et reconstruit à la main : réponses du modèle (`web/assistant/rendu.js:4`) et messages du bot (`web/composants/texte-riche.js:6`) | aucun lien ni image rendus depuis un texte |
| SEC-XSS-003 | HIGH | PASS | aucun eval, setTimeout chaîne ni affectation de location depuis une donnée : `grep -rnE "eval\(\|new Function\|location\.href *=\|location\.assign\|location\.replace" web --include=*.js` → 0 | le seul lien construit depuis une donnée (passage à un service voisin) est limité à http(s) : `src/assistant/index.js:119` |
| SEC-XSS-004 | HIGH | PASS | voir REQ-WEB-002 |  |
| SEC-XSS-005 | MEDIUM | PASS | seuls échanges : le Worker de preuve de travail du socle et le module audio de la dictée, de même origine (`web/voix-capture.js:22`) | aucune iframe, aucune écoute de window message |
| SEC-XSS-006 | MEDIUM | PASS | aucune carte de source servie (`find web socle/web -name "*.map"` → 0) ; erreurs réduites à un message : `socle/src/http.js:163` ; pannes des services voisins dites sans détail interne (`src/api/assistant.js:10`) |  |
| SEC-XSS-007 | MEDIUM | N/A | aucune redirection émise : `grep -rnE "Location\|writeHead\(30[1278]" src` → 0 ; `curl -sI "/login?next=https://evil.example"` → aucun Location (annexe B.4) |  |
| SEC-XSS-008 | MEDIUM | PASS | aucun script tiers : `grep -rnE "<script[^>]+src=\"https?:" web socle/web` → 0 ; un seul script, de même origine et à nonce : `web/index.html:16` ; polices servies par MapMyLAN | rien à protéger par SRI |
| SEC-HDR-001 | HIGH | FAIL | voir REQ-WEB-001 | action H1 |
| SEC-HDR-002 | HIGH | PASS | voir REQ-WEB-002 |  |
| SEC-HDR-003 | MEDIUM | PASS | `socle/src/http.js:79` ; Permissions-Policy : tout refusé sauf le micro pour la page elle-même (`src/main.js:47`) | X-Frame-Options DENY en plus de frame-ancestors ; essai `test/service.test.js:513` |
| SEC-HDR-004 | LOW | PASS | `curl -sI /` : ni Server ni X-Powered-By (annexe B.4) |  |
| SEC-HDR-005 | MEDIUM | FAIL | no-store sur l’API et les pages : `socle/src/http.js:148` ; sauf les logos, gardés une semaine par le navigateur (`src/api/trafic.js:90`) | à corriger |
| SEC-HDR-006 | CRITICAL | PASS | voir REQ-WEB-004 |  |
| SEC-HDR-007 | HIGH | PASS | voir REQ-SESS-001 |  |
| SEC-CSRF-001 | HIGH | PASS | SameSite=Strict + origine + jeton : `socle/src/portail.js:86` appelé par chaque écriture d’une session | un jeton d’intégration se présente en en-tête, que le navigateur n’envoie jamais seul ; essai `test/relais.test.js:41` |
| SEC-CSRF-002 | MEDIUM | PASS | `socle/src/http.js:120` ; corps brut réservé à la dictée, type audio exigé (`src/api/index.js:53`) | 415 sur tout autre type |
| SEC-CSRF-003 | MEDIUM | PASS | aucune écriture sur GET : seules les routes POST, PUT, PATCH et DELETE écrivent, et chacune déclare son schéma (`src/api/index.js:30`) |  |
| SEC-CSRF-004 | CRITICAL | PASS | `src/sortie.js:106` : http(s) seulement, résolution contrôlée puis épinglée (`src/sortie.js:157`), métadonnées et plages réservées toujours refusées, interne seulement pour l’équipement déclaré ou la liste d’un administrateur sous renfort, chaque saut de redirection revérifié, délai et taille bornés ; SMTP et IMAP par la même garde (`src/sortie.js:140`) | essais `test/service.test.js:361`, `test/unitaires.test.js:147` |
| SEC-CSRF-005 | HIGH | N/A | aucun webhook reçu : `grep -rniE "webhook\|x-hub-signature\|stripe-signature" src` → 0 ; les notifications sortantes partent vers des adresses réglées par un administrateur, à travers la garde de sortie |  |
| SEC-CSRF-006 | MEDIUM | N/A | aucune redirection pilotée par paramètre : voir SEC-XSS-007 |  |
| SEC-API-001 | HIGH | PASS | voir REQ-WEB-006 ; paramètres de chemin contraints : `src/api/index.js:22` ; en-tête d’un jeton borné : `src/api/acces.js:37` |  |
| SEC-API-002 | HIGH | FAIL | global par adresse : `src/main.js:138` ; quotas des actions coûteuses par demandeur (balayage, ping, registres, relevés, essais, assistant, voix) ; mais les logos n’en ont pas (voir REQ-WEB-008) | à corriger |
| SEC-API-003 | MEDIUM | FAIL | journal, alertes, trafic et historique bornés par schéma (`src/api/trafic.js:30`) ; appareils plafonnés (`src/appareils.js:19`) ; mais commandes, commandes du bot, liens et zones de la carte, consoles, jetons et boîtes rendus sans borne | à corriger |
| SEC-API-004 | HIGH | PASS | chaque réponse est construite champ par champ : `src/formes.js:3` ; secrets réduits à leur présence : `src/formes.js:43` ; empreinte d’un jeton jamais rendue (`src/formes.js:50`) | fil de l’assistant : chacun ne voit que le sien |
| SEC-API-005 | MEDIUM | PASS | 405 avec Allow : `src/api/index.js:44` ; aucune page de documentation ni de débogage servie | TRACE et OPTIONS → 404 ou 405 |
| SEC-API-006 | HIGH | N/A | aucun GraphQL : `grep -rniE "graphql\|apollo" src web/*.js web/*/*.js socle/src` → 0 |  |
| SEC-API-007 | MEDIUM | FAIL | un seul formateur d’erreurs : `socle/src/http.js:157` ; mais des écritures multiples hors transaction : ports d’un appareil effacés puis réinsérés un à un (`src/appareils.js:77`), fiche et historique écrits séparément à l’ajout manuel, à la modification, au blocage et au relevé d’un balayage | à corriger |
| SEC-API-008 | MEDIUM | N/A | aucune opération monétaire ni crédit : `grep -rniE "stripe\|paypal\|checkout\|invoice\|payout\|refund" src web/*.js web/*/*.js socle/src socle/web/*.js` → 0 : aucun paiement |  |
| SEC-API-009 | HIGH | PASS | aucun RPC implicite : chaque route de /api déclare rôle, schéma et portée des jetons au même endroit (`src/api/index.js:6`) | voir REQ-CI-006 |
| SEC-API-010 | MEDIUM | PASS | `socle/src/http.js:126` ; 64 Kio par défaut (`src/api/index.js:54`), 12 Mio pour la dictée seule | essai `test/service.test.js:194` |
| SEC-DB-001 | CRITICAL | PASS | voir REQ-DATA-001 |  |
| SEC-DB-002 | HIGH | N/A | SQLite embarqué sans rôle ni identifiant : `src/db.js:189` ; aucun serveur de base, aucune connexion |  |
| SEC-DB-003 | HIGH | FAIL | aucun trafic réseau vers la base ; secrets scellés (voir REQ-DATA-002) | chiffrement du disque des hôtes : action H7 |
| SEC-DB-004 | MEDIUM | PASS | secrets d’équipement, de boîte et de canal scellés AES-256-GCM, sous-clé par usage et liés à leur ligne : `src/equipements.js:24` ; clé maîtresse hors du volume (coffre du Hub, ou secret Docker) ; jetons d’intégration hachés |  |
| SEC-DB-005 | CRITICAL | PASS | voir SEC-INJ-001 |  |
| SEC-DB-006 | HIGH | FAIL | voir REQ-DATA-003 | action H8 |
| SEC-DB-007 | MEDIUM | PASS | essais sur données fabriquées ; aucun compte par défaut : jeton d’installation exigé (`socle/src/comptes.js:214`) ; seules des règles de défense sont posées au premier démarrage (`src/main.js:52`) |  |
| SEC-DB-008 | CRITICAL | N/A | le navigateur ne parle jamais à la base : SQLite côté serveur seulement, `grep -rniE "sqlite\|indexedDB" web --include=*.js` → 0 |  |
| SEC-DB-009 | LOW | PASS | `src/db.js:190` ; listes plafonnées ; délais du serveur (`src/main.js:171`) | un seul processus, pas de pool nécessaire |
| SEC-DB-010 | LOW | PASS | export d’un compte tracé par le socle (`socle/src/portail.js:322`) ; sauvegarde de la ligne de commande tracée (`src/cli.js:74`) ; effacement du trafic tracé (`src/api/trafic.js:61`) | journal chaîné, copié sur la sortie standard hors de portée du service |
| SEC-FILE-001 | HIGH | N/A | aucun envoi de fichier : `grep -rniE "multipart\|busboy\|formidable\|multer" src socle/src` → 0 ; le son de la dictée n’est pas un fichier : voir REQ-DATA-007 |  |
| SEC-FILE-002 | MEDIUM | N/A | aucun envoi de fichier : voir SEC-FILE-001 ; corps bornés (voir SEC-API-010) |  |
| SEC-FILE-003 | HIGH | N/A | aucun fichier d’utilisateur écrit : les seules écritures sont la base, ses fichiers WAL et les fichiers éphémères de SSH, nommés par le serveur |  |
| SEC-FILE-004 | HIGH | N/A | aucun fichier d’utilisateur servi |  |
| SEC-FILE-005 | CRITICAL | N/A | aucun fichier d’utilisateur stocké |  |
| SEC-FILE-006 | MEDIUM | N/A | aucun fichier partagé entre utilisateurs |  |
| SEC-FILE-007 | LOW | N/A | aucune image reçue par le serveur : les photos d’appareils restent dans le navigateur (`web/composants/photo.js:6`) |  |
| SEC-FILE-008 | HIGH | N/A | aucun import par adresse : voir SEC-CSRF-004 |  |
| SEC-PAY-001 | CRITICAL | N/A | `grep -rniE "stripe\|paypal\|checkout\|invoice\|payout\|refund" src web/*.js web/*/*.js socle/src socle/web/*.js` → 0 : aucun paiement |  |
| SEC-PAY-002 | CRITICAL | N/A | `grep -rniE "stripe\|paypal\|checkout\|invoice\|payout\|refund" src web/*.js web/*/*.js socle/src socle/web/*.js` → 0 : aucun paiement ; aucun webhook reçu |  |
| SEC-PAY-003 | HIGH | N/A | `grep -rniE "stripe\|paypal\|checkout\|invoice\|payout\|refund" src web/*.js web/*/*.js socle/src socle/web/*.js` → 0 : aucun paiement ; aucun abonnement |  |
| SEC-PAY-004 | HIGH | N/A | `grep -rniE "stripe\|paypal\|checkout\|invoice\|payout\|refund" src web/*.js web/*/*.js socle/src socle/web/*.js` → 0 : aucun paiement |  |
| SEC-PAY-005 | HIGH | N/A | `grep -rniE "stripe\|paypal\|checkout\|invoice\|payout\|refund" src web/*.js web/*/*.js socle/src socle/web/*.js` → 0 : aucun paiement |  |
| SEC-PAY-006 | HIGH | PASS | vérification d’adresse : 5 par heure par compte et par adresse (`socle/src/portail.js:36`) ; alertes du socle : 30 par heure et par compte (`socle/src/notifications.js:79`) ; alertes du réseau : destinataires réglés par un administrateur, jamais par une requête (`src/notifications.js:117`) ; essais de canal : 10 par minute et par compte (`src/api/systeme.js:31`) | contenu des alertes échappé pour Telegram (`src/notifications.js:22`) |
| SEC-PAY-007 | MEDIUM | FAIL | le domaine d’expédition est celui du relais de l’exploitant | SPF, DKIM et DMARC à publier avec le relais : action H2 |
| SEC-PAY-008 | MEDIUM | PASS | aucun mot de passe dans un courriel ; liens uniques, hachés, de 30 minutes (`socle/src/comptes.js:34`) ou 72 heures pour fermer les sessions (`socle/src/notifications.js:27`) ; alertes du réseau sans secret (adresse, nom, gravité) | le lien de révocation ne peut que fermer des sessions |
| SEC-NEXT-001 | CRITICAL | N/A | Node sans cadriciel : `package.json:5`, aucune dépendance ; `grep -rniE "next/\|nextjs\|use server\|vercel" src web/*.js web/*/*.js socle/src socle/web/*.js` → 0 |  |
| SEC-NEXT-002 | CRITICAL | N/A | Node sans cadriciel : `package.json:5`, aucune dépendance ; `grep -rniE "next/\|nextjs\|use server\|vercel" src web/*.js web/*/*.js socle/src socle/web/*.js` → 0 |  |
| SEC-NEXT-003 | HIGH | N/A | Node sans cadriciel : `package.json:5`, aucune dépendance ; `grep -rniE "next/\|nextjs\|use server\|vercel" src web/*.js web/*/*.js socle/src socle/web/*.js` → 0 |  |
| SEC-NEXT-004 | CRITICAL | N/A | Node sans cadriciel : `package.json:5`, aucune dépendance ; `grep -rniE "next/\|nextjs\|use server\|vercel" src web/*.js web/*/*.js socle/src socle/web/*.js` → 0 |  |
| SEC-NEXT-005 | HIGH | N/A | Node sans cadriciel : `package.json:5`, aucune dépendance ; `grep -rniE "next/\|nextjs\|use server\|vercel" src web/*.js web/*/*.js socle/src socle/web/*.js` → 0 |  |
| SEC-NEXT-006 | HIGH | N/A | Node sans cadriciel : `package.json:5`, aucune dépendance ; `grep -rniE "next/\|nextjs\|use server\|vercel" src web/*.js web/*/*.js socle/src socle/web/*.js` → 0 |  |
| SEC-NEXT-007 | HIGH | N/A | Node sans cadriciel : `package.json:5`, aucune dépendance ; `grep -rniE "next/\|nextjs\|use server\|vercel" src web/*.js web/*/*.js socle/src socle/web/*.js` → 0 |  |
| SEC-NEXT-008 | MEDIUM | N/A | Node sans cadriciel : `package.json:5`, aucune dépendance ; `grep -rniE "next/\|nextjs\|use server\|vercel" src web/*.js web/*/*.js socle/src socle/web/*.js` → 0 ; aucun déploiement Vercel |  |
| SEC-NEXT-009 | MEDIUM | N/A | Node sans cadriciel : `package.json:5`, aucune dépendance ; `grep -rniE "next/\|nextjs\|use server\|vercel" src web/*.js web/*/*.js socle/src socle/web/*.js` → 0 ; aucune bibliothèque de cache client |  |
| SEC-BAAS-001 | CRITICAL | N/A | `grep -rniE "supabase\|firebase\|firestore\|postgrest" src web/*.js web/*/*.js socle/src socle/web/*.js` → 0 ; base SQLite embarquée côté serveur : `src/db.js:189` |  |
| SEC-BAAS-002 | CRITICAL | N/A | `grep -rniE "supabase\|firebase\|firestore\|postgrest" src web/*.js web/*/*.js socle/src socle/web/*.js` → 0 ; base SQLite embarquée côté serveur : `src/db.js:189` |  |
| SEC-BAAS-003 | CRITICAL | N/A | `grep -rniE "supabase\|firebase\|firestore\|postgrest" src web/*.js web/*/*.js socle/src socle/web/*.js` → 0 ; base SQLite embarquée côté serveur : `src/db.js:189` |  |
| SEC-BAAS-004 | HIGH | N/A | `grep -rniE "supabase\|firebase\|firestore\|postgrest" src web/*.js web/*/*.js socle/src socle/web/*.js` → 0 ; base SQLite embarquée côté serveur : `src/db.js:189` |  |
| SEC-BAAS-005 | CRITICAL | N/A | `grep -rniE "supabase\|firebase\|firestore\|postgrest" src web/*.js web/*/*.js socle/src socle/web/*.js` → 0 ; base SQLite embarquée côté serveur : `src/db.js:189` |  |
| SEC-BAAS-006 | HIGH | N/A | `grep -rniE "supabase\|firebase\|firestore\|postgrest" src web/*.js web/*/*.js socle/src socle/web/*.js` → 0 ; base SQLite embarquée côté serveur : `src/db.js:189` |  |
| SEC-BAAS-007 | MEDIUM | N/A | `grep -rniE "supabase\|firebase\|firestore\|postgrest" src web/*.js web/*/*.js socle/src socle/web/*.js` → 0 ; base SQLite embarquée côté serveur : `src/db.js:189` |  |
| SEC-BAAS-008 | CRITICAL | N/A | `grep -rniE "supabase\|firebase\|firestore\|postgrest" src web/*.js web/*/*.js socle/src socle/web/*.js` → 0 ; base SQLite embarquée côté serveur : `src/db.js:189` |  |
| SEC-BAAS-009 | CRITICAL | N/A | `grep -rniE "supabase\|firebase\|firestore\|postgrest" src web/*.js web/*/*.js socle/src socle/web/*.js` → 0 ; base SQLite embarquée côté serveur : `src/db.js:189` |  |
| SEC-BAAS-010 | HIGH | N/A | `grep -rniE "supabase\|firebase\|firestore\|postgrest" src web/*.js web/*/*.js socle/src socle/web/*.js` → 0 ; base SQLite embarquée côté serveur : `src/db.js:189` |  |
| SEC-BAAS-011 | HIGH | N/A | `grep -rniE "supabase\|firebase\|firestore\|postgrest" src web/*.js web/*/*.js socle/src socle/web/*.js` → 0 ; base SQLite embarquée côté serveur : `src/db.js:189` |  |
| SEC-BE-001 | MEDIUM | FAIL | en-têtes du socle posés avant les routes : `src/main.js:150` ; mais le débit global répond 429 avant eux (`src/main.js:143`) | à corriger : en-têtes posés sur toute réponse, refus compris |
| SEC-BE-002 | MEDIUM | PASS | corps bornés ; 404 pour l’inconnu ; relais de confiance explicites : `socle/src/http.js:14` ; délais du serveur : `src/main.js:170` | formateur d’erreurs unique : `src/main.js:165` |
| SEC-BE-003 | HIGH | PASS | voir SEC-INJ-004 et SEC-INJ-008 ; aucun import d’un chemin fourni par une requête : les extensions viennent du dossier réglé par l’exploitant, liens symboliques et fichiers inscriptibles par d’autres refusés (`src/extensions.js:25`) | essai `test/unitaires.test.js:232` |
| SEC-BE-004 | HIGH | PASS | aucune dépendance d’exécution, vérifié en CI (`.github/workflows/verification.yml:39`) : rien à verrouiller | `npm ls --all` → vide |
| SEC-BE-005 | CRITICAL | N/A | aucun Django : service Node, `git ls-files "*.py"` → 0 |  |
| SEC-BE-006 | HIGH | N/A | aucun Flask ni FastAPI : service Node, `git ls-files "*.py"` → 0 |  |
| SEC-BE-007 | HIGH | N/A | aucun code Python : `git ls-files "*.py"` → 0 |  |
| SEC-BE-008 | HIGH | N/A | aucun PHP : `git ls-files "*.php"` → 0 |  |
| SEC-BE-009 | MEDIUM | PASS | `Dockerfile:36` ; base slim épinglée ; aucun programme setuid ou setgid (`Dockerfile:27`) ; dossier de données en 0700, base et fichiers WAL en 0600 (`src/db.js:188`) | essai `test/service.test.js:501` |
| SEC-BE-010 | MEDIUM | PASS | `socle/src/http.js:157` ; sonde publique réduite à « vivant » : `src/api/systeme.js:46` | essai `test/service.test.js:45` |
| SEC-WP-001 | CRITICAL | N/A | application Node écrite ici : `grep -rniE "wordpress\|wp-admin\|bubble\|webflow" src web/*.js web/*/*.js socle/src socle/web/*.js` → 0 |  |
| SEC-WP-002 | HIGH | N/A | application Node écrite ici : `grep -rniE "wordpress\|wp-admin\|bubble\|webflow" src web/*.js web/*/*.js socle/src socle/web/*.js` → 0 |  |
| SEC-WP-003 | HIGH | N/A | application Node écrite ici : `grep -rniE "wordpress\|wp-admin\|bubble\|webflow" src web/*.js web/*/*.js socle/src socle/web/*.js` → 0 |  |
| SEC-WP-004 | MEDIUM | N/A | application Node écrite ici : `grep -rniE "wordpress\|wp-admin\|bubble\|webflow" src web/*.js web/*/*.js socle/src socle/web/*.js` → 0 |  |
| SEC-WP-005 | MEDIUM | N/A | application Node écrite ici : `grep -rniE "wordpress\|wp-admin\|bubble\|webflow" src web/*.js web/*/*.js socle/src socle/web/*.js` → 0 |  |
| SEC-WP-006 | CRITICAL | N/A | application Node écrite ici : `grep -rniE "wordpress\|wp-admin\|bubble\|webflow" src web/*.js web/*/*.js socle/src socle/web/*.js` → 0 |  |
| SEC-WP-007 | HIGH | N/A | application Node écrite ici : `grep -rniE "wordpress\|wp-admin\|bubble\|webflow" src web/*.js web/*/*.js socle/src socle/web/*.js` → 0 |  |
| SEC-WP-008 | MEDIUM | N/A | application Node écrite ici : `grep -rniE "wordpress\|wp-admin\|bubble\|webflow" src web/*.js web/*/*.js socle/src socle/web/*.js` → 0 |  |
| SEC-INFRA-001 | HIGH | FAIL | voir REQ-WEB-001 | action H1 |
| SEC-INFRA-002 | MEDIUM | FAIL | aucun domaine dans le dépôt | DNS, CAA et verrou du registraire du domaine éventuel : action H13 |
| SEC-INFRA-003 | HIGH | FAIL | hôtes de l’exploitant | pare-feu, SSH par clé, mises à jour : action H9 |
| SEC-INFRA-004 | MEDIUM | FAIL | `Dockerfile:5` ; `Dockerfile:36` ; `deploy/compose.hub.yml:14` ; `deploy/compose.hub.yml:19` ; `deploy/compose.hub.yml:24` ; mais NET_ADMIN est accordé sans être nécessaire (`deploy/compose.hub.yml:20`) et no-new-privileges est retiré (`docker-compose.yml:38`) | à corriger : NET_RAW seul, no-new-privileges posé, sans perdre le balayage ; crible de l’image à exécuter : actions H3, H14 |
| SEC-INFRA-005 | CRITICAL | N/A | aucun stockage objet : `grep -rniE "\bs3\b\|aws-sdk\|@google-cloud\|azure\|bucket" src socle/src` → 0 |  |
| SEC-INFRA-006 | HIGH | N/A | aucun nuage : service auto-hébergé, aucune clé IAM (`grep -rniE "aws_access_key\|AWS_SECRET\|GOOGLE_APPLICATION_CREDENTIALS\|AZURE_CLIENT" src socle/src .github` → 0) |  |
| SEC-INFRA-007 | HIGH | FAIL | permissions minimales, actions épinglées par commit, identifiants non transmis aux demandes de fusion (`.github/workflows/verification.yml:25`) | protection de branche et revue requise : action H3 |
| SEC-INFRA-008 | MEDIUM | FAIL | empreinte d’image, provenance et SBOM à la publication : `.github/workflows/publish.yml:87` | la publication tourne sur les Actions (H3) |
| SEC-INFRA-009 | MEDIUM | N/A | aucune infrastructure décrite en code : `find . -name "*.tf" -o -name "Pulumi.yaml" -o -name "*.cfn.yml"` → 0 fichier |  |
| SEC-DEP-001 | HIGH | PASS | aucune dépendance : rien à verrouiller ni à résoudre ; image de base par empreinte (`Dockerfile:5`), paquets Debian d’un instantané daté (`Dockerfile:12`) |  |
| SEC-DEP-002 | HIGH | FAIL | aucune dépendance npm ; image passée au crible à chaque publication (`.github/workflows/publish.yml:52`) | alertes Dependabot et contrôle requis : action H3 |
| SEC-DEP-003 | MEDIUM | PASS | aucune dépendance d’exécution ni de développement |  |
| SEC-DEP-004 | MEDIUM | PASS | versions exactes (image par empreinte, Debian par date) ; actions par commit (`.github/workflows/verification.yml:23`) | mises à jour relues à la main |
| SEC-DEP-005 | MEDIUM | N/A | aucune installation de paquet npm : ni npm install ni script de cycle de vie, dans le dépôt comme dans l’image (`Dockerfile:30` sans installation) |  |
| SEC-DEP-006 | LOW | FAIL | `.github/workflows/publish.yml:88` | produit par la publication (H3) |
| SEC-DEP-007 | MEDIUM | PASS | voir SEC-XSS-008 |  |
| SEC-DEP-008 | LOW | FAIL | crible de l’image à chaque publication | abonnement aux avis GitHub : action H3 |
| SEC-LLM-001 | CRITICAL | PASS | aucune clé de fournisseur : le modèle est l’Ollama de l’exploitant, appelé par le serveur seul (`src/assistant/liaisons.js:57`) ; jetons de VOX et de SYNAPSE lus côté serveur seulement | jamais dans une réponse ni dans le navigateur |
| SEC-LLM-002 | CRITICAL | PASS | session exigée, débit par minute et par compte (`src/api/assistant.js:20`), quota par compte et par jour, plafond de l’instance (`src/assistant/plafond.js:9`), jetons plafonnés à chaque appel (`src/assistant/liaisons.js:62`) | administrateurs prévenus au premier dépassement (« service.depense ») ; aucun fournisseur payant ; essai `test/service.test.js:453` |
| SEC-LLM-003 | HIGH | FAIL | consigne qui dit de tenir les noms d’appareils et les alertes pour des données (`src/assistant/index.js:42`), aucune décision de sécurité prise par le modèle ; mais l’état du réseau et ce que SYNAPSE renvoie sont collés dans le message système sans aucune clôture (`src/assistant/index.js:245`) | à corriger : données cloisonnées par des marqueurs qu’elles ne peuvent pas imiter |
| SEC-LLM-004 | HIGH | PASS | réponses rendues en nœuds texte, sans lien ni image (voir SEC-XSS-002) ; jamais exécutées, jamais passées à SQL ni à un outil |  |
| SEC-LLM-005 | CRITICAL | PASS | aucun outil pour le modèle : il lit et répond, il ne modifie rien (`src/assistant/index.js:2`) ; le passage à un autre service n’ouvre qu’un lien que l’utilisateur suit lui-même |  |
| SEC-LLM-006 | HIGH | PASS | le contexte ne contient que l’état du réseau, commun à tous les comptes ; ni secret d’équipement, ni fil d’un autre compte (`src/assistant/index.js:241`) | essai `test/service.test.js:453` |
| SEC-LLM-007 | MEDIUM | PASS | assistant réservé aux comptes invités ; consigne cadrée sur le réseau local : `src/assistant/index.js:35` ; questions gardées dans le fil du compte, trente tours au plus | aucun usage public |
| SEC-LLM-008 | LOW | PASS | modèle fixé par la configuration (`src/config.js:26`), servi par l’Ollama de l’exploitant ; aucun index vectoriel |  |
| SEC-LOG-001 | MEDIUM | FAIL | voir REQ-DATA-004 ; identifiant de requête : `socle/src/requete.js:12` | actions d’administration et limites non journalisées : à corriger |
| SEC-LOG-002 | HIGH | PASS | `socle/src/journal.js:10` ; jamais un secret ni une commande complète au journal : `src/api/reseau.js:251` | essai du socle `socle/test/surveillance.test.js:33` |
| SEC-LOG-003 | MEDIUM | FAIL | sortie standard conservée par Docker, hors de portée du service : `deploy/compose.hub.yml:29` | collecteur central hors hôte : action H11 |
| SEC-LOG-004 | MEDIUM | FAIL | vigie du socle (`socle/src/vigie.js:11`) ; plafond de l’assistant (`src/assistant/plafond.js:34`) ; limites propres aux routes invisibles pour elle | à corriger ; courriel (H2) |
| SEC-LOG-005 | LOW | FAIL | santé du conteneur : `Dockerfile:39` ; sonde du Hub (`hub.json:936`) | surveillance externe : action H10 |
| SEC-LOG-006 | MEDIUM | PASS | runbook ci-dessous |  |
| SEC-LOG-007 | HIGH | FAIL | fermeture globale des sessions : `socle/src/portail.js:376` ; jeton d’intégration révoqué d’un geste (`src/api/systeme.js:179`) ; mais la rotation de la clé maîtresse casse les secrets d’équipement (voir REQ-CFG-005) | à corriger |
| SEC-PRIV-001 | MEDIUM | PASS | `web/confidentialite.txt:7` avec durées ; purges automatiques : trafic (`src/api/trafic.js:54`), quotas (`src/assistant/plafond.js:41`), sessions et jetons du socle (`socle/src/comptes.js:897`) |  |
| SEC-PRIV-002 | MEDIUM | PASS | un cookie de session indispensable, documenté ; aucun traceur (`web/confidentialite.txt:82`) |  |
| SEC-PRIV-003 | MEDIUM | FAIL | `web/confidentialite.txt:65` décrit les destinataires par catégorie (« des fournisseurs publics de logos », « les registres d’adresses », « la messagerie ») sans les nommer | à corriger : nommer chaque destinataire |
| SEC-PRIV-004 | MEDIUM | PASS | export : `src/main.js:120` ; effacement en libre-service sous renfort : `socle/src/comptes.js:767`, le dernier administrateur excepté ; fil et quotas effacés avec le compte (`src/main.js:118`) | essais `socle/test/parcours.test.js:274`, `test/service.test.js:473` |
| SEC-PRIV-005 | HIGH | FAIL | voir REQ-DATA-002 | action H7 |
| SEC-PRIV-006 | LOW | FAIL | destinataires non nommés (voir SEC-PRIV-003) | à corriger ; conditions de traitement des services hors de l’Union : action H15 |
| SEC-PRIV-007 | MEDIUM | PASS | runbook : notification sous 72 heures (`web/confidentialite.txt:102`) |  |
| SEC-PRIV-008 | LOW | PASS | `web/confidentialite.txt:105` | aucune catégorie particulière de données |
| SEC-TEST-001 | MEDIUM | FAIL | `.github/workflows/verification.yml:114` | Actions : H3 |
| SEC-TEST-002 | HIGH | FAIL | voir REQ-CI-001 | actions H3, H4 |
| SEC-TEST-003 | HIGH | FAIL | image : `.github/workflows/publish.yml:49` | actions H3, H14 |
| SEC-TEST-004 | MEDIUM | FAIL | aucun passage DAST encore | ZAP en mode « baseline » contre l’instance d’essai : action H14 |
| SEC-TEST-005 | LOW | FAIL | voir REQ-WEB-001 | notation après HTTPS : action H1 |
| SEC-TEST-006 | HIGH | PASS | voir REQ-CI-006 |  |
| SEC-TEST-007 | LOW | UNKNOWN | sondage manuel en cours dans cette passe |  |
| SEC-TEST-008 | LOW | N/A | ni argent, ni santé, ni large public : service auto-hébergé pour quelques comptes invités ; `grep -rniE "stripe\|paypal\|checkout\|invoice\|payout\|refund" src web/*.js web/*/*.js socle/src socle/web/*.js` → 0 : aucun paiement |  |

## Not applicable
| ID | Why, with proof |
|---|---|
| REQ-CRYPT-003 | bcrypt jamais utilisé pour hacher ni vérifier : `grep -rnE "bcrypt\.(hash\|compare)\|from .bcrypt\|require\(.bcrypt" src socle/src` → 0 ; Argon2id seul ; une empreinte bcrypt de la 1.4.1 n’est pas reprise, le compte reçoit un lien de réinitialisation (`src/migration.js:95`) |
| SEC-AUTH-008 | aucune connexion par fournisseur externe : `grep -rniE "openid\|id_token\|redirect_uri\|authorization_code" socle/src src` → 0 |
| SEC-SESS-005 | aucun JWT : `grep -rniE "jsonwebtoken\|jwt\.(sign\|verify\|decode)\|from .jose" src web socle` → 0 |
| SEC-SESS-006 | aucun jeton de rafraîchissement : sessions serveur ; jetons d’intégration sans rafraîchissement, avec échéance facultative et révocation (`src/jetons.js:38`) |
| SEC-AUTHZ-005 | instance à un seul locataire, sans organisation, équipe ni espace : `grep -rniwE "tenants?\|workspaces?\|locataires?\|orgId\|organizationId" src socle/src` → 0 |
| SEC-INJ-002 | aucun ORM : node:sqlite, requêtes préparées seulement ; tout import est un module de Node ou un fichier du dépôt : `grep -rhoE "from '[^']+'" src socle/src \| sort -u \| grep -vE "from '(node:\|\.)" \| wc -l` → 0 |
| SEC-INJ-003 | aucune base documentaire : SQLite seulement ; `grep -rniE "mongodb://\|\$where" src socle/src` → 0 |
| SEC-XSS-007 | aucune redirection émise : `grep -rnE "Location\|writeHead\(30[1278]" src` → 0 ; `curl -sI "/login?next=https://evil.example"` → aucun Location (annexe B.4) |
| SEC-CSRF-005 | aucun webhook reçu : `grep -rniE "webhook\|x-hub-signature\|stripe-signature" src` → 0 ; les notifications sortantes partent vers des adresses réglées par un administrateur, à travers la garde de sortie |
| SEC-CSRF-006 | aucune redirection pilotée par paramètre : voir SEC-XSS-007 |
| SEC-API-006 | aucun GraphQL : `grep -rniE "graphql\|apollo" src web/*.js web/*/*.js socle/src` → 0 |
| SEC-API-008 | aucune opération monétaire ni crédit : `grep -rniE "stripe\|paypal\|checkout\|invoice\|payout\|refund" src web/*.js web/*/*.js socle/src socle/web/*.js` → 0 : aucun paiement |
| SEC-DB-002 | SQLite embarqué sans rôle ni identifiant : `src/db.js:189` ; aucun serveur de base, aucune connexion |
| SEC-DB-008 | le navigateur ne parle jamais à la base : SQLite côté serveur seulement, `grep -rniE "sqlite\|indexedDB" web --include=*.js` → 0 |
| SEC-FILE-001 | aucun envoi de fichier : `grep -rniE "multipart\|busboy\|formidable\|multer" src socle/src` → 0 ; le son de la dictée n’est pas un fichier : voir REQ-DATA-007 |
| SEC-FILE-002 | aucun envoi de fichier : voir SEC-FILE-001 ; corps bornés (voir SEC-API-010) |
| SEC-FILE-003 | aucun fichier d’utilisateur écrit : les seules écritures sont la base, ses fichiers WAL et les fichiers éphémères de SSH, nommés par le serveur |
| SEC-FILE-004 | aucun fichier d’utilisateur servi |
| SEC-FILE-005 | aucun fichier d’utilisateur stocké |
| SEC-FILE-006 | aucun fichier partagé entre utilisateurs |
| SEC-FILE-007 | aucune image reçue par le serveur : les photos d’appareils restent dans le navigateur (`web/composants/photo.js:6`) |
| SEC-FILE-008 | aucun import par adresse : voir SEC-CSRF-004 |
| SEC-PAY-001 | `grep -rniE "stripe\|paypal\|checkout\|invoice\|payout\|refund" src web/*.js web/*/*.js socle/src socle/web/*.js` → 0 : aucun paiement |
| SEC-PAY-002 | `grep -rniE "stripe\|paypal\|checkout\|invoice\|payout\|refund" src web/*.js web/*/*.js socle/src socle/web/*.js` → 0 : aucun paiement ; aucun webhook reçu |
| SEC-PAY-003 | `grep -rniE "stripe\|paypal\|checkout\|invoice\|payout\|refund" src web/*.js web/*/*.js socle/src socle/web/*.js` → 0 : aucun paiement ; aucun abonnement |
| SEC-PAY-004 | `grep -rniE "stripe\|paypal\|checkout\|invoice\|payout\|refund" src web/*.js web/*/*.js socle/src socle/web/*.js` → 0 : aucun paiement |
| SEC-PAY-005 | `grep -rniE "stripe\|paypal\|checkout\|invoice\|payout\|refund" src web/*.js web/*/*.js socle/src socle/web/*.js` → 0 : aucun paiement |
| SEC-NEXT-001 | Node sans cadriciel : `package.json:5`, aucune dépendance ; `grep -rniE "next/\|nextjs\|use server\|vercel" src web/*.js web/*/*.js socle/src socle/web/*.js` → 0 |
| SEC-NEXT-002 | Node sans cadriciel : `package.json:5`, aucune dépendance ; `grep -rniE "next/\|nextjs\|use server\|vercel" src web/*.js web/*/*.js socle/src socle/web/*.js` → 0 |
| SEC-NEXT-003 | Node sans cadriciel : `package.json:5`, aucune dépendance ; `grep -rniE "next/\|nextjs\|use server\|vercel" src web/*.js web/*/*.js socle/src socle/web/*.js` → 0 |
| SEC-NEXT-004 | Node sans cadriciel : `package.json:5`, aucune dépendance ; `grep -rniE "next/\|nextjs\|use server\|vercel" src web/*.js web/*/*.js socle/src socle/web/*.js` → 0 |
| SEC-NEXT-005 | Node sans cadriciel : `package.json:5`, aucune dépendance ; `grep -rniE "next/\|nextjs\|use server\|vercel" src web/*.js web/*/*.js socle/src socle/web/*.js` → 0 |
| SEC-NEXT-006 | Node sans cadriciel : `package.json:5`, aucune dépendance ; `grep -rniE "next/\|nextjs\|use server\|vercel" src web/*.js web/*/*.js socle/src socle/web/*.js` → 0 |
| SEC-NEXT-007 | Node sans cadriciel : `package.json:5`, aucune dépendance ; `grep -rniE "next/\|nextjs\|use server\|vercel" src web/*.js web/*/*.js socle/src socle/web/*.js` → 0 |
| SEC-NEXT-008 | Node sans cadriciel : `package.json:5`, aucune dépendance ; `grep -rniE "next/\|nextjs\|use server\|vercel" src web/*.js web/*/*.js socle/src socle/web/*.js` → 0 ; aucun déploiement Vercel |
| SEC-NEXT-009 | Node sans cadriciel : `package.json:5`, aucune dépendance ; `grep -rniE "next/\|nextjs\|use server\|vercel" src web/*.js web/*/*.js socle/src socle/web/*.js` → 0 ; aucune bibliothèque de cache client |
| SEC-BAAS-001 | `grep -rniE "supabase\|firebase\|firestore\|postgrest" src web/*.js web/*/*.js socle/src socle/web/*.js` → 0 ; base SQLite embarquée côté serveur : `src/db.js:189` |
| SEC-BAAS-002 | `grep -rniE "supabase\|firebase\|firestore\|postgrest" src web/*.js web/*/*.js socle/src socle/web/*.js` → 0 ; base SQLite embarquée côté serveur : `src/db.js:189` |
| SEC-BAAS-003 | `grep -rniE "supabase\|firebase\|firestore\|postgrest" src web/*.js web/*/*.js socle/src socle/web/*.js` → 0 ; base SQLite embarquée côté serveur : `src/db.js:189` |
| SEC-BAAS-004 | `grep -rniE "supabase\|firebase\|firestore\|postgrest" src web/*.js web/*/*.js socle/src socle/web/*.js` → 0 ; base SQLite embarquée côté serveur : `src/db.js:189` |
| SEC-BAAS-005 | `grep -rniE "supabase\|firebase\|firestore\|postgrest" src web/*.js web/*/*.js socle/src socle/web/*.js` → 0 ; base SQLite embarquée côté serveur : `src/db.js:189` |
| SEC-BAAS-006 | `grep -rniE "supabase\|firebase\|firestore\|postgrest" src web/*.js web/*/*.js socle/src socle/web/*.js` → 0 ; base SQLite embarquée côté serveur : `src/db.js:189` |
| SEC-BAAS-007 | `grep -rniE "supabase\|firebase\|firestore\|postgrest" src web/*.js web/*/*.js socle/src socle/web/*.js` → 0 ; base SQLite embarquée côté serveur : `src/db.js:189` |
| SEC-BAAS-008 | `grep -rniE "supabase\|firebase\|firestore\|postgrest" src web/*.js web/*/*.js socle/src socle/web/*.js` → 0 ; base SQLite embarquée côté serveur : `src/db.js:189` |
| SEC-BAAS-009 | `grep -rniE "supabase\|firebase\|firestore\|postgrest" src web/*.js web/*/*.js socle/src socle/web/*.js` → 0 ; base SQLite embarquée côté serveur : `src/db.js:189` |
| SEC-BAAS-010 | `grep -rniE "supabase\|firebase\|firestore\|postgrest" src web/*.js web/*/*.js socle/src socle/web/*.js` → 0 ; base SQLite embarquée côté serveur : `src/db.js:189` |
| SEC-BAAS-011 | `grep -rniE "supabase\|firebase\|firestore\|postgrest" src web/*.js web/*/*.js socle/src socle/web/*.js` → 0 ; base SQLite embarquée côté serveur : `src/db.js:189` |
| SEC-BE-005 | aucun Django : service Node, `git ls-files "*.py"` → 0 |
| SEC-BE-006 | aucun Flask ni FastAPI : service Node, `git ls-files "*.py"` → 0 |
| SEC-BE-007 | aucun code Python : `git ls-files "*.py"` → 0 |
| SEC-BE-008 | aucun PHP : `git ls-files "*.php"` → 0 |
| SEC-WP-001 | application Node écrite ici : `grep -rniE "wordpress\|wp-admin\|bubble\|webflow" src web/*.js web/*/*.js socle/src socle/web/*.js` → 0 |
| SEC-WP-002 | application Node écrite ici : `grep -rniE "wordpress\|wp-admin\|bubble\|webflow" src web/*.js web/*/*.js socle/src socle/web/*.js` → 0 |
| SEC-WP-003 | application Node écrite ici : `grep -rniE "wordpress\|wp-admin\|bubble\|webflow" src web/*.js web/*/*.js socle/src socle/web/*.js` → 0 |
| SEC-WP-004 | application Node écrite ici : `grep -rniE "wordpress\|wp-admin\|bubble\|webflow" src web/*.js web/*/*.js socle/src socle/web/*.js` → 0 |
| SEC-WP-005 | application Node écrite ici : `grep -rniE "wordpress\|wp-admin\|bubble\|webflow" src web/*.js web/*/*.js socle/src socle/web/*.js` → 0 |
| SEC-WP-006 | application Node écrite ici : `grep -rniE "wordpress\|wp-admin\|bubble\|webflow" src web/*.js web/*/*.js socle/src socle/web/*.js` → 0 |
| SEC-WP-007 | application Node écrite ici : `grep -rniE "wordpress\|wp-admin\|bubble\|webflow" src web/*.js web/*/*.js socle/src socle/web/*.js` → 0 |
| SEC-WP-008 | application Node écrite ici : `grep -rniE "wordpress\|wp-admin\|bubble\|webflow" src web/*.js web/*/*.js socle/src socle/web/*.js` → 0 |
| SEC-INFRA-005 | aucun stockage objet : `grep -rniE "\bs3\b\|aws-sdk\|@google-cloud\|azure\|bucket" src socle/src` → 0 |
| SEC-INFRA-006 | aucun nuage : service auto-hébergé, aucune clé IAM (`grep -rniE "aws_access_key\|AWS_SECRET\|GOOGLE_APPLICATION_CREDENTIALS\|AZURE_CLIENT" src socle/src .github` → 0) |
| SEC-INFRA-009 | aucune infrastructure décrite en code : `find . -name "*.tf" -o -name "Pulumi.yaml" -o -name "*.cfn.yml"` → 0 fichier |
| SEC-DEP-005 | aucune installation de paquet npm : ni npm install ni script de cycle de vie, dans le dépôt comme dans l’image (`Dockerfile:30` sans installation) |
| SEC-TEST-008 | ni argent, ni santé, ni large public : service auto-hébergé pour quelques comptes invités ; `grep -rniE "stripe\|paypal\|checkout\|invoice\|payout\|refund" src web/*.js web/*/*.js socle/src socle/web/*.js` → 0 : aucun paiement |

## Anonymity (REQ-ANON-001 to -010)
Arbre de travail : 0 occurrence de la liste d’anonymat ; les motifs de l’annexe B.1 y relèvent 9 lignes, dont trois à corriger (C10) et six faux positifs justifiés dans l’annexe B. Par rapport au dernier arbre publié (1.4.1), la 2.0 retire 57 occurrences de la liste dans 28 fichiers ; cet arbre publié relevait 83 lignes des motifs de l’annexe B.1. Images : les 7 images de l’arbre ne portent aucun bloc de métadonnées.

Exposition résiduelle, dans l’historique : les 51 commits publiés de la 1.x portent des termes de la liste dans leurs arbres ; 7 commits publiés sont signés par deux identités autres que le pseudonyme, dont une identité d’outil ; 40 dates d’auteur et 46 dates de validation portent un décalage horaire non nul ; 233 lignes de l’historique répondent au motif d’infrastructure de l’annexe B.1 ; 18 images distinctes restent lisibles dans l’historique, dont 10 portent des blocs de métadonnées. Les 7 premiers commits de la 2.0, jamais poussés, reprennent encore l’arbre de la 1.x avant son nettoyage ; tous les commits de la 2.0 sont signés du seul pseudonyme, en UTC, sans ligne de fin → décision H12. Hors du dépôt : les images publiées de la 1.x dans le registre de paquets du compte et les journaux d’Actions antérieurs (H12). Le balayage de l’arbre suit la liste d’anonymat et les motifs de l’annexe B.1 : une liste incomplète laisserait passer un terme qu’elle ne contient pas.

## Human actions required
Ce qu’aucun agent ne peut faire à la place de l’exploitant. Cette liste bloque la mise en production tant qu’elle n’est pas vide.

| # | Action | Contrôles | Étapes |
|---|---|---|---|
| H1 | Servir MapMyLAN en HTTPS | REQ-WEB-001, SEC-HDR-001, SEC-INFRA-001, SEC-TEST-005 | Dans le Hub : relais TLS ou certificat de l’autorité locale pour MapMyLAN ; déclarer l’adresse du relais dans « Relais de confiance » (SOCLE_PROXYS) ; « Accès sans HTTPS » à Non ; « Adresse publique » en https:// ; vérifier `curl -sI https://<mapmylan>/ \| grep -i strict-transport-security` ; noter le résultat de testssl.sh. Installé seul : relais TLS devant le port, mêmes variables dans `.env`, `HOTE=127.0.0.1`. |
| H2 | Relais SMTP et adresses d’alerte | REQ-AUTH-014, SEC-PAY-007 | Réglages avancés de MapMyLAN dans le Hub (ou `SOCLE_SMTP_*` dans `.env`) : relais, port, chiffrement, identifiants, expéditeur, adresse publique ; publier SPF, DKIM et DMARC (au moins quarantine) pour le domaine d’expédition ; chaque administrateur ajoute puis confirme son adresse dans Sécurité → Alertes par courriel. |
| H3 | GitHub | REQ-CI-001…005, GOV-003, GOV-005, SEC-INFRA-004/007/008, SEC-TEST-001…003, SEC-DEP-002/006/008 | Rétablir les Actions ; Settings → Branches : protéger `main` (pas de poussée forcée, contrôles requis : essais, secrets, identite, anonymat, analyse, publish) ; Code security : Dependabot alerts, secret scanning et push protection, private vulnerability reporting (le contact de security.txt) ; 2FA sur le compte et sur chaque console de fournisseur. |
| H4 | Liste d’anonymat | REQ-ANON-003, REQ-CI-004, REQ-CI-001 | Sur le poste : gitleaks ; `~/.config/git/denylist.txt`, un terme par ligne ; le crochet global en `~/.config/git/hooks/pre-commit`, rendu exécutable, lié en `commit-msg`, puis `git config --global core.hooksPath ~/.config/git/hooks`. Sur GitHub : secret de dépôt `LISTE_ANONYMAT` avec les mêmes termes. Vérifier : un commit d’essai portant un terme est refusé par le crochet, puis par la vérification. |
| H5 | Brûler les secrets vus pendant le développement | SEC-SECRETS-006 | @BotFather `/revoke` pour tout jeton Telegram essayé, puis le recoller dans Notifications ; changer le mot de passe (ou la clé) du compte de l’équipement réseau essayé, puis réenregistrer l’équipement ; changer le mot de passe applicatif de toute boîte mail essayée ; dans le Hub, régénérer le jeton d’intégration de MapMyLAN, les jetons de VOX et de SYNAPSE, et redéployer ; tourner SOCLE_CLE une fois (README, « Tourner la clé maîtresse »). |
| H6 | Identifiants par environnement, moindre privilège | REQ-CFG-003, SEC-SECRETS-005, GOV-004 | Un compte dédié à MapMyLAN sur le routeur (lecture et règles de pare-feu seulement, jamais l’administrateur du routeur) ; une boîte mail et un bot Telegram pour l’essai, d’autres pour la production ; instance d’essai et production sans aucun jeton commun ; noter la liste ici. |
| H7 | Chiffrement des disques | REQ-DATA-002, SEC-DB-003, SEC-PRIV-005 | LUKS (ou chiffrement du stockage de l’hyperviseur) sur l’hôte qui porte le volume de MapMyLAN. |
| H8 | Sauvegardes et exercices | REQ-DATA-003, SEC-DB-006, REQ-DATA-005 | Paire RSA 3072 bits créée hors de la machine de MapMyLAN (README, « Sauvegardes ») ; cron quotidien `docker exec -i <mapmylan> node src/cli.js sauvegarde < mapmylan-sauvegarde.pub > mapmylan-$(date -u +%F).sauv` ; copie hors hôte, trente jours ; restauration réelle avec `node src/cli.js restaurer`, datée ici ; dérouler une fois le runbook ci-dessous. |
| H9 | Hôtes | SEC-INFRA-003 | Pare-feu (seuls les ports publiés ; le port de l’API en réseau hôte fermé au réseau local), SSH par clé sans root, mises à jour de sécurité automatiques, fail2ban. |
| H10 | Disponibilité vue de l’extérieur | SEC-LOG-005 | Une sonde externe sur `/api/health`, ou décision écrite : service de réseau local seulement, sondes du Hub suffisantes. |
| H11 | Journaux centralisés | SEC-LOG-003 | Transférer les journaux du conteneur (dont les lignes `"journal":"mapmylan"`) vers un collecteur hors de l’hôte : pilote de journalisation Docker ou agent. |
| H12 | Historique publié | REQ-ANON-001, REQ-ANON-002, REQ-ANON-004, REQ-ANON-006, REQ-ANON-008 | Décision de publication, à prendre avant toute poussée de la 2.0 (voir la section « Anonymity ») : recréer le dépôt à partir d’un arbre propre (après avoir vérifié qu’aucune bifurcation ni copie n’existe, supprimer l’ancien dépôt, le recréer vide, pousser une racine neuve portant l’arbre de la 2.0), ou pousser la suite de l’historique et accepter l’exposition. Supprimer aussi, dans les paquets du compte, les images de la 1.x et les journaux d’Actions antérieurs. |
| H13 | Domaine | REQ-ANON-009, SEC-INFRA-002 | Si MapMyLAN reçoit un nom public : protection WHOIS, verrou du registraire, 2FA, enregistrement CAA, suppression des enregistrements orphelins. |
| H14 | Crible au déploiement | SEC-INFRA-004, SEC-TEST-003, SEC-TEST-004 | Sur l’instance d’essai : `trivy image ghcr.io/codexx64/mapmylan:2.0.0` sans CRITICAL ni HIGH corrigeable ; `zap-baseline.py -t http://<essai>:<port>` ; résultats notés ici. |
| H15 | Destinataires hors de l’Union | SEC-PRIV-006 | Pour chaque service allumé (Telegram, registres RDAP, fournisseurs de logos, messagerie et billetterie choisies) : accepter ses conditions de traitement ou l’éteindre ; la notice de confidentialité les nomme. |
| H16 | Clé maîtresse | REQ-DATA-003, SEC-DB-006 | Garder une copie hors ligne de SOCLE_CLE (coffre du Hub, ou `secrets/socle_cle` installé seul), à part des sauvegardes de la base : sans elle, une sauvegarde restaurée ne déchiffre ni les secrets TOTP ni ceux des équipements, des boîtes et des canaux. |

Orthographe du pseudonyme : le manuel nomme l’identité « Codex64 » ; les commits, la licence et le compte GitHub portent la forme du compte, identique dans tous les commits de la 2.0. Changer maintenant créerait une identité de plus dans le journal git ; à trancher par l’exploitant avec H12.

## Secrets inventory
| Secret | Where it lives | Scope | Rotation procedure | Last rotated |
|---|---|---|---|---|
| SOCLE_CLE (tirée par le Hub, ou par l’exploitant installé seul) | coffre du Hub → variable du conteneur ; installé seul : secret Docker `secrets/socle_cle`, hors du volume | scelle les secrets TOTP et ceux des équipements, des boîtes mail et des canaux | dans le Hub : la clé actuelle dans « Clé maîtresse remplacée » (SOCLE_CLE_ANCIENNE), une neuve (`openssl rand -base64 32`) dans « Clé maîtresse », redéployer ; les secrets TOTP sont rescellés, mais ceux des équipements, des boîtes et des canaux deviennent illisibles une fois la clé ancienne retirée (C2) | création à l’installation |
| INTEGRATION_TOKEN_SEED (jeton d’intégration du Hub, tiré par le Hub) | coffre du Hub → variable ; en base, empreinte SHA-256 seulement | API de MapMyLAN au rôle membre, routes marquées « jeton » | régénérer dans le Hub, redéployer : l’empreinte est remplacée au démarrage et l’ancien jeton cesse aussitôt | création à l’installation |
| Jetons d’intégration (`mml_…`, tirés par MapMyLAN) | empreinte SHA-256 en base ; le clair chez le programme qui l’utilise | rôle lecture ou membre, routes marquées « jeton » | page Intégrations (administrateur, renfort) : révoquer, en créer un autre, le coller chez le programme | à la création |
| Identifiants de l’équipement réseau et des consoles SSH (émis par l’exploitant sur l’équipement) | en base, scellés sous SOCLE_CLE, liés à leur ligne | commandes de lecture et de défense sur l’équipement | changer le mot de passe ou la clé sur l’équipement, puis réenregistrer dans Équipement réseau ou Consoles SSH (renfort) | à faire (H5) |
| Mots de passe des boîtes mail (émis par le fournisseur de courriel) | en base, scellés sous SOCLE_CLE | IMAP et SMTP de la boîte | changer le mot de passe applicatif chez le fournisseur, le ressaisir dans Boîtes mail (renfort) | à faire (H5) |
| Jeton du bot Telegram (émis par @BotFather), mot de passe SMTP et clé de billetterie des canaux | en base, scellés sous SOCLE_CLE | envoi des alertes, commandes du bot | @BotFather `/revoke` (ou le fournisseur), puis ressaisir dans Notifications (administrateur, renfort) | à faire (H5) |
| VOX_JETON, SYNAPSE_JETON (dérivés par le Hub) | coffre du Hub → variables | voix ; mémoire partagée, pour ce seul service | régénérés par le Hub avec le service concerné, puis redéploiement de MapMyLAN | avec VOX et SYNAPSE |
| POSTE_SEND_KEY (émise par le relais Poste) | coffre du Hub ou `.env` (0600) | envoi par le relais | en émettre une neuve sur le relais, la poser, redéployer | à la mise en service |
| SOCLE_SMTP_MOTDEPASSE (émis par le fournisseur de courriel) | coffre du Hub → variable ; installé seul : `.env` | relais des alertes du socle | changer chez le fournisseur, coller dans le Hub, redéployer | à la mise en service (H2) |
| SOCLE_POIVRE (tiré par le Hub) | coffre du Hub → variable | poivre HMAC des mots de passe | le nouveau dans `SOCLE_POIVRE`, l’ancien dans `SOCLE_POIVRE_ANCIEN` : chaque mot de passe passe au nouveau à la connexion suivante | création à l’installation |
| SOCLE_JETON_INSTALLATION (tiré par le socle) | tiré au premier démarrage, journaux du conteneur | création du premier compte, puis inutile | aucun : invalide dès qu’un compte existe | — |
| MAPMYLAN_V1_MASTER_KEY (celle de la 1.4.1) | coffre du Hub, pendant la reprise seulement | rouvre les secrets de la 1.4.1 | vider le champ après la reprise ; la clé de la 1.4.1 est à tenir pour exposée | reprise |
| Clé privée des sauvegardes (tirée par l’exploitant, `openssl genpkey`) | hors de la machine de MapMyLAN, jamais dans le conteneur | relit les sauvegardes | nouvelle paire, sauvegardes suivantes chiffrées pour la nouvelle clé publique ; garder l’ancienne privée tant que ses sauvegardes sont conservées | à créer (H8) |

## Incident runbook
Détecter : alertes « vigie » et « dépense » dans la page Sécurité des administrateurs (et par courriel, H2) ; refus : `docker logs <mapmylan> | grep '"resultat":"refus"'` ; jetons refusés : `docker logs <mapmylan> | grep connexion.jeton` ; limites : `docker logs <mapmylan> | grep limite.atteinte`.

```bash
# 1. Fermer toutes les sessions sauf la sienne (renfort demandé)
#    Page Comptes → « Fermer toutes les sessions », ou :
curl -X POST -H 'Content-Type: application/json' -H "X-CSRF: $CSRF" -b "$COOKIE" https://<mapmylan>/api/compte/admin/sessions/fermer-tout -d '{}'
# 2. Couper un programme : révoquer son jeton d'intégration (l'ancien cesse aussitôt)
curl -X DELETE -H "X-CSRF: $CSRF" -b "$COOKIE" https://<mapmylan>/api/integrations/<id>
#    Le jeton du Hub : Hub → MapMyLAN → Réglages → régénérer le jeton → Redéployer
# 3. Couper les actions à distance : Consoles SSH et Équipement réseau → supprimer ; Commandes bot → désactiver ;
#    Notifications → Telegram → supprimer (le bot cesse d'écouter)
# 4. Couper l'assistant : Hub → MapMyLAN → Réglages → IA_MODELE vide, ou retirer Ollama → Redéployer
# 5. Tourner les secrets touchés : voir « Secrets inventory »
# 6. Forcer un nouveau mot de passe : Page Comptes → compte → « Réinitialiser » (le second facteur reste exigé), ou :
docker exec <mapmylan> node src/cli.js lien-reinit <identifiant>
# 7. Restaurer, depuis le poste qui garde la clé privée, puis remettre la base dans le volume
node src/cli.js restaurer mapmylan-sauvegarde.pem mapmylan.db < mapmylan-AAAA-MM-JJ.sauv
docker stop <mapmylan> && docker run --rm -v <volume>:/app/data -v "$PWD":/b busybox sh -c 'cp /b/mapmylan.db /app/data/mapmylan.db && rm -f /app/data/mapmylan.db-wal /app/data/mapmylan.db-shm && chown 1000:1000 /app/data/mapmylan.db && chmod 600 /app/data/mapmylan.db' && docker start <mapmylan>
#    Base sauvegardée avant une rotation : poser la clé d'alors dans SOCLE_CLE_ANCIENNE avant de démarrer
# 8. Vérifier la chaîne du journal : Page Comptes → Journal de sécurité (« chaîne intacte »)
```
Qui : l’exploitant de l’instance tient chaque étape ; supports des fournisseurs pour révoquer un secret : @BotFather (`/revoke`) pour Telegram, le fournisseur de la boîte mail, l’équipement réseau lui-même, support.github.com pour le dépôt. Communiquer : prévenir les comptes concernés ; si des données personnelles ont pu être lues (inventaire du réseau, trafic, fils de l’assistant, comptes), notifier l’autorité de contrôle sous 72 heures à compter de la découverte (heure de découverte, nature, comptes touchés, mesures prises), et les personnes si le risque est élevé. Revue après incident : cause, chronologie, contrôle qui a manqué, correctif et essai de non-régression.

## Inventory
Routes publiques : `GET /api/health` (`{ok:true}` seulement pour un anonyme), `GET /.well-known/security.txt`, cérémonies de connexion et d’installation du socle (`/api/compte/*` publiques), fichiers de `web/` et `socle/web/`. Session ou jeton : 112 routes sous `/api`, chacune avec son rôle, son renfort, son schéma et sa portée pour les jetons, les listes figées dans l’essai de balayage des droits (18 routes admises aux jetons d’intégration, 34 réservées aux administrateurs, 23 sous renfort). Flux temps réel `GET /api/flux` (session, six onglets au plus).

Données : `mapmylan.db` (comptes, sessions, facteurs et journal chaîné du socle ; inventaire du réseau, ports, CVE, historique des appareils, alertes, journal de service, carte, VLAN, trafic relevé, mesures de la machine hôte ; secrets scellés des équipements, boîtes et canaux ; empreintes des jetons d’intégration ; fils de l’assistant et quotas — sensibilité : personnelle et secrète), volume `/app/data` en 0700, base en 0600 ; instantanés chiffrés de la ligne de commande, gardés hors de la machine ; photos d’appareils et préférences dans le navigateur seulement.

Tiers : l’équipement réseau déclaré (SSH à clé d’hôte épinglée, ou API locale à certificat épinglé), Ollama, VOX et SYNAPSE de l’exploitant, relais Poste de l’exploitant, Telegram (api.telegram.org) si le canal est allumé, relais SMTP et IMAP des boîtes réglées, billetterie réglée, registres RDAP (rdap.org et les registres régionaux vers lesquels il redirige) si l’interrogation est allumée, fournisseurs de logos (icons.duckduckgo.com, www.google.com, unavatar.io, logo.clearbit.com) si les logos sont allumés, proxy du socket Docker en lecture seule sur la boucle locale, relais SMTP de l’exploitant pour les alertes du socle.


## Appendix B sweep
Relancé à chaque génération de ce fichier (bash, LC_ALL=C.UTF-8) ; un résultat différent de celui qui a été relu arrête la génération. B.5 est dans NO-VIBE.md.

| # | Commande | Résultat | Justification |
|---|---|---|---|
| B.1.1 | `git log --all --format='%an <%ae>' \| sort -u \| wc -l` | `3` | le pseudonyme pour la 2.0 ; deux autres identités dans des commits publiés de la 1.x (H12) |
| B.1.2 | `git log --all --format='%cn <%ce>' \| sort -u \| wc -l` | `2` | idem (H12) |
| B.1.3 | `git log d99005a..HEAD --format='%an <%ae>%n%cn <%ce>' \| sort -u` | `CodexX64 <CodexX64@users.noreply.github.com>` | tous les commits de la 2.0 : le pseudonyme seul |
| B.1.4 | `git log --all --format='%B'` filtré par les mentions d’outil de l’annexe B.1 et de REQ-ANON-004, compté | `0` | aucune ligne de fin ni mention d’outil dans aucun message |
| B.1.5 | `git log --all --format='%B' \| rg -ci 'assistant'` | `16` | le nom d’une fonction du produit (l’assistant de MapMyLAN), jamais une attribution |
| B.1.6 | `find . -path ./node_modules -prune -o \( -name .ai -o -name .cursor -o -name .aider -o -name .continue -o -name .windsurfrules \) -print` | 0 ligne |  |
| B.1.7 | `find` des fichiers de consignes d’outil de l’annexe B.1, arbre de travail | 0 ligne |  |
| B.1.8 | `git log --all --name-only` filtré par les fichiers de consignes d’outil de l’annexe B.1 | 0 ligne | aucun fichier de consignes d’outil dans tout l’historique |
| B.1.9 | `git grep -nIiE` avec le motif « personal infrastructure, paths and networks » de l’annexe B.1, hors des deux fichiers de conformité | 9 lignes | trois lignes à corriger (deux chemins personnels, un nom de machine), et six faux positifs : le chemin d’API de l’administration des comptes de la 1.4.1 cité par la documentation et par le faux serveur de l’outil de comparaison, les plages par défaut du réseau Docker dans deux réglages du manifeste, un nom mDNS fabriqué dans le parcours navigateur, et le suffixe mDNS retiré par le balayage |
| B.1.10 | `git grep -nIiE` avec le motif « personal infrastructure, paths and networks » de l’annexe B.1, sur l’arbre publié d99005a, compté | `83` | le dernier arbre publié de la 1.x (H12) |
| B.1.11 | `git log --all -p` filtré par le motif « infrastructure personnelle » de l’annexe B.1, compté | `233` | lignes des commits publiés et de leurs retraits (H12) ; ailleurs, des mots qui contiennent le motif |
| B.1.12 | `git log --all --format='%aI' \| rg -v '\+00:00' \| wc -l` | `40` | commits publiés de la 1.x (H12) |
| B.1.13 | `git log --all --format='%cI' \| rg -v '\+00:00' \| wc -l` | `46` | idem |
| B.1.14 | `git log d99005a..HEAD --format='%aI%n%cI' \| rg -v '\+00:00' \| wc -l` | `0` | tous les commits de la 2.0 en UTC |
| B.1.15 | `blocs_png.py arbre` (hors dépôt) : blocs de métadonnées des images suivies | 0 ligne | 7 images suivies (icônes, logo) : blocs IHDR, IDAT, IEND seulement |
| B.1.16 | `blocs_png.py histoire` (hors dépôt) | `18 images distinctes dans l'historique, 10 avec des blocs de métadonnées` | captures d’écran et images de la 1.x (H12) |
| B.2.1 | `gitleaks git --no-banner --redact --log-opts=--all . 2>&1 \| tail -1` | `no leaks found` | tout l’historique |
| B.2.2 | `gitleaks dir --no-banner --redact . 2>&1 \| tail -1` | `no leaks found` | arbre de travail |
| B.2.3 | `git grep -nIiE '(api[_-]?key\|secret\|token\|password\|bearer)\s*[=:]\s*["'"'"'][^"'"'"']{8,}' -- . ':!SECURITY.md' ':!NO-VIBE.md'` | 6 lignes | préfixe fabriqué du faux serveur de l’outil de comparaison, vecteur publié de la RFC 6238, mots de passe et jetons fabriqués des essais (SSH, reprise, contrôleur) ; aucune vraie valeur |
| B.2.4 | `git grep -nI -e '-----BEGIN (RSA\|EC\|OPENSSH\|PGP) PRIVATE' -- . ':!SECURITY.md' ':!NO-VIBE.md'` | 0 ligne |  |
| B.2.5 | `rg -ni 'sk_live\|service_role\|xox[baprs]-\|-----BEGIN' web socle/web` | 3 lignes | l’indication de saisie (placeholder) de trois champs « clé privée » ; aucune clé ; aucune étape de construction |
| B.2.6 | `curl -s -o /dev/null -w '%{http_code}' http://localhost:18190/.env` | `200` | instance locale ; l’interface est rendue pour toute adresse sans extension (C1) |
| B.3.1 | `rg -n 'dangerouslySetInnerHTML\|innerHTML *=\|outerHTML *=\|document\.write' . -g '!SECURITY.md' -g '!NO-VIBE.md'` | 2 lignes | le gabarit du socle : balisage écrit dans le code, valeurs posées en nœuds texte ou attributs (SEC-XSS-001) |
| B.3.2 | `rg -n 'eval\(\|new Function\(\|execSync\|child_process\|os\.system\|subprocess.*shell=True' . -g '!SECURITY.md' -g '!NO-VIBE.md'` | 5 lignes | le seul point de lancement du service («src/executeur.js», execFile sans shell, liste de programmes), et quatre essais ou outils d’essai (execFileSync, spawnSync, arguments en tableau) |
| B.3.3 | `rg -n '[^.]\bexec\(' . -g '!SECURITY.md' -g '!NO-VIBE.md' \| rg -v '\.exec\('` | 0 ligne |  |
| B.3.4 | `rg -n 'f"SELECT\|"SELECT .*" *\+\|\$\{.*\} *FROM\|\.raw\(\|query\(.*\+ *req\.' . -g '!SECURITY.md' -g '!NO-VIBE.md'` | 0 ligne |  |
| B.3.5 | `rg -n 'Math\.random\|uuidv1\|new Random\(\)' . -g '!SECURITY.md' -g '!NO-VIBE.md'` | 3 lignes | un commentaire qui l’écarte, et deux animations de l’interface (durée d’une traînée, éclat d’une particule) ; aucune valeur de sécurité |
| B.3.6 | `rg -n 'verify *= *False\|rejectUnauthorized: *false\|InsecureSkipVerify' . -g '!SECURITY.md' -g '!NO-VIBE.md'` | 0 ligne |  |
| B.3.7 | `rg -n 'jwt\.decode\(\|algorithms: *\[.*none\|verify: *false' . -g '!SECURITY.md' -g '!NO-VIBE.md'` | 0 ligne |  |
| B.4.1 | `curl -sI http://localhost:18190/ \| rg -i 'content-security\|x-content-type\|referrer-policy\|permissions-policy\|x-frame\|cross-origin' \| wc -l` | `7` | CSP à nonce sans joker, nosniff, no-referrer, DENY, COOP et CORP same-origin, Permissions-Policy ; HSTS dès que la requête est chiffrée (H1) |
| B.4.2 | `curl -sI -H 'X-Forwarded-Proto: https' http://localhost:18190/ \| rg -i 'strict-transport'` | 0 ligne | X-Forwarded-Proto ignoré hors des relais déclarés (SOCLE_PROXYS) |
| B.4.3 | `curl -sI http://localhost:18190/ \| rg -i '^(server\|x-powered-by\|x-aspnet\|x-generator)'` | 0 ligne |  |
| B.4.4 | `curl -sI -H 'Origin: https://evil.example' http://localhost:18190/api/devices \| rg -i access-control` | 0 ligne | aucun CORS : même origine seulement |
| B.4.5 | `curl -s -o /dev/null -w '%{http_code}' -X OPTIONS -H 'Origin: https://evil.example' -H 'Access-Control-Request-Method: POST' http://localhost:18190/api/compte/connexion` | `404` | aucune réponse de pré-vol |
| B.4.6 | `curl -sI 'http://localhost:18190/login?next=https://evil.example' \| rg -i '^location'` | 0 ligne | aucune redirection |
| B.4.7 | `curl -s -o /dev/null -w '%{http_code}' http://localhost:18190/.git/config` | `200` | voir C1 |
| B.4.8 | `for i in $(seq 1 30); do curl -s -o /dev/null -w '%{http_code} ' -X POST http://localhost:18190/api/compte/connexion -H 'Content-Type: application/json' -H 'Origin: http://localhost:18190' -d '{"identifiant":"quelquun","motDePasse":"mauvais mot de passe"}'; done` | `401 401 401 428` | trois échecs, puis preuve de travail exigée (428) ; 429 et verrouillage au-delà |
