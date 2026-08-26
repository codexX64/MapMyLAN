// Activation de la double authentification.
//
// L'enrôlement se fait en deux temps : on génère un secret, on le scanne, puis
// on confirme avec un premier code. Tant que la confirmation n'a pas eu lieu,
// le second facteur reste inactif — on ne veut enfermer personne dehors à
// cause d'un QR mal scanné.

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { api } from "../../api/client";
import { Icon } from "../../lib/icons";
import { translate as tr } from "../../lib/i18n";

export function TotpPanel({ t }: { t: any }) {
  const [status, setStatus] = useState<{ totpEnabled: boolean; telegramReady: boolean } | null>(null);
  const [secret, setSecret] = useState("");
  const [qr, setQr] = useState("");
  const [code, setCode] = useState("");
  const [pass, setPass] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<"idle" | "enroll" | "disable">("idle");

  const load = () => api.totpStatus().then(setStatus).catch(() => {});
  useEffect(() => { load(); }, []);

  const startEnroll = async () => {
    setErr(""); setBusy(true);
    try {
      const r = await api.totpSetup();
      setSecret(r.secret);
      setQr(await QRCode.toDataURL(r.uri, { margin: 1, width: 220 }));
      setMode("enroll");
    } catch (e: any) { setErr(e.message); }
    finally { setBusy(false); }
  };

  const confirm = async () => {
    setErr(""); setBusy(true);
    try {
      await api.totpEnable(code);
      setMode("idle"); setCode(""); setSecret(""); setQr("");
      await load();
    } catch (e: any) { setErr(e.message); }
    finally { setBusy(false); }
  };

  const disable = async () => {
    setErr(""); setBusy(true);
    try {
      await api.totpDisable(pass, code);
      setMode("idle"); setCode(""); setPass("");
      await load();
    } catch (e: any) { setErr(e.message); }
    finally { setBusy(false); }
  };

  const field: any = {
    width: "100%", background: t.well, border: `1px solid ${t.border}`, color: t.txt,
    borderRadius: 9, padding: "9px 12px", fontSize: 13, outline: "none", fontFamily: t.monoFont,
  };
  const btn = (solid?: boolean, danger?: boolean): any => ({
    display: "inline-flex", alignItems: "center", gap: 7, padding: "8px 15px", borderRadius: 9,
    fontSize: 13, fontWeight: 500, border: "none", cursor: "pointer", fontFamily: t.font,
    background: solid ? t.grad : t.well,
    color: solid ? t.onPrimary : danger ? t.err : t.txtSoft,
  });

  const on = !!status?.totpEnabled;

  return (
    /* Même coquille que les autres blocs de réglage : pastille de 30 px,
       en-tête à 18 px, corps dans un « pad ». Chacun avait la sienne — 34 px
       ici, 36 px là, un padding de 20 ailleurs — et les titres ne tombaient
       pas sur la même verticale d'un bloc à l'autre. */
    <div className="set">
      <header>
        <span className={`tile${on ? "" : " plain"}`}><Icon name="shield" size={17}/></span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2>{tr("totp.title")}</h2>
          <p>{tr("totp.lede")}</p>
        </div>
        <span style={{
          fontSize: 12, fontFamily: "var(--mono)", padding: "4px 10px", borderRadius: 7,
          background: on ? "var(--wash)" : "var(--well)", color: on ? "var(--accent)" : "var(--muted)",
        }}>{on ? tr("totp.enabled") : tr("totp.disabled")}</span>
      </header>
      <div className="pad">

      {/* Sans Telegram, la réinitialisation n'aurait qu'un seul facteur. */}
      <div style={{
        display: "flex", alignItems: "center", gap: 9, fontSize: 12.5, marginBottom: 16,
        padding: "9px 12px", borderRadius: 8,
        background: status?.telegramReady ? t.well : t.warnWash,
        color: status?.telegramReady ? t.muted : t.warn,
      }}>
        <Icon name={status?.telegramReady ? "bot" : "alert"} size={14}/>
        {status?.telegramReady ? tr("totp.telegramOk") : tr("totp.needTelegram")}
      </div>

      {err && (
        <div style={{
          display: "flex", alignItems: "center", gap: 9, color: t.err, fontSize: 12.5,
          marginBottom: 14, padding: "9px 12px", background: t.alarmWash, borderRadius: 8,
        }}><Icon name="alert" size={14}/>{err}</div>
      )}

      {mode === "idle" && (
        on
          ? <button onClick={() => setMode("disable")} style={btn(false, true)}>
              <Icon name="ban" size={14} stroke={1.8}/>{tr("totp.disable")}
            </button>
          : <button onClick={startEnroll} disabled={busy} style={btn(true)}>
              <Icon name="shield" size={14} stroke={1.8}/>{tr("totp.enable")}
            </button>
      )}

      {mode === "enroll" && (
        <div>
          <p style={{ color: t.muted, fontSize: 13, margin: "0 0 14px" }}>{tr("totp.scan")}</p>
          {qr && (
            <div style={{
              display: "inline-block", padding: 12, background: "#FFFFFF",
              borderRadius: 12, marginBottom: 14,
            }}>
              <img src={qr} alt="" width={200} height={200} style={{ display: "block" }}/>
            </div>
          )}
          <div style={{ marginBottom: 14 }}>
            <div style={{
              color: t.faint, fontSize: 10.5, textTransform: "uppercase",
              letterSpacing: "0.12em", marginBottom: 5,
            }}>{tr("totp.key")}</div>
            <code style={{
              display: "block", background: t.well, borderRadius: 8, padding: "9px 12px",
              fontFamily: t.monoFont, fontSize: 12.5, wordBreak: "break-all", color: t.txtSoft,
            }}>{secret}</code>
          </div>
          <div style={{ marginBottom: 14 }}>
            <div style={{
              color: t.faint, fontSize: 10.5, textTransform: "uppercase",
              letterSpacing: "0.12em", marginBottom: 5,
            }}>{tr("totp.confirmCode")}</div>
            <input value={code} inputMode="numeric" maxLength={6}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              placeholder="000000"
              style={{ ...field, fontSize: 18, letterSpacing: "0.3em", textAlign: "center", maxWidth: 200 }}/>
          </div>
          <div style={{ display: "flex", gap: 9 }}>
            <button onClick={confirm} disabled={busy || code.length !== 6} style={btn(true)}>
              {tr("totp.confirm")}
            </button>
            <button onClick={() => { setMode("idle"); setErr(""); }} style={btn()}>
              {tr("action.cancel")}
            </button>
          </div>
        </div>
      )}

      {mode === "disable" && (
        <div>
          <div style={{
            display: "flex", alignItems: "center", gap: 9, fontSize: 12.5, marginBottom: 14,
            padding: "9px 12px", borderRadius: 8, background: t.warnWash, color: t.warn,
          }}><Icon name="alert" size={14}/>{tr("totp.disableWarn")}</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 160px", gap: 10, marginBottom: 14 }}>
            <input type="password" value={pass} onChange={(e) => setPass(e.target.value)}
              placeholder={tr("gear.pass")} style={field}/>
            <input value={code} inputMode="numeric" maxLength={6}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              placeholder="000000"
              style={{ ...field, letterSpacing: "0.2em", textAlign: "center" }}/>
          </div>
          <div style={{ display: "flex", gap: 9 }}>
            <button onClick={disable} disabled={busy || !pass || code.length !== 6} style={btn(false, true)}>
              {tr("totp.disable")}
            </button>
            <button onClick={() => { setMode("idle"); setErr(""); }} style={btn()}>
              {tr("action.cancel")}
            </button>
          </div>
        </div>
      )}
      </div>
    </div>
  );
}
