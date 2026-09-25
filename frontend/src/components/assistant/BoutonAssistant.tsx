// Le bouton ✦ des barres du haut, et le montage du panneau de l'assistant.
//
// Le panneau lui-même vit hors de React (src/assistant/panneau.ts), comme
// celui du Hub dont il reprend le balisage et la feuille : ici on ne fait que
// le brancher une fois, et allumer le bouton quand il est ouvert.

import { useEffect, useState } from "react";
import { Icon } from "../../lib/icons";
import { useT } from "../../lib/i18n";
import { basculer, brancherBord, suivre } from "../../assistant/panneau";

/** À poser une fois dans la coquille : l'onglet du bord droit et la bulle d'info. */
export function AssistantMonte() {
  useEffect(() => brancherBord(), []);
  return null;
}

export function BoutonAssistant({ taille = 32, picto = 16 }: { taille?: number; picto?: number }) {
  const s = useT();
  const [ouvert, setOuvert] = useState(false);
  useEffect(() => { const off = suivre(setOuvert); return () => { off(); }; }, []);
  return (
    <button className={ouvert ? "ghost on" : "ghost"} style={{ width: taille, height: taille, color: ouvert ? "var(--accent)" : undefined }}
      title={s("top.assistant")} aria-label={s("top.assistant")} aria-pressed={ouvert} onClick={basculer}>
      <Icon name="sparkle" size={picto}/>
    </button>
  );
}
