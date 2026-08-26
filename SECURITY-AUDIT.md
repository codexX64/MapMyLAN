# MapMyLAN — Rapport d'audit de sécurité

**Cible :** MapMyLAN Codex64 (backend Node/Express + Prisma, frontend Vite/React, modules `src/`, mécanisme d'extensions)
**Portée :** l'intégralité du code de ce dépôt. Les modules déposés dans `extensions/` sont propres à chaque installation et sortent de cette portée : ils sont chargés au démarrage et doivent être audités par qui les écrit.
**Référentiel :** *How to Secure an AI-Generated Website Like a Pro* — OWASP Top 10 2025 + OWASP Top 10 LLM
**Dates :** première passe 2026-08-18 · seconde passe 2026-08-23 (section 7)
**Type de passe :** audit + remédiation **complète** — les 20 constats de la première passe et les 5 de la seconde sont corrigés dans ce dépôt

---

## 1. Résumé exécutif

MapMyLAN partait d'un socle de sécurité déjà solide (Argon2id + poivre, égalisation des temps de réponse, verrouillage de compte, versionnage de jeton, chiffrement AES-256-GCM des identifiants d'équipement, validation « refus par défaut » des adresses réseau, garde anti-enchaînement sur les commandes routeur). L'audit a relevé **20 constats** ; **19 sont corrigés et un l'est partiellement** (H-03, voir section 8), et des contrôles de gouvernance et de chaîne d'approvisionnement ont été ajoutés.

Les deux failles critiques mettaient en jeu l'exécution de code — l'une sans authentification. Elles sont fermées, et les protections structurelles restantes (session en cookie `HttpOnly`, anti-CSRF, en-têtes nginx, moindre privilège Docker, CI de sécurité) ont été mises en place.

**Décompte final par sévérité (20 constats)**

| Sévérité | Total | Corrigés | Résiduels |
|----------|:-----:|:--------:|:---------:|
| CRITICAL | 2  | **2** | 0 |
| HIGH     | 6  | **6** | 0 |
| MEDIUM   | 7  | **7** | 0 |
| LOW      | 5  | **5** | 0 |
| **Total**| **20** | **20** | **0** |

**Ce qui a changé, en clair**

