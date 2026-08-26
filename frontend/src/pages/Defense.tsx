// Défense — règles automatiques et vulnérabilités.

import { useEffect, useMemo, useState } from "react";
import { useStore } from "../stores/app";
import { api } from "../api/client";
import { useT } from "../lib/i18n";
import { Icon } from "../lib/icons";
import {
  Page, Card, Pad, Split, Btn, Chip, Toggle, WhoCell, Empty, Note, Figs, Fig, Field,
} from "../components/ui/Primitives";
import { depuis, nomAppareil, GlypheAppareil, ETATS, fmtDate } from "./communs";

// ════════════════════════════════════════════════════════════════════════════
// SÉCURITÉ
// ════════════════════════════════════════════════════════════════════════════

export function SecurityPage(_props: { t?: any }) {
  const s = useT();
  const devices = useStore(st => st.devices);
  const refreshDevices = useStore(st => st.refreshDevices);
  const selectDevice = useStore(st => st.selectDevice);
  const [regles, setRegles] = useState<any[]>([]);
  const [message, setMessage] = useState<string | null>(null);

  const charger = () => api.listRules().then(setRegles).catch(() => {});
  useEffect(() => { charger(); }, []);

  const basculer = (id: string, enabled: boolean) =>
    api.updateRule(id, { enabled }).then(charger).catch((e: any) => setMessage(e.message));
  const seuil = (id: string, threshold: number) =>
    api.updateRule(id, { threshold }).then(charger).catch((e: any) => setMessage(e.message));

  const retenus = devices.filter((d: any) => d.status === "banned" || d.status === "quarantined");
  const actives = regles.filter(r => r.enabled).length;

  const liberer = async (d: any) => {
    if (!confirm(`Rendre l'accès à ${nomAppareil(d)} ?`)) return;
    try { await api.unbanDevice(d.id); await refreshDevices(); }
    catch (e: any) { setMessage(e.message); }
  };

  const libelleAction = (a: string) =>
    a === "ban" ? "bloquer" : a === "quarantine" ? "isoler" : a === "notify" ? "prévenir" : a;

  return (
    <Page
      title={s("page.security.title")}
      lede={s("page.security.lede")}
      actions={<Btn solid icon="plus" onClick={() => useStore.getState().setPage("notifications")}>
        {s("act.newRule")}
      </Btn>}
    >
      {message && <Note tone="warn">{message}</Note>}

      <Split>
        <Card title={s("card.rules")} note={`${actives} active${actives > 1 ? "s" : ""}`}>
          {regles.map(r => (
            <div className="flowrow" key={r.id}>
              <Toggle on={!!r.enabled} onChange={v => basculer(r.id, v)}/>
              <span className="itile"><Icon name="shield" size={15}/></span>
              <div>
                <strong>{r.name}</strong>
                <div className="chain">
                  <span>{r.trigger}</span>
                  <span className="ar">→</span>
                  <span style={{ color: r.action === "ban" ? "var(--alarm)" : r.action === "quarantine" ? "var(--warn)" : "var(--accent)" }}>
                    {libelleAction(r.action)}
                  </span>
                  {r.exceptWhitelist && <span className="ar">· hors liste blanche</span>}
                </div>
              </div>
              <div className="stat">
                {r.threshold != null ? (
                  <span style={{ display: "flex", alignItems: "center", gap: 7 }}>
                    seuil
                    <Field type="number" value={r.threshold} style={{ width: 66, padding: "5px 8px" }}
                      onChange={(e: any) => seuil(r.id, parseFloat(e.target.value))}/>
                  </span>
                ) : <b>{r.enabled ? "active" : "en veille"}</b>}
              </div>
            </div>
          ))}
          {regles.length === 0 && <Empty text={s("misc.loading")} icon="shield"/>}
        </Card>

        <Card title={s("card.blocked")} note={String(retenus.length)}>
          <table>
            <tbody>
              {retenus.map((d: any) => (
                <tr key={d.id}>
                  <td onClick={() => selectDevice(d.id)} style={{ cursor: "pointer" }}>
                    <WhoCell icon={<GlypheAppareil d={d}/>} tone="hot"
                      name={nomAppareil(d)} sub={d.ip}/>
                  </td>
                  <td><Chip tone="w">{ETATS[d.status] || d.status}</Chip></td>
                  <td className="mono dim" style={{ whiteSpace: "nowrap" }}>{depuis(d.updatedAt || d.lastSeen)}</td>
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                    <button className="lnk" onClick={() => liberer(d)}>rendre l'accès</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {retenus.length === 0
            ? <Empty text="Aucun hôte retenu" icon="check"/>
            : <Pad>
                <div style={{ color: "var(--muted)", fontSize: 12.5, lineHeight: 1.55, marginTop: 6 }}>
                  Un hôte retenu reste visible et continue d'être balayé : c'est sa
                  route sortante qui est coupée, pas sa surveillance.
                </div>
              </Pad>}
        </Card>
      </Split>
    </Page>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// VULNÉRABILITÉS
// ════════════════════════════════════════════════════════════════════════════

export function VulnsPage(_props: { t?: any }) {
  const s = useT();
  const devices = useStore(st => st.devices);
  const selectDevice = useStore(st => st.selectDevice);
  const [filtre, setFiltre] = useState("all");

  const toutes = useMemo(() => {
    const l = devices.flatMap((d: any) => (d.cves || []).map((c: any) => ({ ...c, appareil: d })));
    return l.sort((a, b) => (b.cvss || 0) - (a.cvss || 0));
  }, [devices]);

  const gravite = (c: any): string => {
    const v = Number(c.cvss || 0);
    if (c.severity) return String(c.severity).toLowerCase();
    return v >= 9 ? "critical" : v >= 7 ? "high" : v >= 4 ? "medium" : "low";
  };
  const libelleGravite: Record<string, string> = {
    critical: "critique", high: "élevée", medium: "moyenne", low: "faible", info: "pour info",
  };

  const listees = filtre === "all" ? toutes : toutes.filter(c => gravite(c) === filtre);
  const compte = (g: string) => toutes.filter(c => gravite(c) === g).length;

  return (
    <Page title={s("page.vulns.title")} lede={s("page.vulns.lede")}>
      <Figs cols={4}>
        <Fig icon="alert" tone={compte("critical") ? "warn" : undefined} label="Critiques" value={compte("critical")}
          delta="correction immédiate"/>
        <Fig icon="alert" label="Élevées" value={compte("high")} delta="à planifier"/>
        <Fig icon="port" tone="plain" label="Moyennes" value={compte("medium")} delta="à surveiller"/>
        <Fig icon="devices" tone="plain" label="Hôtes touchés" value={new Set(toutes.map(c => c.appareil.id)).size}
          delta={`sur ${devices.length}`}/>
      </Figs>

      <Card
        title={s("card.cves")}
        head={
          <div className="filtres">
            {["all", "critical", "high", "medium", "low"].map(g => (
              <button key={g} className={filtre === g ? "ftr on" : "ftr"} onClick={() => setFiltre(g)}>
                {g === "all" ? s("misc.all") : libelleGravite[g]}
              </button>
            ))}
          </div>
        }
        note={`${listees.length}`}
      >
        <table>
          <thead><tr>
            <th>{s("col.ref")}</th><th>{s("col.host")}</th><th>{s("col.service")}</th>
            <th>{s("col.severity")}</th><th>{s("col.found")}</th>
          </tr></thead>
          <tbody>
            {listees.map((c: any, i: number) => {
              const g = gravite(c);
              return (
                <tr key={`${c.cveId}-${c.appareil.id}-${i}`}
                  onClick={() => selectDevice(c.appareil.id)} style={{ cursor: "pointer" }}>
                  <td>
                    <b className="mono" style={{ color: "var(--ink)" }}>{c.cveId}</b>
                    <div className="dim" style={{ fontSize: 12, marginTop: 2, maxWidth: "52ch" }}>{c.description}</div>
                  </td>
                  <td className="mono">{nomAppareil(c.appareil)}</td>
                  <td className="dim">{c.service || "—"}</td>
                  <td>
                    <Chip tone={g === "critical" || g === "high" ? "w" : g === "medium" ? undefined : "a"}>
                      {libelleGravite[g] || g}{c.cvss ? ` · ${c.cvss}` : ""}
                    </Chip>
                  </td>
                  <td className="mono dim">{c.detectedAt ? fmtDate(c.detectedAt) : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {listees.length === 0 && <Empty text={s("misc.noVulns")} icon="check"/>}
      </Card>
    </Page>
  );
}
