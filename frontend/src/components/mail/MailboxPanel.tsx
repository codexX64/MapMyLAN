// Boîtes mail.
//
// L'utilisateur saisit une adresse et un mot de passe, choisit son fournisseur,
// et les réglages IMAP/SMTP se remplissent seuls à partir du catalogue partagé
// `mail-providers.js` — le même fichier que le serveur, chargé ici en
// `window.MailProviders`.
//
// Deux règles qui ne se contournent pas : enregistrer reste inaccessible tant
// que le test n'est pas passé, et toute modification d'un champ réarme ce
// verrou. Aucune configuration non vérifiée n'entre en base.

import { useEffect, useMemo, useState } from "react";
import { api } from "../../api/client";
import { Icon } from "../../lib/icons";
import { Select } from "../ui/Select";
import { translate as tr } from "../../lib/i18n";

declare global {
  interface Window { MailProviders?: any }
}

const ROLES = [
  { id: "both", label: "mail.role.both" },
  { id: "receive", label: "mail.role.receive" },
  { id: "send", label: "mail.role.send" },
];

const SECURITES = ["ssl", "starttls", "none"];

export function MailboxPanel({ t }: { t: any }) {
  const [boites, setBoites] = useState<any[]>([]);
  const [fournisseurs, setFournisseurs] = useState<any[]>([]);
  const [edition, setEdition] = useState<any | null>(null);
  const [pret, setPret] = useState(false);

  const charger = () =>
    Promise.all([
      api.mailboxes().catch(() => []),
      api.mailProviders().catch(() => []),
    ]).then(([b, f]) => { setBoites(b); setFournisseurs(f); });

  useEffect(() => {
    // Le catalogue est servi en statique par le frontend : on l'injecte une
    // fois pour disposer de resolve() et validate() côté navigateur.
    if (window.MailProviders) { setPret(true); charger(); return; }
    const s = document.createElement("script");
    s.src = "/mail-providers.js";
    s.onload = () => { setPret(true); charger(); };
    s.onerror = () => { setPret(true); charger(); };
    document.head.appendChild(s);
  }, []);

  const supprimer = async (b: any) => {
    if (!confirm(tr("mail.confirmDelete", { e: b.email }))) return;
    await api.deleteMailbox(b.id);
    charger();
  };

  return (
    <div className="set">
      <header>
        <span className="tile"><Icon name="bell" size={17}/></span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2>{tr("mail.title")}</h2>
          <p>{tr("mail.lede")}</p>
        </div>
        <button onClick={() => setEdition({})} style={{
          display: "flex", alignItems: "center", gap: 7, padding: "8px 14px", borderRadius: 9,
          border: "none", cursor: "pointer", fontFamily: t.font, fontSize: 13, fontWeight: 500,
          background: t.grad, color: t.onPrimary,
        }}><Icon name="plus" size={14} stroke={1.8}/>{tr("mail.add")}</button>
      </header>

      {boites.length === 0 ? (
        <div style={{ padding: "26px 18px", textAlign: "center", color: t.faint, fontSize: 13 }}>
          {tr("mail.none")}
        </div>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>{[tr("mail.col.address"), tr("mail.col.provider"), tr("mail.col.host"),
                  tr("mail.col.role"), tr("mail.col.state"), ""].map((h, i) => (
              <th key={i} style={{
                textAlign: "left", padding: "0 16px 9px", fontSize: 10.5, letterSpacing: "0.11em",
                textTransform: "uppercase", color: t.faint, fontWeight: 500,
                borderBottom: `1px solid ${t.hairSoft}`,
              }}>{h}</th>
            ))}</tr>
          </thead>
          <tbody>
            {boites.map(b => {
              const f = fournisseurs.find((x: any) => x.id === b.provider);
              const hote = b.imap?.host || b.smtp?.host || "—";
              return (
                <tr key={b.id}>
                  <td style={td(t)}>
                    <span style={{ fontWeight: 500 }}>{b.email}</span>
                  </td>
                  <td style={{ ...td(t), color: t.muted }}>{f?.label || b.provider}</td>
                  <td style={{ ...td(t), fontFamily: t.monoFont, fontSize: 12, color: t.txtSoft }}>{hote}</td>
                  <td style={{ ...td(t), color: t.muted }}>
                    {tr(ROLES.find(r => r.id === b.role)?.label || "mail.role.both")}
                  </td>
                  <td style={td(t)}>
                    <span style={{
                      display: "inline-flex", alignItems: "center", gap: 7, fontSize: 12.5,
                      color: b.lastTestOk === false ? t.err : b.lastTestOk ? t.primary : t.muted,
                    }}>
                      <Icon name={b.lastTestOk === false ? "alert" : b.lastTestOk ? "shield" : "clock"} size={13}/>
                      {b.lastTestOk === false ? tr("mail.stateFail")
                        : b.lastTestOk ? tr("mail.stateOk") : tr("mail.stateNever")}
                    </span>
                  </td>
                  <td style={{ ...td(t), textAlign: "right", whiteSpace: "nowrap" }}>
                    <button onClick={() => setEdition(b)} style={lien(t)}>{tr("action.edit")}</button>
                    <button onClick={() => supprimer(b)} style={{ ...lien(t), color: t.err }}>{tr("action.delete")}</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {edition && pret && (
        <MailForm t={t} boite={edition} fournisseurs={fournisseurs}
          onClose={() => setEdition(null)}
          onSaved={async () => { setEdition(null); await charger(); }}/>
      )}
    </div>
  );
}

function td(t: any): any {
  return { padding: "12px 16px", borderBottom: `1px solid ${t.hairSoft}`, fontSize: 13 };
}
function lien(t: any): any {
  return {
    background: "none", border: "none", cursor: "pointer", fontFamily: t.font,
    fontSize: 12.5, color: t.muted, padding: "2px 8px",
  };
}

// ── Feuille d'ajout et de modification ──────────────────────────────────────
function MailForm({ t, boite, fournisseurs, onClose, onSaved }: any) {
  const modification = !!boite?.id;

  const [email, setEmail] = useState(boite?.email || "");
  const [password, setPassword] = useState("");
  const [provider, setProvider] = useState(boite?.provider || "");
  const [n, setN] = useState("");
  const [role, setRole] = useState(boite?.role || "both");
  const [deplie, setDeplie] = useState(false);
  const [srv, setSrv] = useState<any>({
    imap: boite?.imap || { host: "", port: 993, security: "ssl" },
    smtp: boite?.smtp || { host: "", port: 465, security: "ssl" },
  });

  // Le verrou : enregistrer n'est possible qu'après un test réussi, et toute
  // modification le réarme.
  const [teste, setTeste] = useState(false);
  const [resultat, setResultat] = useState<any>(null);
  const [busy, setBusy] = useState<"" | "test" | "save">("");

  const MP = window.MailProviders;
  const fiche = useMemo(
    () => (MP && provider ? MP.resolve(provider, email, { n }) : null),
    [MP, provider, email, n],
  );
  const manque: string[] = fiche?.needs || [];
  const libre = provider === "other" || !provider;

  // Détection du fournisseur à la saisie de l'adresse.
  useEffect(() => {
    if (!MP || modification || provider) return;
    const trouve = MP.detect(email);
    if (trouve) setProvider(trouve);
  }, [email]);

  // Les réglages serveur suivent le fournisseur, sauf en mode libre.
  useEffect(() => {
    if (!fiche || libre) return;
    setSrv({
      imap: { host: fiche.imap.host, port: fiche.imap.port, security: fiche.imap.security },
      smtp: { host: fiche.smtp.host, port: fiche.smtp.port, security: fiche.smtp.security },
    });
  }, [fiche?.imap?.host, fiche?.smtp?.host, libre]);

  // Toute modification réarme le verrou.
  const touche = (fn: () => void) => { fn(); setTeste(false); setResultat(null); };

  const charge = () => ({
    email: email.trim().toLowerCase(),
    password,
    provider: provider || "other",
    role,
    imap: role === "send" ? undefined : srv.imap,
    smtp: role === "receive" ? undefined : srv.smtp,
  });

  const tester = async () => {
    setBusy("test"); setResultat(null);
    try {
      const r = await api.verifyMailbox(charge());
      setResultat(r); setTeste(!!r.ok);
    } catch (e: any) {
      // Pas d'échec silencieux : si l'API ne répond pas, on le dit.
      setResultat({ ok: false, error: e?.message || tr("mail.apiDown") });
      setTeste(false);
    } finally { setBusy(""); }
  };

  const enregistrer = async () => {
    setBusy("save");
    try { await api.saveMailbox(charge()); await onSaved(); }
    catch (e: any) { setResultat({ ok: false, error: e?.message || tr("mail.apiDown") }); }
    finally { setBusy(""); }
  };

  const champ: any = {
    width: "100%", background: t.well, border: `1px solid ${t.border}`, color: t.txt,
    borderRadius: 9, padding: "9px 12px", fontSize: 13, outline: "none", fontFamily: t.monoFont,
  };
  const etiquette: any = {
    display: "block", color: t.faint, fontSize: 10.5, textTransform: "uppercase",
    letterSpacing: "0.12em", marginBottom: 5,
  };

  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, zIndex: 9500, background: "rgba(10,11,13,.5)",
      backdropFilter: "blur(3px)", display: "flex", justifyContent: "flex-end",
    }}>
      {/* Feuille latérale, conformément à la spécification. */}
      <div onClick={e => e.stopPropagation()} style={{
        width: 520, maxWidth: "100%", height: "100%", overflowY: "auto",
        background: t.bg, boxShadow: t.liftHi,
      }}>
        <div style={{
          display: "flex", alignItems: "center", gap: 10, padding: "18px 22px",
          position: "sticky", top: 0, background: t.bg, zIndex: 2,
        }}>
          <h2 style={{ fontSize: 17, fontWeight: 600, letterSpacing: "-0.025em", margin: 0 }}>
            {modification ? tr("mail.formEdit") : tr("mail.formNew")}
          </h2>
          <button onClick={onClose} style={{
            marginLeft: "auto", width: 30, height: 30, borderRadius: 9, border: "none",
            background: t.well, color: t.muted, cursor: "pointer", display: "flex",
            alignItems: "center", justifyContent: "center",
          }}><Icon name="plus" size={15} style={{ transform: "rotate(45deg)" }}/></button>
        </div>

        <div style={{ padding: "0 22px 26px" }}>
          {/* 1 — adresse */}
          <div style={{ marginBottom: 14 }}>
            <label style={etiquette}>{tr("mail.address")}</label>
            <input value={email} autoFocus disabled={modification}
              onChange={e => touche(() => setEmail(e.target.value))}
              placeholder="alertes@exemple.local" style={champ}/>
          </div>

          {/* 2 — mot de passe */}
          <div style={{ marginBottom: 14 }}>
            <label style={etiquette}>{tr("mail.password")}</label>
            <input type="password" value={password}
              onChange={e => touche(() => setPassword(e.target.value))}
              placeholder={boite?.hasPassword ? tr("mail.keepPassword") : ""} style={champ}/>
          </div>

          {/* 3 — fournisseur */}
          <div style={{ marginBottom: 14 }}>
            <label style={etiquette}>{tr("mail.provider")}</label>
            <Select t={t} value={provider} placeholder={tr("mail.choose")}
              onChange={v => touche(() => setProvider(v))}
              options={fournisseurs.map((f: any) => ({
                value: f.id, label: f.label, note: f.note || undefined, icon: "bell",
              }))}/>
          </div>

          {/* 4 — numéro de serveur, uniquement si le fournisseur l'exige */}
          {manque.includes("n") && (
            <div style={{ marginBottom: 14 }}>
              <label style={etiquette}>{tr("mail.serverNumber")}</label>
              <input value={n} onChange={e => touche(() => setN(e.target.value.replace(/\D/g, "")))}
                placeholder="2" style={{ ...champ, maxWidth: 120 }}/>
            </div>
          )}

          {/* 5 — note du fournisseur */}
          {fiche?.note && (
            <div style={{
              fontSize: 12.5, color: t.muted, background: t.well, borderRadius: 9,
              padding: "10px 12px", marginBottom: 14, lineHeight: 1.5,
            }}>{fiche.note}</div>
          )}

          {/* 6 — réglages serveur, repliés */}
          <button onClick={() => setDeplie(v => !v)} style={{
            display: "flex", alignItems: "center", gap: 8, background: "none", border: "none",
            cursor: "pointer", color: t.muted, fontSize: 12.5, fontFamily: t.font,
            padding: "6px 0", marginBottom: deplie ? 10 : 14,
          }}>
            <Icon name="settings" size={13} stroke={1.8}/>
            {tr("mail.serverSettings")} {deplie ? "▾" : "▸"}
          </button>

          {deplie && (["imap", "smtp"] as const).map(side => (
            (role === "send" && side === "imap") || (role === "receive" && side === "smtp") ? null : (
              <div key={side} style={{
                display: "grid", gridTemplateColumns: "1fr 90px 130px", gap: 9, marginBottom: 10,
              }}>
                <div>
                  <label style={etiquette}>{side.toUpperCase()}</label>
                  <input value={srv[side].host} disabled={!libre}
                    onChange={e => touche(() => setSrv({ ...srv, [side]: { ...srv[side], host: e.target.value } }))}
                    style={{ ...champ, opacity: libre ? 1 : 0.6 }}/>
                </div>
                <div>
                  <label style={etiquette}>{tr("mail.port")}</label>
                  <input value={srv[side].port} disabled={!libre}
                    onChange={e => touche(() => setSrv({ ...srv, [side]: { ...srv[side], port: Number(e.target.value.replace(/\D/g, "")) || 0 } }))}
                    style={{ ...champ, opacity: libre ? 1 : 0.6 }}/>
                </div>
                <div>
                  <label style={etiquette}>{tr("mail.security")}</label>
                  <Select t={t} value={srv[side].security} disabled={!libre}
                    onChange={v => touche(() => setSrv({ ...srv, [side]: { ...srv[side], security: v } }))}
                    options={SECURITES.map(x => ({
                      value: x,
                      label: x === "ssl" ? "SSL/TLS" : x === "starttls" ? "STARTTLS" : tr("mail.noCrypt"),
                      icon: x === "none" ? "alert" : "shield",
                    }))}/>
                </div>
              </div>
            )
          ))}

          {/* 7 — rôle */}
          <div style={{ marginBottom: 18 }}>
            <label style={etiquette}>{tr("mail.role")}</label>
            <div style={{ display: "flex", gap: 8 }}>
              {ROLES.map(r => (
                <button key={r.id} onClick={() => touche(() => setRole(r.id))} style={{
                  flex: 1, padding: "8px 10px", borderRadius: 9, border: "none", cursor: "pointer",
                  fontSize: 12.5, fontFamily: t.font,
                  background: role === r.id ? t.surface : t.well,
                  boxShadow: role === r.id ? t.lift : "none",
                  color: role === r.id ? t.txt : t.muted,
                  fontWeight: role === r.id ? 500 : 400,
                }}>{tr(r.label)}</button>
              ))}
            </div>
          </div>

          {resultat && (
            <div style={{
              display: "flex", alignItems: "flex-start", gap: 9, fontSize: 12.5, marginBottom: 16,
              padding: "10px 13px", borderRadius: 9, lineHeight: 1.5,
              background: resultat.ok ? t.wash : t.alarmWash,
              color: resultat.ok ? t.primary : t.err,
            }}>
              <span style={{ marginTop: 1 }}><Icon name={resultat.ok ? "shield" : "alert"} size={14}/></span>
              <div>
                <div>{resultat.ok ? (resultat.inbox || tr("mail.testOk")) : resultat.error}</div>
                {Array.isArray(resultat.details) && resultat.details.length > 0 && (
                  <div style={{ color: t.muted, fontFamily: t.monoFont, fontSize: 11, marginTop: 5 }}>
                    {resultat.details.join(" · ")}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* 8 — actions */}
          <div style={{ display: "flex", gap: 9 }}>
            <button onClick={tester} disabled={busy !== ""} style={{
              display: "flex", alignItems: "center", gap: 7, padding: "9px 15px", borderRadius: 9,
              border: "none", cursor: busy ? "wait" : "pointer", fontFamily: t.font,
              fontSize: 13, fontWeight: 500, background: t.well, color: t.txtSoft,
            }}><Icon name="refresh" size={14} stroke={1.8}/>
              {busy === "test" ? tr("mail.testing") : tr("mail.test")}</button>

            <button onClick={enregistrer} disabled={!teste || busy !== ""} title={teste ? "" : tr("mail.testFirst")}
              style={{
                marginLeft: "auto", display: "flex", alignItems: "center", gap: 7,
                padding: "9px 17px", borderRadius: 9, border: "none",
                cursor: teste ? "pointer" : "not-allowed", fontFamily: t.font,
                fontSize: 13, fontWeight: 600,
                background: teste ? t.grad : t.well,
                color: teste ? t.onPrimary : t.faint,
              }}><Icon name="shield" size={14} stroke={1.8}/>
              {busy === "save" ? "…" : tr("action.save")}</button>
          </div>

          {!teste && (
            <div style={{ color: t.faint, fontSize: 11.5, marginTop: 10 }}>{tr("mail.testFirst")}</div>
          )}
        </div>
      </div>
    </div>
  );
}
