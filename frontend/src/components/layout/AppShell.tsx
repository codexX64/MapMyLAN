// Coquille applicative — les deux dispositions de la maquette.
//
// Un seul arbre, deux lectures :
//
//   « lecture » (reading)  rail large à gauche, barre de recherche, une page à
//                          la fois, beaucoup d'air.
//   « atelier » (workshop) barre supérieure, rail à pictos, explorateur en
//                          arbre, dock d'état en bas, tout visible d'un coup.
//
// Ce qui distingue les deux n'est pas un composant mais l'attribut
// data-shell posé sur <html> par lib/theme-runtime.ts : la feuille de la
// maquette masque le rail large en atelier, et l'explorateur en lecture. On
// évite ainsi deux arbres à maintenir en parallèle, et le contenu des pages
// est rigoureusement le même d'une disposition à l'autre.

import { useEffect, useMemo, useState } from "react";
import { useStore } from "../../stores/app";
import { THEMES, compatTheme, resolveTheme } from "../../lib/themes";
import { Icon } from "../../lib/icons";
import { useT, useLang } from "../../lib/i18n";
import { api } from "../../api/client";
import { DeviceDrawer } from "../device/DeviceDrawer";
import { ExplorerTree, Dock, WorkshopTop, WorkshopRail } from "./WorkshopShell";
import {
  Dashboard, MapPage, WorldPage, DevicesPage, VlansPage, SecurityPage,
  VulnsPage, SshPage, HostPage, NotificationsPage, LogsPage, InventoryPage,
  ReportsPage, SettingsPage, UsersPage, BotCommandsPage, RouterPage,
} from "../../pages";

// ─── Navigation ────────────────────────────────────────────────────────────
// L'ordre est celui de la maquette. Les groupes portent un nom : un rail de
// quinze entrées sans intertitre ne se lit plus.

const NAV = [
  { id: "dashboard",     icon: "overview", group: "main" },
  { id: "map",           icon: "map",      group: "main" },
  { id: "world",         icon: "globe",    group: "main" },
  { id: "devices",       icon: "devices",  group: "main" },
  { id: "vlans",         icon: "vlan",     group: "main" },
  { id: "security",      icon: "shield",   group: "security" },
  { id: "vulns",         icon: "alert",    group: "security" },
  { id: "router",        icon: "router",   group: "control" },
  { id: "botcommands",   icon: "bot",      group: "control" },
  { id: "ssh",           icon: "ssh",      group: "control" },
  { id: "host",          icon: "server",   group: "control" },
  { id: "inventory",     icon: "switch",   group: "control" },
  { id: "notifications", icon: "bell",     group: "monitor" },
  { id: "logs",          icon: "logs",     group: "monitor" },
  { id: "reports",       icon: "chart",    group: "monitor" },
  { id: "settings",      icon: "settings", group: "system" },
  { id: "users",         icon: "users",    group: "system" },
];

const GROUPS = ["main", "security", "control", "monitor", "system"];

// Rail à pictos de l'atelier : un sous-ensemble, celui qu'on ouvre dix fois
// par jour. Le reste passe par l'explorateur ou la recherche.
const RAIL_ATELIER = [
  { id: "dashboard", icon: "overview", court: "Aperçu" },
  { id: "map",       icon: "map",      court: "Carte" },
  { id: "world",     icon: "globe",    court: "Monde" },
  { id: "devices",   icon: "devices",  court: "Parc" },
  { id: "security",  icon: "shield",   court: "Défense" },
  { id: "router",    icon: "router",   court: "Équip." },
];
const RAIL_ATELIER_BAS = [
  { id: "logs",     icon: "logs",     court: "Journal" },
  { id: "settings", icon: "settings", court: "Réglages" },
];

export function pageContent(page: string, t: any) {
  switch (page) {
    case "dashboard":     return <Dashboard t={t}/>;
    case "map":           return <MapPage t={t}/>;
    case "world":         return <WorldPage t={t}/>;
    case "devices":       return <DevicesPage t={t}/>;
    case "vlans":         return <VlansPage t={t}/>;
    case "security":      return <SecurityPage t={t}/>;
    case "vulns":         return <VulnsPage t={t}/>;
    case "router":        return <RouterPage t={t}/>;
    case "ssh":           return <SshPage t={t}/>;
    case "host":          return <HostPage t={t}/>;
    case "monitoring":    return <HostPage t={t}/>;
    case "inventory":     return <InventoryPage t={t}/>;
    case "notifications": return <NotificationsPage t={t}/>;
    case "logs":          return <LogsPage t={t}/>;
    case "reports":       return <ReportsPage t={t}/>;
    case "settings":      return <SettingsPage t={t}/>;
    case "users":         return <UsersPage t={t}/>;
    case "botcommands":   return <BotCommandsPage t={t}/>;
    default:              return <Dashboard t={t}/>;
  }
}

