// Connection to the main network gear.
//
// A single device drives active defense: it is the one that blocks, isolates
// and reports what it sees on the wire. The screen first shows what it can do —
// the capabilities declared by the adapter — so that no button promises an
// action the hardware cannot carry out.

import { useEffect, useState } from "react";
import { api } from "../api/client";
import { Icon } from "../lib/icons";
import { translate as tr } from "../lib/i18n";

const PAGE: any = { padding: "22px 32px 60px", maxWidth: 1180 };

// Icon per vendor: we stick to the app's vocabulary.
const VENDOR_ICON: Record<string, string> = {
  unifi: "router", "asus-merlin": "router", edgeos: "router",
  openwrt: "chip", routeros: "switch", pfsense: "shield",
  "cisco-ios": "switch", zyxel: "switch", generic: "ssh",
};

const CAP_LABEL: Record<string, string> = {
  ban: "block", unban: "unblock", quarantine: "isolate",
  clients: "list clients", arp: "ARP table", leases: "DHCP leases",
  ports: "ports", vlans: "VLANs", reboot: "reboot",
};

export function RouterPage({ t }: { t: any }) {
  const [adapters, setAdapters] = useState<any[]>([]);
  const [gear, setGear] = useState<any>(null);
  const [editing, setEditing] = useState(false);
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState<any>(null);
  const [view, setView] = useState<"clients" | "arp">("clients");
  const [rows, setRows] = useState<any[]>([]);
  const [rowsNote, setRowsNote] = useState<string>("");

  const load = async () => {
    const [a, g] = await Promise.all([
      api.routerAdapters().catch(() => []),
      api.getRouter().catch(() => null),
    ]);
    setAdapters(a); setGear(g);
  };
  useEffect(() => { load(); }, []);

  const loadRows = async () => {
    setRows([]); setRowsNote("");
    try {
      const r: any = view === "clients" ? await api.routerClients() : await api.routerArp();
      if (!r.supported) { setRowsNote(tr("gear.unsupported")); return; }
      setRows(view === "clients" ? r.clients : r.entries);
    } catch (e: any) { setRowsNote(e.message); }
  };
  useEffect(() => { if (gear) loadRows(); }, [gear?.id, view]);

  const runTest = async () => {
    setTesting(true); setTest(null);
    try { setTest(await api.testRouter({ useSaved: true })); }
    catch (e: any) { setTest({ ok: false, error: e.message }); }
    finally { setTesting(false); await load(); }
  };

  const remove = async () => {
    if (!confirm(tr("gear.confirmDelete"))) return;
    await api.deleteRouter(); setGear(null); setRows([]);
  };

  const adapter = adapters.find(a => a.id === gear?.vendor);

  return (
    <div style={PAGE}>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 20, marginBottom: 26 }}>
        <div>
          <h1 style={{ fontSize: 38, lineHeight: 1.05, letterSpacing: "-0.035em", margin: "0 0 7px", fontWeight: 600 }}>
            {tr("gear.title")}
          </h1>
          <p style={{ color: t.muted, fontSize: 14.5, maxWidth: "54ch", margin: 0 }}>
            {tr("gear.lede")}
          </p>
        </div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 9 }}>
          {gear && (
            <Btn t={t} icon="refresh" onClick={runTest}>
              {testing ? tr("gear.testing") : tr("gear.test")}
            </Btn>
          )}
          <Btn t={t} icon={gear ? "settings" : "plus"} solid onClick={() => setEditing(true)}>
            {gear ? tr("action.edit") : tr("gear.connect")}
          </Btn>
        </div>
      </div>

      {!gear ? (
        <div style={{
          background: t.surface, borderRadius: 14, boxShadow: t.lift,
          padding: "56px 30px", textAlign: "center",
        }}>
          <span style={{
            width: 44, height: 44, borderRadius: 13, background: t.wash, color: t.primary,
            display: "inline-flex", alignItems: "center", justifyContent: "center", marginBottom: 16,
          }}><Icon name="router" size={22}/></span>
          <div style={{ fontSize: 16, fontWeight: 600, letterSpacing: "-0.02em", marginBottom: 6 }}>
            {tr("gear.emptyTitle")}
          </div>
          <p style={{ color: t.muted, fontSize: 13.5, maxWidth: "46ch", margin: "0 auto 20px" }}>
            {tr("gear.emptyBody")}
          </p>
          <Btn t={t} icon="plus" solid onClick={() => setEditing(true)}>{tr("gear.connect")}</Btn>
        </div>
      ) : (
        <>
          <div style={{ background: t.surface, borderRadius: 14, boxShadow: t.lift, padding: 20, marginBottom: 16 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <span style={{
                width: 40, height: 40, borderRadius: 12, background: t.wash, color: t.primary,
                display: "flex", alignItems: "center", justifyContent: "center", flex: "none",
              }}><Icon name={VENDOR_ICON[gear.vendor] || "router"} size={20}/></span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 15, fontWeight: 600, letterSpacing: "-0.02em" }}>
                  {adapter?.label || gear.vendor}
                </div>
                <div style={{ color: t.muted, fontFamily: t.monoFont, fontSize: 11.5, marginTop: 2 }}>
                  {gear.username}@{gear.host}:{gear.port} · {gear.transport === "api" ? "API" : "SSH"}
                  {gear.site ? ` · site ${gear.site}` : ""}
                </div>
              </div>
              <Btn t={t} icon="ban" onClick={remove} danger>{tr("action.delete")}</Btn>
            </div>

            <div style={{ display: "flex", flexWrap: "wrap", gap: 7, marginTop: 16 }}>
              {(gear.capabilities || []).map((c: string) => (
                <span key={c} style={{
                  fontSize: 11.5, color: t.txtSoft, background: t.well,
                  padding: "4px 10px", borderRadius: 7,
                }}>{CAP_LABEL[c] || c}</span>
              ))}
            </div>

            <div style={{
              marginTop: 16, paddingTop: 14, borderTop: `1px solid ${t.hairSoft}`,
              display: "flex", alignItems: "center", gap: 10, fontSize: 12.5,
              color: gear.lastTestOk === false ? t.err : t.muted,
            }}>
              <Icon name={gear.lastTestOk === false ? "alert" : gear.lastTestOk ? "shield" : "clock"} size={14}/>
              <span style={{ fontFamily: t.monoFont, fontSize: 11.5 }}>
                {gear.lastTestAt
                  ? `${gear.lastTestOk ? tr("gear.lastOk") : tr("gear.lastFail")} · ${new Date(gear.lastTestAt).toLocaleString()}`
                  : tr("gear.never")}
              </span>
              {gear.lastTestInfo && (
                <span style={{ color: t.faint, fontFamily: t.monoFont, fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {gear.lastTestInfo}
                </span>
              )}
            </div>

            {test && (
              <div style={{
                marginTop: 12, padding: "10px 13px", borderRadius: 9, fontSize: 12.5,
                display: "flex", alignItems: "center", gap: 9,
                background: test.ok ? t.wash : t.alarmWash, color: test.ok ? t.primary : t.err,
              }}>
                <Icon name={test.ok ? "shield" : "alert"} size={14}/>
                {test.ok ? (test.info || tr("gear.testOk")) : test.error}
              </div>
            )}
          </div>

          <div style={{ background: t.surface, borderRadius: 14, boxShadow: t.lift, overflow: "hidden" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "15px 18px 13px" }}>
              <h2 style={{ fontSize: 13.5, fontWeight: 600, margin: 0 }}>{tr("gear.seen")}</h2>
              <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
                {(["clients", "arp"] as const).map(v => (
                  <button key={v} onClick={() => setView(v)} style={{
                    padding: "5px 12px", borderRadius: 8, border: "none", cursor: "pointer",
                    fontSize: 12.5, fontFamily: t.font,
                    background: view === v ? t.well : "transparent",
                    color: view === v ? t.txt : t.muted,
                  }}>{v === "clients" ? tr("gear.clients") : tr("gear.arp")}</button>
                ))}
                <button onClick={loadRows} title={tr("gear.reload")} style={{
                  width: 30, height: 30, borderRadius: 8, border: "none", cursor: "pointer",
                  color: t.muted, background: "transparent", display: "flex",
                  alignItems: "center", justifyContent: "center",
                }}><Icon name="refresh" size={15}/></button>
              </div>
            </div>

            {rowsNote ? (
              <div style={{ padding: "30px 18px", textAlign: "center", color: t.muted, fontSize: 13 }}>{rowsNote}</div>
            ) : rows.length === 0 ? (
              <div style={{ padding: "30px 18px", textAlign: "center", color: t.faint, fontSize: 13 }}>{tr("gear.none")}</div>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>{[tr("gear.col.host"), "IP", "MAC", tr("gear.col.vendor"), tr("gear.col.link")].map(h => (
                    <th key={h} style={{
                      textAlign: "left", padding: "0 16px 9px", fontSize: 10.5, letterSpacing: "0.11em",
                      textTransform: "uppercase", color: t.faint, fontWeight: 500,
                      borderBottom: `1px solid ${t.hairSoft}`,
                    }}>{h}</th>
                  ))}</tr>
                </thead>
                <tbody>
                  {rows.map((c, i) => (
                    <tr key={i}>
                      <td style={td(t)}>{c.hostname || "—"}</td>
                      <td style={{ ...td(t), fontFamily: t.monoFont, fontSize: 12 }}>{c.ip || "—"}</td>
                      <td style={{ ...td(t), fontFamily: t.monoFont, fontSize: 12, color: t.muted }}>{c.mac || "—"}</td>
                      <td style={{ ...td(t), color: t.muted }}>{c.vendor || "—"}</td>
                      <td style={td(t)}>
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 7, color: t.muted, fontSize: 12.5 }}>
                          <Icon name={c.medium === "wireless" ? "air" : "wired"} size={13} stroke={1.8}/>
                          {c.medium === "wireless" ? tr("link.wireless") : tr("link.wired")}
                          {c.blocked && <span style={{ color: t.err, marginLeft: 6 }}>{tr("state.banned")}</span>}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}

      {editing && (
        <GearForm t={t} adapters={adapters} gear={gear}
          onClose={() => setEditing(false)}
          onSaved={async () => { setEditing(false); await load(); }}/>
      )}
    </div>
  );
}

function td(t: any): any {
  return { padding: "12px 16px", borderBottom: `1px solid ${t.hairSoft}`, fontSize: 13 };
}

function Btn({ t, icon, children, onClick, solid, danger }: any) {
  return (
    <button onClick={onClick} style={{
      display: "flex", alignItems: "center", gap: 7, padding: "8px 15px", borderRadius: 9,
      fontSize: 13, fontWeight: 500, border: "none", cursor: "pointer", fontFamily: t.font,
      background: solid ? t.grad : t.surface,
      color: solid ? t.onPrimary : danger ? t.err : t.txtSoft,
      boxShadow: t.lift,
    }}>
      {icon && <Icon name={icon} size={14} stroke={1.8}/>}
      {children}
    </button>
  );
}

// ── Connection form ────────────────────────────────────────────────────────
function GearForm({ t, adapters, gear, onClose, onSaved }: any) {
  const [vendor, setVendor] = useState(gear?.vendor || "unifi");
  const [form, setForm] = useState<any>({
    host: gear?.host || "", port: gear?.port || "", username: gear?.username || "",
    password: "", privateKey: "", passphrase: "",
    apiBaseUrl: gear?.apiBaseUrl || "", site: gear?.site || "default",
    verifyTls: !!gear?.verifyTls,
  });
  const [busy, setBusy] = useState<"" | "detect" | "test" | "save">("");
  const [result, setResult] = useState<any>(null);

  const a = adapters.find((x: any) => x.id === vendor);
  const transport = a?.transport === "api" ? "api" : "ssh";
  const needs: string[] = a?.needs || ["password"];
  const payload = () => ({ ...form, vendor, transport, port: Number(form.port) || undefined });

  const detect = async () => {
    setBusy("detect"); setResult(null);
    try {
      const r = await api.detectRouter(payload());
      setResult(r);
      if (r.detected) setVendor(r.detected);
    } catch (e: any) { setResult({ ok: false, error: e.message }); }
    finally { setBusy(""); }
  };
  const test = async () => {
    setBusy("test"); setResult(null);
    try { setResult(await api.testRouter(payload())); }
    catch (e: any) { setResult({ ok: false, error: e.message }); }
    finally { setBusy(""); }
  };
  const save = async () => {
    if (!form.host || !form.username) { setResult({ ok: false, error: tr("gear.needHost") }); return; }
    setBusy("save");
    try { await api.saveRouter(payload()); await onSaved(); }
    catch (e: any) { setResult({ ok: false, error: e.message }); }
    finally { setBusy(""); }
  };

  const field: any = {
    width: "100%", background: t.well, border: "none", color: t.txt,
    borderRadius: 9, padding: "9px 12px", fontSize: 13, outline: "none", fontFamily: t.monoFont,
  };
  const label: any = {
    display: "block", color: t.faint, fontSize: 10.5, textTransform: "uppercase",
    letterSpacing: "0.12em", marginBottom: 5,
  };

  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, zIndex: 9500, background: "rgba(10,11,13,.5)",
      backdropFilter: "blur(3px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20,
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        width: 640, maxWidth: "100%", maxHeight: "90vh", overflowY: "auto",
        background: t.bg, borderRadius: 16, boxShadow: t.liftHi,
      }}>
        <div style={{
          display: "flex", alignItems: "center", gap: 10, padding: "18px 22px",
          position: "sticky", top: 0, background: t.bg, zIndex: 2,
        }}>
          <h2 style={{ fontSize: 17, fontWeight: 600, letterSpacing: "-0.025em", margin: 0 }}>
            {tr("gear.formTitle")}
          </h2>
          <button onClick={onClose} style={{
            marginLeft: "auto", width: 30, height: 30, borderRadius: 9, border: "none",
            background: t.well, color: t.muted, cursor: "pointer", display: "flex",
            alignItems: "center", justifyContent: "center",
          }}><Icon name="plus" size={15} style={{ transform: "rotate(45deg)" }}/></button>
        </div>

        <div style={{ padding: "0 22px 22px" }}>
          <div style={{ ...label, marginBottom: 8 }}>{tr("gear.vendor")}</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, marginBottom: 20 }}>
            {adapters.map((x: any) => {
              const on = x.id === vendor;
              return (
                <button key={x.id} onClick={() => setVendor(x.id)} style={{
                  display: "flex", alignItems: "center", gap: 9, padding: "10px 12px",
                  borderRadius: 10, cursor: "pointer", textAlign: "left", fontFamily: t.font,
                  border: "none", background: on ? t.surface : "transparent",
                  boxShadow: on ? t.lift : "none",
                  color: on ? t.txt : t.muted,
                }}>
                  <span style={{ color: on ? t.primary : t.faint, display: "flex" }}>
                    <Icon name={VENDOR_ICON[x.id] || "router"} size={16}/>
                  </span>
                  <span style={{ fontSize: 12.5, fontWeight: on ? 500 : 400 }}>{x.label}</span>
                </button>
              );
            })}
          </div>

          {a && (
            <div style={{
              display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 20,
              paddingBottom: 18, borderBottom: `1px solid ${t.hairSoft}`,
            }}>
              {a.capabilities.map((c: string) => (
                <span key={c} style={{
                  fontSize: 11, color: t.txtSoft, background: t.well,
                  padding: "3px 9px", borderRadius: 6,
                }}>{CAP_LABEL[c] || c}</span>
              ))}
              <span style={{ marginLeft: "auto", fontSize: 11, color: t.faint, fontFamily: t.monoFont }}>
                {transport === "api" ? "API locale" : "SSH"}
              </span>
            </div>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 12, marginBottom: 12 }}>
            <div>
              <label style={label}>{tr("gear.host")}</label>
              <input value={form.host} onChange={e => setForm({ ...form, host: e.target.value })}
                placeholder="192.0.2.1" style={field}/>
            </div>
            <div>
              <label style={label}>{tr("gear.port")}</label>
              <input value={form.port} onChange={e => setForm({ ...form, port: e.target.value })}
                placeholder={transport === "api" ? "443" : "22"} style={field}/>
            </div>
          </div>

          <div style={{ marginBottom: 12 }}>
            <label style={label}>{tr("gear.user")}</label>
            <input value={form.username} onChange={e => setForm({ ...form, username: e.target.value })}
              placeholder={vendor === "unifi" ? "admin" : "root"} style={field}/>
          </div>

          {needs.includes("password") && (
            <div style={{ marginBottom: 12 }}>
              <label style={label}>{tr("gear.pass")}</label>
              <input type="password" value={form.password}
                onChange={e => setForm({ ...form, password: e.target.value })}
                placeholder={gear?.hasPassword ? tr("gear.keepSecret") : ""} style={field}/>
            </div>
          )}

          {needs.includes("privateKey") && (
            <div style={{ marginBottom: 12 }}>
              <label style={label}>{tr("gear.key")}</label>
              <textarea value={form.privateKey} rows={4}
                onChange={e => setForm({ ...form, privateKey: e.target.value })}
                placeholder={gear?.hasPrivateKey ? tr("gear.keepSecret") : "-----BEGIN OPENSSH PRIVATE KEY-----"}
                style={{ ...field, resize: "vertical", fontSize: 11.5 }}/>
            </div>
          )}

          {transport === "api" && (
            <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 12, marginBottom: 12 }}>
              <div>
                <label style={label}>{tr("gear.apiUrl")}</label>
                <input value={form.apiBaseUrl} onChange={e => setForm({ ...form, apiBaseUrl: e.target.value })}
                  placeholder="https://192.0.2.1" style={field}/>
              </div>
              <div>
                <label style={label}>{tr("gear.site")}</label>
                <input value={form.site} onChange={e => setForm({ ...form, site: e.target.value })}
                  placeholder="default" style={field}/>
              </div>
            </div>
          )}

          <label style={{ display: "flex", alignItems: "center", gap: 9, fontSize: 12.5, color: t.muted, marginBottom: 18 }}>
            <input type="checkbox" checked={form.verifyTls}
              onChange={e => setForm({ ...form, verifyTls: e.target.checked })}/>
            {tr("gear.verifyTls")}
          </label>

          {result && (
            <div style={{
              padding: "10px 13px", borderRadius: 9, fontSize: 12.5, marginBottom: 16,
              display: "flex", alignItems: "center", gap: 9,
              background: result.ok ? t.wash : t.alarmWash, color: result.ok ? t.primary : t.err,
            }}>
              <Icon name={result.ok ? "shield" : "alert"} size={14}/>
              <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>
                {result.ok
                  ? (result.detected ? tr("gear.detected", { v: result.detected }) : (result.info || tr("gear.testOk")))
                  : result.error}
              </span>
            </div>
          )}

          <div style={{ display: "flex", gap: 9 }}>
            <Btn t={t} icon="search" onClick={detect}>
              {busy === "detect" ? "…" : tr("gear.detect")}
            </Btn>
            <Btn t={t} icon="refresh" onClick={test}>
              {busy === "test" ? "…" : tr("gear.test")}
            </Btn>
            <div style={{ marginLeft: "auto" }}>
              <Btn t={t} icon="shield" solid onClick={save}>
                {busy === "save" ? "…" : tr("action.save")}
              </Btn>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
