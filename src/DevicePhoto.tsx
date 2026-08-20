// Device photo.
//
// The user drops an image, the background removal runs on its own, and they see
// the result immediately. If they aren't happy, a slider adjusts the tolerance
// and they re-run it; if they'd rather keep the image as is, they can. Nothing
// leaves the browser.

import { useCallback, useEffect, useRef, useState } from "react";
import { detourer, vignette, type ResultatDetourage } from "../../lib/detourage";
import { Icon } from "../../lib/icons";
import { translate as tr } from "../../lib/i18n";

const TAILLE_MAX = 8 * 1024 * 1024;   // 8 MB: beyond that, it's a raw photo

export function DevicePhoto({
  t, valeur, onChange,
}: {
  t: any;
  /** Current photo as a data URI, or null. */
  valeur: string | null;
  onChange: (dataUrl: string | null) => void;
}) {
  const [brut, setBrut] = useState<string | null>(null);
  const [apercu, setApercu] = useState<string | null>(valeur);
  const [infos, setInfos] = useState<ResultatDetourage | null>(null);
  const [tolerance, setTolerance] = useState(34);
  const [occupe, setOccupe] = useState(false);
  const [err, setErr] = useState("");
  const [survol, setSurvol] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const traiter = useCallback(async (source: string | Blob, tol: number) => {
    setOccupe(true); setErr("");
    try {
      const r = await detourer(source, { tolerance: tol });
      // A background removal that takes away almost nothing signals a
      // too-complex background: better to say so than to deliver an unchanged
      // image without explanation.
      if (!r.dejaDetouree && r.retire < 0.05) {
        setErr(tr("photo.fondComplexe"));
      }
      setInfos(r);
      setApercu(await vignette(r.dataUrl, 512));
      onChange(r.dataUrl);
    } catch (e: any) {
      setErr(e?.message || tr("photo.errLecture"));
    } finally {
      setOccupe(false);
    }
  }, [onChange]);

  const prendre = useCallback(async (f: File) => {
    if (!f.type.startsWith("image/")) { setErr(tr("photo.errType")); return; }
    if (f.size > TAILLE_MAX) { setErr(tr("photo.errPoids")); return; }
    const url = await new Promise<string>((res, rej) => {
      const fr = new FileReader();
      fr.onload = () => res(String(fr.result));
      fr.onerror = () => rej(new Error(tr("photo.errLecture")));
      fr.readAsDataURL(f);
    }).catch(e => { setErr(e.message); return ""; });
    if (!url) return;
    setBrut(url);
    traiter(url, tolerance);
  }, [traiter, tolerance]);

  // Pasting an image from the clipboard: it's the most natural gesture right
  // after copying a photo from a manufacturer datasheet.
  useEffect(() => {
    const coller = (e: ClipboardEvent) => {
      const it = [...(e.clipboardData?.items || [])].find(i => i.type.startsWith("image/"));
      if (!it) return;
      const f = it.getAsFile();
      if (f) { e.preventDefault(); prendre(f); }
    };
    window.addEventListener("paste", coller);
    return () => window.removeEventListener("paste", coller);
  }, [prendre]);

  const relancer = (tol: number) => {
    setTolerance(tol);
    if (brut) traiter(brut, tol);
  };

  const retirer = () => {
    setBrut(null); setApercu(null); setInfos(null); setErr("");
    onChange(null);
    if (inputRef.current) inputRef.current.value = "";
  };

  const zone: any = {
    border: `1.5px dashed ${survol ? t.primary : t.border}`,
    background: survol ? t.wash : t.well,
    borderRadius: 12, minHeight: 168,
    display: "flex", flexDirection: "column", alignItems: "center",
    justifyContent: "center", gap: 9, cursor: "pointer",
    transition: "border-color .15s, background .15s", padding: 18,
    position: "relative", overflow: "hidden",
  };

  return (
    <div>
      <label style={{
        display: "block", color: t.faint, fontSize: 10.5,
        textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 6,
      }}>{tr("photo.titre")}</label>

      <div
        style={zone}
        onClick={() => inputRef.current?.click()}
        onDragOver={e => { e.preventDefault(); setSurvol(true); }}
        onDragLeave={() => setSurvol(false)}
        onDrop={e => {
          e.preventDefault(); setSurvol(false);
          const f = e.dataTransfer.files?.[0];
          if (f) prendre(f);
        }}>

        {/* Subtle checkerboard: without it, you can't tell a transparent
            area from a white one. */}
        {apercu && (
          <div aria-hidden style={{
            position: "absolute", inset: 0, opacity: 0.5,
            backgroundImage:
              `linear-gradient(45deg, ${t.hairSoft} 25%, transparent 25%),
               linear-gradient(-45deg, ${t.hairSoft} 25%, transparent 25%),
               linear-gradient(45deg, transparent 75%, ${t.hairSoft} 75%),
               linear-gradient(-45deg, transparent 75%, ${t.hairSoft} 75%)`,
            backgroundSize: "14px 14px",
            backgroundPosition: "0 0, 0 7px, 7px -7px, -7px 0",
          }}/>
        )}

        {occupe ? (
          <>
            <Icon name="refresh" size={22} style={{ color: t.primary, animation: "mml-tourne 1s linear infinite" }}/>
            <span style={{ color: t.muted, fontSize: 12.5 }}>{tr("photo.enCours")}</span>
            <style>{`@keyframes mml-tourne{to{transform:rotate(360deg)}}`}</style>
          </>
        ) : apercu ? (
          <img src={apercu} alt="" style={{
            maxWidth: "100%", maxHeight: 150, position: "relative",
            display: "block", objectFit: "contain",
          }}/>
        ) : (
          <>
            <span style={{
              width: 38, height: 38, borderRadius: 12, background: t.surface,
              color: t.muted, display: "flex", alignItems: "center",
              justifyContent: "center", boxShadow: t.lift,
            }}><Icon name="devices" size={18}/></span>
            <span style={{ color: t.txtSoft, fontSize: 13, fontWeight: 500 }}>{tr("photo.deposer")}</span>
            <span style={{ color: t.faint, fontSize: 11.5, textAlign: "center", lineHeight: 1.5 }}>
              {tr("photo.aide")}
            </span>
          </>
        )}
      </div>

      <input ref={inputRef} type="file" accept="image/*" style={{ display: "none" }}
        onChange={e => { const f = e.target.files?.[0]; if (f) prendre(f); }}/>

      {infos && !occupe && (
        <div style={{ marginTop: 12 }}>
          <div style={{
            display: "flex", alignItems: "center", gap: 9, fontSize: 12,
            color: infos.dejaDetouree ? t.muted : t.primary, marginBottom: 10,
          }}>
            <Icon name="shield" size={13}/>
            {infos.dejaDetouree
              ? tr("photo.dejaDetouree")
              : tr("photo.retire", { n: Math.round(infos.retire * 100) })}
            <span style={{ marginLeft: "auto", fontFamily: t.monoFont, fontSize: 11, color: t.faint }}>
              {infos.largeur} × {infos.hauteur}
            </span>
          </div>

          {!infos.dejaDetouree && (
            <div style={{ marginBottom: 10 }}>
              <div style={{
                display: "flex", justifyContent: "space-between",
                fontSize: 11.5, color: t.muted, marginBottom: 5,
              }}>
                <span>{tr("photo.tolerance")}</span>
                <span style={{ fontFamily: t.monoFont }}>{tolerance}</span>
              </div>
              <input type="range" min={8} max={110} value={tolerance}
                onChange={e => relancer(Number(e.target.value))}
                style={{ width: "100%", accentColor: t.primary }}/>
              <div style={{ color: t.faint, fontSize: 11, marginTop: 5, lineHeight: 1.5 }}>
                {tr("photo.toleranceAide")}
              </div>
            </div>
          )}

          <div style={{ display: "flex", gap: 9 }}>
            <button onClick={() => inputRef.current?.click()} style={btn(t)}>
              <Icon name="refresh" size={13} stroke={1.8}/>{tr("photo.remplacer")}
            </button>
            <button onClick={retirer} style={{ ...btn(t), color: t.err }}>
              <Icon name="ban" size={13} stroke={1.8}/>{tr("action.delete")}
            </button>
          </div>
        </div>
      )}

      {err && (
        <div style={{
          display: "flex", alignItems: "flex-start", gap: 9, marginTop: 10,
          padding: "9px 12px", borderRadius: 8, background: t.warnWash,
          color: t.warn, fontSize: 12.5, lineHeight: 1.5,
        }}>
          <span style={{ marginTop: 1 }}><Icon name="alert" size={14}/></span>{err}
        </div>
      )}
    </div>
  );
}

function btn(t: any): any {
  return {
    display: "flex", alignItems: "center", gap: 7, padding: "7px 13px",
    borderRadius: 9, border: "none", cursor: "pointer", fontFamily: t.font,
    fontSize: 12.5, fontWeight: 500, background: t.well, color: t.txtSoft,
  };
}
