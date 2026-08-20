// High-fidelity Cisco-style network device icons.
// Used exclusively in the Enterprise theme. Each glyph is constructed with SVG
// primitives and meant to look like the symbols in Cisco Packet Tracer / DNA Center.

interface Props {
  type: string;
  size?: number;
  color?: string;
  dim?: boolean;
  pulse?: boolean;
}

export function CiscoIcon({ type, size = 56, color = "#1a6bc4", dim, pulse }: Props) {
  const s = size;
  const c = dim ? "#3a5670" : color;
  const ac = dim ? "#3a5670" : "#00b4d8"; // accent
  const filter = pulse ? `drop-shadow(0 0 6px ${c})` : undefined;

  const router = (
    <g>
      <ellipse cx={s*.5} cy={s*.32} rx={s*.42} ry={s*.13} fill={`${c}25`} stroke={c} strokeWidth={s*.045}/>
      <rect x={s*.08} y={s*.32} width={s*.84} height={s*.36} fill={`${c}18`} stroke={c} strokeWidth={s*.045}/>
      <ellipse cx={s*.5} cy={s*.68} rx={s*.42} ry={s*.13} fill={`${c}22`} stroke={c} strokeWidth={s*.045}/>
      {/* Two diagonal arrows pointing in (router signature) */}
      <g stroke={ac} strokeWidth={s*.05} strokeLinecap="round" strokeLinejoin="round" fill="none">
        <path d={`M${s*.22},${s*.5} L${s*.5},${s*.42} L${s*.78},${s*.5}`}/>
        <path d={`M${s*.18},${s*.46} L${s*.22},${s*.5} L${s*.18},${s*.54}`}/>
        <path d={`M${s*.82},${s*.46} L${s*.78},${s*.5} L${s*.82},${s*.54}`}/>
        <path d={`M${s*.22},${s*.58} L${s*.5},${s*.66} L${s*.78},${s*.58}`}/>
      </g>
      <circle cx={s*.18} cy={s*.32} r={s*.02} fill={ac}/>
      <circle cx={s*.82} cy={s*.32} r={s*.02} fill={ac}/>
    </g>
  );

  const switchL2 = (
    <g>
      <rect x={s*.05} y={s*.32} width={s*.9} height={s*.36} rx={s*.025} fill={`${c}18`} stroke={c} strokeWidth={s*.04}/>
      {/* Port LEDs (top row) */}
      {[.11,.21,.31,.41,.51,.61,.71,.81].map((px, i) => (
        <g key={i}>
          <rect x={s*px} y={s*.36} width={s*.06} height={s*.07} rx={s*.01} fill={i < 5 ? ac : `${c}40`} opacity={i < 5 ? 0.95 : 0.3}/>
          <rect x={s*px} y={s*.46} width={s*.06} height={s*.07} rx={s*.01} fill={i < 4 ? "#34d399" : `${c}30`} opacity={i < 4 ? 0.85 : 0.25}/>
        </g>
      ))}
      <rect x={s*.05} y={s*.59} width={s*.9} height={s*.09} fill={c} opacity={0.18}/>
      {/* 4 incoming/outgoing arrows above (switch signature) */}
      <g stroke={ac} strokeWidth={s*.04} fill="none" strokeLinecap="round">
        <path d={`M${s*.32},${s*.22} L${s*.32},${s*.32}`}/>
        <path d={`M${s*.42},${s*.22} L${s*.42},${s*.32}`}/>
        <path d={`M${s*.5},${s*.32} L${s*.5},${s*.22}`}/>
        <path d={`M${s*.6},${s*.32} L${s*.6},${s*.22}`}/>
        <path d={`M${s*.28},${s*.22} L${s*.32},${s*.18} L${s*.36},${s*.22}`}/>
        <path d={`M${s*.38},${s*.22} L${s*.42},${s*.18} L${s*.46},${s*.22}`}/>
        <path d={`M${s*.46},${s*.22} L${s*.5},${s*.26} L${s*.54},${s*.22}`}/>
        <path d={`M${s*.56},${s*.22} L${s*.6},${s*.26} L${s*.64},${s*.22}`}/>
      </g>
    </g>
  );

  const firewall = (
    <g>
      <rect x={s*.08} y={s*.16} width={s*.84} height={s*.68} rx={s*.04} fill={`${c}15`} stroke={c} strokeWidth={s*.045}/>
      {/* Brick pattern (firewall signature) */}
      <g stroke={c} strokeWidth={s*.025} fill="none">
        <line x1={s*.08} y1={s*.32} x2={s*.92} y2={s*.32}/>
        <line x1={s*.08} y1={s*.5} x2={s*.92} y2={s*.5}/>
        <line x1={s*.08} y1={s*.68} x2={s*.92} y2={s*.68}/>
        <line x1={s*.3} y1={s*.16} x2={s*.3} y2={s*.32}/>
        <line x1={s*.6} y1={s*.16} x2={s*.6} y2={s*.32}/>
        <line x1={s*.4} y1={s*.32} x2={s*.4} y2={s*.5}/>
        <line x1={s*.7} y1={s*.32} x2={s*.7} y2={s*.5}/>
        <line x1={s*.25} y1={s*.5} x2={s*.25} y2={s*.68}/>
        <line x1={s*.55} y1={s*.5} x2={s*.55} y2={s*.68}/>
        <line x1={s*.4} y1={s*.68} x2={s*.4} y2={s*.84}/>
        <line x1={s*.7} y1={s*.68} x2={s*.7} y2={s*.84}/>
      </g>
      {/* Flame (Cisco firewall icon) */}
      <path d={`M${s*.5},${s*.36} Q${s*.62},${s*.46} ${s*.55},${s*.6} Q${s*.66},${s*.55} ${s*.6},${s*.7} Q${s*.5},${s*.62} ${s*.4},${s*.7} Q${s*.34},${s*.55} ${s*.45},${s*.6} Q${s*.38},${s*.46} ${s*.5},${s*.36} Z`} fill={`${ac}b0`}/>
    </g>
  );

  const cloud = (
    <g>
      <path d={`M ${s*.25},${s*.55} a${s*.18},${s*.18} 0 0,1 ${s*.06},-${s*.32} a${s*.22},${s*.22} 0 0,1 ${s*.42},${s*.04} a${s*.16},${s*.16} 0 0,1 ${s*.18},${s*.16} a${s*.14},${s*.14} 0 0,1 -${s*.1},${s*.22} L${s*.25},${s*.65} Z`} fill={`${c}18`} stroke={c} strokeWidth={s*.04} strokeLinejoin="round"/>
      <text x={s*.5} y={s*.55} textAnchor="middle" fill={c} fontSize={s*.16} fontFamily="'Barlow Condensed',sans-serif" fontWeight="700">WAN</text>
    </g>
  );

  const ap = (
    <g>
      {/* Disc */}
      <ellipse cx={s*.5} cy={s*.7} rx={s*.32} ry={s*.07} fill={`${c}25`} stroke={c} strokeWidth={s*.04}/>
      <ellipse cx={s*.5} cy={s*.66} rx={s*.32} ry={s*.07} fill={`${c}30`} stroke={c} strokeWidth={s*.04}/>
      {/* Wifi waves */}
      <path d={`M${s*.18},${s*.5} A${s*.34},${s*.34} 0 0 1 ${s*.82},${s*.5}`} fill="none" stroke={ac} strokeWidth={s*.055} strokeLinecap="round"/>
      <path d={`M${s*.28},${s*.55} A${s*.24},${s*.24} 0 0 1 ${s*.72},${s*.55}`} fill="none" stroke={ac} strokeWidth={s*.055} strokeLinecap="round"/>
      <path d={`M${s*.38},${s*.6} A${s*.13},${s*.13} 0 0 1 ${s*.62},${s*.6}`} fill="none" stroke={ac} strokeWidth={s*.055} strokeLinecap="round"/>
      <circle cx={s*.5} cy={s*.65} r={s*.04} fill={ac}/>
    </g>
  );

  const server = (
    <g>
      <rect x={s*.18} y={s*.12} width={s*.64} height={s*.76} rx={s*.025} fill={`${c}18`} stroke={c} strokeWidth={s*.04}/>
      {[.18,.3,.42,.54,.66,.78].map((ry, i) => (
        <g key={i}>
          <rect x={s*.22} y={s*ry} width={s*.56} height={s*.085} rx={s*.012} fill={`${c}22`} stroke={c} strokeWidth={s*.025}/>
          <circle cx={s*.27} cy={s*(ry+.04)} r={s*.018} fill={i % 2 ? "#34d399" : ac}/>
          <rect x={s*.34} y={s*(ry+.025)} width={s*.42} height={s*.035} fill={`${c}40`}/>
        </g>
      ))}
    </g>
  );

  const laptop = (
    <g>
      <rect x={s*.16} y={s*.22} width={s*.68} height={s*.46} rx={s*.025} fill={`${c}18`} stroke={c} strokeWidth={s*.04}/>
      <rect x={s*.2} y={s*.26} width={s*.6} height={s*.36} fill={`${c}30`}/>
      <path d={`M${s*.05},${s*.7} L${s*.95},${s*.7} L${s*.92},${s*.78} L${s*.08},${s*.78} Z`} fill={`${c}25`} stroke={c} strokeWidth={s*.035}/>
      <rect x={s*.42} y={s*.7} width={s*.16} height={s*.025} rx={s*.01} fill={c}/>
    </g>
  );

  const phone = (
    <g>
      <rect x={s*.32} y={s*.1} width={s*.36} height={s*.8} rx={s*.06} fill={`${c}18`} stroke={c} strokeWidth={s*.04}/>
      <rect x={s*.36} y={s*.18} width={s*.28} height={s*.6} fill={`${c}30`}/>
      <circle cx={s*.5} cy={s*.84} r={s*.025} fill={ac}/>
      <rect x={s*.45} y={s*.13} width={s*.1} height={s*.012} fill={c}/>
    </g>
  );

  const iot = (
    <g>
      <rect x={s*.18} y={s*.18} width={s*.64} height={s*.64} rx={s*.05} fill={`${c}18`} stroke={c} strokeWidth={s*.04}/>
      <circle cx={s*.5} cy={s*.5} r={s*.16} fill="none" stroke={ac} strokeWidth={s*.04}/>
      <circle cx={s*.5} cy={s*.5} r={s*.07} fill={ac}/>
      {/* corner pins */}
      {[[.22,.22],[.78,.22],[.22,.78],[.78,.78]].map(([x,y],i)=>(<circle key={i} cx={s*x} cy={s*y} r={s*.025} fill={c}/>))}
    </g>
  );

  const shapes: Record<string, JSX.Element> = {
    cloud, router, firewall, server, laptop, phone, iot,
    switch: switchL2,
    ap,
    unknown: (
      <g>
        <rect x={s*.18} y={s*.18} width={s*.64} height={s*.64} rx={s*.04} fill={`${c}10`} stroke={c} strokeWidth={s*.04} strokeDasharray={`${s*.04} ${s*.04}`}/>
        <text x={s*.5} y={s*.62} textAnchor="middle" fill={c} fontSize={s*.36} fontFamily="'Barlow Condensed', sans-serif" fontWeight="700">?</text>
      </g>
    ),
  };

  return (
    <svg width={s} height={s} viewBox={`0 0 ${s} ${s}`} style={{ display: "block", filter }}>
      {shapes[type] || shapes.unknown}
    </svg>
  );
}
