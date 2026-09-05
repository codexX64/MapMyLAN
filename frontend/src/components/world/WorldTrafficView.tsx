// Trafic mondial — connexions réellement relevées.
//
// Globe orthographique dessiné au canevas, sans dépendance : les terres sont
// un semis de points au degré et les littoraux viennent de Natural Earth.
//
// Ce qui est tracé n'est pas simulé. Toutes les quinze secondes, MapMyLAN
// demande à l'équipement réseau sa table de suivi de connexions, ne garde que
// les destinations publiques, et résout leur nom. Une destination n'apparaît
// sur le globe que si ce nom porte un code de ville reconnu — les grands
// hébergeurs nomment leurs points de présence d'après l'aéroport le plus
// proche. Les autres sont listées sans arc : on ne devine pas une position.
//
// Sans équipement enregistré, la page ne montre rien et dit pourquoi.

import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../../stores/app";
import { api } from "../../api/client";
import { Icon, deviceIcon } from "../../lib/icons";
import { useT } from "../../lib/i18n";
import { terre, traits, vec, type Point3 } from "../../lib/geo-globe";
import {
  etatTrafic, lireFlux, lireAggregats, estPrivee,
  type Connexion, type EtatTrafic,
} from "../../lib/trafic";

// Paliers du curseur : libellé, et durée de la fenêtre en millisecondes.
//
// Le curseur réglait le nombre d'arcs dessinés sur le globe, et s'appelait
// « Rétention » — le même mot que la durée de conservation du serveur, en bas
// du panneau. Deux choses différentes sous un seul nom, dont aucune ne
// répondait à la question « combien de connexions sur la période que je
// regarde ? ». C'est maintenant une vraie fenêtre de temps : le journal, les
// quatre compteurs et les deux classements décrivent tous cette période.
const PALIERS: [string, number][] = [
  ["1 h", 3_600_000],
  ["24 h", 86_400_000],
  ["7 j", 604_800_000],
  ["30 j", 2_592_000_000],
  ["tout", 0],
];

/** Nombre d'arcs gardés sur le globe. Une constante : c'est une question de
 *  lisibilité du dessin, pas un réglage de période. */
const ARCS_GARDES = 300;

// Cadence du relevé. En cas d'échec on espace, au lieu d'insister : une
// passerelle qui refuse la connexion la refusera encore trois secondes plus
// tard, et chaque tentative compte dans sa limite de connexions simultanées.
// Cadence de *lecture* de l'historique. Le relevé, lui, est fait par le
// serveur à son propre rythme : rafraîchir souvent ici ne touche pas la
// passerelle.
const PERIODE_MS = 8000;

// ─── Logos ─────────────────────────────────────────────────────────────────
//
// Un seul fournisseur ne suffit pas : chacun couvre des domaines que les
// autres ignorent. On les essaie dans l'ordre, on s'arrête à la première image
// qui charge, et on retient le résultat pour ne pas retenter le réseau. Si
// tout échoue, une pastille dont la teinte dérive du nom prend le relais.

const SOURCES = [
  (d: string) => `https://icons.duckduckgo.com/ip3/${d}.ico`,
  (d: string) => `https://www.google.com/s2/favicons?domain=${d}&sz=64`,
  (d: string) => `https://unavatar.io/${d}?fallback=false`,
  (d: string) => `https://logo.clearbit.com/${d}`,
];

const resolus = new Map<string, string | null>();

function teinte(nom: string): string {
  let h = 0;
  for (let i = 0; i < nom.length; i++) h = (h * 31 + nom.charCodeAt(i)) % 360;
  return `hsl(${h} 42% 46%)`;
}

function Logo({ domaine, taille = 22 }: { domaine?: string; taille?: number }) {
  const [url, setUrl] = useState<string | null | undefined>(() => (domaine ? resolus.get(domaine) : null));

  useEffect(() => {
    if (!domaine) { setUrl(null); return; }
    if (resolus.has(domaine)) { setUrl(resolus.get(domaine)); return; }
    let vivant = true;
    const tenter = (i: number) => {
      if (!vivant) return;
      if (i >= SOURCES.length) { resolus.set(domaine, null); setUrl(null); return; }
      const im = new Image();
      im.referrerPolicy = "no-referrer";
      im.onload = () => { if (vivant) { resolus.set(domaine, im.src); setUrl(im.src); } };
      im.onerror = () => tenter(i + 1);
      im.src = SOURCES[i](domaine);
    };
    tenter(0);
    return () => { vivant = false; };
  }, [domaine]);

  const style: any = { width: taille, height: taille, borderRadius: Math.round(taille * 0.28) };
  const etiquette = (domaine || "?")[0].toUpperCase();

  if (url) {
    return (
      <span className="lg" style={{ ...style, background: "var(--well)" }}>
        <img src={url} alt="" referrerPolicy="no-referrer"
          width={Math.round(taille * 0.68)} height={Math.round(taille * 0.68)}
          style={{ display: "block" }}/>
      </span>
    );
  }
  return (
    <span className="lg" style={{
      ...style,
      background: domaine ? teinte(domaine) : "var(--well)",
      color: domaine ? "#fff" : "var(--faint)",
      fontSize: Math.round(taille * 0.44),
    }}>{etiquette}</span>
  );
}

// ─── Géométrie ─────────────────────────────────────────────────────────────

const INCLINAISON = 0.36;

interface Vue { W: number; H: number; R: number; CX: number; CY: number }

/**
 * Projection orthographique.
 *
 * Le repère de `vec()` place l'axe x vers le méridien de Greenwich et l'axe z
 * vers 90° est. L'abscisse à l'écran suit donc le **sinus** de la longitude et
 * la profondeur son cosinus. Les intervertir retourne la Terre comme un gant,
 * l'est passant à gauche : c'était le cas dans la maquette, et donc dans la
 * première version de cette page.
 */
function projette(p: Point3, rot: number, v: Vue) {
  const c = Math.cos(rot), s = Math.sin(rot);
  const est = p.x * s + p.z * c;        // vers l'est, à droite de l'écran
  const nord = p.y;                     // vers le nord
  const face = p.x * c - p.z * s;       // vers l'observateur
  const ci = Math.cos(INCLINAISON), si = Math.sin(INCLINAISON);
  return {
    x: v.CX + est * v.R,
    y: v.CY - (nord * ci - face * si) * v.R,
    z: nord * si + face * ci,
  };
}

// Un point est caché s'il est derrière la sphère ET dans sa silhouette. Au-delà
// du disque, un point arrière reste visible : c'est le cas des arcs qui
// débordent du globe, et les couper produisait des tracés interrompus.
function visible(p: { x: number; y: number; z: number }, v: Vue): boolean {
  if (p.z >= 0) return true;
  return Math.hypot(p.x - v.CX, p.y - v.CY) > v.R;
}

