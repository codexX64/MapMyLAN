// Primitives d'interface — les briques que la maquette utilise partout.
//
// Chaque composant se contente d'émettre les classes de src/styles/maquette.css.
// Aucune couleur en dur : tout vient des variables de thème, donc la bascule
// clair/sombre se fait sans qu'aucun composant s'en aperçoive.
//
// Les anciennes primitives (RiskBadge, Sparkline, PrimaryBtn…) sont conservées
// en bas de fichier : d'autres écrans les importent encore, rien ne doit casser.

import { ReactNode } from "react";
import { Icon } from "../../lib/icons";

// ═══ Structure de page ═════════════════════════════════════════════════════

/** En-tête de page : grand titre, chapeau, actions à droite. */
export function Page({ title, lede, actions, children }: {
  title: ReactNode; lede?: ReactNode; actions?: ReactNode; children: ReactNode;
}) {
  return (
    <section className="page on">
      <div className="headrow">
        <div>
          <h1 className="title">{title}</h1>
          {lede && <p className="lede">{lede}</p>}
        </div>
        {actions && <div className="actions">{actions}</div>}
      </div>
      {children}
    </section>
  );
}

/** Bandeau de chiffres de tête. `cols` suit le nombre de tuiles. */
export function Figs({ cols = 4, children, style }: { cols?: number; children: ReactNode; style?: any }) {
  return (
    <div className="figs" style={{ gridTemplateColumns: `repeat(${cols},1fr)`, ...style }}>
      {children}
    </div>
  );
}

/**
 * Une tuile de chiffre. `tone` change la couleur de la pastille :
 * défaut (accent), "warn" (alarme), "plain" (neutre).
 */
export function Fig({ icon, tone, label, value, unit, delta, deltaTone, chart }: {
  icon: string; tone?: "warn" | "plain"; label: ReactNode;
  value: ReactNode; unit?: ReactNode; delta?: ReactNode;
  deltaTone?: "pos"; chart?: ReactNode;
}) {
  return (
    <div className="fig">
      <div className={tone ? `tile ${tone}` : "tile"}><Icon name={icon} size={16}/></div>
      <span>{label}</span>
      <strong>{value}{unit != null && <em>{unit}</em>}</strong>
      {delta != null && <div className={deltaTone ? `delta ${deltaTone}` : "delta"}>{delta}</div>}
      {chart}
    </div>
  );
}

/**
 * Courbe de fond d'une tuile. Les points sont normalisés entre le minimum et
 * le maximum de la série : une variation faible reste lisible.
 */
export function FigChart({ data, tone = "accent", libre }: {
  data: number[]; tone?: "accent" | "alarm" | "faint"; libre?: boolean;
}) {
  if (!data || data.length < 2) return null;
  const W = 220, H = 42;
  const min = Math.min(...data), max = Math.max(...data);
  const ecart = max - min || 1;
  const pts = data.map((v, i) => [
    (i / (data.length - 1)) * W,
    H - 4 - ((v - min) / ecart) * (H - 10),
  ]);
  const trace = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  const couleur = `var(--${tone === "alarm" ? "alarm" : tone === "faint" ? "faint" : "accent"})`;
  const id = `g-${tone}-${data.length}-${Math.round(min)}-${Math.round(max)}`;
  return (
    <svg className={libre ? "chart libre" : "chart"} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
      {tone !== "faint" && (
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={couleur} stopOpacity=".18"/>
            <stop offset="1" stopColor={couleur} stopOpacity="0"/>
          </linearGradient>
        </defs>
      )}
      {tone !== "faint" && <path d={`${trace} L${W} ${H} L0 ${H}Z`} fill={`url(#${id})`}/>}
      <path d={trace} fill="none" stroke={couleur} strokeWidth="1.6"/>
    </svg>
  );
}

/** Carte : fond de surface, coins doux, ombre portée. */
export function Card({ title, note, head, children, style, className }: {
  title?: ReactNode; note?: ReactNode; head?: ReactNode;
  children?: ReactNode; style?: any; className?: string;
}) {
  return (
    <div className={className ? `card ${className}` : "card"} style={style}>
      {(title || note || head) && (
        <header>
          {title && <h2>{title}</h2>}
          {head}
          {note && <span className="note">{note}</span>}
        </header>
      )}
      {children}
    </div>
  );
}

/** Zone de texte à l'intérieur d'une carte, alignée sur son en-tête. */
export function Pad({ children, style }: { children: ReactNode; style?: any }) {
  return <div className="pad" style={style}>{children}</div>;
}

