// Carte manipulable.
//
// - déplacer un appareil à la souris (la position est enregistrée) ;
// - molette pour zoomer, glisser le fond pour se déplacer ;
// - clic droit sur un appareil : menu, création de liaison, suppression ;
// - zones rectangulaires nommées, déplaçables et redimensionnables ;
// - plan d'architecte en fond, importé depuis le poste ;
// - clic sur un appareil : sa fiche s'ouvre.
//
// L'apparence des nœuds suit la maquette : une plaque carrée, le picto au
// centre, le genre en capitales, le nom, l'adresse. Les couleurs viennent des
// classes de styles/maquette.css, donc de la palette du thème.

import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../../stores/app";
import { api } from "../../api/client";
import { Theme } from "../../lib/themes";
import { DeviceIcon } from "../ui/DeviceIcon";
import { CiscoIcon } from "../ui/CiscoIcon";

interface Props { theme: Theme; }

interface Pos { x: number; y: number }

const W = 2400, H = 1600;

// Le plan de travail fait 2400 unités de large, la maquette 980 : sans
// agrandissement, une plaque de 74 unités et son libellé de 11,5 seraient
// réduits de moitié à l'écran. Les positions enregistrées, elles, ne changent
// pas — seul le dessin du nœud est mis à l'échelle.
const ECHELLE_NOEUD = 2.2;

// Zone palette and stroke patterns
export const ZONE_PALETTE = [
  "#38bdf8", "#22d3ee", "#a78bfa", "#f472b6", "#fb923c",
  "#fbbf24", "#34d399", "#f87171", "#94a3b8", "#06b6d4",
  "#84cc16", "#e879f9",
];

const STROKE_PATTERNS: Record<string, string> = {
  solid:  "0",
  dashed: "8 4",
  dotted: "1 4",
  dashdot: "10 4 2 4",
  long:   "16 6",
};

