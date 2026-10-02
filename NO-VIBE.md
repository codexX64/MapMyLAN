# Code quality record — MapMyLAN

Method: Project Baseline Requirements & Security Manual, Part III (chapters 37-49)
Reviewed: 2026-09-30   ·   Owner: Codex64

## Behaviour freeze
Point de départ de la passe : `aca60fe`, dernier commit de la phase de sécurité. Ensemble de référence : 107 essais, tous verts avant la passe ; relancés à la génération de ce fichier (62 essais de MapMyLAN et 61 du socle embarqué aujourd’hui), les 107 de la référence sont là, un à un, tous verts.

Essais de caractérisation (chapitre 38.2), là où la couverture était mince, gardés hors du dépôt et joués sur `aca60fe` puis sur l’arbre de la passe : les mises à jour de colonnes choisies (règles, commandes, commandes du bot, VLAN, zones, interfaces, appareils, liaisons : 77 lignes de réponses et de lignes en base, effacements et booléens compris) et la disposition en arbre de la carte (quarante appareils, liaisons manuelles et mesurées) — sorties identiques des deux côtés. Rien n’en entre dans le dépôt.

Diff de l’API publique sur la passe : vide. L’inventaire de la surface publique (`aca60fe` contre l’arbre final) est identique ligne à ligne : 112 routes avec leurs paramètres, rôles, renforts, portées et schémas, 14 réglages et leurs schémas, 50 déclencheurs, 5 actions et 16 actions du bot, la liste des types d’appareil, 29 variables de configuration, 10 événements du flux temps réel, 4 commandes de la ligne de commande.

Démarrage et parcours de bout en bout, sur l’arbre final, gamme SOMA : `outils/parcours-navigateur.mjs` (installation par clé d’accès virtuelle, mise en route, balayage, défense, fiches, consoles, réglages, notifications, carte, assistant, langues, petit écran, comptes, lecture seule) → 35 gestes aboutis ; 372 écrans×largeurs, défauts de mise en page : 0, erreurs de console : 0, requêtes refusées : 0.

Après la passe, des fonctions ont été ajoutées (commits listés en fin de fichier) ; elles étendent le comportement sans rien retirer. Les 107 essais de la référence sont toujours là, un à un, et verts ; 16 essais nouveaux les accompagnent, verts aussi : « SOCLE_THEME : soma par défaut, console admise, toute autre valeur arrête le démarrage », « arborescence : racine rendue, courbe horizontale aux deux bouts, du père vers le fils », « balayages d’une période : terminés seulement, dans la fenêtre demandée, fenêtre bornée », « comptes depuis le Hub : manifeste et Compose relient le jeton d’administration, la délégation répond », « créneaux : vus par plage puis additionnés, nouveaux à leur première apparition, créneau sans balayage vide », « délégation : adresse e-mail, clé d’accès exigée, activation ; un administrateur garde sa clé en HTTPS », « délégation : invitation et réinitialisation envoyées par e-mail, lien vers l’adresse publique, jamais rendu au Hub », « délégation : lister, inviter (lien, jamais de mot de passe), réinitialiser, changer le rôle, supprimer », « délégation : sans adresse publique ni adresse donnée par le Hub, aucun lien n’est fabriqué », « délégation : sans jeton configuré la route n’existe pas ; mauvais jeton refusé et journalisé », « délégation : un service vide reçoit son premier administrateur par lien, sans jeton d’installation », « gamme Console : chaque jeton de SOMA redéfini, polices servies par le socle », « la page est rendue avec sa gamme ; une gamme inconnue retombe sur SOMA », « plafond : rond, divisible en quatre, jamais sous 4 », « poste : la clé d’envoi part en Authorization (jeton d’envoi de CODMAIL) et en x-poste-key, objet sur une ligne », « thème : la page porte celui de SOCLE_THEME, posé par la page Thème du Hub ; SOMA hors Hub ». Surface publique ajoutée depuis `984c44d`, rien de retiré : `route GET /^\/api\/devices\/scans$/ []`. La gamme se choisit par `SOCLE_THEME`, que le Hub pose depuis le champ « Thème de l’interface » de la configuration du service (Console par défaut) ; hors du Hub, SOMA reste la gamme par défaut. Le parcours de bout en bout, refait dans la gamme Console (`SOCLE_THEME=console`), donne 35 gestes aboutis ; 381 écrans×largeurs, défauts de mise en page : 0, erreurs de console : 0, requêtes refusées : 0.