/** Deux colonnes : la principale et sa colonne d'appoint. */
export function Split({ children, cols, style }: { children: ReactNode; cols?: string; style?: any }) {
  return <div className="split" style={{ ...(cols ? { gridTemplateColumns: cols } : null), ...style }}>{children}</div>;
}

// ═══ Éléments ══════════════════════════════════════════════════════════════

export function Btn({ solid, icon, children, onClick, disabled, title, style }: {
  solid?: boolean; icon?: string; children?: ReactNode;
  onClick?: () => void; disabled?: boolean; title?: string; style?: any;
}) {
  return (
    <button className={solid ? "btn solid" : "btn"} onClick={onClick} disabled={disabled}
      title={title} style={{ ...(disabled ? { opacity: .55, cursor: "default" } : null), ...style }}>
      {icon && <Icon name={icon} size={14}/>}
      {children}
    </button>
  );
}

/** Sélecteur de vue — les trois onglets de la page « trafic mondial ». */
export function Views({ items }: { items: { label: ReactNode; icon?: string; on?: boolean; onClick?: () => void }[] }) {
  return (
    <div className="views">
      {items.map((v, i) => (
        <button key={i} className={v.on ? "view on" : "view"} onClick={v.onClick}>
          {v.icon && <Icon name={v.icon} size={14}/>}{v.label}
        </button>
      ))}
    </div>
  );
}

export function Chip({ tone, children, style }: { tone?: "a" | "w"; children: ReactNode; style?: any }) {
  return <span className={tone ? `chip ${tone}` : "chip"} style={style}>{children}</span>;
}

/** Pastille d'état : point coloré et libellé. */
export function Tag({ tone, children }: { tone?: "idle" | "held"; children: ReactNode }) {
  return <span className={tone ? `tag ${tone}` : "tag"}><i className="d"/>{children}</span>;
}

/** Jauge de risque : barre courte et valeur, rouge au-delà du seuil. */
export function Risk({ score, seuil = 70 }: { score: number; seuil?: number }) {
  const v = Math.max(0, Math.min(100, Math.round(score || 0)));
  return (
    <span className={v >= seuil ? "risk high" : "risk"}>
      <span className="r2"><i style={{ width: `${v}%` }}/></span>
      <b>{v}</b>
    </span>
  );
}

/** Interrupteur. La couleur pleine dit « actif », sans texte à lire. */
export function Toggle({ on, onChange, title }: { on: boolean; onChange?: (v: boolean) => void; title?: string }) {
  return (
    <button className={on ? "toggle on" : "toggle"} title={title}
      aria-pressed={on} onClick={() => onChange?.(!on)}><i/></button>
  );
}

/** Vignette carrée d'un appareil ou d'un compte. */
export function ITile({ tone, children }: { tone?: "hot" | "key"; children: ReactNode }) {
  return <span className={tone ? `itile ${tone}` : "itile"}>{children}</span>;
}

/** Cellule « qui » : vignette, nom, précision en dessous. */
export function WhoCell({ icon, tone, name, sub }: {
  icon?: ReactNode; tone?: "hot" | "key"; name: ReactNode; sub?: ReactNode;
}) {
  return (
    <div className="who-cell">
      {icon != null && <ITile tone={tone}>{icon}</ITile>}
      <span><b>{name}</b>{sub != null && <small>{sub}</small>}</span>
    </div>
  );
}

/** Encart d'information ou d'avertissement. */
export function Note({ tone = "info", icon, children }: {
  tone?: "info" | "warn"; icon?: string; children: ReactNode;
}) {
  return (
    <div className={`note ${tone}`}>
      <Icon name={icon || (tone === "warn" ? "alert" : "shield")} size={15} style={{ flex: "none", marginTop: 1 }}/>
      <span>{children}</span>
    </div>
  );
}

/** Ligne d'annonce du flux « récent ». */
export function Notice({ icon, tone, children, when }: {
  icon?: string; tone?: "hot" | "key"; children: ReactNode; when?: ReactNode;
}) {
  return (
    <div className="notice">
      {icon && <ITile tone={tone}><Icon name={icon} size={15}/></ITile>}
      <div><p>{children}</p>{when != null && <span className="when">{when}</span>}</div>
    </div>
  );
}

/** Rien à montrer : on le dit, sans meubler. */
export function Empty({ text, icon = "unknown" }: { text: ReactNode; icon?: string; t?: any }) {
  return (
    <div style={{
      padding: "34px 20px", textAlign: "center", color: "var(--faint)",
      fontFamily: "var(--mono)", fontSize: 12,
    }}>
      <Icon name={icon} size={20} style={{ margin: "0 auto 10px", opacity: .7 }}/>
      {text}
    </div>
  );
}

