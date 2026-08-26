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
            onSession={ouvrirSession}
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


/**
 * Seconde étape de connexion.
 *
 * On propose ce que le compte a réellement inscrit, rien d'autre : afficher un
 * moyen dont il ne dispose pas revient à lui faire perdre du temps sur une
 * porte qui n'existe pas.
 *
 * L'ordre du choix par défaut suit la solidité : une clé d'accès ne se recopie
 * pas et ne s'intercepte pas, le code d'application vit hors ligne sur
 * l'appareil, celui de Telegram passe par un service tiers. Les trois sont
 * offerts, mais on ne met pas le plus faible en avant.
 */
const NOMS: Record<string, string> = {
  trousseau: "Clé d'accès",
  application: "Code à six chiffres",
  telegram: "Telegram",
};

function SecondeEtape({ defi, moyens, code, setCode, onSession, onErreur, onAbandon, t, label, field }: any) {
  const [busy, setBusy] = useState(false);
  const [envoye, setEnvoye] = useState(false);
  const parTrousseau = moyens.includes("trousseau");
  const parApplication = moyens.includes("application");
  const parTelegram = moyens.includes("telegram");

  const ordre = ["trousseau", "application", "telegram"].filter((m) => moyens.includes(m));
  const prefere = parTrousseau && trousseauDisponible()
    ? "trousseau"
    : (ordre.find((m) => m !== "trousseau") || ordre[0] || "application");
  const [moyen, setMoyen] = useState(prefere);

  const cle = async () => {
    setBusy(true); onErreur("");
    try {
      const options = await api.deuxiemeTrousseauOptions(defi);
      const reponse = await prouverCle(options);
      await onSession(await api.deuxiemeTrousseau(defi, reponse));
    } catch (e: any) {
      onErreur(e?.message || "La clé n'a pas répondu.");
    } finally { setBusy(false); }
  };

  const chiffres = async () => {
    setBusy(true); onErreur("");
    try { await onSession(await api.deuxiemeApplication(defi, code)); }
    catch (e: any) { onErreur(e?.message || "Code refusé."); }
    finally { setBusy(false); }
  };

  const envoyer = async () => {
    setBusy(true); onErreur("");
    try { await api.deuxiemeTelegramEnvoyer(defi); setEnvoye(true); setCode(""); }
    catch (e: any) { onErreur(e?.message || "Le code n'est pas parti."); }
    finally { setBusy(false); }
  };

  const validerTelegram = async () => {
    setBusy(true); onErreur("");
    try { await onSession(await api.deuxiemeTelegram(defi, code)); }
    catch (e: any) { onErreur(e?.message || "Code refusé."); }
    finally { setBusy(false); }
  };

  const bouton = {
    width: "100%", padding: "11px 14px", borderRadius: 10, border: "none",
    background: t.grad, color: t.onPrimary, fontFamily: t.font, fontSize: 14,
    fontWeight: 500, cursor: "pointer", marginTop: 4,
  } as any;

  return (
    <div>
      <div style={{ color: t.muted, fontSize: 13, lineHeight: 1.55, marginBottom: 16 }}>
        Mot de passe accepté. Il reste le second facteur.
      </div>

      {ordre.length > 1 && (
        <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
          {ordre.map((id) => (
            <button key={id} type="button"
              onClick={() => { setMoyen(id); onErreur(""); }}
              style={{
                flex: "1 1 30%", padding: "8px 10px", borderRadius: 9, fontSize: 12.5,
                cursor: "pointer",
                border: `1px solid ${moyen === id ? t.primary : t.hair}`,
                background: moyen === id ? t.wash : "transparent",
                color: moyen === id ? t.primary : t.muted, fontFamily: t.font,
              }}>{NOMS[id]}</button>
          ))}
        </div>
      )}

      {moyen === "trousseau" && parTrousseau && (
        <>
          <button type="button" onClick={cle} disabled={busy} style={bouton}>
            {busy ? "En attente de la clé…" : "Utiliser ma clé d'accès"}
          </button>
          {!trousseauDisponible() && (
            <div style={{ color: t.warn, fontSize: 11.5, marginTop: 10, lineHeight: 1.5 }}>
              Ce navigateur ne propose pas les clés d'accès ici — il faut une origine
              sûre, donc du HTTPS.
            </div>
          )}
        </>
      )}

      {moyen === "application" && parApplication && (
        <>
          <label style={label}>Code de l'application</label>
          <input type="text" inputMode="numeric" autoFocus value={code}
            onChange={(e) => setCode(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); chiffres(); } }}
            placeholder="123456" style={field}/>
          <button type="button" onClick={chiffres} disabled={busy || code.trim().length < 6} style={bouton}>
            {busy ? "Vérification…" : "Valider"}
          </button>
        </>
      )}

      {moyen === "telegram" && parTelegram && (
        <>
          {!envoye ? (
            <>
              <div style={{ color: t.muted, fontSize: 12.5, lineHeight: 1.55, marginBottom: 10 }}>
                Un code à six chiffres part dans ta discussion avec le bot.
              </div>
              <button type="button" onClick={envoyer} disabled={busy} style={bouton}>
                {busy ? "Envoi…" : "Envoyer le code sur Telegram"}
              </button>
            </>
          ) : (
            <>
              <label style={label}>Code reçu sur Telegram</label>
              <input type="text" inputMode="numeric" autoFocus value={code}
                onChange={(e) => setCode(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); validerTelegram(); } }}
                placeholder="123456" style={field}/>
              <button type="button" onClick={validerTelegram}
                disabled={busy || code.trim().length < 6} style={bouton}>
                {busy ? "Vérification…" : "Valider"}
              </button>
              <button type="button" onClick={envoyer} disabled={busy} style={{
                width: "100%", marginTop: 10, background: "none", border: "none",
                color: t.muted, fontSize: 12, cursor: "pointer", fontFamily: t.font,
              }}>Renvoyer un code</button>
            </>
          )}
        </>
      )}

      <button type="button" onClick={onAbandon} style={{
        width: "100%", marginTop: 12, background: "none", border: "none",
        color: t.muted, fontSize: 12, cursor: "pointer", fontFamily: t.font,
      }}>Reprendre depuis le début</button>
    </div>
  );
}