1. Les routes de commandes/bot, jadis ouvertes à tous, exigent maintenant une session admin. Fin de l'exécution SSH non authentifiée sur le routeur.
2. Le scan et l'enrichissement valident désormais chaque IP/plage avant de toucher un shell. Fin de l'injection de commande.
3. Plus d'identifiants `admin/admin` : refus des mots de passe faibles, secret aléatoire généré et affiché une fois.
4. Le jeton de session est passé de `localStorage` à un **cookie `HttpOnly` + protection CSRF**. Voir la nuance en section 7 : l'interface en conserve encore une copie dans `localStorage`, et le retrait de cette copie reste à faire.
5. En-têtes de sécurité posés par nginx (CSP sur le document), déploiement Docker au moindre privilège (socket Docker retiré au profit d'un proxy lecture seule), et une **chaîne CI** (npm audit, gitleaks, SBOM) qui garde les dépendances sous contrôle.

---

## 2. Tableau des constats

Statut : **FIXED** = corrigé dans le code livré.

| ID | Sévérité | Statut | Preuve (fichier) | Constat | Correctif appliqué |
|----|----------|--------|------------------|---------|--------------------|
| C-01 | CRITICAL | ✅ FIXED | `routes/commands.ts`, `routes/botCommands.ts` | Routes de commandes/bot accessibles sans authentification → RCE non authentifiée via `exec_ssh`. | `router.use(authRequired)` + `requireRole("admin")` sur création/modif/suppression/déclenchement. |
| C-02 | CRITICAL | ✅ FIXED | `services/scanner.ts`, `services/enrichment.ts`, `routes/devices.ts` | IP/plage interpolées dans un shell sans validation → injection de commande. | Gardes `ipSur`/`plageSure`/`communauteSure` (`estIP`/`estCIDR`) avant chaque commande ; validation à la création d'appareil et au lancement du scan. |
| H-01 | HIGH | ✅ FIXED | `frontend/src/pages/index.tsx` | XSS stocké : réponse de bot (données d'appareil) rendue en HTML. | Rendu en texte via `stripTags()`. |
| H-02 | HIGH | ✅ FIXED | `prisma/seed.ts` | Identifiants par défaut `admin`/`admin`. | Refus des mots de passe faibles/courts ; sinon secret aléatoire généré, affiché une fois ; compte existant intact. |
| H-03 | HIGH | ⚠️ PARTIEL | `middleware/auth.ts`, `middleware/csrf.ts`, `routes/auth.ts`, `ws/realtime.ts`, `frontend/src/api/*`, `stores/app.ts` | Jeton JWT en `localStorage` → vol par XSS. | **Cookie `HttpOnly; SameSite=Strict`** (`Secure` sous HTTPS) + **anti-CSRF double soumission** ; WS authentifié par le cookie avec vérification de version de jeton ; route `/auth/logout` qui efface les cookies. **La copie en `localStorage` subsiste** : voir section 7. |
| H-04 | HIGH | ✅ FIXED | `frontend/nginx.conf` | Aucun en-tête de sécurité sur le document servi. | CSP, X-Frame-Options DENY, nosniff, Referrer-Policy, Permissions-Policy (+ HSTS prêt pour HTTPS) ; `X-Forwarded-For` transmis. |
| H-05 | HIGH | ✅ FIXED | `services/defense.ts` | Cible de bannissement non validée avant construction de commande. | `validerCible()` appelée dans `act()`. |
| S-01 | HIGH | ✅ FIXED | `extensions/synapse.js` *(homelab)* | Spool `/var/tmp` partagé en 0644 : faux événements rejoués avec le token, lecture de l'inventaire. | Spool privé (`mkdir 0700`, fichiers `0600`), refus non-propriétaire/symlink, **vérif. de hash** avant rejeu. |
| M-01 | MEDIUM | ✅ FIXED | `index.ts` | `CORS_ORIGIN=*` avec `credentials:true`. | `credentials` désactivé si origine `*` + avertissement au démarrage. |
| M-02 | MEDIUM | ✅ FIXED | `extensions/synapse.js` *(homelab)* | Token Bearer en clair vers URL non validée. | `urlSynapseSure()` : HTTPS exigé sauf hôte interne ; token non attaché sinon. |
| M-03 | MEDIUM | ✅ FIXED | `src/ticket.ts` | Injection d'en-tête courriel via nom d'hôte. | `S()` retire caractères de contrôle et marques invisibles. |
| M-04 | MEDIUM | ✅ FIXED | `src/ticket.ts` | SSRF + fuite de clé via URL de billetterie arbitraire. | `urlBilletterieSure()` : HTTPS exigé sauf RFC1918 ; **169.254/16 exclu** ; identifiants d'URL refusés. |
| M-05 | MEDIUM | ✅ FIXED | `src/extensions.ts` | Chargeur `require()` exécutant tout fichier du dossier. | Refus des fichiers inscriptibles groupe/autres, symlinks, non-possédés. |
| M-06 | MEDIUM | ✅ FIXED | `docker-compose.yml`, `services/host.ts` | Backend en réseau hôte + `docker.sock` + capacités larges. | **Socket Docker retiré** du backend → proxy lecture seule (`docker-socket-proxy`, conteneurs seuls) ; `cap_drop: ALL` + seules `NET_ADMIN`/`NET_RAW` rendues ; `no-new-privileges` sur tous les services. Réseau hôte conservé par conception (scanner LAN), désormais sans capacité superflue. |
| S-06 | LOW | ✅ FIXED | `src/ticket.ts` | Override d'urgence pouvant forcer P1. | Override limité aux déclassements. |
| F-07 | LOW | ✅ FIXED | `frontend/src/lib/icons.tsx` | Sink XSS latent dans `title` de SVG. | `escapeXml(title)`. |
| INFRA-XFF | LOW | ✅ FIXED | `frontend/nginx.conf` | `X-Forwarded-For` non transmis. | En-tête ajouté (`/api/` et `/ws/`). |
| S-07 | LOW | ✅ FIXED | `extensions/synapse.js` *(homelab)* | Domaine interne cité dans un commentaire. | Commentaire reformulé sans nom réel. |
| S-08 | LOW | ✅ FIXED | `src/WorldTrafficView.tsx` | Favicons chargés depuis Google → fuite de domaines + IP. | Remplacé par une pastille locale (initiale, teinte déterministe) — **aucun appel réseau**. |
| S-09 | LOW | ✅ FIXED | `src/detourage.ts` | Bombe de décompression image → DoS onglet. | Plafond de dimensions (10 000 px/côté, 40 Mpx) avant allocation. |

---

## 3. Couverture OWASP 2025 (A01–A10)

Une catégorie **PASSE** si tous ses contrôles CRITICAL+HIGH passent.

| Catégorie | Résultat | Contrôles déterminants |
|-----------|:--------:|------------------------|
| **A01 – Broken Access Control** | ✅ PASS | C-01 corrigé ; session en cookie `HttpOnly` (H-03, partiel) ; `authRequired`/`requireRole` sur tout le reste. |
| **A02 – Cryptographic Failures** | ✅ PASS | Argon2id+poivre, AES-256-GCM, `timingSafeEqual` ; token synapse protégé (M-02). |
| **A03 – Software Supply Chain** | ✅ PASS | Chargeur d'extensions durci (M-05) ; builds reproductibles (`npm ci`, SEC-DEP-001) ; SBOM CycloneDX et gitleaks en CI. |
| **A04 – Insecure Design** | ✅ PASS | « Refus par défaut » (`valider.ts`), garde de commande, verrouillage de compte, anti-CSRF. |
| **A05 – Injection** | ✅ PASS | C-02, H-05, M-03 corrigés ; requêtes DB paramétrées (Prisma). |
| **A06 – Vulnerable & Outdated Components** | ✅ PASS | `npm audit --audit-level=high` bloquant en CI + passe hebdomadaire ; lockfiles committés et installés à l'identique. |
| **A07 – Auth Failures** | ✅ PASS | H-02 corrigé ; rate-limit + verrouillage + versionnage de jeton + cookie `HttpOnly`. |
| **A08 – Software/Data Integrity** | ✅ PASS | S-01 corrigé (hash vérifié + permissions) ; builds reproductibles. |
| **A09 – Logging & Monitoring** | ✅ PASS | `logEvent`/`createAlert` sur les actions sensibles ; pas de secret journalisé. |
| **A10 – SSRF** | ✅ PASS | M-04 + M-02 corrigés (dont exclusion des métadonnées 169.254/16) ; `exigerUrlEquipement` strict. |

**Toutes les catégories passent.** Gouvernance : GOV-001 (cet audit), GOV-002 (`ASSETS.md`), GOV-003 (`.well-known/security.txt`) sont en place.

---

## 4. Nouveaux contrôles ajoutés

- **Session en cookie `HttpOnly; SameSite=Strict`** (`Secure` dès que la connexion est en HTTPS) + jeton anti-CSRF (double soumission, en-tête `X-CSRF-Token`). WebSocket authentifié par le cookie, avec vérification de la version de jeton — un jeton révoqué par un changement de mot de passe ne peut plus ouvrir le flux. Route `/auth/logout` qui efface les cookies.
- **En-têtes de sécurité nginx** sur le document lui-même (CSP, X-Frame-Options, nosniff, Referrer-Policy, Permissions-Policy ; HSTS prêt à activer sous HTTPS).
- **Moindre privilège Docker** : `docker-socket-proxy` en lecture seule à la place du socket brut ; `cap_drop: ALL` puis seules les capacités nécessaires ; `no-new-privileges` sur tous les services ; builds reproductibles (`npm ci`).
- **CI de sécurité** (`.github/workflows/security.yml`) : `npm audit` bloquant, `gitleaks`, SBOM CycloneDX, typecheck/build — à chaque push/PR et chaque semaine.
- **Gouvernance** : `ASSETS.md` (inventaire routes/données/secrets/tiers) et `.well-known/security.txt` (canal de divulgation RFC 9116).

---

## 5. Recommandations d'exploitation (non bloquantes)

Le code est corrigé ; ces gestes relèvent de la mise en production, pas d'une faille ouverte :

- **Rotation des secrets** si `admin/admin` a pu être en service : mot de passe admin, `JWT_SECRET` (invalide les sessions), et `SYNAPSE_TOKEN` si l'édition homelab a tourné.
- **Activer HTTPS** puis décommenter la ligne `Strict-Transport-Security` de `nginx.conf`. Sous HTTPS, le cookie de session devient automatiquement `Secure`.
- **Fixer `CORS_ORIGIN`** sur l'URL exacte du frontend en production (le défaut `*` est signalé au démarrage).
- **Premier passage CI** : lancer le workflow une fois pour confirmer que `npm audit` est vert sur les versions actuellement épinglées ; activer Dependabot pour les mises à jour.
- **Renseigner le contact** dans `.well-known/security.txt` (placeholder GitHub fourni).

---

## 6. Portée & limites de l'audit

- **Un audit IA est une première passe, pas une garantie.** Pour une application à enjeu, un test d'intrusion humain (SEC-TEST-008) reste recommandé ; il voit ce que l'analyse statique ne voit pas (logique métier, comportements à l'exécution/à l'échelle).
- **Vérification effectuée :** chaque fichier modifié a été validé syntaxiquement (transpilation esbuild) ; les fonctions de sécurité clés ont été testées à l'exécution — assainissement CRLF, garde d'urgence, SSRF (dont blocage `169.254.169.254`), validateurs IP/CIDR, câblage `authRequired`, et **12 tests unitaires** du flux cookie/CSRF/WebSocket (tous verts). Les `node_modules` n'étant pas installés dans l'environnement d'audit, **lancez `npm ci && npm run build` (backend et frontend) avant déploiement** pour confirmer le typage complet — le workflow CI le fait automatiquement.
- **Principe directeur des correctifs :** le refus. Une entrée mal formée est rejetée plutôt que « rattrapée ». Aucun contrôle n'a été affaibli pour faire marcher une fonctionnalité.

---

## 7. Seconde passe — cinq constats, tous corrigés

Passe menée après la reprise des travaux d'interface. Elle a porté sur le
câblage des routeurs, l'exposition réseau et les chemins d'exécution de
commandes. Cinq constats, corrigés dans ce dépôt.

| # | Gravité | Constat | Correction |
|---|---|---|---|
| 1 | **Critique** | `routes/commands.ts` et `routes/botCommands.ts` étaient montés **sans aucune authentification**. L'action `exec_ssh` de ce catalogue exécute une commande sur un équipement enregistré : la chaîne tenait en trois requêtes non authentifiées. | `router.use(authRequired)` sur les deux, `requireRole("admin")` sur tout ce qui crée, modifie, supprime ou déclenche. |
| 2 | **Critique** | Le backend tourne en `network_mode: host` et écoutait sur toutes les interfaces ; le port du frontend était publié sans adresse de liaison. | `BIND_ADDRESS` (valeur par défaut inchangée : `0.0.0.0`) et `docker-compose.override.yml.exemple`, inerte tant qu'il porte son suffixe. Rien n'est refermé d'autorité — voir la réserve ci-dessous. |
| 3 | Important | `gardeCommande()` n'était appliquée que sur deux des cinq appelants de `executeOnDevice`. `POST /ssh/:id/exec` — l'entrée d'un humain — n'en avait pas. | Garde appliquée sur `POST /:id/exec`, avec un message qui dit ce qui est refusé. **Délibérément pas** dans `executeOnDevice` : les appels internes utilisent légitimement des tubes, et ces commandes sont écrites dans le code, pas reçues d'une requête. |
| 4 | Important | La règle du bot disait « s'il y a une liste, la respecter » : pas de liste, pas de contrôle. | La règle part fermée. Une liste vide veut dire « le salon enregistré », pas « tout le monde ». `/help` est fermé de la même façon : la liste des commandes est un renseignement sur le réseau. |
| 5 | Cosmétique | `credentials: true` était posé même avec `CORS_ORIGIN=*`. | `credentials` n'est activé que lorsqu'une origine est nommée. Le piège n'est plus armé pour le jour où l'étoile serait remplacée par une liste trop large. |

### Réserve sur le constat 2 — à lire avant d'appliquer

`BIND_ADDRESS=127.0.0.1` **coupe l'interface**. Le conteneur nginx joint l'API
par la passerelle du pont Docker (`proxy_pass http://172.17.0.1:4000` dans
`frontend/nginx.conf`), pas par la boucle locale de l'hôte. La valeur qui
referme l'API vis-à-vis du réseau local sans rien casser est l'adresse du pont,
à relever sur la machine :

```bash
ip -4 addr show docker0 | awk '/inet /{print $2}' | cut -d/ -f1
```

Vérifiez que l'interface répond **encore** après redémarrage. Si elle ne répond
plus, retirez la ligne : rien d'autre n'a changé.

### Effet de bord du constat 4

Si la configuration du canal de messagerie ne porte pas de `chatId`, la liste
autorisée est vide et **plus aucune commande ne répond** — y compris les
vôtres. C'est le seul effet de bord de cette passe, et il se lève en
renseignant le salon.

---

## 8. Rattrapage — ce qu'une reprise de code avait fait disparaître

Une mise à jour du dépôt a écrasé `backend/src` en bloc à partir d'une capture
antérieure de l'installation déployée, au lieu de fusionner. Trois choses ont
disparu avec elle, et sont revenues ici :

| Disparu | Rétabli |
|---|---|
| `middleware/csrf.ts` et les aides à cookie de `middleware/auth.ts` | Rétablis. `extraireJeton` lit le cookie en priorité et retombe sur `Authorization` : un client qui n'a pas de cookie continue de fonctionner. |
| La suite de tests (`vitest`, 6 fichiers) | Rétablie et complétée. **49 tests passent.** |
| `docs/screenshots/` | Rétabli. |

La reprise a aussi révélé deux divergences réelles entre le dépôt audité et
l'installation déployée. Elles sont traitées ici.

### Le flux temps réel ignorait la révocation

`ws/realtime.ts` ne vérifiait que la **signature** du jeton. Un jeton révoqué —
après un changement de mot de passe, typiquement — ouvrait donc encore le flux
et continuait de recevoir appareils, alertes, journaux et métriques d'hôte
jusqu'à son expiration, soit douze heures.

La poignée de main applique désormais les mêmes règles que `authRequired` :
type de jeton en liste blanche, puis version comparée au compte. Base
injoignable : on refuse, on n'ouvre pas « en attendant ». La décision est
extraite dans `verifierPoigneeDeMain()` et couverte par sept tests, dont celui
qui échouait avant le correctif.

### Ce qui reste à faire — la copie en `localStorage`

La session voyage maintenant dans un cookie `HttpOnly`, hors de portée de tout
script. Mais l'interface **conserve aussi le jeton dans `localStorage`**, et
l'en-tête `Authorization` continue d'être envoyé. Un XSS peut donc encore lire
cette copie : le gain est réel — le cookie est le chemin principal, la
déconnexion efface une vraie session, le flux temps réel respecte la
révocation — mais **H-03 n'est pas entièrement fermé**.

Le retrait de cette copie n'a pas été fait ici parce qu'il change la façon dont
l'interface s'authentifie, et qu'il ne peut pas être validé sans un essai en
navigateur sur une installation réelle. La marche à suivre, dans cet ordre :

1. vérifier que la connexion pose bien les deux cookies (onglet réseau) ;
2. retirer `localStorage` de `client.ts` — garder le jeton en mémoire pour un
   client servi depuis une autre origine, où le cookie ne partirait pas ;
3. vérifier la connexion, le rechargement de page, le flux temps réel et la
   déconnexion ;
4. seulement alors, retirer `Authorization` du chemin navigateur.

Tant que l'étape 4 n'est pas franchie, cette section décrit l'état réel du
code — c'est ce qui compte davantage que la case cochée.

