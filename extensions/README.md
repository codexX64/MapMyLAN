# Extensions

This folder is empty, and that is normal.

An extension dropped here is loaded at startup with no further declaration. Its
absence is not a fault: MapMyLAN works on its own.

## Writing an extension

A file exporting an object. All methods are optional.

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
    // the built ticket, whatever channels were used
  },
};
```

An extension that throws an exception is skipped for that call: it never
interrupts a scan. An extension that refuses to load is reported in the log.

## Why this mechanism

It makes it possible to add behavior specific to an installation without forking
the project. Without it, you would have to maintain two versions of the code that
would diverge over the course of fixes.
