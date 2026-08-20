// All v2.2 pages. Each page receives `t` (compat-extended theme).
// Rich Modern layout per maquette. Minimal/Enterprise simplify or restyle.

import { useEffect, useMemo, useState } from "react";
import { useStore } from "../stores/app";
import { translate as tr } from "../lib/i18n";
import { api, setCsrfToken } from "../api/client";
import { DeviceIcon } from "../components/ui/DeviceIcon";
import { CiscoIcon } from "../components/ui/CiscoIcon";
import { TopologyMap } from "../components/topology/TopologyMap";
import {
  Card, StatusDot, RiskBadge, SeverityBadge, Sparkline, MiniBar, ScoreGauge,
  LiveDot, PrimaryBtn, GhostBtn, Empty, inputStyle, smallLabel,
} from "../components/ui/Primitives";

const fmtDate = (d: any) => d ? new Date(d).toLocaleString() : "—";

// Reduces a bot response (Telegram-style HTML formatting) to plain text.
// Used to show the command test preview without ever interpreting HTML:
// the response contains data announced by devices, so it is untrusted.
function stripTags(s: any): string {
  const str = String(s ?? "");
  return str
    .replace(/<[^>]*>/g, "")          // strip every tag
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");          // last, so as not to reintroduce entities
}

const PAGE: any = { padding: 20, display: "flex", flexDirection: "column", gap: 16 };

function genSpark(seed = 1, count = 20): number[] {
  const arr: number[] = [];
  let v = 30 + Math.random() * 40;
  for (let i = 0; i < count; i++) {
    v += (Math.random() - 0.5) * 15;
    v = Math.max(0, Math.min(100, v));
    arr.push(Math.round(v));
  }
  return arr;
}

function devIcon(t: any, type: string, size = 28, color?: string, dim?: boolean) {
  return t.useCisco
    ? <CiscoIcon type={type} size={size + 8} color={color || t.primary} dim={dim}/>
    : <DeviceIcon type={type} size={size} color={color || t.primary} dim={dim}/>;
}

const TYPE_EMOJI: Record<string, string> = {
  router: "🌐", switch: "🔀", ap: "📡", firewall: "🛡",
  server: "🖥️", laptop: "💻", phone: "📱", tablet: "📱",
  iot: "⚡", printer: "🖨", camera: "📷", tv: "📺",
  console: "🎮", sensor: "🌡", vm: "📦", container: "🐳",
  unknown: "❓",
};

function deviceGlyph(t: any, d: any, size = 22) {
  const effectiveType = d.customType || d.type;
  if (t.useCisco) return devIcon(t, effectiveType, size + 6);
  if (t.useEmoji) return <span style={{ fontSize: size - 4 }}>{TYPE_EMOJI[effectiveType] || "❓"}</span>;
  return devIcon(t, effectiveType, size, t.primary, d.status === "offline");
}

