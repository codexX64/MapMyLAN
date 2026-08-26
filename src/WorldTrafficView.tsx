// Trafic mondial.
//
// Un globe orthographique dessiné en canvas pur, sans dépendance : les
// continents sont une grille de points comprimée et embarquée, chaque flux
// sortant de la maison est un arc de grand cercle réel vers les coordonnées du
// service, et le logo affiché à côté de chaque ligne du journal est récupéré
// depuis le domaine du service — c'est le seul "scraping" qui a lieu, aucune
// image n'est stockée dans le projet.
//
// Reprend exactement les tokens de MapMyLAN (papier, encre, accent, pictos)
// pour que cette vue ne se distingue pas visuellement du reste de l'app.

import { useEffect, useRef, useState } from "react";
import { Icon, deviceIcon } from "../../lib/icons";
import { translate as tr } from "../../lib/i18n";

// ── Grille terrestre ──────────────────────────────────────────────────────
// 73 lignes × 180 colonnes (pas de 2°), comprimée en paires [symbole, longueur]
// sur un alphabet strictement alphanumérique — un antislash dans la chaîne
// romprait le littéral JS et viderait la page, d'où ce choix.
const GRILLE_COMP =
  "MZMZMTS0MZM6T8MZMDS0MZM2TdMZMCS0MZM0TgMZMBS0MYTiMUT6MzS0MZThMNTkMsS0MZTgMHTLM8S0M9T9MGTdMETZS0M7TqM7T9MaT9MnT6M8TZT3S0M6TLM8T8MmT9M3TZT7S0M6TNM7T5M8T1McT9M0TZT4M6S0M7TOM6T3MnTaM0TZT2M8S0MfTHMxT9M0TXMeS0MmTBMqTeM0TVMhS0MnTBMpTdM2TTMiS0MoTAMmT1M0TbM5TSMiS0MpTAMlT1M0TbM5TRMjS0MqTyMpTbM5TQMkS0MrTvMtTcM2TPMlS0MrTuMuTdM1TOMmS0MrTsMwT3M2T7M4TJMnS0MrTqMuT5M6T5M6T2M0T1M8TrM5T0MhS0MsTpMuT4M9T0MdT5M5ToMqS0MsToMvT3MkTbM5TlM8T0MiS0MtTmMzT7MfT9M6TkM7T0MjS0MuTlMxTbMdT9M6TkM4T0MmS0MvTjMxTdMdT8M6TkM3T0MnS0MwThMxTlM7T6M3T3M2ThMsS0MxT8M2T4MwTnM8T4M2T6M1TfMtS0MyT6M4T2MxToM9T2M2ToMtS0MzT3M7T0MxTpM9T0M3TaM0TcMuS0MZMkTpMfTlMwS0MZMjTrMfT6M4T5MzS0MZMjTrMfT5M6T4MzS0MGT4MxTrMgT2M8T5MyS0MIT3MwTsMfT2M9T4MyS0MKT2MwTsMfT1MaT3MyS0MLT2M1T7MmTsM1T0MbT1MaT1MAS0MMTdMlTtMpT1MAS0MNTdMlTsMpT1MAS0MOTdMkT0M7TjMZM2S0MOTdMtTiMZM3S0MOTdMtThMZM4S0MOTgMqTfMZM6S0MNTjMoTfMZM6S0MOTjMnTfMZM6S0MPTkMmTeMZM6S0MPTjMnTdMZM7S0MQTiMnTdMIT2M0T2MhS0MRTgMoTcM2T2MBT9MgS0MRTgMoTcM2T2MATaMgS0MSTeMqTaM3T2MzTcMfS0MSTeMqTaM4T1MxTfMeS0MSTeMqT9M5T1MvTiMdS0MSTcMtT8MDTjMcS0MSTaMvT8MDTjMcS0MSTaMwT6METjMcS0MST9MxT6METjMcS0MST9MyT4MFTiMdS0MST8MzT1MKT1M7T6MdS0MRT8MZMyT5M9T0M2S0MRT6MZMBT2MbT1M1S0MRT4MZMST1M1S0MRT4MZMST0M2S0MQT4MZMST0M3S0MQT4MZMQT1M4S0MQT3MZMYS0MRT2MZMYS0MRT1MZMZS0MRT0MZMZM0S0MZMZMTS0MZMZMTS0MZMZMT";
