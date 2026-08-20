// Device icon on the map.
//
// We reuse the app's single icon set (lib/icons) instead of maintaining a
// second set of shapes here: this way the camera, the NAS, the Pi or the
// printer have the same drawing everywhere, and any new type added to the
// classifier is covered automatically.

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
