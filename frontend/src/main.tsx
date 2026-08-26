// Point d'entrée.
//
// Les deux feuilles sont importées ici, dans cet ordre : le socle d'abord, la
// feuille de la maquette ensuite. Vite les concatène dans cet ordre, si bien
// qu'une règle de composant l'emporte naturellement sur une règle globale,
// sans avoir à batailler avec `!important`.

import React from "react";
import ReactDOM from "react-dom/client";
import "./styles/base.css";
import "./styles/maquette.css";
import App from "./App";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App/>
  </React.StrictMode>
);
