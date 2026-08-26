// Pièces propres à la disposition « atelier ».
//
// Barre supérieure, rail à pictos, explorateur en arbre, dock d'état. Elles
// sont montées en permanence par AppShell ; c'est la feuille de la maquette
// qui les masque en disposition « lecture », via data-shell sur <html>.
//
// Rien ici ne duplique le contenu des pages : l'atelier montre le même écran,
// entouré d'outils. On change de point de vue, pas de logiciel.

import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../../stores/app";
import { Icon, deviceIcon } from "../../lib/icons";
import { useT, useLang } from "../../lib/i18n";
import { resolveTheme } from "../../lib/themes";

// ─── Barre supérieure ──────────────────────────────────────────────────────

export function WorkshopTop() {
  const s = useT();
  const themeKey = useStore(st => st.themeKey);
  const setTheme = useStore(st => st.setTheme);
  const logout = useStore(st => st.logout);
  const setPage = useStore(st => st.setPage);
  const devices = useStore(st => st.devices);
  const selectDevice = useStore(st => st.selectDevice);
  const sombre = resolveTheme(themeKey) === "dark";
  const [q, setQ] = useState("");

  const trouves = useMemo(() => {
    const r = q.trim().toLowerCase();
    if (!r) return [];
    return devices.filter((d: any) =>
      [d.ip, d.mac, d.hostname, d.customName, d.vendor]
        .filter(Boolean).some((v: any) => String(v).toLowerCase().includes(r))
    ).slice(0, 8);
  }, [devices, q]);

  return (
    <div className="wtop">
      <div className="brand">
        <img className="marque" src="/logo.png" alt="MapMyLAN"/>
        <div><b>MapMyLAN</b> <span>{devices.length} hôtes</span></div>
      </div>

      <div style={{ flex: 1, display: "flex", justifyContent: "center", position: "relative" }}>
        <label className="wcmd">
          <Icon name="search" size={13}/>
          <input placeholder={s("top.search")} value={q} onChange={e => setQ(e.target.value)}/>
          <kbd>⌘K</kbd>
        </label>
        {trouves.length > 0 && (
          <div style={{
            position: "absolute", top: 34, width: 520, maxWidth: "100%", zIndex: 60,
            background: "var(--surface)", borderRadius: 10, boxShadow: "var(--lift-hi)", padding: 4,
          }}>
            {trouves.map((d: any) => (
              <button key={d.id} className="trow" onClick={() => { selectDevice(d.id); setQ(""); }}>
                <span className="ic"><Icon name={deviceIcon(d.customType || d.type)} size={13}/></span>
                <span className="nm2">{d.customName || d.hostname || d.ip}</span>
                <span className="ipx2">{d.ip}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div style={{ display: "flex", gap: 3, color: "var(--muted)" }}>
        <button className="ghost" style={{ width: 28, height: 28 }}
          title={s("top.notifications")} onClick={() => setPage("notifications")}>
          <Icon name="bell" size={15}/>
        </button>
        <button className="ghost" style={{ width: 28, height: 28 }}
          title={s("top.appearance")} onClick={() => setTheme(sombre ? "light" : "dark")}>
          <Icon name="mode" size={15}/>
        </button>
        <button className="ghost" style={{ width: 28, height: 28 }}
          title={s("top.logout")} onClick={logout}>
          <Icon name="power" size={15}/>
        </button>
      </div>
    </div>
  );
}

// ─── Rail à pictos ─────────────────────────────────────────────────────────

export function WorkshopRail({ items, bas, active, onNav }: {
  items: { id: string; icon: string; court: string }[];
  bas: { id: string; icon: string; court: string }[];
  active: string;
  onNav: (p: string) => void;
}) {
  const bouton = (r: { id: string; icon: string; court: string }) => (
    <button key={r.id} className={active === r.id ? "ri on" : "ri"} onClick={() => onNav(r.id)}>
      <Icon name={r.icon} size={19}/><em>{r.court}</em>
    </button>
  );
  return (
    <nav className="wrail">
      {items.map(bouton)}
      <div className="bot">{bas.map(bouton)}</div>
    </nav>
  );
}

// ─── Explorateur ───────────────────────────────────────────────────────────

/** Segment d'appartenance d'une adresse : le /24 qui la contient. */
function segment(ip: string): string {
  const m = /^(\d+\.\d+\.\d+)\.\d+$/.exec(ip || "");
  return m ? `${m[1]}.0/24` : "—";
}
function dernierOctet(ip: string): number {
  return Number((ip || "").split(".")[3]) || 0;
}

/**
 * L'arbre suit le découpage réel du réseau : un groupe par VLAN déclaré, et
 * pour les appareils qui n'en portent pas, un groupe par sous-réseau. Rien
 * n'est inventé — si le parc est plat, l'arbre l'est aussi.
 */
export function ExplorerTree() {
  const s = useT();
  const devices = useStore(st => st.devices);
  const vlans = useStore(st => st.vlans);
  const selectDevice = useStore(st => st.selectDevice);
  const selectedId = useStore(st => st.selectedDeviceId);
  const [replies, setReplies] = useState<Record<string, boolean>>({});

  const groupes = useMemo(() => {
    // Le rang est numérique, pas alphabétique. Trié comme du texte,
    // « VLAN 10 » passe devant « VLAN 2 », et « 192.0.10.0/24 » devant
    // « 192.0.2.0/24 » : l'explorateur affichait 10, 2, 20, 30 au lieu de
    // 1, 10, 20, 30. On classe donc par numéro de VLAN, et à défaut par les
    // octets du sous-réseau — les groupes sans VLAN venant après ceux qui en
    // ont un.
    const parVlan = new Map<string, { nom: string; rang: number[]; liste: any[] }>();
    for (const d of devices) {
      const v = vlans.find((x: any) => x.id === (d.vlan ?? d.vlanId));
      const nom = v ? `VLAN ${v.id} · ${v.name}` : segment(d.ip);
      const rang = v
        ? [0, v.id, 0, 0, 0]
        : [1, ...String(segment(d.ip)).split(/[./]/).map((n) => Number(n) || 0)];
      if (!parVlan.has(nom)) parVlan.set(nom, { nom, rang, liste: [] });
      parVlan.get(nom)!.liste.push(d);
    }
    const avant = (a: number[], b: number[]) => {
      for (let i = 0; i < Math.max(a.length, b.length); i++) {
        const d = (a[i] ?? 0) - (b[i] ?? 0);
        if (d) return d;
      }
      return 0;
    };
    return [...parVlan.values()]
      .map((g) => ({ ...g, liste: g.liste.sort((a, b) => dernierOctet(a.ip) - dernierOctet(b.ip)) }))
      .sort((a, b) => avant(a.rang, b.rang) || a.nom.localeCompare(b.nom, "fr"));
  }, [devices, vlans]);

  const couleurEtat = (st: string) =>
    st === "online" ? "var(--accent)"
      : st === "banned" || st === "suspect" ? "var(--alarm)"
      : st === "quarantined" ? "var(--warn)" : "var(--faint)";

  return (
    <aside className="explorer">
      <div className="exhead"><span>{s("explorer.title")}</span><span className="cnt">{devices.length}</span></div>

      <div className="tree">
        {groupes.length === 0 && (
          <div style={{ padding: "18px 10px", color: "var(--faint)", fontSize: 12 }}>{s("explorer.empty")}</div>
        )}
        {groupes.map(g => {
          const replie = replies[g.nom];
          return (
            <div key={g.nom}>
              <button className="secttl" style={{ display: "flex", gap: 6, width: "100%", textAlign: "left" }}
                onClick={() => setReplies(r => ({ ...r, [g.nom]: !r[g.nom] }))}>
                <span style={{ width: 9 }}>{replie ? "▸" : "▾"}</span>{g.nom}
              </button>
              {!replie && g.liste.map((d: any) => (
                <button key={d.id}
                  className={selectedId === d.id ? "trow ind2 sel" : "trow ind2"}
                  onClick={() => selectDevice(d.id)}>
                  <span className="ic"><Icon name={deviceIcon(d.customType || d.type)} size={13}/></span>
                  <span className="nm2">{d.customName || d.hostname || d.ip}</span>
                  <span className="ipx2">{d.ip}</span>
                  <span className="dd" style={{ background: couleurEtat(d.status) }}/>
                </button>
              ))}
            </div>
          );
        })}
      </div>

      <Pied/>
    </aside>
  );
}

function Pied() {
  const s = useT();
  const scanRunning = useStore(st => st.scanRunning);
  const [reste, setReste] = useState(300);
  useEffect(() => {
    const i = setInterval(() => setReste(v => (v <= 0 ? 300 : v - 1)), 1000);
    return () => clearInterval(i);
  }, []);
  const mmss = `${Math.floor(reste / 60)}:${String(reste % 60).padStart(2, "0")}`;
  return (
    <div className="exfoot">
      <Icon name="clock" size={13}/>{s("rail.next")}<b>{scanRunning ? "…" : mmss}</b>
    </div>
  );
}

// ─── Dock ──────────────────────────────────────────────────────────────────

export function Dock() {
  const s = useT();
  const logs = useStore(st => st.logs);
  const alerts = useStore(st => st.alerts);
  const devices = useStore(st => st.devices);
  const vlans = useStore(st => st.vlans);
  const hostStats = useStore(st => st.hostStats);
  const [onglet, setOnglet] = useState<"log" | "scan" | "alerts">("log");
  const corps = useRef<HTMLDivElement>(null);

  // Le dock suit le direct : chaque nouvelle ligne fait défiler vers le bas,
  // sauf si on est remonté lire quelque chose.
  useEffect(() => {
    const el = corps.current;
    if (!el) return;
    const enBas = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    if (enBas) el.scrollTop = el.scrollHeight;
  }, [logs, alerts, onglet]);

  const lignes = onglet === "alerts"
    ? alerts.slice(0, 60).map((a: any) => ({
        id: a.id, t: new Date(a.createdAt), src: a.source || "alerte",
        msg: a.message, niveau: a.severity,
      }))
    : logs
        .filter((l: any) => onglet === "log" || /scan|balay/i.test(String(l.source || "")))
        .slice(0, 120)
        .map((l: any) => ({ id: l.id, t: new Date(l.createdAt), src: l.source, msg: l.message, niveau: l.level }));

  const couleur = (n: string) =>
    n === "error" || n === "critical" || n === "high" ? "var(--alarm)"
      : n === "warn" || n === "medium" ? "var(--warn)"
      : n === "success" ? "var(--accent)" : "var(--ink-soft)";

  const portsOuverts = devices.reduce((n: number, d: any) => n + (d.ports?.length || 0), 0);
  const enLigne = devices.filter((d: any) => d.status === "online").length;

  // Les conteneurs remontés par la machine hôte, à défaut le seul service dont
  // on est certain : c'est lui qui répond, sinon la page ne s'afficherait pas.
  const conteneurs = (hostStats?.containers || []).map((c: any) => ({ nom: c.name, ok: c.state === "running" }));
  const services = conteneurs.length ? conteneurs.slice(0, 4) : [{ nom: "backend", ok: true }];

  return (
    <div className="dock">
      <div className="dterm">
        <div className="dtabs">
          <button className={onglet === "log" ? "dtab on" : "dtab"} onClick={() => setOnglet("log")}>{s("dock.journal")}</button>
          <button className={onglet === "scan" ? "dtab on" : "dtab"} onClick={() => setOnglet("scan")}>{s("dock.scans")}</button>
          <button className={onglet === "alerts" ? "dtab on" : "dtab"} onClick={() => setOnglet("alerts")}>{s("dock.alerts")}</button>
        </div>
        <div className="dbody" ref={corps}>
          {lignes.length === 0 && <div style={{ color: "var(--faint)" }}>{s("dock.empty")}</div>}
          {lignes.map(l => (
            <div key={l.id}>
              <span className="t">{l.t.toLocaleTimeString()}</span>{" "}
              <span style={{ color: "var(--faint)" }}>{l.src}</span>{" "}
              <span style={{ color: couleur(l.niveau) }}>{l.msg}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="dside">
        <h4>{s("dock.sweep")}</h4>
        <div className="krow"><span>{s("dock.hosts")}</span><b>{devices.length}</b></div>
        <div className="krow"><span>{s("dock.online")}</span><b>{enLigne}</b></div>
        <div className="krow"><span>{s("dock.ports")}</span><b>{portsOuverts}</b></div>
        <div className="krow"><span>VLAN</span><b>{vlans.length}</b></div>
      </div>

      <div className="dside">
        <h4>{s("dock.state")}</h4>
        {services.map(sv => (
          <div className="srow" key={sv.nom}>
            {sv.nom}
            <span className="s">
              <i className="d" style={{ background: sv.ok ? "var(--accent)" : "var(--alarm)" }}/>
              {sv.ok ? s("dock.up") : s("dock.down")}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// Compatibilité : d'anciens appels attendaient un composant plein écran.
// La coquille est désormais unique — on renvoie simplement le contenu.
export function WorkshopShell({ t, pageContent }: { t: any; pageContent: (p: string, t: any) => any }) {
  const currentPage = useStore(s => s.currentPage);
  return <>{pageContent(currentPage, t)}</>;
}
