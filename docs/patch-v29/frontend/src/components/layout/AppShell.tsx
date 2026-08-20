// Single AppShell that adapts heavily to the active theme:
//   - modern: emoji nav, rich gradient sidebar, glass topbar with live clock + badges
//   - minimal: bare typography, no glow, no emojis (single-letter glyphs)
//   - enterprise: dense Cisco-style chrome, layered sections
//
// All themes share: groups in sidebar, collapse toggle, live device counts in topbar.

import { useEffect, useState } from "react";
import { useStore } from "../../stores/app";
import { THEMES, compatTheme } from "../../lib/themes";
import { DeviceDrawer } from "../device/DeviceDrawer";
import {
  Dashboard, MapPage, DevicesPage, VlansPage, SecurityPage,
  VulnsPage, SshPage, HostPage, NotificationsPage, LogsPage,
  ReportsPage, SettingsPage, UsersPage,
} from "../../pages";

// Navigation grouped like the maquette
const NAV = [
  { id: "dashboard",    label: "Dashboard",   icon: "⬡", glyph: "D", group: "main" },
  { id: "map",          label: "Network Map", icon: "🗺", glyph: "M", group: "main" },
  { id: "devices",      label: "Devices",     icon: "💾", glyph: "I", group: "main" },
  { id: "vlans",        label: "VLANs",       icon: "🔀", glyph: "V", group: "main" },
  { id: "security",     label: "Security",    icon: "🛡", glyph: "S", group: "security" },
  { id: "vulns",        label: "Vulnerabilities", icon: "⚠️", glyph: "!", group: "security" },
  { id: "ssh",          label: "SSH Control", icon: "🔐", glyph: ">", group: "control" },
  { id: "host",         label: "Monitoring",  icon: "📊", glyph: "▲", group: "control" },
  { id: "notifications", label: "Notifications", icon: "🔔", glyph: "!", group: "monitor" },
  { id: "logs",         label: "Logs",        icon: "📋", glyph: "≡", group: "monitor" },
  { id: "reports",      label: "Reports",     icon: "📈", glyph: "R", group: "monitor" },
  { id: "settings",     label: "Settings",    icon: "⚙️", glyph: "*", group: "system" },
  { id: "users",        label: "Users",       icon: "👥", glyph: "U", group: "system" },
];

const GROUPS: Record<string, string> = {
  main: "Core", security: "Security", control: "Control", monitor: "Monitor", system: "System",
};

function pageContent(page: string, t: any) {
  switch (page) {
    case "dashboard":     return <Dashboard t={t}/>;
    case "map":           return <MapPage t={t}/>;
    case "devices":       return <DevicesPage t={t}/>;
    case "vlans":         return <VlansPage t={t}/>;
    case "security":      return <SecurityPage t={t}/>;
    case "vulns":         return <VulnsPage t={t}/>;
    case "ssh":           return <SshPage t={t}/>;
    case "host":          return <HostPage t={t}/>;
    case "monitoring":    return <HostPage t={t}/>;
    case "notifications": return <NotificationsPage t={t}/>;
    case "logs":          return <LogsPage t={t}/>;
    case "reports":       return <ReportsPage t={t}/>;
    case "settings":      return <SettingsPage t={t}/>;
    case "users":         return <UsersPage t={t}/>;
    default:              return <Dashboard t={t}/>;
  }
}

export function AppShell() {
  const themeKey = useStore(s => s.themeKey);
  const rawT = THEMES[themeKey as keyof typeof THEMES] || THEMES.modern;
  const t = compatTheme(rawT);

  const [collapsed, setCollapsed] = useState(false);
  const { currentPage, setPage } = useStore();

  return (
    <>
      <style>{`
        @keyframes pulse { 0%,100% { opacity:1 } 50% { opacity:0.4 } }
        body { background: ${t.bg}; color: ${t.txt}; font-family: ${t.font}; }
      `}</style>
      <div style={{
        width: "100vw", height: "100vh", display: "flex",
        background: t.bg, color: t.txt, fontFamily: t.font, overflow: "hidden",
      }}>
        <Sidebar t={t} active={currentPage} onNav={setPage} collapsed={collapsed} onToggle={() => setCollapsed(c => !c)}/>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <TopBar t={t} page={currentPage}/>
          <div style={{ flex: 1, overflow: "auto" }}>
            {pageContent(currentPage, t)}
          </div>
        </div>
      </div>
      <DeviceDrawer theme={t}/>
    </>
  );
}

