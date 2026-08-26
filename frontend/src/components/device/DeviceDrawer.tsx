// Fiche d'appareil.
//
// Panneau glissant depuis la droite, à l'image de la maquette : une plaque de
// tête avec la photo, quatre compteurs, puis les sections — identité, défense,
// interfaces, fusion, ports, failles, historique.
//
// Rien n'a changé côté données : ce sont les mêmes routes qu'avant. Seule la
// photo est une nouveauté, et elle vit dans ce navigateur (voir plus bas).

import { useEffect, useState } from "react";
import { useStore } from "../../stores/app";
import { api } from "../../api/client";
import { composer, partieHote, verifier, type Plage } from "../../lib/adresses";
import { Theme } from "../../lib/themes";
import { Icon, deviceIcon } from "../../lib/icons";
import { useT } from "../../lib/i18n";
import { DevicePhoto } from "./DevicePhoto";

interface Props { theme: Theme; }

// Catalogue des types proposés à la main. La valeur est ce qui est enregistré
// dans customType ; c'est elle qui choisit le picto partout ailleurs.
const TYPES = [
  ["router", "Passerelle"], ["switch", "Commutateur"], ["ap", "Borne sans fil"],
  ["firewall", "Pare-feu"], ["server", "Serveur"], ["nas", "Stockage"],
  ["computer", "Ordinateur"], ["laptop", "Portable"], ["phone", "Téléphone"],
  ["tablet", "Tablette"], ["printer", "Imprimante"], ["camera", "Caméra"],
  ["tv", "Téléviseur"], ["console", "Console"], ["iot", "Objet connecté"],
  ["sensor", "Capteur"], ["pi", "Nano-ordinateur"], ["vm", "Machine virtuelle"],
  ["docker", "Conteneur"], ["unknown", "Inconnu"],
];

// Conservé : d'autres écrans importaient cette table.
export const TYPE_EMOJI: Record<string, string> = {
  router: "🌐", switch: "🔀", ap: "📡", firewall: "🛡", server: "🖥️",
  laptop: "💻", phone: "📱", tablet: "📱", printer: "🖨", camera: "📷",
  tv: "📺", console: "🎮", iot: "⚡", sensor: "🌡", vm: "📦",
  container: "🐳", unknown: "❓",
};

const FABRICANTS = [
  "Apple", "Samsung", "Xiaomi", "Huawei", "Google", "Microsoft", "Intel",
  "Cisco", "MikroTik", "Ubiquiti", "TP-Link", "Asus", "Netgear", "D-Link",
  "Synology", "QNAP", "HP", "Dell", "Lenovo", "Raspberry Pi", "Espressif",
  "Sonoff", "Shelly", "Sonos", "Philips Hue", "VMware", "Proxmox",
];

const ETATS: Record<string, string> = {
  online: "en ligne", offline: "hors ligne", suspect: "suspect",
  banned: "bloqué", quarantined: "isolé",
};

// La photo n'a pas de colonne côté serveur : elle est gardée dans ce
// navigateur, sous une clé par appareil. Le jour où le serveur en accepte une,
// seules ces deux fonctions changent.
const clePhoto = (id: string) => `mapmylan_photo_${id}`;
function lirePhoto(id: string): string | null {
  try { return localStorage.getItem(clePhoto(id)); } catch { return null; }
}
function ecrirePhoto(id: string, url: string | null) {
  try {
    if (url) localStorage.setItem(clePhoto(id), url);
    else localStorage.removeItem(clePhoto(id));
  } catch { /* stockage plein ou refusé : la photo reste à l'écran, sans plus */ }
}

