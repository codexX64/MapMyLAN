// Contrôle — console SSH, machine hôte, inventaire, commandes du bot.

import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../stores/app";
import { api } from "../api/client";
import { useT } from "../lib/i18n";
import { Icon } from "../lib/icons";
import {
  Page, Figs, Fig, FigChart, Card, Pad, Split, Btn, Chip, Toggle,
  WhoCell, Empty, Note, Field, Lbl,
} from "../components/ui/Primitives";
import { fmtDate, fmtUptime, fmtOctets, depuis } from "./communs";
import { estInterrogeable } from "../lib/trafic";

// ════════════════════════════════════════════════════════════════════════════
// CONSOLE SSH
// ════════════════════════════════════════════════════════════════════════════

export function SshPage(_props: { t?: any }) {
  const s = useT();
  const [liste, setListe] = useState<any[]>([]);
  const [choisi, setChoisi] = useState<any>(null);
  const [commande, setCommande] = useState("");
  const [lignes, setLignes] = useState<{ cmd?: string; out?: string; err?: boolean }[]>([]);
  const [ouvert, setOuvert] = useState(false);
  const [essai, setEssai] = useState<any>(null);
  const [form, setForm] = useState<any>({
    name: "", host: "", port: 22, username: "", password: "",
    privateKey: "", passphrase: "", useKey: false, vendor: "generic", isMainRouter: false,
  });
  const corps = useRef<HTMLDivElement>(null);

  const charger = () => api.listSsh().then(setListe).catch(() => {});
  useEffect(() => { charger(); }, []);

  // Le routeur principal et les consoles SSH partagent la même table côté
  // serveur. Un contrôleur joint par son API locale s'y trouve donc aussi —
  // mais il n'a pas de shell, et le supprimer d'ici effacerait la configuration
  // de la page Équipement réseau. On ne le liste pas : on le signale.
  const consoles = liste.filter(estInterrogeable);
  const parApi = liste.filter((d) => !estInterrogeable(d));

  // La sélection ne doit jamais retomber sur une entrée sans shell.
  useEffect(() => {
    if (choisi && !consoles.some((d) => d.id === choisi.id)) setChoisi(null);
  }, [liste]);
  useEffect(() => { if (corps.current) corps.current.scrollTop = corps.current.scrollHeight; }, [lignes]);

  const charge = () => {
    const { useKey, password, privateKey, passphrase, ...reste } = form;
    return { ...reste, ...(useKey ? { privateKey, passphrase: passphrase || undefined } : { password }) };
  };

  const tester = async () => {
    setEssai(null);
    try { setEssai(await api.testSsh(charge())); }
    catch (e: any) { setEssai({ ok: false, error: e.message }); }
  };
  const enregistrer = async () => {
    await api.addSsh(charge());
    setOuvert(false); setEssai(null);
    setForm({ name: "", host: "", port: 22, username: "", password: "", privateKey: "", passphrase: "", useKey: false, vendor: "generic", isMainRouter: false });
    charger();
  };
  const supprimer = async (d: any) => {
    if (!confirm(s("misc.confirmDelete", { name: d.name }))) return;
    await api.deleteSsh(d.id);
    if (choisi?.id === d.id) setChoisi(null);
    charger();
  };

  // Effacer l'écran est une affaire de terminal, pas d'équipement. Envoyer
  // « clear » sur une exécution non interactive ne fait rien de bon : il n'y a
  // pas de terminal en face, et l'équipement répond « TERM environment
  // variable not set ». On le traite donc ici, et on ne l'envoie pas.
  const EFFACEMENT = new Set(["clear", "cls", "/clear", "!clear", "?clear", "clear()"]);

  const executer = async () => {
    if (!choisi || !commande.trim()) return;
    const cmd = commande;

    if (EFFACEMENT.has(cmd.trim().toLowerCase())) {
      setCommande("");
      setLignes([]);
      return;
    }

    setCommande("");
    setLignes(l => [...l, { cmd }]);
    try {
      const r = await api.execSsh(choisi.id, cmd);
      const sortie = [r.stdout, r.stderr ? `[erreur] ${r.stderr}` : ""].filter(Boolean).join("\n");
      setLignes(l => [...l, { out: sortie || "(aucune sortie)", err: !!r.stderr }]);
    } catch (e: any) {
      setLignes(l => [...l, { out: e.message, err: true }]);
    }
  };

  return (
    <Page title={s("page.ssh.title")} lede={s("page.ssh.lede")}
      actions={<Btn solid icon="plus" onClick={() => setOuvert(o => !o)}>{s("act.addDevice")}</Btn>}>

      <Note tone="warn">
        {s("misc.sshWarn")} Celles qui enchaînent plusieurs instructions sont refusées avant l'envoi.
        {" "}<b style={{ fontWeight: 500 }}>clear</b> fait exception : il efface l'écran ici et
        n'est pas envoyé — sans terminal en face, l'équipement n'en ferait rien.
      </Note>

      {ouvert && (
        <Card title="Nouvel équipement">
          <Pad>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 90px 1fr", gap: 12 }}>
              <div><Lbl>{s("col.name")}</Lbl><Field sans value={form.name} onChange={(e: any) => setForm({ ...form, name: e.target.value })}/></div>
              <div><Lbl>Hôte</Lbl><Field value={form.host} placeholder="192.0.2.1" onChange={(e: any) => setForm({ ...form, host: e.target.value })}/></div>
              <div><Lbl>Port</Lbl><Field type="number" value={form.port} onChange={(e: any) => setForm({ ...form, port: parseInt(e.target.value) || 22 })}/></div>
              <div><Lbl>Compte</Lbl><Field value={form.username} onChange={(e: any) => setForm({ ...form, username: e.target.value })}/></div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 12 }}>
              <div>
                <Lbl>Marque / micrologiciel</Lbl>
                <select className="field" value={form.vendor} onChange={e => setForm({ ...form, vendor: e.target.value })}>
                  {["generic", "asus-merlin", "mikrotik", "openwrt", "pfsense", "cisco", "unifi"].map(v => <option key={v} value={v}>{v}</option>)}
                </select>
              </div>
              <div style={{ display: "flex", alignItems: "flex-end", gap: 18 }}>
                <span style={{ display: "flex", alignItems: "center", gap: 9, fontSize: 12.5, color: "var(--muted)" }}>
                  <Toggle on={!!form.useKey} onChange={v => setForm({ ...form, useKey: v })}/> clé plutôt que mot de passe
                </span>
                <span style={{ display: "flex", alignItems: "center", gap: 9, fontSize: 12.5, color: "var(--muted)" }}>
                  <Toggle on={!!form.isMainRouter} onChange={v => setForm({ ...form, isMainRouter: v })}/>
                  <span title="Un seul équipement porte ce drapeau : le cocher ici le retire à celui qui l'a aujourd'hui, y compris à un contrôleur configuré dans Équipement réseau.">
                    équipement principal
                  </span>
                </span>
              </div>
            </div>

            <div style={{ marginTop: 12 }}>
              {!form.useKey ? (
                <><Lbl>Mot de passe</Lbl>
                  <Field type="password" value={form.password} onChange={(e: any) => setForm({ ...form, password: e.target.value })}/></>
              ) : (
                <>
                  <Lbl>Clé privée</Lbl>
                  <textarea className="field" rows={4} value={form.privateKey}
                    placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
                    onChange={e => setForm({ ...form, privateKey: e.target.value })}/>
                  <div style={{ marginTop: 10 }}>
                    <Lbl>Phrase de passe (facultative)</Lbl>
                    <Field type="password" value={form.passphrase} onChange={(e: any) => setForm({ ...form, passphrase: e.target.value })}/>
                  </div>
                </>
              )}
            </div>

            {essai && (
              <div style={{ marginTop: 12 }}>
                <Note tone={essai.ok ? "info" : "warn"}>{essai.ok ? (essai.banner || "Connexion établie.") : essai.error}</Note>
              </div>
            )}

            <div style={{ display: "flex", gap: 9, justifyContent: "flex-end", marginTop: 14 }}>
              <Btn onClick={() => setOuvert(false)}>{s("action.cancel")}</Btn>
              <Btn icon="refresh" onClick={tester}>{s("action.test")}</Btn>
              <Btn solid icon="check" onClick={enregistrer}>{s("action.save")}</Btn>
            </div>
          </Pad>
        </Card>
      )}

      <Split cols="300px 1fr">
        <Card title={s("card.equipment")} note={String(consoles.length)}>
          {consoles.map(d => (
            <div key={d.id} className="zrow" role="button" tabIndex={0}
              style={{ cursor: "pointer", background: choisi?.id === d.id ? "var(--wash)" : undefined }}
              onClick={() => setChoisi(d)}
              onKeyDown={e => e.key === "Enter" && setChoisi(d)}>
              <span className="itile"><Icon name={d.isMainRouter ? "router" : "switch"} size={15}/></span>
              <span style={{ minWidth: 0, flex: 1 }}>
                <b>{d.name}</b>
                <small>{d.username}@{d.host}:{d.port} · {d.vendor}</small>
              </span>
              <button className="lnk" title="retirer"
                onClick={e => { e.stopPropagation(); supprimer(d); }}>✕</button>
            </div>
          ))}
          {consoles.length === 0 && <Empty text="Aucun équipement enregistré" icon="ssh"/>}

          {/* Ce qui est piloté par API n'est pas une console : on le nomme, on
              explique où il se configure, et on ne propose pas de le retirer. */}
          {parApi.map(d => (
            <div key={d.id} style={{
              padding: "11px 14px", borderTop: "1px solid var(--hair-soft)",
              color: "var(--faint)", fontSize: 11.5, lineHeight: 1.55,
            }}>
              <b style={{ fontWeight: 500, color: "var(--muted)" }}>{d.name}</b>{" "}
              <span className="mono">({d.host}:{d.port})</span> est piloté par son API
              locale : pas de shell, donc pas de console. Il se modifie et se supprime
              depuis <b style={{ fontWeight: 500 }}>Équipement réseau</b>.
            </div>
          ))}
        </Card>

        {/* Hauteur fixe, pas « au plus » : sinon le panneau grandit à chaque
            sortie et c'est la page entière qui descend. Un terminal garde sa
            taille et fait défiler son contenu. Le corps prend la place qui
            reste, la ligne de saisie est cousue en bas. */}
        <div className="term" style={{
          display: "flex", flexDirection: "column",
          height: "max(340px, calc(100vh - 430px))",
        }}>
          <div className="termhead" style={{ flex: "0 0 auto" }}>
            <span className="dots"><i/><i/><i/></span>
            <span className="mono" style={{ fontSize: 11.5, color: "var(--muted)" }}>
              {choisi ? `${choisi.username}@${choisi.name} · ${choisi.host}` : s("card.console")}
            </span>
            {choisi && <Chip tone="a" style={{ marginLeft: "auto" }}>relié</Chip>}
          </div>
          <div className="termbody" ref={corps}
            style={{ flex: "1 1 auto", minHeight: 0, maxHeight: "none" }}>
            {!choisi && <div className="dim">{s("misc.selectLeft")}</div>}
            {choisi && lignes.length === 0 && <div className="dim">{s("misc.outputHere")}</div>}
            {lignes.map((l, i) => l.cmd
              ? <div key={i}><span className="pr">$</span> {l.cmd}</div>
              : <div key={i} className="out" style={{ color: l.err ? "var(--alarm)" : undefined, whiteSpace: "pre-wrap" }}>{l.out}</div>
            )}
          </div>
          {choisi && (
            <div style={{
              flex: "0 0 auto", display: "flex", gap: 9, padding: "12px 16px",
              borderTop: "1px solid var(--hair-soft)",
            }}>
              <Field value={commande} placeholder="ip neigh · clear pour effacer l'écran"
                onChange={(e: any) => setCommande(e.target.value)}
                onKeyDown={(e: any) => e.key === "Enter" && executer()}/>
              <Btn solid icon="arrow" onClick={executer}>{s("act.run")}</Btn>
            </div>
          )}
        </div>
      </Split>
    </Page>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// MACHINE HÔTE