/** Arc de grand cercle, bombé selon la distance parcourue. */
function arc(a: Point3, b: Point3, n = 46): Point3[] {
  const dot = Math.max(-1, Math.min(1, a.x * b.x + a.y * b.y + a.z * b.z));
  const ang = Math.acos(dot), alt = 0.13 + 0.30 * (ang / Math.PI);
  const pts: Point3[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, s = Math.sin(ang) < 1e-6 ? 1 : Math.sin(ang);
    const c1 = Math.sin((1 - t) * ang) / s, c2 = Math.sin(t * ang) / s;
    const x = a.x * c1 + b.x * c2, y = a.y * c1 + b.y * c2, z = a.z * c1 + b.z * c2;
    const m = Math.hypot(x, y, z) || 1, h = 1 + alt * Math.sin(Math.PI * t);
    pts.push({ x: (x / m) * h, y: (y / m) * h, z: (z / m) * h, lat: 0, lon: 0 });
  }
  return pts;
}

function couleurVar(nom: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(nom).trim() || "#888888";
}
function avecAlpha(hex: string, a: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16) || 0;
  const g = parseInt(h.slice(2, 4), 16) || 0;
  const b = parseInt(h.slice(4, 6), 16) || 0;
  return `rgba(${r},${g},${b},${a})`;
}

function fmtOctets(o?: number): string {
  if (!o) return "";
  if (o >= 1048576) return `${(o / 1048576).toFixed(1)} Mo`;
  if (o >= 1024) return `${(o / 1024).toFixed(1)} Ko`;
  return `${o} o`;
}

/** Nom courant d'un service d'après son port. */
function nomProto(port: number, proto: string): string {
  if (port === 443) return proto === "udp" ? "QUIC" : "HTTPS";
  if (port === 80) return "HTTP";
  if (port === 53) return "DNS";
  if (port === 853) return "DoT";
  if (port === 993) return "IMAPS";
  if (port === 587 || port === 465) return "SMTP";
  if (port === 22) return "SSH";
  if (port === 123) return "NTP";
  return `${proto.toUpperCase()} ${port}`;
}

// ─── Le composant ──────────────────────────────────────────────────────────

interface Flux {
  pts: Point3[]; t0: number; duree: number;
  /** Vrai quand le point vient du pays d'enregistrement, pas d'une ville. */
  approx?: boolean;
  /** Signalé par une règle du serveur : l'arc part au rouge. */
  alerte?: boolean;
}
interface Evenement { cle: string; quand: number; c: Connexion; appareil: string; icone: string }

