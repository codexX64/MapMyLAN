// Plages balayées.
//
// Un réseau ne tient jamais dans un seul sous-réseau dès qu'il grandit : le
// DHCP distribue ici, l'infrastructure vit là, et un équipement resté sur son
// adressage d'usine se cache ailleurs. Cet écran permet d'en déclarer autant
// que nécessaire, de les activer ou non, sans avoir à toucher au fichier .env.
//
// Les plages sont balayées l'une après l'autre : deux balayages ARP simultanés
// saturent la carte réseau et faussent les résultats.

import { useEffect, useState } from "react";
import { api } from "../../api/client";
import { Icon } from "../../lib/icons";
import { translate as tr } from "../../lib/i18n";

interface Plage {
  cidr: string;
  label?: string;
  enabled?: boolean;
}

/** Nombre d'adresses couvertes, pour avertir avant un balayage démesuré. */
function taille(cidr: string): number | null {
  const m = /^(\d{1,3}(?:\.\d{1,3}){3})\/(\d{1,2})$/.exec(cidr.trim());
  if (!m) return null;
  const bits = Number(m[2]);
  if (bits < 0 || bits > 32) return null;
  return 2 ** (32 - bits);
}

function valide(cidr: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(\d{1,2})$/.exec(cidr.trim());
  if (!m) return false;
  const oct = [1, 2, 3, 4].map(i => Number(m[i]));
  return oct.every(o => o >= 0 && o <= 255) && Number(m[5]) >= 0 && Number(m[5]) <= 32;
}

