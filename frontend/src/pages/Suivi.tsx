// Suivi — notifications, journal, rapports.

import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../stores/app";
import { api } from "../api/client";
import { useT } from "../lib/i18n";
import { Icon } from "../lib/icons";
import {
  Page, Figs, Fig, Card, Pad, Split, Btn, Chip, Toggle, Notice,
  Empty, Note, Field, Lbl,
} from "../components/ui/Primitives";
import { fmtDate, depuis, nomAppareil } from "./communs";

const CANAUX = ["telegram", "email", "sms", "discord", "webhook"] as const;

const CHAMPS: Record<string, [string, string][]> = {
  telegram: [["token", "Jeton du bot"], ["chatId", "Identifiant de discussion"]],
  email:    [["provider", "Fournisseur"], ["address", "Adresse"], ["password", "Mot de passe d'application"]],
  sms:      [["sid", "Identifiant Twilio"], ["token", "Jeton"], ["from", "Numéro émetteur"], ["to", "Numéro destinataire"]],
  discord:  [["webhookUrl", "URL du crochet"]],
  webhook:  [["url", "URL"], ["headers", "En-têtes (JSON, facultatif)"]],
};

// ════════════════════════════════════════════════════════════════════════════
// NOTIFICATIONS
// ════════════════════════════════════════════════════════════════════════════

