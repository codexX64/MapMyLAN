// Icon set drawn for MapMyLAN.
// Each path is mathematically re-centered within its 24x24 box: the real
// bounding box is measured then translated, which avoids optical offsets in
// the tiles. No sprite, no <use>: the paths are inline, which works around
// the Safari bug on the viewBox of <symbol> elements.

// Escapes text destined for a <title> injected into HTML.
function escapeXml(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

const PATHS: Record<string, string> = {
  "overview": "<rect x=\"3.5\" y=\"3.5\" width=\"7.5\" height=\"7.5\" rx=\"2.2\"/><rect x=\"13\" y=\"3.5\" width=\"7.5\" height=\"7.5\" rx=\"2.2\"/><rect x=\"3.5\" y=\"13\" width=\"7.5\" height=\"7.5\" rx=\"2.2\"/><rect x=\"13\" y=\"13\" width=\"7.5\" height=\"7.5\" rx=\"2.2\"/>",
  "map": "<circle cx=\"12\" cy=\"5.5\" r=\"2.5\"/><circle cx=\"5.5\" cy=\"18\" r=\"2.5\"/><circle cx=\"18.5\" cy=\"18\" r=\"2.5\"/><path d=\"M10.2 7.4 7 15.7M13.8 7.4 17 15.7M8 18h8\"/>",
  "devices": "<rect x=\"3.5\" y=\"4\" width=\"17\" height=\"6\" rx=\"2\"/><rect x=\"3.5\" y=\"14\" width=\"17\" height=\"6\" rx=\"2\"/><path d=\"M7 7h.01M7 17h.01\"/>",
  "auto": "<g transform=\"translate(0.5 0.0)\"><path d=\"M13 3 5.5 13.5H11L10 21l7.5-10.5H12z\"/></g>",
  "shield": "<g transform=\"translate(0.0 0.35)\"><path d=\"M12 3.2 19 6v5.2c0 4.4-2.9 7.5-7 8.9-4.1-1.4-7-4.5-7-8.9V6z\"/><path d=\"M9.6 11.8 11.4 13.6 15 10\"/></g>",
  "ban": "<circle cx=\"12\" cy=\"12\" r=\"8.5\"/><path d=\"M6 6l12 12\"/>",
  "chip": "<rect x=\"6\" y=\"6\" width=\"12\" height=\"12\" rx=\"2.4\"/><rect x=\"9.5\" y=\"9.5\" width=\"5\" height=\"5\" rx=\"1.2\"/><path d=\"M9 3v3M15 3v3M9 18v3M15 18v3M3 9h3M3 15h3M18 9h3M18 15h3\"/>",
  "settings": "<path d=\"M4 7h9M17 7h3M4 17h3M11 17h9\"/><circle cx=\"15\" cy=\"7\" r=\"2.2\"/><circle cx=\"7.5\" cy=\"17\" r=\"2.2\"/>",
  "router": "<rect x=\"3.5\" y=\"13\" width=\"17\" height=\"7\" rx=\"2\"/><path d=\"M7 16.5h.01M10.5 16.5h.01\"/><path d=\"M8.6 9.4a4.8 4.8 0 0 1 6.8 0M6 6.8a8.5 8.5 0 0 1 12 0\"/>",
  "switch": "<rect x=\"3\" y=\"6.8\" width=\"18\" height=\"8\" rx=\"2\"/><path d=\"M7 14.8v2.4M11 14.8v2.4M15 14.8v2.4M17.5 10.8h.01\"/>",
  "server": "<rect x=\"3.5\" y=\"4.5\" width=\"17\" height=\"6\" rx=\"1.8\"/><rect x=\"3.5\" y=\"13.5\" width=\"17\" height=\"6\" rx=\"1.8\"/><path d=\"M7 7.5h.01M7 16.5h.01M16 7.5h2M16 16.5h2\"/>",
  "plug": "<path d=\"M9 3v4.5M15 3v4.5M6.5 7.5h11v3.2a5.5 5.5 0 0 1-11 0z\"/><path d=\"M12 16.2V21\"/>",
  "cam": "<path d=\"M3 8.9 16.5 5.3l1.6 5.2L4.5 14.1z\"/><path d=\"M6 13.7v3.2a2 2 0 0 0 2 2h1.6a2 2 0 0 0 2-2v-2\"/><circle cx=\"18.9\" cy=\"16.3\" r=\"2.1\"/>",
  "printer": "<path d=\"M7 8.5V3.5h10v5\"/><rect x=\"3.5\" y=\"8.5\" width=\"17\" height=\"7\" rx=\"2\"/><path d=\"M7 13h10v7.5H7z\"/>",
  "pi": "<rect x=\"4\" y=\"6\" width=\"16\" height=\"12\" rx=\"2\"/><path d=\"M7.5 9.5h4M7.5 12.5h2\"/><rect x=\"14\" y=\"9.5\" width=\"3.5\" height=\"5\" rx=\"1\"/>",
  "unknown": "<circle cx=\"12\" cy=\"12\" r=\"8.6\" stroke-dasharray=\"3.2 3.4\"/><path d=\"M9.7 9.9a2.4 2.4 0 1 1 2.9 2.35v1.05\"/><path d=\"M12.6 16.4h.01\"/>",
  "wired": "<path d=\"M4 12h5M15 12h5\"/><rect x=\"9\" y=\"8.6\" width=\"6\" height=\"6.8\" rx=\"1.6\"/>",
  "air": "<g transform=\"translate(0.0 -1.11)\"><path d=\"M8.6 13.6a4.8 4.8 0 0 1 6.8 0M5.6 10.4a9 9 0 0 1 12.8 0\"/><circle cx=\"12\" cy=\"17.4\" r=\"1.1\" fill=\"currentColor\" stroke=\"none\"/></g>",
  "search": "<g transform=\"translate(-0.5 -0.5)\"><circle cx=\"11\" cy=\"11\" r=\"6.5\"/><path d=\"M16 16l4.5 4.5\"/></g>",
  "refresh": "<path d=\"M20 11.4a8.2 8.2 0 1 0-1.9 6.2\"/><path d=\"M20.5 5v5h-5\"/>",
  "export": "<g transform=\"translate(0.0 1.0)\"><path d=\"M12 3.5v10M8.2 10l3.8 3.8 3.8-3.8M4.5 18.5h15\"/></g>",
  "plus": "<path d=\"M12 5.5v13M5.5 12h13\"/>",
  "pair": "<circle cx=\"9\" cy=\"12\" r=\"5.2\"/><circle cx=\"15\" cy=\"12\" r=\"5.2\"/>",
  "bell": "<path d=\"M6.5 10a5.5 5.5 0 0 1 11 0c0 4 1.6 5.6 1.6 5.6H4.9S6.5 14 6.5 10z\"/><path d=\"M10.2 18.6a2 2 0 0 0 3.6 0\"/>",
  "mode": "<circle cx=\"12\" cy=\"12\" r=\"8.4\"/><path d=\"M12 3.6v16.8a8.4 8.4 0 0 0 0-16.8z\" fill=\"currentColor\" stroke=\"none\"/>",
  "alert": "<path d=\"M12 4.6 20.5 19.4h-17z\"/><path d=\"M12 10v4M12 16.8h.01\"/>",
  "clock": "<circle cx=\"12\" cy=\"12\" r=\"8.4\"/><path d=\"M12 7.4V12l3 1.8\"/>",
  "port": "<g transform=\"translate(0.0 -1.25)\"><rect x=\"4.5\" y=\"7\" width=\"15\" height=\"10\" rx=\"2\"/><path d=\"M8.5 17v2.5M15.5 17v2.5M9 11h6\"/></g>",
  "logo": "<circle cx=\"12\" cy=\"6.4\" r=\"2.1\"/><circle cx=\"6\" cy=\"17.4\" r=\"2.1\"/><circle cx=\"18\" cy=\"17.4\" r=\"2.1\"/><path d=\"M10.4 8.1 7.3 15.4M13.6 8.1 16.7 15.4M8 17.9h8\"/>",
  "vlan": "<path d=\"M4 6h6M14 6h6M4 18h6M14 18h6\"/><path d=\"M10 6c0 6 4 6 4 12M14 6c0 6-4 6-4 12\"/>",
  "ssh": "<rect x=\"3.2\" y=\"4.5\" width=\"17.6\" height=\"15\" rx=\"2.4\"/><path d=\"M7.5 10l2.6 2.2-2.6 2.2M12.6 14.6h4\"/>",
  "logs": "<path d=\"M5 5h14M5 9.6h14M5 14.2h9M5 18.8h6\"/>",
  "report": "<g transform=\"translate(0.0 -1.0)\"><path d=\"M5 19V9.5M10 19V5M15 19v-6.5M20 19V8\"/><path d=\"M3.5 21h17\"/></g>",
  "users": "<g transform=\"translate(0.0 -0.3)\"><circle cx=\"9.2\" cy=\"8.6\" r=\"3.4\"/><path d=\"M3.4 19.4a5.8 5.8 0 0 1 11.6 0\"/><path d=\"M16 6.2a3.4 3.4 0 0 1 0 6.6M17.4 15.2a5.5 5.5 0 0 1 3.4 4.2\"/></g>",
  "power": "<path d=\"M12 3.5v8\"/><path d=\"M7.6 6.6a7.6 7.6 0 1 0 8.8 0\"/>",
  "bot": "<g transform=\"translate(0.0 1.5)\"><rect x=\"4\" y=\"8\" width=\"16\" height=\"11\" rx=\"3\"/><path d=\"M12 4.2V8\"/><circle cx=\"12\" cy=\"3.2\" r=\"1.2\"/><path d=\"M9 12.6h.01M15 12.6h.01M9.6 16h4.8\"/></g>",
  "eye": "<path d=\"M2.6 12S6.4 5.8 12 5.8 21.4 12 21.4 12 17.6 18.2 12 18.2 2.6 12 2.6 12z\"/><circle cx=\"12\" cy=\"12\" r=\"2.7\"/>",
  "globe": "<circle cx=\"12\" cy=\"12\" r=\"8.5\"/><path d=\"M3.5 12h17M12 3.5c2.4 2.6 3.6 5.4 3.6 8.5S14.4 18.4 12 20.5C9.6 18.4 8.4 15.6 8.4 12.5S9.6 6.1 12 3.5z\"/>",
};

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 16, stroke = 1.6, style, title }: {
  name: string; size?: number; stroke?: number; style?: any; title?: string;
}) {
  const d = PATHS[name] || PATHS.unknown;
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      aria-hidden={title ? undefined : true}
      role={title ? "img" : undefined}
      style={{
        display: "block", flex: "none", stroke: "currentColor", strokeWidth: stroke,
        fill: "none", strokeLinecap: "round", strokeLinejoin: "round", ...style,
      }}
      // `d` is an SVG path from our own icon table (safe). `title`, however,
      // could come from a caller that puts device text into it: we escape it
      // before injecting, otherwise a hostile name would become HTML.
      dangerouslySetInnerHTML={{ __html: (title ? `<title>${escapeXml(title)}</title>` : "") + d }}
    />
  );
}

// Device type -> icon. Covers the 17 backend types.
export const DEVICE_ICON: Record<string, string> = {
  router: "router", gateway: "router", firewall: "shield", switch: "switch",
  ap: "air", accesspoint: "air", server: "server", nas: "server",
  computer: "chip", laptop: "chip", desktop: "chip", pc: "chip",
  phone: "chip", tablet: "chip", printer: "printer", camera: "cam",
  iot: "plug", plug: "plug", tv: "eye", console: "chip",
  pi: "pi", raspberry: "pi", docker: "server", vm: "server",
  unknown: "unknown",
};

export function deviceIcon(type?: string | null): string {
  if (!type) return "unknown";
  return DEVICE_ICON[String(type).toLowerCase()] || "unknown";
}
