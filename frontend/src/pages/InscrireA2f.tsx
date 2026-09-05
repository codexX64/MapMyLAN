// Inscription du second facteur, imposée avant d'entrer.
//
// Le compte peut couper un appareil, lire le trafic, exécuter une commande sur
// la passerelle. Un mot de passe seul ne suffit pas à le garder — d'où
// l'obligation. Mais exiger n'est pas enfermer dehors : on se connecte
// d'abord, on inscrit ensuite, et il y a toujours au moins un chemin.
//
// L'ordre suit la solidité. Une clé d'accès ne se recopie pas, ne s'intercepte
// pas et ne se rejoue pas sur un site de hameçonnage : c'est le premier choix.
// Elle demande une origine sûre — donc du HTTPS — et tous les navigateurs n'en
// proposent pas ; l'application d'authentification prend alors le relais, hors
// ligne, sur l'appareil. Aucune installation ne se retrouve sans issue.

import { useEffect, useState } from "react";
import { api } from "../api/client";
import { useStore } from "../stores/app";
import { THEMES, compatTheme, resolveTheme } from "../lib/themes";
import { Icon } from "../lib/icons";
import { trousseauDisponible, inscrireCle } from "../lib/trousseau";

export function InscrireA2fPage() {
  const themeKey = useStore((s) => s.themeKey);
  const t = compatTheme(THEMES[resolveTheme(themeKey)]);
  const finirInscription = useStore((s) => s.finirInscriptionA2f);

  const cleDispo = trousseauDisponible();
  const [moyen, setMoyen] = useState<"trousseau" | "application">(
    cleDispo ? "trousseau" : "application");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  // Application : secret, puis premier code pour confirmer.
  const [secret, setSecret] = useState<{ secret: string; uri: string } | null>(null);
  const [code, setCode] = useState("");

  useEffect(() => {
    if (moyen !== "application" || secret) return;
    api.totpSetup().then(setSecret).catch((e: any) => setErr(e?.message || "Secret indisponible."));
  }, [moyen]);

  const poserCle = async () => {
    setBusy(true); setErr("");
    try {
      const options = await api.mfaPasskeyOptions();
      const reponse = await inscrireCle(options);
      await api.mfaPasskeyEnregistrer(reponse, "Cet appareil");
      await finirInscription();
    } catch (e: any) {
      setErr(e?.message || "La clé n'a pas été enregistrée.");
    } finally { setBusy(false); }
  };

  const confirmerCode = async () => {
    setBusy(true); setErr("");
    try {
      await api.totpEnable(code.replace(/\s/g, ""));
      await finirInscription();
    } catch (e: any) {
      setErr(e?.message || "Code refusé.");
    } finally { setBusy(false); }
  };

  const champ: any = {
    width: "100%", background: t.well, border: `1px solid ${t.border}`,
    color: t.txt, borderRadius: 9, padding: "10px 13px", fontSize: 15,
    outline: "none", fontFamily: t.monoFont, letterSpacing: "0.14em", textAlign: "center",
  };
  const principal: any = {
    width: "100%", padding: "11px 14px", borderRadius: 10, border: "none",
    background: t.grad, color: t.onPrimary, fontFamily: t.font, fontSize: 14,
    fontWeight: 500, cursor: busy ? "default" : "pointer", marginTop: 12, opacity: busy ? 0.6 : 1,
  };
  const onglet = (id: string): any => ({
    flex: 1, padding: "8px 10px", borderRadius: 9, fontSize: 12.5, cursor: "pointer",
    border: `1px solid ${moyen === id ? t.primary : t.hair}`,
    background: moyen === id ? t.wash : "transparent",
    color: moyen === id ? t.primary : t.muted, fontFamily: t.font,
  });

  return (
    <div style={{
      minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
      background: t.bg, color: t.txt, fontFamily: t.font, padding: 20,
    }}>
      <div style={{
        width: "100%", maxWidth: 420, background: t.surface,
        borderRadius: 16, padding: 30, boxShadow: t.lift,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 11, marginBottom: 18 }}>
          <span style={{
            width: 34, height: 34, borderRadius: 11, background: t.wash, color: t.primary,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}><Icon name="shield" size={18}/></span>
          <div>
            <div style={{ fontSize: 17, fontWeight: 600, letterSpacing: "-0.03em" }}>
              Un second facteur, avant d'entrer
            </div>
            <div style={{ color: t.muted, fontFamily: t.monoFont, fontSize: 11, marginTop: 2 }}>
              obligatoire · une seule fois
            </div>
          </div>
        </div>

        <p style={{ color: t.muted, fontSize: 13, lineHeight: 1.55, margin: "0 0 18px" }}>
          Ce compte peut couper un appareil et exécuter des commandes sur ton équipement
          réseau. Un mot de passe seul ne suffit pas à le garder.
        </p>

        <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
          <button type="button" style={onglet("trousseau")}
            onClick={() => { setMoyen("trousseau"); setErr(""); }}>Clé d'accès</button>
          <button type="button" style={onglet("application")}
            onClick={() => { setMoyen("application"); setErr(""); }}>Application</button>
        </div>

        {moyen === "trousseau" && (
          <>
            <p style={{ color: t.muted, fontSize: 12.5, lineHeight: 1.55, margin: "0 0 4px" }}>
              Touch ID, Face ID, trousseau du système ou clé USB. Rien à recopier, et
              elle ne fonctionne que sur ce domaine — inutilisable sur un site qui
              t'imiterait.
            </p>
            {!cleDispo && (
              <p style={{ color: t.warn, fontSize: 11.5, lineHeight: 1.5, marginTop: 10 }}>
                Ce navigateur ne propose pas les clés d'accès ici : il faut une origine
                sûre, donc du HTTPS. Passe par l'application d'authentification.
              </p>
            )}
            <button type="button" onClick={poserCle} disabled={busy || !cleDispo}
              style={{ ...principal, opacity: busy || !cleDispo ? 0.5 : 1 }}>
              {busy ? "En attente de la clé…" : "Enregistrer une clé d'accès"}
            </button>
          </>
        )}

        {moyen === "application" && (
          <>
            <p style={{ color: t.muted, fontSize: 12.5, lineHeight: 1.55, margin: "0 0 12px" }}>
              Ajoute cette clé dans ton application d'authentification, puis recopie le
              code affiché pour confirmer. Tant que le code n'est pas revenu, rien n'est
              activé.
            </p>
            <div style={{
              background: t.well, border: `1px solid ${t.border}`, borderRadius: 9,
              padding: "10px 12px", fontFamily: t.monoFont, fontSize: 12.5,
              wordBreak: "break-all", color: t.txt, marginBottom: 12,
            }}>{secret?.secret || "…"}</div>
            <input value={code} inputMode="numeric" maxLength={6} autoFocus
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              onKeyDown={(e) => { if (e.key === "Enter" && code.length === 6) confirmerCode(); }}
              placeholder="000000" style={champ}/>
            <button type="button" onClick={confirmerCode} disabled={busy || code.length !== 6}
              style={{ ...principal, opacity: busy || code.length !== 6 ? 0.5 : 1 }}>
              {busy ? "Vérification…" : "Confirmer"}
            </button>
          </>
        )}

        {err && (
          <div style={{
            marginTop: 14, padding: "9px 12px", borderRadius: 9,
            background: t.alarmWash || t.well, color: t.alarm || t.warn, fontSize: 12.5,
          }}>{err}</div>
        )}
      </div>
    </div>
  );
}