// ─── Compte à rebours du prochain balayage ─────────────────────────────────
// La période vient des réglages ; à défaut, cinq minutes, comme le serveur.
// Le compteur repart à chaque fin de balayage plutôt qu'à intervalle fixe :
// c'est la fin réelle qui fait foi, pas l'horloge de l'interface.

function useProchainBalayage() {
  const scanRunning = useStore(s => s.scanRunning);
  const [periode, setPeriode] = useState(300);
  const [reste, setReste] = useState(300);

  useEffect(() => {
    api.settings()
      .then(r => {
        const v = parseInt(String(r?.["scan.interval"] ?? 300), 10);
        if (Number.isFinite(v) && v > 0) { setPeriode(v); setReste(v); }
      })
      .catch(() => {});
  }, []);

  useEffect(() => { if (!scanRunning) setReste(periode); }, [scanRunning, periode]);

  useEffect(() => {
    const i = setInterval(() => setReste(v => (v <= 0 ? periode : v - 1)), 1000);
    return () => clearInterval(i);
  }, [periode]);

  const mmss = `${Math.floor(reste / 60)}:${String(reste % 60).padStart(2, "0")}`;
  const avancement = Math.max(0, Math.min(100, Math.round(100 - (reste / periode) * 100)));
  return { mmss, avancement, minutes: Math.round(periode / 60), scanRunning };
}

// ─── Coquille ──────────────────────────────────────────────────────────────

export function AppShell() {
  const themeKey = useStore(s => s.themeKey);
  const t = compatTheme(THEMES[resolveTheme(themeKey)]);
  const currentPage = useStore(s => s.currentPage);
  const setPage = useStore(s => s.setPage);
  const shell = useStore(s => s.shell);
  const setShell = useStore(s => s.setShell);
  const s = useT();

  return (
    <>
      <div className="app">
        <WorkshopTop/>

        <div className="body">
          <Rail active={currentPage} onNav={setPage}/>
          <WorkshopRail items={RAIL_ATELIER} bas={RAIL_ATELIER_BAS} active={currentPage} onNav={setPage}/>
          <ExplorerTree/>

          <div className="main">
            <TopBar/>
            <div className="stage">{pageContent(currentPage, t)}</div>
            <Dock/>
          </div>
        </div>

        <StatusBar/>
      </div>

      {/* Bascule entre les deux dispositions, toujours accessible. */}
      <button className="swap" onClick={() => setShell(shell === "workshop" ? "reading" : "workshop")}>
        <Icon name={shell === "workshop" ? "logs" : "overview"} size={14}/>
        <span>{shell === "workshop" ? s("shell.toReading") : s("shell.toWorkshop")}</span>
      </button>

      <DeviceDrawer theme={t}/>
    </>
  );
}

// ─── Rail large, disposition lecture ───────────────────────────────────────

function Rail({ active, onNav }: { active: string; onNav: (p: string) => void }) {
  const s = useT();
  const devices = useStore(st => st.devices);
  const vlans = useStore(st => st.vlans);
  const alerts = useStore(st => st.alerts);
  const { mmss, avancement, minutes, scanRunning } = useProchainBalayage();

  const compteurs = useMemo<Record<string, number>>(() => {
    const cves = devices.reduce((n: number, d: any) => n + (d.cves?.length || 0), 0);
    return {
      devices: devices.length,
      vlans: vlans.length,
      vulns: cves,
      security: devices.filter((d: any) => d.status === "banned" || d.status === "quarantined").length,
      notifications: alerts.filter((a: any) => !a.acknowledged).length,
    };
  }, [devices, vlans, alerts]);

  return (
    <aside className="rail">
      <div className="mark">
        {/* La marque de la maison, à la place de l'ancienne pastille dessinée.
            Le fichier porte sa propre transparence : pas de fond, pas
            d'arrondi, elle tient sur le clair comme sur le sombre. */}
        <img className="marque" src="/logo.png" alt="MapMyLAN"/>
        <b>MapMyLAN</b>
        <span className="pulse"/>
      </div>

      {GROUPS.map(g => (
        <div className="grp" key={g}>
          <span>{s(`nav.group.${g}`)}</span>
          {NAV.filter(n => n.group === g).map(n => {
            const c = compteurs[n.id];
            return (
              <button key={n.id} className={active === n.id ? "nav on" : "nav"} onClick={() => onNav(n.id)}>
                <Icon name={n.icon} size={16}/>
                {s(`nav.${n.id}`)}
                {c ? <span className="cnt">{c}</span> : null}
              </button>
            );
          })}
        </div>
      ))}

      <div className="railcard">
        <div className="row">
          <Icon name="clock" size={13}/>{s("rail.next")}
          <b>{scanRunning ? "…" : mmss}</b>
        </div>
        <div className="row">
          <Icon name="refresh" size={13}/>{s("rail.every")}
          <b>{s("rail.minutes", { n: minutes })}</b>
        </div>
        <div className="bar"><i style={{ width: `${scanRunning ? 100 : avancement}%` }}/></div>
      </div>
    </aside>
  );
}

