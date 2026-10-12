interface RangeBarProps {
  p10: number;
  expected: number;
  p90: number;
  min: number;
  max: number;
  color?: string;
}

/** p10 to p90 range with the expected value marked. Shared axis across rows via min/max. */
export function RangeBar({ p10, expected, p90, min, max, color = "var(--prob-4)" }: RangeBarProps) {
  const span = max - min || 1;
  const toPct = (v: number) => `${(((v - min) / span) * 100).toFixed(1)}%`;
  const left = toPct(p10);
  const width = `${(((p90 - p10) / span) * 100).toFixed(1)}%`;
  const marker = toPct(expected);
  const zero = min < 0 && max > 0 ? toPct(0) : null;
  return (
    <span className="relative inline-block h-3 w-28 align-middle" aria-hidden="true">
      <span className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-rule" />
      {zero ? <span className="absolute top-0 h-full w-px bg-rule-strong" style={{ left: zero }} /> : null}
      <span className="absolute top-1/2 h-1.5 -translate-y-1/2 rounded-chip" style={{ left, width, background: color, opacity: 0.45 }} />
      <span className="absolute top-1/2 h-3 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-chip bg-ink" style={{ left: marker }} />
    </span>
  );
}
