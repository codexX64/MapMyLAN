// Changement de mot de passe obligatoire.
//
// S'affiche après la connexion quand le compte porte le drapeau
// `mustChangePassword` : mot de passe temporaire posé par un administrateur,
// ou compte fraîchement remis à zéro. Rien d'autre n'est accessible tant que
// le changement n'a pas eu lieu — c'est le but.

import { useState } from "react";
import { api } from "../api/client";
import { useStore } from "../stores/app";
import { THEMES, compatTheme, resolveTheme } from "../lib/themes";
import { Icon } from "../lib/icons";
import { translate as tr } from "../lib/i18n";

export function ChangePasswordPage() {
  const themeKey = useStore((s) => s.themeKey);
  const t = compatTheme(THEMES[resolveTheme(themeKey)]);
  const user = useStore((s) => s.user);
  const clearMustChange = useStore((s) => s.clearMustChange);
  const logout = useStore((s) => s.logout);

  const [ancien, setAncien] = useState("");
  const [p1, setP1] = useState("");
  const [p2, setP2] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const valider = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr("");
    if (p1.length < 8) { setErr(tr("chpw.errShort")); return; }
    if (p1 !== p2) { setErr(tr("chpw.errMatch")); return; }
    if (p1 === ancien) { setErr(tr("chpw.errSame")); return; }
    setBusy(true);
    try {
      await api.changePassword(ancien, p1);
      clearMustChange();
    } catch (e: any) {
      setErr(e?.message || tr("chpw.errApi"));
    } finally { setBusy(false); }
  };

  const champ: any = {
    width: "100%", background: t.well, border: `1px solid ${t.border}`,
    color: t.txt, borderRadius: 9, padding: "10px 13px", fontSize: 13.5,
    outline: "none", fontFamily: t.monoFont,
  };
  const etiquette: any = {
    display: "block", color: t.faint, fontSize: 10.5, textTransform: "uppercase",
    letterSpacing: "0.12em", marginBottom: 6,
  };

  return (
    <div style={{
      minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
      background: t.bg, color: t.txt, fontFamily: t.font, padding: 20,
    }}>
      <form onSubmit={valider} style={{
        width: "100%", maxWidth: 400, background: t.surface,
        borderRadius: 16, padding: 30, boxShadow: t.lift,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 11, marginBottom: 8 }}>
          <span style={{
            width: 34, height: 34, borderRadius: 11, background: t.warnWash, color: t.warn,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}><Icon name="shield" size={18}/></span>
          <div>
            <div style={{ fontSize: 17, fontWeight: 600, letterSpacing: "-0.03em", lineHeight: 1.15 }}>
              {tr("chpw.title")}
            </div>
            <div style={{ color: t.muted, fontFamily: t.monoFont, fontSize: 11, marginTop: 2 }}>
              {user?.username}
            </div>
          </div>
        </div>

        <p style={{ color: t.muted, fontSize: 13, margin: "0 0 22px", lineHeight: 1.5 }}>
          {tr("chpw.lede")}
        </p>

        <div style={{ marginBottom: 14 }}>
          <label style={etiquette}>{tr("chpw.current")}</label>
          <input type="password" value={ancien} autoFocus autoComplete="current-password"
            onChange={(e) => setAncien(e.target.value)} style={champ}/>
        </div>
        <div style={{ marginBottom: 14 }}>
          <label style={etiquette}>{tr("chpw.new")}</label>
          <input type="password" value={p1} autoComplete="new-password"
            onChange={(e) => setP1(e.target.value)} style={champ}/>
          <div style={{ color: t.faint, fontSize: 11.5, marginTop: 6 }}>{tr("chpw.hint")}</div>
        </div>
        <div style={{ marginBottom: 18 }}>
          <label style={etiquette}>{tr("chpw.confirm")}</label>
          <input type="password" value={p2} autoComplete="new-password"
            onChange={(e) => setP2(e.target.value)} style={champ}/>
        </div>

        {err && (
          <div style={{
            display: "flex", alignItems: "center", gap: 9, color: t.err, fontSize: 12.5,
            marginBottom: 14, padding: "9px 12px", background: t.alarmWash, borderRadius: 8,
          }}><Icon name="alert" size={14}/>{err}</div>
        )}

        <button type="submit" disabled={busy} style={{
          width: "100%", padding: "11px 0", background: t.grad, border: "none",
          color: t.onPrimary, borderRadius: 9, fontSize: 13.5, fontWeight: 600,
          cursor: busy ? "wait" : "pointer", fontFamily: t.font,
          opacity: busy ? 0.7 : 1, transition: "opacity .15s",
        }}>{busy ? tr("chpw.busy") : tr("chpw.submit")}</button>

        <button type="button" onClick={logout} style={{
          display: "block", width: "100%", marginTop: 14, background: "none", border: "none",
          color: t.muted, fontSize: 12.5, cursor: "pointer", fontFamily: t.font,
        }}>{tr("top.logout")}</button>
      </form>
    </div>
  );
}