Changements de comportement voulus pendant la phase de sécurité, chacun étant le correctif (détail dans SECURITY.md, « Findings and resolutions ») :

| Avant | Après | Raison |
|---|---|---|
| `/.env`, `/.git/config` recevaient l’interface | 404 pour tout segment caché | SEC-SECRETS-003 |
| la rotation de SOCLE_CLE perdait les secrets des équipements, boîtes et canaux | rescellés au démarrage | REQ-CFG-005 |
| état du réseau et texte de SYNAPSE dans le message système sans clôture | cloisonnés entre marqueurs | SEC-LLM-003 |
| essais d’administration, 429 des routes et actions du bot sans trace | au journal chaîné | REQ-DATA-004 |
| logos gardés par le navigateur ; 429 du débit sans en-têtes | no-store ; en-têtes posés avant le débit | REQ-WEB-003 |
| sept listes sans borne, logos sans quota | plafonds, soixante domaines neufs par minute | REQ-WEB-008 |
| écritures multiples hors transaction | transactions | SEC-API-007 |
| NET_ADMIN, sans no-new-privileges | NET_RAW seule, no-new-privileges, `docker compose exec -u node` | SEC-INFRA-004 |
| voix sans plafond journalier | plafond par compte et pour l’instance (`MAPMYLAN_VOIX_JOUR`, `_JOUR_TOTAL`) | SEC-LLM-002 |
| la commande SSH complète passait aux commandes automatiques | le programme seul | SEC-LOG-002 |
| réponse 502 du relais sans en-têtes | en-têtes du socle | REQ-WEB-003 |
| types `vm`, `container`, `computer`, `sensor` refusés | admis comme en 1.4.1 | parité |

## Layer status
| Chapter | Subject | Status | What changed |
|---|---|---|---|
| 39 | Comment layer | DONE | étiquettes qui répétaient le nom de la fonction suivante retirées (sept : nœuds, zones, liaisons, appareils de la carte, boucle de rendu du globe, formulaire de l’équipement) ; étapes numérotées de l’arborescence rendues à leur explication ; renvoi à React (absent de la version 2) et transition de rédaction retirés ; densité moyenne 12.6 % sur le code livré, les fichiers au-dessus de 25 % relus un à un (`web/lib/modeles.js`, `web/lib/trafic.js`, `web/lib/geo-globe.js`, `web/composants/silhouettes.js`, `src/executeur.js`, `web/lib/topologie-arbre.js`, `src/demande-secret.js`, `src/certificat.js`, `web/communs.js`, `src/api/schemas.js`, `src/adaptateurs/index.js`) : des principes, des seuils justifiés, des invariants et des tables commentées par famille, aucune narration |
| 40 | Naming and vocabulary | DONE | aucun suffixe Manager/Handler/Provider, aucun module fourre-tout ; les noms génériques relevés sont des réponses HTTP (`res`) ou le champ `output` du contrat ; `executer`, `dedoublonner`, `dock` sont les mots du domaine |
| 41 | Formatting, layout and whitespace | DONE | aucun formateur dans le dépôt, aucun introduit ; 2 espaces, apostrophes simples, points-virgules ; trois lignes vides de fin de fichier et une espace égarée retirées ; l’arborescence de la carte, seule écrite autrement (paramètres entre parenthèses, signature éclatée, commentaires alignés), ramenée au style du reste ; un caractère invisible d’un essai écrit en échappement |
| 42 | Gratuitous abstraction | DONE | aucune interface à une seule implémentation (les adaptateurs d’équipement en ont plusieurs) ; code mort retiré : `rendreLisible`, `exigerCidr`, `exigerHote`, `VERSION_SCHEMA`, `CHAMPS_SECRETS`, un remplacement sans effet ; huit copies de la mise à jour de colonnes choisies repliées en `modifierLigne` (`src/db.js`), le seul endroit où le choix des colonnes écrites dépend d’une requête, les noms étant toujours pris dans la liste fermée de chaque table (la reprise 1.x et la rotation n’interpolent que des noms écrits en dur) |
| 43 | Defensive noise | DONE | 319 `catch` relus, tous autour d’une opération précise, classés ci-dessous ; un relevé des VLAN qui levait sans trace pendant le cycle de balayage est journalisé ; aucun message vague, aucune journalisation d’entrée ou de sortie de fonction |
| 44 | Control flow and idiom | DONE | retours anticipés ; boucles indexées réservées aux pixels (détourage), aux géométries du globe et de la carte ; `for (;;)` de l’arborescence gardé : quatre passes qui recommencent tant que l’une avance |
| 45 | Types, signatures and data shapes | DONE | JavaScript sans TypeScript ; un contrat d’erreur : `ErreurHttp` du socle (et `Refus`, sa sous-classe journalisée), levée au plus près, formatée une seule fois ; schémas de route déclaratifs, champ inconnu refusé ; formes de réponse écrites champ par champ (`src/formes.js`) |
| 46 | Dependencies, configuration, fitting the repository | DONE | aucune dépendance ; chacune des 36 variables de `.env.example` a un lecteur ; aucun import inutilisé (liaisons importées de 149 fichiers relues ; un import mort retiré) ; le faux serveur reprend la politique des permissions du service au lieu d’une copie qui avait dérivé |
| 47 | Tests | DONE | 12 cassures volontaires, chacune détectée (ci-dessous) ; essais aux frontières sur de vrais serveurs locaux ; aucune assertion vide |
| 48 | Documentation, furniture and version control | DONE | README : le parcours navigateur et le faux serveur dans « Vérifier » ; `.gitignore`, `.dockerignore`, `LICENSE`, `Dockerfile` et la vérification CI contrôlés ; aucun fichier de consignes d’outil ; historique de la 2.0, jamais poussé, refait sur une racine neuve : réécriture découpée par sujet (serveur en neuf commits, interface en huit), relevés commités seuls, un sujet par commit, sans mention d’outil |

