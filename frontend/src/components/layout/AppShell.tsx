// Application shell.
//
// Icon navigation rail, inset search bar, light/dark toggle, language
// selector, countdown card for the next sweep. The background carries a light
// grain: the surface has a texture rather than a dead flat fill.

import { useEffect, useState } from "react";
import { useStore } from "../../stores/app";
import { THEMES, compatTheme, resolveTheme } from "../../lib/themes";
import { Icon } from "../../lib/icons";
import { useT, useLang, LANGS } from "../../lib/i18n";
import { DeviceDrawer } from "../device/DeviceDrawer";
import {
  Dashboard, MapPage, DevicesPage, VlansPage, SecurityPage,
  VulnsPage, SshPage, HostPage, NotificationsPage, LogsPage,
  ReportsPage, SettingsPage, UsersPage, BotCommandsPage, RouterPage,
} from "../../pages";

const NAV = [
  { id: "dashboard",     icon: "overview", group: "main" },
  { id: "map",           icon: "map",      group: "main" },
  { id: "devices",       icon: "devices",  group: "main" },
  { id: "vlans",         icon: "vlan",     group: "main" },
  { id: "security",      icon: "shield",   group: "security" },
  { id: "vulns",         icon: "alert",    group: "security" },
  { id: "router",        icon: "router",   group: "control" },
  { id: "ssh",           icon: "ssh",      group: "control" },
  { id: "botcommands",   icon: "bot",      group: "control" },
  { id: "host",          icon: "chip",     group: "control" },
  { id: "notifications", icon: "bell",     group: "monitor" },
  { id: "logs",          icon: "logs",     group: "monitor" },
  { id: "reports",       icon: "report",   group: "monitor" },
  { id: "settings",      icon: "settings", group: "system" },
  { id: "users",         icon: "users",    group: "system" },
];

const GROUPS = ["main", "security", "control", "monitor", "system"];

function pageContent(page: string, t: any) {
  switch (page) {
    case "dashboard":     return <Dashboard t={t}/>;
    case "map":           return <MapPage t={t}/>;
    case "devices":       return <DevicesPage t={t}/>;
    case "vlans":         return <VlansPage t={t}/>;
    case "security":      return <SecurityPage t={t}/>;
    case "vulns":         return <VulnsPage t={t}/>;
    case "router":        return <RouterPage t={t}/>;
    case "ssh":           return <SshPage t={t}/>;
    case "host":          return <HostPage t={t}/>;
    case "monitoring":    return <HostPage t={t}/>;
    case "notifications": return <NotificationsPage t={t}/>;
    case "logs":          return <LogsPage t={t}/>;
    case "reports":       return <ReportsPage t={t}/>;
    case "settings":      return <SettingsPage t={t}/>;
    case "users":         return <UsersPage t={t}/>;
    case "botcommands":   return <BotCommandsPage t={t}/>;
    default:              return <Dashboard t={t}/>;
  }
}

const GRAIN =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='3'/%3E%3C/filter%3E%3Crect width='160' height='160' filter='url(%23n)'/%3E%3C/svg%3E\")";

export function AppShell() {
  const themeKey = useStore(s => s.themeKey);
  const t = compatTheme(THEMES[resolveTheme(themeKey)]);
  const { currentPage, setPage } = useStore();
  const s = useT();

  return (
    <>
      <style>{`
        body { background: ${t.bg}; color: ${t.txt}; font-family: ${t.font};
               font-feature-settings: "tnum" 1; }
        ::-webkit-scrollbar { width: 11px; height: 11px; }
        ::-webkit-scrollbar-thumb { background: ${t.border}; border-radius: 20px;
                                    border: 3.5px solid ${t.bg}; }
        ::-webkit-scrollbar-track { background: transparent; }
        :focus-visible { outline: 2px solid ${t.primary}; outline-offset: 3px; border-radius: 4px; }
        input::placeholder { color: ${t.faint}; }
        @media (prefers-reduced-motion: reduce) { * { animation: none !important; transition: none !important; } }
      `}</style>

      {/* grain: gives fabric to the background */}
      <div aria-hidden style={{
        position: "fixed", inset: 0, zIndex: 9999, pointerEvents: "none",
        opacity: t.grain, backgroundImage: GRAIN,
      }}/>

      <div style={{
        width: "100vw", height: "100vh", display: "flex",
        background: t.bg, color: t.txt, fontFamily: t.font, overflow: "hidden",
      }}>
        <Rail t={t} active={currentPage} onNav={setPage} s={s}/>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <TopBar t={t} s={s}/>
          <div style={{ flex: 1, overflow: "auto" }}>
            {pageContent(currentPage, t)}
          </div>
        </div>
      </div>
      <DeviceDrawer theme={t}/>
    </>
  );
}