export function WorldTrafficView({ t }: { t?: any }) {
  const s = useT();
  const devices = useStore((st) => st.devices);

  const cvRef = useRef<HTMLCanvasElement>(null);
  const boiteRef = useRef<HTMLDivElement>(null);
  const fluxRef = useRef<Flux[]>([]);
  const histoRef = useRef<Point3[][]>([]);
  const rotRef = useRef(-0.6);
  const vueRef = useRef<Vue>({ W: 0, H: 0, R: 0, CX: 0, CY: 0 });
  const rafRef = useRef(0);
  const retRef = useRef(200);
  const vuesRef = useRef(new Set<string>());
  // Couche permanente : un arc et un point par endroit atteint, redessinés à
  // chaque image. C'est la carte à proprement parler — la traîne animée, elle,
  // ne dit que ce qui vient de se passer.
  const endroitsRef = useRef<{ pts: Point3[]; p: Point3; approx: boolean; alerte: boolean }[]>([]);
  const maisonRef = useRef<Point3>(vec(48.86, 2.35));

  const [etat, setEtat] = useState<EtatTrafic | null>(null);
  const [chargeEncore, setChargeEncore] = useState(false);
  const [finHistorique, setFinHistorique] = useState(false);
  const dernierRef = useRef(0);          // horodatage du flux le plus récent connu
  const plusVieuxRef = useRef(0);        // horodatage du plus ancien déjà chargé
  const [evenements, setEvenements] = useState<Evenement[]>([]);
  // Fenêtre regardée : 7 jours par défaut.
  const [retention, setRetention] = useState(2);
  const fenetre = PALIERS[retention][1];
  /**
   * La même valeur, dans une référence.
   *
   * La boucle de scrutation est installée une seule fois, au montage : elle
   * emprisonne donc la fenêtre du premier rendu. Sans cette référence, changer
   * de fenêtre changeait l'étiquette et rien d'autre — le serveur continuait
   * d'être interrogé sur les sept jours d'origine, et les compteurs ne
   * bougeaient pas d'un chiffre.
   */
  const fenetreRef = useRef(fenetre);
  const depuis = fenetre ? Date.now() - fenetre : 0;
  const [origine, setOrigine] = useState({ lat: 48.86, lon: 2.35, nom: "" });
  const [age, setAge] = useState(0);

  // Point d'observation, réglable par la clé « world.origin » des réglages,
  // au format « latitude,longitude » ou « latitude,longitude,Nom ».
  useEffect(() => {
    api.settings()
      .then((r) => {
        const brut = String(r?.["world.origin"] || "").trim();
        const m = /^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*(?:,\s*(.+))?$/.exec(brut);
        if (!m) return;
        const lat = Number(m[1]), lon = Number(m[2]);
        if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return;
        maisonRef.current = vec(lat, lon);
        setOrigine({ lat, lon, nom: (m[3] || "").trim() });
      })
      .catch(() => {});
  }, []);

  // Nom d'appareil à partir de l'adresse source : ce sont les vrais hôtes du
  // parc, pas une liste d'exemple.
  const parIp = useMemo(() => {
    const m = new Map<string, { nom: string; icone: string }>();
    for (const d of devices as any[]) {
      const nom = d.customName || d.hostname || d.ip;
      const icone = deviceIcon(d.customType || d.type);
      if (d.ip) m.set(d.ip, { nom, icone });
      for (const i of d.interfaces || []) if (i.ip) m.set(i.ip, { nom, icone });
    }
    return m;
  }, [devices]);

  // Une adresse est du parc si elle est privée, ou si un appareil recensé la
  // porte : tous les réseaux n'utilisent pas les plages privées.
  const parIpRef = useRef(parIp);
  useEffect(() => { parIpRef.current = parIp; }, [parIp]);
  const estLocale = useRef((ip: string) => estPrivee(ip) || parIpRef.current.has(ip));

  // ── Source ──────────────────────────────────────────────────────────────
  //
  // Plus aucun relevé n'est fait ici : le serveur collecte en continu, on lit.
  // Deux chemins distincts — le rafraîchissement, qui ne demande que ce qui a
  // bougé depuis la dernière fois, et la descente dans l'historique, qui
  // demande ce qui est plus ancien que la ligne la plus basse déjà affichée.
  const relancerRef = useRef<() => void>(() => {});
  const [prochain, setProchain] = useState(0);
  const [nouveaux, setNouveaux] = useState<Connexion[]>([]);
  /**
   * Les totaux du serveur, sur TOUT l'historique conservé.
   *
   * Les quatre chiffres du bandeau et les deux classements de droite se
   * calculaient sur les lignes chargées par le navigateur : ils changeaient
   * donc quand on descendait la liste. Ils viennent maintenant du serveur.
   */
  const [totaux, setTotaux] = useState<{
    connexions: number;
    destinations: Connexion[];
    appareils: { src: string; octets: number }[];
  }>({ connexions: 0, destinations: [], appareils: [] });
  const totauxPourRef = useRef("");
  /** Le flux ouvert en détail, et si sa fiche a été détachée du panneau. */
  const [detail, setDetail] = useState<Connexion | null>(null);
  const [detache, setDetache] = useState(false);
  const [posFiche, setPosFiche] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  // Changer de fenêtre repart de zéro : le journal, les compteurs et les
  // classements doivent tous décrire la même période, pas un mélange. Et on
  // relance tout de suite, sans attendre le prochain tour de scrutation.
  const rafraichirRef = useRef<() => void>(() => {});
  useEffect(() => {
    fenetreRef.current = fenetre;
    dernierRef.current = 0;
    plusVieuxRef.current = 0;
    vuesRef.current.clear();
    setEvenements([]);
    setFinHistorique(false);
    totauxPourRef.current = "";
    rafraichirRef.current();
  }, [fenetre]);

  const enEvenement = (c: Connexion): Evenement => {
    const app = parIpRef.current.get(c.src);
    return {
      cle: c.cle, quand: c.dernier || Date.now(), c,
      appareil: app?.nom || c.src,
      icone: app?.icone || "unknown",
    };
  };

  // Descente dans l'historique : appelée quand le journal arrive en bas.
  const chargerPlusAncien = async () => {
    if (chargeEncore || finHistorique || !plusVieuxRef.current) return;
    setChargeEncore(true);
    try {
      const borne = fenetre ? Date.now() - fenetre : 0;
      if (borne && plusVieuxRef.current <= borne) { setFinHistorique(true); return; }
      const anciens = (await lireFlux({ limite: 500, avant: plusVieuxRef.current }))
        .filter((c) => !borne || (c.dernier || 0) > borne);
      if (anciens.length === 0) { setFinHistorique(true); return; }
      plusVieuxRef.current = Math.min(...anciens.map((c) => c.dernier || 0));
      for (const c of anciens) vuesRef.current.add(c.cle);
      setEvenements((liste) => [...liste, ...anciens.map(enEvenement)]);
    } catch { /* le serveur répondra la prochaine fois */ }
    finally { setChargeEncore(false); }
  };

  useEffect(() => {
    let vivant = true;
    let minuteur: any;

    const planifier = (delai: number) => {
      clearTimeout(minuteur);
      setProchain(Date.now() + delai);
      minuteur = setTimeout(() => { void tour(); }, delai);
    };

    const tour = async () => {
      if (!vivant) return;

      // Un onglet en arrière-plan n'a rien à afficher : on repasse plus tard.
      if (typeof document !== "undefined" && document.visibilityState === "hidden") {
        planifier(PERIODE_MS);
        return;
      }

      try {
        const e = await etatTrafic();
        if (!vivant) return;
        setEtat(e);

        // Les totaux ne sont redemandés que lorsque le nombre de flux
        // conservés a bougé : inutile de recalculer un agrégat identique
        // toutes les quinze secondes.
        // Redemandés quand le nombre de flux conservés bouge, ou quand on
        // change de fenêtre : ce sont les deux seuls cas où le résultat change.
        const f = fenetreRef.current;
        const signature = `${e?.total ?? 0}|${f}`;
        if (signature !== totauxPourRef.current) {
          totauxPourRef.current = signature;
          const borne = f ? Date.now() - f : undefined;
          lireAggregats(borne).then((t) => { if (vivant) setTotaux(t); }).catch(() => {});
        }

        if (dernierRef.current === 0) {
          // Première ouverture : on remplit le journal avec l'historique
          // récent, sans lancer d'arc — ces connexions ne sont pas nouvelles.
          // Mille, pas trois cents : le compteur affichait « 300 » quoi qu'il
          // arrive, et les quatre chiffres du bandeau ne décrivaient que ce
          // que le navigateur avait chargé — pas ce que le serveur conserve.
          const debut = await lireFlux(fenetreRef.current
            ? { limite: 1000, depuis: Date.now() - fenetreRef.current }
            : { limite: 1000 });
          if (!vivant) return;
          if (debut.length) {
            dernierRef.current = Math.max(...debut.map((c) => c.dernier || 0));
            plusVieuxRef.current = Math.min(...debut.map((c) => c.dernier || 0));
            for (const c of debut) vuesRef.current.add(c.cle);
            setEvenements(debut.map(enEvenement));

            // Le globe doit montrer l'historique dès l'ouverture, pas attendre
            // qu'une connexion nouvelle survienne. Ces trajets ne sont pas des
            // événements : ils sont posés dans la traîne, sans animation.
          } else {
            dernierRef.current = Date.now();
          }
          setNouveaux([]);
        } else {
          const frais = await lireFlux({ limite: 200, depuis: dernierRef.current });
          if (!vivant) return;
          if (frais.length) {
            dernierRef.current = Math.max(dernierRef.current, ...frais.map((c) => c.dernier || 0));
            setNouveaux(frais);
          }
        }
      } catch { /* le serveur répondra la prochaine fois */ }

      if (!vivant) return;
      planifier(PERIODE_MS);
    };

    relancerRef.current = () => {
      api.trafficCollect().catch(() => {});
      planifier(1200);
    };
    // Relancer sans déclencher de relevé : c'est ce qu'il faut au changement
    // de fenêtre, où seules les données à afficher changent.
    rafraichirRef.current = () => planifier(0);

    void tour();

    const auRetour = () => { if (document.visibilityState === "visible") planifier(0); };
    document.addEventListener("visibilitychange", auRetour);

    return () => {
      vivant = false;
      clearTimeout(minuteur);
      document.removeEventListener("visibilitychange", auRetour);
    };
  }, []);

  // Nouvelles connexions : un arc part, une ligne s'ajoute en haut du journal.
  useEffect(() => {
    if (!nouveaux.length) return;
    const inedits = nouveaux.filter((c) => !vuesRef.current.has(c.cle));
    const revus = nouveaux.filter((c) => vuesRef.current.has(c.cle));
    for (const c of nouveaux) vuesRef.current.add(c.cle);

    const v = vueRef.current;
    for (const c of nouveaux) {
      // La ville d'abord ; à défaut le pays d'enregistrement, tracé autrement.
      const cible = c.lieu || c.pays;
      if (!cible) continue;
      const approx = !c.lieu;
      const pts = arc(maisonRef.current, vec(cible.lat, cible.lon));
      const cachee = !visible(projette(pts[pts.length - 1], rotRef.current, v), v);
      fluxRef.current.push({
        pts, t0: performance.now(), approx, alerte: !!c.suspect,
        duree: (cachee ? 1300 : 2100) + Math.random() * 900,
      });
      if (fluxRef.current.length > 42) fluxRef.current.shift();
    }

    // Un flux déjà connu remonte en tête plutôt que d'être dupliqué : c'est le
    // même flux, revu — d'où le compteur de passages sur la ligne.
    const revusCles = new Set(revus.map((c) => c.cle));
    setEvenements((liste) => [
      ...nouveaux.map(enEvenement),
      ...liste.filter((e) => !revusCles.has(e.cle) && !inedits.some((c) => c.cle === e.cle)),
    ]);
  }, [nouveaux]);

  // Endroits atteints, dédoublonnés : deux cents connexions vers le même pays
  // ne tracent qu'un arc.
  useEffect(() => {
    const vus = new Map<string, { lat: number; lon: number; approx: boolean; alerte: boolean }>();
    for (const e of evenements) {
      const c = e.c;
      const p = c.lieu || c.pays;
      if (!p) continue;
      const cle = `${p.lat.toFixed(2)},${p.lon.toFixed(2)}`;
      const dejaLa = vus.get(cle);
      if (!dejaLa) vus.set(cle, { lat: p.lat, lon: p.lon, approx: !c.lieu, alerte: !!c.suspect });
      // Un seul flux signalé suffit à teindre l'endroit : mieux vaut regarder
      // un point rouge pour rien que d'en manquer un parce qu'il est noyé.
      else if (c.suspect) dejaLa.alerte = true;
    }
    endroitsRef.current = [...vus.values()].slice(0, 400).map((e) => ({
      pts: arc(maisonRef.current, vec(e.lat, e.lon)),
      p: vec(e.lat, e.lon),
      approx: e.approx,
      alerte: e.alerte,
    }));
  }, [evenements, origine]);

  // ── Dimensionnement ─────────────────────────────────────────────────────
  useEffect(() => {
    const cv = cvRef.current, boite = boiteRef.current;
    if (!cv || !boite) return;
    const mesure = () => {
      const r = boite.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      cv.width = Math.round(r.width * dpr);
      cv.height = Math.round(r.height * dpr);
      cv.style.width = `${r.width}px`;
      cv.style.height = `${r.height}px`;
      const ctx = cv.getContext("2d");
      if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      vueRef.current = {
        W: r.width, H: r.height,
        R: Math.min(r.width, r.height) * 0.4,
        CX: r.width / 2, CY: r.height / 2,
      };
    };
    mesure();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(mesure) : null;
    ro?.observe(boite);
    window.addEventListener("resize", mesure);
    return () => { ro?.disconnect(); window.removeEventListener("resize", mesure); };
  }, []);

  // ── Boucle de rendu ─────────────────────────────────────────────────────
  useEffect(() => {
    const cv = cvRef.current;
    if (!cv) return;
    let ctx: CanvasRenderingContext2D | null = null;
    try { ctx = cv.getContext("2d"); } catch { ctx = null; }
    if (!ctx) return;

    const TERRE = terre();
    const TRAITS = traits();

    const dessine = () => {
      const v = vueRef.current;
      if (v.W < 2 || v.H < 2) { rafRef.current = requestAnimationFrame(dessine); return; }
      const rot = rotRef.current;

      const accent = couleurVar("--accent");
      // Un flux signalé se dessine en rouge, arc et point. C'est la seule
      // couleur de l'écran qui veut dire « regarde ça » : on ne s'en sert
      // nulle part ailleurs.
      const alarme = couleurVar("--alarm");
      const inkSoft = couleurVar("--ink-soft");
      const surface = couleurVar("--surface");

      ctx!.clearRect(0, 0, v.W, v.H);

      const halo = ctx!.createRadialGradient(v.CX, v.CY, v.R * 0.75, v.CX, v.CY, v.R * 1.5);
      halo.addColorStop(0, avecAlpha(accent, 0.10));
      halo.addColorStop(1, avecAlpha(accent, 0));
      ctx!.fillStyle = halo;
      ctx!.beginPath(); ctx!.arc(v.CX, v.CY, v.R * 1.5, 0, 6.2832); ctx!.fill();
      ctx!.fillStyle = surface;
      ctx!.beginPath(); ctx!.arc(v.CX, v.CY, v.R, 0, 6.2832); ctx!.fill();
      ctx!.strokeStyle = avecAlpha(accent, 0.18); ctx!.lineWidth = 1;
      ctx!.beginPath(); ctx!.arc(v.CX, v.CY, v.R, 0, 6.2832); ctx!.stroke();

      for (const p of TERRE) {
        const q = projette(p, rot, v);
        if (q.z <= 0.02) continue;
        ctx!.fillStyle = avecAlpha(inkSoft, 0.10 + q.z * 0.30);
        ctx!.beginPath(); ctx!.arc(q.x, q.y, 0.7 + q.z * 0.55, 0, 6.2832); ctx!.fill();
      }

      ctx!.lineWidth = 0.85;
      ctx!.strokeStyle = avecAlpha(inkSoft, 0.42);
      for (const seg of TRAITS) {
        ctx!.beginPath();
        let ouvert = false;
        for (const p of seg) {
          const q = projette(p, rot, v);
          if (q.z <= 0.02) { ouvert = false; continue; }
          if (!ouvert) { ctx!.moveTo(q.x, q.y); ouvert = true; } else ctx!.lineTo(q.x, q.y);
        }
        ctx!.stroke();
      }

      // Couche permanente : les endroits atteints. Trait plein pour une ville
      // relevée, pointillé pour un pays d'enregistrement.
      for (const e of endroitsRef.current) {
        const teinte = e.alerte ? alarme : accent;
        ctx!.lineWidth = e.alerte ? 1.4 : e.approx ? 0.8 : 1;
        ctx!.setLineDash(e.approx ? [3, 4] : []);
        ctx!.strokeStyle = avecAlpha(teinte, e.alerte ? 0.75 : e.approx ? 0.3 : 0.48);
        ctx!.beginPath();
        let ouvert = false;
        for (const pt of e.pts) {
          const q = projette(pt, rot, v);
          if (!visible(q, v)) { ouvert = false; continue; }
          if (!ouvert) { ctx!.moveTo(q.x, q.y); ouvert = true; } else ctx!.lineTo(q.x, q.y);
        }
        ctx!.stroke();
        ctx!.setLineDash([]);
        const q = projette(e.p, rot, v);
        if (visible(q, v)) {
          if (e.approx) {
            // Cercle creux : le point marque un pays, pas une adresse.
            ctx!.strokeStyle = avecAlpha(teinte, 0.8);
            ctx!.lineWidth = 1.3;
            ctx!.beginPath(); ctx!.arc(q.x, q.y, 3, 0, 6.2832); ctx!.stroke();
          } else {
            ctx!.fillStyle = avecAlpha(teinte, 0.95);
            ctx!.beginPath(); ctx!.arc(q.x, q.y, e.alerte ? 3.2 : 2.6, 0, 6.2832); ctx!.fill();
            ctx!.fillStyle = avecAlpha(teinte, e.alerte ? 0.26 : 0.18);
            ctx!.beginPath(); ctx!.arc(q.x, q.y, e.alerte ? 8 : 6, 0, 6.2832); ctx!.fill();
          }
        }
      }

      ctx!.lineWidth = 0.75;
      ctx!.strokeStyle = avecAlpha(accent, 0.11);
      for (const h of histoRef.current) {
        ctx!.beginPath();
        let ouvert = false;
        for (const p of h) {
          const q = projette(p, rot, v);
          if (!visible(q, v)) { ouvert = false; continue; }
          if (!ouvert) { ctx!.moveTo(q.x, q.y); ouvert = true; } else ctx!.lineTo(q.x, q.y);
        }
        ctx!.stroke();
      }

      const now = performance.now();
      for (let i = fluxRef.current.length - 1; i >= 0; i--) {
        const f = fluxRef.current[i];
        const vieillesse = (now - f.t0) / f.duree;
        if (vieillesse > 1.25) {
          histoRef.current.push(f.pts);
          while (histoRef.current.length > retRef.current) histoRef.current.shift();
          fluxRef.current.splice(i, 1);
          continue;
        }
        const pts = f.pts.map((p) => projette(p, rot, v));
        const av = Math.min(1, vieillesse * 1.5);
        const fin = Math.floor(pts.length * av);
        const fade = vieillesse > 1 ? Math.max(0, 1 - (vieillesse - 1) * 4) : 1;

        // Un arc pointillé et plus pâle dit « pays d'enregistrement », pas
        // « position ». La différence doit se voir sans lire la légende.
        const teinteF = f.alerte ? alarme : accent;
        ctx!.lineWidth = f.alerte ? 1.7 : f.approx ? 0.9 : 1.2;
        ctx!.setLineDash(f.approx ? [3, 4] : []);
        ctx!.beginPath();
        let ouvert = false;
        for (let k = 0; k < fin; k++) {
          const p = pts[k];
          if (!visible(p, v)) { ouvert = false; continue; }
          if (!ouvert) { ctx!.moveTo(p.x, p.y); ouvert = true; } else ctx!.lineTo(p.x, p.y);
        }
        ctx!.strokeStyle = avecAlpha(teinteF, (f.alerte ? 0.85 : f.approx ? 0.34 : 0.6) * fade);
        ctx!.stroke();
        ctx!.setLineDash([]);

        if (fin > 0 && fin < pts.length) {
          const p = pts[fin - 1];
          if (visible(p, v)) {
            ctx!.fillStyle = avecAlpha(teinteF, f.approx ? 0.6 : 0.95);
            ctx!.beginPath(); ctx!.arc(p.x, p.y, f.approx ? 1.8 : 2.2, 0, 6.2832); ctx!.fill();
            ctx!.fillStyle = avecAlpha(teinteF, f.approx ? 0.12 : 0.22);
            ctx!.beginPath(); ctx!.arc(p.x, p.y, 6, 0, 6.2832); ctx!.fill();
          }
        }
        if (av >= 1) {
          const p = pts[pts.length - 1];
          if (visible(p, v)) {
            if (f.approx) {
              // Marqueur creux : le point n'affirme pas une position exacte.
              ctx!.strokeStyle = avecAlpha(teinteF, 0.7 * fade);
              ctx!.lineWidth = 1;
              ctx!.beginPath(); ctx!.arc(p.x, p.y, 2.8, 0, 6.2832); ctx!.stroke();
            } else {
              ctx!.fillStyle = avecAlpha(teinteF, 0.9 * fade);
              ctx!.beginPath(); ctx!.arc(p.x, p.y, f.alerte ? 3 : 2.4, 0, 6.2832); ctx!.fill();
            }
            ctx!.strokeStyle = avecAlpha(teinteF, (f.alerte ? 0.5 : 0.32) * fade);
            ctx!.beginPath(); ctx!.arc(p.x, p.y, 5 + vieillesse * 5, 0, 6.2832); ctx!.stroke();
          }
        }
      }

      const m = projette(maisonRef.current, rot, v);
      if (m.z > -0.05) {
        const pl = 3 + Math.sin(now / 380) * 1.2;
        ctx!.fillStyle = avecAlpha(accent, 0.18);
        ctx!.beginPath(); ctx!.arc(m.x, m.y, pl + 7, 0, 6.2832); ctx!.fill();
        ctx!.fillStyle = accent;
        ctx!.beginPath(); ctx!.arc(m.x, m.y, 3.2, 0, 6.2832); ctx!.fill();
      }

      rotRef.current += 0.0013;
      rafRef.current = requestAnimationFrame(dessine);
    };

    rafRef.current = requestAnimationFrame(dessine);
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  // Âge du relevé et attente avant la prochaine tentative, affichés en clair :
  // on doit savoir de quand datent les chiffres qu'on regarde.
  const [attente, setAttente] = useState(0);
  useEffect(() => {
    const i = setInterval(() => {
      setAge(etat?.quand ? Math.round((Date.now() - etat.quand) / 1000) : 0);
      setAttente(prochain ? Math.max(0, Math.round((prochain - Date.now()) / 1000)) : 0);
    }, 1000);
    return () => clearInterval(i);
  }, [etat, prochain]);

  useEffect(() => {
    retRef.current = ARCS_GARDES;
    while (histoRef.current.length > retRef.current) histoRef.current.shift();
  }, []);

  // ── Classements ─────────────────────────────────────────────────────────
  // Les panneaux résument ce que le journal montre — donc l'historique chargé,
  // pas seulement le dernier relevé.
  const cx = useMemo(() => evenements.map((e) => e.c), [evenements]);

  const parDomaine = useMemo(() => {
    const m = new Map<string, { poids: number; domaine?: string }>();
    // Sur les totaux du serveur quand ils sont là, sinon sur ce qui est chargé.
    for (const c of (totaux.destinations.length ? totaux.destinations : cx)) {
      const nom = c.operateur || c.domaine || c.nom || c.dst;
      const p = m.get(nom) || { poids: 0, domaine: c.logo };
      p.poids += c.octets || 1;
      m.set(nom, p);
    }
    return [...m.entries()].sort((a, b) => b[1].poids - a[1].poids).slice(0, 6);
  }, [cx, totaux]);

  const parAppareil = useMemo(() => {
    const m = new Map<string, { poids: number; icone: string }>();
    const source = totaux.appareils.length
      ? totaux.appareils.map((a) => ({ src: a.src, octets: a.octets }))
      : cx.map((c) => ({ src: c.src, octets: c.octets || 1 }));
    for (const c of source) {
      const app = parIp.get(c.src);
      const nom = app?.nom || c.src;
      const p = m.get(nom) || { poids: 0, icone: app?.icone || "unknown" };
      p.poids += c.octets || 1;
      m.set(nom, p);
    }
    return [...m.entries()].sort((a, b) => b[1].poids - a[1].poids).slice(0, 6);
  }, [cx, parIp, totaux]);

  /**
   * Ce qui est signalé, épinglé en haut du panneau.
   *
   * Dédoublonné par flux : le même service atteint vingt fois n'occupe qu'une
   * ligne, avec sa date la plus récente. Un panneau qui répète vingt fois la
   * même alerte n'alerte plus.
   */
  const signales = useMemo(() => {
    const m = new Map<string, Connexion>();
    for (const c of cx) {
      if (!c.suspect) continue;
      const vu = m.get(c.cle);
      if (!vu || (c.dernier || 0) > (vu.dernier || 0)) m.set(c.cle, c);
    }
    return [...m.values()].sort((a, b) => (b.dernier || 0) - (a.dernier || 0));
  }, [cx]);

  const maxDom = parDomaine.length ? parDomaine[0][1].poids : 1;
  const maxApp = parAppareil.length ? parAppareil[0][1].poids : 1;
  // Les quatre chiffres décrivent tout l'historique conservé, pas la fenêtre
  // chargée : c'est le serveur qui les compte.
  const base = totaux.destinations.length ? totaux.destinations : cx;
  const situees = base.filter((c) => c.lieu).length;
  const parPays = base.filter((c) => !c.lieu && c.pays).length;
  const destinations = totaux.destinations.length
    ? totaux.destinations.length
    : new Set(cx.map((c) => c.dst)).size;
  const avecOctets = cx.some((c) => c.octets);

  // ── Aucun équipement à interroger ───────────────────────────────────────
  if (etat && !etat.cible) {
    // Deux cas très différents : soit rien n'est enregistré, soit tout ce qui
    // est enregistré est joint par API locale et n'a pas de shell à interroger.
    const barres = etat.ecartees;
    return (
      <div className="card">
        <div className="pad" style={{ padding: "34px 22px", maxWidth: "72ch" }}>
          <h2 style={{ fontSize: 15, marginBottom: 10 }}>
            {barres.length ? "Aucun équipement interrogeable" : "Aucun équipement à interroger"}
          </h2>
          <p style={{ color: "var(--muted)", fontSize: 13, lineHeight: 1.6 }}>
            Cette page ne montre que des connexions réellement relevées. Pour les
            obtenir, MapMyLAN interroge la table de suivi de connexions de
            l'équipement qui voit passer le trafic du parc — la passerelle.
          </p>
          {barres.length ? (
            <>
              <p style={{ color: "var(--muted)", fontSize: 13, lineHeight: 1.6, marginTop: 10 }}>
                {barres.length === 1
                  ? "L'équipement enregistré ne porte pas de shell :"
                  : "Aucun des équipements enregistrés ne porte de shell :"}
              </p>
              {/* On nomme chaque entrée et la raison exacte de son exclusion :
                  sans cela, il faut deviner ce qui a été saisi. */}
              <ul style={{ margin: "10px 0 0", padding: 0, listStyle: "none" }}>
                {barres.map((c) => (
                  <li key={c.id} style={{
                    display: "flex", gap: 10, alignItems: "baseline",
                    padding: "7px 0", borderTop: "1px solid var(--hair-soft)",
                    fontSize: 12.5, color: "var(--muted)", lineHeight: 1.5,
                  }}>
                    <b style={{ fontWeight: 500, flex: "none" }}>{c.nom}</b>
                    <span className="mono" style={{ flex: "none", color: "var(--faint)" }}>
                      {c.hote}:{c.port}
                    </span>
                    <span style={{ color: "var(--faint)" }}>
                      {c.transport === "api"
                        ? "piloté par son API locale — une API expose les clients et les règles, pas la table de suivi de connexions"
                        : `le port ${c.port} est un port web, pas un port SSH`}
                    </span>
                  </li>
                ))}
              </ul>
              <p style={{ color: "var(--muted)", fontSize: 13, lineHeight: 1.6, marginTop: 14 }}>
                Pour relever le trafic, active SSH sur la passerelle, puis ajoute-la
                dans <b style={{ fontWeight: 500 }}>Console SSH</b> comme entrée
                distincte, sur son <b style={{ fontWeight: 500 }}>port 22</b>. Le
                relevé démarrera tout seul.
              </p>
            </>
          ) : (
            <p style={{ color: "var(--muted)", fontSize: 13, lineHeight: 1.6, marginTop: 10 }}>
              Enregistre-la dans <b style={{ fontWeight: 500 }}>Console SSH</b>, en
              cochant « équipement principal ». Rien d'autre à faire : le relevé
              démarre tout seul.
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="grid3">
      {/* Journal des connexions */}
      <div className="panel pw-l">
        <div className="ph">
          <span>{s("world.log")}</span>
          {/* Le journal est une fenêtre sur l'historique : afficher son seul
              nombre de lignes à côté d'un bandeau qui en annonce deux mille
              cinq cents, sous le même mot « connexions », se contredit. */}
          <em title={totaux.connexions > cx.length
            ? `${cx.length} lignes chargées sur ${totaux.connexions} dans la fenêtre « ${PALIERS[retention][0]} »`
            : undefined}>
            {totaux.connexions > cx.length
              ? <>{cx.length}<span style={{ color: "var(--faint)" }}> / {totaux.connexions}</span></>
              : cx.length}
          </em>
        </div>
        <div className="flux"
          onScroll={(e) => {
            const el = e.currentTarget;
            // Marge de 120 px : on charge avant d'atteindre le fond, pour que
            // la descente reste continue.
            if (el.scrollHeight - el.scrollTop - el.clientHeight < 120) void chargerPlusAncien();
          }}>
          {etat?.erreur && (
            <div style={{ padding: "14px", borderBottom: "1px solid var(--hair-soft)" }}>
              <div className="note warn" style={{ marginBottom: 10 }}>
                <Icon name="alert" size={15} style={{ flex: "none", marginTop: 1 }}/>
                <span>
                  {etat.liaisonPerdue
                    ? <>La liaison avec <b style={{ fontWeight: 500 }}>{etat.equipement}</b> n'a pas abouti.</>
                    : <>La commande de relevé n'a rien rendu sur <b style={{ fontWeight: 500 }}>{etat.equipement}</b>.</>}
                </span>
              </div>
              <div className="mono" style={{ fontSize: 10.5, color: "var(--muted)", wordBreak: "break-word", lineHeight: 1.6 }}>
                {etat.erreur}
              </div>
              {etat.liaisonPerdue && (
                <div style={{ color: "var(--faint)", fontSize: 11.5, lineHeight: 1.55, marginTop: 8 }}>
                  « Connection lost before handshake » veut dire que la machine a
                  répondu puis coupé avant d'échanger sa bannière : soit le port
                  visé n'est pas celui du serveur SSH, soit l'équipement limite le
                  nombre de connexions. MapMyLAN espace donc ses tentatives au lieu
                  d'insister.
                </div>
              )}
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 12 }}>
                <button className="btn" onClick={() => relancerRef.current()}>
                  <Icon name="refresh" size={14}/>Réessayer
                </button>
                {attente > 0 && (
                  <span className="mono" style={{ fontSize: 10.5, color: "var(--faint)" }}>
                    prochaine tentative dans {attente} s
                  </span>
                )}
              </div>
            </div>
          )}
          {evenements.length === 0 && !etat?.erreur && (
            <div style={{ padding: "18px 14px", color: "var(--faint)", fontSize: 12, lineHeight: 1.6 }}>
              {etat?.quand
                ? "Aucune connexion sortante relevée pour l'instant."
                : "Lecture de l'historique…"}
            </div>
          )}
          {evenements.map((e) => (
            <div className="evt" key={`${e.cle}-${e.quand}`}
              onClick={() => setDetail(e.c)}
              style={{
                cursor: "pointer",
                ...(e.c.suspect ? { background: "var(--alarm-wash, rgba(220,38,38,.06))" } : null),
              }}>
              <Logo domaine={e.c.logo} taille={22}/>
              <div className="c">
                <span className="s" style={e.c.suspect ? { color: "var(--alarm)" } : undefined}>
                  {/* La flèche dit qui a ouvert la connexion. Sans elle, une
                      entrée et une sortie se ressemblent trait pour trait. */}
                  <span className="mono" style={{ color: "var(--faint)", marginRight: 5 }}>
                    {e.c.sens === "entrant" ? "←" : "→"}
                  </span>
                  {e.c.operateur || e.c.domaine || e.c.nom || e.c.dst}
                </span>
                <span className="d"
                  title={!e.c.lieu && e.c.paysRegistre
                    ? `Pays d'enregistrement du préfixe au registre — pas la position du serveur : un préfixe enregistré ailleurs peut être annoncé depuis Paris.`
                    : undefined}>
                  {e.appareil} · {e.c.dst}
                  {e.c.lieu
                    ? ` · ${e.c.lieu.ville}`
                    : e.c.pays ? ` · ${e.c.pays.nom} (enregistré)`
                    : e.c.paysRegistre ? ` · ${e.c.paysRegistre.toLowerCase()}` : ""}
                </span>
              </div>
              <div className="r">
                <b>{fmtOctets(e.c.octets) || new Date(e.quand).toLocaleTimeString()}</b>
                <span>{nomProto(e.c.port, e.c.proto)}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {detail && detache && (
        <FicheFlux c={detail} flottante pos={posFiche} onBouge={setPosFiche}
          onFerme={() => { setDetail(null); setDetache(false); }}
          onRattache={() => setDetache(false)}/>
      )}

      {/* Globe */}
      <div className="globe" ref={boiteRef}>
        <div className="gtitre">
          <h1>{s("world.title")}</h1>
          <p>
            {origine.lat.toFixed(2)} N · {origine.lon.toFixed(2)} E — {origine.nom || s("world.origin")}
          </p>
        </div>
        <div className="kpis">
          {/* Ce qui est affiché, et ce que le serveur conserve : tant que la
              liste n'est pas descendue jusqu'au bout, les quatre chiffres ne
              décrivent qu'une fenêtre. Le dire évite de faire passer 300 pour
              un total. */}
          <div className="kpi" title={`Sur la fenêtre « ${PALIERS[retention][0]} »`
            + (totaux.connexions > cx.length ? ` · ${cx.length} chargées dans le journal` : "")}>
            <span>Connexions</span>
            <b className="a">
              {totaux.connexions || cx.length}
              {totaux.connexions > cx.length
                ? <em style={{ fontStyle: "normal", color: "var(--faint)", fontSize: "0.7em" }}> · {cx.length} affichées</em>
                : null}
            </b>
          </div>
          <div className="kpi"><span>Destinations</span><b>{destinations}</b></div>
          <div className="kpi" title="Destinations dont le nom d'hôte porte un code de ville reconnu">
            <span>Situées</span><b>{situees}</b>
          </div>
          <div className="kpi" title="Destinations placées au pays d'enregistrement du préfixe, faute de ville — ce n'est pas la position du serveur">
            <span>Par pays</span><b>{parPays}</b>
          </div>
        </div>

        <canvas ref={cvRef}/>

        <div className="legende">
          <div><i style={{ background: "var(--accent)" }}/>{s("world.legEstab")}</div>
          {/* Le trait pointillé distingue ce qui est placé au pays de ce qui
              est réellement situé. La nuance se lit sur le globe, pas
              seulement ici. */}
          <div title="Placé au pays d'enregistrement du préfixe, faute de ville connue — ce n'est pas la position du serveur">
            <i style={{
              background: "transparent",
              backgroundImage: "repeating-linear-gradient(90deg, var(--accent) 0 3px, transparent 3px 7px)",
              opacity: 0.6,
            }}/>
            pays d'enregistrement
          </div>
          <div><i style={{ background: "var(--faint)" }}/>{s("world.legLand")}</div>
          <div className="retention" title="Période décrite par le journal, les compteurs et les classements">
            <label>Fenêtre</label>
            <input type="range" min={0} max={PALIERS.length - 1} step={1} value={retention}
              onChange={(e) => setRetention(Number(e.target.value))}/>
            <b>{PALIERS[retention][0]}</b>
          </div>
        </div>
      </div>

      {/* Classements */}
      <div className="panel pw-r">
        {/* Épinglé en haut, avant tout le reste : c'est la seule chose de cet
            écran qui demande une décision. */}
        {signales.length > 0 && (
          <>
            <div className="ph">
              <span style={{ color: "var(--alarm)" }}>Signalés</span>
              <em style={{ color: "var(--alarm)" }}>{signales.length}</em>
            </div>
            <div className="bloc">
              {signales.slice(0, 6).map((c) => (
                <div className="row" key={c.cle}
                  onClick={() => { setDetail(c); }}
                  style={{ cursor: "pointer" }}
                  title={c.raison}>
                  <span className="idev" style={{ color: "var(--alarm)" }}>
                    <Icon name="alert" size={12}/>
                  </span>
                  <div className="c">
                    <div className="tp">
                      <span className="n" style={{ color: "var(--alarm)" }}>
                        {c.operateur || c.domaine || c.nom || c.dst}
                      </span>
                      <span className="v mono">{c.sens === "entrant" ? "entrée" : "sortie"}</span>
                    </div>
                    <div style={{
                      fontSize: 10.5, color: "var(--muted)", lineHeight: 1.5,
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    }}>{c.raison}</div>
                  </div>
                </div>
              ))}
              {signales.length > 6 && (
                <div style={{ fontSize: 10.5, color: "var(--faint)", marginTop: 4 }}>
                  et {signales.length - 6} autre(s) — la liste complète est dans le journal
                </div>
              )}
            </div>
          </>
        )}

        {detail && !detache && (
          <FicheFlux c={detail} onFerme={() => setDetail(null)}
            onDetache={() => { setDetache(true); setPosFiche({ x: 120, y: 120 }); }}/>
        )}

        <div className="ph"><span>Destinations</span><em>{destinations}</em></div>
        <div className="bloc">
          {parDomaine.map(([nom, v]) => (
            <div className="row" key={nom}>
              <Logo domaine={v.domaine} taille={20}/>
              <div className="c">
                <div className="tp">
                  <span className="n">{nom}</span>
                  <span className="v">{avecOctets ? fmtOctets(v.poids) : `${v.poids}`}</span>
                </div>
                <div className="jauge"><i style={{ width: `${Math.round((v.poids / maxDom) * 100)}%` }}/></div>
              </div>
            </div>
          ))}
          {parDomaine.length === 0 && <div style={{ color: "var(--faint)", fontSize: 12 }}>—</div>}
        </div>

        <div className="ph"><span>{s("world.devices")}</span><em>{parAppareil.length}</em></div>
        <div className="bloc">
          {parAppareil.map(([nom, v]) => (
            <div className="row" key={nom}>
              <span className="idev"><Icon name={v.icone} size={12}/></span>
              <div className="c">
                <div className="tp">
                  <span className="n">{nom}</span>
                  <span className="v">{avecOctets ? fmtOctets(v.poids) : `${v.poids}`}</span>
                </div>
                <div className="jauge dev"><i style={{ width: `${Math.round((v.poids / maxApp) * 100)}%` }}/></div>
              </div>
            </div>
          ))}
          {parAppareil.length === 0 && <div style={{ color: "var(--faint)", fontSize: 12 }}>—</div>}
        </div>

        <div style={{
          marginTop: "auto", padding: "10px 13px", borderTop: "1px solid var(--hair-soft)",
          fontFamily: "var(--mono)", fontSize: 10, color: "var(--faint)", lineHeight: 1.6,
          wordBreak: "break-all",
        }}>
          {/* Plusieurs machines peuvent porter un shell : on laisse choisir
              laquelle est interrogée, plutôt que d'imposer l'équipement principal. */}
          {etat?.quand
            ? <>relevé sur <b style={{ fontWeight: 400, color: "var(--muted)" }}>{etat.equipement}</b>
              {" "}il y a {age} s<br/>
              {etat.total} flux conservés · {etat.tailleMo.toFixed(2)} Mo
              {etat.retentionJours > 0 ? ` · ${etat.retentionJours} j` : " · sans limite de durée"}
              {etat.retentionMaxMo > 0 ? ` · ${etat.retentionMaxMo} Mo max` : ""}
              <br/>{(etat.commande || "").split("|")[0].trim()}</>
            : "connexion à l'équipement…"}
        </div>
      </div>
    </div>
  );
}


/**
 * La fiche d'un flux.
 *
 * Deux états, le même contenu : rangée dans le panneau, ou détachée et posée
 * au-dessus de la page. Détachée, elle se déplace à la souris — ce qui sert
 * quand on veut garder une alerte sous les yeux en regardant le globe.
 */
function FicheFlux({ c, onFerme, onDetache, onRattache, flottante, pos, onBouge }: {
  c: Connexion;
  onFerme: () => void;
  onDetache?: () => void;
  onRattache?: () => void;
  flottante?: boolean;
  pos?: { x: number; y: number };
  onBouge?: (p: { x: number; y: number }) => void;
}) {
  const prise = useRef<{ dx: number; dy: number } | null>(null);

  const attraper = (e: React.MouseEvent) => {
    if (!flottante || !pos || !onBouge) return;
    prise.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y };
    const bouger = (ev: MouseEvent) => {
      if (!prise.current) return;
      onBouge({
        // On borne à la fenêtre : une fiche qu'on ne peut plus rattraper est
        // une fiche perdue.
        x: Math.max(0, Math.min(window.innerWidth - 280, ev.clientX - prise.current.dx)),
        y: Math.max(0, Math.min(window.innerHeight - 80, ev.clientY - prise.current.dy)),
      });
    };
    const lacher = () => {
      prise.current = null;
      window.removeEventListener("mousemove", bouger);
      window.removeEventListener("mouseup", lacher);
    };
    window.addEventListener("mousemove", bouger);
    window.addEventListener("mouseup", lacher);
  };

  const ligne = (k: string, v: any) => (
    <div style={{ display: "flex", gap: 10, fontSize: 11.5, padding: "3px 0" }}>
      <span style={{ color: "var(--faint)", minWidth: 78 }}>{k}</span>
      <span className="mono" style={{ wordBreak: "break-all" }}>{v}</span>
    </div>
  );

  const corps = (
    <>
      <div
        onMouseDown={attraper}
        style={{
          display: "flex", alignItems: "center", gap: 8, padding: "9px 12px",
          borderBottom: "1px solid var(--hair-soft)",
          cursor: flottante ? "grab" : "default",
        }}>
        {c.suspect && <Icon name="alert" size={13}/>}
        <b style={{ fontWeight: 500, fontSize: 12.5, color: c.suspect ? "var(--alarm)" : undefined }}>
          {c.operateur || c.domaine || c.nom || c.dst}
        </b>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          {onDetache && <button className="lnk" onClick={onDetache}>détacher</button>}
          {onRattache && <button className="lnk" onClick={onRattache}>rattacher</button>}
          <button className="lnk" onClick={onFerme}>fermer</button>
        </div>
      </div>
      <div style={{ padding: "8px 12px 12px" }}>
        {c.suspect && c.raison && (
          <div style={{
            color: "var(--alarm)", fontSize: 11.5, lineHeight: 1.5,
            marginBottom: 8, paddingBottom: 8, borderBottom: "1px solid var(--hair-soft)",
          }}>{c.raison}</div>
        )}
        {ligne("Sens", c.sens === "entrant" ? "entrante — l'extérieur est venu" : "sortante — le parc est allé")}
        {ligne("Appareil", c.src)}
        {ligne("Distant", c.dst)}
        {ligne("Port", `${c.port} · ${c.proto}`)}
        {c.nom && ligne("Nom inverse", c.nom)}
        {c.operateur && ligne("Titulaire", c.operateur)}
        {c.paysRegistre && ligne("Registre", `${c.paysRegistre} — pays d'enregistrement du préfixe`)}
        {c.lieu && ligne("Ville", `${c.lieu.ville} — déduite du nom d'hôte`)}
        {c.octets ? ligne("Volume", fmtOctets(c.octets)) : null}
        {c.vues ? ligne("Relevés", `${c.vues} passage(s)`) : null}
        {c.premier ? ligne("Vu d'abord", new Date(c.premier).toLocaleString()) : null}
        {c.dernier ? ligne("Vu en dernier", new Date(c.dernier).toLocaleString()) : null}
      </div>
    </>
  );

  if (!flottante) {
    return (
      <div style={{
        margin: "0 10px 10px", border: `1px solid ${c.suspect ? "var(--alarm)" : "var(--hair)"}`,
        borderRadius: 10, background: "var(--well)", overflow: "hidden",
      }}>{corps}</div>
    );
  }

  return (
    <div style={{
      position: "fixed", left: pos?.x ?? 120, top: pos?.y ?? 120, zIndex: 9600, width: 300,
      background: "var(--surface)", borderRadius: 12, boxShadow: "var(--lift)",
      border: `1px solid ${c.suspect ? "var(--alarm)" : "var(--hair)"}`, overflow: "hidden",
    }}>{corps}</div>
  );
}