export function DeviceDrawer({ theme: t }: Props) {
  const s = useT();
  const id = useStore((st) => st.selectedDeviceId);
  // Les segments relevés sur l'équipement : le VLAN se choisit dedans, il ne
  // se tape pas. Un numéro saisi à la main est un numéro qu'on peut inventer.
  const vlans = useStore((st) => st.vlans);
  const fermer = () => useStore.getState().selectDevice(null);

  const [appareil, setAppareil] = useState<any>(null);
  const [histo, setHisto] = useState<any[]>([]);
  const [edition, setEdition] = useState(false);
  const [form, setForm] = useState<any>({});
  const [occupe, setOccupe] = useState(false);
  const [message, setMessage] = useState("");
  const [photo, setPhoto] = useState<string | null>(null);

  useEffect(() => {
    if (!id) { setAppareil(null); return; }
    setPhoto(lirePhoto(id));
    Promise.all([api.getDevice(id), api.deviceHistory(id)])
      .then(([d, h]) => {
        setAppareil(d);
        setHisto(h || []);
        setForm({
          customName: d.customName || "", customType: d.customType || "",
          vendor: d.vendor || "", model: d.model || "",
          vlan: d.vlan ?? "", zone: d.zone || "", role: d.role || "",
          notes: d.notes || "", tags: (d.tags || []).join(", "),
        });
      })
      .catch(() => {});
  }, [id]);

  if (!id) return null;

  if (!appareil) {
    return (
      <div className="feuille" onClick={fermer}>
        <div className="fcarte" onClick={(e) => e.stopPropagation()}>
          <div className="fcorps" style={{ paddingTop: 30, color: "var(--muted)", fontFamily: "var(--mono)", fontSize: 12.5 }}>
            {s("misc.loading")}
          </div>
        </div>
      </div>
    );
  }

  const rafraichir = async () => setAppareil(await api.getDevice(id));

  const enregistrer = async () => {
    const donnees: any = { ...form };
    donnees.tags = String(form.tags || "").split(",").map((x: string) => x.trim()).filter(Boolean);
    donnees.vlan = form.vlan === "" || form.vlan == null ? null : parseInt(String(form.vlan), 10);
    await api.updateDevice(id, donnees);
    await rafraichir();
    setEdition(false);
  };

  const agir = async (libelle: string, fn: () => Promise<any>) => {
    setOccupe(true); setMessage("");
    try {
      const r = await fn();
      const detail = r?.output ? `\n${String(r.output).trim().slice(0, 800)}` : "";
      setMessage(`${libelle}${detail}`);
      await rafraichir();
      await useStore.getState().refreshDevices();
    } catch (e: any) {
      setMessage(`Échec : ${e.message}`);
    } finally { setOccupe(false); }
  };

  const supprimerFiche = async () => {
    const present = appareil.status !== "offline";
    const texte = present
      ? `Supprimer ${nom} ? Il est encore en ligne : le prochain balayage le recréera, sans son historique ni ce que tu as saisi.`
      : `Supprimer ${nom} ? Son historique et les champs saisis à la main disparaissent avec la fiche.`;
    if (!confirm(texte)) return;
    setOccupe(true);
    try {
      await api.deleteDevice(id);
      await useStore.getState().refreshDevices();
      fermer();
    } catch (e: any) {
      setMessage(`Échec : ${e.message}`);
    } finally { setOccupe(false); }
  };

  const nom = appareil.customName || appareil.hostname || appareil.ip;
  const dangereux = appareil.dangerScore > 70;
  const ports = appareil.ports || [];
  const failles = appareil.cves || [];

  return (
    <div className="feuille" onClick={fermer}>
      <div className="fcarte" style={{ width: 520 }} onClick={(e) => e.stopPropagation()}>

        {/* ─── Tête ─────────────────────────────────────────────────── */}
        <div className="fhead">
          <span className={dangereux ? "ivig gros" : "ivig gros"}
            style={dangereux ? { background: "var(--alarm-wash)", color: "var(--alarm)" } : undefined}>
            {photo
              ? <img src={photo} alt="" style={{ width: "100%", height: "100%", objectFit: "contain" }}/>
              : <Icon name={deviceIcon(appareil.customType || appareil.type)} size={22}/>}
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2>{nom}</h2>
            <p className="mono">{appareil.ip} · {appareil.mac || "sans MAC"} · {appareil.vendor || "fabricant inconnu"}</p>
          </div>
          <span className={`chip ${appareil.status === "online" ? "a" : appareil.status === "offline" ? "" : "w"}`}>
            {ETATS[appareil.status] || appareil.status}
          </span>
          <button className="fx" onClick={fermer}>×</button>
        </div>

        <div className="fcorps">

          {/* ─── Quatre compteurs ───────────────────────────────────── */}
          <div className="fcompte">
            <div><span>Risque</span><b style={dangereux ? { color: "var(--alarm)" } : undefined}>{Math.round(appareil.dangerScore || 0)}</b></div>
            <div><span>Confiance</span><b>{Math.round(appareil.trustScore || 0)}</b></div>
            <div><span>Ports</span><b>{ports.length}</b></div>
            <div><span>Failles</span><b style={failles.length ? { color: "var(--alarm)" } : undefined}>{failles.length}</b></div>
          </div>

          {/* ─── Jauges ─────────────────────────────────────────────── */}
          <div className="ftitre">Profil</div>
          <Jauge libelle="Confiance" valeur={appareil.trustScore} teinte="var(--accent)"/>
          <Jauge libelle="Activité" valeur={appareil.activityScore} teinte="var(--warn)"/>
          <Jauge libelle="Vulnérabilité" valeur={appareil.vulnScore} teinte="var(--warn)"/>
          <Jauge libelle="Danger" valeur={appareil.dangerScore} teinte={dangereux ? "var(--alarm)" : "var(--ink-soft)"} fort/>

          {appareil.scoreReasons && (
            <details style={{ marginTop: 10 }}>
              <summary style={{ cursor: "pointer", color: "var(--muted)", fontSize: 11.5, fontFamily: "var(--mono)" }}>
                Comment cette note est faite
              </summary>
              <div style={{ marginTop: 8 }}>
                {["trust", "activity", "vuln"].map((k) => {
                  const liste = appareil.scoreReasons[k] || [];
                  if (!liste.length) return null;
                  return (
                    <div key={k} style={{ marginBottom: 8 }}>
                      <div className="lbl">{k === "trust" ? "confiance" : k === "activity" ? "activité" : "vulnérabilité"}</div>
                      {liste.map((r: any, i: number) => (
                        <div className="fl" key={i}>
                          <span>{r.reason}</span>
                          <b style={{ color: r.delta > 0 ? "var(--warn)" : "var(--accent)" }}>
                            {r.delta > 0 ? "+" : ""}{r.delta}
                          </b>
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>
            </details>
          )}

          {/* ─── Photo ──────────────────────────────────────────────── */}
          {/* Le composant porte déjà son propre intertitre. */}
          <div style={{ marginTop: 22 }}/>
          <DevicePhoto t={t} valeur={photo} onChange={(url) => { setPhoto(url); ecrirePhoto(id, url); }}/>
          <div style={{ color: "var(--faint)", fontSize: 11, marginTop: 6, lineHeight: 1.5 }}>
            La photo est enregistrée dans ce navigateur, pas sur le serveur.
          </div>

          {/* ─── Identité ───────────────────────────────────────────── */}
          <div className="ftitre" style={{ marginTop: 22, display: "flex", alignItems: "center" }}>
            Identité
            <button className="lnk" style={{ marginLeft: "auto", textTransform: "none", letterSpacing: 0 }}
              onClick={() => setEdition(!edition)}>
              {edition ? "annuler" : "modifier"}
            </button>
          </div>

          {!edition ? (
            <>
              <Ligne k="Adresse" v={appareil.ip} mono/>
              <Ligne k="MAC" v={appareil.mac || "—"} mono/>
              <Ligne k="Nom relevé" v={appareil.hostname || "—"}/>
              <Ligne k="Nom donné" v={appareil.customName || "—"}/>
              <Ligne k="Fabricant" v={appareil.vendor || "—"}/>
              <Ligne k="Modèle" v={appareil.model || "—"}/>
              <Ligne k="Système" v={appareil.os || "—"}/>
              <Ligne k="Type" v={appareil.customType || appareil.type}/>
              <Ligne k="VLAN" mono v={(() => {
                if (appareil.vlan == null) return "—";
                const v = vlans.find((x: any) => x.id === appareil.vlan);
                return v ? `${v.id} · ${v.name}` : String(appareil.vlan);
              })()}/>
              <Ligne k="Zone" v={appareil.zone || "—"}/>
              <Ligne k="Rôle" v={appareil.role || "—"}/>
              <Ligne k="Étiquettes" v={(appareil.tags || []).join(", ") || "—"}/>
              <Ligne k="Vu la première fois" v={new Date(appareil.firstSeen).toLocaleString()} mono/>
              <Ligne k="Vu la dernière fois" v={new Date(appareil.lastSeen).toLocaleString()} mono/>
              {appareil.notes && (
                <div style={{ marginTop: 12 }}>
                  <div className="lbl">Notes</div>
                  <div style={{ background: "var(--well)", borderRadius: 9, padding: "10px 12px", fontSize: 12.5, whiteSpace: "pre-wrap" }}>
                    {appareil.notes}
                  </div>
                </div>
              )}
            </>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div>
                <label className="lbl">Nom donné</label>
                <input className="field sans" value={form.customName}
                  onChange={(e) => setForm({ ...form, customName: e.target.value })}/>
              </div>
              <div>
                <label className="lbl">Type</label>
                <select className="field" value={form.customType || ""}
                  onChange={(e) => setForm({ ...form, customType: e.target.value })}>
                  <option value="">automatique ({appareil.type})</option>
                  {TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </div>
              <div>
                <label className="lbl">Fabricant</label>
                <input className="field sans" list="fabricants" value={form.vendor}
                  onChange={(e) => setForm({ ...form, vendor: e.target.value })}/>
                <datalist id="fabricants">{FABRICANTS.map(v => <option key={v} value={v}/>)}</datalist>
              </div>
              <div>
                <label className="lbl">Modèle</label>
                <input className="field sans" value={form.model}
                  onChange={(e) => setForm({ ...form, model: e.target.value })}/>
              </div>
              <div style={{ minWidth: 0 }}>
                <label className="lbl">VLAN</label>
                <select className="field" style={{ width: "100%" }} value={String(form.vlan ?? "")}
                  onChange={(e) => setForm({ ...form, vlan: e.target.value })}>
                  <option value="">— aucun —</option>
                  {vlans.map((v: any) => (
                    <option key={v.id} value={String(v.id)}>VLAN {v.id} · {v.name}</option>
                  ))}
                  {/* Un numéro posé à la main avant le relevé ne doit pas
                      disparaître de la liste sous prétexte que l'équipement ne
                      le déclare pas : on le garde, et on le dit. */}
                  {form.vlan !== "" && form.vlan != null &&
                   !vlans.some((v: any) => String(v.id) === String(form.vlan)) && (
                    <option value={String(form.vlan)}>VLAN {form.vlan} · hors relevé</option>
                  )}
                </select>
              </div>
              <div>
                <label className="lbl">Zone</label>
                <input className="field sans" value={form.zone}
                  onChange={(e) => setForm({ ...form, zone: e.target.value })}/>
              </div>
              <div>
                <label className="lbl">Rôle</label>
                <input className="field sans" value={form.role}
                  onChange={(e) => setForm({ ...form, role: e.target.value })}/>
              </div>
              <div>
                <label className="lbl">Étiquettes</label>
                <input className="field sans" value={form.tags} placeholder="séparées par des virgules"
                  onChange={(e) => setForm({ ...form, tags: e.target.value })}/>
              </div>
              <div style={{ gridColumn: "1 / -1" }}>
                <label className="lbl">Notes</label>
                <textarea className="field sans" rows={3} value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}/>
              </div>
              <div style={{ gridColumn: "1 / -1", display: "flex", justifyContent: "flex-end", gap: 9 }}>
                <button className="btn" onClick={() => setEdition(false)}>{s("action.cancel")}</button>
                <button className="btn solid" onClick={enregistrer}>{s("action.save")}</button>
              </div>
            </div>
          )}

          {/* ─── Adresse ────────────────────────────────────────────── */}
          <div className="ftitre" style={{ marginTop: 22 }}>Adresse</div>
          <Adresse appareil={appareil} onChange={async () => {
            await rafraichir();
            await useStore.getState().refreshDevices();
          }}/>

          {/* ─── Défense ────────────────────────────────────────────── */}
          <div className="ftitre" style={{ marginTop: 22 }}>Défense</div>
          {appareil.isMainRouter ? (
            <div className="note info">
              <Icon name="shield" size={15} style={{ flex: "none", marginTop: 1 }}/>
              <span>L'équipement principal est protégé : aucune action de défense ne lui est applicable.</span>
            </div>
          ) : (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 9 }}>
              <button className="btn" disabled={occupe}
                onClick={() => agir("Appareil isolé.", () => api.quarantineDevice(id))}>
                <Icon name="alert" size={14}/>Isoler
              </button>
              <button className="btn" disabled={occupe}
                onClick={() => agir("Appareil bloqué.", () => api.banDevice(id))}>
                <Icon name="ban" size={14}/>Bloquer
              </button>
              {(appareil.status === "banned" || appareil.status === "quarantined") && (
                <button className="btn solid" disabled={occupe}
                  onClick={() => agir("Accès rendu.", () => api.unbanDevice(id))}>
                  <Icon name="check" size={14}/>Rendre l'accès
                </button>
              )}
              <button className="btn" disabled={occupe}
                onClick={() => agir("Liste blanche mise à jour.", () => api.updateDevice(id, { whitelisted: !appareil.whitelisted }))}>
                <Icon name="shield" size={14}/>{appareil.whitelisted ? "Retirer de la liste blanche" : "Liste blanche"}
              </button>
              <button className="btn" disabled={occupe}
                onClick={() => agir("Note recalculée.", () => api.scoreDevice(id))}>
                <Icon name="refresh" size={14}/>Recalculer la note
              </button>
              <button className="btn" disabled={occupe}
                onClick={() => agir("Balayage approfondi lancé.", () => api.deepScan(id))}>
                <Icon name="search" size={14}/>Balayage approfondi
              </button>
            </div>
          )}
          {message && (
            <pre style={{
              marginTop: 12, padding: "10px 12px", borderRadius: 9, background: "var(--well)",
              fontFamily: "var(--mono)", fontSize: 11, color: message.startsWith("Échec") ? "var(--alarm)" : "var(--ink-soft)",
              whiteSpace: "pre-wrap", maxHeight: 200, overflow: "auto",
            }}>{message}</pre>
          )}

          {/* ─── Interfaces ─────────────────────────────────────────── */}
          <Interfaces appareil={appareil} onChange={rafraichir}/>

          {/* ─── Fusion ─────────────────────────────────────────────── */}
          <Fusion appareil={appareil} onFusion={rafraichir}/>

          {/* ─── Ports ──────────────────────────────────────────────── */}
          {ports.length > 0 && (
            <>
              <div className="ftitre" style={{ marginTop: 22 }}>Ports ouverts · {ports.length}</div>
              <table>
                <thead><tr><th>Port</th><th>Protocole</th><th>Service</th><th>Version</th></tr></thead>
                <tbody>
                  {ports.map((p: any, i: number) => (
                    <tr key={p.id || i}>
                      <td className="mono"><b style={{ fontWeight: 500 }}>{p.port}</b></td>
                      <td className="dim mono">{p.protocol || p.proto || "tcp"}</td>
                      <td>{p.service || "—"}</td>
                      <td className="dim">{[p.product, p.version].filter(Boolean).join(" ") || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}

          {/* ─── Failles ────────────────────────────────────────────── */}
          {failles.length > 0 && (
            <>
              <div className="ftitre" style={{ marginTop: 22 }}>Failles · {failles.length}</div>
              {failles.map((c: any, i: number) => (
                <div key={c.id || i} style={{
                  background: "var(--alarm-wash)", borderRadius: 9, padding: "10px 12px", marginBottom: 8,
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                    <b className="mono" style={{ fontSize: 12.5 }}>{c.cveId}</b>
                    <span className="chip w" style={{ marginLeft: "auto" }}>CVSS {c.cvss}</span>
                  </div>
                  <div style={{ color: "var(--ink-soft)", fontSize: 12, marginTop: 5, lineHeight: 1.5 }}>{c.description}</div>
                  {c.service && <div className="mono" style={{ color: "var(--muted)", fontSize: 11, marginTop: 4 }}>{c.service}</div>}
                </div>
              ))}
            </>
          )}

          {/* ─── Historique ─────────────────────────────────────────── */}
          <div className="ftitre" style={{ marginTop: 22 }}>Historique</div>
          {histo.length === 0 && <div style={{ color: "var(--faint)", fontSize: 12 }}>Rien d'enregistré pour l'instant.</div>}
          {histo.map((h: any) => (
            <div className="fl" key={h.id}>
              <span className="mono" style={{ fontSize: 11 }}>{new Date(h.createdAt).toLocaleString()}</span>
              <b style={{ fontWeight: 400, textAlign: "right" }}>{h.event} — {resume(h.data)}</b>
            </div>
          ))}

          {/* ─── Suppression ────────────────────────────────────────────── */}
          {!appareil.isMainRouter && (
            <>
              <div className="ftitre" style={{ marginTop: 26 }}>Supprimer</div>
              <div style={{ color: "var(--muted)", fontSize: 12.5, lineHeight: 1.55 }}>
                {appareil.status === "offline"
                  ? "Cet hôte ne répond plus. Sa fiche peut être effacée : son historique et les champs saisis à la main partent avec elle."
                  : "Cet hôte est encore en ligne. Effacer sa fiche ne l'empêche pas de revenir au prochain balayage — mais l'historique et ce que tu as saisi seront perdus."}
              </div>
              <div className="fboutons">
                <button className="btn" disabled={occupe} onClick={supprimerFiche}
                  style={{ color: "var(--alarm)" }}>
                  <Icon name="ban" size={14}/>Supprimer la fiche
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Briques ───────────────────────────────────────────────────────────────

function Ligne({ k, v, mono }: { k: string; v: any; mono?: boolean }) {
  return (
    <div className="fl">
      <span>{k}</span>
      <b className={mono ? "mono" : undefined} style={mono ? { fontSize: 12 } : undefined}>{v}</b>
    </div>
  );
}

function Jauge({ libelle, valeur, teinte, fort }: { libelle: string; valeur: number; teinte: string; fort?: boolean }) {
  const v = Math.max(0, Math.min(100, Math.round(valeur ?? 0)));
  return (
    <div style={{ marginBottom: fort ? 4 : 10, paddingTop: fort ? 10 : 0, borderTop: fort ? "1px solid var(--hair-soft)" : undefined }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
        <span style={{ fontSize: 12.5, color: fort ? "var(--ink)" : "var(--muted)", fontWeight: fort ? 500 : 400 }}>{libelle}</span>
        <span className="mono" style={{ fontSize: 11.5, color: teinte }}>{v}/100</span>
      </div>
      <div style={{ height: fort ? 5 : 3, background: "var(--well)", borderRadius: 4, overflow: "hidden" }}>
        <div style={{ width: `${v}%`, height: "100%", background: teinte, transition: "width .6s ease" }}/>
      </div>
    </div>
  );
}

function resume(data: any): string {
  if (!data) return "";
  if (data.action) return `${data.action}${data.reason ? ` (${data.reason})` : ""}`;
  if (data.from && data.to) return `${data.from} → ${data.to}`;
  if (data.changes) return `champs modifiés : ${Object.keys(data.changes).join(", ")}`;
  if (data.ip) return `${data.ip}${data.vendor ? `, ${data.vendor}` : ""}`;
  return JSON.stringify(data).slice(0, 80);
}

// ─── Interfaces réseau ─────────────────────────────────────────────────────

function Interfaces({ appareil, onChange }: { appareil: any; onChange: () => Promise<void> }) {
  const [ouvert, setOuvert] = useState(false);
  const [form, setForm] = useState<any>({ mac: "", ip: "", type: "ethernet", label: "" });
  const liste = appareil.interfaces || [];

  // La carte principale n'est pas toujours dans la table : on la reconstitue
  // pour que la fiche montre bien toutes les faces de l'appareil.
  const principale = appareil.mac && !liste.find((i: any) => i.mac === appareil.mac)
    ? { id: "_principale", mac: appareil.mac, ip: appareil.ip, type: "ethernet", label: "principale", _virtuelle: true }
    : null;
  const toutes = principale ? [principale, ...liste] : liste;

  const ajouter = async () => {
    try {
      await api.addInterface(appareil.id, {
        mac: form.mac || null, ip: form.ip || null,
        type: form.type, label: form.label || null,
      });
      setOuvert(false);
      setForm({ mac: "", ip: "", type: "ethernet", label: "" });
      await onChange();
    } catch (e: any) { alert(e.message); }
  };
  const retirer = async (ifaceId: string) => {
    if (!confirm("Retirer cette interface ?")) return;
    try { await api.deleteInterface(appareil.id, ifaceId); await onChange(); }
    catch (e: any) { alert(e.message); }
  };

  return (
    <>
      <div className="ftitre" style={{ marginTop: 22, display: "flex", alignItems: "center" }}>
        Interfaces · {toutes.length}
        <button className="lnk" style={{ marginLeft: "auto", textTransform: "none", letterSpacing: 0 }}
          onClick={() => setOuvert(!ouvert)}>{ouvert ? "annuler" : "ajouter"}</button>
      </div>

      {toutes.length === 0 && (
        <div style={{ color: "var(--faint)", fontSize: 12, lineHeight: 1.5 }}>
          Aucune interface déclarée. En ajouter une permet de suivre un appareil
          qui a plusieurs faces — filaire et sans fil, par exemple.
        </div>
      )}

      {toutes.map((i: any) => (
        <div className="zrow" key={i.id} style={{ paddingLeft: 0, paddingRight: 0 }}>
          <span className="ivig"><Icon name={i.type === "wifi" ? "air" : i.type === "virtual" ? "server" : "wired"} size={14}/></span>
          <span style={{ minWidth: 0, flex: 1 }}>
            <b>{i.label || i.type}</b>
            <small>{i.mac || "sans MAC"} · {i.ip || "sans adresse"}</small>
          </span>
          {i._virtuelle
            ? <span className="chip a">principale</span>
            : <button className="lnk" onClick={() => retirer(i.id)}>retirer</button>}
        </div>
      ))}

      {ouvert && (
        <div style={{ background: "var(--well)", borderRadius: 9, padding: 12, marginTop: 10, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <div>
            <label className="lbl">Type</label>
            <select className="field" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
              <option value="ethernet">filaire</option>
              <option value="wifi">sans fil</option>
              <option value="virtual">virtuelle</option>
              <option value="other">autre</option>
            </select>
          </div>
          <div>
            <label className="lbl">Nom</label>
            <input className="field" value={form.label} placeholder="eth0, wlan0…"
              onChange={(e) => setForm({ ...form, label: e.target.value })}/>
          </div>
          <div>
            <label className="lbl">MAC</label>
            <input className="field" value={form.mac} placeholder="aa:bb:cc:dd:ee:ff"
              onChange={(e) => setForm({ ...form, mac: e.target.value })}/>
          </div>
          <div>
            <label className="lbl">Adresse</label>
            <input className="field" value={form.ip} placeholder="192.0.2.10"
              onChange={(e) => setForm({ ...form, ip: e.target.value })}/>
          </div>
          <div style={{ gridColumn: "1 / -1", display: "flex", justifyContent: "flex-end" }}>
            <button className="btn solid" onClick={ajouter}>Ajouter</button>
          </div>
        </div>
      )}
    </>
  );
}

// ─── Fusion de deux relevés ────────────────────────────────────────────────

function Fusion({ appareil, onFusion }: { appareil: any; onFusion: () => Promise<void> }) {
  const tous = useStore((s) => s.devices);
  const [ouvert, setOuvert] = useState(false);
  const [filtre, setFiltre] = useState("");
  const [occupe, setOccupe] = useState(false);

  const candidats = tous.filter((d: any) => d.id !== appareil.id && !d.isMainRouter && (
    !filtre || [d.ip, d.mac, d.hostname, d.customName, d.vendor].filter(Boolean)
      .some((v: any) => String(v).toLowerCase().includes(filtre.toLowerCase()))
  ));

  const fusionner = async (sourceId: string, libelle: string) => {
    if (!confirm(`Absorber « ${libelle} » dans cet appareil ? Sa MAC deviendra une interface d'ici, et l'autre fiche disparaîtra.`)) return;
    setOccupe(true);
    try {
      await api.mergeDevices(appareil.id, sourceId);
      await useStore.getState().refreshDevices();
      await onFusion();
      setOuvert(false);
    } catch (e: any) { alert(e.message); }
    finally { setOccupe(false); }
  };

  return (
    <>
      <div className="ftitre" style={{ marginTop: 22, display: "flex", alignItems: "center" }}>
        Même machine ?
        <button className="lnk" style={{ marginLeft: "auto", textTransform: "none", letterSpacing: 0 }}
          onClick={() => setOuvert(!ouvert)}>{ouvert ? "annuler" : "fusionner…"}</button>
      </div>

      {ouvert && (
        <>
          <div style={{ color: "var(--muted)", fontSize: 12, lineHeight: 1.55, marginBottom: 10 }}>
            Choisis l'autre relevé qui désigne en réalité la même machine — la face
            sans fil du même portable, par exemple. Sa MAC et son historique
            viennent ici, et le doublon disparaît.
          </div>
          <input className="field sans" placeholder="filtrer…" value={filtre}
            onChange={(e) => setFiltre(e.target.value)}/>
          <div style={{ maxHeight: 240, overflowY: "auto", marginTop: 10 }}>
            {candidats.slice(0, 30).map((d: any) => (
              <div className="zrow" key={d.id} role="button" tabIndex={0}
                style={{ cursor: occupe ? "wait" : "pointer", paddingLeft: 0, paddingRight: 0, opacity: occupe ? .5 : 1 }}
                onClick={() => !occupe && fusionner(d.id, d.customName || d.hostname || d.ip)}
                onKeyDown={(e) => e.key === "Enter" && !occupe && fusionner(d.id, d.customName || d.hostname || d.ip)}>
                <span className="ivig"><Icon name={deviceIcon(d.customType || d.type)} size={14}/></span>
                <span style={{ minWidth: 0, flex: 1 }}>
                  <b>{d.customName || d.hostname || d.ip}</b>
                  <small>{d.ip} · {d.mac || "sans MAC"} · {d.vendor || "?"}</small>
                </span>
                <Icon name="pair" size={15} style={{ color: "var(--accent)" }}/>
              </div>
            ))}
            {candidats.length === 0 && (
              <div style={{ padding: 16, textAlign: "center", color: "var(--faint)", fontSize: 12 }}>
                Aucun candidat
              </div>
            )}
          </div>
        </>
      )}
    </>
  );
}


/**
 * Adresse réservée pour cet appareil.
 *
 * Ce que cet écran fait, dit sans détour : il ne va pas réécrire la
 * configuration réseau de la machine — personne ne peut faire ça à distance
 * sans agent. Il demande à la passerelle de toujours servir cette adresse-là à
 * cette carte réseau. L'appareil la prendra à son prochain bail.
 *
 * Le VLAN se choisit dans une liste, et c'est lui qui décide du début de
 * l'adresse : le masque fige les premiers octets, on les affiche sans les
 * rendre modifiables, et il ne reste que la fin à écrire.
 */
function Adresse({ appareil, onChange }: { appareil: any; onChange: () => Promise<void> }) {
  const [etat, setEtat] = useState<any>(null);
  const [vlan, setVlan] = useState<number | null>(null);
  const [hote, setHote] = useState("");
  const [occupe, setOccupe] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; texte: string } | null>(null);

  useEffect(() => {
    let vivant = true;
    api.deviceReservation(appareil.id)
      .then((r) => {
        if (!vivant) return;
        setEtat(r);
        // On ouvre sur le segment où l'appareil se trouve déjà : c'est le cas
        // de loin le plus fréquent, et ça évite un clic pour ne rien changer.
        const actuel = (r.segments || []).find((sg: any) =>
          sg.plage && appareil.ip && partieHote(appareil.ip, sg.plage.octetsFiges) &&
          sg.plage.prefixe && String(appareil.ip).startsWith(sg.plage.prefixe + "."));
        const choisi = actuel || (r.segments || []).find((sg: any) => sg.id === r.vlan) || null;
        if (choisi) {
          setVlan(choisi.id);
          setHote(actuel ? partieHote(appareil.ip, choisi.plage.octetsFiges) : "");
        }
      })
      .catch(() => { if (vivant) setEtat({ segments: [] }); });
    return () => { vivant = false; };
  }, [appareil.id]);

  const segments: any[] = etat?.segments || [];
  const segment = segments.find((sg) => sg.id === vlan) || null;
  const plage: Plage | null = segment?.plage || null;
  const prefixe = plage?.prefixe || "";
  const ip = composer(prefixe, hote);
  const controle = hote.trim() ? verifier(ip, plage, segment?.passerelle) : { ok: false };

  const changerVlan = (id: number | null) => {
    setVlan(id); setMessage(null);
    const sg = segments.find((x) => x.id === id);
    // On garde la fin de l'adresse actuelle si l'appareil est déjà dans ce
    // segment ; sinon le champ part vide, parce qu'on n'a rien à proposer.
    if (sg?.plage && appareil.ip && String(appareil.ip).startsWith(sg.plage.prefixe + ".")) {
      setHote(partieHote(appareil.ip, sg.plage.octetsFiges));
    } else setHote("");
  };

  const poser = async () => {
    setOccupe(true); setMessage(null);
    try {
      const r = await api.poserReservation(appareil.id, { vlan, ip });
      setMessage({ ok: true, texte: r.message || r.sortie });
      await onChange();
    } catch (e: any) { setMessage({ ok: false, texte: e.message }); }
    finally { setOccupe(false); }
  };

  const retirer = async () => {
    if (!confirm("Retirer la réservation ? L'appareil repassera en adresse dynamique.")) return;
    setOccupe(true); setMessage(null);
    try {
      const r = await api.poserReservation(appareil.id, { retirer: true });
      setMessage({ ok: true, texte: r.message || r.sortie });
      await onChange();
    } catch (e: any) { setMessage({ ok: false, texte: e.message }); }
    finally { setOccupe(false); }
  };

  const relancer = async () => {
    setOccupe(true); setMessage(null);
    try {
      const r = await api.relancerBail(appareil.id);
      setMessage({ ok: true, texte: r.message || r.sortie });
    } catch (e: any) { setMessage({ ok: false, texte: e.message }); }
    finally { setOccupe(false); }
  };

  if (!etat) {
    return <div style={{ color: "var(--faint)", fontSize: 12 }}>Lecture des segments…</div>;
  }

  if (!appareil.mac) {
    return (
      <div className="aide" style={{ marginTop: 0 }}>
        Aucune adresse MAC relevée pour cet appareil. Une réservation se pose sur
        une carte réseau, pas sur une adresse : sans MAC, il n'y a rien à réserver.
      </div>
    );
  }

  if (!segments.length) {
    return (
      <div className="aide" style={{ marginTop: 0 }}>
        Aucun segment connu. Relève d'abord les VLAN depuis l'équipement, page
        <b style={{ fontWeight: 500 }}> VLAN</b>.
      </div>
    );
  }

  return (
    <div>
      {/* minmax(0, …) plutôt que 1fr : sans ça une colonne de grille refuse de
          descendre sous la largeur de son contenu, et la liste déroulante se
          faisait rogner en plein milieu du nom du segment. */}
      <div style={{
        display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)",
        gap: 12, alignItems: "start",
      }}>
        <div style={{ minWidth: 0 }}>
          <label className="lbl">Segment</label>
          <select className="field" style={{ width: "100%" }} value={vlan ?? ""}
            onChange={(e) => changerVlan(e.target.value === "" ? null : Number(e.target.value))}>
            <option value="">— choisir —</option>
            {segments.map((sg) => (
              <option key={sg.id} value={sg.id}>VLAN {sg.id} · {sg.nom}</option>
            ))}
          </select>
        </div>
        <div style={{ minWidth: 0 }}>
          <label className="lbl">Adresse</label>
          <div style={{
            display: "flex", alignItems: "stretch", gap: 0,
            border: `1px solid ${hote.trim() && !controle.ok ? "var(--alarm)" : "var(--hair)"}`,
            borderRadius: 9, overflow: "hidden", background: "var(--well)",
          }}>
            <span style={{
              padding: "9px 2px 9px 11px", fontFamily: "var(--mono)", fontSize: 13,
              color: "var(--faint)", whiteSpace: "nowrap", userSelect: "none",
            }}>{prefixe ? prefixe + "." : ""}</span>
            <input
              value={hote}
              disabled={!segment}
              onChange={(e) => { setHote(e.target.value.replace(/[^0-9.]/g, "")); setMessage(null); }}
              placeholder={plage ? partieHote(plage.derniere, plage.octetsFiges) : ""}
              style={{
                flex: 1, minWidth: 0, border: "none", outline: "none", background: "transparent",
                padding: "9px 11px 9px 0", fontFamily: "var(--mono)", fontSize: 13, color: "var(--txt)",
              }}/>
          </div>
          {plage && (
            <div style={{ color: hote.trim() && !controle.ok ? "var(--alarm)" : "var(--faint)",
                          fontSize: 11, marginTop: 5, fontFamily: "var(--mono)" }}>
              {hote.trim() && !controle.ok
                ? controle.raison
                : `${segment.sousReseau} · de ${plage.premiere} à ${plage.derniere}` +
                  (segment?.passerelle ? ` · passerelle ${segment.passerelle}` : "")}
            </div>
          )}
        </div>
      </div>

      <div style={{ display: "flex", gap: 9, flexWrap: "wrap", marginTop: 12 }}>
        <button className="btn solid" disabled={occupe || !controle.ok} onClick={poser}>
          {occupe ? "…" : "Réserver cette adresse"}
        </button>
        <button className="btn" disabled={occupe} onClick={retirer}>Retirer la réservation</button>
        <button className="btn" disabled={occupe} onClick={relancer}>Forcer la reprise de bail</button>
      </div>

      {message && (
        <div style={{
          marginTop: 10, fontSize: 12.5, lineHeight: 1.5,
          color: message.ok ? "var(--txt)" : "var(--alarm)",
        }}>{message.texte}</div>
      )}

      <div className="aide">
        MapMyLAN ne réécrit pas la configuration de la machine — personne ne peut
        faire ça à distance. Il demande à la passerelle de toujours servir cette
        adresse à cette carte réseau : l'appareil la prendra à son prochain bail,
        ou tout de suite si tu forces la reprise. Et choisir un segment ici ne
        déplace pas l'appareil de VLAN : ça dit de quel réseau l'adresse relève.
        Le VLAN d'un appareil se décide par le port ou le SSID, sur l'équipement.
      </div>
    </div>
  );
}
