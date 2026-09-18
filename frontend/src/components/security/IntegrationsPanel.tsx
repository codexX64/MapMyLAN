// Intégrations.
//
// Un jeton d'intégration donne à un programme tiers un accès durable à l'API,
// sans compte et sans mot de passe. Deux choses en découlent, visibles ici :
//
//   — le jeton n'est montré qu'une fois, à la création. Le serveur n'en garde
//     que l'empreinte ; personne, pas même un administrateur, ne peut le
//     réafficher ensuite. Fermer ce bandeau sans l'avoir copié oblige à en
//     créer un autre, et c'est voulu ;
//   — révoquer n'efface pas la ligne. On garde le nom, le rôle et la dernière
//     utilisation : savoir ce qui a existé fait partie de la surveillance.
//
// Le rôle « admin » n'est pas proposé, et le serveur le refuserait : un jeton
// vit dans le fichier de configuration d'un autre programme, il n'a ni second
// facteur ni mot de passe à opposer à qui le lit.

import { useEffect, useState } from "react";
import { api } from "../../api/client";
import { Icon } from "../../lib/icons";
import { translate as tr } from "../../lib/i18n";

interface Jeton {
  id: string;
  name: string;
  prefix: string;
  role: string;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  etat: "actif" | "revoque" | "expire";
}

const ROLES = ["viewer", "operator"] as const;

function quand(v: string | null): string {
  if (!v) return "—";
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
}

