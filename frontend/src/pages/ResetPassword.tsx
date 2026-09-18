// Réinitialisation du mot de passe.
//
// Trois étapes : on nomme le compte, on prouve son identité, puis on choisit un
// nouveau mot de passe.
//
// La preuve demandée est celle que le compte a RÉELLEMENT inscrite — clé
// d'accès, application, Telegram — et le même écran sert à la connexion. Avant,
// cette page exigeait en dur un code d'application ET un code Telegram : un
// compte sans Telegram configuré voyait donc réclamer un code qui ne pouvait
// pas arriver, et la procédure ne pouvait pas aboutir.
//
// Le serveur répond de la même façon que le compte existe ou non : l'écran ne
// permet donc pas de deviner quels identifiants sont valides.

import { useEffect, useState } from "react";
import { api } from "../api/client";
import { useStore } from "../stores/app";
import { THEMES, compatTheme, resolveTheme } from "../lib/themes";
import { Icon } from "../lib/icons";
import { translate as tr } from "../lib/i18n";
import { SecondeEtape } from "../components/security/SecondeEtape";

const NOM_MOYEN: Record<string, string> = {
  trousseau: "clé d'accès", application: "application", telegram: "Telegram",
};

export function ResetPasswordPage({ onBack, secretLien }: { onBack: () => void; secretLien?: string }) {
  const themeKey = useStore((s) => s.themeKey);
  const t = compatTheme(THEMES[resolveTheme(themeKey)]);

  const [step, setStep] = useState<0 | 1 | 2 | 3>(0);
  const [username, setUsername] = useState("");
  const [defi, setDefi] = useState("");
  const [restants, setRestants] = useState<string[]>([]);
  const [faits, setFaits] = useState<string[]>([]);
  const [code, setCode] = useState("");
  const [resetToken, setResetToken] = useState("");
  const [p1, setP1] = useState("");
  const [p2, setP2] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [left, setLeft] = useState(0);
  const [lienEnvoye, setLienEnvoye] = useState(false);

  // Atteint par le lien reçu par courrier : on l'échange tout de suite contre
  // un défi, puis on efface le secret de la barre d'adresse et de l'historique.
  // Sans cela il resterait lisible par-dessus l'épaule, dans les favoris, et
  // dans le journal de tout mandataire traversé.
  useEffect(() => {
    if (!secretLien) return;
    let vivant = true;
    setBusy(true);
    api.resetLienOuvrir(secretLien)
      .then((r) => {
        if (!vivant) return;
        setDefi(r.defi || "");
        setRestants(r.restants || r.moyens || []);
        setFaits([]);
        setLeft((r.ttlMinutes || 15) * 60);
        setStep(1);
      })
      .catch((e: any) => { if (vivant) setErr(e?.message || "Lien invalide."); })
      .finally(() => { if (vivant) setBusy(false); });
    try { window.history.replaceState({}, "", window.location.pathname); } catch { /* sans conséquence */ }
    return () => { vivant = false; };
  }, [secretLien]);

  // Compte à rebours de validité de la demande.
  useEffect(() => {
    if (step !== 1 || left <= 0) return;
    const i = setInterval(() => setLeft((v) => Math.max(0, v - 1)), 1000);
    return () => clearInterval(i);
  }, [step, left]);

  const start = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(""); setBusy(true);
    try { await api.resetStart(username.trim()); setLienEnvoye(true); }
    catch (e: any) { setErr(e.message); }
    finally { setBusy(false); }
  };

  // La preuve est acceptée : le serveur rend un jeton qui n'autorise QUE la
  // pose d'un nouveau mot de passe. Il n'ouvre aucune session.
  // Une preuve acceptée. Tant qu'il en reste, on enchaîne sur la suivante :
  // réinitialiser exige TOUS les moyens inscrits, parce qu'il n'y a pas de mot
  // de passe à opposer — c'est lui qu'on remplace.
  const preuveAcceptee = (r: any) => {
    setErr(""); setCode("");
    if (r?.resetToken) { setResetToken(r.resetToken); setStep(2); return; }
    if (r?.etape === "encore") {
      setFaits((f) => [...f, ...restants.filter((m) => !(r.restants || []).includes(m))]);
      setRestants(r.restants || []);
    }
  };

  const complete = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr("");
    if (p1.length < 8) { setErr(tr("reset.errShort")); return; }
    if (p1 !== p2) { setErr(tr("reset.errMatch")); return; }
    setBusy(true);
    try { await api.resetComplete(resetToken, p1); setStep(3); }
    catch (e: any) { setErr(e.message); }
    finally { setBusy(false); }
  };

  const field: any = {
    width: "100%", background: t.well, border: `1px solid ${t.border}`,
    color: t.txt, borderRadius: 9, padding: "10px 13px", fontSize: 13.5,
    outline: "none", fontFamily: t.monoFont,
  };
  const codeField: any = {
    ...field, fontSize: 20, letterSpacing: "0.32em", textAlign: "center", padding: "12px 13px",
  };
  const label: any = {
    display: "block", color: t.faint, fontSize: 10.5, textTransform: "uppercase",
    letterSpacing: "0.12em", marginBottom: 6,
  };
  const primary: any = {
    width: "100%", padding: "11px 0", background: t.grad, border: "none",
    color: t.onPrimary, borderRadius: 9, fontSize: 13.5, fontWeight: 600,
    cursor: busy ? "wait" : "pointer", fontFamily: t.font,
    opacity: busy ? 0.7 : 1, transition: "opacity .15s",
  };

  const mmss = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;

  return (
    <div style={{
      minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
      background: t.bg, color: t.txt, fontFamily: t.font, padding: 20,
    }}>
      <div style={{
        width: "100%", maxWidth: 400, background: t.surface,
        borderRadius: 16, padding: 30, boxShadow: t.lift,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 11, marginBottom: 22 }}>
          <span style={{
            width: 34, height: 34, borderRadius: 11, background: t.wash, color: t.primary,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}><Icon name="shield" size={18}/></span>
          <div>
            <div style={{ fontSize: 17, fontWeight: 600, letterSpacing: "-0.03em", lineHeight: 1.15 }}>
              {tr("reset.title")}
            </div>
            <div style={{ color: t.muted, fontFamily: t.monoFont, fontSize: 11, marginTop: 2 }}>
              {step < 3 ? tr("reset.step", { n: step + 1 }) : tr("reset.done")}
            </div>
          </div>
        </div>

        {/* ── 1. Le compte ── */}
        {step === 0 && (
          <form onSubmit={start}>
            <p style={{ color: t.muted, fontSize: 13, margin: "0 0 20px", lineHeight: 1.5 }}>
              {tr("reset.lede")}
            </p>
            <div style={{ marginBottom: 18 }}>
              <label style={label}>{tr("reset.user")}</label>
              <input value={username} onChange={(e) => setUsername(e.target.value)}
                autoFocus autoComplete="username" style={field}/>
            </div>
            {err && <ErrBox t={t} msg={err}/>}

            {lienEnvoye ? (
              <div style={{
                marginTop: 4, padding: "12px 14px", borderRadius: 10,
                background: t.well, color: t.muted, fontSize: 12.5, lineHeight: 1.6,
              }}>
                <b style={{ color: t.txt, display: "block", marginBottom: 4 }}>
                  Regarde ta boîte mail.
                </b>
                Si ce compte existe et qu'une adresse lui est rattachée, un lien vient d'y
                partir. Il vaut quinze minutes et ne fonctionne qu'une fois. Sans adresse
                sur le compte, il n'y a pas de réinitialisation — c'est voulu.
              </div>
            ) : (
              <button type="submit" disabled={busy || !username.trim()} style={primary}>
                {busy ? tr("reset.sending") : tr("reset.send")}
              </button>
            )}

            <BackLink t={t} onBack={onBack}/>
          </form>
        )}

        {/* ── 2. Les preuves, une par une ── */}
        {step === 1 && (
          <div>
            {/* Réinitialiser exige TOUTES les preuves inscrites : sans mot de
                passe à opposer, elles sont la seule chose qui protège encore le
                compte. L'avancement est visible, sinon on ne sait pas où on en est. */}
            {(faits.length > 0 || restants.length > 1) && (
              <div style={{
                display: "flex", gap: 7, flexWrap: "wrap", marginBottom: 14,
                fontFamily: t.monoFont, fontSize: 11,
              }}>
                {faits.map((m) => (
                  <span key={m} style={{
                    padding: "4px 9px", borderRadius: 999, background: t.wash,
                    color: t.primary,
                  }}>✓ {NOM_MOYEN[m] || m}</span>
                ))}
                {restants.map((m, i) => (
                  <span key={m} style={{
                    padding: "4px 9px", borderRadius: 999,
                    border: `1px solid ${t.hair}`,
                    color: i === 0 ? t.txt : t.faint,
                  }}>{NOM_MOYEN[m] || m}</span>
                ))}
              </div>
            )}

            <SecondeEtape
              key={restants[0] || "fin"}
              defi={defi} moyens={restants.slice(0, 1)}
              code={code} setCode={setCode}
              onReussite={preuveAcceptee}
              onErreur={setErr}
              onAbandon={() => { setStep(0); setErr(""); setCode(""); setLienEnvoye(false); }}
              t={t} label={label} field={codeField}
              intro={restants.length > 1
                ? `Première preuve sur ${restants.length + faits.length}. Chaque moyen inscrit est demandé.`
                : "Dernière preuve. Le moyen demandé est celui que tu as inscrit."}/>

            <div style={{
              display: "flex", alignItems: "center", gap: 8, marginTop: 16,
              color: left < 60 ? t.warn : t.faint, fontFamily: t.monoFont, fontSize: 11.5,
            }}>
              <Icon name="clock" size={12} stroke={2}/>
              {left > 0 ? tr("reset.expires", { t: mmss }) : tr("reset.expired")}
            </div>

            {err && <ErrBox t={t} msg={err}/>}
            <BackLink t={t} onBack={onBack}/>
          </div>
        )}

        {/* ── 3. Le nouveau mot de passe ── */}
        {step === 2 && (
          <form onSubmit={complete}>
            <div style={{ marginBottom: 14 }}>
              <label style={label}>{tr("reset.newPass")}</label>
              <input type="password" value={p1} autoFocus autoComplete="new-password"
                onChange={(e) => setP1(e.target.value)} style={field}/>
              <div style={{ color: t.faint, fontSize: 11.5, marginTop: 6 }}>{tr("reset.hint")}</div>
            </div>
            <div style={{ marginBottom: 18 }}>
              <label style={label}>{tr("reset.confirm")}</label>
              <input type="password" value={p2} autoComplete="new-password"
                onChange={(e) => setP2(e.target.value)} style={field}/>
            </div>
            {err && <ErrBox t={t} msg={err}/>}
            <button type="submit" disabled={busy} style={primary}>
              {busy ? tr("reset.saving") : tr("reset.save")}
            </button>
          </form>
        )}

        {/* ── 4. C'est fait ── */}
        {step === 3 && (
          <div>
            <div style={{
              display: "flex", alignItems: "center", gap: 10, padding: "12px 14px",
              background: t.wash, color: t.primary, borderRadius: 9, fontSize: 13, marginBottom: 18,
            }}>
              <Icon name="shield" size={15}/>{tr("reset.okBody")}
            </div>
            <button onClick={onBack} style={primary}>{tr("reset.backToLogin")}</button>
          </div>
        )}
      </div>
    </div>
  );
}

function ErrBox({ t, msg }: any) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 9, color: t.err, fontSize: 12.5,
      marginBottom: 14, padding: "9px 12px", background: t.alarmWash, borderRadius: 8,
    }}>
      <Icon name="alert" size={14}/>{msg}
    </div>
  );
}

function BackLink({ t, onBack }: any) {
  return (
    <button type="button" onClick={onBack} style={{
      display: "block", width: "100%", marginTop: 14, background: "none", border: "none",
      color: t.muted, fontSize: 12.5, cursor: "pointer", fontFamily: t.font,
    }}>{tr("reset.back")}</button>
  );
}