const ALPHA = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
const SYM: Record<string, string> = { T: "1", M: "0", S: "|" };

function decomprime(c: string): string {
  let out = "";
  for (let i = 0; i < c.length; i += 2) out += SYM[c[i]].repeat(ALPHA.indexOf(c[i + 1]) + 1);
  return out;
}

interface Pt3 { x: number; y: number; z: number; }
function vec(lat: number, lon: number): Pt3 & { lat: number; lon: number } {
  const a = (lat * Math.PI) / 180, b = (lon * Math.PI) / 180;
  return { x: Math.cos(a) * Math.cos(b), y: Math.sin(a), z: Math.cos(a) * Math.sin(b), lat, lon };
}

let terreCache: Pt3[] | null = null;
function terre(): Pt3[] {
  if (terreCache) return terreCache;
  const lignes = decomprime(GRILLE_COMP).split("|");
  const pts: Pt3[] = [];
  lignes.forEach((ligne, li) => {
    const lat = 84 - li * 2;
    for (let ci = 0; ci < ligne.length; ci++) {
      if (ligne[ci] !== "1") continue;
      if (Math.abs(lat) > 60 && ci % 2) continue;
      pts.push(vec(lat, -180 + ci * 2));
    }
  });
  terreCache = pts;
  return pts;
}

// ── Services : domaine réel → logo scrappé automatiquement ────────────────
const SERVICES = [
  { n: "Google", d: "google.com", lat: 37.4, lon: -122.1, ville: "Mountain View" },
  { n: "Apple", d: "apple.com", lat: 37.3, lon: -122.0, ville: "Cupertino" },
  { n: "iCloud", d: "icloud.com", lat: 35.9, lon: -78.9, ville: "Maiden" },
  { n: "Meta", d: "facebook.com", lat: 37.5, lon: -122.2, ville: "Menlo Park" },
  { n: "Instagram", d: "instagram.com", lat: 37.5, lon: -122.2, ville: "Menlo Park" },
  { n: "Microsoft Teams", d: "microsoft.com", lat: 47.6, lon: -122.1, ville: "Redmond" },
  { n: "Outlook", d: "outlook.com", lat: 47.6, lon: -122.1, ville: "Redmond" },
  { n: "GitHub", d: "github.com", lat: 37.8, lon: -122.4, ville: "San Francisco" },
  { n: "Cloudflare", d: "cloudflare.com", lat: 37.8, lon: -122.4, ville: "San Francisco" },
  { n: "Netflix", d: "netflix.com", lat: 37.4, lon: -121.9, ville: "Los Gatos" },
  { n: "YouTube", d: "youtube.com", lat: 37.4, lon: -122.1, ville: "San Bruno" },
  { n: "Discord", d: "discord.com", lat: 37.8, lon: -122.4, ville: "San Francisco" },
  { n: "Spotify", d: "spotify.com", lat: 59.3, lon: 18.1, ville: "Stockholm" },
  { n: "Steam", d: "steampowered.com", lat: 47.6, lon: -122.3, ville: "Seattle" },
  { n: "Amazon AWS", d: "aws.amazon.com", lat: 53.3, lon: -6.2, ville: "Dublin" },
  { n: "OVHcloud", d: "ovhcloud.com", lat: 50.7, lon: 3.2, ville: "Roubaix" },
  { n: "Thunderbird", d: "thunderbird.net", lat: 50.7, lon: 3.2, ville: "Roubaix" },
  { n: "Telegram", d: "telegram.org", lat: 52.4, lon: 4.9, ville: "Amsterdam" },
  { n: "WhatsApp", d: "whatsapp.com", lat: 37.5, lon: -122.2, ville: "Menlo Park" },
  { n: "Ubiquiti", d: "ui.com", lat: 40.7, lon: -74.0, ville: "New York" },
  { n: "Docker Hub", d: "docker.com", lat: 37.8, lon: -122.4, ville: "San Francisco" },
  { n: "npm", d: "npmjs.com", lat: 40.7, lon: -74.0, ville: "New York" },
  { n: "Debian", d: "debian.org", lat: 48.9, lon: 2.3, ville: "Paris" },
  { n: "Anthropic", d: "anthropic.com", lat: 37.8, lon: -122.4, ville: "San Francisco" },
  { n: "Wikipedia", d: "wikipedia.org", lat: 37.8, lon: -122.4, ville: "San Francisco" },
  { n: "Leboncoin", d: "leboncoin.fr", lat: 48.9, lon: 2.3, ville: "Paris" },
  { n: "Free", d: "free.fr", lat: 48.9, lon: 2.3, ville: "Paris" },
  { n: "Alibaba", d: "alibaba.com", lat: 30.3, lon: 120.2, ville: "Hangzhou" },
  { n: "Tuya Cloud", d: "tuya.com", lat: 30.3, lon: 120.2, ville: "Hangzhou" },
  { n: "Yandex", d: "yandex.com", lat: 55.8, lon: 37.6, ville: "Moscou" },
  { n: "Naver", d: "naver.com", lat: 37.6, lon: 127.0, ville: "Séoul" },
  { n: "Fastly", d: "fastly.com", lat: -33.9, lon: 151.2, ville: "Sydney" },
];

