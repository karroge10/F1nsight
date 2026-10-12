interface SparklineProps {
  values: (number | null)[];
  width?: number;
  height?: number;
  color?: string;
  baseline?: number;
  title?: string;
}

/** Tiny line, no axes. The last point is marked. */
export function Sparkline({ values, width = 72, height = 20, color = "var(--ink-2)", baseline, title }: SparklineProps) {
  const points = values.map((v, i) => ({ v, i })).filter((p): p is { v: number; i: number } => p.v !== null);
  if (points.length < 2) return <span className="inline-block" style={{ width, height }} aria-hidden="true" />;
  const min = Math.min(...points.map((p) => p.v), baseline ?? Infinity);
  const max = Math.max(...points.map((p) => p.v), baseline ?? -Infinity);
  const span = max - min || 1;
  // x spans the rounds that have a value, so trailing empty rounds (not raced yet) do not leave
  // the line short of the box with the end dot floating before the edge.
  const first = points[0].i;
  const stepX = width / Math.max(1, points[points.length - 1].i - first);
  const toX = (i: number) => (i - first) * stepX;
  const toY = (v: number) => height - 2 - ((v - min) / span) * (height - 4);
  const d = points.map((p, idx) => `${idx === 0 ? "M" : "L"}${toX(p.i).toFixed(1)} ${toY(p.v).toFixed(1)}`).join(" ");
  const last = points[points.length - 1];
  const lastX = toX(last.i);
  const lastY = toY(last.v);
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role={title ? "img" : undefined} aria-label={title} aria-hidden={title ? undefined : true} className="inline-block overflow-visible">
      {baseline !== undefined ? <line x1={0} x2={width} y1={toY(baseline)} y2={toY(baseline)} stroke="var(--rule-strong)" strokeWidth={1} /> : null}
      <path d={d} pathLength={1} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" className="draw-in" />
      <circle cx={lastX} cy={lastY} r={2.5} fill={color} stroke="var(--bg)" strokeWidth={1.5} />
    </svg>
  );
}
