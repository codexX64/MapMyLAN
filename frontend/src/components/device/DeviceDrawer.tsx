import { useEffect, useState } from "react";
import { useStore } from "../../stores/app";
import { api } from "../../api/client";
import { Theme } from "../../lib/themes";
import { DeviceIcon } from "../ui/DeviceIcon";

interface Props { theme: Theme; }

// Type catalog used by the edit dropdown. The emoji is shown in lists/maps for the
// Modern theme; the value is what gets persisted as customType and drives DeviceIcon/CiscoIcon.
const DEVICE_TYPES = [
  { value: "router",   label: "Router",          emoji: "🌐" },
  { value: "switch",   label: "Switch",          emoji: "🔀" },
  { value: "ap",       label: "Access Point",    emoji: "📡" },
  { value: "firewall", label: "Firewall",        emoji: "🛡" },
  { value: "server",   label: "Server / NAS",    emoji: "🖥️" },
  { value: "laptop",   label: "Laptop / Desktop",emoji: "💻" },
  { value: "phone",    label: "Phone",           emoji: "📱" },
  { value: "tablet",   label: "Tablet",          emoji: "📱" },
  { value: "printer",  label: "Printer",         emoji: "🖨" },
  { value: "camera",   label: "Camera",          emoji: "📷" },
  { value: "tv",       label: "TV / Media",      emoji: "📺" },
  { value: "console",  label: "Game console",    emoji: "🎮" },
  { value: "iot",      label: "IoT / Smart",     emoji: "⚡" },
  { value: "sensor",   label: "Sensor",          emoji: "🌡" },
  { value: "vm",       label: "VM",              emoji: "📦" },
  { value: "container",label: "Container",       emoji: "🐳" },
  { value: "unknown",  label: "Unknown",         emoji: "❓" },
];

export const TYPE_EMOJI: Record<string, string> = Object.fromEntries(DEVICE_TYPES.map(d => [d.value, d.emoji]));

const COMMON_VENDORS = [
  "Apple", "Samsung", "Xiaomi", "Huawei", "Google", "Microsoft", "Intel",
  "Cisco", "MikroTik", "Ubiquiti / UniFi", "TP-Link", "Asus", "Netgear", "D-Link", "Linksys",
  "Synology", "QNAP", "HP", "Dell", "Lenovo", "Acer",
  "Raspberry Pi", "Espressif (ESP32)", "Sonoff", "Tuya", "Shelly", "Sonos",
  "Amazon (Alexa/Echo)", "Google Nest", "Philips Hue", "VMware", "QEMU/KVM", "Proxmox",
];

