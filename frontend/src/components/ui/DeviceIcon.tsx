// Icône d'appareil sur la carte.
//
// On réutilise le jeu de pictos unique de l'app (lib/icons) au lieu de
// maintenir un deuxième jeu de formes ici : ainsi la caméra, le NAS, le Pi ou
// l'imprimante ont le même dessin partout, et tout nouveau type ajouté au
// classifieur est couvert automatiquement.

import { CSSProperties } from "react";
import { Icon, deviceIcon } from "../../lib/icons";

interface Props {
  type: string;
  size?: number;
  color?: string;
  dim?: boolean;
  pulse?: boolean;
  style?: CSSProperties;
}

export function DeviceIcon({ type, size = 32, color = "#1B2AFF", dim, pulse, style }: Props) {
  const c = dim ? "#8A8F97" : color;
  return (
    <span style={{
      display: "inline-flex", color: c,
      filter: pulse ? `drop-shadow(0 0 5px ${c})` : undefined,
      opacity: dim ? 0.5 : 1,
      ...style,
    }}>
      <Icon name={deviceIcon(type)} size={Math.round(size * 0.62)} stroke={1.6}/>
    </span>
  );
}
