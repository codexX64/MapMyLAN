// Forced onboarding wizard. Cannot be skipped — the main router IP step is mandatory.

import { useState, useEffect } from "react";
import { api } from "../api/client";
import { useStore } from "../stores/app";

const STEPS = [
  { id: "welcome", label: "Welcome" },
  { id: "router",  label: "Main Router" },
  { id: "ssh",     label: "SSH" },
  { id: "telegram", label: "Telegram" },
  { id: "email",   label: "Email" },
  { id: "sms",     label: "SMS" },
  { id: "topology", label: "Topology" },
  { id: "done",    label: "Done" },
];

export function OnboardingPage() {
  const setSetupComplete = useStore((s) => s.setSetupComplete);
  const [step, setStep] = useState(0);
  const [data, setData] = useState<any>({
    router: { name: "Main Router", host: "", port: 22, username: "admin", password: "", privateKey: "", passphrase: "", useKey: false, vendor: "asus-merlin" },
    sshTested: false,
    telegram: { enabled: false, token: "", chatId: "" },
    email: { enabled: false, provider: "gmail", address: "", password: "" },
    sms: { enabled: false, sid: "", token: "", from: "", to: "" },
    autoTopology: true,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Pre-fill router IP with detected gateway if possible
  useEffect(() => {
    api.settings().then(s => {
      const subnet = s["scan.subnet"] as string | undefined;
      if (subnet && !data.router.host) {
        const guess = subnet.split("/")[0].split(".").slice(0, 3).join(".") + ".1";
        setData((d: any) => ({ ...d, router: { ...d.router, host: guess } }));
      }
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const upd = (key: string, value: any) => setData((d: any) => ({ ...d, [key]: { ...d[key], ...value } }));

  const buildSshPayload = () => {
    const r = data.router;
    return {
      name: r.name, host: r.host, port: r.port, username: r.username, vendor: r.vendor,
      ...(r.useKey
        ? { privateKey: r.privateKey, passphrase: r.passphrase || undefined }
        : { password: r.password }),
    };
  };

  const testSSH = async () => {
    setBusy(true); setError("");
    try {
      const r = await api.testSsh(buildSshPayload());
      if (r.ok) { setData((d: any) => ({ ...d, sshTested: true })); }
      else { setError(r.error || "Connection failed"); }
    } catch (e: any) { setError(e.message); }
    finally { setBusy(false); }
  };

  const saveRouter = async () => {
    setBusy(true);
    try {
      await api.addSsh({ ...buildSshPayload(), isMainRouter: true });
      setStep(step + 1);
    } catch (e: any) { setError(e.message); }
    finally { setBusy(false); }
  };

  const finish = async () => {
    setBusy(true);
    try {
      // Save notification configs
      if (data.telegram.enabled) await api.setNotification("telegram", true, data.telegram);
      if (data.email.enabled) await api.setNotification("email", true, data.email);
      if (data.sms.enabled) await api.setNotification("sms", true, data.sms);
      // Save topology preference
      await api.setSetting("topology.autoBuild", data.autoTopology);
      // Mark setup complete
      await api.completeSetup();
      setSetupComplete(true);
      // Trigger an initial scan + topology build
      api.scan().catch(() => {});
      setTimeout(() => api.autoBuildTopology().catch(() => {}), 5000);
    } catch (e: any) { setError(e.message); setBusy(false); }
  };

  const next = () => setStep(Math.min(STEPS.length - 1, step + 1));
  const prev = () => setStep(Math.max(0, step - 1));

  return (
    <div style={{
      minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
      background: "radial-gradient(ellipse at top, rgba(56,189,248,0.06) 0%, transparent 60%), #07090f",
      fontFamily: "'Outfit', sans-serif", padding: 20, overflow: "auto",
    }}>
      <div style={{
        width: "100%", maxWidth: 620, background: "rgba(255,255,255,0.04)",
        border: "1px solid rgba(255,255,255,0.08)", borderRadius: 22, padding: 32,
        backdropFilter: "blur(24px)", boxShadow: "0 30px 80px rgba(56,189,248,0.18)",
      }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
          <div style={{ width: 30, height: 30, borderRadius: 8, background: "linear-gradient(135deg,#38bdf8,#818cf8)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <span style={{ color: "#F6F6F3", fontWeight: 700, fontSize: 14 }}>✦</span>
          </div>
          <div>
            <div style={{ fontFamily: "'Syne', sans-serif", fontWeight: 800, fontSize: 18, color: "#f1f5f9" }}>Welcome to MapMyLAN</div>
            <div style={{ color: "#64748b", fontFamily: "monospace", fontSize: 11 }}>Setup wizard · {step + 1} / {STEPS.length}</div>
          </div>
        </div>

        {/* Progress bar */}
        <div style={{ display: "flex", gap: 4, margin: "16px 0 28px" }}>
          {STEPS.map((_, i) => (
            <div key={i} style={{
              flex: 1, height: 3, borderRadius: 2,
              background: i <= step ? "linear-gradient(90deg,#38bdf8,#818cf8)" : "rgba(255,255,255,0.08)",
            }}/>
          ))}
        </div>

        {/* Steps */}
        {step === 0 && (
          <div>
            <h2 style={{ color: "#f1f5f9", fontFamily: "'Syne', sans-serif", fontSize: 26, marginBottom: 12, lineHeight: 1.2 }}>Let's secure your network in&nbsp;<span style={{ background: "linear-gradient(135deg,#38bdf8,#818cf8)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>3 minutes</span></h2>
            <p style={{ color: "#9ca3af", fontSize: 14, lineHeight: 1.7, marginBottom: 20 }}>
              MapMyLAN scans your LAN, builds a real topology, monitors every device, and can ban or quarantine threats automatically — all from this dashboard. We need to configure a few things first.
            </p>
            <ul style={{ listStyle: "none", color: "#cbd5e1", fontSize: 13, lineHeight: 2 }}>
              <li>✓ Connect to your main router (the only protected device)</li>
              <li>✓ Optional: Telegram bot for live alerts and remote control</li>
              <li>✓ Optional: Email & SMS notifications</li>
              <li>✓ Choose: auto-build network topology or build it yourself</li>
            </ul>
          </div>
        )}

        {step === 1 && (
          <Step title="Main router" subtitle="Required — this device will never be auto-banned and will execute defense actions">
            {[
              { k: "name", l: "Name" },
              { k: "host", l: "IP address", placeholder: "192.168.1.1" },
              { k: "port", l: "SSH port", type: "number" },
              { k: "username", l: "Username" },
            ].map((f) => (
              <Field key={f.k} label={f.l} type={f.type} placeholder={f.placeholder}
                value={(data.router as any)[f.k]}
                onChange={(v) => upd("router", { [f.k]: f.type === "number" ? parseInt(v) : v })}/>
            ))}
            <SelectField label="Vendor / firmware" value={data.router.vendor} onChange={(v) => upd("router", { vendor: v })}
              options={["asus-merlin", "mikrotik", "openwrt", "pfsense", "cisco", "unifi", "generic"]}/>

            {/* Auth toggle */}
            <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "10px 0 8px", padding: "8px 12px", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 8 }}>
              <span style={{ color: "#cbd5e1", fontSize: 12, flex: 1 }}>Use SSH private key</span>
              <button type="button" onClick={() => upd("router", { useKey: !data.router.useKey })} style={{
                width: 38, height: 20, borderRadius: 10, padding: 2,
                background: data.router.useKey ? "#38bdf8" : "rgba(255,255,255,0.15)",
                border: "none", cursor: "pointer",
              }}>
                <span style={{ display: "block", width: 16, height: 16, background: "white", borderRadius: "50%", marginLeft: data.router.useKey ? 18 : 0, transition: "margin-left 0.2s" }}/>
              </button>
            </div>

            {!data.router.useKey
              ? <Field label="Password" type="password" value={data.router.password} onChange={(v) => upd("router", { password: v })}/>
              : <>
                  <div style={{ marginBottom: 12 }}>
                    <label style={{ color: "#64748b", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", display: "block", marginBottom: 5, fontFamily: "monospace" }}>Private key (paste contents)</label>
                    <textarea rows={5} value={data.router.privateKey} placeholder="-----BEGIN OPENSSH PRIVATE KEY-----&#10;…"
                      onChange={(e) => upd("router", { privateKey: e.target.value })}
                      style={{ width: "100%", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", color: "#f1f5f9", borderRadius: 8, padding: "9px 12px", fontSize: 11, outline: "none", fontFamily: "monospace", resize: "vertical" }}/>
                  </div>
                  <Field label="Passphrase (optional)" type="password" value={data.router.passphrase} onChange={(v) => upd("router", { passphrase: v })}/>
                </>
            }

            {error && <ErrorBox text={error}/>}
            {data.sshTested && <SuccessBox text="✓ Connection works — click Save & Continue"/>}
          </Step>
        )}

        {step === 2 && <Step title="SSH ready" subtitle="The router is configured. We can now execute defense commands on it.">
          <p style={{ color: "#9ca3af", fontSize: 13, lineHeight: 1.6 }}>
            Banned devices will have their traffic dropped at the router. Quarantined devices will be isolated.
            Whitelisted devices (set in the device drawer) and the main router are never bannable.
          </p>
        </Step>}

        {step === 3 && (
          <Step title="Telegram" subtitle="Optional — receive alerts and control MapMyLAN remotely with bot commands">
            <Toggle label="Enable Telegram" value={data.telegram.enabled} onChange={(v) => upd("telegram", { enabled: v })}/>
            {data.telegram.enabled && <>
              <Field label="Bot token" placeholder="From @BotFather" value={data.telegram.token} onChange={(v) => upd("telegram", { token: v })}/>
              <Field label="Chat ID" placeholder="Your Telegram chat ID" value={data.telegram.chatId} onChange={(v) => upd("telegram", { chatId: v })}/>
              <p style={{ color: "#64748b", fontSize: 11, marginTop: 6 }}>
                Once enabled, send /help to your bot for commands: /status, /score &lt;ip&gt;, /ban, /quarantine…
              </p>
            </>}
          </Step>
        )}

        {step === 4 && (
          <Step title="Email" subtitle="Optional — daily summaries and high-severity alerts via email">
            <Toggle label="Enable Email" value={data.email.enabled} onChange={(v) => upd("email", { enabled: v })}/>
            {data.email.enabled && <>
              <SelectField label="Provider" value={data.email.provider} onChange={(v) => upd("email", { provider: v })}
                options={["gmail", "icloud", "outlook"]}/>
              <Field label="Email address" type="email" value={data.email.address} onChange={(v) => upd("email", { address: v })}/>
              <Field label="App password" type="password" value={data.email.password} onChange={(v) => upd("email", { password: v })}/>
            </>}
          </Step>
        )}

        {step === 5 && (
          <Step title="SMS" subtitle="Optional — Twilio integration for critical alerts only">
            <Toggle label="Enable SMS" value={data.sms.enabled} onChange={(v) => upd("sms", { enabled: v })}/>
            {data.sms.enabled && <>
              <Field label="Twilio Account SID" value={data.sms.sid} onChange={(v) => upd("sms", { sid: v })}/>
              <Field label="Twilio Auth Token" type="password" value={data.sms.token} onChange={(v) => upd("sms", { token: v })}/>
              <Field label="From number" value={data.sms.from} onChange={(v) => upd("sms", { from: v })}/>
              <Field label="Your number" value={data.sms.to} onChange={(v) => upd("sms", { to: v })}/>
            </>}
          </Step>
        )}

        {step === 6 && (
          <Step title="Topology" subtitle="MapMyLAN can auto-build the network topology, or you can draw it yourself">
            <button onClick={() => setData((d:any) => ({ ...d, autoTopology: true }))}
              style={cardBtn(data.autoTopology)}>
              <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>Automatic — recommended</div>
              <div style={{ color: "#94a3b8", fontSize: 12, lineHeight: 1.5 }}>MapMyLAN analyzes ARP/SNMP/LLDP and auto-links every device. You can still edit manually.</div>
            </button>
            <button onClick={() => setData((d:any) => ({ ...d, autoTopology: false }))}
              style={{ ...cardBtn(!data.autoTopology), marginTop: 8 }}>
              <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>Manual</div>
              <div style={{ color: "#94a3b8", fontSize: 12, lineHeight: 1.5 }}>Empty map. Drag devices, draw your own links and zones.</div>
            </button>
          </Step>
        )}

        {step === 7 && (
          <Step title="All set" subtitle="MapMyLAN is configured. Triggering an initial scan now…">
            <p style={{ color: "#cbd5e1", fontSize: 14, lineHeight: 1.7 }}>
              Your dashboard will populate over the next 1–2 minutes as the first scan completes. You can re-trigger scans manually any time, and tweak settings later.
            </p>
          </Step>
        )}

        {/* Nav */}
        <div style={{ marginTop: 28, display: "flex", gap: 8, justifyContent: "space-between" }}>
          <button onClick={prev} disabled={step === 0 || busy}
            style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.08)", color: "#9ca3af", padding: "9px 18px", borderRadius: 9, fontSize: 13, cursor: step === 0 ? "not-allowed" : "pointer", opacity: step === 0 ? 0.4 : 1 }}>
            ← Back
          </button>
          <div style={{ display: "flex", gap: 8 }}>
            {step === 1 && !data.sshTested && (
              <button onClick={testSSH} disabled={busy || !data.router.host || (data.router.useKey ? !data.router.privateKey : !data.router.password)}
                style={{ background: "rgba(56,189,248,0.1)", border: "1px solid rgba(56,189,248,0.4)", color: "#38bdf8", padding: "9px 18px", borderRadius: 9, fontSize: 13, cursor: "pointer" }}>
                {busy ? "Testing…" : "Test connection"}
              </button>
            )}
            {step === 1 && data.sshTested && (
              <button onClick={saveRouter} disabled={busy}
                style={primaryBtn}>
                {busy ? "Saving…" : "Save & Continue →"}
              </button>
            )}
            {step !== 1 && step !== STEPS.length - 1 && (
              <button onClick={next} style={primaryBtn}>Next →</button>
            )}
            {step === STEPS.length - 1 && (
              <button onClick={finish} disabled={busy} style={primaryBtn}>{busy ? "Finalizing…" : "Open MapMyLAN ✦"}</button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

const primaryBtn: any = { background: "#14161A", border: "none", color: "#F6F6F3", padding: "9px 22px", borderRadius: 9, fontSize: 13, fontWeight: 700, cursor: "pointer", boxShadow: "0 6px 20px rgba(56,189,248,0.35)" };

function Step({ title, subtitle, children }: any) {
  return (
    <div>
      <h2 style={{ color: "#f1f5f9", fontFamily: "'Syne', sans-serif", fontSize: 22, marginBottom: 4 }}>{title}</h2>
      <p style={{ color: "#94a3b8", fontSize: 13, marginBottom: 18 }}>{subtitle}</p>
      {children}
    </div>
  );
}
function Field({ label, value, onChange, type = "text", placeholder }: any) {
  return (
    <div style={{ marginBottom: 12 }}>
      <label style={{ color: "#64748b", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", display: "block", marginBottom: 5, fontFamily: "monospace" }}>{label}</label>
      <input type={type} value={value || ""} placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        style={{ width: "100%", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", color: "#f1f5f9", borderRadius: 8, padding: "9px 12px", fontSize: 13, outline: "none", fontFamily: "monospace" }}/>
    </div>
  );
}
function SelectField({ label, value, onChange, options }: any) {
  return (
    <div style={{ marginBottom: 12 }}>
      <label style={{ color: "#64748b", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", display: "block", marginBottom: 5, fontFamily: "monospace" }}>{label}</label>
      <select value={value} onChange={(e) => onChange(e.target.value)}
        style={{ width: "100%", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", color: "#f1f5f9", borderRadius: 8, padding: "9px 12px", fontSize: 13, outline: "none", fontFamily: "monospace" }}>
        {options.map((o: string) => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  );
}
function Toggle({ label, value, onChange }: any) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14, padding: "10px 14px", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 10 }}>
      <span style={{ color: "#cbd5e1", fontSize: 13, flex: 1 }}>{label}</span>
      <button onClick={() => onChange(!value)} style={{
        width: 38, height: 20, borderRadius: 10, padding: 2,
        background: value ? "#38bdf8" : "rgba(255,255,255,0.15)",
        border: "none", cursor: "pointer",
      }}>
        <span style={{ display: "block", width: 16, height: 16, background: "white", borderRadius: "50%", marginLeft: value ? 18 : 0, transition: "margin-left 0.2s" }}/>
      </button>
    </div>
  );
}
function cardBtn(active: boolean): any {
  return {
    width: "100%", textAlign: "left",
    background: active ? "rgba(56,189,248,0.08)" : "rgba(255,255,255,0.03)",
    border: `1.5px solid ${active ? "#38bdf8" : "rgba(255,255,255,0.08)"}`,
    color: "#f1f5f9", padding: 14, borderRadius: 12, cursor: "pointer", fontFamily: "inherit",
  };
}
function ErrorBox({ text }: any) { return <div style={{ marginTop: 10, padding: 10, background: "rgba(248,113,113,0.1)", border: "1px solid rgba(248,113,113,0.3)", borderRadius: 6, color: "#f87171", fontSize: 12, fontFamily: "monospace" }}>{text}</div>; }
function SuccessBox({ text }: any) { return <div style={{ marginTop: 10, padding: 10, background: "rgba(34,197,94,0.1)", border: "1px solid rgba(34,197,94,0.3)", borderRadius: 6, color: "#22c55e", fontSize: 12, fontFamily: "monospace" }}>{text}</div>; }
