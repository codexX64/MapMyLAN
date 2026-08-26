// Création du compte au premier lancement.
//
// S'affiche tant qu'aucun compte n'existe. Une fois le compte créé, l'écran
// disparaît définitivement : l'endpoint correspondant se referme côté serveur
// dès qu'un utilisateur est en base.

import { useState } from "react";
import { useStore } from "../stores/app";
import { THEMES, compatTheme, resolveTheme } from "../lib/themes";
import { Icon } from "../lib/icons";
import { translate as tr } from "../lib/i18n";

export function FirstRunPage() {
  const themeKey = useStore((s) => s.themeKey);
  const t = compatTheme(THEMES[resolveTheme(themeKey)]);
  const bootstrap = useStore((s) => s.bootstrap);

  const [u, setU] = useState("");
  const [p, setP] = useState("");
  const [p2, setP2] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr("");
    if (u.trim().length < 3) { setErr(tr("first.errUser")); return; }
    if (p.length < 8) { setErr(tr("first.errPass")); return; }
    if (p !== p2) { setErr(tr("first.errMatch")); return; }
    setBusy(true);
    try { await bootstrap(u.trim(), p); }
    catch (e: any) { setErr(e.message); }
    finally { setBusy(false); }
  };

  const field: any = {
    width: "100%", background: t.well, border: `1px solid ${t.border}`,
    color: t.txt, borderRadius: 9, padding: "10px 13px", fontSize: 13.5,
    outline: "none", fontFamily: t.monoFont,
  };
  const label: any = {
    display: "block", color: t.faint, fontSize: 10.5, textTransform: "uppercase",
    letterSpacing: "0.12em", marginBottom: 6,
  };

  return (
    <div style={{
      minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
      background: t.bg, color: t.txt, fontFamily: t.font, padding: 20,
    }}>
      <form onSubmit={submit} style={{
        width: "100%", maxWidth: 400, background: t.surface,
        borderRadius: 16, padding: 30, boxShadow: t.lift,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 11, marginBottom: 8 }}>
          <span style={{
            width: 34, height: 34, borderRadius: 11, background: t.grad, color: t.onPrimary,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}><Icon name="logo" size={18}/></span>
          <div style={{ fontSize: 19, fontWeight: 600, letterSpacing: "-0.03em" }}>
            MapMyLAN
          </div>
        </div>

        <p style={{ color: t.muted, fontSize: 13.5, margin: "0 0 24px", lineHeight: 1.5 }}>
          {tr("first.lede")}
        </p>

        <div style={{ marginBottom: 14 }}>
          <label style={label}>{tr("first.user")}</label>
          <input value={u} onChange={(e) => setU(e.target.value)} autoFocus
            autoComplete="username" style={field}/>
        </div>
        <div style={{ marginBottom: 14 }}>
          <label style={label}>{tr("first.pass")}</label>
          <input type="password" value={p} onChange={(e) => setP(e.target.value)}
            autoComplete="new-password" style={field}/>
          <div style={{ color: t.faint, fontSize: 11.5, marginTop: 6 }}>
            {tr("first.hint")}
          </div>
        </div>
        <div style={{ marginBottom: 18 }}>
          <label style={label}>{tr("first.confirm")}</label>
          <input type="password" value={p2} onChange={(e) => setP2(e.target.value)}
            autoComplete="new-password" style={field}/>
        </div>

        {err && (
          <div style={{
            display: "flex", alignItems: "center", gap: 9, color: t.err, fontSize: 12.5,
            marginBottom: 14, padding: "9px 12px", background: t.alarmWash, borderRadius: 8,
          }}>
            <Icon name="alert" size={14}/>{err}
          </div>
        )}

        <button type="submit" disabled={busy} style={{
          width: "100%", padding: "11px 0", background: t.grad, border: "none",
          color: t.onPrimary, borderRadius: 9, fontSize: 13.5, fontWeight: 600,
          cursor: busy ? "wait" : "pointer", fontFamily: t.font,
          opacity: busy ? 0.7 : 1, transition: "opacity .15s",
        }}>{busy ? tr("first.busy") : tr("first.submit")}</button>
      </form>
    </div>
  );
}