function Rail({ t, active, onNav, s }: any) {
  const stats = useStore(st => st.stats);
  const [left, setLeft] = useState(300);
  useEffect(() => {
    const i = setInterval(() => setLeft(v => (v <= 0 ? 300 : v - 1)), 1000);
    return () => clearInterval(i);
  }, []);
  const mmss = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;

  const counts: Record<string, number> = {
    devices: stats?.total || 0,
    vulns: stats?.alerts || 0,
    security: (stats?.banned || 0) + (stats?.quarantined || 0),
  };

  return (
    <aside style={{
      width: 224, flexShrink: 0, height: "100vh",
      padding: "26px 16px 24px 22px",
      display: "flex", flexDirection: "column", overflow: "hidden",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "0 10px", marginBottom: 30 }}>
        <span style={{
          width: 28, height: 28, borderRadius: 9, background: t.grad, color: t.onPrimary,
          display: "flex", alignItems: "center", justifyContent: "center", boxShadow: t.lift,
        }}><Icon name="logo" size={16}/></span>
        <b style={{ fontSize: 15, fontWeight: 600, letterSpacing: "-0.03em" }}>MapMyLAN</b>
        <span style={{
          width: 6, height: 6, borderRadius: "50%", background: t.primary, marginLeft: "auto",
          animation: "mml-ping 2.6s ease-out infinite",
        }}/>
      </div>
      <style>{`@keyframes mml-ping {
        0% { box-shadow: 0 0 0 0 ${t.primary}66 } 70% { box-shadow: 0 0 0 7px transparent }
        100% { box-shadow: 0 0 0 0 transparent } }`}</style>

      <nav style={{ flex: 1, overflowY: "auto", marginRight: -6, paddingRight: 6 }}>
        {GROUPS.map(g => (
          <div key={g} style={{ marginBottom: 20 }}>
            <div style={{
              fontSize: 10, letterSpacing: "0.16em", textTransform: "uppercase",
              color: t.faint, padding: "0 10px", marginBottom: 7,
            }}>{s(`nav.group.${g}`)}</div>
            {NAV.filter(n => n.group === g).map(n => {
              const on = active === n.id;
              const c = counts[n.id];
              return (
                <button key={n.id} onClick={() => onNav(n.id)} style={{
                  display: "flex", alignItems: "center", gap: 11, width: "100%",
                  textAlign: "left", padding: "7px 10px", borderRadius: 9, border: "none",
                  background: on ? t.surface : "transparent",
                  boxShadow: on ? t.lift : "none",
                  color: on ? t.txt : t.muted,
                  fontWeight: on ? 500 : 400, fontSize: 13.5, fontFamily: t.font,
                  cursor: "pointer", transition: "background .15s, color .15s",
                }}>
                  <span style={{ color: on ? t.primary : "inherit", display: "flex" }}>
                    <Icon name={n.icon} size={16}/>
                  </span>
                  <span>{s(`nav.${n.id}`)}</span>
                  {c ? (
                    <span style={{
                      marginLeft: "auto", fontFamily: t.monoFont, fontSize: 10.5,
                      color: on ? t.muted : t.faint,
                    }}>{c}</span>
                  ) : null}
                </button>
              );
            })}
          </div>
        ))}
      </nav>

      <div style={{ background: t.surface, borderRadius: 12, padding: "13px 14px", boxShadow: t.lift }}>
        <Row t={t} icon="clock" label={s("rail.next")} value={mmss}/>
        <Row t={t} icon="refresh" label={s("rail.every")} value={s("rail.minutes", { n: 5 })}/>
        <div style={{ height: 3, borderRadius: 3, background: t.well, marginTop: 12, overflow: "hidden" }}>
          <div style={{
            height: "100%", borderRadius: 3, background: t.primary,
            width: `${Math.round(100 - left / 3)}%`, transition: "width 1s linear",
          }}/>
        </div>
      </div>
    </aside>
  );
}

function Row({ t, icon, label, value }: any) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 9, fontSize: 12, color: t.muted, marginBottom: 9 }}>
      <Icon name={icon} size={13} stroke={1.8}/>
      {label}
      <b style={{ marginLeft: "auto", fontFamily: t.monoFont, fontSize: 11.5, color: t.txtSoft, fontWeight: 400 }}>
        {value}
      </b>
    </div>
  );
}

function TopBar({ t, s }: any) {
  const { setTheme, logout } = useStore(st => ({ setTheme: st.setTheme, logout: st.logout }));
  const themeKey = useStore(st => st.themeKey);
  const isDark = resolveTheme(themeKey) === "dark";
  const [lang, setLangValue] = useLang();

  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 12,
      padding: "22px 32px 0", flexShrink: 0,
    }}>
      <label style={{
        display: "flex", alignItems: "center", gap: 9, background: t.well,
        borderRadius: 10, padding: "8px 13px", width: 280, color: t.faint, fontSize: 13,
      }}>
        <Icon name="search" size={13} stroke={1.8}/>
        <input placeholder={s("top.search")} style={{
          border: "none", background: "none", outline: "none", font: "inherit",
          color: t.txt, width: "100%",
        }}/>
        <kbd style={{
          fontFamily: t.monoFont, fontSize: 10, color: t.faint,
          border: `1px solid ${t.border}`, borderRadius: 5, padding: "1px 5px",
        }}>⌘K</kbd>
      </label>

      <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
        <select value={lang} onChange={e => setLangValue(e.target.value)}
          title={s("top.language")} aria-label={s("top.language")} style={{
            ...ghost(t), width: "auto", padding: "0 8px", cursor: "pointer",
            fontFamily: t.monoFont, fontSize: 11,
          }}>
          {LANGS.map(l => (
            <option key={l.code} value={l.code}>{l.label}</option>
          ))}
        </select>
        <button title={s("top.notifications")} style={ghost(t)}>
          <Icon name="bell" size={16}/>
        </button>
        <button onClick={() => setTheme(isDark ? "light" : "dark")}
          title={s("top.appearance")} style={ghost(t)}>
          <Icon name="mode" size={16}/>
        </button>
        <button onClick={logout} title={s("top.logout")} style={ghost(t)}>
          <Icon name="power" size={16}/>
        </button>
      </div>
    </div>
  );
}

function ghost(t: any): any {
  return {
    width: 32, height: 32, borderRadius: 10, border: "none", background: "none",
    display: "flex", alignItems: "center", justifyContent: "center",
    color: t.muted, cursor: "pointer", transition: "background .15s, color .15s",
  };
}