function hexWithAlpha(hex: string, alpha: number): string {
  // Build rgba() from hex; alpha is 0..1
  const m = hex.match(/^#?([0-9a-f]{6})$/i);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return `rgba(${r},${g},${b},${alpha})`;
}

const MAP_TYPE_EMOJI: Record<string, string> = {
  router: "🌐", switch: "🔀", ap: "📡", firewall: "🛡",
  server: "🖥️", laptop: "💻", phone: "📱", tablet: "📱",
  iot: "⚡", printer: "🖨", camera: "📷", tv: "📺",
  console: "🎮", sensor: "🌡", vm: "📦", container: "🐳",
  unknown: "❓",
};

// Per-type style: color + dash pattern + width + animate flow
// Le trait dit le médium, pas la couleur : plein pour du cuivre, pointillé pour
// de l'onde. La couleur reste neutre, seul le lien sélectionné prend l'accent.
const LINK_STYLES: Record<string, { color: (t: any) => string; dash: string; width: number; animate?: boolean }> = {
  ethernet: { color: t => t.faint || t.muted, dash: "0",       width: 1.4, animate: false },
  wifi:     { color: t => t.faint || t.muted, dash: "2 5",     width: 1.4, animate: false },
  vpn:      { color: t => t.primary,          dash: "7 3 2 3", width: 1.4, animate: true  },
  trunk:    { color: t => t.txtSoft || t.txt, dash: "0",       width: 2.4, animate: false },
  wan:      { color: t => t.warn,             dash: "8 4",     width: 1.6, animate: false },
  docker:   { color: t => t.faint || t.muted, dash: "4 3",     width: 1.2, animate: false },
  // Deux faces d'un même boîtier : trait presque effacé, il signale la parenté
  // sans prétendre représenter un câble.
  sibling:  { color: t => t.border || t.faint, dash: "1 5",     width: 1.1, animate: false },
};

export function TopologyMap({ theme: t }: Props) {
  const { devices, topology, refreshTopology } = useStore();
  const select = (id: string | null) => useStore.getState().selectDevice(id);

  const useCisco = false;

  // ── State ──
  const [positions, setPositions] = useState<Record<string, Pos>>({});
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [linkType, setLinkType] = useState("ethernet");
  const [draggingId, setDraggingId] = useState<string | null>(null);
  // True if the user actually moved the cursor while dragging — used to
  // suppress the synthetic onClick that fires on mouse-up after a drag.
  const [dragMoved, setDragMoved] = useState(false);
  const [linkingFrom, setLinkingFrom] = useState<string | null>(null);
  const [draggingZone, setDraggingZone] = useState<{ id: string; dx: number; dy: number } | null>(null);
  const [resizingZone, setResizingZone] = useState<{ id: string; corner: "nw" | "ne" | "sw" | "se"; startX: number; startY: number; origW: number; origH: number; origX: number; origY: number } | null>(null);
  const [editingZone, setEditingZone] = useState<any | null>(null);
  const [selectedLinkId, setSelectedLinkId] = useState<string | null>(null);
  const [linkMenu, setLinkMenu] = useState<{ x: number; y: number; linkId: string } | null>(null);
  const [adding, setAdding] = useState(false);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; deviceId?: string } | null>(null);
  const [mousePos, setMousePos] = useState<Pos>({ x: 0, y: 0 });
  const svgRef = useRef<SVGSVGElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const fichierRef = useRef<HTMLInputElement | null>(null);

  // Plan d'architecte posé sous la topologie. Il n'a pas de contrepartie
  // serveur : il est conservé dans ce navigateur, sous forme d'URL de données.
  const [plan, setPlan] = useState<string | null>(() => {
    try { return localStorage.getItem("mapmylan_plan"); } catch { return null; }
  });
  const [planOpacite, setPlanOpacite] = useState<number>(() => {
    const v = Number(localStorage.getItem("mapmylan_plan_opacite"));
    return Number.isFinite(v) && v > 0 ? v : 55;
  });

  /**
   * Cadre la vue sur ce qui existe : on cherche l'emprise des appareils, on
   * choisit l'agrandissement qui la fait tenir, et on la ramène au centre.
   * Le point (x,y) du plan se projette en W/2 + zoom·(x − W/2) + pan, d'où
   * le déplacement calculé ci-dessous.
   */
  const ajusterVue = () => {
    const pts = Object.values(positions);
    if (!pts.length) { setZoom(1); setPan({ x: 0, y: 0 }); return; }
    const marge = 130 * ECHELLE_NOEUD;
    const xs = pts.map(q => q.x), ys = pts.map(q => q.y);
    const minX = Math.min(...xs) - marge, maxX = Math.max(...xs) + marge;
    const minY = Math.min(...ys) - marge, maxY = Math.max(...ys) + marge;
    const k = Math.max(0.25, Math.min(2.6, Math.min(W / (maxX - minX), H / (maxY - minY))));
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    setZoom(k);
    setPan({ x: k * (W / 2 - cx), y: k * (H / 2 - cy) });
  };

  // Cadrage automatique à la première ouverture : on ne montre pas un coin
  // vide d'un plan de travail de 2400 unités alors que le parc tient dans un
  // mouchoir. Ensuite, c'est l'utilisateur qui décide.
  const dejaCadre = useRef(false);
  useEffect(() => {
    if (dejaCadre.current) return;
    if (!Object.keys(positions).length) return;
    dejaCadre.current = true;
    ajusterVue();
  }, [positions]);

  const chargerPlan = (f?: File | null) => {
    if (!f) return;
    const lecteur = new FileReader();
    lecteur.onload = () => {
      const url = String(lecteur.result || "");
      setPlan(url);
      try { localStorage.setItem("mapmylan_plan", url); }
      catch { /* image trop lourde pour le stockage : elle reste en mémoire */ }
    };
    lecteur.readAsDataURL(f);
  };
  const retirerPlan = () => {
    setPlan(null);
    try { localStorage.removeItem("mapmylan_plan"); } catch { /* rien à faire */ }
  };

  // ── Initialize positions from devices' saved posX/posY, fallback to layered layout ──
  useEffect(() => {
    setPositions((cur) => {
      const next = { ...cur };
      // Étage d'un appareil.
      //
      // Le type prime : une passerelle en haut, un commutateur ou une borne
      // juste en dessous, les machines ensuite. Quand le type ne dit rien, on
      // se rabat sur le segment — les appareils d'un même sous-réseau se
      // retrouvent sur la même ligne, quel que soit le plan d'adressage.
      const segments: string[] = [];
      const segmentDe = (d: any): number => {
        const m = /^(\d+\.\d+\.\d+)\./.exec(d.ip || "");
        const cle = m ? m[1] : "?";
        let i = segments.indexOf(cle);
        if (i < 0) { segments.push(cle); i = segments.length - 1; }
        return i;
      };
      const tierOf = (d: any): number => {
        const ty = d.customType || d.type;
        if (ty === "firewall") return 0;
        if (ty === "router" || d.isMainRouter) return 1;
        if (ty === "switch" || ty === "ap") return 2;
        if (ty === "server" || ty === "nas" || ty === "vm" || ty === "docker") return 3;
        // ni équipement réseau ni serveur : on répartit par segment, en
        // alternant les deux derniers étages pour ne pas tout empiler.
        return 4 + (segmentDe(d) % 2);
      };

      const layers: Record<number, any[]> = { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [] };
      for (const d of devices) layers[tierOf(d)].push(d);

      // On range chaque étage par dernier octet, pour que les appareils d'une
      // même machine (même N, faces filaire et wifi) se retrouvent voisins.
      const lastOctet = (ip: string) => { const p = (ip || "").split("."); return +p[3] || 0; };
      // Les étages sont espacés d'une hauteur de nœud entière : plaque,
      // genre, nom et adresse compris, sinon deux rangées se chevauchent.
      const layerY = [150, 430, 710, 990, 1270, 1520];
      for (const lvl of Object.keys(layers)) {
        const items = layers[+lvl].sort((a, b) => lastOctet(a.ip) - lastOctet(b.ip));
        items.forEach((d, i) => {
          if (next[d.id]) return;
          if (d.posX != null && d.posY != null) {
            next[d.id] = { x: d.posX, y: d.posY };
          } else {
            const x = items.length === 1 ? W / 2 : 200 + ((W - 400) / Math.max(1, items.length - 1)) * i;
            next[d.id] = { x, y: layerY[+lvl] };
          }
        });
      }
      // Strip removed devices
      for (const id of Object.keys(next)) if (!devices.find(d => d.id === id)) delete next[id];
      return next;
    });
  }, [devices]);

  // ── Mouse → SVG world coordinate conversion ──
  // Uses the inner <g>'s CTM so that pan, zoom and preserveAspectRatio padding
  // are all taken into account. The user's cursor sits exactly on the world
  // coordinate we return, so picking and rubberbanding feel pixel-perfect.
  const worldGroupRef = useRef<SVGGElement | null>(null);
  const screenToSvg = (cx: number, cy: number): Pos => {
    const svg = svgRef.current;
    const g = worldGroupRef.current;
    if (!svg || !g) return { x: 0, y: 0 };
    const pt = svg.createSVGPoint();
    pt.x = cx; pt.y = cy;
    const ctm = g.getScreenCTM();
    if (!ctm) return { x: 0, y: 0 };
    const inv = ctm.inverse();
    const local = pt.matrixTransform(inv);
    return { x: local.x, y: local.y };
  };

  // ── Drag handlers ──
  // Left-click on a device → drag to move it.
  // Right-click on a device + drag to another device → create a link.
  const onMouseDownDevice = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (e.button === 2) {
      // Right-click drag = start a link rubberband
      e.preventDefault();
      setLinkingFrom(id);
      setDraggingId(null);
      return;
    }
    if (e.button !== 0) return;
    setDraggingId(id);
    setDragMoved(false);
    setLinkingFrom(null);
  };

  // Pan: left-click on the canvas (not on a device) and drag
  const [panStart, setPanStart] = useState<{ x: number; y: number; pan: { x: number; y: number } } | null>(null);
  const onCanvasMouseDown = (e: React.MouseEvent) => {
    // Ignore if a device or its children initiated the click
    const target = e.target as Element;
    if (target.closest("[data-device-node]") || target.closest("[data-zone-node]")) return;
    if (linkingFrom) return;
    setPanStart({ x: e.clientX, y: e.clientY, pan: { ...pan } });
  };

  const onMouseMove = (e: React.MouseEvent) => {
    const p = screenToSvg(e.clientX, e.clientY);
    setMousePos(p);
    if (draggingId) {
      setPositions(prev => ({ ...prev, [draggingId]: p }));
      setDragMoved(true);
      return;
    }
    if (draggingZone) {
      // Update zone position locally for smoothness; persist on mouse up
      const z = topology.zones.find((zz: any) => zz.id === draggingZone.id);
      if (z) {
        z.x = p.x - draggingZone.dx;
        z.y = p.y - draggingZone.dy;
      }
      return;
    }
    if (resizingZone) {
      const z = topology.zones.find((zz: any) => zz.id === resizingZone.id);
      if (z) {
        const dx = p.x - resizingZone.startX;
        const dy = p.y - resizingZone.startY;
        const min = 40;
        if (resizingZone.corner === "se") {
          z.width = Math.max(min, resizingZone.origW + dx);
          z.height = Math.max(min, resizingZone.origH + dy);
        } else if (resizingZone.corner === "sw") {
          const newW = Math.max(min, resizingZone.origW - dx);
          z.x = resizingZone.origX + (resizingZone.origW - newW);
          z.width = newW;
          z.height = Math.max(min, resizingZone.origH + dy);
        } else if (resizingZone.corner === "ne") {
          z.width = Math.max(min, resizingZone.origW + dx);
          const newH = Math.max(min, resizingZone.origH - dy);
          z.y = resizingZone.origY + (resizingZone.origH - newH);
          z.height = newH;
        } else if (resizingZone.corner === "nw") {
          const newW = Math.max(min, resizingZone.origW - dx);
          const newH = Math.max(min, resizingZone.origH - dy);
          z.x = resizingZone.origX + (resizingZone.origW - newW);
          z.y = resizingZone.origY + (resizingZone.origH - newH);
          z.width = newW;
          z.height = newH;
        }
      }
      return;
    }
    if (panStart) {
      const dx = e.clientX - panStart.x;
      const dy = e.clientY - panStart.y;
      setPan({ x: panStart.pan.x + dx, y: panStart.pan.y + dy });
    }
  };

  const onMouseUp = async (e?: React.MouseEvent) => {
    if (draggingId) {
      const p = positions[draggingId];
      if (p) api.updateDevice(draggingId, { posX: p.x, posY: p.y }).catch(() => {});
    }
    if (draggingZone) {
      const z = topology.zones.find((zz: any) => zz.id === draggingZone.id);
      if (z) api.updateZone(z.id, { x: z.x, y: z.y }).catch(() => {});
    }
    if (resizingZone) {
      const z = topology.zones.find((zz: any) => zz.id === resizingZone.id);
      if (z) api.updateZone(z.id, { x: z.x, y: z.y, width: z.width, height: z.height }).catch(() => {});
    }
    // Right-click rubberband finished — find a device under the cursor and create a link
    if (linkingFrom && e) {
      const targetId = findDeviceAtPoint(mousePos.x, mousePos.y, linkingFrom);
      if (targetId) {
        try {
          await api.createLink({ fromId: linkingFrom, toId: targetId, type: linkType });
          await refreshTopology();
        } catch (err: any) {
          // ignore (e.g. duplicate)
        }
      }
      setLinkingFrom(null);
    }
    setDraggingId(null);
    setDraggingZone(null);
    setResizingZone(null);
    setPanStart(null);
  };

  // Find which device sits under a given world coordinate (excluding self)
  const findDeviceAtPoint = (x: number, y: number, excludeId: string): string | null => {
    const r = 36; // hit radius around device center
    for (const d of devices) {
      if (d.id === excludeId) continue;
      const p = positions[d.id]; if (!p) continue;
      const dx = p.x - x, dy = p.y - y;
      if (dx * dx + dy * dy < r * r) return d.id;
    }
    return null;
  };

  const onCanvasClick = (e: React.MouseEvent) => {
    if (panStart) return;
    setContextMenu(null);
    setLinkingFrom(null);
    setSelectedLinkId(null);
    setLinkMenu(null);
  };

  // If user releases mouse outside the SVG (e.g. on the toolbar), still reset state
  useEffect(() => {
    const cancel = () => { setLinkingFrom(null); setDraggingId(null); setDraggingZone(null); setResizingZone(null); setPanStart(null); };
    window.addEventListener("blur", cancel);
    return () => window.removeEventListener("blur", cancel);
  }, []);

  const onDeviceClick = (id: string) => {
    // Suppress the synthetic click that fires on mouse-up after a drag
    if (dragMoved) { setDragMoved(false); return; }
    if (linkingFrom && linkingFrom !== id && linkingFrom !== "_arm") {
      api.createLink({ fromId: linkingFrom, toId: id, type: linkType }).then(refreshTopology).catch(() => {});
      setLinkingFrom(null);
    } else if (linkingFrom === "_arm") {
      setLinkingFrom(id);
    } else {
      select(id);
    }
  };

  const onDeviceContextMenu = (e: React.MouseEvent, id: string) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, deviceId: id });
  };

  // ── Action handlers from context menu ──
  const startLink = (fromId: string) => { setLinkingFrom(fromId); setContextMenu(null); };
  const removeLinks = async (deviceId: string) => {
    const links = topology.links.filter(l => l.fromId === deviceId || l.toId === deviceId);
    for (const l of links) await api.deleteLink(l.id).catch(() => {});
    refreshTopology();
    setContextMenu(null);
  };
  const banFromMenu = async (deviceId: string) => {
    try { await api.banDevice(deviceId, "Banned from topology"); }
    catch (e: any) { alert(e.message); }
    setContextMenu(null);
  };
  const openDetail = (deviceId: string) => { select(deviceId); setContextMenu(null); };

  // ── Color per device based on danger ──
  const deviceColor = (d: any) => {
    if (d.status === "banned") return t.err;
    if (d.status === "quarantined") return t.warn;
    if (d.status === "offline") return t.muted;
    if (d.dangerScore > 70) return t.err;
    if (d.dangerScore > 40) return t.warn;
    return t.hi;
  };

  // ── Pan + zoom ──
  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const factor = e.deltaY > 0 ? 0.92 : 1.08;
    const svg = svgRef.current;
    const g = worldGroupRef.current;
    if (!svg || !g) {
      setZoom(z => Math.max(0.25, Math.min(2, z * factor)));
      return;
    }
    // Step 1: world coordinate currently under the cursor (this is what we want
    // to keep stationary across the zoom change).
    const worldBefore = screenToSvg(e.clientX, e.clientY);

    // Step 2: figure out the new zoom value (clamped).
    const newZoom = Math.max(0.25, Math.min(2, zoom * factor));
    if (newZoom === zoom) return;

    // Step 3: at the new zoom, what's the SVG-viewBox point that the cursor
    // would map to without changing the pan? We can compute it directly:
    //   svgPoint = screenToSvgViewBox(cursor)   (independent of our pan/zoom)
    //   worldAfter = (svgPoint - pan) / newZoom - centeringOffset(newZoom)
    // We want worldAfter == worldBefore, so we solve for the new pan.
    const svgPt = svg.createSVGPoint();
    svgPt.x = e.clientX; svgPt.y = e.clientY;
    const svgCTM = svg.getScreenCTM(); if (!svgCTM) return;
    const inViewBox = svgPt.matrixTransform(svgCTM.inverse()); // raw viewBox coords
    const centerOffset = (W - W * newZoom) / (2 * newZoom);
    // newPan such that:  inViewBox.x = newPan.x + newZoom * (worldBefore.x + centerOffsetX)
    //                  → newPan.x = inViewBox.x - newZoom * (worldBefore.x + centerOffset)
    const centerOffsetY = (H - H * newZoom) / (2 * newZoom);
    setPan({
      x: inViewBox.x - newZoom * (worldBefore.x + centerOffset),
      y: inViewBox.y - newZoom * (worldBefore.y + centerOffsetY),
    });
    setZoom(newZoom);
  };

  // Attach the wheel handler as a NON-passive native listener so preventDefault()
  // actually blocks the browser's page-zoom — required for trackpad pinch on
  // macOS/Windows (which arrives as a wheel event with ctrlKey=true) as well as
  // regular mouse-wheel zoom. React's onWheel is passive and cannot do this.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => onWheel(e);
    el.addEventListener("wheel", handler, { passive: false });
    return () => el.removeEventListener("wheel", handler);
  });

  if (devices.length === 0) {
    return (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", gap: 12, alignItems: "center", justifyContent: "center", background: t.bg, color: t.muted, fontFamily: t.monoFont, fontSize: 14 }}>
        <div>No devices discovered yet.</div>
        <button onClick={() => useStore.getState().triggerScan()}
          style={{ background: t.grad, border: "none", color: t.onPrimary, padding: "8px 18px", borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: t.headFont }}>
          ↻ Trigger scan
        </button>
      </div>
    );
  }

  return (
    <div ref={containerRef} style={{ position: "relative", width: "100%", height: "100%", background: "transparent", overflow: "hidden", cursor: linkingFrom ? "crosshair" : draggingId ? "grabbing" : panStart ? "grabbing" : "default" }}
      onMouseDown={onCanvasMouseDown}
      onMouseMove={onMouseMove} onMouseUp={(e) => onMouseUp(e)} onClick={onCanvasClick}>

      {/* Outils de la carte */}
      <div className="planoutils" style={{
        position: "absolute", top: 0, left: 0, right: 0, zIndex: 30,
        background: "var(--surface)",
      }}>
        <button className="po" onClick={(e) => { e.stopPropagation(); api.autoBuildTopology().then(refreshTopology); }}>
          Reconstruire
        </button>
        <button className="po" onClick={(e) => { e.stopPropagation(); ajusterVue(); }}>
          Recentrer
        </button>
        <span className="po" style={{ cursor: "default" }}>
          Liaison
          <select value={linkType} onChange={(e) => setLinkType(e.target.value)}
            style={{ background: "transparent", border: "none", color: "var(--ink)", font: "inherit", cursor: "pointer", outline: "none" }}>
            {[["ethernet", "filaire"], ["wifi", "sans fil"], ["vpn", "tunnel"],
              ["trunk", "agrégée"], ["wan", "sortie"], ["docker", "conteneur"]]
              .map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </span>
        <button className="po" onClick={(e) => { e.stopPropagation(); setAdding(true); }}>+ Appareil</button>
        <button className="po" onClick={(e) => {
          e.stopPropagation();
          const cx = -pan.x / zoom + W / 2;
          const cy = -pan.y / zoom + H / 2;
          setEditingZone({
            isNew: true, id: "", name: "Nouvelle zone", color: ZONE_PALETTE[0],
            x: cx - 200, y: cy - 100, width: 400, height: 200,
            opacity: 0.10, strokeStyle: "dashed", strokeWidth: 2,
          });
        }}>+ Zone</button>

        <input ref={fichierRef} type="file" accept="image/*" style={{ display: "none" }}
          onChange={(e) => chargerPlan(e.target.files?.[0])}/>
        <button className="po" onClick={(e) => { e.stopPropagation(); fichierRef.current?.click(); }}>
          {plan ? "Changer le plan" : "Importer un plan"}
        </button>
        {plan && (
          <>
            <label className="po opa" onClick={(e) => e.stopPropagation()}>
              Plan
              <input type="range" min={10} max={100} value={planOpacite}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  setPlanOpacite(v);
                  try { localStorage.setItem("mapmylan_plan_opacite", String(v)); } catch { /* rien */ }
                }}/>
            </label>
            <button className="po" onClick={(e) => { e.stopPropagation(); retirerPlan(); }}>Retirer le plan</button>
          </>
        )}

        <span className="posep"/>
        <span className="poinfo">glisser pour déplacer · molette pour zoomer</span>
        <span className="poinfo">{Math.round(zoom * 100)} %</span>
      </div>

      {/* Main SVG */}
      <svg ref={svgRef} width="100%" height="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" onContextMenu={(e) => e.preventDefault()}>
        <style>{`
          @keyframes flow { to { stroke-dashoffset: -16 } }
          @keyframes pulse-ring { from { r: 28; opacity: 0.7 } to { r: 60; opacity: 0 } }
        `}</style>
        <defs>
          <pattern id="grid" width="22" height="22" patternUnits="userSpaceOnUse">
            <circle cx="1" cy="1" r="1" fill={t.border}/>
          </pattern>
        </defs>
        <rect width={W} height={H} fill="url(#grid)"/>

        <g ref={worldGroupRef} transform={`translate(${pan.x} ${pan.y}) scale(${zoom}) translate(${(W - W * zoom) / (2 * zoom)} ${(H - H * zoom) / (2 * zoom)})`}>

          {/* Plan d'architecte : il suit le zoom et le déplacement, comme le
              reste, sinon les appareils ne resteraient pas sur leurs pièces. */}
          {plan && (
            <image href={plan} x={0} y={0} width={W} height={H}
              preserveAspectRatio="xMidYMid meet"
              opacity={planOpacite / 100} style={{ pointerEvents: "none" }}/>
          )}

          {/* Zones (background) — drag to move, dbl-click to edit, corner handles to resize */}
          {topology.zones.map((z: any) => {
            const meta = (z.notes || "{}");
            let metadata: any = {};
            try { metadata = typeof meta === "string" ? JSON.parse(meta) : meta; } catch { metadata = {}; }
            const opacity = metadata.opacity ?? 0.10;
            const strokeStyle = metadata.strokeStyle || "dashed";
            const strokeWidth = metadata.strokeWidth || 2;
            const dash = STROKE_PATTERNS[strokeStyle] || STROKE_PATTERNS.dashed;
            return (
              <g key={z.id} data-zone-node="1">
                {/* Body — draggable */}
                <rect x={z.x} y={z.y} width={z.width} height={z.height} rx={12}
                  fill={hexWithAlpha(z.color || t.hi || t.primary, opacity)}
                  stroke={z.color || t.hi || t.primary}
                  strokeWidth={strokeWidth}
                  strokeDasharray={dash}
                  onMouseDown={(e) => {
                    e.stopPropagation();
                    setDraggingZone({ id: z.id, dx: mousePos.x - z.x, dy: mousePos.y - z.y });
                  }}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    setEditingZone({ ...z, ...metadata, isNew: false });
                  }}
                  onContextMenu={async (e) => {
                    e.preventDefault(); e.stopPropagation();
                    if (confirm(`Delete zone "${z.name}"?`)) {
                      await api.deleteZone(z.id); refreshTopology();
                    }
                  }}
                  style={{ cursor: draggingZone?.id === z.id ? "grabbing" : "grab" }}
                />
                {/* Label */}
                <text x={z.x + 12} y={z.y + 22} fill={z.color || t.hi || t.primary}
                  fontSize={14} fontFamily={t.headFont} fontWeight={700}
                  style={{ userSelect: "none", pointerEvents: "none" }}>
                  {z.name}
                </text>
                {/* Corner resize handles */}
                {([
                  ["nw", z.x, z.y],
                  ["ne", z.x + z.width, z.y],
                  ["sw", z.x, z.y + z.height],
                  ["se", z.x + z.width, z.y + z.height],
                ] as const).map(([corner, hx, hy]) => (
                  <rect key={corner}
                    x={hx - 7} y={hy - 7} width={14} height={14}
                    fill={t.bg} stroke={z.color || t.hi || t.primary} strokeWidth={2}
                    style={{ cursor: corner === "nw" || corner === "se" ? "nwse-resize" : "nesw-resize" }}
                    onMouseDown={(e) => {
                      e.stopPropagation();
                      setResizingZone({
                        id: z.id, corner,
                        startX: mousePos.x, startY: mousePos.y,
                        origW: z.width, origH: z.height,
                        origX: z.x, origY: z.y,
                      });
                    }}
                  />
                ))}
              </g>
            );
          })}

          {/* Links — color and pattern depend on link type, arrows show flow direction */}
          {topology.links.map((l: any) => {
            const a = positions[l.fromId], b = positions[l.toId];
            if (!a || !b) return null;
            const fromDev = devices.find(d => d.id === l.fromId);
            const toDev = devices.find(d => d.id === l.toId);
            const suspect = (fromDev?.dangerScore ?? 0) > 60 || (toDev?.dangerScore ?? 0) > 60;
            const typeStyle = LINK_STYLES[l.type] || LINK_STYLES.ethernet;
            const color = suspect ? t.err : typeStyle.color(t);
            const isSelected = selectedLinkId === l.id;
            // Direction of the flow:
            // - For manual links (l.manual === true), trust fromId → toId as the user set it.
            //   The Reverse-direction action in the link menu swaps fromId/toId in DB,
            //   so the visible direction follows immediately.
            // - For auto-built links, use the heuristic: infra device → endpoint.
            const upstreamTypes = ["router", "switch", "firewall", "ap", "gateway"];
            const fromIsInfra = fromDev && upstreamTypes.includes(fromDev.customType || fromDev.type);
            const toIsInfra = toDev && upstreamTypes.includes(toDev.customType || toDev.type);
            const flowReversed = l.manual ? false : (!fromIsInfra && toIsInfra);
            const flowFrom = flowReversed ? b : a;
            const flowTo = flowReversed ? a : b;

            return (
              <g key={l.id}>
                {suspect && <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={`${t.err}40`} strokeWidth={6}/>}

                {/* Hit area (invisible, fat line for easier clicking) */}
                <line x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                  stroke="transparent" strokeWidth={14}
                  style={{ cursor: "pointer" }}
                  onClick={(e) => { e.stopPropagation(); setSelectedLinkId(isSelected ? null : l.id); }}
                  onDoubleClick={async (e) => {
                    e.stopPropagation();
                    if (confirm(`Delete link between ${fromDev?.hostname || fromDev?.ip || "?"} and ${toDev?.hostname || toDev?.ip || "?"}?`)) {
                      await api.deleteLink(l.id); refreshTopology(); setSelectedLinkId(null);
                    }
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault(); e.stopPropagation();
                    setLinkMenu({ x: e.clientX, y: e.clientY, linkId: l.id });
                  }}
                />

                {/* Visible line */}
                <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={color}
                  strokeWidth={isSelected ? typeStyle.width + 2 : typeStyle.width}
                  opacity={isSelected ? 1 : 0.75}
                  strokeDasharray={typeStyle.dash}
                  style={{ animation: typeStyle.animate ? "flow 1.5s linear infinite" : undefined, pointerEvents: "none" }}/>

                {/* Direction arrow at 65% along the line */}
                {(() => {
                  const t65 = 0.6;
                  const ax = flowFrom.x + (flowTo.x - flowFrom.x) * t65;
                  const ay = flowFrom.y + (flowTo.y - flowFrom.y) * t65;
                  const dx = flowTo.x - flowFrom.x;
                  const dy = flowTo.y - flowFrom.y;
                  const angle = Math.atan2(dy, dx) * 180 / Math.PI;
                  return (
                    <g transform={`translate(${ax} ${ay}) rotate(${angle})`} style={{ pointerEvents: "none" }}>
                      <polygon points="-7,-5 7,0 -7,5" fill={color} opacity={0.9}/>
                    </g>
                  );
                })()}

                {/* Animated traffic particle (placeholder for future Wireshark integration) */}
                <circle cx={flowFrom.x} cy={flowFrom.y} r={3} fill={color} opacity={0.9} style={{ pointerEvents: "none" }}>
                  <animate attributeName="cx" from={flowFrom.x} to={flowTo.x} dur="2.4s" repeatCount="indefinite"/>
                  <animate attributeName="cy" from={flowFrom.y} to={flowTo.y} dur="2.4s" repeatCount="indefinite"/>
                  <animate attributeName="opacity" values="0;0.9;0.9;0" dur="2.4s" repeatCount="indefinite"/>
                </circle>

                {/* Link label */}
                <text x={(a.x + b.x) / 2} y={(a.y + b.y) / 2 - 10}
                  fill={isSelected ? color : t.muted}
                  fontSize={isSelected ? 11 : 9}
                  fontFamily={t.monoFont}
                  fontWeight={isSelected ? 700 : 400}
                  textAnchor="middle" style={{ pointerEvents: "none", userSelect: "none" }}>
                  {l.type !== "ethernet" ? l.type : (isSelected ? "ethernet" : "")}
                </text>
              </g>
            );
          })}

          {/* Linking-in-progress preview */}
          {linkingFrom && linkingFrom !== "_arm" && positions[linkingFrom] && (
            <line x1={positions[linkingFrom].x} y1={positions[linkingFrom].y}
              x2={mousePos.x} y2={mousePos.y}
              stroke={t.acc} strokeWidth={2} strokeDasharray="4 4" opacity={0.7}/>
          )}

          {/* Appareils — plaques de la maquette */}
          {devices.map((d) => {
            const p = positions[d.id]; if (!p) return null;
            const T = 74, r = T / 2;
            const isHover = hoverId === d.id;
            const isLinkSrc = linkingFrom === d.id;

            // Trois lectures d'un même nœud, comme dans la maquette :
            //   core — l'équipement principal, plaque pleine ;
            //   flag — ce qui inquiète : risque élevé, blocage, isolement ;
            //   ded  — hors ligne, contour en pointillé.
            const classes = [
              "unit",
              d.isMainRouter ? "core" : "",
              (d.dangerScore > 70 || d.status === "banned" || d.status === "quarantined") ? "flag" : "",
              d.status === "offline" ? "ded" : "",
            ].filter(Boolean).join(" ");

            const genre = String(d.customType || d.type || "inconnu").toUpperCase();
            const nom = (d.customName || d.hostname || d.ip || "").slice(0, 24);
            const couleurGlyphe = d.isMainRouter ? "var(--paper)"
              : (d.dangerScore > 70 || d.status === "banned" || d.status === "quarantined") ? "var(--alarm)"
              : "var(--ink-soft)";

            return (
              <g key={d.id}
                className={classes}
                data-device-node="1"
                transform={`translate(${p.x} ${p.y}) scale(${ECHELLE_NOEUD})`}
                onMouseDown={(e) => onMouseDownDevice(e, d.id)}
                onMouseEnter={() => setHoverId(d.id)}
                onMouseLeave={() => setHoverId(null)}
                onClick={(e) => { e.stopPropagation(); onDeviceClick(d.id); }}
                onContextMenu={(e) => e.preventDefault()}
                style={{ cursor: draggingId === d.id ? "grabbing" : "pointer", opacity: d.status === "offline" ? .72 : 1 }}>

                {/* halo au survol ou pendant le tracé d'une liaison */}
                {(isHover || isLinkSrc) && (
                  <rect x={-r - 5} y={-r - 5} width={T + 10} height={T + 10} rx={23}
                    fill="none" stroke="var(--accent)" strokeWidth={1.5} opacity={isLinkSrc ? .9 : .45}/>
                )}

                <rect className="plate" x={-r} y={-r} width={T} height={T} rx={19}/>

                <foreignObject x={-r} y={-r} width={T} height={T} style={{ pointerEvents: "none" }}>
                  <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <DeviceIcon type={d.customType || d.type} size={34} color={couleurGlyphe}
                      dim={d.status === "offline"} pulse={false}/>
                  </div>
                </foreignObject>

                <text className="kd"  y={r + 17} textAnchor="middle">{genre}</text>
                <text className="nm"  y={r + 32} textAnchor="middle">{nom}</text>
                <text className="ipx" y={r + 45} textAnchor="middle">{d.ip}</text>

                {/* Pastille de risque : seulement quand elle apprend quelque chose. */}
                {d.dangerScore > 30 && !d.isMainRouter && (
                  <g transform={`translate(${r - 7} ${-r + 7})`}>
                    <circle cx={0} cy={0} r={11}
                      fill={d.dangerScore > 70 ? "var(--alarm)" : "var(--warn)"}
                      stroke="var(--surface)" strokeWidth={1.5}/>
                    <text x={0} y={3.5} textAnchor="middle" fill="#fff"
                      fontSize={9.5} fontFamily="var(--mono)" fontWeight={500}>{Math.round(d.dangerScore)}</text>
                  </g>
                )}
              </g>
            );
          })}
        </g>
      </svg>

      {/* Hover tooltip */}
      {hoverId && positions[hoverId] && (() => {
        const d = devices.find(x => x.id === hoverId);
        if (!d) return null;
        return (
          <div style={{ position: "absolute", left: 16, bottom: 50, background: t.bg, border: `1px solid ${t.border}`, borderRadius: t.radius, padding: 12, minWidth: 240, fontFamily: t.monoFont, fontSize: 11, zIndex: 25, boxShadow: "0 8px 24px rgba(0,0,0,0.4)" }}>
            <div style={{ color: t.txt, fontWeight: 700, fontSize: 13, marginBottom: 6 }}>{d.customName || d.hostname || d.ip}</div>
            {[
              ["IP", d.ip], ["MAC", d.mac || "—"], ["Vendor", d.vendor || "—"],
              ["Type", d.customType
                ? d.type
                : (d.metadata?.typeConfidence != null
                    ? `${d.type} · ${Math.round(d.metadata.typeConfidence * 100)}%`
                    : d.type)],
              ["Status", d.status],
              // Rattachement physique, tel que l'équipement réseau le rapporte.
              ...(d.metadata?.swPort !== undefined
                ? [["Port", `commutateur · port ${d.metadata.swPort}`]] : []),
              ...(d.metadata?.apMac
                ? [["Borne", d.metadata.essid
                    ? `${d.metadata.essid}${d.metadata.radio ? " · " + d.metadata.radio : ""}${d.metadata.rssi != null ? " · " + d.metadata.rssi + " dBm" : ""}`
                    : d.metadata.apMac]] : []),
              ["Danger", `${d.dangerScore}/100`], ["Trust", `${d.trustScore}/100`],
            ].map(([k, v]) => (
              <div key={k as string} style={{ display: "flex", justifyContent: "space-between", padding: "1px 0" }}>
                <span style={{ color: t.muted }}>{k}</span><span style={{ color: t.txt }}>{v as any}</span>
              </div>
            ))}
          </div>
        );
      })()}

      {/* Context menu */}
      {contextMenu && contextMenu.deviceId && (
        <div style={{ position: "fixed", left: contextMenu.x, top: contextMenu.y, background: t.bg, border: `1px solid ${t.border}`, borderRadius: t.radius, padding: 4, zIndex: 100, minWidth: 180, boxShadow: "0 12px 32px rgba(0,0,0,0.5)" }}>
          {[
            { label: "📋 Open details", onClick: () => openDetail(contextMenu.deviceId!) },
            { label: "🔗 Create link from here", onClick: () => startLink(contextMenu.deviceId!) },
            { label: "✂ Remove all links", onClick: () => removeLinks(contextMenu.deviceId!) },
            { label: "⛔ Ban", onClick: () => banFromMenu(contextMenu.deviceId!), color: t.err },
          ].map((item, i) => (
            <button key={i} onClick={item.onClick}
              style={{ display: "block", width: "100%", padding: "7px 12px", textAlign: "left", background: "none", border: "none", color: item.color || t.txt, fontFamily: (t.bodyFont || t.font), fontSize: 12, cursor: "pointer", borderRadius: 4 }}
              onMouseEnter={(e) => (e.currentTarget.style.background = (t.hover || t.surfaceHover))}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
              {item.label}
            </button>
          ))}
        </div>
      )}

      {/* Zone editor modal */}
      {editingZone && (
        <ZoneEditor t={t} zone={editingZone} onClose={() => setEditingZone(null)}
          onSave={async (data) => {
            try {
              if (editingZone.isNew) await api.createZone(data);
              else await api.updateZone(editingZone.id, data);
              await refreshTopology();
              setEditingZone(null);
            } catch (e: any) { alert(e.message); }
          }}/>
      )}

      {/* Link context menu */}
      {linkMenu && (() => {
        const l = topology.links.find((x: any) => x.id === linkMenu.linkId);
        if (!l) return null;
        // Default: place the menu's top-left at the cursor.
        // If it would overflow the right edge, flip to the left of the cursor.
        // If it would overflow the bottom edge, flip above the cursor.
        const MW = 240, MH = 380, margin = 6;
        let left = linkMenu.x;
        let top = linkMenu.y;
        if (left + MW + margin > window.innerWidth)  left = linkMenu.x - MW;
        if (top  + MH + margin > window.innerHeight) top  = linkMenu.y - MH;
        if (left < margin) left = margin;
        if (top  < margin) top  = margin;
        return (
          <div onContextMenu={(e) => e.preventDefault()}
            style={{ position: "fixed", left, top, background: t.bg, border: `1px solid ${t.border}`, borderRadius: 10, padding: 4, zIndex: 9000, minWidth: 220, maxWidth: MW, boxShadow: "0 12px 32px rgba(0,0,0,0.5)" }}>
            <div style={{ padding: "5px 12px", color: t.muted, fontSize: 10, fontFamily: t.monoFont, textTransform: "uppercase", letterSpacing: "0.06em", borderBottom: `1px solid ${t.border}40` }}>
              Link · {l.type}
            </div>
            {(["ethernet", "wifi", "vpn", "trunk", "wan", "docker"] as const).map(typ => (
              <button key={typ} onClick={async (e) => {
                e.stopPropagation();
                await api.updateLink(l.id, { type: typ });
                await refreshTopology();
                setLinkMenu(null);
              }}
                style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "6px 12px", background: l.type === typ ? t.surfaceHover : "transparent", border: "none", color: l.type === typ ? t.primary : t.txt, fontFamily: t.font, fontSize: 12, cursor: "pointer", borderRadius: 4, textAlign: "left" }}>
                <svg width="32" height="3"><line x1={0} y1={1.5} x2={32} y2={1.5} stroke={LINK_STYLES[typ].color(t)} strokeWidth={2} strokeDasharray={LINK_STYLES[typ].dash}/></svg>
                Set type: {typ}
              </button>
            ))}
            <div style={{ borderTop: `1px solid ${t.border}40`, marginTop: 4, paddingTop: 4 }}>
              <button onClick={async (e) => {
                e.stopPropagation();
                await api.reverseLink(l.id);
                await refreshTopology();
                setLinkMenu(null);
              }}
                style={{ display: "block", width: "100%", padding: "6px 12px", background: "transparent", border: "none", color: t.txt, fontFamily: t.font, fontSize: 12, cursor: "pointer", borderRadius: 4, textAlign: "left" }}>
                ⇄ Reverse direction
              </button>
              <button onClick={async (e) => {
                e.stopPropagation();
                await api.deleteLink(l.id); await refreshTopology(); setLinkMenu(null); setSelectedLinkId(null);
              }}
                style={{ display: "block", width: "100%", padding: "6px 12px", background: "transparent", border: "none", color: t.err, fontFamily: t.font, fontSize: 12, cursor: "pointer", borderRadius: 4, textAlign: "left" }}>
                ✕ Delete link
              </button>
            </div>
          </div>
        );
      })()}

      {/* Add manual device modal */}
      {adding && (
        <AddDeviceModal t={t} onClose={() => setAdding(false)}
          onSaved={async () => {
            await useStore.getState().refreshDevices();
            setAdding(false);
          }}/>
      )}
    </div>
  );
}