export function NotificationsPage(_props: { t?: any }) {
  const s = useT();
  const alerts = useStore(st => st.alerts);
  const refreshAlerts = useStore(st => st.refreshAlerts);

  const [canaux, setCanaux] = useState<any[]>([]);
  const [commandes, setCommandes] = useState<any[]>([]);
  const [declencheurs, setDeclencheurs] = useState<any[]>([]);
  const [edition, setEdition] = useState<any | null>(null);
  const [canalEdite, setCanalEdite] = useState<string | null>(null);

  const recharger = async () => {
    const [n, c, d] = await Promise.all([api.listNotifications(), api.listCommands(), api.getTriggers()]);
    setCanaux(n); setCommandes(c); setDeclencheurs(d);
  };
  useEffect(() => { recharger().catch(() => {}); }, []);

  const actifs = canaux.filter(n => n.enabled).map(n => n.channel);
  const parId = Object.fromEntries(declencheurs.map((d: any) => [d.id, d]));

  const basculer = async (id: string, enabled: boolean) => { await api.updateCommand(id, { enabled }); recharger(); };
  const supprimer = async (c: any) => {
    if (!confirm(s("misc.confirmDelete", { name: c.name }))) return;
    await api.deleteCommand(c.id); recharger();
  };
  const declencher = async (c: any) => {
    if (!confirm(`Déclencher « ${c.name} » maintenant, à titre d'essai ?`)) return;
    // Adresse de documentation : aucun hôte réel n'est désigné par cet essai.
    await api.fireCommand(c.id, { test: true, ip: "192.0.2.42", name: "hôte-exemple", score: 88 });
    alert("Commande déclenchée — vérifie le canal concerné.");
  };
  const acquitter = async (a: any) => { await api.ackAlert(a.id); await refreshAlerts(); };
  const acquitterTout = async () => {
    await Promise.allSettled(alerts.filter((a: any) => !a.acknowledged).map((a: any) => api.ackAlert(a.id)));
    await refreshAlerts();
  };

  const enAttente = alerts.filter((a: any) => !a.acknowledged).length;

  return (
    <Page title={s("page.notifications.title")} lede={s("page.notifications.lede")}
      actions={<>
        <Btn icon="check" onClick={acquitterTout} disabled={!enAttente}>{s("act.markAllRead")}</Btn>
        <Btn solid icon="plus" onClick={() => setEdition({
          isNew: true, name: "", trigger: declencheurs[0]?.id || "device.new",
          actions: [{ kind: "notify", channels: actifs.slice(0, 1) }],
          template: "", cooldownSec: 0, enabled: true, filter: null,
        })}>{s("act.newCommand")}</Btn>
      </>}>

      <Card title={s("card.channels")} note={`${actifs.length} actif(s)`}>
        <Pad style={{ paddingTop: 4 }}>
          <div style={{ display: "flex", gap: 9, flexWrap: "wrap", alignItems: "center" }}>
            {CANAUX.map(ch => {
              const cfg = canaux.find(n => n.channel === ch);
              const etat = !cfg?.enabled ? "off" : cfg.lastSuccess ? "on" : "pending";
              return (
                <button key={ch} onClick={() => setCanalEdite(canalEdite === ch ? null : ch)}
                  style={{ padding: 0, background: "none", border: "none" }}>
                  <Chip tone={etat === "on" ? "a" : etat === "pending" ? "w" : undefined}>
                    <i className="d" style={{
                      width: 6, height: 6, borderRadius: "50%", display: "inline-block",
                      background: etat === "on" ? "var(--accent)" : etat === "pending" ? "var(--warn)" : "var(--faint)",
                    }}/>
                    {ch}
                  </Chip>
                </button>
              );
            })}
          </div>
          {/* L'explication se lit sous les pastilles. Poussée à droite par un
              marginLeft:auto, elle laissait un vide au milieu de la ligne et
              se retrouvait à deux mètres de ce qu'elle décrit. */}
          <div className="aide">Clique un canal pour saisir ou remplacer ses identifiants.</div>

          {canalEdite && (
            <EditeurCanal canal={canalEdite} onClose={() => setCanalEdite(null)}
              onSaved={async () => { await recharger(); setCanalEdite(null); }}/>
          )}
        </Pad>
      </Card>

      <Split>
        <Card title={s("card.commands")} note={`${commandes.length}`}>
          {commandes.map(c => {
            const d = parId[c.trigger];
            const actes = Array.isArray(c.actions) ? c.actions : [];
            return (
              <div className="flowrow" key={c.id}>
                <Toggle on={!!c.enabled} onChange={v => basculer(c.id, v)}/>
                <span className="itile"><Icon name="bell" size={15}/></span>
                <div>
                  <strong>{c.name}</strong>
                  <div className="chain">
                    <span>{d?.label || c.trigger}</span>
                    <span className="ar">→</span>
                    {actes.map((a: any, i: number) => (
                      <span key={i} style={{
                        color: a.kind === "ban" ? "var(--alarm)" : a.kind === "quarantine" ? "var(--warn)" : "var(--accent)",
                      }}>
                        {a.kind === "notify" ? `prévenir [${(a.channels || []).join(", ")}]` : a.kind}
                        {i < actes.length - 1 ? " + " : ""}
                      </span>
                    ))}
                    {c.cooldownSec > 0 && <span className="ar">· pause {c.cooldownSec} s</span>}
                  </div>
                </div>
                <div className="stat">
                  <b>{c.fireCount || 0} envoi(s)</b>
                  <span style={{ display: "block", whiteSpace: "nowrap" }}>
                    <button className="lnk" onClick={() => declencher(c)}>{s("action.test")}</button>
                    <button className="lnk" onClick={() => setEdition({ ...c, isNew: false })}>{s("action.edit")}</button>
                    <button className="lnk" onClick={() => supprimer(c)}>{s("action.delete")}</button>
                  </span>
                </div>
              </div>
            );
          })}
          {commandes.length === 0 && <Empty text="Aucune commande — « quand ceci, fais cela »" icon="bell"/>}
        </Card>

        <Card title="Reçues" note={`${enAttente} en attente`}>
          {alerts.slice(0, 12).map((a: any) => (
            <Notice key={a.id}
              icon={a.severity === "critical" || a.severity === "high" ? "alert" : "bell"}
              tone={a.severity === "critical" || a.severity === "high" ? "hot" : undefined}
              when={<>
                {a.source || "système"} · {depuis(a.createdAt)}
                {!a.acknowledged && <> · <button className="lnk" onClick={() => acquitter(a)}>marquer comme lu</button></>}
              </>}>
              {a.message}
            </Notice>
          ))}
          {alerts.length === 0 && <Empty text={s("misc.calm")} icon="check"/>}
        </Card>
      </Split>

      {edition && (
        <EditeurCommande commande={edition} declencheurs={declencheurs} canaux={actifs}
          onClose={() => setEdition(null)}
          onSave={async (donnees: any) => {
            try {
              if (edition.isNew) await api.createCommand(donnees);
              else await api.updateCommand(edition.id, donnees);
              setEdition(null); await recharger();
            } catch (e: any) { alert(e.message); }
          }}/>
      )}
    </Page>
  );
}

