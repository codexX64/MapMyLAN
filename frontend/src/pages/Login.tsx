// Login page, in the same visual language as the rest: paper background,
// a card set with a soft shadow, a single flat of ink for the action.

import { useState } from "react";
import { useStore } from "../stores/app";
import { THEMES, compatTheme, resolveTheme } from "../lib/themes";
import { Icon } from "../lib/icons";
import { useT, useLang, LANGS } from "../lib/i18n";

export function LoginPage() {
  const login = useStore((s) => s.login);
  const themeKey = useStore((s) => s.themeKey);
  const t = compatTheme(THEMES[resolveTheme(themeKey)]);
  const s = useT();
  const [lang, setLangValue] = useLang();

  const [u, setU] = useState("admin");
  const [p, setP] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setErr("");
    try { await login(u, p); }
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
        width: "100%", maxWidth: 380, background: t.surface,
        borderRadius: 16, padding: 30, boxShadow: t.lift,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 11, marginBottom: 26 }}>
          <span style={{
            width: 34, height: 34, borderRadius: 11, background: t.grad, color: t.onPrimary,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}><Icon name="logo" size={18}/></span>
          <div>
            <div style={{ fontSize: 19, fontWeight: 600, letterSpacing: "-0.03em", lineHeight: 1.1 }}>
              MapMyLAN
            </div>
            <div style={{ color: t.muted, fontFamily: t.monoFont, fontSize: 11, marginTop: 3 }}>
              {s("login.sub")}
            </div>
          </div>
          <select value={lang} onChange={(e) => setLangValue(e.target.value)}
            title={s("top.language")} aria-label={s("top.language")} style={{
              marginLeft: "auto", background: t.well, border: `1px solid ${t.border}`,
              color: t.txt, borderRadius: 8, padding: "5px 7px", fontSize: 11,
              fontFamily: t.monoFont, cursor: "pointer",
            }}>
            {LANGS.map((l) => (
              <option key={l.code} value={l.code}>{l.label}</option>
            ))}
          </select>
        </div>

        <div style={{ marginBottom: 14 }}>
          <label style={label}>{s("login.user")}</label>
          <input type="text" value={u} onChange={(e) => setU(e.target.value)} required style={field}/>
        </div>
        <div style={{ marginBottom: 18 }}>
          <label style={label}>{s("login.pass")}</label>
          <input type="password" value={p} onChange={(e) => setP(e.target.value)} required style={field}/>
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
        }}>{busy ? s("login.busy") : s("login.submit")}</button>
      </form>
    </div>
  );
}