const APPAREILS = [
  { n: "Poste de travail", ip: "198.51.100.131", t: "laptop" },
  { n: "Serveur Docker", ip: "192.0.2.10", t: "server" },
  { n: "Serveur d'inférence", ip: "192.0.2.30", t: "server" },
  { n: "Mobile", ip: "198.51.100.204", t: "phone" },
  { n: "Passerelle", ip: "192.0.2.1", t: "router" },
  { n: "Borne sans fil", ip: "192.0.2.2", t: "ap" },
  { n: "prise-connectee", ip: "198.51.100.23", t: "iot" },
  { n: "camera-exterieure", ip: "198.51.100.41", t: "camera" },
  { n: "nano-serveur", ip: "198.51.100.77", t: "pi" },
];

const MAISON = vec(48.86, 2.35);
const PROTOS = ["HTTPS", "QUIC", "HTTPS", "TLS", "HTTPS", "DoH", "WSS"];

// ── Logos : pastille locale, aucun appel réseau ───────────────────────────
//
// L'ancienne version chargeait le favicon depuis Google (s2/favicons), ce qui
// envoyait à un tiers la liste des domaines affichés et l'adresse IP du visiteur
// — exactement à rebours de la promesse « rien ne quitte le navigateur ». On
// dessine désormais une pastille à l'initiale, teintée de façon déterministe à
// partir du nom : lisible, cohérente, et strictement locale.
function couleurDeterministe(nom: string): string {
  let h = 0;
  for (let i = 0; i < nom.length; i++) h = (h * 31 + nom.charCodeAt(i)) >>> 0;
  return `hsl(${h % 360} 45% 55%)`;
}

function LogoService({ svc, size = 22 }: { svc: (typeof SERVICES)[number]; size?: number }) {
  return (
    <span style={{
      width: size, height: size, borderRadius: size * 0.28, flex: "none",
      background: "var(--mml-well)", display: "flex", alignItems: "center",
      justifyContent: "center", overflow: "hidden",
    }}>
      <span style={{
        width: size * 0.72, height: size * 0.72, borderRadius: size * 0.2,
        display: "flex", alignItems: "center", justifyContent: "center",
        background: couleurDeterministe(svc.n), color: "#fff",
        fontSize: size * 0.42, fontWeight: 700,
      }}>
        {(svc.n[0] || "?").toUpperCase()}
      </span>
    </span>
  );
}

// ── Le composant ────────────────────────────────────────────────────────
interface Flux {
  pts: Pt3[];
  t0: number;
  duree: number;
  bloque: boolean;
}
interface Ligne {
  id: number;
  svc: (typeof SERVICES)[number];
  dev: (typeof APPAREILS)[number];
  ko: number;
  bloque: boolean;
  proto: string;
}