`catch` du dépôt, par raison :

| Raison | Nombre | Où |
|---|---|---|
| valeur de repli explicite (donnée externe illisible, objet disparu, service absent) | 123 | `outils/`, `socle/`, `src/adaptateurs/pilotes-ssh.js`, `src/adaptateurs/session.js`, `src/api/reseau.js`, `src/assistant/liaisons.js`, `src/commandes-bot.js`, `src/commandes.js` et 37 autres |
| montrée à l’écran ou rendue au demandeur, avec sa cause | 69 | `socle/`, `src/memoire.js`, `src/ticket.js`, `src/trafic.js`, `src/vlans.js`, `web/app.js`, `web/assistant/panneau.js`, `web/assistant/voix.js` et 14 autres |
| relevée, traduite en erreur du domaine (ErreurHttp) ou transmise | 47 | `outils/`, `socle/`, `src/adaptateurs/session.js`, `src/api/assistant.js`, `src/api/automatisation.js`, `src/api/index.js`, `src/api/messagerie.js`, `src/api/reseau.js` et 15 autres |
| journalisée, ou portée dans l’état du service | 30 | `outils/`, `socle/`, `src/api/appareils.js`, `src/api/systeme.js`, `src/commandes-bot.js`, `src/commandes.js`, `src/defense.js`, `src/enrichissement.js` et 9 autres |
| sans effet voulu, la raison écrite dans le bloc | 26 | `socle/`, `src/poste.js`, `src/scanner.js`, `web/app.js`, `web/assistant/voix.js`, `web/composants/fiche.js`, `web/composants/monde.js`, `web/composants/topologie.js` et 4 autres |
| rapportée dans le résultat de l’étape (message, décompte des échecs) | 19 | `outils/`, `socle/`, `src/adaptateurs/unifi.js`, `src/assistant/liaisons.js`, `src/boites.js`, `src/commandes-bot.js`, `src/notifications.js`, `src/trafic.js` et 4 autres |
| tâche d’arrière-plan facultative : son échec n’a rien à montrer, l’action suivante le montre | 5 | `outils/`, `socle/` |

## Tests
Cassures volontaires (REQ-CODE-005) : chacune posée seule, l’essai concerné lancé, le fichier rétabli (`mutations_mapmylan.py`, hors dépôt), sur l’arbre final.