export function ScanRangesPanel({ t }: { t: any }) {
  const [plages, setPlages] = useState<Plage[]>([]);
  const [cidr, setCidr] = useState("");
  const [label, setLabel] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [ok, setOk] = useState("");

  useEffect(() => {
    api.settings()
      .then((s: any) => {
        const brut = s?.["scan.ranges"];
        if (Array.isArray(brut) && brut.length) setPlages(brut);
        else api.scanRanges().then(setPlages).catch(() => {});
      })
      .catch(() => {});
  }, []);

  const enregistrer = async (suivantes: Plage[]) => {
    setBusy(true); setErr(""); setOk("");
    try {
      await api.setSetting("scan.ranges", suivantes);
      setPlages(suivantes);
      setOk(tr("ranges.saved"));
      setTimeout(() => setOk(""), 2500);
    } catch (e: any) {
      setErr(e?.message || tr("ranges.errApi"));
    } finally { setBusy(false); }
  };

  const ajouter = () => {
    const c = cidr.trim();
    if (!valide(c)) { setErr(tr("ranges.errCidr")); return; }
    if (plages.some(p => p.cidr === c)) { setErr(tr("ranges.errDup")); return; }
    enregistrer([...plages, { cidr: c, label: label.trim() || undefined, enabled: true }]);
    setCidr(""); setLabel("");
  };

  const basculer = (i: number) =>
    enregistrer(plages.map((p, j) => (j === i ? { ...p, enabled: p.enabled === false } : p)));

  const retirer = (i: number) => enregistrer(plages.filter((_, j) => j !== i));

  const champ: any = {
    background: t.well, border: `1px solid ${t.border}`, color: t.txt,
    borderRadius: 9, padding: "9px 12px", fontSize: 13, outline: "none",
    fontFamily: t.monoFont, width: "100%",
  };
  const etiquette: any = {
    display: "block", color: t.faint, fontSize: 10.5, textTransform: "uppercase",
    letterSpacing: "0.12em", marginBottom: 5,
  };

  const grande = taille(cidr) !== null && (taille(cidr) as number) > 1024;

  return (
    <div className="set">
      <header>
        <span className="tile"><Icon name="map" size={17}/></span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2>{tr("ranges.title")}</h2>
          <p>{tr("ranges.lede")}</p>
        </div>
      </header>

      {plages.length === 0 ? (
        <div style={{ padding: "20px 18px", textAlign: "center", color: t.faint, fontSize: 13 }}>
          {tr("ranges.none")}
        </div>
      ) : (
        <div>
          {plages.map((p, i) => {
            const n = taille(p.cidr);
            const actif = p.enabled !== false;
            return (
              <div key={p.cidr} style={{
                display: "flex", alignItems: "center", gap: 12, padding: "11px 18px",
                borderTop: `1px solid ${t.hairSoft}`,
              }}>
                <button onClick={() => basculer(i)} disabled={busy} title={tr(actif ? "ranges.disable" : "ranges.enable")}
                  style={{
                    width: 34, height: 19, borderRadius: 20, border: "none", flex: "none",
                    background: actif ? t.primary : t.hair, position: "relative",
                    cursor: "pointer", transition: "background .2s",
                  }}>
                  <span style={{
                    position: "absolute", top: 2.5, left: actif ? 17.5 : 2.5,
                    width: 14, height: 14, borderRadius: "50%", background: t.surface,
                    boxShadow: "0 1px 3px rgba(0,0,0,.2)", transition: "left .2s",
                  }}/>
                </button>

                <div style={{ flex: 1, minWidth: 0, opacity: actif ? 1 : 0.5 }}>
                  <div style={{ fontFamily: t.monoFont, fontSize: 13, color: t.txt }}>{p.cidr}</div>
                  <div style={{ color: t.muted, fontSize: 11.5, marginTop: 1 }}>
                    {p.label ? p.label + " · " : ""}
                    {n !== null ? tr("ranges.addresses", { n: n.toLocaleString("fr-FR") }) : ""}
                  </div>
                </div>

                {n !== null && n > 1024 && actif && (
                  <span title={tr("ranges.bigHint")} style={{
                    display: "flex", alignItems: "center", gap: 6, fontSize: 11.5,
                    color: t.warn, background: t.warnWash, padding: "3px 9px", borderRadius: 7,
                  }}><Icon name="alert" size={12}/>{tr("ranges.big")}</span>
                )}

                <button onClick={() => retirer(i)} disabled={busy} style={{
                  background: "none", border: "none", cursor: "pointer",
                  color: t.muted, fontSize: 12.5, fontFamily: t.font, padding: "2px 8px",
                }}>{tr("action.delete")}</button>
              </div>
            );
          })}
        </div>
      )}

      <div style={{ padding: "14px 18px 18px", borderTop: `1px solid ${t.hairSoft}` }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: 10, alignItems: "end" }}>
          <div>
            <label style={etiquette}>{tr("ranges.cidr")}</label>
            <input value={cidr} onChange={e => { setCidr(e.target.value); setErr(""); }}
              placeholder="192.0.2.0/24" style={champ}
              onKeyDown={e => e.key === "Enter" && ajouter()}/>
          </div>
          <div>
            <label style={etiquette}>{tr("ranges.label")}</label>
            <input value={label} onChange={e => setLabel(e.target.value)}
              placeholder={tr("ranges.labelHint")} style={{ ...champ, fontFamily: t.font }}
              onKeyDown={e => e.key === "Enter" && ajouter()}/>
          </div>
          <button onClick={ajouter} disabled={busy || !cidr.trim()} style={{
            display: "flex", alignItems: "center", gap: 7, padding: "9px 15px",
            borderRadius: 9, border: "none", cursor: cidr.trim() ? "pointer" : "not-allowed",
            fontFamily: t.font, fontSize: 13, fontWeight: 500,
            background: cidr.trim() ? t.grad : t.well,
            color: cidr.trim() ? t.onPrimary : t.faint,
          }}><Icon name="plus" size={14} stroke={1.8}/>{tr("action.add")}</button>
        </div>

        {/* Avertissement plutôt qu'interdiction : au-delà d'un millier
            d'adresses, le balayage ARP devient long et lourd. À toi de juger. */}
        {grande && (
          <div style={{
            display: "flex", alignItems: "flex-start", gap: 9, marginTop: 12,
            padding: "9px 12px", borderRadius: 8, background: t.warnWash,
            color: t.warn, fontSize: 12.5, lineHeight: 1.5,
          }}>
            <span style={{ marginTop: 1 }}><Icon name="alert" size={14}/></span>
            {tr("ranges.bigWarn", { n: (taille(cidr) as number).toLocaleString("fr-FR") })}
          </div>
        )}

        {err && (
          <div style={{
            display: "flex", alignItems: "center", gap: 9, marginTop: 12,
            padding: "9px 12px", borderRadius: 8, background: t.alarmWash,
            color: t.err, fontSize: 12.5,
          }}><Icon name="alert" size={14}/>{err}</div>
        )}
        {ok && (
          <div style={{
            display: "flex", alignItems: "center", gap: 9, marginTop: 12,
            padding: "9px 12px", borderRadius: 8, background: t.wash,
            color: t.primary, fontSize: 12.5,
          }}><Icon name="shield" size={14}/>{ok}</div>
        )}

        <div style={{ color: t.faint, fontSize: 11.5, marginTop: 12, lineHeight: 1.5 }}>
          {tr("ranges.note")}
        </div>
      </div>
    </div>
  );
}
