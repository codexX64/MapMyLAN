// Seconde étape : la preuve qu'on est bien le titulaire du compte.
//
// Le même écran sert à DEUX choses — finir une connexion, et autoriser une
// réinitialisation de mot de passe — parce que la question posée est la même.
// Les avoir écrits deux fois avait produit le défaut qu'on corrige : la
// connexion proposait les moyens réellement inscrits, la réinitialisation en
// exigeait deux en dur, dont un qui pouvait ne pas être configuré. L'écran
// réclamait alors un code Telegram qui ne pouvait pas arriver.
//
// `onReussite` reçoit ce que le serveur a renvoyé : une session pour une
// connexion, un jeton de réinitialisation pour l'autre usage. L'écran ne sait
// pas lequel, et n'a pas à le savoir.

import { useState } from "react";
import { api } from "../../api/client";
import { trousseauDisponible, prouverCle } from "../../lib/trousseau";

/**
 * Le choix du moyen.
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

export function SecondeEtape({ defi, moyens, code, setCode, onReussite, onErreur, onAbandon, t, label, field, intro }: any) {
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
      await onReussite(await api.deuxiemeTrousseau(defi, reponse));
    } catch (e: any) {
      onErreur(e?.message || "La clé n'a pas répondu.");
    } finally { setBusy(false); }
  };

  const chiffres = async () => {
    setBusy(true); onErreur("");
    try { await onReussite(await api.deuxiemeApplication(defi, code)); }
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
    try { await onReussite(await api.deuxiemeTelegram(defi, code)); }
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
        {intro || "Mot de passe accepté. Il reste le second facteur."}
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