export function WorldTrafficView({ t }: { t: any }) {
  const cvRef = useRef<HTMLCanvasElement>(null);
  const fluxRef = useRef<Flux[]>([]);
  const rotRef = useRef(-0.6);
  const dimRef = useRef({ W: 0, H: 0, R: 0, CX: 0, CY: 0 });
  const rafRef = useRef(0);

  const [lignes, setLignes] = useState<Ligne[]>([]);
  const [kFlux, setKFlux] = useState(0);
  const [kDest, setKDest] = useState(0);
  const [kDeb, setKDeb] = useState(0);
  const [kBlo, setKBlo] = useState(0);
  const [vol, setVol] = useState(0);
  const statsSvc = useRef(new Map<string, number>());
  const statsDev = useRef(new Map<string, number>());
  const [, force] = useState(0);
  const compteurRef = useRef(0);
  const debitRef = useRef(0);
  const idRef = useRef(0);

  // ── injection CSS ponctuelle : variables locales pour LogoService ──────
  useEffect(() => {
    const s = document.createElement("style");
    s.textContent = `:root{--mml-well:${t.well};--mml-muted:${t.muted}}
      @keyframes mml-entre{from{opacity:0;transform:translateX(-8px)}to{opacity:1;transform:none}}`;
    document.head.appendChild(s);
    return () => { document.head.removeChild(s); };
  }, [t.well, t.muted]);

  // ── arc de grand cercle, soulevé au-dessus de la surface ────────────────
  function arc(a: Pt3, b: Pt3, n = 46): Pt3[] {
    const dot = Math.max(-1, Math.min(1, a.x * b.x + a.y * b.y + a.z * b.z));
    const ang = Math.acos(dot);
    const alt = 0.13 + 0.3 * (ang / Math.PI);
    const pts: Pt3[] = [];
    for (let i = 0; i <= n; i++) {
      const p = i / n;
      const s = Math.sin(ang) < 1e-6 ? 1 : Math.sin(ang);
      const c1 = Math.sin((1 - p) * ang) / s, c2 = Math.sin(p * ang) / s;
      const x = a.x * c1 + b.x * c2, y = a.y * c1 + b.y * c2, z = a.z * c1 + b.z * c2;
      const m = Math.hypot(x, y, z) || 1;
      const h = 1 + alt * Math.sin(Math.PI * p);
      pts.push({ x: (x / m) * h, y: (y / m) * h, z: (z / m) * h });
    }
    return pts;
  }

  const INCL = 0.36;
  function projette(p: Pt3, rot: number) {
    const c = Math.cos(rot), sn = Math.sin(rot);
    const tx = p.x * c - p.z * sn, ty = p.y, tz = p.x * sn + p.z * c;
    const ci = Math.cos(INCL), si = Math.sin(INCL);
    const qy = ty * ci - tz * si, qz = ty * si + tz * ci;
    const { CX, CY, R } = dimRef.current;
    return { x: CX + tx * R, y: CY - qy * R, z: qz };
  }

  // ── dessin ────────────────────────────────────────────────────────────
  function dessine() {
    const cv = cvRef.current;
    if (!cv) return;
    const { W, H, R, CX, CY } = dimRef.current;
    if (W < 2 || H < 2) { mesurer(); rafRef.current = requestAnimationFrame(dessine); return; }
    const ctx = cv.getContext("2d")!;
    ctx.clearRect(0, 0, W, H);

    const halo = ctx.createRadialGradient(CX, CY, R * 0.75, CX, CY, R * 1.5);
    halo.addColorStop(0, hexA(t.primary, 0.10));
    halo.addColorStop(1, hexA(t.primary, 0));
    ctx.fillStyle = halo;
    ctx.beginPath(); ctx.arc(CX, CY, R * 1.5, 0, 6.2832); ctx.fill();

    ctx.fillStyle = t.id === "dark" ? "#14161A" : "#FFFFFF";
    ctx.beginPath(); ctx.arc(CX, CY, R, 0, 6.2832); ctx.fill();
    ctx.strokeStyle = hexA(t.primary, 0.18); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(CX, CY, R, 0, 6.2832); ctx.stroke();

    const rot = rotRef.current;
    for (const p of terre()) {
      const q = projette(p, rot);
      if (q.z <= 0.02) continue;
      const a = 0.16 + q.z * 0.42;
      ctx.fillStyle = hexA(t.txtSoft, a);
      ctx.beginPath(); ctx.arc(q.x, q.y, 0.75 + q.z * 0.7, 0, 6.2832); ctx.fill();
    }

    const now = performance.now();
    const arr = fluxRef.current;
    for (let i = arr.length - 1; i >= 0; i--) {
      const f = arr[i];
      const age = (now - f.t0) / f.duree;
      if (age > 1.25) { arr.splice(i, 1); continue; }
      const pts = f.pts.map(p => projette(p, rot));
      const av = Math.min(1, age * 1.5);
      const fin = Math.floor(pts.length * av);
      const coul = f.bloque ? t.err : t.primary;
      const fade = age > 1 ? Math.max(0, 1 - (age - 1) * 4) : 1;

      ctx.lineWidth = 1.2;
      ctx.beginPath();
      let ouvert = false;
      for (let k = 0; k < fin; k++) {
        const p = pts[k];
        if (p.z < -0.15) { ouvert = false; continue; }
        if (!ouvert) { ctx.moveTo(p.x, p.y); ouvert = true; } else ctx.lineTo(p.x, p.y);
      }
      ctx.strokeStyle = hexA(coul, 0.6 * fade);
      ctx.stroke();

      if (fin > 0 && fin < pts.length) {
        const p = pts[fin - 1];
        if (p.z > -0.15) {
          ctx.fillStyle = hexA(coul, 0.95);
          ctx.beginPath(); ctx.arc(p.x, p.y, 2.2, 0, 6.2832); ctx.fill();
          ctx.fillStyle = hexA(coul, 0.22);
          ctx.beginPath(); ctx.arc(p.x, p.y, 6, 0, 6.2832); ctx.fill();
        }
      }
      if (av >= 1) {
        const p = pts[pts.length - 1];
        if (p.z > -0.05) {
          ctx.fillStyle = hexA(coul, 0.9 * fade);
          ctx.beginPath(); ctx.arc(p.x, p.y, 2.4, 0, 6.2832); ctx.fill();
          ctx.strokeStyle = hexA(coul, 0.32 * fade);
          ctx.beginPath(); ctx.arc(p.x, p.y, 5 + age * 5, 0, 6.2832); ctx.stroke();
        }
      }
    }

    const m = projette(MAISON, rot);
    if (m.z > -0.05) {
      const pl = 3 + Math.sin(now / 380) * 1.2;
      ctx.fillStyle = hexA(t.primary, 0.18);
      ctx.beginPath(); ctx.arc(m.x, m.y, pl + 7, 0, 6.2832); ctx.fill();
      ctx.fillStyle = t.primary;
      ctx.beginPath(); ctx.arc(m.x, m.y, 3.2, 0, 6.2832); ctx.fill();
    }

    rotRef.current += 0.0013;
    rafRef.current = requestAnimationFrame(dessine);
  }

  function mesurer() {
    const cv = cvRef.current;
    if (!cv) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const r = cv.getBoundingClientRect();
    cv.width = r.width * dpr; cv.height = r.height * dpr;
    const ctx = cv.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const R = Math.min(r.width, r.height) * 0.4;
    dimRef.current = { W: r.width, H: r.height, R, CX: r.width / 2, CY: r.height / 2 };
  }

  useEffect(() => {
    mesurer();
    const ro = new ResizeObserver(mesurer);
    if (cvRef.current?.parentElement) ro.observe(cvRef.current.parentElement);
    rafRef.current = requestAnimationFrame(dessine);
    return () => { ro.disconnect(); cancelAnimationFrame(rafRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t]);

  // ── simulation du trafic ────────────────────────────────────────────
  useEffect(() => {
    let vivant = true;
    function evenement() {
      if (!vivant) return;
      const svc = SERVICES[Math.floor(Math.random() * SERVICES.length)];
      const dev = APPAREILS[Math.floor(Math.random() * APPAREILS.length)];
      const suspect = (dev.t === "iot" || dev.t === "camera") &&
        ["tuya.com", "alibaba.com", "yandex.com"].includes(svc.d);
      const bloque = suspect && Math.random() < 0.75;
      const ko = Math.round(Math.random() ** 2.2 * 9000 + 40);

      statsSvc.current.set(svc.n, (statsSvc.current.get(svc.n) || 0) + ko);
      statsDev.current.set(dev.n, (statsDev.current.get(dev.n) || 0) + ko);
      compteurRef.current++;
      setVol(v => v + ko / 1024 / 1024);
      if (bloque) setKBlo(b => b + 1);

      fluxRef.current.push({
        pts: arc(MAISON, vec(svc.lat, svc.lon)),
        t0: performance.now(),
        duree: 2100 + Math.random() * 1400,
        bloque,
      });
      if (fluxRef.current.length > 42) fluxRef.current.shift();

      idRef.current++;
      setLignes(ls => {
        const suivante = [{ id: idRef.current, svc, dev, ko, bloque, proto: PROTOS[Math.floor(Math.random() * PROTOS.length)] }, ...ls];
        return suivante.slice(0, 60);
      });

      setTimeout(evenement, 170 + Math.random() * 620);
    }
    evenement();
    return () => { vivant = false; };
  }, []);

  useEffect(() => {
    const i = setInterval(() => {
      setKFlux(fluxRef.current.length);
      setKDest(statsSvc.current.size);
      debitRef.current = debitRef.current * 0.72 + compteurRef.current * 8.4 * 0.28;
      setKDeb(debitRef.current);
      compteurRef.current = 0;
      force(x => x + 1);
    }, 1000);
    return () => clearInterval(i);
  }, []);

  const topSvc = [...statsSvc.current.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  const topDev = [...statsDev.current.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  const maxSvc = topSvc[0]?.[1] || 1;
  const maxDev = topDev[0]?.[1] || 1;

  return (
    <div style={{ display: "flex", height: "100%", minHeight: 560, gap: 16, padding: "0 0 16px" }}>
      {/* journal */}
      <div style={panneau(t, 320)}>
        <PanelHead t={t} titre={tr("world.log")} valeur={`${lignes.length ? Math.min(9, lignes.length) : 0}/s`}/>
        <div style={{ flex: 1, overflowY: "auto", padding: "5px 0" }}>
          {lignes.map(l => (
            <div key={l.id} style={{
              display: "flex", alignItems: "center", gap: 9, padding: "6px 13px",
              animation: "mml-entre .32s cubic-bezier(.2,.7,.3,1)",
            }}>
              <LogoService svc={l.svc}/>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontSize: 12, fontWeight: 500, color: l.bloque ? t.err : t.txt,
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                }}>{l.bloque ? `${l.svc.n} — ${tr("world.blocked")}` : l.svc.n}</div>
                <div style={{
                  fontFamily: t.monoFont, fontSize: 10, color: t.faint, marginTop: 1,
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                }}>{l.dev.n} · {l.svc.d} · {l.svc.ville}</div>
              </div>
              <div style={{ textAlign: "right", flex: "none" }}>
                <div style={{ fontFamily: t.monoFont, fontSize: 10.5, color: t.txtSoft }}>
                  {l.ko > 1024 ? (l.ko / 1024).toFixed(1) + " Mo" : l.ko + " Ko"}
                </div>
                <div style={{ fontFamily: t.monoFont, fontSize: 9.5, color: t.faint, marginTop: 1 }}>{l.proto}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* globe */}
      <div style={{
        flex: 1, position: "relative", borderRadius: 14, overflow: "hidden",
        background: t.id === "dark"
          ? "radial-gradient(ellipse at 50% 45%, #14161A 0%, #0D0E10 62%)"
          : "radial-gradient(ellipse at 50% 45%, #FFFFFF 0%, #F1F1ED 62%)",
        boxShadow: t.lift,
      }}>
        <div style={{ position: "absolute", left: 18, top: 16, zIndex: 2 }}>
          <div style={{ fontSize: 20, fontWeight: 600, letterSpacing: "-0.03em", color: t.txt }}>
            {tr("world.title")}
          </div>
          <div style={{ fontFamily: t.monoFont, fontSize: 11, color: t.muted, marginTop: 3 }}>
            48.86 N · 2.35 E — {tr("world.origin")}
          </div>
        </div>
        <canvas ref={cvRef} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", display: "block" }}/>
        <div style={{
          position: "absolute", left: 18, bottom: 16, display: "flex", gap: 16,
          fontFamily: t.monoFont, fontSize: 10.5, color: t.muted, zIndex: 2,
        }}>
          <Legende t={t} coul={t.primary} label={tr("world.legEstab")}/>
          <Legende t={t} coul={t.err} label={tr("world.legBlocked")}/>
          <Legende t={t} coul={t.faint} label={tr("world.legLand")}/>
        </div>
      </div>

      {/* classements */}
      <div style={panneau(t, 280)}>
        <PanelHead t={t} titre={tr("world.services")} valeur={String(statsSvc.current.size)}/>
        <div style={{ padding: "9px 13px 13px", borderBottom: `1px solid ${t.hairSoft}` }}>
          {topSvc.map(([nom, v]) => {
            const svc = SERVICES.find(s => s.n === nom);
            return (
              <div key={nom} style={{ display: "flex", alignItems: "center", gap: 9, padding: "5px 0" }}>
                {svc && <LogoService svc={svc} size={20}/>}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                    <span style={{ fontSize: 12, color: t.txtSoft, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{nom}</span>
                    <span style={{ fontFamily: t.monoFont, fontSize: 10.5, color: t.muted, flex: "none" }}>
                      {v > 1024 ? (v / 1024).toFixed(1) + " Mo" : v + " Ko"}
                    </span>
                  </div>
                  <div style={{ height: 2, background: t.well, borderRadius: 2, marginTop: 4, overflow: "hidden" }}>
                    <div style={{ height: "100%", background: t.primary, borderRadius: 2, width: `${Math.round((v / maxSvc) * 100)}%`, transition: "width .6s" }}/>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <PanelHead t={t} titre={tr("world.devices")} valeur={String(statsDev.current.size)}/>
        <div style={{ padding: "9px 13px 13px" }}>
          {topDev.map(([nom, v]) => (
            <div key={nom} style={{ display: "flex", alignItems: "center", gap: 9, padding: "5px 0" }}>
              <span style={{
                width: 20, height: 20, borderRadius: 6, background: t.well, color: t.muted,
                display: "flex", alignItems: "center", justifyContent: "center", flex: "none",
              }}><Icon name={deviceIcon(APPAREILS.find(a => a.n === nom)?.t)} size={12}/></span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                  <span style={{ fontSize: 12, color: t.txtSoft, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{nom}</span>
                  <span style={{ fontFamily: t.monoFont, fontSize: 10.5, color: t.muted, flex: "none" }}>
                    {v > 1024 ? (v / 1024).toFixed(1) + " Mo" : v + " Ko"}
                  </span>
                </div>
                <div style={{ height: 2, background: t.well, borderRadius: 2, marginTop: 4, overflow: "hidden" }}>
                  <div style={{ height: "100%", background: t.txtSoft, borderRadius: 2, width: `${Math.round((v / maxDev) * 100)}%`, transition: "width .6s" }}/>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function hexA(hex: string, a: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16) || 0, g = parseInt(h.slice(2, 4), 16) || 0, b = parseInt(h.slice(4, 6), 16) || 0;
  return `rgba(${r},${g},${b},${a})`;
}

function panneau(t: any, w: number): any {
  return {
    width: w, flex: "none", background: t.surface, borderRadius: 14, boxShadow: t.lift,
    display: "flex", flexDirection: "column", overflow: "hidden",
  };
}
function PanelHead({ t, titre, valeur }: any) {
  return (
    <div style={{
      height: 34, display: "flex", alignItems: "center", justifyContent: "space-between",
      padding: "0 14px", fontSize: 10, fontWeight: 600, letterSpacing: "0.13em",
      textTransform: "uppercase", color: t.faint, borderBottom: `1px solid ${t.hairSoft}`, flex: "none",
    }}>
      <span>{titre}</span>
      <span style={{ fontFamily: t.monoFont, fontSize: 10.5, letterSpacing: 0, textTransform: "none" }}>{valeur}</span>
    </div>
  );
}
function Legende({ t, coul, label }: any) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
      <i style={{ display: "block", width: 14, height: 2, borderRadius: 2, background: coul }}/>{label}
    </div>
  );
}
