// Menu déroulant.
//
// Le `<select>` natif impose le rendu du système : bordure grise, flèche
// dessinée par l'OS, panneau qui ignore la palette et la typographie. Sur un
// formulaire soigné, c'est la pièce qui jure. Celui-ci reprend les tokens de
// l'application, s'ouvre en panneau surélevé, et reste utilisable au clavier —
// flèches pour parcourir, Entrée pour choisir, Échap pour refermer.

import { useEffect, useRef, useState } from "react";
import { Icon } from "../../lib/icons";

export interface Option {
  value: string;
  label: string;
  /** Ligne secondaire, en petit sous le libellé. */
  note?: string;
  icon?: string;
}

export function Select({
  t, value, options, onChange, placeholder, disabled, width,
}: {
  t: any;
  value: string;
  options: Option[];
  onChange: (v: string) => void;
  placeholder?: string;
  disabled?: boolean;
  width?: number | string;
}) {
  const [ouvert, setOuvert] = useState(false);
  const [survol, setSurvol] = useState(-1);
  const boite = useRef<HTMLDivElement>(null);
  const choisi = options.find(o => o.value === value);

  // Refermer au clic extérieur : sans cela le panneau reste ouvert derrière
  // les autres champs.
  useEffect(() => {
    if (!ouvert) return;
    const dehors = (e: MouseEvent) => {
      if (boite.current && !boite.current.contains(e.target as Node)) setOuvert(false);
    };
    document.addEventListener("mousedown", dehors);
    return () => document.removeEventListener("mousedown", dehors);
  }, [ouvert]);

  useEffect(() => {
    if (ouvert) setSurvol(Math.max(0, options.findIndex(o => o.value === value)));
  }, [ouvert]);

  const clavier = (e: React.KeyboardEvent) => {
    if (disabled) return;
    if (!ouvert && (e.key === "Enter" || e.key === " " || e.key === "ArrowDown")) {
      e.preventDefault(); setOuvert(true); return;
    }
    if (!ouvert) return;
    if (e.key === "Escape") { e.preventDefault(); setOuvert(false); }
    else if (e.key === "ArrowDown") { e.preventDefault(); setSurvol(i => Math.min(options.length - 1, i + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setSurvol(i => Math.max(0, i - 1)); }
    else if (e.key === "Enter") {
      e.preventDefault();
      const o = options[survol];
      if (o) { onChange(o.value); setOuvert(false); }
    }
  };

  return (
    <div ref={boite} style={{ position: "relative", width: width ?? "100%" }}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setOuvert(v => !v)}
        onKeyDown={clavier}
        style={{
          width: "100%", display: "flex", alignItems: "center", gap: 9,
          background: t.well, border: `1px solid ${ouvert ? t.primary : t.border}`,
          borderRadius: 9, padding: "9px 11px 9px 12px", fontSize: 13,
          color: choisi ? t.txt : t.faint, fontFamily: t.font, textAlign: "left",
          cursor: disabled ? "not-allowed" : "pointer",
          opacity: disabled ? 0.6 : 1,
          transition: "border-color .15s, background .15s",
          outline: "none",
        }}>
        {choisi?.icon && (
          <span style={{ color: t.primary, display: "flex", flex: "none" }}>
            <Icon name={choisi.icon} size={15}/>
          </span>
        )}
        <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {choisi?.label || placeholder || ""}
        </span>
        <span style={{
          color: t.faint, display: "flex", flex: "none",
          transform: ouvert ? "rotate(180deg)" : "none", transition: "transform .18s",
        }}>
          <Chevron/>
        </span>
      </button>

      {ouvert && (
        <div
          role="listbox"
          style={{
            position: "absolute", top: "calc(100% + 5px)", left: 0, right: 0, zIndex: 200,
            background: t.surface, borderRadius: 11, boxShadow: t.liftHi,
            padding: 5, maxHeight: 290, overflowY: "auto",
            animation: "mml-drop .16s cubic-bezier(.2,.7,.3,1)",
          }}>
          <style>{`@keyframes mml-drop {
            from { opacity: 0; transform: translateY(-5px) }
            to   { opacity: 1; transform: none }
          }`}</style>

          {options.map((o, i) => {
            const actif = o.value === value;
            const vise = i === survol;
            return (
              <button
                key={o.value}
                type="button"
                role="option"
                aria-selected={actif}
                onMouseEnter={() => setSurvol(i)}
                onClick={() => { onChange(o.value); setOuvert(false); }}
                style={{
                  width: "100%", display: "flex", alignItems: "center", gap: 10,
                  padding: "8px 10px", borderRadius: 8, border: "none", textAlign: "left",
                  background: vise ? t.well : "transparent",
                  color: actif ? t.txt : t.txtSoft,
                  fontFamily: t.font, fontSize: 13, cursor: "pointer",
                }}>
                {o.icon && (
                  <span style={{ color: actif ? t.primary : t.faint, display: "flex", flex: "none" }}>
                    <Icon name={o.icon} size={15}/>
                  </span>
                )}
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{
                    display: "block", fontWeight: actif ? 500 : 400,
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  }}>{o.label}</span>
                  {o.note && (
                    <span style={{
                      display: "block", fontSize: 11, color: t.faint, marginTop: 1,
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    }}>{o.note}</span>
                  )}
                </span>
                {actif && (
                  <span style={{ color: t.primary, display: "flex", flex: "none" }}>
                    <Icon name="shield" size={13}/>
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Chevron() {
  return (
    <svg viewBox="0 0 24 24" width={14} height={14} style={{ display: "block" }}
      fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 9.5 12 15.5 18 9.5"/>
    </svg>
  );
}