| Cassure | Fichier | Essais en échec | Premier essai qui échoue |
|---|---|---|---|
| une route répond sans authentifier l’appelant | `src/api/index.js` | 17 | « Telegram : secret jamais rendu, texte échappé, SMS retiré » |
| un membre pose la liste blanche d’un appareil | `src/api/appareils.js` | 1 | « inventaire : création, champ effacé, protections réservées, objets d’un autre appareil » |
| l’interface d’un autre appareil se modifie par celui-ci | `src/api/appareils.js` | 1 | « inventaire : création, champ effacé, protections réservées, objets d’un autre appareil » |
| un jeton d’intégration ouvre une route qui ne l’admet pas | `src/api/acces.js` | 3 | « autorisation : politique écrite ici, puis chaque route balayée sans session, en lecture et en membre » |
| une sortie joint les métadonnées de nuage | `src/sortie.js` | 2 | « garde de sortie : classes d’adresses et liste des destinations internes » |
| un programme hors de la liste se lance | `src/executeur.js` | 1 | « exécution : programmes admis seulement, arguments en tableau, jamais de shell » |
| une commande SSH en enchaîne une seconde | `src/consoles.js` | 1 | « garde des commandes : une instruction, jamais deux » |
| /.env reçoit l’interface | `src/main.js` | 1 | « segments cachés : 404, jamais l’interface à leur place » |
| la transcription échappe au plafond journalier de la voix | `src/assistant/liaisons.js` | 1 | « voix : transcriptions et lectures sous leur propre plafond journalier, VOX laissé en paix au-delà » |
| la rotation de SOCLE_CLE laisse les secrets sous l’ancienne clé | `src/rotation.js` | 1 | « rotation de SOCLE_CLE : les secrets des équipements, des boîtes et des canaux passent sous la clé neuve » |
| les arguments d’une commande SSH passent aux commandes automatiques | `src/consoles.js` | 1 | « consoles SSH : clé d’hôte confirmée à l’enregistrement, secret jamais en argument, clé changée refusée » |
| un nom d’appareil referme le bloc de données de l’assistant | `src/assistant/index.js` | 1 | « assistant : l’état du réseau arrive au modèle comme une donnée close, qu’un nom d’appareil ne peut pas rouvrir » |

Les faux services sont de vrais serveurs HTTP locaux (Telegram, Ollama, VOX, billetterie, contrôleur HTTPS à certificat auto-signé) et le réseau est simulé au seul point où MapMyLAN lance un programme (`ReseauSimule`, qui rejoue aussi le contrôle de clé d’hôte de SSH et SSH_ASKPASS) ; les essais passent par les routes, avec de vraies sessions, de vrais jetons, une vraie clé d’accès et un vrai TOTP. Ils portent sur les frontières et les chemins d’erreur : routes par rôle, renfort et portée de jeton, objets d’un autre appareil, corps invalides, arguments d’outils, sorties vers l’interne et les métadonnées, clé d’hôte et certificat changés, plafonds, rotation de la clé maîtresse, reprise de la 1.4.1.

## Repository style profile
Node 24, modules ES, aucune dépendance. Serveur : `node:http` sous le portail du socle, `node:sqlite` avec requêtes préparées et `transaction`, `node:child_process` en un seul point (`src/executeur.js`). Interface : modules statiques, DOM construit par `h` (`web/dom.js` et le socle), jamais de balisage injecté avec une donnée. Vocabulaire : français pour le code, les commentaires et les messages ; anglais pour les champs du contrat hérités de la 1.4.1 (`customName`, `dangerScore`, `output`). Mise en forme : 2 espaces, apostrophes simples, points-virgules, flèches à paramètre nu, lignes longues admises pour les tables et les schémas. Erreurs : `ErreurHttp(status, message)` écrite pour l’utilisateur ; le socle ne montre jamais le texte d’une erreur imprévue. Configuration : `lireConfigMapmylan` sur un schéma, arrêt au démarrage avec toutes les erreurs, secrets par `_FILE`. Journaux : `evts.journaliser` pour le journal de service, `acces.tracer` et le `Journal` du socle pour qui a fait quoi (chaîné). Frontières : `src/` (routes dans `src/api/`, un module par domaine), `web/` (pages, composants, bibliothèques), `socle/` (commun embarqué, modifié dans son propre dépôt seulement), `test/`, `outils/`. Aides reprises plutôt que réécrites : `valider`, `Debit`, `ErreurHttp` du socle, `Sortie`, `Executeur`, `transaction`, `modifierLigne`, `nettoyerNom`, `gardeCommande`.

