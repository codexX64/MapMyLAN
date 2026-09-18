// Supervision — vue d'ensemble, carte, trafic mondial, appareils, VLAN.
//
// Toutes ces pages lisent le magasin, qui lit l'API. Aucune ne fabrique de
// donnée : là où le serveur ne mesure rien, la page le dit plutôt que de
// dessiner une courbe décorative.

import { useEffect, useMemo, useState } from "react";
import { useStore } from "../stores/app";
import { api } from "../api/client";
import { useT } from "../lib/i18n";
import { Icon } from "../lib/icons";
import { TopologyMap } from "../components/topology/TopologyMap";
import { WorldTrafficView } from "../components/world/WorldTrafficView";
import {
  Page, Figs, Fig, FigChart, Card, Pad, Split, Btn, Chip, Tag, Risk,
  WhoCell, Notice, Empty, Note, Views, Field, Lbl, Toggle,
} from "../components/ui/Primitives";
import {
  fmtDate, depuis, nomAppareil, GlypheAppareil, ETATS, tonEtat, liaison, triParRisque,
} from "./communs";

// ════════════════════════════════════════════════════════════════════════════
// VUE D'ENSEMBLE
// ════════════════════════════════════════════════════════════════════════════

export function Dashboard(_props: { t?: any }) {
  const s = useT();
  const devices = useStore(st => st.devices);
  const alerts = useStore(st => st.alerts);
  const healthScore = useStore(st => st.healthScore);
  const scanRunning = useStore(st => st.scanRunning);
  const triggerScan = useStore(st => st.triggerScan);
  const selectDevice = useStore(st => st.selectDevice);
  const vlans = useStore(st => st.vlans);

  const [charge, setCharge] = useState<number[]>([]);
  useEffect(() => {
    // Seule série réellement conservée par le serveur : celle de la machine
    // hôte. Elle sert de fond à la tuile « santé ».
    api.hostHistory(60)
      .then(h => setCharge((h || []).map((p: any) => Number(p.cpuPct) || 0)))
      .catch(() => {});
  }, []);

  const enLigne = devices.filter((d: any) => d.status === "online").length;
  const parRisque = triParRisque(devices);
  const pire = parRisque[0];
  const ports = devices.reduce((n: number, d: any) => n + (d.ports?.length || 0), 0);

  // Export : ce que l'interface a sous la main, tel quel, en JSON. Pas de
  // route serveur à inventer, et le fichier reste lisible.
  const exporter = () => {
    const contenu = JSON.stringify({
      exporteLe: new Date().toISOString(),
      hotes: devices.map((d: any) => ({
        nom: nomAppareil(d), ip: d.ip, mac: d.mac, fabricant: d.vendor,
        type: d.customType || d.type, etat: d.status, risque: d.dangerScore,
        ports: d.ports || [], vu: d.lastSeen,
      })),
      vlans, santé: healthScore,
    }, null, 2);
    const url = URL.createObjectURL(new Blob([contenu], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url; a.download = `mapmylan-parc-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Page
      title={s("page.dashboard.title")}
      lede={s("page.dashboard.lede", { total: devices.length, online: enLigne })}
      actions={<>
        <Btn icon="export" onClick={exporter}>{s("action.export")}</Btn>
        <Btn solid icon="refresh" disabled={scanRunning} onClick={() => triggerScan()}>
          {scanRunning ? s("act.scanning") : s("act.scan")}
        </Btn>
      </>}
    >
      <Figs>
        <Fig icon="devices" label={s("fig.online")} value={enLigne}
          unit={s("fig.outOf", { n: devices.length })}
          delta={`${devices.filter((d: any) => d.status === "offline").length} hors ligne`}/>
        <Fig icon="alert" tone={pire && pire.dangerScore >= 70 ? "warn" : undefined}
          label={s("fig.maxRisk")} value={pire ? Math.round(pire.dangerScore || 0) : 0}
          delta={pire ? nomAppareil(pire) : "—"}/>
        <Fig icon="port" tone="plain" label={s("fig.openPorts")} value={ports}
          delta={`sur ${devices.length} hôtes`}/>
        <Fig icon="shield" label={s("fig.health")} value={healthScore} unit="/100"
          delta={`${vlans.length} segments déclarés`}
          chart={charge.length > 1 ? <FigChart data={charge} tone="accent"/> : undefined}/>
      </Figs>

      <Split>
        <Card title={s("card.watch")} note={s("card.watch.note")}>
          <table>
            <thead><tr>
              <th>{s("col.host")}</th><th>{s("col.link")}</th><th>{s("col.risk")}</th><th>{s("col.state")}</th>
            </tr></thead>
            <tbody>
              {parRisque.slice(0, 6).map((d: any) => {
                const l = liaison(d);
                return (
                  <tr key={d.id} onClick={() => selectDevice(d.id)} style={{ cursor: "pointer" }}>
                    <td>
                      <WhoCell icon={<GlypheAppareil d={d}/>}
                        tone={d.dangerScore >= 70 ? "hot" : undefined}
                        name={nomAppareil(d)} sub={d.ip}/>
                    </td>
                    <td><span className="tag"><Icon name={l.icon} size={13}/>{l.label}</span></td>
                    <td><Risk score={d.dangerScore}/></td>
                    <td><Chip tone={tonEtat(d.status)}>{ETATS[d.status] || d.status}</Chip></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {devices.length === 0 && <Empty text={s("misc.noDevices")} icon="devices"/>}
        </Card>

        <Card title={s("card.recent")} note={s("card.recent.note")}>
          {alerts.slice(0, 6).map((a: any) => (
            <Notice key={a.id}
              icon={a.severity === "critical" || a.severity === "high" ? "alert" : "bell"}
              tone={a.severity === "critical" || a.severity === "high" ? "hot" : undefined}
              when={`${a.source || "système"} · ${depuis(a.createdAt)}`}>
              {a.message}
            </Notice>
          ))}
          {alerts.length === 0 && <Empty text={s("misc.calm")} icon="check"/>}
        </Card>
      </Split>
    </Page>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// CARTE
// ════════════════════════════════════════════════════════════════════════════

export function MapPage({ t }: { t?: any }) {
  const s = useT();
  const setPage = useStore(st => st.setPage);
  const refreshTopology = useStore(st => st.refreshTopology);
  const [occupe, setOccupe] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  // L'agencement de la carte vit ici plutôt que dans la carte elle-même :
  // c'est un choix de VUE, au même titre que carte / tableau / trafic, et il
  // se prend donc au même endroit. Le choix reste dans ce navigateur.
  const [agencement, setAgencement] = useState<"libre" | "arbre">(() => {
    try { return localStorage.getItem("mapmylan_agencement") === "arbre" ? "arbre" : "libre"; }
    catch { return "libre"; }
  });
  const choisirAgencement = (m: "libre" | "arbre") => {
    setAgencement(m);
    try { localStorage.setItem("mapmylan_agencement", m); } catch { /* rien à faire */ }
  };

  const reconstruire = async () => {
    setOccupe(true); setMessage(null);
    try { await api.autoBuildTopology(); await refreshTopology(); }
    catch (e: any) { setMessage(e.message); }
    finally { setOccupe(false); }
  };

  return (
    <Page
      title={s("page.map.title")}
      lede={s("page.map.lede")}
      actions={<>
        <Views items={[
          { label: s("agencement.free"), icon: "libre", on: agencement === "libre",
            onClick: () => choisirAgencement("libre") },
          { label: s("agencement.tree"), icon: "arbre", on: agencement === "arbre",
            onClick: () => choisirAgencement("arbre") },
        ]}/>
        <Views items={[
          { label: s("view.map"), icon: "map", on: true },
          { label: s("view.table"), icon: "devices", onClick: () => setPage("devices") },
          { label: s("page.world.title"), icon: "globe", onClick: () => setPage("world") },
        ]}/>
        <Btn icon="refresh" disabled={occupe} onClick={reconstruire}>{s("act.rebuild")}</Btn>
      </>}
    >
      {message && <Note tone="warn">{message}</Note>}

      <div className="plan">
        <div className="planwrap" style={{ height: "calc(100vh - 260px)", minHeight: 420 }}>
          <TopologyMap theme={t} agencement={agencement} onAgencement={choisirAgencement}/>
        </div>
        <div className="planbar">
          <div><span className="ln"/>{s("link.wired")}</div>
          <div><span className="ln air"/>{s("link.wireless")}</div>
          <div><span className="ln same"/>{s("link.same")}</div>
          <span className="zoom">molette pour zoomer · glisser pour déplacer</span>
        </div>
      </div>
    </Page>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// TRAFIC MONDIAL
// ════════════════════════════════════════════════════════════════════════════

export function WorldPage({ t }: { t?: any }) {
  const s = useT();
  const setPage = useStore(st => st.setPage);

  return (
    <Page
      title={s("page.world.title")}
      lede={<>
        Les connexions sortantes relevées sur la passerelle. Trait plein vers la
        ville quand le nom d'hôte la donne ; pointillé vers le pays
        d'enregistrement du préfixe sinon — une déclaration au registre, pas la
        position du serveur. Sans l'un ni l'autre, la destination est listée
        sans arc : rien n'est deviné.
      </>}
      actions={
        <Views items={[
          { label: s("view.map"), icon: "map", onClick: () => setPage("map") },
          { label: s("view.table"), icon: "devices", onClick: () => setPage("devices") },
          { label: s("page.world.title"), icon: "globe", on: true },
        ]}/>
      }
    >
      <WorldTrafficView t={t}/>
    </Page>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// APPAREILS
// ════════════════════════════════════════════════════════════════════════════

export function DevicesPage(_props: { t?: any }) {
  const s = useT();
  const devices = useStore(st => st.devices);
  const vlans = useStore(st => st.vlans);
  const scanRunning = useStore(st => st.scanRunning);
  const triggerScan = useStore(st => st.triggerScan);
  const refreshDevices = useStore(st => st.refreshDevices);
  const selectDevice = useStore(st => st.selectDevice);

  const [filtre, setFiltre] = useState("");
  const [etat, setEtat] = useState("all");
  const [occupe, setOccupe] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const listeEtats = ["all", "online", "offline", "suspect", "quarantined", "banned"];

  const filtres = useMemo(() => devices.filter((d: any) => {
    if (etat !== "all" && d.status !== etat) return false;
    if (!filtre) return true;
    const q = filtre.toLowerCase();
    return [d.ip, d.mac, d.hostname, d.customName, d.vendor, d.type, d.os, ...(d.tags || [])]
      .filter(Boolean).some((v: any) => String(v).toLowerCase().includes(q));
  }), [devices, filtre, etat]);

  const rattachement = (d: any) => {
    const v = vlans.find((x: any) => x.id === (d.vlan ?? d.vlanId));
    if (v) return `VLAN ${v.id} · ${v.name}`;
    const m = /^(\d+\.\d+\.\d+)\.\d+$/.exec(d.ip || "");
    return m ? `${m[1]}.0/24` : "—";
  };

  // Fusion des doublons : deux relevés du même matériel (deux cartes réseau,
  // une adresse qui a changé) n'ont pas à occuper deux lignes.
  const fusionner = async () => {
    setOccupe(true); setMessage(null);
    try {
      const r = await api.dedupeDevices();
      setMessage(`${r.removed} doublon(s) fusionné(s) sur ${r.groups} groupe(s).`);
      await refreshDevices();
    } catch (e: any) { setMessage(e.message); }
    finally { setOccupe(false); }
  };

  // Suppression d'une fiche.
  //
  // Un hôte encore en ligne réapparaîtra au balayage suivant : c'est le
  // scanner qui fait foi, pas la base. Supprimer n'a donc de sens que pour ce
  // qui a disparu du réseau — d'où le décompte des hôtes hors ligne, et
  // l'avertissement quand on efface un hôte présent.
  const horsLigne = devices.filter((d: any) => d.status === "offline" && !d.isMainRouter);

  const supprimer = async (d: any) => {
    const present = d.status !== "offline";
    const texte = present
      ? `Supprimer ${nomAppareil(d)} ? Il est encore en ligne : le prochain balayage le recréera.`
      : `Supprimer ${nomAppareil(d)} ?`;
    if (!confirm(texte)) return;
    setOccupe(true); setMessage(null);
    try { await api.deleteDevice(d.id); await refreshDevices(); }
    catch (e: any) { setMessage(e.message); }
    finally { setOccupe(false); }
  };

  const supprimerHorsLigne = async () => {
    if (!horsLigne.length) return;
    if (!confirm(
      `Supprimer ${horsLigne.length} hôte(s) hors ligne ?\n\n` +
      `Ceux qui se reconnecteront réapparaîtront au balayage suivant, avec un ` +
      `historique repris de zéro.`
    )) return;
    setOccupe(true); setMessage(null);
    const r = await Promise.allSettled(horsLigne.map((d: any) => api.deleteDevice(d.id)));
    const faits = r.filter((x) => x.status === "fulfilled").length;
    const rates = r.length - faits;
    setMessage(`${faits} fiche(s) supprimée(s)${rates ? `, ${rates} refusée(s) par le serveur` : ""}.`);
    await refreshDevices();
    setOccupe(false);
  };

  return (
    <Page
      title={s("page.devices.title")}
      lede={s("page.devices.lede", { total: devices.length, shown: filtres.length })}
      actions={<>
        {horsLigne.length > 0 && (
          <Btn icon="ban" disabled={occupe} onClick={supprimerHorsLigne}
            title="Efface les fiches des hôtes qui ne répondent plus">
            Supprimer les hors ligne ({horsLigne.length})
          </Btn>
        )}
        <Btn icon="pair" disabled={occupe} onClick={fusionner}>{s("act.dedupe")}</Btn>
        <Btn solid icon="refresh" disabled={scanRunning} onClick={() => triggerScan()}>
          {scanRunning ? s("act.scanning") : s("act.scan")}
        </Btn>
      </>}
    >
      {message && <Note>{message}</Note>}

      <Card
        title={s("card.inventory")}
        head={
          <div className="filtres">
            {listeEtats.map(e => (
              <button key={e} className={etat === e ? "ftr on" : "ftr"} onClick={() => setEtat(e)}>
                {e === "all" ? s("misc.all") : ETATS[e] || e}
              </button>
            ))}
          </div>
        }
      >
        <div style={{ padding: "0 18px 12px" }}>
          <Field placeholder={s("misc.search")} value={filtre} onChange={(e: any) => setFiltre(e.target.value)}/>
        </div>
        <table>
          <thead><tr>
            <th>{s("col.host")}</th><th>{s("col.vendor")}</th><th>{s("col.link")}</th>
            <th>{s("col.attach")}</th><th style={{ textAlign: "right" }}>{s("col.ports")}</th>
            <th>{s("col.risk")}</th><th>{s("col.state")}</th><th/>
          </tr></thead>
          <tbody>
            {filtres.map((d: any) => {
              const l = liaison(d);
              return (
                <tr key={d.id} onClick={() => selectDevice(d.id)} style={{ cursor: "pointer" }}>
                  <td>
                    <WhoCell icon={<GlypheAppareil d={d}/>}
                      tone={d.status === "banned" || d.status === "quarantined" ? "hot" : undefined}
                      name={nomAppareil(d)} sub={d.ip}/>
                  </td>
                  <td className="dim">{d.vendor || s("misc.unknown")}</td>
                  <td><span className="tag"><Icon name={l.icon} size={13}/>{l.label}</span></td>
                  <td className="mono dim">{rattachement(d)}</td>
                  <td className="mono" style={{ textAlign: "right" }}>{d.ports?.length || 0}</td>
                  <td><Risk score={d.dangerScore}/></td>
                  <td><Chip tone={tonEtat(d.status)}>{ETATS[d.status] || d.status}</Chip></td>
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                    {!d.isMainRouter && (
                      <button className="lnk" title="Supprimer cette fiche"
                        onClick={(e) => { e.stopPropagation(); supprimer(d); }}>✕</button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {filtres.length === 0 && <Empty text={devices.length ? s("misc.none") : s("misc.noDevices")} icon="devices"/>}
      </Card>
    </Page>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// VLAN
// ════════════════════════════════════════════════════════════════════════════

export function VlansPage(_props: { t?: any }) {
  const s = useT();
  const vlans = useStore(st => st.vlans);
  const devices = useStore(st => st.devices);
  // Le relevé rattache aussi les appareils : la liste doit être relue derrière.
  const refreshDevices = useStore(st => st.refreshDevices);

  const [ouvert, setOuvert] = useState(false);
  const [edition, setEdition] = useState<number | null>(null);
  const [form, setForm] = useState<any>({ id: 10, name: "", subnet: "", color: "#1B2AFF", isolated: false, pushToRouter: true });
  const [occupe, setOccupe] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; texte: string } | null>(null);

  const recharger = async () => useStore.setState({ vlans: await api.listVlans() });

  const compte = (id: number) => devices.filter((d: any) => (d.vlan ?? d.vlanId) === id).length;

  const commencer = () => {
    setForm({
      id: (vlans.reduce((m: number, v: any) => Math.max(m, v.id), 0) || 0) + 10,
      name: "", subnet: "", color: "#1B2AFF", isolated: false, pushToRouter: true,
    });
    setOuvert(true); setEdition(null); setMessage(null);
  };
  const modifier = (v: any) => { setForm({ ...v }); setEdition(v.id); setOuvert(true); setMessage(null); };

  /**
   * Relève les VLAN déclarés sur l'équipement.
   *
   * Sens inverse de « Ajouter » : rien n'est poussé sur la passerelle, on lit
   * sa configuration et on la range. Le nom et le sous-réseau viennent d'elle ;
   * la couleur et l'isolement restent ce que tu en as fait.
   */
  const relever = async () => {
    setOccupe(true); setMessage(null);
    try {
      const r = await api.releverVlans();
      await recharger();
      await refreshDevices().catch(() => {});
      if (r?.erreur) { setMessage({ ok: false, texte: r.erreur }); return; }
      const bouts = [
        `${r.ajoutes} relevé(s)`,
        r.misAJour ? `${r.misAJour} mis à jour` : null,
        r.inchanges ? `${r.inchanges} inchangé(s)` : null,
        r.rattaches ? `${r.rattaches} appareil(s) rattaché(s)` : null,
        r.orphelins?.length ? `absent(s) de l'équipement : VLAN ${r.orphelins.join(", ")}` : null,
        ...(r.ignores || []),
      ].filter(Boolean);
      setMessage({ ok: true, texte: bouts.join(" · ") });
    } catch (e: any) { setMessage({ ok: false, texte: e.message }); }
    finally { setOccupe(false); }
  };

  const enregistrer = async () => {
    setOccupe(true); setMessage(null);
    try {
      if (edition != null) {
        await api.updateVlan(edition, {
          name: form.name, subnet: form.subnet, color: form.color,
          description: form.description, isolated: form.isolated,
        });
      } else {
        const r = await api.createVlan(form);
        if (r?.provision?.pushed) setMessage({ ok: true, texte: `VLAN ${form.id} poussé sur ${r.provision.vendor}.` });
        else if (r?.provision?.output) setMessage({ ok: false, texte: r.provision.output });
        else setMessage({ ok: true, texte: `VLAN ${form.id} enregistré (base seule).` });
      }
      setOuvert(false); setEdition(null);
      await recharger();
    } catch (e: any) { setMessage({ ok: false, texte: e.message }); }
    finally { setOccupe(false); }
  };

  const supprimer = async (v: any) => {
    if (!confirm(`Supprimer le VLAN ${v.id} (${v.name}) ? Il sera aussi retiré de l'équipement.`)) return;
    setOccupe(true); setMessage(null);
    try { await api.deleteVlan(v.id, true); await recharger(); }
    catch (e: any) { setMessage({ ok: false, texte: e.message }); }
    finally { setOccupe(false); }
  };

  const isoles = vlans.filter((v: any) => v.isolated).length;
  const repartis = devices.filter((d: any) => (d.vlan ?? d.vlanId) != null).length;
  const segmentsUtilises = new Set(devices.map((d: any) => d.vlan ?? d.vlanId).filter((x: any) => x != null)).size;

  return (
    <Page
      title={s("page.vlans.title")}
      lede={s("page.vlans.lede")}
      actions={<>
        <Btn icon="refresh" onClick={relever} disabled={occupe}>
          {occupe ? "Relevé…" : "Relever depuis l'équipement"}
        </Btn>
        <Btn solid icon="plus" onClick={commencer}>{s("act.addVlan")}</Btn>
      </>}
    >
      <Figs>
        <Fig icon="vlan" label={s("fig.segments")} value={vlans.length} delta={`${isoles} isolant(s)`}/>
        <Fig icon="devices" tone="plain" label={s("fig.spread")} value={repartis}
          delta={`sur ${segmentsUtilises} segment(s)`}/>
        <Fig icon="alert" tone="warn" label={s("fig.quarantined")}
          value={devices.filter((d: any) => d.status === "quarantined").length}
          delta={devices.filter((d: any) => d.status === "quarantined").map(nomAppareil)[0] || "aucun"}/>
        <Fig icon="globe" label={s("fig.isolatedExit")} value={isoles} delta="sans route sortante"/>
      </Figs>

      {message && <Note tone={message.ok ? "info" : "warn"}>{message.texte}</Note>}

      {ouvert && (
        <Card title={edition != null ? `Modifier le VLAN ${edition}` : "Nouveau segment"}>
          <Pad>
            <div style={{ display: "grid", gridTemplateColumns: "110px 1fr 1fr auto", gap: 12, alignItems: "end" }}>
              <div>
                <Lbl>{s("col.segment")}</Lbl>
                <Field type="number" value={form.id} disabled={edition != null}
                  onChange={(e: any) => setForm({ ...form, id: parseInt(e.target.value) || 0 })}/>
              </div>
              <div>
                <Lbl>{s("col.name")}</Lbl>
                <Field sans value={form.name} placeholder="Objets connectés"
                  onChange={(e: any) => setForm({ ...form, name: e.target.value })}/>
              </div>
              <div>
                <Lbl>{s("col.subnet")}</Lbl>
                <Field value={form.subnet} placeholder="198.51.100.0/24"
                  onChange={(e: any) => setForm({ ...form, subnet: e.target.value })}/>
              </div>
              <Btn solid icon="check" disabled={occupe || !form.name || !form.subnet} onClick={enregistrer}>
                {s("action.save")}
              </Btn>
            </div>
            <div style={{ display: "flex", gap: 22, marginTop: 16, alignItems: "center" }}>
              <span style={{ display: "flex", alignItems: "center", gap: 9, fontSize: 12.5, color: "var(--muted)" }}>
                <Toggle on={!!form.isolated} onChange={v => setForm({ ...form, isolated: v })}/>
                segment isolant (aucune route sortante)
              </span>
              {edition == null && (
                <span style={{ display: "flex", alignItems: "center", gap: 9, fontSize: 12.5, color: "var(--muted)" }}>
                  <Toggle on={!!form.pushToRouter} onChange={v => setForm({ ...form, pushToRouter: v })}/>
                  déclarer sur l'équipement
                </span>
              )}
              <button className="lnk" style={{ marginLeft: "auto" }}
                onClick={() => { setOuvert(false); setEdition(null); }}>{s("action.cancel")}</button>
            </div>
          </Pad>
        </Card>
      )}

      <Card title={s("card.segments")} note={s("card.segments.note")}>
        <table>
          <thead><tr>
            <th>{s("col.segment")}</th><th>{s("col.name")}</th><th>{s("col.subnet")}</th>
            <th style={{ textAlign: "right" }}>{s("col.devices")}</th>
            <th>{s("col.exit")}</th><th>{s("col.state")}</th><th/>
          </tr></thead>
          <tbody>
            {vlans.map((v: any) => (
              <tr key={v.id}>
                <td className="mono">{v.id}</td>
                <td><b style={{ fontWeight: 500 }}>{v.name}</b></td>
                <td className="mono">{v.subnet}</td>
                <td className="mono" style={{ textAlign: "right" }}>{compte(v.id)}</td>
                <td className="dim">{v.isolated ? "aucune" : "directe"}</td>
                <td><Chip tone={v.isolated ? "w" : "a"}>{v.isolated ? "isolant" : "actif"}</Chip></td>
                <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                  <button className="lnk" onClick={() => modifier(v)}>{s("action.edit")}</button>
                  {" · "}
                  <button className="lnk" onClick={() => supprimer(v)}>{s("action.delete")}</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {vlans.length === 0 && <Empty text="Aucun segment déclaré" icon="vlan"/>}
      </Card>
    </Page>
  );
}