/** Libellé de champ, en capitales espacées. */
export function Lbl({ children }: { children: ReactNode }) {
  return <label className="lbl">{children}</label>;
}

/** Champ de saisie. `sans` bascule en typographie de texte plutôt qu'en chasse fixe. */
export function Field(props: any) {
  const { sans, className, ...reste } = props;
  return <input {...reste} className={["field", sans ? "sans" : "", className || ""].filter(Boolean).join(" ")}/>;
}

// ═══ Compatibilité ═════════════════════════════════════════════════════════
// Ce qui suit sert encore ailleurs dans l'application. Les couleurs passent
// par le thème `t` comme avant, mais s'appuient sur la nouvelle palette.

export function StatusDot({ status, t }: { status: string; t?: any }) {
  const cls = status === "online" ? "" : status === "banned" || status === "suspect" ? "held" : "idle";
  return <span className={cls ? `tag ${cls}` : "tag"} style={{ gap: 0 }}><i className="d"/></span>;
}

export function RiskBadge({ score }: { score: number; t?: any }) {
  return <Risk score={score}/>;
}

export function SeverityBadge({ severity }: { severity: string; t?: any }) {
  const s = String(severity || "").toLowerCase();
  const tone = s === "critical" || s === "high" || s === "error" ? "w" : s === "medium" || s === "warn" ? undefined : "a";
  return <Chip tone={tone as any} style={{ textTransform: "uppercase", letterSpacing: ".06em", fontSize: 10 }}>{severity}</Chip>;
}

export function Sparkline({ data, color, w = 100, h = 28 }: { data: number[]; color?: string; w?: number; h?: number }) {
  if (!data || data.length < 2) return <svg width={w} height={h}/>;
  const min = Math.min(...data), max = Math.max(...data, min + 1);
  const ecart = max - min || 1;
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * w},${h - ((v - min) / ecart) * h}`).join(" ");
  const c = color || "var(--accent)";
  return (
    <svg width={w} height={h} style={{ display: "block" }}>
      <polyline points={`0,${h} ${pts} ${w},${h}`} fill={c} opacity={.12} stroke="none"/>
      <polyline points={pts} fill="none" stroke={c} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

export function MiniBar({ value, max = 100, color, height = 4 }: { value: number; max?: number; color?: string; height?: number }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div style={{ height, background: "var(--well)", borderRadius: height / 2, overflow: "hidden" }}>
      <div style={{ width: `${pct}%`, height: "100%", background: color || "var(--ink-soft)", transition: "width .5s ease" }}/>
    </div>
  );
}

export function ScoreGauge({ score, size = 80 }: { score: number; t?: any; size?: number }) {
  const r = size / 2 - 6, cx = size / 2, cy = size / 2;
  const circ = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(100, score));
  const c = v >= 70 ? "var(--alarm)" : v >= 40 ? "var(--warn)" : "var(--accent)";
  return (
    <svg width={size} height={size} style={{ display: "block" }}>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--well)" strokeWidth={5}/>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke={c} strokeWidth={5}
        strokeDasharray={circ} strokeDashoffset={circ * (1 - v / 100)}
        strokeLinecap="round" transform={`rotate(-90 ${cx} ${cy})`}
        style={{ transition: "stroke-dashoffset .6s ease" }}/>
      <text x={cx} y={cy + 5} textAnchor="middle" fill="var(--ink)"
        fontSize={size / 4} fontWeight={500} fontFamily="var(--mono)">{Math.round(v)}</text>
    </svg>
  );
}

export function LiveDot({ color }: { color?: string }) {
  return <span className="tag" style={{ gap: 0 }}><i className="d" style={color ? { background: color } : undefined}/></span>;
}

export function PrimaryBtn({ onClick, disabled, children, style }: any) {
  return <Btn solid onClick={onClick} disabled={disabled} style={style}>{children}</Btn>;
}
export function GhostBtn({ onClick, children, style }: any) {
  return <Btn onClick={onClick} style={style}>{children}</Btn>;
}

export function inputStyle(_t?: any): any {
  return {
    background: "var(--well)", border: "1px solid var(--hair)", color: "var(--ink)",
    padding: "9px 12px", borderRadius: 9, fontSize: 13,
    fontFamily: "var(--mono)", outline: "none", width: "100%",
  };
}
export function smallLabel(_t?: any): any {
  return {
    display: "block", color: "var(--faint)", fontSize: 10.5,
    textTransform: "uppercase", letterSpacing: ".12em", marginBottom: 5,
  };
}