## Detection sweep
Relancé à chaque génération de ce fichier (bash, LC_ALL=C.UTF-8) ; un résultat différent de celui qui a été relu arrête la génération. Annexe B.5 et contrôles des chapitres 41 à 48, sur tout le dépôt hors des deux fichiers de conformité (socle embarqué compris).

| # | Commande | Résultat | Justification |
|---|---|---|---|
| B.5.1 | `rg -n '^\s*(#\|//)\s*(Step \d\|Initialize\|Loop through\|Create (a\|an\|the)\|Return the\|Set the\|Get the\|Check if\|Now we\|First,\|Finally,)' . -g '!SECURITY.md' -g '!NO-VIBE.md'` | 0 ligne |  |
| B.5.2 | `rg -n '^\s*(//\|#\|\*)\s*(Étape \d\|Initialise\|On boucle\|Boucle sur\|Retourne (le\|la\|les\|l.)\|Crée (un\|une\|le\|la)\|Vérifie si\|Maintenant,\|D.abord,\|Enfin,)' . -g '!SECURITY.md' -g '!NO-VIBE.md'` | 0 ligne | la même recherche dans la langue du dépôt |
| B.5.3 | `rg -n '^\s*(#\|//)\s*[-=*_#─]{10,}' . -g '!SECURITY.md' -g '!NO-VIBE.md'` | 0 ligne |  |
| B.5.4 | `rg -n '^\s*//\s*-{2,}\s*\S.*-{2,}\s*$' . -g '!SECURITY.md' -g '!NO-VIBE.md' \| cut -d: -f1 \| sort \| uniq -c` | `7 ./socle/src/http.js
      1 ./socle/src/limiteur.js
      3 ./socle/src/portail.js` | les intertitres courts du socle embarqué (`// ---- routeur ----`) : il se modifie dans son propre dépôt, jamais ici ; aucun dans le code de MapMyLAN |
| B.5.5 | `rg -n 'simplified (implementation\|version)\|in a (real\|production) (system\|app)\|for (demo\|illustration) purposes\|this is just an example' . -g '!SECURITY.md' -g '!NO-VIBE.md'` | 0 ligne |  |
| B.5.6 | `rg -n --pcre2 '[\x{1F300}-\x{1FAFF}\x{2600}-\x{27BF}\x{2B00}-\x{2BFF}]' . -g '!SECURITY.md' -g '!NO-VIBE.md' \| cut -d: -f1 \| sort \| uniq -c` | `1 ./socle/test/crypto.test.js
      6 ./web/composants/topologie.js
      3 ./web/pages/controle.js
      3 ./web/pages/premier-reglage.js
      1 ./web/pages/supervision.js` | du texte de l’interface, jamais un commentaire ni un journal : ✓, ✕ et ⚠ affichés, les pictos de la fenêtre d’ajout manuel repris de la 1.4.1 ; un mot de passe fait d’emoji dans un essai du socle |
