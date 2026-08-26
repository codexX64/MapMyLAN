# Contribuer

## Avant d'ouvrir une pull request

Décrivez d'abord votre intention dans une issue. Une fonctionnalité conçue puis
refusée fait perdre du temps à tout le monde.

## Style

Le code est commenté **en français**, comme le reste du projet. Les commentaires
expliquent *pourquoi* une décision a été prise, pas ce que le code fait ligne à
ligne — cela se lit déjà dans le code.

Les dépendances sont ajoutées avec parcimonie. Une bibliothèque de cinquante
kilo-octets pour une fonction de vingt lignes ne passera pas.

## Ce qui est vérifié

- Le typage passe sans erreur, backend et frontend.
- Aucune donnée personnelle, aucune adresse de réseau réel. Les exemples
  utilisent les plages réservées à la documentation : `192.0.2.0/24`,
  `198.51.100.0/24`, `203.0.113.0/24`.
- Les secrets restent hors du dépôt.

## Sécurité

Une faille se signale en privé, jamais par une pull request publique qui la
révélerait avant qu'un correctif existe. Voir [SECURITY.md](SECURITY.md).
