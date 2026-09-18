// Page de connexion, dans le même langage visuel que le reste : fond papier,
// carte posée avec une ombre douce, un seul aplat d'encre pour l'action.

import { useState } from "react";
import { api } from "../api/client";
import { trousseauDisponible, prouverCle } from "../lib/trousseau";
import { useStore } from "../stores/app";
import { THEMES, compatTheme, resolveTheme } from "../lib/themes";
import { Icon } from "../lib/icons";
import { useT } from "../lib/i18n";
import { ResetPasswordPage } from "./ResetPassword";
import { SecondeEtape } from "../components/security/SecondeEtape";

export function LoginPage() {
  const login = useStore((s) => s.login);
  const ouvrirSession = useStore((s) => s.ouvrirSession);
  const themeKey = useStore((s) => s.themeKey);
  const t = compatTheme(THEMES[resolveTheme(themeKey)]);
  const s = useT();

  const [forgot, setForgot] = useState(false);
  const [u, setU] = useState("admin");
  const [p, setP] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  // Seconde étape : ce que le serveur a répondu après un mot de passe accepté.
  const [seconde, setSeconde] = useState<{ defi: string; moyens: string[] } | null>(null);
  const [code, setCode] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setErr("");
    try {
      const suite = await login(u, p);
      if (suite) { setSeconde({ defi: suite.defi, moyens: suite.moyens }); setCode(""); }
    }
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

  if (forgot) return <ResetPasswordPage onBack={() => setForgot(false)}/>;

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
        </div>

        {seconde ? (
          <SecondeEtape
            defi={seconde.defi} moyens={seconde.moyens}
            code={code} setCode={setCode}
            onReussite={ouvrirSession}
            onErreur={setErr}
            onAbandon={() => { setSeconde(null); setErr(""); }}
            t={t} label={label} field={field}/>
        ) : (<>

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
        </>)}

        <button type="button" onClick={() => setForgot(true)} style={{
          display: "block", width: "100%", marginTop: 14, background: "none", border: "none",
          color: t.muted, fontSize: 12.5, cursor: "pointer", fontFamily: t.font,
        }}>{s("login.forgot")}</button>
      </form>
    </div>
  );
}