// ─── Barre du haut, disposition lecture ────────────────────────────────────

function TopBar() {
  const s = useT();
  const [lang, setLangValue] = useLang();
  const themeKey = useStore(st => st.themeKey);
  const setTheme = useStore(st => st.setTheme);
  const logout = useStore(st => st.logout);
  const setPage = useStore(st => st.setPage);
  const user = useStore(st => st.user);
  const sombre = resolveTheme(themeKey) === "dark";

  const initiales = String(user?.username || "?").slice(0, 2).toUpperCase();

  return (
    <div className="top">
      <Recherche/>
      <div className="topright">
        <button className="ghost" title={s("top.language")}
          style={{ width: "auto", padding: "0 11px", fontFamily: "var(--mono)", fontSize: 11 }}
          onClick={() => setLangValue(lang === "fr" ? "en" : "fr")}>
          {lang.toUpperCase()}
        </button>
        <button className="ghost" title={s("top.notifications")} onClick={() => setPage("notifications")}>
          <Icon name="bell" size={16}/>
        </button>
        <button className="ghost" title={s("top.appearance")} onClick={() => setTheme(sombre ? "light" : "dark")}>
          <Icon name="mode" size={16}/>
        </button>
        <button className="ghost" title={s("top.logout")} onClick={logout}>
          <Icon name="power" size={16}/>
        </button>
        <div className="who">{initiales}</div>
      </div>
    </div>
  );
}

/**
 * Recherche : filtre le parc et ouvre la fiche de l'appareil choisi.
 * Elle ne remplace pas le tableau des appareils, elle évite d'y aller.
 */
function Recherche() {
  const s = useT();
  const devices = useStore(st => st.devices);
  const selectDevice = useStore(st => st.selectDevice);
  const [q, setQ] = useState("");

  const trouves = useMemo(() => {
    const r = q.trim().toLowerCase();
    if (!r) return [];
    return devices.filter((d: any) =>
      [d.ip, d.mac, d.hostname, d.customName, d.vendor, d.type]
        .filter(Boolean).some((v: any) => String(v).toLowerCase().includes(r))
    ).slice(0, 7);
  }, [devices, q]);

  return (
    <div style={{ position: "relative" }}>
      <label className="search">
        <Icon name="search" size={13}/>
        <input placeholder={s("top.search")} value={q} onChange={e => setQ(e.target.value)}/>
        <kbd>⌘K</kbd>
      </label>
      {trouves.length > 0 && (
        <div style={{
          position: "absolute", top: "calc(100% + 6px)", left: 0, width: 290, zIndex: 40,
          background: "var(--surface)", borderRadius: 12, boxShadow: "var(--lift-hi)",
          overflow: "hidden", padding: 4,
        }}>
          {trouves.map((d: any) => (
            <button key={d.id} className="trow" style={{ height: 30 }}
              onClick={() => { selectDevice(d.id); setQ(""); }}>
              <span className="ic"><Icon name="devices" size={13}/></span>
              <span className="nm2">{d.customName || d.hostname || d.ip}</span>
              <span className="ipx2">{d.ip}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Barre d'état, disposition atelier ─────────────────────────────────────

function StatusBar() {
  const devices = useStore(st => st.devices);
  const [lang] = useLang();
  const [heure, setHeure] = useState("--:--");
  const [plage, setPlage] = useState<string>("—");

  useEffect(() => {
    const tic = () => {
      const d = new Date();
      setHeure(`${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`);
    };
    tic();
    const i = setInterval(tic, 20000);
    return () => clearInterval(i);
  }, []);

  useEffect(() => {
    api.scanRanges()
      .then(r => { if (Array.isArray(r) && r.length) setPlage(r[0]?.cidr || r[0]?.subnet || "—"); })
      .catch(() => {});
  }, []);

  const enLigne = devices.filter((d: any) => d.status === "online").length;
  const isoles = devices.filter((d: any) => d.status === "quarantined" || d.status === "banned").length;

  return (
    <div className="statusbar">
      <span><i className="dot"/> {plage}</span>
      <span>{enLigne} en ligne</span>
      <span>{isoles} isolé{isoles > 1 ? "s" : ""}</span>
      <div className="r">
        <span>{lang.toUpperCase()}</span>
        <span>{heure}</span>
      </div>
    </div>
  );
}