function Sidebar({ t, active, onNav, collapsed, onToggle }: any) {
  const groups = [...new Set(NAV.map(n => n.group))];
  return (
    <aside style={{
      width: collapsed ? 60 : 220, flexShrink: 0,
      background: t.sidebar, backdropFilter: t.glass,
      borderRight: `1px solid ${t.border}`,
      display: "flex", flexDirection: "column",
      transition: "width 0.25s ease", overflow: "hidden", height: "100vh",
    }}>
      {/* Logo */}
      <div style={{ padding: "18px 16px 16px", borderBottom: `1px solid ${t.border}`, display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{
          width: 30, height: 30, borderRadius: t.radius, flexShrink: 0,
          background: t.grad, display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 14, color: t.id === "minimal" ? "#fff" : "#000", fontWeight: 800, fontFamily: t.headFont,
        }}>
          {t.useEmoji ? "🌐" : "M"}
        </div>
        {!collapsed && <span style={{ color: t.txt, fontFamily: t.headFont, fontWeight: 700, fontSize: 15, letterSpacing: t.id === "enterprise" ? "0.04em" : "-0.02em", textTransform: t.id === "enterprise" ? "uppercase" : "none" }}>MapMyLAN</span>}
      </div>

      {/* Nav */}
      <nav style={{ flex: 1, overflowY: "auto", padding: "8px 0" }}>
        {groups.map(g => (
          <div key={g}>
            {!collapsed && (
              <div style={{
                color: t.muted, fontSize: 9.5, textTransform: "uppercase",
                letterSpacing: "0.1em", padding: "12px 16px 4px", fontWeight: 600, fontFamily: t.monoFont,
              }}>{GROUPS[g]}</div>
            )}
            {NAV.filter(n => n.group === g).map(n => {
              const isActive = active === n.id;
              return (
                <button key={n.id} onClick={() => onNav(n.id)} style={{
                  display: "flex", alignItems: "center", gap: 10,
                  width: "100%", padding: collapsed ? "10px 15px" : "9px 16px",
                  background: isActive ? `${t.primary}18` : "transparent",
                  border: "none",
                  borderLeft: isActive ? `3px solid ${t.primary}` : "3px solid transparent",
                  cursor: "pointer", color: isActive ? t.primary : t.muted,
                  fontSize: 13, fontFamily: t.font,
                  transition: "all 0.15s",
                  justifyContent: collapsed ? "center" : "flex-start",
                  fontWeight: isActive ? 600 : 400,
                }}>
                  <span style={{ fontSize: 15, flexShrink: 0, fontFamily: t.useEmoji ? t.font : t.monoFont }}>
                    {t.useEmoji ? n.icon : n.glyph}
                  </span>
                  {!collapsed && <span>{n.label}</span>}
                </button>
              );
            })}
          </div>
        ))}
      </nav>

      <div style={{ padding: 12, borderTop: `1px solid ${t.border}` }}>
        <button onClick={onToggle} style={{
          width: "100%", background: t.surface, border: `1px solid ${t.border}`,
          borderRadius: t.radius, padding: "8px",
          cursor: "pointer", color: t.muted, fontSize: 13, fontFamily: t.monoFont,
        }}>
          {collapsed ? "→" : "← Collapse"}
        </button>
      </div>
    </aside>
  );
}

function TopBar({ t, page }: any) {
  const { setTheme, logout, stats } = useStore(s => ({
    setTheme: s.setTheme, logout: s.logout, stats: s.stats,
  }));
  const [now, setNow] = useState(new Date());
  useEffect(() => { const i = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(i); }, []);
  const navItem = NAV.find(n => n.id === page);
  const onlineCount = stats?.online || 0;
  const suspectCount = stats?.suspect || 0;
  const bannedCount = (stats?.banned || 0) + (stats?.quarantined || 0);

  return (
    <div style={{
      background: `${t.sidebar}`,
      backdropFilter: t.glass,
      borderBottom: `1px solid ${t.border}`,
      padding: "0 20px", height: 54,
      display: "flex", alignItems: "center", gap: 12,
      flexShrink: 0, position: "sticky", top: 0, zIndex: 100,
    }}>
      <span style={{ color: t.txt, fontFamily: t.headFont, fontWeight: 600, fontSize: 14, flex: 1, display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 16 }}>{t.useEmoji ? navItem?.icon : navItem?.glyph}</span>
        {navItem?.label || "MapMyLAN"}
      </span>

      {/* Live counters */}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Pill t={t} color={t.ok}>⬤ {onlineCount} online</Pill>
        {suspectCount > 0 && <Pill t={t} color={t.err}>⚠ {suspectCount} suspect</Pill>}
        {bannedCount > 0 && <Pill t={t} color={t.warn}>⛔ {bannedCount} blocked</Pill>}
      </div>

      {/* Theme switcher */}
      <select value={t.id} onChange={e => setTheme(e.target.value)} style={{
        background: t.surface, border: `1px solid ${t.border}`, color: t.txt,
        borderRadius: t.radius, padding: "5px 9px", fontSize: 12,
        fontFamily: t.font, cursor: "pointer", outline: "none",
      }}>
        {Object.values(THEMES).map(th => <option key={th.id} value={th.id}>{th.name}</option>)}
      </select>

      <span style={{ color: t.muted, fontFamily: t.monoFont, fontSize: 11, minWidth: 60 }}>
        {now.toLocaleTimeString()}
      </span>

      <button onClick={logout} title="Logout" style={{
        background: t.surface, border: `1px solid ${t.border}`,
        color: t.muted, borderRadius: t.radius, padding: "6px 10px",
        cursor: "pointer", fontSize: 14,
      }}>⏻</button>
    </div>
  );
}

function Pill({ t, color, children }: any) {
  return (
    <span style={{
      background: `${color}1f`, border: `1px solid ${color}40`,
      color, padding: "3px 10px", borderRadius: 999,
      fontSize: 11.5, fontFamily: t.monoFont, whiteSpace: "nowrap",
    }}>{children}</span>
  );
}
