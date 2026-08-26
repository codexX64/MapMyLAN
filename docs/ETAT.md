# État de ce dépôt

Ce fichier est destiné au mainteneur. Il documente ce qui figure dans le dépôt
et ce qui n'y figure pas encore.

## Ce qui est présent

Le code du backend et du frontend correspond à la version **déployée**. Les
travaux menés après la capture précédente y sont désormais :

| Domaine | Ce qui a été repris |
|---|---|
| Relevé des VLAN | `services/vlanReleve.ts`, `routes/vlans.ts` — les segments viennent de l'équipement, l'ordre est numérique, les adresses de passerelle sont écartées de l'inventaire |
| Réservation d'adresse | `lib/adresses.ts`, `components/device/DeviceDrawer.tsx` — préfixe figé par le segment, partie hôte vérifiée en direct |
| Trafic mondial | `services/trafic.ts`, `components/world/WorldTrafficView.tsx` — connexions entrantes, trois règles de signalement, arcs rouges, fiche détachable |
| Globe | `lib/geo-globe.ts` — semis à densité constante par spirale d'or, plus de trame aux pôles |
| Second facteur | `services/mfa.ts`, `services/totp.ts`, `routes/mfa.ts` — clé d'accès, application, salon de messagerie |
| Courrier | `services/poste.ts`, `services/mailbox.ts`, `routes/mail.ts`, `mail-providers.js` |
| Disposition atelier | `components/layout/WorkshopShell.tsx`, `pages/Supervision.tsx`, `pages/Controle.tsx`, `pages/Systeme.tsx` |
| Correctifs de sécurité | Les cinq constats du second audit. Voir [SECURITY-AUDIT.md](../SECURITY-AUDIT.md). |

Les deux côtés compilent : `tsc` passe sur le backend, `tsc` puis `vite build`
sur le frontend.

## Ce qui diffère d'une installation

Rien de propre à une installation ne figure ici, et deux réglages qui portaient
autrefois une valeur en dur sont devenus des variables :

| Variable | Effet quand elle est vide |
|---|---|
| `POSTE_URL`, `POSTE_FROM`, `POSTE_SEND_KEY` | Envoi de courrier inactif ; les autres canaux d'alerte partent quand même |
| `GROUPING_PREFIX` | Aucun regroupement d'interfaces proposé — le plan d'adressage ne se devine pas |
| `BIND_ADDRESS` | L'API écoute sur toutes les interfaces, c'est-à-dire le comportement d'origine |

`mail-providers.js` existe en deux exemplaires — `backend/` et
`frontend/public/` — parce que les contextes de construction Docker sont
séparés. La CI vérifie qu'ils restent identiques.

## Correctif non appliqué

`docs/patch-v29/` contient un correctif d'interface qui n'a pas été appliqué au
code présent, et qui ne l'a toujours pas été. Il vise `AppShell.tsx` et
`TopologyMap.tsx` dans un état antérieur à la disposition atelier ; les deux
fichiers ont changé depuis. **Ne l'appliquez pas tel quel** : relisez-le d'abord
et reportez ce qui vous intéresse à la main, ou supprimez le dossier.

## Avant de publier

```bash
grep -rioE "POSTE_SEND_KEY=.+|relay_[a-z0-9]{10,}|sk_[A-Za-z0-9]{10,}" . \
  --include='*.ts' --include='*.tsx' --include='*.yml' --include='*.json'
```

Aucun secret n'a été trouvé dans les sources au moment de la constitution de ce
dépôt, et aucun fichier `.env` n'y figure. Refaites néanmoins cette vérification
après avoir ajouté les fichiers manquants : un secret poussé sur un dépôt public
demeure dans l'historique même après suppression, et impose de réécrire cet
historique **et** de révoquer la clé.

## Un seul code, des greffes optionnelles

**MapMyLAN Codex64** est le seul code. Il ne contient aucun connecteur propre à
une installation particulière : tout ce qui l'est passe par un module déposé
dans `extensions/`, chargé au démarrage sans autre déclaration.

Un connecteur qui appelait directement une base de connaissances depuis le
scanner a été converti à ce mécanisme : il expose `surAppareil`, `surBalayage`
et `surAlerte` au lieu d'être câblé dans le code partagé.

Ce découpage évite d'entretenir deux versions divergentes. Un correctif appliqué
ici profite à toutes les installations.

## Nommage retenu

Le dépôt public est hébergé sous `CodexX64/MapMyLAN` et la démonstration sous
`demo.codex64.fr/mapmylan`.