export function DeviceDrawer({ theme: t }: Props) {
  const id = useStore((s) => s.selectedDeviceId);
  const close = () => useStore.getState().selectDevice(null);
  const [device, setDevice] = useState<any>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<any>({});
  const [actionBusy, setActionBusy] = useState(false);
  const [actionMsg, setActionMsg] = useState("");

  useEffect(() => {
    if (!id) return;
    Promise.all([api.getDevice(id), api.deviceHistory(id)])
      .then(([d, h]) => { setDevice(d); setHistory(h); setForm({
        customName: d.customName || "", customType: d.customType || "",
        vendor: d.vendor || "", model: d.model || "",
        vlan: d.vlan, zone: d.zone || "", role: d.role || "",
        notes: d.notes || "", tags: (d.tags || []).join(", "),
      }); })
      .catch(console.error);
  }, [id]);

  if (!id) return null;
  if (!device) return (
    <div style={drawerStyle(t)}>
      <div style={{ padding: 32, color: t.muted, fontFamily: t.monoFont, fontSize: 13 }}>Loading…</div>
    </div>
  );

  const save = async () => {
    const data: any = { ...form };
    data.tags = form.tags.split(",").map((s: string) => s.trim()).filter(Boolean);
    if (data.vlan === "") data.vlan = null;
    else if (typeof data.vlan === "string") data.vlan = parseInt(data.vlan);
    await api.updateDevice(id, data);
    const fresh = await api.getDevice(id);
    setDevice(fresh);
    setEditing(false);
  };

  const doAction = async (label: string, fn: () => Promise<any>) => {
    setActionBusy(true); setActionMsg("");
    try {
      const r = await fn();
      const detail = r?.output ? `\n${String(r.output).trim().slice(0, 800)}` : "";
      setActionMsg(`✓ ${label} OK${detail}`);
      const fresh = await api.getDevice(id);
      setDevice(fresh);
    } catch (e: any) {
      setActionMsg(`✕ ${e.message}`);
    } finally { setActionBusy(false); }
  };

  const dangerColor = device.dangerScore > 70 ? t.err : device.dangerScore > 40 ? t.warn : t.ok;

  return (
    <div style={drawerStyle(t)} onClick={close}>
      <div onClick={(e) => e.stopPropagation()} style={{
        position: "absolute", top: 0, right: 0, bottom: 0, width: "min(720px,90vw)",
        background: t.bg, borderLeft: `1px solid ${t.border}`, overflowY: "auto",
        boxShadow: "-30px 0 60px rgba(0,0,0,0.4)",
      }}>
        {/* Header */}
        <div style={{ position: "sticky", top: 0, zIndex: 10, background: t.bg, borderBottom: `1px solid ${t.border}`, padding: "16px 22px", display: "flex", alignItems: "center", gap: 14 }}>
          <DeviceIcon type={device.type} size={36} color={dangerColor}/>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ color: t.txt, fontFamily: t.headFont, fontWeight: 700, fontSize: 18, lineHeight: 1.2 }}>
              {device.customName || device.hostname || device.ip}
            </div>
            <div style={{ color: t.muted, fontFamily: t.monoFont, fontSize: 11, marginTop: 2 }}>
              {device.ip} · {device.mac || "no MAC"} · {device.vendor || "Unknown vendor"}
            </div>
          </div>
          {device.isMainRouter && <Badge color={t.ok} label="MAIN ROUTER"/>}
          {device.whitelisted && <Badge color={t.info} label="WHITELISTED"/>}
          <Badge color={device.status === "banned" ? t.err : device.status === "quarantined" ? t.warn : device.status === "online" ? t.ok : t.muted} label={device.status.toUpperCase()}/>
          <button onClick={close} style={{ background: t.hover, border: `1px solid ${t.border}`, color: t.muted, borderRadius: 6, padding: "5px 9px", cursor: "pointer", fontSize: 14 }}>✕</button>
        </div>

        <div style={{ padding: 22, display: "flex", flexDirection: "column", gap: 18 }}>
          {/* SCORES — RADAR */}
          <Card t={t} title="4-Axis Risk Profile">
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, padding: 14 }}>
              <RadarChart t={t}
                trust={device.trustScore} activity={device.activityScore}
                vuln={device.vulnScore} danger={device.dangerScore}/>
              <div style={{ display: "flex", flexDirection: "column", gap: 8, justifyContent: "center" }}>
                <ScoreLine t={t} label="Trust"         value={device.trustScore}    color={t.ok}/>
                <ScoreLine t={t} label="Activity"      value={device.activityScore} color={t.warn} invert/>
                <ScoreLine t={t} label="Vulnerability" value={device.vulnScore}     color={t.warn} invert/>
                <div style={{ borderTop: `1px solid ${t.border}`, paddingTop: 8, marginTop: 4 }}>
                  <ScoreLine t={t} label="DANGER" value={device.dangerScore} color={dangerColor} invert bold/>
                </div>
              </div>
            </div>
            {device.scoreReasons && (
              <details style={{ borderTop: `1px solid ${t.border}`, padding: "10px 14px" }}>
                <summary style={{ color: t.muted, fontSize: 11, cursor: "pointer", fontFamily: t.monoFont }}>
                  Score breakdown
                </summary>
                <div style={{ marginTop: 8, fontSize: 11, fontFamily: t.monoFont, color: t.txt }}>
                  {["trust", "activity", "vuln"].map((k) => {
                    const list = device.scoreReasons[k] || [];
                    if (!list.length) return null;
                    return (
                      <div key={k} style={{ marginBottom: 8 }}>
                        <div style={{ color: t.muted, marginBottom: 3, textTransform: "uppercase", letterSpacing: "0.08em", fontSize: 9 }}>{k}</div>
                        {list.map((r: any, i: number) => (
                          <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "1px 0" }}>
                            <span>{r.reason}</span>
                            <span style={{ color: r.delta > 0 ? t.warn : t.ok, marginLeft: 8 }}>{r.delta > 0 ? "+" : ""}{r.delta}</span>
                          </div>
                        ))}
                      </div>
                    );
                  })}
                </div>
              </details>
            )}
          </Card>

          {/* DEVICE INFO + EDIT */}
          <Card t={t} title="Device Info" right={
            <button onClick={() => setEditing(!editing)} style={{ background: t.panel, border: `1px solid ${t.border}`, color: t.muted, borderRadius: 6, padding: "4px 10px", fontSize: 11, cursor: "pointer", fontFamily: t.monoFont }}>
              {editing ? "Cancel" : "Edit"}
            </button>
          }>
            {!editing ? (
              <div style={{ padding: 14, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, fontFamily: t.monoFont }}>
                {[
                  ["IP", device.ip], ["MAC", device.mac || "—"],
                  ["Hostname", device.hostname || "—"], ["Custom name", device.customName || "—"],
                  ["Vendor", device.vendor || "—"], ["Model", device.model || "—"],
                  ["OS", device.os || "—"], ["Type", device.customType || device.type],
                  ["VLAN", device.vlan ?? "—"], ["Zone", device.zone || "—"],
                  ["Role", device.role || "—"], ["Tags", (device.tags || []).join(", ") || "—"],
                  ["First seen", new Date(device.firstSeen).toLocaleString()],
                  ["Last seen", new Date(device.lastSeen).toLocaleString()],
                ].map(([k, v]) => (
                  <div key={k as string}>
                    <div style={{ color: t.muted, fontSize: 9.5, textTransform: "uppercase", letterSpacing: "0.08em" }}>{k}</div>
                    <div style={{ color: t.txt, fontSize: 12, marginTop: 2 }}>{v as any}</div>
                  </div>
                ))}
                {device.notes && (
                  <div style={{ gridColumn: "1 / -1", marginTop: 6 }}>
                    <div style={{ color: t.muted, fontSize: 9.5, textTransform: "uppercase", letterSpacing: "0.08em" }}>Notes</div>
                    <div style={{ color: t.txt, fontSize: 12, marginTop: 4, padding: 10, background: t.hover, borderRadius: 6, whiteSpace: "pre-wrap" }}>{device.notes}</div>
                  </div>
                )}
              </div>
            ) : (
              <div style={{ padding: 14, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <FieldRow t={t} label="Custom name" value={form.customName} onChange={(v: any) => setForm({ ...form, customName: v })}/>

                {/* Type dropdown — drives the icon */}
                <div>
                  <div style={{ color: t.muted, fontSize: 9.5, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4 }}>Type</div>
                  <select value={form.customType || ""} onChange={(e) => setForm({ ...form, customType: e.target.value })}
                    style={{ width: "100%", background: t.hover || t.surfaceHover, border: `1px solid ${t.border}`, color: t.txt, borderRadius: 6, padding: "7px 10px", fontSize: 12, fontFamily: t.monoFont, outline: "none" }}>
                    <option value="">(auto: {device.type})</option>
                    {DEVICE_TYPES.map((dt) => (
                      <option key={dt.value} value={dt.value}>{dt.emoji ? `${dt.emoji} ` : ""}{dt.label}</option>
                    ))}
                  </select>
                </div>

                {/* Vendor — datalist for free entry with suggestions */}
                <div>
                  <div style={{ color: t.muted, fontSize: 9.5, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4 }}>Vendor</div>
                  <input list="vendor-suggestions" value={form.vendor || ""} onChange={(e) => setForm({ ...form, vendor: e.target.value })}
                    style={{ width: "100%", background: t.hover || t.surfaceHover, border: `1px solid ${t.border}`, color: t.txt, borderRadius: 6, padding: "7px 10px", fontSize: 12, fontFamily: t.monoFont, outline: "none" }}/>
                  <datalist id="vendor-suggestions">
                    {COMMON_VENDORS.map(v => <option key={v} value={v}/>)}
                  </datalist>
                </div>

                <FieldRow t={t} label="Model" value={form.model} onChange={(v: any) => setForm({ ...form, model: v })}/>
                <FieldRow t={t} label="VLAN" value={form.vlan} onChange={(v: any) => setForm({ ...form, vlan: v })}/>
                <FieldRow t={t} label="Zone" value={form.zone} onChange={(v: any) => setForm({ ...form, zone: v })}/>
                <FieldRow t={t} label="Role" value={form.role} onChange={(v: any) => setForm({ ...form, role: v })}/>
                <FieldRow t={t} label="Tags (comma sep.)" value={form.tags} onChange={(v: any) => setForm({ ...form, tags: v })}/>

                {/* Live preview of resulting type */}
                <div style={{ gridColumn: "1 / -1", display: "flex", alignItems: "center", gap: 10, padding: 10, background: t.hover || t.surfaceHover, borderRadius: 6, border: `1px dashed ${t.border}` }}>
                  <span style={{ fontSize: 24 }}>{TYPE_EMOJI[form.customType || device.type] || "❓"}</span>
                  <span style={{ color: t.muted, fontSize: 11, fontFamily: t.monoFont }}>
                    Icon will use: <strong style={{ color: t.txt }}>{form.customType || device.type}</strong>
                  </span>
                </div>

                <div style={{ gridColumn: "1 / -1" }}>
                  <div style={{ color: t.muted, fontSize: 9.5, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4 }}>Notes</div>
                  <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={3}
                    style={{ width: "100%", background: t.hover || t.surfaceHover, border: `1px solid ${t.border}`, color: t.txt, borderRadius: 6, padding: "8px 10px", fontSize: 12, fontFamily: t.monoFont, outline: "none", resize: "vertical" }}/>
                </div>
                <div style={{ gridColumn: "1 / -1", display: "flex", gap: 8, justifyContent: "flex-end" }}>
                  <button onClick={save} style={{ background: t.grad, border: "none", color: t.onPrimary, padding: "7px 18px", borderRadius: 7, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>Save</button>
                </div>
              </div>
            )}
          </Card>

          {/* DEFENSE ACTIONS */}
          <Card t={t} title="Defense Actions">
            <div style={{ padding: 14, display: "flex", flexWrap: "wrap", gap: 8 }}>
              {device.isMainRouter ? (
                <div style={{ color: t.muted, fontSize: 12, fontFamily: t.monoFont }}>
                  Main router is protected — no defense actions available.
                </div>
              ) : (
                <>
                  <ActionBtn t={t} color={t.warn} disabled={actionBusy} onClick={() => doAction("Quarantined", () => api.quarantineDevice(id))}>⚠ Quarantine</ActionBtn>
                  <ActionBtn t={t} color={t.err} disabled={actionBusy} onClick={() => doAction("Banned", () => api.banDevice(id))}>⛔ Ban</ActionBtn>
                  {(device.status === "banned" || device.status === "quarantined") && (
                    <ActionBtn t={t} color={t.ok} disabled={actionBusy} onClick={() => doAction("Unbanned", () => api.unbanDevice(id))}>✓ Restore</ActionBtn>
                  )}
                  <ActionBtn t={t} color={device.whitelisted ? t.warn : t.info} disabled={actionBusy} onClick={() => doAction("Updated", () => api.updateDevice(id, { whitelisted: !device.whitelisted }))}>
                    {device.whitelisted ? "Remove from whitelist" : "Whitelist"}
                  </ActionBtn>
                  <ActionBtn t={t} color={t.info} disabled={actionBusy} onClick={() => doAction("Re-scored", () => api.scoreDevice(id))}>↻ Re-score</ActionBtn>
                  <ActionBtn t={t} color={t.info} disabled={actionBusy} onClick={() => doAction("Deep scan started", () => api.deepScan(id))}>🔍 Deep scan</ActionBtn>
                </>
              )}
              {actionMsg && <pre style={{ width: "100%", padding: 10, marginTop: 4, fontSize: 10.5, fontFamily: t.monoFont, color: actionMsg.startsWith("✓") ? t.ok : t.err, borderRadius: 5, background: actionMsg.startsWith("✓") ? `${t.ok}10` : `${t.err}10`, border: `1px solid ${actionMsg.startsWith("✓") ? t.ok : t.err}30`, whiteSpace: "pre-wrap", maxHeight: 220, overflow: "auto", margin: 0 }}>{actionMsg}</pre>}
            </div>
          </Card>

          {/* INTERFACES (NICs) */}
          <InterfacesCard t={t} device={device} onChange={async () => { const fresh = await api.getDevice(id); setDevice(fresh); }}/>

          {/* MERGE */}
          <MergeCard t={t} device={device} onMerged={async () => { const fresh = await api.getDevice(id); setDevice(fresh); }}/>

          {/* PORTS */}
          {device.ports && device.ports.length > 0 && (
            <Card t={t} title={`Open Ports (${device.ports.length})`}>
              <table style={{ width: "100%", fontFamily: t.monoFont, fontSize: 11 }}>
                <thead>
                  <tr style={{ background: t.hover }}>
                    {["Port", "Proto", "Service", "Product", "Version"].map(h => (
                      <th key={h} style={{ textAlign: "left", padding: "6px 12px", color: t.muted, fontSize: 9.5, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {device.ports.map((p: any) => (
                    <tr key={p.id} style={{ borderTop: `1px solid ${t.border}40` }}>
                      <td style={{ padding: "6px 12px", color: t.info, fontWeight: 600 }}>{p.port}</td>
                      <td style={{ padding: "6px 12px", color: t.muted }}>{p.protocol}</td>
                      <td style={{ padding: "6px 12px", color: t.txt }}>{p.service || "—"}</td>
                      <td style={{ padding: "6px 12px", color: t.muted }}>{p.product || "—"}</td>
                      <td style={{ padding: "6px 12px", color: t.muted }}>{p.version || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}

          {/* CVEs */}
          {device.cves && device.cves.length > 0 && (
            <Card t={t} title={`Vulnerabilities (${device.cves.length})`}>
              <div style={{ padding: 14 }}>
                {device.cves.map((c: any) => (
                  <div key={c.id} style={{ padding: 8, border: `1px solid ${t.err}30`, background: `${t.err}06`, borderRadius: 6, marginBottom: 6 }}>
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <span style={{ background: `${t.err}20`, color: t.err, padding: "2px 7px", borderRadius: 4, fontSize: 10, fontFamily: t.monoFont, fontWeight: 700 }}>CVSS {c.cvss}</span>
                      <span style={{ color: t.txt, fontSize: 12, fontFamily: t.monoFont, fontWeight: 600 }}>{c.cveId}</span>
                      {c.service && <span style={{ color: t.muted, fontSize: 11 }}>· {c.service}</span>}
                    </div>
                    <div style={{ color: t.muted, fontSize: 11, marginTop: 4 }}>{c.description}</div>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* TIMELINE */}
          <Card t={t} title="History">
            <div style={{ padding: 14, maxHeight: 280, overflowY: "auto" }}>
              {history.length === 0 && <div style={{ color: t.muted, fontSize: 12, fontFamily: t.monoFont }}>No history yet.</div>}
              {history.map((h) => (
                <div key={h.id} style={{ display: "flex", gap: 10, padding: "5px 0", borderBottom: `1px solid ${t.border}40` }}>
                  <span style={{ color: t.muted, fontSize: 10, width: 130, flexShrink: 0, fontFamily: t.monoFont }}>{new Date(h.createdAt).toLocaleString()}</span>
                  <span style={{ color: t.info, fontSize: 10, width: 90, fontFamily: t.monoFont, flexShrink: 0 }}>{h.event}</span>
                  <span style={{ color: t.txt, fontSize: 11, fontFamily: t.monoFont, flex: 1 }}>{summarize(h.data)}</span>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

function summarize(data: any): string {
  if (!data) return "";
  if (data.action) return `Action: ${data.action}${data.reason ? ` (${data.reason})` : ""}`;
  if (data.from && data.to) return `${data.from} → ${data.to}`;
  if (data.changes) return `Updated: ${Object.keys(data.changes).join(", ")}`;
  if (data.ip) return `IP ${data.ip}${data.vendor ? `, ${data.vendor}` : ""}`;
  return JSON.stringify(data).slice(0, 80);
}

const drawerStyle = (t: Theme): any => ({
  position: "fixed", inset: 0, zIndex: 9000, background: "rgba(0,0,0,0.65)", backdropFilter: "blur(4px)",
});

function Card({ t, title, right, children }: { t: Theme; title: string; right?: any; children: any }) {
  return (
    <div style={{ background: t.panel, border: `1px solid ${t.border}`, borderRadius: t.radius, overflow: "hidden" }}>
      <div style={{ padding: "10px 14px", borderBottom: `1px solid ${t.border}`, display: "flex", alignItems: "center", color: t.txt, fontFamily: t.headFont, fontWeight: 600, fontSize: 13 }}>
        <span style={{ flex: 1 }}>{title}</span>
        {right}
      </div>
      {children}
    </div>
  );
}

function Badge({ color, label }: any) {
  return <span style={{ background: `${color}18`, color, border: `1px solid ${color}30`, padding: "2px 8px", borderRadius: 4, fontSize: 9.5, fontWeight: 700, letterSpacing: "0.06em", fontFamily: "monospace" }}>{label}</span>;
}

function FieldRow({ t, label, value, onChange }: any) {
  return (
    <div>
      <div style={{ color: t.muted, fontSize: 9.5, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4 }}>{label}</div>
      <input value={value || ""} onChange={(e) => onChange(e.target.value)}
        style={{ width: "100%", background: t.hover, border: `1px solid ${t.border}`, color: t.txt, borderRadius: 6, padding: "7px 10px", fontSize: 12, fontFamily: t.monoFont, outline: "none" }}/>
    </div>
  );
}

function ScoreLine({ t, label, value, color, invert, bold }: any) {
  const display = value ?? 0;
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
        <span style={{ color: bold ? t.txt : t.muted, fontSize: bold ? 12 : 11, fontWeight: bold ? 700 : 400, fontFamily: t.monoFont, textTransform: "uppercase", letterSpacing: "0.06em" }}>{label}</span>
        <span style={{ color, fontSize: bold ? 13 : 11, fontWeight: 700, fontFamily: t.monoFont }}>{display}/100</span>
      </div>
      <div style={{ height: bold ? 5 : 3, background: "rgba(255,255,255,0.06)", borderRadius: 2, overflow: "hidden" }}>
        <div style={{ width: `${display}%`, height: "100%", background: color, transition: "width 0.6s ease" }}/>
      </div>
    </div>
  );
}

function ActionBtn({ t, color, onClick, disabled, children }: any) {
  return (
    <button onClick={onClick} disabled={disabled} style={{
      background: `${color}14`, border: `1px solid ${color}50`, color,
      padding: "7px 14px", borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: disabled ? "wait" : "pointer",
      fontFamily: t.headFont, opacity: disabled ? 0.5 : 1,
    }}>{children}</button>
  );
}

// 4-axis radar chart
function RadarChart({ t, trust, activity, vuln, danger }: any) {
  const cx = 110, cy = 110, max = 90;
  const axes = [
    { label: "Trust", value: trust, angle: -Math.PI / 2 },
    { label: "Activity", value: activity, angle: 0 },
    { label: "Vulnerability", value: vuln, angle: Math.PI / 2 },
    { label: "Danger", value: danger, angle: Math.PI },
  ];
  const points = axes.map(a => ({
    x: cx + Math.cos(a.angle) * (a.value / 100) * max,
    y: cy + Math.sin(a.angle) * (a.value / 100) * max,
    label: a.label, ax: cx + Math.cos(a.angle) * (max + 18), ay: cy + Math.sin(a.angle) * (max + 18),
  }));
  return (
    <svg width="100%" height="220" viewBox="0 0 220 220">
      {/* Concentric grid */}
      {[0.25, 0.5, 0.75, 1].map((r) => (
        <polygon key={r}
          points={axes.map(a => `${cx + Math.cos(a.angle) * max * r},${cy + Math.sin(a.angle) * max * r}`).join(" ")}
          fill="none" stroke={t.border} strokeWidth={0.6}/>
      ))}
      {/* Axes lines */}
      {axes.map((a, i) => (
        <line key={i} x1={cx} y1={cy}
          x2={cx + Math.cos(a.angle) * max} y2={cy + Math.sin(a.angle) * max}
          stroke={t.border} strokeWidth={0.6}/>
      ))}
      {/* Data shape */}
      <polygon points={points.map(p => `${p.x},${p.y}`).join(" ")}
        fill={`${t.hi}30`} stroke={t.hi} strokeWidth={1.5}/>
      {/* Axis labels */}
      {points.map((p, i) => (
        <text key={i} x={p.ax} y={p.ay + 4} textAnchor="middle" fill={t.muted} fontSize={9} fontFamily={t.monoFont}>{p.label}</text>
      ))}
      {/* Center value */}
      <text x={cx} y={cy + 4} textAnchor="middle" fill={t.txt} fontSize={20} fontFamily={t.monoFont} fontWeight={700}>{danger}</text>
    </svg>
  );
}

// ─── Interfaces card ──────────────────────────────────────────────────────
function InterfacesCard({ t, device, onChange }: { t: Theme; device: any; onChange: () => Promise<void> }) {
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState<any>({ mac: "", ip: "", type: "ethernet", label: "" });
  const interfaces = device.interfaces || [];

  // Synthesize a row for the "primary" interface that mirrors device.mac/ip
  // when it isn't represented in the interfaces table yet.
  const primaryRow = device.mac && !interfaces.find((i: any) => i.mac === device.mac)
    ? { id: "_primary", mac: device.mac, ip: device.ip, type: "ethernet", label: "primary", isPrimary: true, _virtual: true }
    : null;
  const all = primaryRow ? [primaryRow, ...interfaces] : interfaces;

  const submitAdd = async () => {
    try {
      await api.addInterface(device.id, {
        mac: form.mac || null,
        ip: form.ip || null,
        type: form.type,
        label: form.label || null,
      });
      setAdding(false);
      setForm({ mac: "", ip: "", type: "ethernet", label: "" });
      await onChange();
    } catch (err: any) { alert(err.message); }
  };
  const remove = async (ifaceId: string) => {
    if (!confirm("Remove this network interface?")) return;
    try { await api.deleteInterface(device.id, ifaceId); await onChange(); }
    catch (err: any) { alert(err.message); }
  };

  return (
    <Card t={t} title={`Network Interfaces (${all.length})`} right={
      <button onClick={() => setAdding(!adding)} style={{ background: t.panel || t.surface, border: `1px solid ${t.border}`, color: t.muted, borderRadius: 6, padding: "4px 10px", fontSize: 11, cursor: "pointer", fontFamily: t.monoFont }}>
        {adding ? "Cancel" : "+ Add NIC"}
      </button>
    }>
      <div style={{ padding: 14 }}>
        {all.length === 0 && (
          <div style={{ color: t.muted, fontSize: 12, fontFamily: t.monoFont }}>
            No interfaces yet. Add one to track multiple NICs (Wi-Fi + Ethernet).
          </div>
        )}
        {all.map((iface: any) => (
          <div key={iface.id} style={{
            display: "grid", gridTemplateColumns: "auto 1fr 1fr 1fr auto auto",
            gap: 10, alignItems: "center", padding: "7px 0", borderTop: `1px solid ${t.border}40`, fontFamily: t.monoFont, fontSize: 11.5,
          }}>
            <span style={{ fontSize: 16 }}>{iface.type === "wifi" ? "📶" : iface.type === "virtual" ? "🔁" : "🔌"}</span>
            <div>
              <div style={{ color: t.muted, fontSize: 9, textTransform: "uppercase", letterSpacing: "0.06em" }}>MAC</div>
              <div style={{ color: t.txt }}>{iface.mac || "—"}</div>
            </div>
            <div>
              <div style={{ color: t.muted, fontSize: 9, textTransform: "uppercase", letterSpacing: "0.06em" }}>IP</div>
              <div style={{ color: t.txt }}>{iface.ip || "—"}</div>
            </div>
            <div>
              <div style={{ color: t.muted, fontSize: 9, textTransform: "uppercase", letterSpacing: "0.06em" }}>Label</div>
              <div style={{ color: t.txt }}>{iface.label || iface.type}</div>
            </div>
            <span style={{ background: `${t.info}15`, color: t.info, padding: "2px 7px", borderRadius: 4, fontSize: 9.5, fontWeight: 700 }}>{iface.type}</span>
            {!iface._virtual && !iface.isPrimary
              ? <button onClick={() => remove(iface.id)} style={{ background: `${t.err}15`, border: `1px solid ${t.err}40`, color: t.err, padding: "3px 7px", borderRadius: 4, fontSize: 11, cursor: "pointer" }}>✕</button>
              : <span style={{ color: t.ok, fontSize: 9.5, fontFamily: t.monoFont }}>★</span>
            }
          </div>
        ))}

        {adding && (
          <div style={{ marginTop: 12, padding: 12, background: t.hover || t.surfaceHover, borderRadius: 6, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <div>
              <div style={{ color: t.muted, fontSize: 9.5, textTransform: "uppercase", marginBottom: 4 }}>Type</div>
              <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}
                style={{ width: "100%", background: t.bg, border: `1px solid ${t.border}`, color: t.txt, borderRadius: 5, padding: "6px 9px", fontSize: 12, fontFamily: t.monoFont }}>
                <option value="ethernet">ethernet</option>
                <option value="wifi">wifi</option>
                <option value="virtual">virtual</option>
                <option value="other">other</option>
              </select>
            </div>
            <div>
              <div style={{ color: t.muted, fontSize: 9.5, textTransform: "uppercase", marginBottom: 4 }}>Label</div>
              <input value={form.label} placeholder="eth0, wlan0…" onChange={(e) => setForm({ ...form, label: e.target.value })}
                style={{ width: "100%", background: t.bg, border: `1px solid ${t.border}`, color: t.txt, borderRadius: 5, padding: "6px 9px", fontSize: 12, fontFamily: t.monoFont }}/>
            </div>
            <div>
              <div style={{ color: t.muted, fontSize: 9.5, textTransform: "uppercase", marginBottom: 4 }}>MAC</div>
              <input value={form.mac} placeholder="aa:bb:cc:dd:ee:ff" onChange={(e) => setForm({ ...form, mac: e.target.value })}
                style={{ width: "100%", background: t.bg, border: `1px solid ${t.border}`, color: t.txt, borderRadius: 5, padding: "6px 9px", fontSize: 12, fontFamily: t.monoFont }}/>
            </div>
            <div>
              <div style={{ color: t.muted, fontSize: 9.5, textTransform: "uppercase", marginBottom: 4 }}>IP</div>
              <input value={form.ip} placeholder="192.168.x.x" onChange={(e) => setForm({ ...form, ip: e.target.value })}
                style={{ width: "100%", background: t.bg, border: `1px solid ${t.border}`, color: t.txt, borderRadius: 5, padding: "6px 9px", fontSize: 12, fontFamily: t.monoFont }}/>
            </div>
            <div style={{ gridColumn: "1 / -1", display: "flex", justifyContent: "flex-end" }}>
              <button onClick={submitAdd} style={{ background: t.grad, border: "none", color: t.onPrimary, padding: "6px 14px", borderRadius: 5, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>Add NIC</button>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}

// ─── Merge card ───────────────────────────────────────────────────────────
function MergeCard({ t, device, onMerged }: { t: Theme; device: any; onMerged: () => Promise<void> }) {
  const allDevices = useStore(s => s.devices);
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState(false);

  const candidates = allDevices.filter(d => d.id !== device.id && !d.isMainRouter && (
    !filter || [d.ip, d.mac, d.hostname, d.customName, d.vendor].filter(Boolean)
      .some(v => String(v).toLowerCase().includes(filter.toLowerCase()))
  ));

  const merge = async (sourceId: string, sourceLabel: string) => {
    if (!confirm(`Absorb "${sourceLabel}" into this device? Its MAC will become an extra interface here. The other entry will be deleted.`)) return;
    setBusy(true);
    try {
      await api.mergeDevices(device.id, sourceId);
      await useStore.getState().refreshDevices();
      await onMerged();
      setOpen(false);
    } catch (e: any) { alert(e.message); }
    finally { setBusy(false); }
  };

  return (
    <Card t={t} title="Merge with another device" right={
      <button onClick={() => setOpen(!open)} style={{ background: t.panel || t.surface, border: `1px solid ${t.border}`, color: t.muted, borderRadius: 6, padding: "4px 10px", fontSize: 11, cursor: "pointer", fontFamily: t.monoFont }}>
        {open ? "Cancel" : "Merge…"}
      </button>
    }>
      {open && (
        <div style={{ padding: 14 }}>
          <div style={{ color: t.muted, fontSize: 11.5, marginBottom: 10, lineHeight: 1.5 }}>
            Pick another device that's actually the same physical machine (e.g. a Wi-Fi entry of the same laptop).
            Its MAC and history will be merged here and the duplicate entry will be removed.
          </div>
          <input placeholder="Search…" value={filter} onChange={(e) => setFilter(e.target.value)}
            style={{ width: "100%", background: t.hover || t.surfaceHover, border: `1px solid ${t.border}`, color: t.txt, borderRadius: 6, padding: "7px 10px", fontSize: 12, fontFamily: t.monoFont, marginBottom: 8 }}/>
          <div style={{ maxHeight: 240, overflow: "auto" }}>
            {candidates.slice(0, 30).map(d => (
              <div key={d.id} onClick={() => !busy && merge(d.id, d.customName || d.hostname || d.ip)}
                style={{ padding: "9px 12px", borderTop: `1px solid ${t.border}40`, cursor: busy ? "wait" : "pointer", display: "flex", gap: 10, alignItems: "center", opacity: busy ? 0.5 : 1 }}
                onMouseEnter={(e) => !busy && (e.currentTarget.style.background = t.hover || t.surfaceHover)}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
                <span style={{ fontSize: 16 }}>{TYPE_EMOJI[d.customType || d.type] || "❓"}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ color: t.txt, fontSize: 12.5, fontWeight: 600 }}>{d.customName || d.hostname || d.ip}</div>
                  <div style={{ color: t.muted, fontSize: 10.5, fontFamily: t.monoFont }}>{d.ip} · {d.mac || "no MAC"} · {d.vendor || "?"}</div>
                </div>
                <span style={{ color: t.info, fontSize: 18 }}>+</span>
              </div>
            ))}
            {candidates.length === 0 && <div style={{ padding: 16, color: t.muted, fontSize: 12, textAlign: "center", fontFamily: t.monoFont }}>No candidates</div>}
          </div>
        </div>
      )}
    </Card>
  );
}
