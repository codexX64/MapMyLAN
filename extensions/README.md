# Extensions

Ce dossier est vide, et c'est normal.

Une extension déposée ici est chargée au démarrage sans autre déclaration. Son
absence n'est pas une anomalie : MapMyLAN fonctionne seul.

## Écrire une extension

Un fichier exportant un objet. Toutes les méthodes sont facultatives.

```js
module.exports = {
  nom: "ma-greffe",

  surAppareil(fait, donnees) {
    // fait : "device.first_seen", "port.opened", "risk.crossed"…
  },

  surBalayage(resume) {
    // resume : { hotes, enLigne, plages, duree }
  },

  surAlerte(alerte) {
    // le ticket construit, quels que soient les canaux employés
  },
};
```

Une extension qui lève une exception est ignorée pour cet appel : elle
n'interrompt jamais un balayage. Une extension qui refuse de se charger est
signalée dans le journal.

## Pourquoi ce mécanisme

Il permet d'ajouter un comportement propre à une installation sans forker le
projet. Sans lui, il faudrait entretenir deux versions du code qui divergeraient
au fil des correctifs.