// ════════════════════════════════════════════════════════════════════════════

export function HostPage(_props: { t?: any }) {
  const s = useT();
  const hostStats = useStore(st => st.hostStats);
  const [histo, setHisto] = useState<any[]>([]);

  useEffect(() => {
    const lire = () => api.hostHistory(60).then(setHisto).catch(() => {});
    lire();
    const i = setInterval(lire, 30000);
    return () => clearInterval(i);
  }, []);

  if (!hostStats) {
    return <Page title={s("page.host.title")} lede={s("page.host.lede")}>
      <Card><Empty text={s("misc.loading")} icon="server"/></Card>
    </Page>;
  }

  const cpu = histo.map((h: any) => Number(h.cpuPct) || 0);
  const mem = histo.map((h: any) => Number(h.memPct) || 0);

  return (
    <Page title={s("page.host.title")} lede={s("page.host.lede")}>
      <Figs>
        <Fig icon="chip" label={s("fig.cpu")} value={Math.round(hostStats.cpuPct)} unit=" %"
          delta={`${hostStats.cores || "?"} cœurs · ${Number(hostStats.loadAvg || 0).toFixed(2)} de charge`}
          chart={cpu.length > 1 ? <FigChart data={cpu} tone={hostStats.cpuPct > 80 ? "alarm" : "accent"}/> : undefined}/>
        <Fig icon="server" tone="plain" label={s("fig.memory")} value={fmtOctets(hostStats.memUsedMB)}
          delta={`sur ${fmtOctets(hostStats.memTotalMB)}`}
          chart={mem.length > 1 ? <FigChart data={mem} tone="accent"/> : undefined}/>
        <Fig icon="switch" tone={hostStats.diskPct > 90 ? "warn" : undefined} label={s("fig.disk")}
          value={Math.round(hostStats.diskPct)} unit=" %"
          delta={hostStats.diskFreeGB != null ? `${Math.round(hostStats.diskFreeGB)} Gio libres` : "—"}/>
        <Fig icon="clock" label={s("fig.uptime")} value={fmtUptime(hostStats.uptimeSec)}
          delta={hostStats.tempC != null ? `${hostStats.tempC} °C` : "—"}/>
      </Figs>

      {/* La liste des conteneurs a été retirée d'ici.
          Cette page dit dans quel état est la machine — processeur, mémoire,
          disque, interfaces. Ce qui tourne dessus se pilote ailleurs, et
          l'afficher ici revenait à mettre un tableau de bord Docker dans un
          écran qui n'en est pas un. La collecte, elle, continue : le dock du
          mode atelier s'en sert encore. */}
      <Card title={s("card.ifaces")} note="de la machine" style={{ marginTop: 16 }}>
        <table>
          <thead><tr><th>{s("col.iface")}</th><th>{s("col.address")}</th><th>{s("col.role")}</th></tr></thead>
          <tbody>
            {(hostStats.interfaces || []).map((n: any) => (
              <tr key={n.name}>
                <td className="mono"><b style={{ fontWeight: 500 }}>{n.name}</b></td>
                <td className="mono">{n.address || n.ip || "—"}</td>
                <td className="dim">{n.role || (n.internal ? "boucle locale" : "balayage")}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {(hostStats.interfaces || []).length === 0 && <Empty text="Interfaces non remontées" icon="wired"/>}
        <Pad>
          <div style={{ color: "var(--muted)", fontSize: 12, lineHeight: 1.5 }}>{s("misc.scanIface")}</div>
        </Pad>
      </Card>

      <Card title={s("card.history")} note="60 dernières minutes" style={{ marginTop: 16 }}>
        <Pad>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 22, paddingTop: 8 }}>
            <div>
              <span className="lbl">processeur</span>
              {cpu.length > 1 ? <FigChart data={cpu} tone="accent" libre/> : <div className="dim">pas encore d'historique</div>}
            </div>
            <div>
              <span className="lbl">mémoire</span>
              {mem.length > 1 ? <FigChart data={mem} tone="accent" libre/> : <div className="dim">pas encore d'historique</div>}
            </div>
          </div>
        </Pad>
      </Card>
    </Page>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// INVENTAIRE
// ════════════════════════════════════════════════════════════════════════════
//
// L'inventaire n'a pas de contrepartie côté serveur : il vit dans le
// navigateur. C'est assumé et affiché — le jour où une route existe, seule la
// fonction de lecture/écriture ci-dessous change.

const CLE_INV = "mapmylan_inventaire";

type Ref = {
  id: string; nom: string; famille: string;
  specs: Record<string, string>;
  zone: string; pose: number; reserve: number; seuil: number;
};

const FAMILLES: { id: string; nom: string; icone: string; champs: [string, string][] }[] = [
  { id: "cable", nom: "Câble", icone: "wired", champs: [["categorie", "Catégorie"], ["longueur", "Longueur"], ["couleur", "Couleur"]] },
  { id: "module", nom: "Module optique", icone: "port", champs: [["debit", "Débit"], ["portee", "Portée"], ["connecteur", "Connecteur"]] },
  { id: "actif", nom: "Équipement actif", icone: "switch", champs: [["ports", "Ports"], ["alim", "Alimentation"]] },
  { id: "prise", nom: "Prise / goulotte", icone: "plug", champs: [["format", "Format"], ["montage", "Montage"]] },
  { id: "divers", nom: "Divers", icone: "unknown", champs: [["detail", "Détail"]] },
];

function lireInventaire(): Ref[] {
  try {
    const brut = localStorage.getItem(CLE_INV);
    return brut ? JSON.parse(brut) : [];
  } catch { return []; }
}
function ecrireInventaire(refs: Ref[]) {
  try { localStorage.setItem(CLE_INV, JSON.stringify(refs)); } catch { /* stockage refusé */ }
}

export function InventoryPage(_props: { t?: any }) {
  const s = useT();
  const [refs, setRefs] = useState<Ref[]>(() => lireInventaire());
  const [famille, setFamille] = useState("all");
  const [ouvert, setOuvert] = useState(false);
  const [form, setForm] = useState<any>({ nom: "", famille: "cable", zone: "", pose: 0, reserve: 0, seuil: 2, specs: {} });

  const sauver = (l: Ref[]) => { setRefs(l); ecrireInventaire(l); };

  const ajouter = () => {
    if (!form.nom.trim()) return;
    sauver([...refs, {
      ...form,
      id: `r${Date.now().toString(36)}`,
      pose: Number(form.pose) || 0,
      reserve: Number(form.reserve) || 0,
      seuil: Number(form.seuil) || 0,
    }]);
    setOuvert(false);
    setForm({ nom: "", famille: "cable", zone: "", pose: 0, reserve: 0, seuil: 2, specs: {} });
  };
  const bouger = (id: string, champ: "pose" | "reserve", delta: number) =>
    sauver(refs.map(r => r.id === id ? { ...r, [champ]: Math.max(0, r[champ] + delta) } : r));
  const supprimer = (r: Ref) => {
    if (!confirm(s("misc.confirmDelete", { name: r.nom }))) return;
    sauver(refs.filter(x => x.id !== r.id));
  };

  const listees = famille === "all" ? refs : refs.filter(r => r.famille === famille);
  const pose = refs.reduce((n, r) => n + r.pose, 0);
  const reserve = refs.reduce((n, r) => n + r.reserve, 0);
  const aCommander = refs.filter(r => r.reserve <= r.seuil);
  const zones = [...new Set(refs.map(r => r.zone).filter(Boolean))];
  const famDe = (id: string) => FAMILLES.find(f => f.id === id) || FAMILLES[FAMILLES.length - 1];

  return (
    <Page
      title={s("page.inventory.title")}
      lede={<>{s("page.inventory.lede")} Cet inventaire est enregistré dans ce navigateur, pas sur le serveur.</>}
      actions={<Btn solid icon="plus" onClick={() => setOuvert(o => !o)}>{s("act.addRef")}</Btn>}
    >
      <Figs>
        <Fig icon="devices" label={s("fig.refs")} value={refs.length} delta={`${zones.length} zone(s)`}/>
        <Fig icon="wired" tone="plain" label={s("fig.placed")} value={pose} delta="en service"/>
        <Fig icon="switch" label={s("fig.spare")} value={reserve} delta="disponibles"/>
        <Fig icon="alert" tone={aCommander.length ? "warn" : undefined} label={s("fig.restock")}
          value={aCommander.length} delta={aCommander[0]?.nom || "rien à commander"}/>
      </Figs>

      {ouvert && (
        <Card title="Nouvelle référence">
          <Pad>
            <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr 1fr", gap: 12 }}>
              <div><Lbl>{s("col.name")}</Lbl>
                <Field sans value={form.nom} placeholder="Cordon RJ45 2 m"
                  onChange={(e: any) => setForm({ ...form, nom: e.target.value })}/></div>
              <div><Lbl>Famille</Lbl>
                <select className="field" value={form.famille}
                  onChange={e => setForm({ ...form, famille: e.target.value, specs: {} })}>
                  {FAMILLES.map(f => <option key={f.id} value={f.id}>{f.nom}</option>)}
                </select></div>
              <div><Lbl>{s("col.zone")}</Lbl>
                <Field sans value={form.zone} placeholder="Baie, bureau…"
                  onChange={(e: any) => setForm({ ...form, zone: e.target.value })}/></div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12, marginTop: 12 }}>
              {famDe(form.famille).champs.map(([cle, nom]) => (
                <div key={cle}>
                  <Lbl>{nom}</Lbl>
                  <Field sans value={form.specs[cle] || ""}
                    onChange={(e: any) => setForm({ ...form, specs: { ...form.specs, [cle]: e.target.value } })}/>
                </div>
              ))}
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(3,110px) 1fr auto", gap: 12, marginTop: 12, alignItems: "end" }}>
              <div><Lbl>{s("col.placed")}</Lbl><Field type="number" value={form.pose} onChange={(e: any) => setForm({ ...form, pose: e.target.value })}/></div>
              <div><Lbl>{s("col.spare")}</Lbl><Field type="number" value={form.reserve} onChange={(e: any) => setForm({ ...form, reserve: e.target.value })}/></div>
              <div><Lbl>Seuil</Lbl><Field type="number" value={form.seuil} onChange={(e: any) => setForm({ ...form, seuil: e.target.value })}/></div>
              <span/>
              <Btn solid icon="check" onClick={ajouter}>{s("action.add")}</Btn>
            </div>
          </Pad>
        </Card>
      )}

      <Split cols="1fr 300px">
        <Card
          title="Références"
          head={
            <div className="filtres">
              <button className={famille === "all" ? "ftr on" : "ftr"} onClick={() => setFamille("all")}>{s("misc.all")}</button>
              {FAMILLES.map(f => (
                <button key={f.id} className={famille === f.id ? "ftr on" : "ftr"} onClick={() => setFamille(f.id)}>{f.nom}</button>
              ))}
            </div>
          }
        >
          <table>
            <thead><tr>
              <th>{s("col.ref")}</th><th>{s("col.specs")}</th><th>{s("col.zone")}</th>
              <th style={{ textAlign: "right" }}>{s("col.placed")}</th>
              <th style={{ textAlign: "right" }}>{s("col.spare")}</th>
              <th>{s("col.state")}</th><th/>
            </tr></thead>
            <tbody>
              {listees.map(r => {
                const f = famDe(r.famille);
                const bas = r.reserve <= r.seuil;
                return (
                  <tr key={r.id}>
                    <td>
                      <WhoCell icon={<Icon name={f.icone} size={15}/>} name={r.nom} sub={f.nom}/>
                    </td>
                    <td>
                      <div className="specs">
                        {Object.entries(r.specs || {}).filter(([, v]) => v).map(([k, v]) => (
                          <span className="sp" key={k}>{v}</span>
                        ))}
                      </div>
                    </td>
                    <td className="dim">{r.zone || "—"}</td>
                    <td className="mono" style={{ textAlign: "right" }}>
                      <button className="lnk" onClick={() => bouger(r.id, "pose", -1)}>−</button>
                      {r.pose}
                      <button className="lnk" onClick={() => bouger(r.id, "pose", 1)}>+</button>
                    </td>
                    <td className="mono" style={{ textAlign: "right" }}>
                      <button className="lnk" onClick={() => bouger(r.id, "reserve", -1)}>−</button>
                      {r.reserve}
                      <button className="lnk" onClick={() => bouger(r.id, "reserve", 1)}>+</button>
                    </td>
                    <td><Chip tone={bas ? "w" : "a"}>{bas ? "à recompléter" : "suffisant"}</Chip></td>
                    <td style={{ textAlign: "right" }}>
                      <button className="lnk" onClick={() => supprimer(r)}>✕</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {listees.length === 0 && <Empty text="Aucune référence" icon="switch"/>}
        </Card>

        <div>
          <Card title="Zones" note="regroupement" style={{ marginBottom: 16 }}>
            {zones.map(z => (
              <div className="zrow" key={z}>
                <span className="ivig"><Icon name="map" size={14}/></span>
                <span style={{ minWidth: 0, flex: 1 }}>
                  <b>{z}</b>
                  <small>{refs.filter(r => r.zone === z).length} référence(s)</small>
                </span>
              </div>
            ))}
            {zones.length === 0 && (
              <Pad><div style={{ color: "var(--muted)", fontSize: 12, lineHeight: 1.5, marginTop: 4 }}>
                Nomme une zone sur une référence et elle apparaîtra ici.
              </div></Pad>
            )}
          </Card>

          <Card title="À recompléter" note="sous le seuil">
            {aCommander.map(r => (
              <div className="zrow" key={r.id}>
                <span className="ivig"><Icon name="alert" size={14}/></span>
                <span style={{ minWidth: 0, flex: 1 }}>
                  <b>{r.nom}</b><small>{r.reserve} en réserve · seuil {r.seuil}</small>
                </span>
              </div>
            ))}
            {aCommander.length === 0 && (
              <Pad><div style={{ color: "var(--muted)", fontSize: 12, marginTop: 4 }}>Rien à commander.</div></Pad>
            )}
          </Card>
        </div>
      </Split>
    </Page>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// COMMANDES DU BOT
// ════════════════════════════════════════════════════════════════════════════

export function BotCommandsPage(_props: { t?: any }) {
  const s = useT();
  const [liste, setListe] = useState<any[]>([]);
  const [actions, setActions] = useState<any[]>([]);
  const [edition, setEdition] = useState<any | null>(null);
  const [reponse, setReponse] = useState<{ id: string; texte: string } | null>(null);

  const charger = async () => {
    const [l, a] = await Promise.all([api.listBotCommands(), api.getBotActions()]);
    setListe(l); setActions(a);
  };
  useEffect(() => { charger().catch(() => {}); }, []);

  const essayer = async (c: any) => {
    try { const r = await api.runBotCommand(c.id, []); setReponse({ id: c.id, texte: r.reply }); }
    catch (e: any) { setReponse({ id: c.id, texte: e.message }); }
  };
  const basculer = async (c: any, enabled: boolean) => { await api.updateBotCommand(c.id, { enabled }); charger(); };
  const supprimer = async (c: any) => {
    if (!confirm(s("misc.confirmDelete", { name: c.trigger }))) return;
    await api.deleteBotCommand(c.id); charger();
  };

  return (
    <Page title={s("page.bot.title")} lede={s("page.bot.lede")}
      actions={<Btn solid icon="plus" onClick={() => setEdition({
        isNew: true, trigger: "/", description: "", action: actions[0]?.id || "status",
        params: {}, enabled: true, confirm: false, allowedChatIds: [], cooldownSec: 0,
      })}>{s("act.newCommand")}</Btn>}>

      <Card title={s("card.commands")} note={`${liste.length} · ${actions.length} actions disponibles`}>
        {liste.map(c => {
          const a = actions.find((x: any) => x.id === c.action);
          return (
            <div key={c.id}>
              <div className="flowrow">
                <Toggle on={!!c.enabled} onChange={v => basculer(c, v)}/>
                <span className="cmd">{c.trigger}</span>
                <div>
                  <strong>{a?.label || c.action}</strong>
                  <div className="chain">
                    {c.description && <span>{c.description}</span>}
                    {c.confirm && <span className="ar">· confirmation exigée</span>}
                    {a?.destructive && <span style={{ color: "var(--alarm)" }}>· destructif</span>}
                    {c.cooldownSec > 0 && <span className="ar">· pause {c.cooldownSec} s</span>}
                  </div>
                </div>
                <div className="stat">
                  <b>{c.fireCount || 0} appel(s)</b>
                  <span style={{ display: "block", whiteSpace: "nowrap" }}>
                    <button className="lnk" onClick={() => essayer(c)}>{s("action.test")}</button>
                    <button className="lnk" onClick={() => setEdition({ ...c, isNew: false })}>{s("action.edit")}</button>
                    <button className="lnk" onClick={() => supprimer(c)}>{s("action.delete")}</button>
                  </span>
                </div>
              </div>
              {reponse?.id === c.id && (
                <Pad><div className="termbody" style={{ maxHeight: 160, borderRadius: 9, background: "var(--well)" }}
                  dangerouslySetInnerHTML={{ __html: reponse!.texte }}/></Pad>
              )}
            </div>
          );
        })}
        {liste.length === 0 && <Empty text="Aucune commande définie" icon="bot"/>}
      </Card>

      {edition && (
        <EditeurBot commande={edition} actions={actions}
          onClose={() => setEdition(null)}
          onSave={async (donnees: any) => {
            try {
              if (edition.isNew) await api.createBotCommand(donnees);
              else await api.updateBotCommand(edition.id, donnees);
              setEdition(null); await charger();
            } catch (e: any) { alert(e.message); }
          }}/>
      )}
    </Page>
  );
}

function EditeurBot({ commande, actions, onClose, onSave }: any) {
  const s = useT();
  const [trigger, setTrigger] = useState(commande.trigger || "/");
  const [description, setDescription] = useState(commande.description || "");
  const [action, setAction] = useState(commande.action || "status");
  const [params, setParams] = useState<any>(commande.params || {});
  const [enabled, setEnabled] = useState(commande.enabled !== false);
  const [confirmer, setConfirmer] = useState(commande.confirm === true);
  const [chats, setChats] = useState<string>((commande.allowedChatIds || []).join(", "));
  const [pause, setPause] = useState(commande.cooldownSec || 0);

  const sel = actions.find((a: any) => a.id === action);
  useEffect(() => { if (sel?.destructive) setConfirmer(true); }, [action]);

  return (
    <div className="feuille" onClick={onClose}>
      <div className="fcarte" onClick={e => e.stopPropagation()}>
        <div className="fhead">
          <div style={{ flex: 1 }}>
            <h2>{commande.isNew ? "Nouvelle commande" : commande.trigger}</h2>
            <p>déclenchée depuis la messagerie</p>
          </div>
          <button className="fx" onClick={onClose}>×</button>
        </div>
        <div className="fcorps">
          <div style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: 12 }}>
            <div><Lbl>Appel</Lbl><Field value={trigger} onChange={(e: any) => setTrigger(e.target.value)}/></div>
            <div><Lbl>Description</Lbl><Field sans value={description} onChange={(e: any) => setDescription(e.target.value)}/></div>
          </div>

          <div style={{ marginTop: 14 }}>
            <Lbl>Action</Lbl>
            <select className="field" value={action} onChange={e => setAction(e.target.value)}>
              {actions.map((a: any) => (
                <option key={a.id} value={a.id}>{a.destructive ? "⚠ " : ""}{a.label} — {a.id}</option>
              ))}
            </select>
            {sel?.destructive && (
              <div style={{ marginTop: 10 }}><Note tone="warn">Action destructrice : la confirmation est imposée.</Note></div>
            )}
          </div>

          {(sel?.params || []).filter((p: any) => p.fromConfig).map((p: any) => (
            <div key={p.name} style={{ marginTop: 14 }}>
              <Lbl>{p.name}{p.required ? " *" : ""}</Lbl>
              <Field value={params[p.name] || ""} onChange={(e: any) => setParams({ ...params, [p.name]: e.target.value })}/>
            </div>
          ))}

          <div style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: 12, marginTop: 14 }}>
            <div><Lbl>Pause (s)</Lbl>
              <Field type="number" value={pause} onChange={(e: any) => setPause(parseInt(e.target.value) || 0)}/></div>
            <div><Lbl>Discussions autorisées</Lbl>
              <Field value={chats} placeholder="vide = discussion principale"
                onChange={(e: any) => setChats(e.target.value)}/></div>
          </div>

          <div style={{ display: "flex", gap: 22, marginTop: 16 }}>
            <span style={{ display: "flex", alignItems: "center", gap: 9, fontSize: 12.5, color: "var(--muted)" }}>
              <Toggle on={enabled} onChange={setEnabled}/> active
            </span>
            <span style={{ display: "flex", alignItems: "center", gap: 9, fontSize: 12.5, color: "var(--muted)" }}>
              <Toggle on={confirmer} onChange={v => !sel?.destructive && setConfirmer(v)}/> confirmation
            </span>
          </div>

          <div className="fboutons">
            <Btn onClick={onClose}>{s("action.cancel")}</Btn>
            <Btn solid icon="check" onClick={() => {
              if (!trigger || trigger === "/") return alert("Donne un appel, par exemple /etat");
              onSave({
                trigger, description, action, params, enabled, confirm: confirmer,
                allowedChatIds: chats.split(",").map(x => x.trim()).filter(Boolean),
                cooldownSec: pause || 0,
              });
            }}>{s("action.save")}</Btn>
          </div>
        </div>
      </div>
    </div>
  );
}