| B.5.7 | `rg -n '\b(def\|function\|func\|fn)\s+\w*(process\|handle\|manage\|perform\|execute\|do)_?\w*\s*\(' . -g '!SECURITY.md' -g '!NO-VIBE.md' \| cut -d: -f1,3 \| sed 's/(.*//'` | 6 lignes | mots français qui contiennent le motif : `executer` (exécuter la commande tapée), `adoucirBord`, `dock`, `domaineDe`, deux `dedoublonner` |
| B.5.8 | `rg -o '\b\w+(Manager\|Service\|Handler\|Provider\|Factory\|Helper\|Util\|Wrapper\|Processor\|Engine)\b' . -g '!SECURITY.md' -g '!NO-VIBE.md' \| cut -d: -f2- \| sort -u` | `AudioWorkletProcessor
registerProcessor` | l’API Web Audio du navigateur (capture du micro), pas un nom du dépôt |
| B.5.9 | `find . -path ./node_modules -prune -o -type f -regextype posix-extended -regex '.*/(utils?\|helpers?\|common\|misc\|shared)\.(py\|ts\|js\|go\|rb\|java)' -print` | 0 ligne |  |
| B.5.10 | `rg -n '\b(data\|result\|output\|temp\|tmp\|res\|ret\|val\|obj\|item)\b\s*=' . -g '!SECURITY.md' -g '!NO-VIBE.md' \| wc -l` | `12` | `res` : la réponse HTTP d’un rappel de Node, la réponse simulée d’un essai du socle, ou le paramètre `res =>` d’une promesse d’essai ; `output` : le champ du contrat de l’API (`{ output }` des actions de défense et des VLAN) |
| B.5.11 | `rg -n 'catch\s*\(\s*(e\|err\|error)\s*\)\|catch\s*\{' . -g '!SECURITY.md' -g '!NO-VIBE.md' \| wc -l` | `224` | relus un à un avec les `.catch(` : 319 au total, par raison ci-dessous |
| B.5.12 | `rg -n 'An error occurred\|Something went wrong\|Unexpected error\|Une erreur est survenue\|Quelque chose s.est mal passé' . -g '!SECURITY.md' -g '!NO-VIBE.md'` | 0 ligne |  |
| B.5.13 | `git ls-files '*.py' \| wc -l` | `0` | aucun Python : la recherche des `except` muets n’a rien à lire |
| B.5.14 | `rg -n 'logger\.(info\|debug)\(f?["\x27](Starting\|Entering\|Finished\|Exiting\|Called)' . -g '!SECURITY.md' -g '!NO-VIBE.md'` | 0 ligne |  |
| 41.1.1 | `git diff --check $(git hash-object -t tree /dev/null) HEAD -- . ':!SECURITY.md' ':!NO-VIBE.md'` | 0 ligne | depuis l’arbre vide : aucune espace en fin de ligne, aucune ligne vide de trop (trois retirées) |
| 41.2.1 | `rg -n --pcre2 '[\x{200B}-\x{200D}\x{FEFF}\x{00A0}\x{2028}\x{2029}]' . -g '!SECURITY.md' -g '!NO-VIBE.md'` | 0 ligne | aucun caractère invisible (celui d’un essai écrit en échappement) ; la ponctuation typographique française (« », ’, …) est celle de tout le dépôt |
| 45.1.1 | `rg -n ':\s*any\b\|as unknown as' . -g '!SECURITY.md' -g '!NO-VIBE.md'` | 0 ligne | JavaScript, sans TypeScript |
| 47.1.1 | `rg -n 'assert\.ok\(true\)\|toBeDefined\(\)\|assert\(true\)' . -g '!SECURITY.md' -g '!NO-VIBE.md'` | 0 ligne |  |
| 48.3.1 | `rg -n -i 'your-api-key-here\|TODO: implement\|FIXME: AI\|lorem ipsum\|example\.com/api' . -g '!SECURITY.md' -g '!NO-VIBE.md'` | 0 ligne |  |
| 48.3.2 | `rg -n -i 'placeholder' . -g '!SECURITY.md' -g '!NO-VIBE.md' \| cut -d: -f1 \| cut -d/ -f2 \| sort \| uniq -c` | `1 hub.json
      1 outils
      3 socle
     62 web` | attributs `placeholder` des champs de l’interface (et du socle) et leur style, le champ `placeholder` du manifeste du Hub, un sélecteur du parcours navigateur |
| 48.3.3 | `rg -n '\b(TODO\|FIXME\|XXX\|HACK)\b' . -g '!SECURITY.md' -g '!NO-VIBE.md'` | 0 ligne |  |
| 48.3.4 | `find . -path ./.git -prune -o \( -name .ai -o -name .cursor -o -name '.aider*' -o -name .continue -o -name .windsurfrules -o -name CLAUDE.md -o -name 'AGENTS.md' -o -name 'PROMPTS.md' \) -print` | 0 ligne |  |
| 48.4.1 | `git log --all --format='%B' \| rg -i 'co-authored-by\|generated with'` | 0 ligne | tout l’historique |

