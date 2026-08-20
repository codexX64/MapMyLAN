import { ReactNode } from "react";

// ─── Card ──────────────────────────────────────────────────────────────────
export function Card({ t, children, style, padding = 20 }: { t: any; children: ReactNode; style?: any; padding?: number }) {
  return (
    <div style={{
      background: t.surface,
      borderRadius: 14,
      boxShadow: t.lift,
      padding,
      position: "relative",
      ...style,
    }}>
      {children}
    </div>
  );
}

// ─── Status dot ────────────────────────────────────────────────────────────
export function StatusDot({ status, t }: { status: string; t: any }) {
  const map: Record<string, string> = {
    online: t.ok, offline: t.muted, suspect: t.err,
    banned: t.err, quarantined: t.warn,
  };
  const c = map[status] || t.muted;
  const pulse = status === "online" || status === "suspect";
  return (
    <span style={{
      display: "inline-block", width: 8, height: 8, borderRadius: "50%",
      background: c, boxShadow: pulse ? `0 0 8px ${c}80` : "none", flexShrink: 0,
    }}/>
  );
}

// ─── Risk badge ────────────────────────────────────────────────────────────
export function RiskBadge({ score, t }: { score: number; t: any }) {
  const c = score >= 70 ? t.err : score >= 40 ? t.warn : t.ok;
  return (
    <span style={{
      background: `${c}18`, color: c, border: `1px solid ${c}40`,
      padding: "2px 8px", borderRadius: 999,
      fontSize: 11, fontFamily: t.monoFont, fontWeight: 600,
    }}>{score}</span>
  );
}

// ─── Severity badge ────────────────────────────────────────────────────────
export function SeverityBadge({ severity, t }: { severity: string; t: any }) {
  const map: Record<string, string> = { critical: t.err, high: t.err, medium: t.warn, low: t.info, info: t.info, success: t.ok };
  const c = map[severity?.toLowerCase()] || t.muted;
  return (
    <span style={{
      background: `${c}1c`, color: c, border: `1px solid ${c}40`,
      padding: "2px 7px", borderRadius: 4,
      fontSize: 9.5, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase",
      fontFamily: t.monoFont, whiteSpace: "nowrap",
    }}>{severity}</span>
  );
}

// ─── Sparkline ─────────────────────────────────────────────────────────────
export function Sparkline({ data, color, w = 100, h = 28 }: { data: number[]; color: string; w?: number; h?: number }) {
  if (!data || data.length < 2) return <svg width={w} height={h}/>;
  const min = Math.min(...data), max = Math.max(...data, min + 1);
  const range = max - min || 1;
  const points = data.map((v, i) => `${(i / (data.length - 1)) * w},${h - ((v - min) / range) * h}`).join(" ");
  return (
    <svg width={w} height={h} style={{ display: "block" }}>
      <polyline points={points} fill="none" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"/>
      <polyline points={`0,${h} ${points} ${w},${h}`} fill={`${color}1a`} stroke="none"/>
    </svg>
  );
}

// ─── Mini bar ──────────────────────────────────────────────────────────────
export function MiniBar({ value, max = 100, color, height = 4 }: { value: number; max?: number; color: string; height?: number }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div style={{ height, background: "rgba(255,255,255,0.08)", borderRadius: height / 2, overflow: "hidden" }}>
      <div style={{ width: `${pct}%`, height: "100%", background: color, transition: "width 0.5s ease" }}/>
    </div>
  );
}

// ─── Circular score gauge ──────────────────────────────────────────────────
export function ScoreGauge({ score, t, size = 80 }: { score: number; t: any; size?: number }) {
  const r = size / 2 - 6;
  const cx = size / 2, cy = size / 2;
  const circ = 2 * Math.PI * r;
  const display = Math.max(0, Math.min(100, score));
  const offset = circ * (1 - display / 100);
  const c = display >= 70 ? t.err : display >= 40 ? t.warn : t.ok;
  return (
    <svg width={size} height={size} style={{ display: "block" }}>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke={`${t.muted}30`} strokeWidth={5}/>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke={c} strokeWidth={5}
        strokeDasharray={circ} strokeDashoffset={offset}
        strokeLinecap="round" transform={`rotate(-90 ${cx} ${cy})`}
        style={{ transition: "stroke-dashoffset 0.6s ease" }}/>
      <text x={cx} y={cy + 5} textAnchor="middle"
        fill={t.txt} fontSize={size / 4} fontWeight={700} fontFamily={t.headFont}>
        {Math.round(display)}
      </text>
    </svg>
  );
}

// ─── Live dot indicator (pulsing) ──────────────────────────────────────────
export function LiveDot({ color }: { color: string }) {
  return (
    <span style={{
      display: "inline-block", width: 6, height: 6, borderRadius: "50%",
      background: color, boxShadow: `0 0 8px ${color}`, animation: "pulse 1.6s ease-in-out infinite",
    }}/>
  );
}

// ─── Common buttons ─────────────────────────────────────────────────────────
export function PrimaryBtn({ t, onClick, disabled, children, style }: any) {
  return (
    <button onClick={onClick} disabled={disabled} style={{
      background: t.grad, border: "none", color: t.onPrimary, boxShadow: t.lift,
      padding: "8px 18px", borderRadius: t.radius, fontSize: 12.5, fontWeight: 700,
      cursor: disabled ? "wait" : "pointer", fontFamily: t.headFont,
      opacity: disabled ? 0.6 : 1, ...style,
    }}>{children}</button>
  );
}
export function GhostBtn({ t, onClick, children, style }: any) {
  return (
    <button onClick={onClick} style={{
      background: t.surface, border: `1px solid ${t.border}`, color: t.txt,
      padding: "8px 16px", borderRadius: t.radius, fontSize: 12.5,
      cursor: "pointer", fontFamily: t.headFont, ...style,
    }}>{children}</button>
  );
}

// ─── Empty state ───────────────────────────────────────────────────────────
export function Empty({ t, text, icon = "—" }: { t: any; text: string; icon?: string }) {
  return (
    <div style={{
      padding: 40, textAlign: "center",
      color: t.muted, fontFamily: t.monoFont, fontSize: 12,
    }}>
      <div style={{ fontSize: 24, marginBottom: 6, opacity: 0.5 }}>{icon}</div>
      {text}
    </div>
  );
}

// ─── Inputs ─────────────────────────────────────────────────────────────────
export function inputStyle(t: any): any {
  return {
    background: t.id === "minimal" ? "#fff" : t.surface,
    border: `1px solid ${t.border}`, color: t.txt,
    padding: "8px 12px", borderRadius: t.radius,
    fontSize: 12.5, fontFamily: t.monoFont, outline: "none", width: "100%",
  };
}
export function smallLabel(t: any): any {
  return {
    display: "block", color: t.muted,
    fontSize: 9.5, textTransform: "uppercase", letterSpacing: "0.08em",
    marginBottom: 4, fontFamily: t.monoFont, fontWeight: 600,
  };
}