// ════════════════════════════════════════════════════════════════════════════
// DASHBOARD — Hero + 4 KPI cards + Throughput + Activity + Quick Devices
// ════════════════════════════════════════════════════════════════════════════
export function Dashboard({ t }: { t: any }) {
  const { devices, alerts, healthScore, hostStats, stats, scanRunning, triggerScan } = useStore();
  const select = (id: string) => useStore.getState().selectDevice(id);

  // Stable per-device sparklines
  const sparkData = useMemo(() => devices.slice(0, 4).map((_, i) => genSpark(i)), [devices.length]);
  const heroSpark = useMemo(() => genSpark(99, 24), []);

  const kpis = [
    { label: "Online", value: stats.online, hint: "Active on network", color: t.ok, icon: "⬤" },
    { label: "Offline", value: stats.offline, hint: "Not responding", color: t.muted, icon: "○" },
    { label: "Suspect", value: stats.suspect, hint: "Attention needed", color: t.err, icon: "⚠" },
    { label: "VLANs", value: stats.vlans, hint: "Segmented subnets", color: t.primary, icon: "🔀" },
  ];

  return (
    <div style={PAGE}>
      {/* HERO ─── only modern + enterprise show this */}
      {t.showHero && (
        <Card t={t} padding={28} style={{ overflow: "hidden" }}>
          <div style={{
            position: "absolute", top: -60, right: -60, width: 240, height: 240,
            borderRadius: "50%", background: `${t.primary}15`, filter: "blur(40px)", pointerEvents: "none",
          }}/>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", position: "relative" }}>
            <div>
              <div style={{
                display: "inline-flex", alignItems: "center", gap: 6,
                background: `${t.primary}12`, border: `1px solid ${t.primary}30`,
                borderRadius: 999, padding: "3px 10px", fontSize: 11, color: t.primary,
                marginBottom: 12, fontFamily: t.monoFont,
              }}>
                <LiveDot color={t.ok}/>
                Live · {stats.vlans} VLANs · {devices.length} devices
              </div>
              <h1 style={{ color: t.txt, fontFamily: t.headFont, fontSize: 28, fontWeight: 700, margin: 0, letterSpacing: "-0.02em" }}>
                Welcome back to{" "}
                <span style={{ background: t.grad, WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>MapMyLAN</span>
              </h1>
              <p style={{ color: t.muted, fontSize: 14, marginTop: 8, maxWidth: 560 }}>
                Real-time visibility, security scoring, and SSH-based defense for your entire network fabric.
              </p>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
              <div style={{ textAlign: "right" }}>
                <div style={{ color: t.muted, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.08em", fontFamily: t.monoFont }}>Security Score</div>
                <div style={{ fontFamily: t.headFont, fontSize: 32, fontWeight: 700, color: t.txt, lineHeight: 1.1 }}>
                  {healthScore}<span style={{ fontSize: 14, color: t.muted }}>/100</span>
                </div>
              </div>
              <ScoreGauge score={100 - healthScore} t={t} size={80}/>
            </div>
          </div>
        </Card>
      )}

      {/* MINIMAL HEADER ─── replacement for hero */}
      {!t.showHero && (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", padding: "0 4px" }}>
          <div>
            <h1 style={{ color: t.txt, fontFamily: t.headFont, fontSize: 24, fontWeight: 600, margin: 0, letterSpacing: "-0.02em" }}>
              Dashboard
            </h1>
            <p style={{ color: t.muted, fontSize: 13, marginTop: 4 }}>
              {devices.length} devices · {stats.vlans} VLANs · health {healthScore}/100
            </p>
          </div>
          <PrimaryBtn t={t} onClick={() => triggerScan()} disabled={scanRunning}>{scanRunning ? "Scanning…" : "Scan"}</PrimaryBtn>
        </div>
      )}

      {/* KPI ROW */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
        {kpis.map((k, i) => (
          <Card key={i} t={t} padding={18}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div>
                <div style={{ color: t.muted, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.08em", fontFamily: t.monoFont }}>{k.label}</div>
                <div style={{ color: t.txt, fontFamily: t.headFont, fontSize: 32, fontWeight: 700, marginTop: 4 }}>{k.value}</div>
                <div style={{ color: t.muted, fontSize: 11, marginTop: 2 }}>{k.hint}</div>
              </div>
              <div style={{ fontSize: 18, opacity: 0.6, color: k.color }}>{t.useEmoji ? k.icon : "·"}</div>
            </div>
            {t.showSparklines && (
              <div style={{ marginTop: 10 }}>
                <Sparkline data={sparkData[i] || genSpark(i)} color={k.color} w={200} h={28}/>
              </div>
            )}
          </Card>
        ))}
      </div>

      {/* TWO-COLUMN: Activity feed + Top risk */}
      <div style={{ display: "grid", gridTemplateColumns: t.showSparklines ? "1.4fr 1fr" : "1fr 1fr", gap: 14 }}>
        {/* Top risk devices */}
        <Card t={t} padding={0}>
          <div style={{ padding: "14px 18px", borderBottom: `1px solid ${t.border}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <div style={{ color: t.txt, fontWeight: 600, fontFamily: t.headFont, fontSize: 14 }}>Top Risk Devices</div>
              <div style={{ color: t.muted, fontSize: 11.5, marginTop: 2 }}>Sorted by danger score</div>
            </div>
            <span style={{ color: t.muted, fontSize: 11, fontFamily: t.monoFont }}>{devices.length} total</span>
          </div>
          <div>
            {[...devices].sort((a, b) => b.dangerScore - a.dangerScore).slice(0, 6).map(d => {
              const c = d.dangerScore > 70 ? t.err : d.dangerScore > 40 ? t.warn : t.ok;
              return (
                <div key={d.id} onClick={() => select(d.id)}
                  style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 18px", borderTop: `1px solid ${t.border}40`, cursor: "pointer" }}
                  onMouseEnter={e => e.currentTarget.style.background = t.surfaceHover}
                  onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                  {deviceGlyph(t, d, 28)}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ color: t.txt, fontSize: 13, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {d.customName || d.hostname || d.ip}
                    </div>
                    <div style={{ color: t.muted, fontSize: 10.5, fontFamily: t.monoFont }}>
                      {d.ip} · {d.vendor || "Unknown"}
                    </div>
                  </div>
                  <RiskBadge score={d.dangerScore} t={t}/>
                </div>
              );
            })}
            {devices.length === 0 && <Empty t={t} text="No devices yet — trigger a scan" icon="◯"/>}
          </div>
        </Card>

        {/* Live activity */}
        <Card t={t} padding={0}>
          <div style={{ padding: "14px 18px", borderBottom: `1px solid ${t.border}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <div style={{ color: t.txt, fontWeight: 600, fontFamily: t.headFont, fontSize: 14 }}>Live Activity</div>
              <div style={{ color: t.muted, fontSize: 11.5, marginTop: 2 }}>Latest events</div>
            </div>
            <LiveDot color={t.ok}/>
          </div>
          <div style={{ maxHeight: 280, overflow: "auto" }}>
            {alerts.slice(0, 8).map(a => (
              <div key={a.id} style={{
                display: "flex", gap: 10, padding: "9px 18px",
                borderTop: `1px solid ${t.border}40`,
                background: a.severity === "critical" || a.severity === "high" ? `${t.err}06` : "transparent",
              }}>
                <SeverityBadge severity={a.severity} t={t}/>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ color: t.txt, fontSize: 12 }}>{a.message}</div>
                  <div style={{ color: t.muted, fontFamily: t.monoFont, fontSize: 10, marginTop: 2 }}>
                    {a.source} · {new Date(a.createdAt).toLocaleTimeString()}
                  </div>
                </div>
              </div>
            ))}
            {alerts.length === 0 && <Empty t={t} text="Network calm" icon="✓"/>}
          </div>
        </Card>
      </div>

      {/* QUICK DEVICES (modern only) */}
      {t.showSparklines && devices.length > 0 && (
        <Card t={t} padding={0}>
          <div style={{ padding: "14px 18px", borderBottom: `1px solid ${t.border}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ color: t.txt, fontWeight: 600, fontFamily: t.headFont, fontSize: 14 }}>Devices — Quick View</div>
            <span style={{ color: t.muted, fontSize: 11, fontFamily: t.monoFont }}>{devices.length} discovered</span>
          </div>
          <div style={{ padding: 14, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 8 }}>
            {devices.slice(0, 12).map(d => (
              <div key={d.id} onClick={() => select(d.id)}
                style={{
                  background: t.surfaceHover, border: `1px solid ${t.border}`, borderRadius: t.radius,
                  padding: "10px 12px", display: "flex", alignItems: "center", gap: 10, cursor: "pointer",
                }}>
                {deviceGlyph(t, d, 22)}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ color: t.txt, fontSize: 12, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {d.customName || d.hostname || d.ip}
                  </div>
                  <div style={{ color: t.muted, fontFamily: t.monoFont, fontSize: 10 }}>{d.ip}</div>
                </div>
                <StatusDot status={d.status} t={t}/>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Host quick stats (if available) */}
      {hostStats && (
        <Card t={t} padding={0}>
          <div style={{ padding: "14px 18px", borderBottom: `1px solid ${t.border}` }}>
            <div style={{ color: t.txt, fontWeight: 600, fontFamily: t.headFont, fontSize: 14 }}>Host (NUC) — at a glance</div>
          </div>
          <div style={{ padding: 18, display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 18 }}>
            {[
              { label: "CPU", value: `${hostStats.cpuPct}%`, bar: hostStats.cpuPct, color: hostStats.cpuPct > 80 ? t.err : t.primary },
              { label: "Memory", value: `${hostStats.memPct}%`, bar: hostStats.memPct, color: hostStats.memPct > 85 ? t.err : t.accent, sub: `${hostStats.memUsedMB}/${hostStats.memTotalMB} MB` },
              { label: "Disk", value: `${hostStats.diskPct}%`, bar: hostStats.diskPct, color: hostStats.diskPct > 90 ? t.err : t.ok },
              { label: "Uptime", value: fmtUptime(hostStats.uptimeSec), color: t.info, sub: hostStats.tempC ? `${hostStats.tempC}°C` : undefined },
            ].map(k => (
              <div key={k.label}>
                <div style={{ color: t.muted, fontSize: 10.5, textTransform: "uppercase", letterSpacing: "0.08em", fontFamily: t.monoFont }}>{k.label}</div>
                <div style={{ color: t.txt, fontFamily: t.headFont, fontSize: 22, fontWeight: 700, marginTop: 2 }}>{k.value}</div>
                {k.bar != null && <div style={{ marginTop: 6 }}><MiniBar value={k.bar} color={k.color}/></div>}
                {k.sub && <div style={{ color: t.muted, fontSize: 10.5, marginTop: 4, fontFamily: t.monoFont }}>{k.sub}</div>}
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

function fmtUptime(s: number): string {
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  return `${d}d ${h}h ${m}m`;
}

// ════════════════════════════════════════════════════════════════════════════
// NETWORK MAP
// ════════════════════════════════════════════════════════════════════════════
export function MapPage({ t }: { t: any }) {
  return (
    <div style={{ padding: 20, height: "calc(100% - 0px)", display: "flex", flexDirection: "column", gap: 12 }}>
      <Card t={t} padding={14} style={{ flex: 0 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ color: t.txt, fontWeight: 600, fontFamily: t.headFont, fontSize: 14 }}>Network Topology</div>
            <div style={{ color: t.muted, fontSize: 11.5, marginTop: 2 }}>Drag to rearrange · Right-click for actions · Scroll to zoom</div>
          </div>
        </div>
      </Card>
      <Card t={t} padding={0} style={{ flex: 1, position: "relative", overflow: "hidden", minHeight: 500 }}>
        <TopologyMap theme={t}/>
      </Card>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// DEVICES
// ════════════════════════════════════════════════════════════════════════════
export function DevicesPage({ t }: { t: any }) {
  const { devices, triggerScan, scanRunning } = useStore();
  const select = (id: string) => useStore.getState().selectDevice(id);
  const [filter, setFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  const filtered = useMemo(() => devices.filter(d => {
    if (statusFilter !== "all" && d.status !== statusFilter) return false;
    if (!filter) return true;
    const q = filter.toLowerCase();
    return [d.ip, d.mac, d.hostname, d.customName, d.vendor, d.type, d.os, ...(d.tags || [])]
      .filter(Boolean).some(v => String(v).toLowerCase().includes(q));
  }), [devices, filter, statusFilter]);

  return (
    <div style={PAGE}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
        <div>
          <h1 style={{ color: t.txt, fontFamily: t.headFont, fontSize: 22, fontWeight: 700, margin: 0 }}>Devices</h1>
          <div style={{ color: t.muted, fontSize: 12, marginTop: 4 }}>{filtered.length} of {devices.length} shown</div>
        </div>
        <PrimaryBtn t={t} onClick={() => triggerScan()} disabled={scanRunning}>{scanRunning ? "Scanning…" : "↻ Scan"}</PrimaryBtn>
      </div>

      <div style={{ display: "flex", gap: 8 }}>
        <input placeholder="Search IP, MAC, vendor, hostname…" value={filter} onChange={e => setFilter(e.target.value)} style={{ ...inputStyle(t), flex: 1 }}/>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={{ ...inputStyle(t), width: 160 }}>
          {["all", "online", "offline", "suspect", "banned", "quarantined"].map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      <Card t={t} padding={0}>
        <div style={{ display: "grid", gridTemplateColumns: "auto 2fr 1.5fr 1fr 1fr 1fr 0.6fr", padding: "11px 18px", color: t.muted, fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600, borderBottom: `1px solid ${t.border}`, fontFamily: t.monoFont, gap: 14 }}>
          <span></span><span>Device</span><span>IP / MAC</span><span>Vendor</span><span>Type</span><span>Trust</span><span style={{ textAlign: "right" }}>Risk</span>
        </div>
        {filtered.map(d => (
          <div key={d.id} onClick={() => select(d.id)} style={{
            display: "grid", gridTemplateColumns: "auto 2fr 1.5fr 1fr 1fr 1fr 0.6fr",
            alignItems: "center", padding: "11px 18px", gap: 14,
            borderTop: `1px solid ${t.border}40`, cursor: "pointer",
          }}
            onMouseEnter={e => e.currentTarget.style.background = t.surfaceHover}
            onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
            {deviceGlyph(t, d, 24)}
            <div>
              <div style={{ color: t.txt, fontSize: 13, fontWeight: 600 }}>{d.customName || d.hostname || d.ip}</div>
              <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 2 }}>
                <StatusDot status={d.status} t={t}/>
                <span style={{ color: t.muted, fontSize: 10.5, fontFamily: t.monoFont }}>{d.status}</span>
                {d.isMainRouter && <span style={{ background: `${t.ok}20`, color: t.ok, padding: "1px 5px", borderRadius: 3, fontSize: 9, fontWeight: 700, letterSpacing: "0.06em", fontFamily: t.monoFont }}>ROUTER</span>}
                {d.whitelisted && !d.isMainRouter && <span style={{ background: `${t.info}20`, color: t.info, padding: "1px 5px", borderRadius: 3, fontSize: 9, fontWeight: 700, letterSpacing: "0.06em", fontFamily: t.monoFont }}>WL</span>}
              </div>
            </div>
            <div>
              <div style={{ color: t.txt, fontSize: 12, fontFamily: t.monoFont }}>{d.ip}</div>
              <div style={{ color: t.muted, fontSize: 10.5, fontFamily: t.monoFont }}>{d.mac || "—"}</div>
            </div>
            <div style={{ color: t.txt, fontSize: 12 }}>{d.vendor || "Unknown"}</div>
            <div style={{ color: t.muted, fontSize: 12, fontFamily: t.monoFont }}>{d.customType || d.type}</div>
            <div><MiniBar value={d.trustScore} color={t.ok}/></div>
            <div style={{ textAlign: "right" }}><RiskBadge score={d.dangerScore} t={t}/></div>
          </div>
        ))}
        {filtered.length === 0 && <Empty t={t} text="No devices match" icon="◯"/>}
      </Card>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// VLANS
// ════════════════════════════════════════════════════════════════════════════
export function VlansPage({ t }: { t: any }) {
  const vlans = useStore(s => s.vlans);
  const devices = useStore(s => s.devices);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);
  const [form, setForm] = useState<any>({ id: 10, name: "", subnet: "", color: "#22d3ee", isolated: false, pushToRouter: true });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  const reload = async () => {
    const list = await api.listVlans();
    useStore.setState({ vlans: list });
  };

  const startAdd = () => {
    setForm({ id: (vlans.reduce((m, v) => Math.max(m, v.id), 0) || 0) + 1, name: "", subnet: "", color: "#22d3ee", isolated: false, pushToRouter: true });
    setAdding(true); setEditing(null); setMsg(null);
  };
  const startEdit = (v: any) => { setForm({ ...v }); setEditing(v.id); setAdding(false); setMsg(null); };
  const save = async () => {
    setBusy(true); setMsg(null);
    try {
      if (editing != null) {
        await api.updateVlan(editing, { name: form.name, subnet: form.subnet, color: form.color, description: form.description, isolated: form.isolated });
        setEditing(null);
      } else {
        const r = await api.createVlan(form);
        setAdding(false);
        if (r?.provision?.pushed) setMsg({ type: "ok", text: `VLAN ${form.id} pushed to ${r.provision.vendor}` });
        else if (r?.provision?.output) setMsg({ type: "err", text: r.provision.output });
        else setMsg({ type: "ok", text: `VLAN ${form.id} saved (DB only)` });
      }
      await reload();
    } catch (e: any) { setMsg({ type: "err", text: e.message }); }
    finally { setBusy(false); }
  };
  const del = async (v: any) => {
    if (!confirm(`Delete VLAN ${v.id} (${v.name})? Will also remove from main router via SSH.`)) return;
    setBusy(true); setMsg(null);
    try { await api.deleteVlan(v.id, true); setMsg({ type: "ok", text: `VLAN ${v.id} deleted` }); await reload(); }
    catch (e: any) { setMsg({ type: "err", text: e.message }); }
    finally { setBusy(false); }
  };

  return (
    <div style={PAGE}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
        <div>
          <h1 style={{ color: t.txt, fontFamily: t.headFont, fontSize: 22, fontWeight: 700, margin: 0 }}>VLANs</h1>
          <div style={{ color: t.muted, fontSize: 12, marginTop: 4 }}>{vlans.length} VLANs · changes pushed via SSH if compatible</div>
        </div>
        <PrimaryBtn t={t} onClick={startAdd}>+ Add VLAN</PrimaryBtn>
      </div>

      {msg && <div style={{ padding: 12, background: msg.type === "ok" ? `${t.ok}15` : `${t.err}15`, color: msg.type === "ok" ? t.ok : t.err, borderRadius: t.radius, fontFamily: t.monoFont, fontSize: 11, whiteSpace: "pre-wrap", border: `1px solid ${msg.type === "ok" ? t.ok : t.err}40` }}>{msg.text}</div>}

      {(adding || editing != null) && (
        <Card t={t}>
          <div style={{ color: t.txt, fontWeight: 600, fontSize: 13, marginBottom: 12 }}>{adding ? "New VLAN" : `Edit VLAN ${editing}`}</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
            <div><label style={smallLabel(t)}>VLAN ID</label><input type="number" disabled={editing != null} value={form.id} onChange={e => setForm({ ...form, id: parseInt(e.target.value) })} style={inputStyle(t)}/></div>
            <div><label style={smallLabel(t)}>Name</label><input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="IoT" style={inputStyle(t)}/></div>
            <div><label style={smallLabel(t)}>Subnet</label><input value={form.subnet} onChange={e => setForm({ ...form, subnet: e.target.value })} placeholder="192.168.30.0/24" style={inputStyle(t)}/></div>
            <div><label style={smallLabel(t)}>Color</label><input type="color" value={form.color} onChange={e => setForm({ ...form, color: e.target.value })} style={{ ...inputStyle(t), padding: 2, height: 36 }}/></div>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 8 }}>
              <SmallToggle t={t} value={form.isolated} onChange={v => setForm({ ...form, isolated: v })}/>
              <span style={{ color: t.muted, fontSize: 11, fontFamily: t.monoFont }}>Isolated</span>
            </div>
            {adding && (
              <div style={{ display: "flex", alignItems: "flex-end", gap: 8 }}>
                <SmallToggle t={t} value={form.pushToRouter} onChange={v => setForm({ ...form, pushToRouter: v })}/>
                <span style={{ color: t.muted, fontSize: 11, fontFamily: t.monoFont }}>Push to router via SSH</span>
              </div>
            )}
            <div style={{ gridColumn: "1 / -1", display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 8 }}>
              <GhostBtn t={t} onClick={() => { setAdding(false); setEditing(null); }}>Cancel</GhostBtn>
              <PrimaryBtn t={t} onClick={save} disabled={busy || !form.name || !form.subnet}>{busy ? "Saving…" : "Save"}</PrimaryBtn>
            </div>
          </div>
        </Card>
      )}

      {vlans.length === 0
        ? <Empty t={t} text="No VLANs yet — click + Add VLAN to create one" icon="🔀"/>
        : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 12 }}>
            {vlans.map(v => {
              const count = devices.filter(d => d.vlan === v.id).length;
              return (
                <Card key={v.id} t={t} padding={16} style={{ borderLeft: `4px solid ${v.color || t.primary}` }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                    <div>
                      <div style={{ color: t.txt, fontSize: 18, fontWeight: 700, fontFamily: t.headFont }}>VLAN {v.id}</div>
                      <div style={{ color: t.muted, fontSize: 12, marginTop: 4 }}>{v.name}</div>
                    </div>
                    <div style={{ display: "flex", gap: 4 }}>
                      <button onClick={() => startEdit(v)} title="Edit" style={{ background: t.surfaceHover, border: `1px solid ${t.border}`, color: t.muted, padding: "3px 7px", borderRadius: 4, fontSize: 11, cursor: "pointer", fontFamily: t.monoFont }}>✎</button>
                      <button onClick={() => del(v)} title="Delete" style={{ background: `${t.err}15`, border: `1px solid ${t.err}40`, color: t.err, padding: "3px 7px", borderRadius: 4, fontSize: 11, cursor: "pointer", fontFamily: t.monoFont }}>✕</button>
                    </div>
                  </div>
                  <div style={{ color: t.muted, fontSize: 11, fontFamily: t.monoFont, marginTop: 8 }}>{v.subnet}</div>
                  {v.isolated && <div style={{ color: t.warn, fontSize: 10, fontFamily: t.monoFont, marginTop: 2, textTransform: "uppercase", letterSpacing: "0.08em" }}>● isolated</div>}
                  <div style={{ color: t.info, fontSize: 11, fontFamily: t.monoFont, marginTop: 4 }}>{count} devices</div>
                </Card>
              );
            })}
          </div>
        )
      }
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// SECURITY (rules)
// ════════════════════════════════════════════════════════════════════════════
export function SecurityPage({ t }: { t: any }) {
  const [rules, setRules] = useState<any[]>([]);
  const load = () => api.listRules().then(setRules).catch(() => {});
  useEffect(() => { load(); }, []);
  const toggle = (id: string, enabled: boolean) => api.updateRule(id, { enabled }).then(load);
  const setThr = (id: string, threshold: number) => api.updateRule(id, { threshold }).then(load);

  return (
    <div style={PAGE}>
      <div>
        <h1 style={{ color: t.txt, fontFamily: t.headFont, fontSize: 22, fontWeight: 700, margin: 0 }}>Security Rules</h1>
        <div style={{ color: t.muted, fontSize: 12, marginTop: 4 }}>Automation policies — applied every minute</div>
      </div>
      <Card t={t} padding={0}>
        {rules.map(r => (
          <div key={r.id} style={{ padding: "14px 18px", borderTop: `1px solid ${t.border}40`, display: "flex", alignItems: "center", gap: 14 }}>
            <SmallToggle t={t} value={r.enabled} onChange={v => toggle(r.id, v)}/>
            <div style={{ flex: 1 }}>
              <div style={{ color: t.txt, fontSize: 13, fontWeight: 600, fontFamily: t.headFont }}>{r.name}</div>
              <div style={{ color: t.muted, fontSize: 11, fontFamily: t.monoFont, marginTop: 2 }}>
                Trigger: <span style={{ color: t.info }}>{r.trigger}</span> · Action: <span style={{ color: r.action === "ban" ? t.err : r.action === "quarantine" ? t.warn : t.info }}>{r.action}</span>
                {r.exceptWhitelist && " · whitelist exempt"}
              </div>
            </div>
            {r.threshold != null && (
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ color: t.muted, fontSize: 10, fontFamily: t.monoFont }}>Threshold</span>
                <input type="number" value={r.threshold} onChange={e => setThr(r.id, parseFloat(e.target.value))} style={{ ...inputStyle(t), width: 70 }}/>
              </div>
            )}
          </div>
        ))}
        {rules.length === 0 && <Empty t={t} text="Loading…"/>}
      </Card>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// VULNERABILITIES (CVE list across devices)
// ════════════════════════════════════════════════════════════════════════════
export function VulnsPage({ t }: { t: any }) {
  const devices = useStore(s => s.devices);
  const select = (id: string) => useStore.getState().selectDevice(id);

  const allCves = devices.flatMap((d: any) => (d.cves || []).map((c: any) => ({ ...c, device: d })));
  allCves.sort((a, b) => b.cvss - a.cvss);

  return (
    <div style={PAGE}>
      <div>
        <h1 style={{ color: t.txt, fontFamily: t.headFont, fontSize: 22, fontWeight: 700, margin: 0 }}>Vulnerabilities</h1>
        <div style={{ color: t.muted, fontSize: 12, marginTop: 4 }}>{allCves.length} CVEs detected across the fabric</div>
      </div>
      {allCves.length === 0
        ? <Empty t={t} text="No vulnerabilities detected" icon="✓"/>
        : (
          <Card t={t} padding={0}>
            {allCves.map((c, i) => (
              <div key={i} onClick={() => select(c.device.id)} style={{
                padding: "13px 18px", borderTop: i ? `1px solid ${t.border}40` : "none",
                display: "grid", gridTemplateColumns: "auto 1fr 2fr auto", alignItems: "center", gap: 14,
                cursor: "pointer",
              }}
                onMouseEnter={e => e.currentTarget.style.background = t.surfaceHover}
                onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                <SeverityBadge severity={c.severity} t={t}/>
                <div>
                  <div style={{ color: t.txt, fontWeight: 600, fontSize: 12.5, fontFamily: t.monoFont }}>{c.cveId}</div>
                  <div style={{ color: t.muted, fontSize: 10.5, fontFamily: t.monoFont, marginTop: 2 }}>CVSS {c.cvss}</div>
                </div>
                <div>
                  <div style={{ color: t.txt, fontSize: 12 }}>{c.description}</div>
                  <div style={{ color: t.muted, fontSize: 11, marginTop: 3 }}>
                    on <strong>{c.device.customName || c.device.hostname || c.device.ip}</strong>
                    {c.service && ` · ${c.service}`}
                  </div>
                </div>
                <span style={{ color: t.muted, fontSize: 18 }}>›</span>
              </div>
            ))}
          </Card>
        )
      }
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// SSH COCKPIT
// ════════════════════════════════════════════════════════════════════════════
export function SshPage({ t }: { t: any }) {
  const [list, setList] = useState<any[]>([]);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState<any>({ name: "", host: "", port: 22, username: "", password: "", privateKey: "", passphrase: "", useKey: false, vendor: "asus-merlin", isMainRouter: false });
  const [testResult, setTestResult] = useState<any>(null);
  const [selected, setSelected] = useState<any>(null);
  const [cmd, setCmd] = useState("");
  const [output, setOutput] = useState("");

  const load = () => api.listSsh().then(setList).catch(() => {});
  useEffect(() => { load(); }, []);

  const buildPayload = () => {
    const { useKey, password, privateKey, passphrase, ...rest } = form;
    return { ...rest, ...(useKey ? { privateKey, passphrase: passphrase || undefined } : { password }) };
  };
  const test = async () => { setTestResult(null); try { setTestResult(await api.testSsh(buildPayload())); } catch (e: any) { setTestResult({ ok: false, error: e.message }); } };
  const save = async () => {
    await api.addSsh(buildPayload());
    setAdding(false);
    setForm({ name: "", host: "", port: 22, username: "", password: "", privateKey: "", passphrase: "", useKey: false, vendor: "asus-merlin", isMainRouter: false });
    load();
  };
  const exec = async () => {
    if (!selected || !cmd) return;
    try { const r = await api.execSsh(selected.id, cmd); setOutput(`$ ${cmd}\n${r.stdout}${r.stderr ? "\n[stderr] " + r.stderr : ""}`); }
    catch (e: any) { setOutput(`Error: ${e.message}`); }
  };

  return (
    <div style={PAGE}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
        <div>
          <h1 style={{ color: t.txt, fontFamily: t.headFont, fontSize: 22, fontWeight: 700, margin: 0 }}>SSH Cockpit</h1>
          <div style={{ color: t.muted, fontSize: 12, marginTop: 4 }}>Manage routers and switches</div>
        </div>
        <PrimaryBtn t={t} onClick={() => setAdding(!adding)}>+ Add device</PrimaryBtn>
      </div>

      {adding && (
        <Card t={t}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            {[{ k: "name", l: "Name" }, { k: "host", l: "Host/IP" }, { k: "username", l: "Username" }].map(f => (
              <div key={f.k}><label style={smallLabel(t)}>{f.l}</label><input value={form[f.k]} onChange={e => setForm({ ...form, [f.k]: e.target.value })} style={inputStyle(t)}/></div>
            ))}
            <div><label style={smallLabel(t)}>Port</label><input type="number" value={form.port} onChange={e => setForm({ ...form, port: parseInt(e.target.value) })} style={inputStyle(t)}/></div>
            <div><label style={smallLabel(t)}>Vendor / firmware</label>
              <select value={form.vendor} onChange={e => setForm({ ...form, vendor: e.target.value })} style={inputStyle(t)}>
                {["asus-merlin", "mikrotik", "openwrt", "pfsense", "cisco", "unifi", "generic"].map(v => <option key={v} value={v}>{v}</option>)}
              </select>
            </div>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 8 }}><SmallToggle t={t} value={form.isMainRouter} onChange={v => setForm({ ...form, isMainRouter: v })}/><span style={{ color: t.muted, fontSize: 11, fontFamily: t.monoFont }}>Main router (protected)</span></div>
            <div style={{ gridColumn: "1 / -1", display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", background: t.surfaceHover, border: `1px solid ${t.border}`, borderRadius: t.radius }}>
              <span style={{ color: t.txt, fontSize: 12, flex: 1 }}>Use SSH private key (instead of password)</span>
              <SmallToggle t={t} value={form.useKey} onChange={v => setForm({ ...form, useKey: v })}/>
            </div>
            {!form.useKey
              ? <div style={{ gridColumn: "1 / -1" }}><label style={smallLabel(t)}>Password</label><input type="password" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} style={inputStyle(t)}/></div>
              : (<>
                <div style={{ gridColumn: "1 / -1" }}><label style={smallLabel(t)}>Private key (paste contents)</label><textarea rows={5} value={form.privateKey} onChange={e => setForm({ ...form, privateKey: e.target.value })} placeholder="-----BEGIN OPENSSH PRIVATE KEY-----&#10;…" style={{ ...inputStyle(t), fontSize: 11, resize: "vertical" }}/></div>
                <div style={{ gridColumn: "1 / -1" }}><label style={smallLabel(t)}>Passphrase (optional)</label><input type="password" value={form.passphrase} onChange={e => setForm({ ...form, passphrase: e.target.value })} style={inputStyle(t)}/></div>
              </>)
            }
            <div style={{ gridColumn: "1 / -1", display: "flex", gap: 8, justifyContent: "flex-end" }}><GhostBtn t={t} onClick={test}>Test</GhostBtn><PrimaryBtn t={t} onClick={save}>Save</PrimaryBtn></div>
            {testResult && <div style={{ gridColumn: "1 / -1", padding: 10, fontFamily: t.monoFont, fontSize: 11, background: testResult.ok ? `${t.ok}15` : `${t.err}15`, color: testResult.ok ? t.ok : t.err, borderRadius: t.radius }}>{testResult.ok ? `✓ ${testResult.banner || "OK"}` : `✕ ${testResult.error}`}</div>}
          </div>
        </Card>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 14 }}>
        <Card t={t} padding={0}>
          <div style={{ padding: "12px 16px", borderBottom: `1px solid ${t.border}`, color: t.txt, fontWeight: 600, fontFamily: t.headFont, fontSize: 13 }}>Devices ({list.length})</div>
          {list.map(d => (
            <div key={d.id} onClick={() => setSelected(d)} style={{ padding: "10px 16px", borderTop: `1px solid ${t.border}40`, cursor: "pointer", background: selected?.id === d.id ? t.surfaceHover : "transparent" }}>
              <div style={{ color: t.txt, fontSize: 13, fontWeight: 600, fontFamily: t.headFont }}>{d.name} {d.isMainRouter && <span style={{ color: t.ok, fontSize: 9 }}>★</span>}</div>
              <div style={{ color: t.muted, fontSize: 11, fontFamily: t.monoFont }}>{d.username}@{d.host}:{d.port} · {d.vendor}</div>
            </div>
          ))}
          {list.length === 0 && <Empty t={t} text="No SSH devices configured"/>}
        </Card>
        <Card t={t} padding={0}>
          <div style={{ padding: "12px 16px", borderBottom: `1px solid ${t.border}`, color: t.txt, fontWeight: 600, fontFamily: t.headFont, fontSize: 13 }}>{selected ? `Console — ${selected.name}` : "Console"}</div>
          <div style={{ padding: 14 }}>
            {!selected && <div style={{ color: t.muted, fontSize: 12, fontFamily: t.monoFont }}>Select a device on the left.</div>}
            {selected && <>
              <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
                <input value={cmd} onChange={e => setCmd(e.target.value)} placeholder="Type command…" onKeyDown={e => e.key === "Enter" && exec()} style={{ ...inputStyle(t), flex: 1 }}/>
                <PrimaryBtn t={t} onClick={exec}>Run</PrimaryBtn>
              </div>
              <pre style={{ background: t.bg, border: `1px solid ${t.border}`, borderRadius: t.radius, padding: 12, color: t.txt, fontFamily: t.monoFont, fontSize: 11, whiteSpace: "pre-wrap", maxHeight: 400, overflow: "auto", margin: 0 }}>{output || "// Output will appear here"}</pre>
            </>}
          </div>
        </Card>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// HOST MONITORING
// ════════════════════════════════════════════════════════════════════════════
export function HostPage({ t }: { t: any }) {
  const hostStats = useStore(s => s.hostStats);
  const [history, setHistory] = useState<any[]>([]);
  useEffect(() => {
    api.hostHistory(60).then(setHistory).catch(() => {});
    const i = setInterval(() => api.hostHistory(60).then(setHistory).catch(() => {}), 30000);
    return () => clearInterval(i);
  }, []);
  if (!hostStats) return <div style={PAGE}><Empty t={t} text="Host metrics loading…"/></div>;

  const cpuColor = hostStats.cpuPct > 80 ? t.err : hostStats.cpuPct > 60 ? t.warn : t.ok;
  const memColor = hostStats.memPct > 85 ? t.err : t.accent;
  const diskColor = hostStats.diskPct > 90 ? t.err : t.ok;

  return (
    <div style={PAGE}>
      <div>
        <h1 style={{ color: t.txt, fontFamily: t.headFont, fontSize: 22, fontWeight: 700, margin: 0 }}>Host Monitoring</h1>
        <div style={{ color: t.muted, fontSize: 12, marginTop: 4 }}>Server hardware & Docker containers</div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
        <Gauge t={t} label="CPU" value={hostStats.cpuPct} color={cpuColor} suffix="%"/>
        <Gauge t={t} label="Memory" value={hostStats.memPct} color={memColor} sub={`${hostStats.memUsedMB}/${hostStats.memTotalMB} MB`} suffix="%"/>
        <Gauge t={t} label="Disk" value={hostStats.diskPct} color={diskColor} suffix="%"/>
        {hostStats.tempC != null && <Card t={t}><Tag t={t} label="Temperature" value={`${hostStats.tempC}°C`} accent={hostStats.tempC > 75 ? t.err : t.info}/></Card>}
        <Card t={t}><Tag t={t} label="Load" value={hostStats.loadAvg.toFixed(2)} accent={t.info}/></Card>
        <Card t={t}><Tag t={t} label="Uptime" value={fmtUptime(hostStats.uptimeSec)} accent={t.info}/></Card>
        <Card t={t}><Tag t={t} label="Net ↓" value={`${hostStats.netRxKBs.toFixed(1)} KB/s`} accent={t.info}/></Card>
        <Card t={t}><Tag t={t} label="Net ↑" value={`${hostStats.netTxKBs.toFixed(1)} KB/s`} accent={t.info}/></Card>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <Card t={t}><div style={{ color: t.txt, fontWeight: 600, fontFamily: t.headFont, fontSize: 13, marginBottom: 12 }}>CPU history (60min)</div><Sparkline data={history.map(h => h.cpuPct)} color={t.primary} w={500} h={130}/></Card>
        <Card t={t}><div style={{ color: t.txt, fontWeight: 600, fontFamily: t.headFont, fontSize: 13, marginBottom: 12 }}>Memory history (60min)</div><Sparkline data={history.map(h => h.memPct)} color={t.accent} w={500} h={130}/></Card>
      </div>
      <Card t={t} padding={0}>
        <div style={{ padding: "12px 16px", borderBottom: `1px solid ${t.border}`, color: t.txt, fontWeight: 600, fontFamily: t.headFont, fontSize: 13 }}>Docker containers ({hostStats.containers?.length || 0})</div>
        {(hostStats.containers || []).map((c: any) => (
          <div key={c.id} style={{ padding: "9px 16px", borderTop: `1px solid ${t.border}40`, display: "flex", gap: 12, alignItems: "center" }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: c.state === "running" ? t.ok : t.muted }}/>
            <div style={{ flex: 1 }}>
              <div style={{ color: t.txt, fontSize: 12.5, fontWeight: 600, fontFamily: t.monoFont }}>{c.name}</div>
              <div style={{ color: t.muted, fontSize: 10.5, fontFamily: t.monoFont, marginTop: 2 }}>{c.image} · {c.status}</div>
            </div>
            <span style={{ background: c.state === "running" ? `${t.ok}15` : `${t.muted}15`, color: c.state === "running" ? t.ok : t.muted, padding: "2px 8px", borderRadius: 4, fontSize: 9.5, fontFamily: t.monoFont }}>{c.state}</span>
          </div>
        ))}
        {(!hostStats.containers || hostStats.containers.length === 0) && <Empty t={t} text="No containers"/>}
      </Card>
    </div>
  );
}

function Tag({ t, label, value, accent }: any) {
  return (
    <div>
      <div style={{ color: t.muted, fontSize: 10.5, textTransform: "uppercase", letterSpacing: "0.08em", fontFamily: t.monoFont }}>{label}</div>
      <div style={{ color: accent || t.txt, fontSize: 22, fontWeight: 700, fontFamily: t.headFont, marginTop: 4 }}>{value}</div>
    </div>
  );
}

function Gauge({ t, label, value, color, sub, suffix }: any) {
  return (
    <Card t={t}>
      <div style={{ color: t.muted, fontSize: 10.5, textTransform: "uppercase", letterSpacing: "0.08em", fontFamily: t.monoFont }}>{label}</div>
      <div style={{ color, fontSize: 24, fontWeight: 700, fontFamily: t.headFont, marginTop: 4 }}>{Math.round(value)}{suffix}</div>
      <div style={{ marginTop: 8 }}><MiniBar value={value} color={color}/></div>
      {sub && <div style={{ color: t.muted, fontSize: 10.5, fontFamily: t.monoFont, marginTop: 6 }}>{sub}</div>}
    </Card>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// LOGS
// ════════════════════════════════════════════════════════════════════════════
export function LogsPage({ t }: { t: any }) {
  const logs = useStore(s => s.logs);
  const [level, setLevel] = useState("all");
  const filtered = level === "all" ? logs : logs.filter(l => l.level === level);
  return (
    <div style={PAGE}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
        <div>
          <h1 style={{ color: t.txt, fontFamily: t.headFont, fontSize: 22, fontWeight: 700, margin: 0 }}>Logs</h1>
          <div style={{ color: t.muted, fontSize: 12, marginTop: 4 }}>{filtered.length} entries</div>
        </div>
        <select value={level} onChange={e => setLevel(e.target.value)} style={{ ...inputStyle(t), width: 140 }}>
          {["all", "info", "warn", "error", "success"].map(l => <option key={l} value={l}>{l}</option>)}
        </select>
      </div>
      <Card t={t} padding={0}>
        <div style={{ maxHeight: "calc(100vh - 220px)", overflow: "auto" }}>
          {filtered.map(l => {
            const c = l.level === "error" ? t.err : l.level === "warn" ? t.warn : l.level === "success" ? t.ok : t.muted;
            return (
              <div key={l.id} style={{ padding: "5px 16px", borderBottom: `1px solid ${t.border}40`, display: "flex", gap: 10, fontFamily: t.monoFont, fontSize: 11 }}>
                <span style={{ color: t.muted, width: 130, flexShrink: 0 }}>{new Date(l.createdAt).toLocaleString()}</span>
                <span style={{ color: c, width: 60, flexShrink: 0, textTransform: "uppercase", fontSize: 9.5 }}>{l.level}</span>
                <span style={{ color: t.info, width: 90, flexShrink: 0 }}>{l.source}</span>
                <span style={{ color: t.txt, flex: 1 }}>{l.message}</span>
              </div>
            );
          })}
          {filtered.length === 0 && <Empty t={t} text="No logs"/>}
        </div>
      </Card>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// NOTIFICATIONS
// ════════════════════════════════════════════════════════════════════════════
// ════════════════════════════════════════════════════════════════════════════
// NOTIFICATIONS — Commands builder ("when X → do Y")
// Channel credentials live in Settings → Notifications. This page is for
// building the commands that fire those channels.
// ════════════════════════════════════════════════════════════════════════════
export function NotificationsPage({ t }: { t: any }) {
  const [notifs, setNotifs] = useState<any[]>([]);
  const [commands, setCommands] = useState<any[]>([]);
  const [triggers, setTriggers] = useState<any[]>([]);
  const [editing, setEditing] = useState<any | null>(null); // command being edited (or new)
  const [showChannelModal, setShowChannelModal] = useState(false);

  const reload = async () => {
    const [n, c, tr] = await Promise.all([
      api.listNotifications(), api.listCommands(), api.getTriggers(),
    ]);
    setNotifs(n); setCommands(c); setTriggers(tr);
  };
  useEffect(() => { reload(); }, []);

  const enabledChannels = notifs.filter(n => n.enabled).map(n => n.channel);
  const triggerById = Object.fromEntries(triggers.map(tr => [tr.id, tr]));

  const toggleCommand = async (id: string, enabled: boolean) => {
    await api.updateCommand(id, { enabled });
    reload();
  };
  const removeCommand = async (id: string, name: string) => {
    if (!confirm(`Delete command "${name}"?`)) return;
    await api.deleteCommand(id);
    reload();
  };
  const fireCommand = async (id: string, name: string) => {
    if (!confirm(`Fire "${name}" now (test)?`)) return;
    await api.fireCommand(id, { test: true, ip: "192.0.2.123", name: "TestDevice", score: 88 });
    alert("Command fired — check your notifications.");
  };

  return (
    <div style={PAGE}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <h1 style={{ color: t.txt, fontFamily: t.headFont, fontSize: 22, fontWeight: 700, margin: 0 }}>Notifications</h1>
          <div style={{ color: t.muted, fontSize: 12, marginTop: 4 }}>
            Build "when this happens → do that" commands.
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <GhostBtn t={t} onClick={() => setShowChannelModal(true)}>+ Add channel</GhostBtn>
          <PrimaryBtn t={t} onClick={() => setEditing({
            isNew: true, name: "", trigger: "device.new", actions: [{ kind: "notify", channels: enabledChannels.slice(0, 1) }],
            template: "", cooldownSec: 0, enabled: true, filter: null,
          })}>+ New command</PrimaryBtn>
        </div>
      </div>

      {/* Channels overview */}
      <Card t={t} padding={0}>
        <div style={{ padding: "12px 18px", borderBottom: `1px solid ${t.border}`, color: t.txt, fontWeight: 600, fontFamily: t.headFont, fontSize: 13 }}>
          Channels
        </div>
        <div style={{ padding: "12px 18px", display: "flex", gap: 10, flexWrap: "wrap" }}>
          {(["telegram", "email", "sms", "discord", "webhook"] as const).map(ch => {
            const cfg = notifs.find(n => n.channel === ch);
            const enabled = cfg?.enabled;
            return (
              <span key={ch} style={{
                display: "inline-flex", alignItems: "center", gap: 6,
                padding: "4px 12px", borderRadius: 999,
                background: enabled ? `${t.ok}15` : `${t.muted}10`,
                border: `1px solid ${enabled ? t.ok : t.border}`,
                color: enabled ? t.ok : t.muted,
                fontFamily: t.monoFont, fontSize: 11.5, textTransform: "capitalize",
              }}>
                {enabled ? "●" : "○"} {ch}
              </span>
            );
          })}
          <span style={{ flex: 1 }}/>
          <span style={{ color: t.muted, fontSize: 11, fontFamily: t.monoFont, alignSelf: "center" }}>
            Edit credentials in <strong>Settings → Notifications</strong>
          </span>
        </div>
      </Card>

      {/* Commands list */}
      <Card t={t} padding={0}>
        <div style={{ padding: "12px 18px", borderBottom: `1px solid ${t.border}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ color: t.txt, fontWeight: 600, fontFamily: t.headFont, fontSize: 13 }}>Commands ({commands.length})</div>
          <span style={{ color: t.muted, fontSize: 11, fontFamily: t.monoFont }}>
            {triggers.length} available triggers
          </span>
        </div>
        {commands.length === 0
          ? <Empty t={t} text="No commands yet — click + New command to create one" icon="⚡"/>
          : commands.map(c => {
              const trig = triggerById[c.trigger];
              const acts = Array.isArray(c.actions) ? c.actions : [];
              return (
                <div key={c.id} style={{
                  padding: "12px 18px", borderTop: `1px solid ${t.border}40`,
                  display: "grid", gridTemplateColumns: "auto 1fr auto auto", gap: 14, alignItems: "center",
                }}>
                  <SmallToggleP t={t} value={c.enabled} onChange={(v: boolean) => toggleCommand(c.id, v)}/>
                  <div>
                    <div style={{ color: t.txt, fontSize: 13, fontWeight: 600, fontFamily: t.headFont }}>{c.name}</div>
                    <div style={{ color: t.muted, fontSize: 11, fontFamily: t.monoFont, marginTop: 2 }}>
                      <span style={{ color: t.info }}>{trig?.label || c.trigger}</span>
                      {" → "}
                      {acts.map((a, i) => (
                        <span key={i} style={{ color: a.kind === "notify" ? t.ok : a.kind === "ban" ? t.err : a.kind === "quarantine" ? t.warn : t.txt }}>
                          {a.kind === "notify" ? `notify [${(a.channels || []).join(", ")}]` : a.kind}
                          {i < acts.length - 1 ? " + " : ""}
                        </span>
                      ))}
                      {c.cooldownSec > 0 && <span style={{ color: t.muted }}> · cooldown {c.cooldownSec}s</span>}
                      <span style={{ color: t.muted }}> · fired {c.fireCount}×</span>
                    </div>
                  </div>
                  <button onClick={() => fireCommand(c.id, c.name)} title="Fire now (test)" style={{ background: t.surface, border: `1px solid ${t.border}`, color: t.txt, padding: "4px 9px", borderRadius: 5, fontSize: 11, cursor: "pointer", fontFamily: t.monoFont }}>▶ Test</button>
                  <div style={{ display: "flex", gap: 4 }}>
                    <button onClick={() => setEditing({ ...c, isNew: false })} style={{ background: t.surface, border: `1px solid ${t.border}`, color: t.muted, padding: "4px 8px", borderRadius: 4, fontSize: 11, cursor: "pointer" }}>✎</button>
                    <button onClick={() => removeCommand(c.id, c.name)} style={{ background: `${t.err}15`, border: `1px solid ${t.err}40`, color: t.err, padding: "4px 8px", borderRadius: 4, fontSize: 11, cursor: "pointer" }}>✕</button>
                  </div>
                </div>
              );
            })
        }
      </Card>

      {editing && (
        <CommandEditor t={t} command={editing} triggers={triggers} channels={enabledChannels}
          onClose={() => setEditing(null)}
          onSave={async (data) => {
            try {
              if (editing.isNew) await api.createCommand(data);
              else await api.updateCommand(editing.id, data);
              setEditing(null);
              await reload();
            } catch (err: any) { alert(err.message); }
          }}/>
      )}

      {showChannelModal && (
        <ChannelModal t={t} notifs={notifs} onClose={() => setShowChannelModal(false)}
          onSaved={async () => { await reload(); setShowChannelModal(false); }}/>
      )}
    </div>
  );
}

function SmallToggleP({ t, value, onChange }: any) {
  return (
    <button onClick={() => onChange(!value)} style={{
      width: 38, height: 20, borderRadius: 10, padding: 2,
      background: value ? t.primary : (t.id === "minimal" ? "#d4d4d8" : "rgba(255,255,255,0.15)"),
      border: "none", cursor: "pointer", flexShrink: 0,
    }}>
      <span style={{ display: "block", width: 16, height: 16, background: "white", borderRadius: "50%", marginLeft: value ? 18 : 0, transition: "margin-left 0.2s" }}/>
    </button>
  );
}

// ── Command Editor Modal ───────────────────────────────────────────────
function CommandEditor({ t, command, triggers, channels, onClose, onSave }: any) {
  const [name, setName] = useState(command.name || "");
  const [triggerId, setTriggerId] = useState(command.trigger || "device.new");
  const [actions, setActions] = useState<any[]>(command.actions || [{ kind: "notify", channels: channels.slice(0, 1) }]);
  const [template, setTemplate] = useState(command.template || "");
  const [cooldownSec, setCooldownSec] = useState(command.cooldownSec || 0);
  const [enabled, setEnabled] = useState(command.enabled !== false);
  const [filter, setFilter] = useState<any>(command.filter || {});
  const [search, setSearch] = useState("");

  const trig = triggers.find((tr: any) => tr.id === triggerId);
  const groupedTriggers: Record<string, any[]> = {};
  for (const tr of triggers) {
    const cat = tr.category || "Other";
    if (search && !`${tr.id} ${tr.label} ${cat}`.toLowerCase().includes(search.toLowerCase())) continue;
    (groupedTriggers[cat] ||= []).push(tr);
  }

  const addAction = (kind: string) => {
    if (kind === "notify") setActions([...actions, { kind: "notify", channels: channels.slice(0, 1) }]);
    else if (kind === "log") setActions([...actions, { kind: "log", level: "info" }]);
    else if (kind === "quarantine") setActions([...actions, { kind: "quarantine" }]);
    else if (kind === "ban") setActions([...actions, { kind: "ban", reason: "auto-ban via command" }]);
    else if (kind === "exec_ssh") setActions([...actions, { kind: "exec_ssh", deviceId: "", cmd: "" }]);
  };
  const updateAction = (i: number, patch: any) => {
    const next = [...actions]; next[i] = { ...next[i], ...patch }; setActions(next);
  };
  const removeAction = (i: number) => setActions(actions.filter((_, j) => j !== i));

  const submit = () => {
    if (!name.trim()) return alert("Give your command a name");
    if (actions.length === 0) return alert("Add at least one action");
    onSave({
      name, trigger: triggerId, actions, template: template || null,
      cooldownSec: cooldownSec || 0, enabled, filter: Object.keys(filter || {}).length ? filter : null,
    });
  };

  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, zIndex: 9500, background: "rgba(0,0,0,0.7)",
      backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20,
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        width: 760, maxWidth: "100%", maxHeight: "90vh", overflow: "auto",
        background: t.bg, border: `1px solid ${t.border}`, borderRadius: 14,
      }}>
        <div style={{ padding: "14px 20px", borderBottom: `1px solid ${t.border}`, display: "flex", justifyContent: "space-between", alignItems: "center", position: "sticky", top: 0, background: t.bg, zIndex: 10 }}>
          <div style={{ color: t.txt, fontFamily: t.headFont, fontWeight: 600, fontSize: 16 }}>
            {command.isNew ? "New command" : `Edit · ${command.name}`}
          </div>
          <button onClick={onClose} style={{ background: t.surface, border: `1px solid ${t.border}`, color: t.muted, borderRadius: 6, padding: "4px 9px", cursor: "pointer", fontSize: 14 }}>✕</button>
        </div>
        <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 18 }}>
          <div>
            <Label t={t}>Name</Label>
            <input value={name} onChange={(e) => setName(e.target.value)} style={ipt(t)} placeholder="e.g. Alert me on new IoT"/>
          </div>

          {/* TRIGGER */}
          <div>
            <Label t={t}>1. When (trigger)</Label>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search triggers…"
              style={{ ...ipt(t), marginBottom: 8 }}/>
            <div style={{ maxHeight: 240, overflow: "auto", background: t.surface, border: `1px solid ${t.border}`, borderRadius: 7 }}>
              {Object.keys(groupedTriggers).map(cat => (
                <div key={cat}>
                  <div style={{ padding: "5px 12px", color: t.muted, fontSize: 9.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", borderTop: `1px solid ${t.border}40`, fontFamily: t.monoFont }}>
                    {cat}
                  </div>
                  {groupedTriggers[cat].map(tr => (
                    <button key={tr.id} onClick={() => setTriggerId(tr.id)} style={{
                      display: "block", width: "100%", textAlign: "left",
                      padding: "7px 12px",
                      background: triggerId === tr.id ? `${t.primary}20` : "transparent",
                      border: "none",
                      color: triggerId === tr.id ? t.primary : t.txt,
                      fontFamily: t.font, fontSize: 12, cursor: "pointer",
                    }}>
                      <span style={{ fontFamily: t.monoFont, color: t.muted, fontSize: 10 }}>{tr.id}</span>
                      <span style={{ marginLeft: 10 }}>{tr.label}</span>
                    </button>
                  ))}
                </div>
              ))}
            </div>
            {trig && trig.vars?.length > 0 && (
              <div style={{ marginTop: 6, color: t.muted, fontSize: 11, fontFamily: t.monoFont }}>
                Available placeholders: {trig.vars.map((v: string) => `{{${v}}}`).join(", ")}
              </div>
            )}
          </div>

          {/* ACTIONS */}
          <div>
            <Label t={t}>2. Then (actions)</Label>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {actions.map((a, i) => (
                <div key={i} style={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: 7, padding: 10 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                    <span style={{ color: t.primary, fontWeight: 700, fontSize: 12, fontFamily: t.monoFont, textTransform: "uppercase", letterSpacing: "0.06em" }}>{a.kind}</span>
                    <button onClick={() => removeAction(i)} style={{ background: `${t.err}15`, border: `1px solid ${t.err}40`, color: t.err, padding: "2px 7px", borderRadius: 4, fontSize: 10.5, cursor: "pointer" }}>✕</button>
                  </div>
                  {a.kind === "notify" && (
                    <div>
                      <Label t={t}>Channels</Label>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        {(["telegram", "email", "sms", "discord", "webhook"] as const).map(ch => {
                          const checked = (a.channels || []).includes(ch);
                          const enabled = channels.includes(ch);
                          return (
                            <button key={ch} onClick={() => {
                              const cur = a.channels || [];
                              updateAction(i, { channels: checked ? cur.filter((x: string) => x !== ch) : [...cur, ch] });
                            }} disabled={!enabled} style={{
                              padding: "4px 10px",
                              background: checked ? `${t.primary}20` : t.bg,
                              border: `1px solid ${checked ? t.primary : t.border}`,
                              color: !enabled ? t.muted : checked ? t.primary : t.txt,
                              borderRadius: 5, cursor: enabled ? "pointer" : "not-allowed",
                              fontFamily: t.monoFont, fontSize: 11, opacity: enabled ? 1 : 0.5, textTransform: "capitalize",
                            }} title={enabled ? "" : "Configure this channel in Settings → Notifications"}>
                              {checked ? "●" : "○"} {ch}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                  {a.kind === "log" && (
                    <div>
                      <Label t={t}>Level</Label>
                      <select value={a.level || "info"} onChange={(e) => updateAction(i, { level: e.target.value })} style={ipt(t)}>
                        {["info", "warn", "error", "success"].map(l => <option key={l}>{l}</option>)}
                      </select>
                    </div>
                  )}
                  {a.kind === "ban" && (
                    <div>
                      <Label t={t}>Reason (optional)</Label>
                      <input value={a.reason || ""} onChange={(e) => updateAction(i, { reason: e.target.value })} style={ipt(t)} placeholder="auto-ban via command"/>
                    </div>
                  )}
                  {a.kind === "exec_ssh" && (
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 8 }}>
                      <div><Label t={t}>SSH device ID</Label><input value={a.deviceId || ""} onChange={(e) => updateAction(i, { deviceId: e.target.value })} style={ipt(t)}/></div>
                      <div><Label t={t}>Command</Label><input value={a.cmd || ""} onChange={(e) => updateAction(i, { cmd: e.target.value })} style={ipt(t)}/></div>
                    </div>
                  )}
                </div>
              ))}
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {[
                  { k: "notify", l: "+ Send notification" },
                  { k: "log", l: "+ Log event" },
                  { k: "quarantine", l: "+ Quarantine device" },
                  { k: "ban", l: "+ Ban device" },
                  { k: "exec_ssh", l: "+ Run SSH command" },
                ].map(a => (
                  <button key={a.k} onClick={() => addAction(a.k)} style={{
                    padding: "5px 11px", background: t.surface, border: `1px dashed ${t.border}`,
                    color: t.muted, borderRadius: 5, cursor: "pointer", fontFamily: t.monoFont, fontSize: 11,
                  }}>{a.l}</button>
                ))}
              </div>
            </div>
          </div>

          {/* TEMPLATE */}
          <div>
            <Label t={t}>3. Message template (optional)</Label>
            <textarea value={template} onChange={(e) => setTemplate(e.target.value)} rows={3}
              placeholder="🚨 New IoT device {{name}} ({{ip}}) by {{vendor}} just appeared on your network."
              style={{ ...ipt(t), resize: "vertical", fontFamily: t.monoFont }}/>
          </div>

          {/* COOLDOWN + ENABLED */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            <div>
              <Label t={t}>Cooldown (seconds)</Label>
              <input type="number" min={0} value={cooldownSec} onChange={(e) => setCooldownSec(parseInt(e.target.value) || 0)} style={ipt(t)}/>
              <div style={{ color: t.muted, fontSize: 10.5, marginTop: 4, fontFamily: t.monoFont }}>
                Skip if fired in the last N seconds (0 = no limit)
              </div>
            </div>
            <div>
              <Label t={t}>Enabled</Label>
              <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0" }}>
                <SmallToggleP t={t} value={enabled} onChange={setEnabled}/>
                <span style={{ color: t.txt, fontSize: 12 }}>{enabled ? "Active" : "Disabled"}</span>
              </div>
            </div>
          </div>
        </div>
        <div style={{ padding: "14px 20px", borderTop: `1px solid ${t.border}`, display: "flex", justifyContent: "flex-end", gap: 8, position: "sticky", bottom: 0, background: t.bg }}>
          <button onClick={onClose} style={{ background: t.surface, border: `1px solid ${t.border}`, color: t.txt, padding: "8px 16px", borderRadius: 7, cursor: "pointer", fontFamily: t.headFont, fontSize: 12 }}>Cancel</button>
          <button onClick={submit} style={{ background: t.grad, border: "none", color: t.onPrimary, padding: "8px 18px", borderRadius: 7, cursor: "pointer", fontFamily: t.headFont, fontSize: 12, fontWeight: 700 }}>{command.isNew ? "Create command" : "Save"}</button>
        </div>
      </div>
    </div>
  );
}

// ── Channel modal (quick add / configure a channel) ────────────────────
function ChannelModal({ t, notifs, onClose, onSaved }: any) {
  const [channel, setChannel] = useState("telegram");
  const [config, setConfig] = useState<any>({});
  const [busy, setBusy] = useState(false);
  const [test, setTest] = useState<any>(null);

  const fields: Record<string, any[]> = {
    telegram: [["token", "Bot token"], ["chatId", "Chat ID"]],
    email:    [["provider", "Provider (gmail/icloud/outlook)"], ["address", "Email address"], ["password", "App password"]],
    sms:      [["sid", "Twilio SID"], ["token", "Auth token"], ["from", "From number"], ["to", "To number"]],
    discord:  [["webhookUrl", "Webhook URL"]],
    webhook:  [["url", "Webhook URL"], ["headers", "Headers (JSON, optional)"]],
  };
  const f = fields[channel] || [];

  const save = async () => {
    setBusy(true);
    try { await api.setNotification(channel, true, config); await onSaved(); }
    catch (err: any) { alert(err.message); }
    finally { setBusy(false); }
  };
  const runTest = async () => {
    setBusy(true); setTest(null);
    try { setTest(await api.testNotification(channel, config)); }
    catch (err: any) { setTest({ ok: false, error: err.message }); }
    finally { setBusy(false); }
  };

  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, zIndex: 9500, background: "rgba(0,0,0,0.7)",
      backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20,
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        width: 520, maxWidth: "100%", background: t.bg, border: `1px solid ${t.border}`,
        borderRadius: 14, overflow: "hidden",
      }}>
        <div style={{ padding: "14px 20px", borderBottom: `1px solid ${t.border}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ color: t.txt, fontFamily: t.headFont, fontWeight: 600, fontSize: 16 }}>Add notification channel</div>
          <button onClick={onClose} style={{ background: t.surface, border: `1px solid ${t.border}`, color: t.muted, borderRadius: 6, padding: "4px 9px", cursor: "pointer", fontSize: 14 }}>✕</button>
        </div>
        <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <Label t={t}>Channel</Label>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {Object.keys(fields).map(c => (
                <button key={c} onClick={() => { setChannel(c); setConfig({}); setTest(null); }} style={{
                  padding: "8px 14px",
                  background: channel === c ? `${t.primary}20` : t.surface,
                  border: `1px solid ${channel === c ? t.primary : t.border}`,
                  color: channel === c ? t.primary : t.txt,
                  borderRadius: 7, cursor: "pointer", textTransform: "capitalize",
                  fontFamily: t.font, fontSize: 12,
                }}>{c}</button>
              ))}
            </div>
          </div>
          {f.map(([k, l]: any) => (
            <div key={k}>
              <Label t={t}>{l}</Label>
              <input value={config[k] || ""} onChange={(e) => setConfig({ ...config, [k]: e.target.value })}
                style={ipt(t)} type={k === "password" || k === "token" ? "password" : "text"}/>
            </div>
          ))}
          {test && <div style={{ padding: 10, background: test.ok ? `${t.ok}15` : `${t.err}15`, color: test.ok ? t.ok : t.err, borderRadius: 6, fontSize: 12, fontFamily: t.monoFont }}>{test.ok ? "✓ Test sent" : `✕ ${test.error}`}</div>}
        </div>
        <div style={{ padding: "14px 20px", borderTop: `1px solid ${t.border}`, display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button onClick={onClose} style={{ background: t.surface, border: `1px solid ${t.border}`, color: t.txt, padding: "8px 16px", borderRadius: 7, cursor: "pointer", fontFamily: t.headFont, fontSize: 12 }}>Cancel</button>
          <button onClick={runTest} disabled={busy} style={{ background: t.surface, border: `1px solid ${t.border}`, color: t.txt, padding: "8px 16px", borderRadius: 7, cursor: busy ? "wait" : "pointer", fontFamily: t.headFont, fontSize: 12 }}>{busy ? "…" : "Test"}</button>
          <button onClick={save} disabled={busy} style={{ background: t.grad, border: "none", color: t.onPrimary, padding: "8px 18px", borderRadius: 7, cursor: busy ? "wait" : "pointer", fontFamily: t.headFont, fontSize: 12, fontWeight: 700 }}>Save & enable</button>
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

// ════════════════════════════════════════════════════════════════════════════
// REPORTS
// ════════════════════════════════════════════════════════════════════════════
export function ReportsPage({ t }: { t: any }) {
  const { devices, alerts, healthScore, stats } = useStore();
  const totalCves = devices.reduce((s, d: any) => s + (d.cves?.length || 0), 0);
  const highRisk = devices.filter(d => d.dangerScore >= 70).length;
  const newDevices24h = devices.filter(d => Date.now() - new Date(d.firstSeen).getTime() < 86400000).length;

  return (
    <div style={PAGE}>
      <div>
        <h1 style={{ color: t.txt, fontFamily: t.headFont, fontSize: 22, fontWeight: 700, margin: 0 }}>Reports</h1>
        <div style={{ color: t.muted, fontSize: 12, marginTop: 4 }}>Network posture summary</div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
        {[
          { label: "Health Score", value: `${healthScore}/100`, color: healthScore > 75 ? t.ok : healthScore > 50 ? t.warn : t.err },
          { label: "Total devices", value: stats.total, color: t.primary },
          { label: "High-risk devices", value: highRisk, color: highRisk > 0 ? t.err : t.ok },
          { label: "Total CVEs", value: totalCves, color: totalCves > 0 ? t.warn : t.ok },
          { label: "New in 24h", value: newDevices24h, color: t.info },
          { label: "Banned", value: stats.banned, color: t.err },
          { label: "Quarantined", value: stats.quarantined, color: t.warn },
          { label: "Open alerts", value: alerts.filter(a => !a.acknowledged).length, color: t.warn },
        ].map((r, i) => (
          <Card key={i} t={t}>
            <div style={{ color: t.muted, fontSize: 10.5, textTransform: "uppercase", letterSpacing: "0.08em", fontFamily: t.monoFont }}>{r.label}</div>
            <div style={{ color: r.color, fontSize: 32, fontWeight: 700, fontFamily: t.headFont, marginTop: 4 }}>{r.value}</div>
          </Card>
        ))}
      </div>
      <Card t={t}>
        <div style={{ color: t.txt, fontWeight: 600, fontFamily: t.headFont, fontSize: 14, marginBottom: 12 }}>Coming soon</div>
        <div style={{ color: t.muted, fontSize: 12, lineHeight: 1.7 }}>
          Scheduled PDF/HTML exports of network posture, weekly digest emails, custom report templates.
        </div>
      </Card>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// USERS (single admin for now, password change)
// ════════════════════════════════════════════════════════════════════════════
export function UsersPage({ t }: { t: any }) {
  const user = useStore(s => s.user);
  const [oldPwd, setOldPwd] = useState("");
  const [newPwd, setNewPwd] = useState("");
  const [confirm, setConfirm] = useState("");
  const [msg, setMsg] = useState<any>(null);

  const change = async () => {
    if (newPwd !== confirm) { setMsg({ type: "err", text: "Passwords do not match" }); return; }
    // Aligned with the server rule (min. 12 characters).
    if (newPwd.length < 12) { setMsg({ type: "err", text: "Password must be at least 12 chars" }); return; }
    try {
      const res = await api.changePassword(user.username, oldPwd, newPwd);
      // The server rotated the session: we adopt the new CSRF token.
      if (res?.csrfToken) setCsrfToken(res.csrfToken);
      setMsg({ type: "ok", text: "Password changed" });
      setOldPwd(""); setNewPwd(""); setConfirm("");
    } catch (e: any) { setMsg({ type: "err", text: e.message }); }
  };

  return (
    <div style={PAGE}>
      <div>
        <h1 style={{ color: t.txt, fontFamily: t.headFont, fontSize: 22, fontWeight: 700, margin: 0 }}>Users</h1>
        <div style={{ color: t.muted, fontSize: 12, marginTop: 4 }}>Account & access management</div>
      </div>
      <Card t={t}>
        <div style={{ color: t.txt, fontWeight: 600, fontFamily: t.headFont, fontSize: 14, marginBottom: 12 }}>Current user</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 8, fontFamily: t.monoFont, fontSize: 12 }}>
          <span style={{ color: t.muted }}>Username</span><span style={{ color: t.txt }}>{user?.username}</span>
          <span style={{ color: t.muted }}>Role</span><span style={{ color: t.txt }}>{user?.role}</span>
        </div>
      </Card>
      <Card t={t}>
        <div style={{ color: t.txt, fontWeight: 600, fontFamily: t.headFont, fontSize: 14, marginBottom: 12 }}>Change password</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, maxWidth: 600 }}>
          <div style={{ gridColumn: "1 / -1" }}><label style={smallLabel(t)}>Current password</label><input type="password" value={oldPwd} onChange={e => setOldPwd(e.target.value)} style={inputStyle(t)}/></div>
          <div><label style={smallLabel(t)}>New password</label><input type="password" value={newPwd} onChange={e => setNewPwd(e.target.value)} style={inputStyle(t)}/></div>
          <div><label style={smallLabel(t)}>Confirm</label><input type="password" value={confirm} onChange={e => setConfirm(e.target.value)} style={inputStyle(t)}/></div>
          <div style={{ gridColumn: "1 / -1", display: "flex", justifyContent: "flex-end" }}><PrimaryBtn t={t} onClick={change}>Update</PrimaryBtn></div>
          {msg && <div style={{ gridColumn: "1 / -1", padding: 10, background: msg.type === "ok" ? `${t.ok}15` : `${t.err}15`, color: msg.type === "ok" ? t.ok : t.err, borderRadius: t.radius, fontSize: 12, fontFamily: t.monoFont }}>{msg.text}</div>}
        </div>
      </Card>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// SETTINGS
// ════════════════════════════════════════════════════════════════════════════
export function SettingsPage({ t }: { t: any }) {
  const [settings, setSettings] = useState<Record<string, any>>({});
  useEffect(() => { api.settings().then(setSettings); }, []);
  const set = (k: string, v: any) => api.setSetting(k, v).then(() => setSettings({ ...settings, [k]: v }));

  return (
    <div style={PAGE}>
      <div>
        <h1 style={{ color: t.txt, fontFamily: t.headFont, fontSize: 22, fontWeight: 700, margin: 0 }}>Settings</h1>
        <div style={{ color: t.muted, fontSize: 12, marginTop: 4 }}>Scan & topology preferences</div>
      </div>
      <Card t={t}>
        <div style={{ color: t.txt, fontWeight: 600, fontFamily: t.headFont, fontSize: 14, marginBottom: 12 }}>Scanning</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <div><label style={smallLabel(t)}>Subnet (CIDR)</label><input value={settings["scan.subnet"] || ""} onChange={e => setSettings({ ...settings, "scan.subnet": e.target.value })} onBlur={e => set("scan.subnet", e.target.value)} style={inputStyle(t)}/></div>
          <div><label style={smallLabel(t)}>Interval (seconds)</label><input type="number" value={settings["scan.interval"] || 300} onChange={e => setSettings({ ...settings, "scan.interval": parseInt(e.target.value) })} onBlur={e => set("scan.interval", parseInt(e.target.value))} style={inputStyle(t)}/></div>
        </div>
      </Card>
      <Card t={t}>
        <div style={{ color: t.txt, fontWeight: 600, fontFamily: t.headFont, fontSize: 14, marginBottom: 12 }}>Topology</div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <SmallToggle t={t} value={settings["topology.autoBuild"] !== false} onChange={v => set("topology.autoBuild", v)}/>
          <span style={{ color: t.txt, fontSize: 13 }}>Allow auto-build (otherwise the rebuild button does nothing)</span>
        </div>
      </Card>

      <NotificationCredentialsCard t={t}/>
    </div>
  );
}

// ─── Notification credentials card (embedded in Settings page) ──────────
// Lists every notification channel that has been configured, lets the user
// edit credentials, test, disable, or delete them. Adding a brand-new channel
// is done from the Notifications page instead.
function NotificationCredentialsCard({ t }: { t: any }) {
  const [notifs, setNotifs] = useState<any[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [config, setConfig] = useState<any>({});
  const [busy, setBusy] = useState(false);
  const [test, setTest] = useState<any>(null);

  const reload = () => api.listNotifications().then(setNotifs).catch(() => {});
  useEffect(() => { reload(); }, []);

  const fields: Record<string, [string, string][]> = {
    telegram: [["token", "Bot token"], ["chatId", "Chat ID"]],
    email:    [["provider", "Provider"], ["address", "Email address"], ["password", "App password"]],
    sms:      [["sid", "Twilio SID"], ["token", "Auth token"], ["from", "From #"], ["to", "To #"]],
    discord:  [["webhookUrl", "Webhook URL"]],
    webhook:  [["url", "Webhook URL"], ["headers", "Headers JSON"]],
  };

  const startEdit = (channel: string) => { setEditing(channel); setConfig({}); setTest(null); };
  const saveEdit = async () => {
    if (!editing) return;
    setBusy(true);
    try { await api.setNotification(editing, true, config); setEditing(null); reload(); }
    catch (err: any) { alert(err.message); }
    finally { setBusy(false); }
  };
  const runTest = async () => {
    if (!editing) return;
    setBusy(true); setTest(null);
    try { setTest(await api.testNotification(editing, config)); }
    catch (err: any) { setTest({ ok: false, error: err.message }); }
    finally { setBusy(false); }
  };
  const disable = async (channel: string) => {
    if (!confirm(`Disable ${channel}?`)) return;
    await api.setNotification(channel, false, {}); reload();
  };
  const remove = async (channel: string) => {
    if (!confirm(`Delete ${channel} configuration entirely (credentials wiped)?`)) return;
    await api.deleteNotification(channel); reload();
  };

  return (
    <Card t={t}>
      <div style={{ color: t.txt, fontWeight: 600, fontFamily: t.headFont, fontSize: 14, marginBottom: 4 }}>Notifications</div>
      <div style={{ color: t.muted, fontSize: 11.5, marginBottom: 14 }}>
        Edit the credentials of channels you've already set up. To add a new channel, go to <strong>Notifications → + Add channel</strong>.
      </div>
      {notifs.length === 0 && (
        <div style={{ padding: 12, color: t.muted, fontSize: 12, fontFamily: t.monoFont, textAlign: "center", border: `1px dashed ${t.border}`, borderRadius: 7 }}>
          No channels configured yet.
        </div>
      )}
      {notifs.map(n => {
        const f = fields[n.channel] || [];
        const isEditing = editing === n.channel;
        return (
          <div key={n.channel} style={{ borderTop: `1px solid ${t.border}40`, padding: "12px 0" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              {/* Three states, not two: a channel whose token is stored but
                  which has not yet managed to send anything is "activating",
                  not "active". It switches on its own at the first successful
                  exchange. */}
              {(() => {
                const state = !n.enabled ? "off" : n.lastSuccess ? "on" : "pending";
                const color = state === "on" ? t.ok : state === "pending" ? t.warn : t.muted;
                const label = state === "on"
                  ? tr("state.active")
                  : state === "pending" ? tr("state.activating") : tr("state.inactive");
                return (
                  <>
                    <span style={{ color, fontSize: 14 }}>{state === "off" ? "○" : "●"}</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ color: t.txt, fontWeight: 600, fontSize: 13, fontFamily: t.headFont, textTransform: "capitalize" }}>{n.channel}</div>
                      <div style={{ color: state === "pending" ? t.warn : t.muted, fontSize: 11, fontFamily: t.monoFont }}>
                        {label}
                        {n.lastSuccess && ` · ${fmtDate(n.lastSuccess)}`}
                      </div>
                      {state === "pending" && (
                        <div style={{ color: t.muted, fontSize: 11, marginTop: 4, maxWidth: 460 }}>
                          {tr("notif.activating.body")}
                        </div>
                      )}
                    </div>
                  </>
                );
              })()}
              <button onClick={() => isEditing ? setEditing(null) : startEdit(n.channel)} style={{ background: t.surface, border: `1px solid ${t.border}`, color: t.muted, padding: "4px 10px", borderRadius: 5, fontSize: 11, cursor: "pointer", fontFamily: t.monoFont }}>{isEditing ? "Close" : "✎ Edit"}</button>
              {n.enabled && <button onClick={() => disable(n.channel)} style={{ background: t.surface, border: `1px solid ${t.border}`, color: t.warn, padding: "4px 10px", borderRadius: 5, fontSize: 11, cursor: "pointer", fontFamily: t.monoFont }}>Disable</button>}
              <button onClick={() => remove(n.channel)} style={{ background: `${t.err}15`, border: `1px solid ${t.err}40`, color: t.err, padding: "4px 10px", borderRadius: 5, fontSize: 11, cursor: "pointer", fontFamily: t.monoFont }}>✕</button>
            </div>
            {isEditing && (
              <div style={{ marginTop: 10, padding: 12, background: t.hover || t.surfaceHover, borderRadius: 7, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                {f.map(([k, l]) => (
                  <div key={k}>
                    <label style={smallLabel(t)}>{l}</label>
                    <input value={config[k] || ""} onChange={(e) => setConfig({ ...config, [k]: e.target.value })}
                      placeholder="Re-enter to update (current is encrypted in DB)"
                      type={k === "password" || k === "token" ? "password" : "text"}
                      style={inputStyle(t)}/>
                  </div>
                ))}
                {test && <div style={{ gridColumn: "1 / -1", padding: 8, background: test.ok ? `${t.ok}15` : `${t.err}15`, color: test.ok ? t.ok : t.err, borderRadius: 5, fontSize: 11, fontFamily: t.monoFont }}>{test.ok ? "✓ Test sent" : `✕ ${test.error}`}</div>}
                <div style={{ gridColumn: "1 / -1", display: "flex", justifyContent: "flex-end", gap: 8 }}>
                  <GhostBtn t={t} onClick={runTest}>{busy ? "…" : "Test"}</GhostBtn>
                  <PrimaryBtn t={t} onClick={saveEdit} disabled={busy}>Save</PrimaryBtn>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </Card>
  );
}

// ─── Internal Toggle ───────────────────────────────────────────────────────
function SmallToggle({ t, value, onChange }: any) {
  return (
    <button onClick={() => onChange(!value)} style={{
      width: 38, height: 20, borderRadius: 10, padding: 2,
      background: value ? t.primary : (t.id === "minimal" ? "#d4d4d8" : "rgba(255,255,255,0.15)"),
      border: "none", cursor: "pointer", flexShrink: 0,
    }}>
      <span style={{ display: "block", width: 16, height: 16, background: "white", borderRadius: "50%", marginLeft: value ? 18 : 0, transition: "margin-left 0.2s" }}/>
    </button>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// BOT COMMANDS — User-defined Telegram triggers (/alert /lockdown /scan etc.)
// ════════════════════════════════════════════════════════════════════════════
export function BotCommandsPage({ t }: { t: any }) {
  const [list, setList] = useState<any[]>([]);
  const [actions, setActions] = useState<any[]>([]);
  const [editing, setEditing] = useState<any | null>(null);
  const [testReply, setTestReply] = useState<{ id: string; reply: string } | null>(null);

  const load = async () => {
    const [l, a] = await Promise.all([api.listBotCommands(), api.getBotActions()]);
    setList(l); setActions(a);
  };
  useEffect(() => { load(); }, []);

  const test = async (cmd: any) => {
    try {
      const r = await api.runBotCommand(cmd.id, []);
      setTestReply({ id: cmd.id, reply: r.reply });
    } catch (err: any) { setTestReply({ id: cmd.id, reply: `❌ ${err.message}` }); }
  };
  const remove = async (cmd: any) => {
    if (!confirm(`Delete "${cmd.trigger}"?`)) return;
    await api.deleteBotCommand(cmd.id); load();
  };
  const toggle = async (cmd: any, enabled: boolean) => {
    await api.updateBotCommand(cmd.id, { enabled }); load();
  };

  return (
    <div style={PAGE}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
        <div>
          <h1 style={{ color: t.txt, fontFamily: t.headFont, fontSize: 22, fontWeight: 700, margin: 0 }}>Bot Commands</h1>
          <div style={{ color: t.muted, fontSize: 12, marginTop: 4 }}>
            Type these in your Telegram chat with the bot to control MapMyLAN remotely.
          </div>
        </div>
        <PrimaryBtn t={t} onClick={() => setEditing({
          isNew: true, trigger: "/", description: "", action: "status",
          params: {}, enabled: true, confirm: false, allowedChatIds: [], cooldownSec: 0,
        })}>+ New bot command</PrimaryBtn>
      </div>

      <Card t={t} padding={0}>
        <div style={{ padding: "12px 18px", borderBottom: `1px solid ${t.border}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ color: t.txt, fontWeight: 600, fontFamily: t.headFont, fontSize: 13 }}>Defined triggers ({list.length})</div>
          <span style={{ color: t.muted, fontSize: 11, fontFamily: t.monoFont }}>{actions.length} actions available</span>
        </div>
        {list.length === 0
          ? <Empty t={t} text="No bot commands yet. Create /alert, /lockdown, /scan…" icon="🤖"/>
          : list.map(c => {
              const action = actions.find((a: any) => a.id === c.action);
              return (
                <div key={c.id} style={{ padding: "12px 18px", borderTop: `1px solid ${t.border}40`, display: "grid", gridTemplateColumns: "auto 1fr auto auto", gap: 14, alignItems: "center" }}>
                  <SmallToggleBC t={t} value={c.enabled} onChange={(v: boolean) => toggle(c, v)}/>
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <code style={{ background: `${t.primary}15`, color: t.primary, padding: "2px 8px", borderRadius: 4, fontFamily: t.monoFont, fontSize: 12.5, fontWeight: 700 }}>{c.trigger}</code>
                      {c.confirm && <span style={{ background: `${t.warn}15`, color: t.warn, padding: "1px 6px", borderRadius: 3, fontSize: 9.5, fontWeight: 700, fontFamily: t.monoFont }}>CONFIRM</span>}
                      {action?.destructive && <span style={{ background: `${t.err}15`, color: t.err, padding: "1px 6px", borderRadius: 3, fontSize: 9.5, fontWeight: 700, fontFamily: t.monoFont }}>DESTRUCTIVE</span>}
                    </div>
                    <div style={{ color: t.muted, fontSize: 11, marginTop: 3, fontFamily: t.monoFont }}>
                      → <span style={{ color: t.info }}>{action?.label || c.action}</span>
                      {c.description && <span> · {c.description}</span>}
                      {c.cooldownSec > 0 && <span> · cooldown {c.cooldownSec}s</span>}
                      <span> · {c.fireCount}× fired</span>
                    </div>
                  </div>
                  <button onClick={() => test(c)} title="Run now (UI test)" style={{ background: t.surface, border: `1px solid ${t.border}`, color: t.txt, padding: "4px 9px", borderRadius: 5, fontSize: 11, cursor: "pointer", fontFamily: t.monoFont }}>▶ Test</button>
                  <div style={{ display: "flex", gap: 4 }}>
                    <button onClick={() => setEditing({ ...c, isNew: false })} style={{ background: t.surface, border: `1px solid ${t.border}`, color: t.muted, padding: "4px 8px", borderRadius: 4, fontSize: 11, cursor: "pointer" }}>✎</button>
                    <button onClick={() => remove(c)} style={{ background: `${t.err}15`, border: `1px solid ${t.err}40`, color: t.err, padding: "4px 8px", borderRadius: 4, fontSize: 11, cursor: "pointer" }}>✕</button>
                  </div>
                  {testReply?.id === c.id && (
                    // The reply is built from network data (hostname, vendor)
                    // that a device chooses itself. Injecting it as HTML would
                    // run a hostile device's script in the admin's browser.
                    // So we display it as text: React escapes everything.
                    <div style={{ gridColumn: "1 / -1", marginTop: 6, padding: 10, background: t.surface, border: `1px solid ${t.border}`, borderRadius: 6, fontFamily: t.monoFont, fontSize: 11, color: t.txt, whiteSpace: "pre-wrap" }}>{stripTags(testReply!.reply)}</div>
                  )}
                </div>
              );
            })
        }
      </Card>

      {editing && (
        <BotCommandEditor t={t} command={editing} actions={actions}
          onClose={() => setEditing(null)}
          onSave={async (data) => {
            try {
              if (editing.isNew) await api.createBotCommand(data);
              else await api.updateBotCommand(editing.id, data);
              setEditing(null); await load();
            } catch (err: any) { alert(err.message); }
          }}/>
      )}
    </div>
  );
}

function SmallToggleBC({ t, value, onChange }: any) {
  return (
    <button onClick={() => onChange(!value)} style={{
      width: 38, height: 20, borderRadius: 10, padding: 2,
      background: value ? t.primary : (t.id === "minimal" ? "#d4d4d8" : "rgba(255,255,255,0.15)"),
      border: "none", cursor: "pointer", flexShrink: 0,
    }}>
      <span style={{ display: "block", width: 16, height: 16, background: "white", borderRadius: "50%", marginLeft: value ? 18 : 0, transition: "margin-left 0.2s" }}/>
    </button>
  );
}

function BotCommandEditor({ t, command, actions, onClose, onSave }: any) {
  const [trigger, setTrigger]       = useState(command.trigger || "/");
  const [description, setDescription] = useState(command.description || "");
  const [action, setAction]         = useState(command.action || "status");
  const [params, setParams]         = useState<any>(command.params || {});
  const [enabled, setEnabled]       = useState(command.enabled !== false);
  const [confirmReq, setConfirmReq] = useState(command.confirm === true);
  const [allowedChatIds, setAllowedChatIds] = useState<string>((command.allowedChatIds || []).join(", "));
  const [cooldownSec, setCooldownSec] = useState(command.cooldownSec || 0);

  const sel = actions.find((a: any) => a.id === action);

  const submit = () => {
    if (!trigger || trigger === "/") return alert("Give your command a trigger like /alert");
    onSave({
      trigger, description, action, params,
      enabled, confirm: confirmReq,
      allowedChatIds: allowedChatIds.split(",").map(s => s.trim()).filter(Boolean),
      cooldownSec: cooldownSec || 0,
    });
  };

  // Auto-confirm on destructive actions
  useEffect(() => { if (sel?.destructive) setConfirmReq(true); }, [action]);

  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, zIndex: 9500, background: "rgba(0,0,0,0.7)",
      backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20,
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        width: 640, maxWidth: "100%", maxHeight: "90vh", overflow: "auto",
        background: t.bg, border: `1px solid ${t.border}`, borderRadius: 14,
      }}>
        <div style={{ padding: "14px 20px", borderBottom: `1px solid ${t.border}`, display: "flex", justifyContent: "space-between", alignItems: "center", position: "sticky", top: 0, background: t.bg, zIndex: 10 }}>
          <div style={{ color: t.txt, fontFamily: t.headFont, fontWeight: 600, fontSize: 16 }}>
            {command.isNew ? "New bot command" : `Edit ${command.trigger}`}
          </div>
          <button onClick={onClose} style={{ background: t.surface, border: `1px solid ${t.border}`, color: t.muted, borderRadius: 6, padding: "4px 9px", cursor: "pointer", fontSize: 14 }}>✕</button>
        </div>
        <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 10 }}>
            <div>
              <Label2 t={t}>Trigger</Label2>
              <input value={trigger} onChange={(e) => setTrigger(e.target.value)} placeholder="/alert" style={ipt2(t)}/>
            </div>
            <div>
              <Label2 t={t}>Description (shown in /help)</Label2>
              <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Lock the network down" style={ipt2(t)}/>
            </div>
          </div>

          <div>
            <Label2 t={t}>Action</Label2>
            <select value={action} onChange={(e) => setAction(e.target.value)} style={ipt2(t)}>
              {actions.map((a: any) => (
                <option key={a.id} value={a.id}>
                  {a.destructive ? "⚠️ " : ""}{a.label} — {a.id}
                </option>
              ))}
            </select>
            {sel?.destructive && <div style={{ color: t.err, fontSize: 11, marginTop: 6, fontFamily: t.monoFont }}>⚠️ This is a destructive action — confirmation will be required.</div>}
          </div>

          {/* Action-specific params */}
          {sel?.params?.filter((p: any) => p.fromConfig).map((p: any) => (
            <div key={p.name}>
              <Label2 t={t}>{p.name}{p.required ? " *" : ""}</Label2>
              <input value={params[p.name] || ""} onChange={(e) => setParams({ ...params, [p.name]: e.target.value })} style={ipt2(t)}/>
              {p.name === "deviceId" && <div style={{ color: t.muted, fontSize: 10.5, marginTop: 3, fontFamily: t.monoFont }}>SSH device ID (find it in SSH Cockpit URL)</div>}
            </div>
          ))}
          {sel?.params?.some((p: any) => p.from === "arg1") && (
            <div style={{ padding: 10, background: t.surface, border: `1px dashed ${t.border}`, borderRadius: 6, color: t.muted, fontSize: 11.5 }}>
              💡 Usage in Telegram: <code style={{ color: t.primary }}>{trigger} 192.168.1.42</code>
            </div>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            <div>
              <Label2 t={t}>Cooldown (seconds)</Label2>
              <input type="number" min={0} value={cooldownSec} onChange={(e) => setCooldownSec(parseInt(e.target.value) || 0)} style={ipt2(t)}/>
            </div>
            <div>
              <Label2 t={t}>Allowed chat IDs (comma sep, empty = primary only)</Label2>
              <input value={allowedChatIds} onChange={(e) => setAllowedChatIds(e.target.value)} placeholder="e.g. 12345678, 87654321" style={ipt2(t)}/>
            </div>
          </div>

          <div style={{ display: "flex", gap: 18 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 8, color: t.txt, fontSize: 12 }}>
              <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)}/>
              Enabled
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 8, color: t.txt, fontSize: 12 }}>
              <input type="checkbox" checked={confirmReq} onChange={(e) => setConfirmReq(e.target.checked)} disabled={sel?.destructive}/>
              Require Y/N confirmation{sel?.destructive ? " (forced for destructive actions)" : ""}
            </label>
          </div>
        </div>
        <div style={{ padding: "14px 20px", borderTop: `1px solid ${t.border}`, display: "flex", justifyContent: "flex-end", gap: 8, position: "sticky", bottom: 0, background: t.bg }}>
          <button onClick={onClose} style={{ background: t.surface, border: `1px solid ${t.border}`, color: t.txt, padding: "8px 16px", borderRadius: 7, cursor: "pointer", fontFamily: t.headFont, fontSize: 12 }}>Cancel</button>
          <button onClick={submit} style={{ background: t.grad, border: "none", color: t.onPrimary, padding: "8px 18px", borderRadius: 7, cursor: "pointer", fontFamily: t.headFont, fontSize: 12, fontWeight: 700 }}>{command.isNew ? "Create" : "Save"}</button>
        </div>
      </div>
    </div>
  );
}

function Label2({ t, children }: any) {
  return <div style={{ color: t.muted, fontSize: 9.5, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600, fontFamily: t.monoFont, marginBottom: 4 }}>{children}</div>;
}
function ipt2(t: any): any {
  return { width: "100%", background: t.surface, border: `1px solid ${t.border}`, color: t.txt, padding: "8px 12px", borderRadius: 7, fontSize: 12.5, fontFamily: t.monoFont, outline: "none" };
}

// Connection screen for the main network gear
export { RouterPage } from "./Router";