## Report (chapter 49.6)
Comptes : 7 étiquettes de commentaire retirées, 5 étapes numérotées rendues à leur explication, 2 notes corrigées (React, transition), 1 note remise à la largeur, 3 lignes vides et 1 espace retirées, 1 fichier ramené au style du dépôt (10 flèches, 1 signature, 2 commentaires alignés), 1 caractère invisible écrit en échappement, 5 définitions mortes et 1 import mort retirés, 1 remplacement sans effet retiré, 8 copies repliées en 1 fonction, 1 `catch` muet rendu visible, 1 copie d’une politique remplacée par un import, 1 section de documentation complétée, 0 dépendance retirée (il n’y en a aucune). 22 fichiers de code touchés ; tous les autres laissés tels quels : leur densité de commentaires, leurs noms et leur gestion d’erreurs relèvent du profil ci-dessus.

Défauts réels trouvés pendant la passe, corrigés dans leurs propres commits : un relevé des VLAN qui levait était avalé sans trace ; le faux serveur servait une politique des permissions qui n’était plus celle du service ; un commentaire promettait que les tirets d’un nom d’hôte étaient remplacés, ce que la ligne ne faisait pas.

Ce qui reste à trancher, et pourquoi ce n’est pas fait ici :
- Historique : la 2.0, jamais poussée, a été rejouée sur une racine neuve après cette passe : les deux imports de la réécriture (serveur, interface) découpés par sujet, une génération intermédiaire de SECURITY.md qu’emportait « aca60fe » retirée, les relevés commités seuls ; chaque arbre de code est resté identique, la suite et la surface publique ci-dessus sont mesurées sur cet historique.
- Les deux `dedoublonner` (lignes répétées d’un modèle, appareils en double) gardent le même nom : deux modules, deux domaines, aucun appelant commun.
- Quelques commentaires de fin de ligne alignés dans l’interface (unités, raisons) restent : ils disent quelque chose, et les réaligner toucherait des fichiers que rien d’autre ne demande de toucher.
- Les recherches 404 d’un objet par son identifiant (`… || (() => { throw new ErreurHttp(404, …) })()`) restent écrites dans chaque module de routes : une ligne chacune, la même forme partout, et un message propre à chaque objet.

Commits de la passe :
- `baad5c3 mise en forme : lignes vides de fin de fichier retirées, espace égarée avant un point-virgule`
- `8f0ce03 commentaires : étiquettes qui répétaient la ligne suivante retirées, étapes numérotées de l'arborescence rendues à leur explication`
- `50ffb01 commentaires : la note des troncs remise à la largeur du fichier`
- `a7e9861 essais : la marque invisible d'un nom d'appareil écrite en échappement, visible à la relecture`
- `4f0d2f4 nettoyage : code mort retiré (rendreLisible, exigerCidr, exigerHote, VERSION_SCHEMA, CHAMPS_SECRETS) et remplacement sans effet des tirets d'un nom d'hôte`
- `302ef1b structure : une seule mise à jour de colonnes choisies (modifierLigne), ses huit copies retirées`
- `2445a26 défense : un relevé des VLAN qui lève pendant le cycle de balayage est journalisé, plus avalé`
- `bd62bed outils : le faux serveur reprend la politique des permissions du service au lieu d'une copie qui avait dérivé`
- `d597770 documentation : le parcours navigateur et le faux serveur dans « Vérifier »`
- `7c9f1d6 commentaires : l'arborescence de la carte ne renvoie plus à React, absent de la version 2`
- `64836b6 mise en forme : l'arborescence de la carte écrite comme le reste du dépôt (paramètres nus, signature sur une ligne, sans commentaires alignés)`
- `984c44d commentaires : l'en-tête de la reconnaissance des modèles sans transition de rédaction`