function EditeurCanal({ canal, onClose, onSaved }: { canal: string; onClose: () => void; onSaved: () => void }) {
  const s = useT();
  const [config, setConfig] = useState<any>({});
  const [occupe, setOccupe] = useState(false);
  const [essai, setEssai] = useState<any>(null);

  const champs = CHAMPS[canal] || [];

  const enregistrer = async () => {
    setOccupe(true);
    try { await api.setNotification(canal, true, config); onSaved(); }
    catch (e: any) { alert(e.message); }
    finally { setOccupe(false); }
  };
  const tester = async () => {
    setOccupe(true); setEssai(null);
    try { setEssai(await api.testNotification(canal, config)); }
    catch (e: any) { setEssai({ ok: false, error: e.message }); }
    finally { setOccupe(false); }
  };
  const couper = async () => { await api.setNotification(canal, false, {}); onSaved(); };

  return (
    <div style={{ marginTop: 16, paddingTop: 14, borderTop: "1px solid var(--hair-soft)" }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        {champs.map(([cle, nom]) => (
          <div key={cle}>
            <Lbl>{nom}</Lbl>
            <Field type={cle === "password" || cle === "token" ? "password" : "text"}
              value={config[cle] || ""} placeholder="ressaisir pour remplacer"
              onChange={(e: any) => setConfig({ ...config, [cle]: e.target.value })}/>
          </div>
        ))}
      </div>
      {essai && <div style={{ marginTop: 12 }}>
        <Note tone={essai.ok ? "info" : "warn"}>{essai.ok ? "Message d'essai envoyé." : essai.error}</Note>
      </div>}
      <div style={{ display: "flex", gap: 9, justifyContent: "flex-end", marginTop: 14 }}>
        <button className="lnk" onClick={couper}>désactiver</button>
        <Btn onClick={onClose}>{s("action.cancel")}</Btn>
        <Btn icon="refresh" onClick={tester} disabled={occupe}>{s("action.test")}</Btn>
        <Btn solid icon="check" onClick={enregistrer} disabled={occupe}>{s("action.save")}</Btn>
      </div>
    </div>
  );
}

function EditeurCommande({ commande, declencheurs, canaux, onClose, onSave }: any) {
  const s = useT();
  const [nom, setNom] = useState(commande.name || "");
  const [decl, setDecl] = useState(commande.trigger || "device.new");
  const [actes, setActes] = useState<any[]>(commande.actions || [{ kind: "notify", channels: canaux.slice(0, 1) }]);
  const [modele, setModele] = useState(commande.template || "");
  const [pause, setPause] = useState(commande.cooldownSec || 0);
  const [active, setActive] = useState(commande.enabled !== false);
  const [recherche, setRecherche] = useState("");

  const choisi = declencheurs.find((d: any) => d.id === decl);
  const groupes: Record<string, any[]> = {};
  for (const d of declencheurs) {
    const cat = d.category || "Autres";
    if (recherche && !`${d.id} ${d.label} ${cat}`.toLowerCase().includes(recherche.toLowerCase())) continue;
    (groupes[cat] ||= []).push(d);
  }

  const majActe = (i: number, patch: any) => setActes(actes.map((a, j) => (j === i ? { ...a, ...patch } : a)));

  return (
    <div className="feuille" onClick={onClose}>
      <div className="fcarte" style={{ width: 520 }} onClick={e => e.stopPropagation()}>
        <div className="fhead">
          <div style={{ flex: 1 }}>
            <h2>{commande.isNew ? "Nouvelle commande" : commande.name}</h2>
            <p>quand ceci se produit, fais cela</p>
          </div>
          <button className="fx" onClick={onClose}>×</button>
        </div>

        <div className="fcorps">
          <Lbl>{s("col.name")}</Lbl>
          <Field sans value={nom} placeholder="Prévenir sur un nouvel objet connecté"
            onChange={(e: any) => setNom(e.target.value)}/>

          <div className="ftitre" style={{ marginTop: 22 }}>1 · quand</div>
          <Field sans value={recherche} placeholder="filtrer les déclencheurs…"
            onChange={(e: any) => setRecherche(e.target.value)}/>
          <div style={{ maxHeight: 190, overflowY: "auto", marginTop: 10, background: "var(--well)", borderRadius: 9 }}>
            {Object.keys(groupes).map(cat => (
              <div key={cat}>
                <div className="secttl">{cat}</div>
                {groupes[cat].map((d: any) => (
                  <button key={d.id} className={decl === d.id ? "trow sel" : "trow"} onClick={() => setDecl(d.id)}>
                    <span className="nm2">{d.label}</span>
                    <span className="ipx2">{d.id}</span>
                  </button>
                ))}
              </div>
            ))}
          </div>
          {choisi?.vars?.length > 0 && (
            <div style={{ marginTop: 8, color: "var(--faint)", fontFamily: "var(--mono)", fontSize: 11 }}>
              variables : {choisi.vars.map((v: string) => `{{${v}}}`).join(" · ")}
            </div>
          )}

          <div className="ftitre" style={{ marginTop: 22 }}>2 · fais</div>
          {actes.map((a, i) => (
            <div key={i} style={{ background: "var(--well)", borderRadius: 9, padding: 12, marginBottom: 9 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                <b className="mono" style={{ fontSize: 11.5, color: "var(--accent)" }}>{a.kind}</b>
                <button className="lnk" style={{ marginLeft: "auto" }}
                  onClick={() => setActes(actes.filter((_, j) => j !== i))}>retirer</button>
              </div>
              {a.kind === "notify" && (
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 9 }}>
                  {CANAUX.map(ch => {
                    const coche = (a.channels || []).includes(ch);
                    const dispo = canaux.includes(ch);
                    return (
                      <button key={ch} disabled={!dispo}
                        className={coche ? "ftr on" : "ftr"}
                        style={{ opacity: dispo ? 1 : .45 }}
                        onClick={() => majActe(i, {
                          channels: coche ? (a.channels || []).filter((x: string) => x !== ch) : [...(a.channels || []), ch],
                        })}>{ch}</button>
                    );
                  })}
                </div>
              )}
              {a.kind === "log" && (
                <div style={{ marginTop: 9 }}>
                  <select className="field" value={a.level || "info"} onChange={e => majActe(i, { level: e.target.value })}>
                    {["info", "warn", "error", "success"].map(l => <option key={l}>{l}</option>)}
                  </select>
                </div>
              )}
              {a.kind === "ban" && (
                <div style={{ marginTop: 9 }}>
                  <Field sans value={a.reason || ""} placeholder="motif consigné"
                    onChange={(e: any) => majActe(i, { reason: e.target.value })}/>
                </div>
              )}
              {a.kind === "exec_ssh" && (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 9, marginTop: 9 }}>
                  <Field value={a.deviceId || ""} placeholder="id équipement"
                    onChange={(e: any) => majActe(i, { deviceId: e.target.value })}/>
                  <Field value={a.cmd || ""} placeholder="commande"
                    onChange={(e: any) => majActe(i, { cmd: e.target.value })}/>
                </div>
              )}
            </div>
          ))}
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {[
              { k: "notify", l: "prévenir" }, { k: "log", l: "consigner" },
              { k: "quarantine", l: "isoler" }, { k: "ban", l: "bloquer" }, { k: "exec_ssh", l: "commande SSH" },
            ].map(a => (
              <button key={a.k} className="ftr" onClick={() => setActes([...actes, (
                a.k === "notify" ? { kind: "notify", channels: canaux.slice(0, 1) }
                  : a.k === "log" ? { kind: "log", level: "info" }
                  : a.k === "ban" ? { kind: "ban", reason: "" }
                  : a.k === "exec_ssh" ? { kind: "exec_ssh", deviceId: "", cmd: "" }
                  : { kind: a.k }
              )])}>+ {a.l}</button>
            ))}
          </div>

          <div className="ftitre" style={{ marginTop: 22 }}>3 · message</div>
          <textarea className="field" rows={3} value={modele}
            placeholder="Nouvel appareil {{name}} ({{ip}}) chez {{vendor}}."
            onChange={e => setModele(e.target.value)}/>

          <div style={{ display: "grid", gridTemplateColumns: "140px 1fr", gap: 12, marginTop: 18, alignItems: "end" }}>
            <div><Lbl>Pause (s)</Lbl>
              <Field type="number" value={pause} onChange={(e: any) => setPause(parseInt(e.target.value) || 0)}/></div>
            <span style={{ display: "flex", alignItems: "center", gap: 9, fontSize: 12.5, color: "var(--muted)", paddingBottom: 8 }}>
              <Toggle on={active} onChange={setActive}/> active
            </span>
          </div>

          <div className="fboutons">
            <Btn onClick={onClose}>{s("action.cancel")}</Btn>
            <Btn solid icon="check" onClick={() => {
              if (!nom.trim()) return alert("Donne un nom à la commande.");
              if (actes.length === 0) return alert("Ajoute au moins une action.");
              onSave({
                name: nom, trigger: decl, actions: actes, template: modele || null,
                cooldownSec: pause || 0, enabled: active, filter: null,
              });
            }}>{s("action.save")}</Btn>
          </div>
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// JOURNAL
// ════════════════════════════════════════════════════════════════════════════

export function LogsPage(_props: { t?: any }) {
  const s = useT();
  const logs = useStore(st => st.logs);
  const [niveau, setNiveau] = useState("all");
  const [q, setQ] = useState("");
  const corps = useRef<HTMLDivElement>(null);

  const listes = useMemo(() => logs.filter((l: any) => {
    if (niveau !== "all" && l.level !== niveau) return false;
    if (!q) return true;
    return `${l.source} ${l.message}`.toLowerCase().includes(q.toLowerCase());
  }), [logs, niveau, q]);

  const couleur = (n: string) =>
    n === "error" ? "var(--alarm)" : n === "warn" ? "var(--warn)"
      : n === "success" ? "var(--accent)" : "var(--ink-soft)";

  return (
    <Page title={s("page.logs.title")} lede={s("page.logs.lede")}
      actions={
        <div className="filtres">
          {["all", "info", "success", "warn", "error"].map(n => (
            <button key={n} className={niveau === n ? "ftr on" : "ftr"} onClick={() => setNiveau(n)}>
              {n === "all" ? s("misc.all") : n}
            </button>
          ))}
        </div>
      }>

      <div style={{ marginBottom: 14, maxWidth: 340 }}>
        <Field sans placeholder={s("misc.search")} value={q} onChange={(e: any) => setQ(e.target.value)}/>
      </div>

      <div className="term">
        <div className="termhead">
          <span className="dots"><i/><i/><i/></span>
          <span className="mono" style={{ fontSize: 11.5, color: "var(--muted)" }}>
            {listes.length} entrée(s)
          </span>
        </div>
        <div className="termbody" ref={corps}>
          {listes.map((l: any) => (
            <div key={l.id}>
              <span className="t">{new Date(l.createdAt).toLocaleTimeString()}</span>{" "}
              <span style={{ color: "var(--faint)" }}>{l.source}</span>{" "}
              <span style={{ color: couleur(l.level) }}>{l.message}</span>
            </div>
          ))}
          {listes.length === 0 && <div className="dim">{s("misc.noLogs")}</div>}
        </div>
      </div>
    </Page>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// RAPPORTS
// ════════════════════════════════════════════════════════════════════════════
//
// Le serveur ne conserve pas d'archives de rapports : plutôt qu'un tableau
// d'entrées inventées, la page produit la synthèse du moment et permet de
// l'emporter. Ce qui est affiché est ce qui est mesuré.

export function ReportsPage(_props: { t?: any }) {
  const s = useT();
  const devices = useStore(st => st.devices);
  const alerts = useStore(st => st.alerts);
  const vlans = useStore(st => st.vlans);
  const healthScore = useStore(st => st.healthScore);

  const cves = devices.reduce((n: number, d: any) => n + (d.cves?.length || 0), 0);
  const risqueEleve = devices.filter((d: any) => (d.dangerScore || 0) >= 70);
  const ports = devices.reduce((n: number, d: any) => n + (d.ports?.length || 0), 0);
  const nouveaux = devices.filter((d: any) => d.firstSeen && Date.now() - new Date(d.firstSeen).getTime() < 86400000);
  const retenus = devices.filter((d: any) => d.status === "banned" || d.status === "quarantined");

  const emporter = (format: "json" | "html") => {
    const date = new Date();
    const synthese = {
      genereLe: date.toISOString(),
      sante: healthScore,
      parc: { total: devices.length, enLigne: devices.filter((d: any) => d.status === "online").length, nouveaux24h: nouveaux.length },
      exposition: { portsOuverts: ports, failles: cves, risqueEleve: risqueEleve.length },
      defense: { retenus: retenus.length, segments: vlans.length },
      incidents: alerts.slice(0, 50).map((a: any) => ({ quand: a.createdAt, gravite: a.severity, source: a.source, message: a.message })),
    };
    let blob: Blob, nom: string;
    if (format === "json") {
      blob = new Blob([JSON.stringify(synthese, null, 2)], { type: "application/json" });
      nom = `mapmylan-rapport-${date.toISOString().slice(0, 10)}.json`;
    } else {
      const l = (t: string, v: any) => `<tr><td>${t}</td><td>${v}</td></tr>`;
      blob = new Blob([`<!doctype html><meta charset="utf-8"><title>Rapport MapMyLAN</title>
<style>body{font-family:system-ui;margin:40px;color:#14161A}h1{font-size:22px}
table{border-collapse:collapse;margin-top:18px}td{border-bottom:1px solid #E5E5E0;padding:7px 14px 7px 0}</style>
<h1>MapMyLAN — synthèse du ${date.toLocaleString()}</h1><table>
${l("Santé", `${healthScore}/100`)}${l("Hôtes connus", devices.length)}
${l("Nouveaux (24 h)", nouveaux.length)}${l("Ports ouverts", ports)}
${l("Failles", cves)}${l("Hôtes à risque élevé", risqueEleve.length)}
${l("Hôtes retenus", retenus.length)}${l("Segments", vlans.length)}</table>`], { type: "text/html" });
      nom = `mapmylan-rapport-${date.toISOString().slice(0, 10)}.html`;
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = nom; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Page title={s("page.reports.title")} lede={s("page.reports.lede")}
      actions={<>
        <Btn icon="export" onClick={() => emporter("json")}>JSON</Btn>
        <Btn solid icon="export" onClick={() => emporter("html")}>{s("act.generate")}</Btn>
      </>}>

      <Figs cols={4}>
        <Fig icon="shield" label={s("fig.health")} value={healthScore} unit="/100"
          delta={healthScore > 75 ? "posture saine" : "à consolider"}/>
        <Fig icon="devices" tone="plain" label={s("fig.fleet")} value={devices.length}
          delta={`${nouveaux.length} nouveau(x) en 24 h`}/>
        <Fig icon="alert" tone={risqueEleve.length ? "warn" : undefined} label={s("fig.incidents")}
          value={alerts.length} delta={`${retenus.length} isolement(s)`}/>
        <Fig icon="port" tone="plain" label={s("fig.exposed")} value={ports} delta={`${cves} faille(s) associée(s)`}/>
      </Figs>

      <Split>
        <Card title="Ce qui pèse sur la note" note="par ordre de poids">
          <table>
            <thead><tr><th>{s("col.host")}</th><th>{s("col.risk")}</th><th>{s("col.state")}</th></tr></thead>
            <tbody>
              {risqueEleve.slice(0, 8).map((d: any) => (
                <tr key={d.id}>
                  <td><b style={{ fontWeight: 500 }}>{nomAppareil(d)}</b> <span className="mono dim">{d.ip}</span></td>
                  <td className="mono">{Math.round(d.dangerScore)}</td>
                  <td className="dim">{(d.cves?.length || 0)} faille(s) · {(d.ports?.length || 0)} port(s)</td>
                </tr>
              ))}
            </tbody>
          </table>
          {risqueEleve.length === 0 && <Empty text="Aucun hôte au-dessus du seuil" icon="check"/>}
        </Card>

        <Card title="Derniers incidents" note={`${alerts.length}`}>
          {alerts.slice(0, 8).map((a: any) => (
            <Notice key={a.id} icon="alert" tone={a.severity === "critical" ? "hot" : undefined}
              when={`${a.source || "système"} · ${fmtDate(a.createdAt)}`}>{a.message}</Notice>
          ))}
          {alerts.length === 0 && <Empty text={s("misc.calm")} icon="check"/>}
        </Card>
      </Split>
    </Page>
  );
}