function ToolBtn({ t, onClick, children }: any) {
  return (
    <button onClick={(e) => { e.stopPropagation(); onClick(); }}
      style={{ background: t.panel, border: `1px solid ${t.border}`, color: t.txt, padding: "6px 12px", borderRadius: t.radius, fontSize: 11, cursor: "pointer", fontFamily: t.monoFont, backdropFilter: t.blur }}>
      {children}
    </button>
  );
}

// ─── Zone Editor Modal ────────────────────────────────────────────────────
function ZoneEditor({ t, zone, onSave, onClose }: any) {
  const [name, setName] = useState<string>(zone.name || "");
  const [color, setColor] = useState<string>(zone.color || ZONE_PALETTE[0]);
  const [strokeStyle, setStrokeStyle] = useState<string>(zone.strokeStyle || "dashed");
  const [strokeWidth, setStrokeWidth] = useState<number>(zone.strokeWidth || 2);
  const [opacity, setOpacity] = useState<number>(zone.opacity ?? 0.10);
  const [width, setWidth] = useState<number>(zone.width || 400);
  const [height, setHeight] = useState<number>(zone.height || 200);

  const submit = () => {
    onSave({
      name, color, x: zone.x, y: zone.y, width, height,
      // backend stores extra metadata in `notes` JSON
      notes: JSON.stringify({ strokeStyle, strokeWidth, opacity }),
    });
  };

  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, zIndex: 9500,
      background: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)",
      display: "flex", alignItems: "center", justifyContent: "center", padding: 20,
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        width: 520, maxWidth: "100%",
        background: t.bg, border: `1px solid ${t.border}`,
        borderRadius: 14, padding: 0, overflow: "hidden",
      }}>
        {/* Header */}
        <div style={{ padding: "14px 20px", borderBottom: `1px solid ${t.border}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ color: t.txt, fontFamily: t.headFont, fontWeight: 600, fontSize: 16 }}>
            {zone.isNew ? "New zone" : `Edit zone`}
          </div>
          <button onClick={onClose} style={{ background: t.surface, border: `1px solid ${t.border}`, color: t.muted, borderRadius: 6, padding: "4px 9px", cursor: "pointer", fontSize: 14 }}>✕</button>
        </div>

        <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 16 }}>
          {/* Live preview */}
          <div style={{ height: 100, background: t.surface, borderRadius: 8, border: `1px solid ${t.border}`, padding: 14, position: "relative" }}>
            <svg width="100%" height="100%" viewBox="0 0 460 70" preserveAspectRatio="none">
              <rect x={2} y={2} width={456} height={66} rx={10}
                fill={hexWithAlpha(color, opacity)}
                stroke={color}
                strokeWidth={strokeWidth}
                strokeDasharray={STROKE_PATTERNS[strokeStyle] || STROKE_PATTERNS.dashed}/>
              <text x={16} y={40} fill={color} fontSize={18} fontFamily={t.headFont} fontWeight={700}>
                {name || "Zone preview"}
              </text>
            </svg>
          </div>

          {/* Name */}
          <div>
            <Label t={t}>Name</Label>
            <input value={name} onChange={(e) => setName(e.target.value)}
              style={ipt(t)} placeholder="Living Room"/>
          </div>

          {/* Color palette */}
          <div>
            <Label t={t}>Color</Label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 4 }}>
              {ZONE_PALETTE.map(c => (
                <button key={c} onClick={() => setColor(c)} style={{
                  width: 30, height: 30, borderRadius: 8, cursor: "pointer",
                  background: c,
                  border: `2px solid ${color === c ? t.txt : "transparent"}`,
                  boxShadow: color === c ? `0 0 0 1px ${t.bg}, 0 0 0 3px ${c}80` : "none",
                  transition: "transform 0.1s",
                  transform: color === c ? "scale(1.05)" : "none",
                }}/>
              ))}
              <input type="color" value={color} onChange={(e) => setColor(e.target.value)}
                style={{ width: 30, height: 30, padding: 0, border: `1px solid ${t.border}`, borderRadius: 8, cursor: "pointer", background: "transparent" }}
                title="Custom color"/>
            </div>
          </div>

          {/* Border style */}
          <div>
            <Label t={t}>Border style</Label>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 4 }}>
              {Object.entries(STROKE_PATTERNS).map(([k, v]) => (
                <button key={k} onClick={() => setStrokeStyle(k)} style={{
                  padding: "8px 12px",
                  background: strokeStyle === k ? `${color}20` : t.surface,
                  border: `1px solid ${strokeStyle === k ? color : t.border}`,
                  color: strokeStyle === k ? color : t.txt,
                  borderRadius: 7, cursor: "pointer",
                  fontFamily: t.monoFont, fontSize: 11,
                  display: "flex", flexDirection: "column", alignItems: "center", gap: 4,
                  minWidth: 70,
                }}>
                  <svg width="48" height="6">
                    <line x1={2} y1={3} x2={46} y2={3} stroke={color} strokeWidth={2} strokeDasharray={v}/>
                  </svg>
                  <span style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.04em" }}>{k}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Stroke width + opacity sliders */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            <div>
              <Label t={t}>Border width — {strokeWidth}px</Label>
              <input type="range" min={1} max={6} step={1} value={strokeWidth}
                onChange={(e) => setStrokeWidth(parseInt(e.target.value))} style={{ width: "100%" }}/>
            </div>
            <div>
              <Label t={t}>Fill opacity — {Math.round(opacity * 100)}%</Label>
              <input type="range" min={0} max={50} step={1} value={Math.round(opacity * 100)}
                onChange={(e) => setOpacity(parseInt(e.target.value) / 100)} style={{ width: "100%" }}/>
            </div>
          </div>

          {/* Size */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            <div>
              <Label t={t}>Width</Label>
              <input type="number" min={40} value={Math.round(width)} onChange={(e) => setWidth(parseInt(e.target.value) || 40)} style={ipt(t)}/>
            </div>
            <div>
              <Label t={t}>Height</Label>
              <input type="number" min={40} value={Math.round(height)} onChange={(e) => setHeight(parseInt(e.target.value) || 40)} style={ipt(t)}/>
            </div>
          </div>
        </div>

        <div style={{ padding: "14px 20px", borderTop: `1px solid ${t.border}`, display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button onClick={onClose} style={{ background: t.surface, border: `1px solid ${t.border}`, color: t.txt, padding: "8px 16px", borderRadius: 7, cursor: "pointer", fontFamily: t.headFont, fontSize: 12 }}>Cancel</button>
          <button onClick={submit} disabled={!name} style={{ background: t.grad, border: "none", color: t.onPrimary, padding: "8px 18px", borderRadius: 7, cursor: name ? "pointer" : "not-allowed", fontFamily: t.headFont, fontSize: 12, fontWeight: 700, opacity: name ? 1 : 0.5 }}>{zone.isNew ? "Create zone" : "Save changes"}</button>
        </div>
      </div>
    </div>
  );
}

function Label({ t, children }: any) {
  return <div style={{ color: t.muted, fontSize: 9.5, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600, fontFamily: t.monoFont, marginBottom: 4 }}>{children}</div>;
}
function ipt(t: any): any {
  return { width: "100%", background: t.surface, border: `1px solid ${t.border}`, color: t.txt, padding: "8px 12px", borderRadius: 7, fontSize: 12.5, fontFamily: t.monoFont, outline: "none" };
}

// ─── Add Manual Device Modal ──────────────────────────────────────────────
const MANUAL_TYPES = [
  { value: "router",   emoji: "🌐", label: "Router" },
  { value: "switch",   emoji: "🔀", label: "Switch" },
  { value: "ap",       emoji: "📡", label: "Access Point" },
  { value: "firewall", emoji: "🛡", label: "Firewall" },
  { value: "server",   emoji: "🖥️", label: "Server / NAS" },
  { value: "laptop",   emoji: "💻", label: "Laptop / Desktop" },
  { value: "phone",    emoji: "📱", label: "Phone" },
  { value: "printer",  emoji: "🖨", label: "Printer" },
  { value: "camera",   emoji: "📷", label: "Camera" },
  { value: "tv",       emoji: "📺", label: "TV / Media" },
  { value: "console",  emoji: "🎮", label: "Console" },
  { value: "iot",      emoji: "⚡", label: "IoT" },
  { value: "vm",       emoji: "📦", label: "VM" },
  { value: "container",emoji: "🐳", label: "Container" },
  { value: "unknown",  emoji: "❓", label: "Unknown" },
];

function AddDeviceModal({ t, onClose, onSaved }: { t: any; onClose: () => void; onSaved: () => Promise<void> }) {
  const [form, setForm] = useState<any>({
    customName: "", type: "switch", vendor: "", model: "",
    ip: "", mac: "", hostname: "", notes: "",
  });
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!form.customName) return alert("Name is required");
    setBusy(true);
    try {
      await api.createManualDevice({
        customName: form.customName,
        hostname: form.hostname || null,
        ip: form.ip || null,
        mac: form.mac || null,
        vendor: form.vendor || null,
        model: form.model || null,
        type: form.type,
        customType: form.type,
        notes: form.notes || null,
      });
      await onSaved();
    } catch (e: any) { alert(e.message); }
    finally { setBusy(false); }
  };

  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, zIndex: 9500, background: "rgba(0,0,0,0.7)",
      backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20,
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        width: 540, maxWidth: "100%", background: t.bg, border: `1px solid ${t.border}`,
        borderRadius: 14, padding: 0, overflow: "hidden",
      }}>
        <div style={{ padding: "14px 20px", borderBottom: `1px solid ${t.border}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ color: t.txt, fontFamily: t.headFont, fontWeight: 600, fontSize: 16 }}>
            Add device manually
          </div>
          <button onClick={onClose} style={{ background: t.surface, border: `1px solid ${t.border}`, color: t.muted, borderRadius: 6, padding: "4px 9px", cursor: "pointer", fontSize: 14 }}>✕</button>
        </div>

        <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ color: t.muted, fontSize: 12, lineHeight: 1.6 }}>
            Use this for devices that don't show up in scans (managed switches, isolated APs, equipment behind NAT…).
            Just give it a name and type. IP and MAC are optional.
          </div>

          {/* Type picker — visual */}
          <div>
            <Label t={t}>Type</Label>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(96px, 1fr))", gap: 6, marginTop: 4 }}>
              {MANUAL_TYPES.map(typ => (
                <button key={typ.value} onClick={() => setForm({ ...form, type: typ.value })} style={{
                  padding: "10px 6px",
                  background: form.type === typ.value ? `${t.primary}20` : t.surface,
                  border: `1px solid ${form.type === typ.value ? t.primary : t.border}`,
                  color: form.type === typ.value ? t.primary : t.txt,
                  borderRadius: 7, cursor: "pointer", fontFamily: t.font, fontSize: 11,
                  display: "flex", flexDirection: "column", alignItems: "center", gap: 4,
                }}>
                  <span style={{ fontSize: 22 }}>{typ.emoji}</span>
                  <span>{typ.label}</span>
                </button>
              ))}
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div>
              <Label t={t}>Name <span style={{ color: t.err }}>*</span></Label>
              <input value={form.customName} onChange={(e) => setForm({ ...form, customName: e.target.value })} placeholder="e.g. Garage Switch" style={ipt(t)}/>
            </div>
            <div>
              <Label t={t}>Hostname</Label>
              <input value={form.hostname} onChange={(e) => setForm({ ...form, hostname: e.target.value })} placeholder="optional" style={ipt(t)}/>
            </div>
            <div>
              <Label t={t}>IP address</Label>
              <input value={form.ip} onChange={(e) => setForm({ ...form, ip: e.target.value })} placeholder="optional" style={ipt(t)}/>
            </div>
            <div>
              <Label t={t}>MAC address</Label>
              <input value={form.mac} onChange={(e) => setForm({ ...form, mac: e.target.value })} placeholder="optional" style={ipt(t)}/>
            </div>
            <div>
              <Label t={t}>Vendor</Label>
              <input value={form.vendor} onChange={(e) => setForm({ ...form, vendor: e.target.value })} placeholder="e.g. Cisco" style={ipt(t)}/>
            </div>
            <div>
              <Label t={t}>Model</Label>
              <input value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} placeholder="e.g. Catalyst 2960" style={ipt(t)}/>
            </div>
          </div>

          <div>
            <Label t={t}>Notes</Label>
            <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2}
              style={{ ...ipt(t), resize: "vertical" }}/>
          </div>
        </div>

        <div style={{ padding: "14px 20px", borderTop: `1px solid ${t.border}`, display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button onClick={onClose} style={{ background: t.surface, border: `1px solid ${t.border}`, color: t.txt, padding: "8px 16px", borderRadius: 7, cursor: "pointer", fontFamily: t.headFont, fontSize: 12 }}>Cancel</button>
          <button onClick={submit} disabled={busy || !form.customName}
            style={{ background: t.grad, border: "none", color: t.onPrimary, padding: "8px 18px", borderRadius: 7, cursor: (busy || !form.customName) ? "not-allowed" : "pointer", fontFamily: t.headFont, fontSize: 12, fontWeight: 700, opacity: (busy || !form.customName) ? 0.5 : 1 }}>
            {busy ? "Adding…" : "Add device"}
          </button>
        </div>
      </div>
    </div>
  );
}