export function IntegrationsPanel({ t }: { t: any }) {
  const [jetons, setJetons] = useState<Jeton[]>([]);
  const [nom, setNom] = useState("");
  const [role, setRole] = useState<string>("viewer");
  const [clair, setClair] = useState<string | null>(null);
  const [copie, setCopie] = useState(false);
  const [err, setErr] = useState("");
  const [occupe, setOccupe] = useState(false);
  // `null` tant qu'on ne sait pas : la liste n'est ouverte qu'aux
  // administrateurs, donc un 403 signifie « rien à afficher », pas une panne.
  const [autorise, setAutorise] = useState<boolean | null>(null);

  const charger = () =>
    api.integrations()
      .then((l: Jeton[]) => { setJetons(l); setAutorise(true); })
      .catch(() => setAutorise(false));

  useEffect(() => { charger(); }, []);

  const creer = async () => {
    const n = nom.trim();
    if (!n) { setErr(tr("integrations.errName")); return; }
    setOccupe(true); setErr("");
    try {
      const rep: any = await api.createIntegration({ name: n, role });
      setClair(rep.token);
      setCopie(false);
      setNom("");
      await charger();
    } catch (e: any) {
      setErr(e?.message || tr("integrations.errApi"));
    } finally { setOccupe(false); }
  };

  const revoquer = async (j: Jeton) => {
    if (!confirm(tr("integrations.confirmRevoke").replace("{nom}", j.name))) return;
    setOccupe(true); setErr("");
    try { await api.revokeIntegration(j.id); await charger(); }
    catch (e: any) { setErr(e?.message || tr("integrations.errApi")); }
    finally { setOccupe(false); }
  };

  const copier = async () => {
    if (!clair) return;
    try { await navigator.clipboard.writeText(clair); setCopie(true); }
    catch { setCopie(false); }
  };

  if (autorise === false) return null;

  const champ: any = {
    background: t.well, border: `1px solid ${t.border}`, color: t.txt,
    borderRadius: 9, padding: "9px 12px", fontSize: 13, outline: "none", width: "100%",
  };
  const etiquette: any = {
    display: "block", color: t.faint, fontSize: 10.5, textTransform: "uppercase",
    letterSpacing: "0.12em", marginBottom: 5,
  };
  const teinte = (etat: string) =>
    etat === "actif" ? t.primary : etat === "expire" ? t.faint : t.err;

  return (
    <div className="set">
      <header>
        <span className="tile"><Icon name="plug" size={17}/></span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2>{tr("integrations.title")}</h2>
          <p>{tr("integrations.lede")}</p>
        </div>
      </header>

      {clair && (
        <div style={{
          margin: "0 18px 14px", padding: "14px 16px", borderRadius: 11,
          background: t.well, border: `1px solid ${t.primary}`,
        }}>
          <div style={{ fontSize: 12.5, color: t.txt, marginBottom: 9 }}>
            {tr("integrations.onceOnly")}
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <code style={{
              flex: 1, minWidth: 0, fontFamily: t.monoFont, fontSize: 12.5,
              wordBreak: "break-all", color: t.txt,
            }}>{clair}</code>
            <button onClick={copier} style={{
              flex: "none", border: `1px solid ${t.border}`, background: t.surface,
              color: t.txt, borderRadius: 8, padding: "7px 12px", fontSize: 12.5,
              cursor: "pointer",
            }}>{copie ? tr("integrations.copied") : tr("integrations.copy")}</button>
            <button onClick={() => setClair(null)} title={tr("integrations.close")} style={{
              flex: "none", border: "none", background: "transparent", color: t.faint,
              cursor: "pointer", padding: 6,
            }}><Icon name="plus" size={15} style={{ transform: "rotate(45deg)" }}/></button>
          </div>
        </div>
      )}

      {jetons.length === 0 ? (
        <div style={{ padding: "20px 18px", textAlign: "center", color: t.faint, fontSize: 13 }}>
          {tr("integrations.none")}
        </div>
      ) : jetons.map((j) => (
        <div key={j.id} style={{
          display: "flex", alignItems: "center", gap: 12, padding: "11px 18px",
          borderTop: `1px solid ${t.hairSoft}`,
        }}>
          <span style={{
            width: 7, height: 7, borderRadius: 7, flex: "none", background: teinte(j.etat),
          }}/>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13.5, color: t.txt }}>{j.name}</div>
            <div style={{ fontSize: 11.5, color: t.faint, fontFamily: t.monoFont }}>
              {j.prefix}… · {j.role} · {tr("integrations.lastUsed")} {quand(j.lastUsedAt)}
            </div>
          </div>
          <span style={{ fontSize: 11.5, color: teinte(j.etat) }}>
            {tr(`integrations.state.${j.etat}`)}
          </span>
          {!j.revokedAt && (
            <button onClick={() => revoquer(j)} disabled={occupe} style={{
              flex: "none", border: `1px solid ${t.border}`, background: "transparent",
              color: t.txt, borderRadius: 8, padding: "6px 11px", fontSize: 12.5,
              cursor: occupe ? "default" : "pointer",
            }}>{tr("integrations.revoke")}</button>
          )}
        </div>
      ))}

      <div style={{ padding: "14px 18px 18px", borderTop: `1px solid ${t.hairSoft}` }}>
        <div style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
          <div style={{ flex: "1 1 200px", minWidth: 0 }}>
            <label style={etiquette}>{tr("integrations.name")}</label>
            <input value={nom} onChange={(e) => setNom(e.target.value)}
              placeholder={tr("integrations.namePlaceholder")} style={champ}/>
          </div>
          <div style={{ flex: "0 0 160px" }}>
            <label style={etiquette}>{tr("integrations.role")}</label>
            <select value={role} onChange={(e) => setRole(e.target.value)} style={champ}>
              {ROLES.map((r) => (
                <option key={r} value={r}>{tr(`integrations.role.${r}`)}</option>
              ))}
            </select>
          </div>
          <button onClick={creer} disabled={occupe} style={{
            flex: "none", border: "none", background: t.primary, color: t.onPrimary,
            borderRadius: 9, padding: "10px 16px", fontSize: 13,
            cursor: occupe ? "default" : "pointer",
          }}>{tr("integrations.create")}</button>
        </div>
        <p style={{ margin: "10px 0 0", fontSize: 12, color: t.faint }}>
          {tr("integrations.roleNote")}
        </p>
        {err && <p style={{ margin: "8px 0 0", fontSize: 12.5, color: t.err }}>{err}</p>}
      </div>
    </div>
  );
}