Commits suivants, hors de la passe ; la suite et la surface publique ci-dessus sont remesurées après eux :
- `f8c611b socle 061a2ae : gamme Console et ses composants, polices Geist servies sur place`
- `3a694c9 thème : Console ou SOMA, champ de la configuration du service dans le Hub (Console par défaut), page rendue avec sa gamme`
- `3e8d0cd Console : barre latérale de la maquette (recherche, plages balayées) et palette de commandes au clavier`
- `bb74465 vue d'ensemble : graphe « Appareils vus » tiré des balayages terminés et des premières apparitions`
- `91b1adc carte : arborescence dessinée comme un contrôleur réseau, glyphes pleins, courbes, sans fil en pointillé`
- `0690345 parcours : les deux gammes, le graphe, l'arborescence et la palette`
- `1c8c53d docs : balayages d'une période dans la référence de l'API`
- `1a3af5d conteneur : commande de l'image redite dans les deux Compose, un entrypoint posé effaçant le CMD (l'API bouclait sur setpriv sans programme)`
- `e7de352 ligne de commande : l'entrée lue en flux, readFileSync(0) levant EAGAIN derrière ssh et docker run -i`
- `afed56a socle c06919a : gamme Console claire (blanc et bleu) par la bascule clair ou sombre`
- `c773f9f thème : Console claire, blanc et bleu, par la bascule ; Console sombre par défaut, couleurs propres en jetons ; parcours en variante claire`
- `a044110 carte : liaisons de l'arborescence en épaisseur du dessin, sans vector-effect (bandes verticales sous Safari)`
- `903d6c6 carte : dessin posé en absolu sur tout le cadre (Safari le dimensionnait d'après son viewBox, bandes verticales)`
- `3e6d6a0 carte : libre ou arborescence dans la barre d'outils de la carte, un seul Reconstruire, l'en-tête tient sur une ligne`
- `fee3481 carte : import devenu inutile retiré`
- `e9117c4 carte : barre d'outils au ras du cadre, plus de marge aux coins`
- `89c92c3 socle c2ec10f : intertitres du rail en bloc dans le tiroir de la gamme Console`
- `d4191bf thème : reçu de la page Thème du Hub par {{hub.theme}}, plus de champ dans la configuration du service ; Hub 0.7.0 demandé`
- `d45f1a0 version 2.0.1 : thème choisi dans le Hub`
- `e0926b9 socle c71fc20 : administration des comptes déléguée au Hub par un jeton à lui seul`
- `e454b6a comptes : gérés depuis le Hub (Comptes des services) par invitation et lien de réinitialisation, jeton d'administration à lui seul généré par le Hub`
- `b1e419b poste : la clé d'envoi part aussi en Authorization, ce que CODMAIL attend d'un jeton d'envoi`
- `8b2d449 version 2.0.2 : comptes gérés depuis le Hub, envoi vers CODMAIL`
- `c9406df socle 38c8c2f : premier administrateur, e-mail et clé d'accès par compte gérés depuis le Hub ; actions d'en-tête et carte du rail sans repli`
- `b7edb30 mise en page : boutons d'un même groupe ensemble, colonnes pleine largeur sur téléphone, version d'un port coupée en « … », libellé du rail raccourci`
- `4f3ff1a version 2.0.3 : socle à jour, version de l'image proposée par défaut à l'installation`

## Verification (chapter 49)
- [x] Full suite passes and matches the baseline — 107 essais, les mêmes avant et après la passe, relancés à la génération de ce fichier
- [x] Public API diff empty — inventaire de la surface publique identique entre `aca60fe` et l’arbre final
- [x] Characterisation tests deleted after use — gardés hors du dépôt, jamais commités
- [x] Read-aloud test passed — les 22 fichiers de code touchés relus aux endroits touchés ; ceux dont une instruction a changé (`src/db.js`, `src/appareils.js`, `src/api/systeme.js`, `src/api/automatisation.js`, `src/api/reseau.js`, `src/api/appareils.js`, `src/planif.js`, `src/ticket.js`, `src/notifications.js`, `src/cibles.js`, `src/equipements.js`, `src/main.js`, `outils/faux-api.mjs`, `web/lib/modeles.js`, `web/lib/topologie-arbre.js`), relus autour de chaque fonction changée
- [x] Blind-comparison test passed — les passages touchés ont la forme de leurs voisins écrits avant la passe (`src/api/messagerie.js`, `src/rotation.js`, `web/lib/trafic.js`) : même langue, mêmes flèches à paramètre nu, raisons plutôt que descriptions
- [x] Commit history: one concern per commit, repository style, no attribution trailers — racine neuve, réécriture découpée par sujet, relevés commités seuls, aucune mention d’outil dans tout l’historique
- [x] REQ-CODE-001 to REQ-CODE-006 all PASS
