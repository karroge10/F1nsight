import { formatPercent } from "@/lib/format";

interface ProbBarProps {
  value: number;
  max?: number;
  color?: string;
  digits?: number;
  width?: string;
  muted?: boolean;
  label?: string;
}

/** Horizontal probability bar with the value printed beside it. Text never wears the data colour. */
export function ProbBar({ value, max = 1, color, digits = 0, width = "w-16", muted, label }: ProbBarProps) {
  const text = formatPercent(value, digits);
  return (
    <span className="inline-flex items-center gap-2" aria-label={label ? `${label} ${text}` : undefined}>
      <Meter ratio={value / max} color={color} muted={muted} className={width} />
      <span className={"timing w-10 text-end text-table " + (muted ? "text-ink-3" : "text-ink")}>{text}</span>
    </span>
  );
}

interface MeterProps {
  ratio: number;
  color?: string;
  muted?: boolean;
  className?: string;
}

/** The one bar used across the site: a visible track with a fill that grows from the left. */
export function Meter({ ratio, color, muted, className = "" }: MeterProps) {
  const raw = Math.max(0, Math.min(1, ratio));
  // anything above zero keeps a stub so a tiny value is still visible
  const scale = raw > 0 ? Math.max(raw, 0.04) : 0;
  const fill = color ?? "var(--prob-4)";
  return (
    <span className={"relative block h-1.5 overflow-hidden rounded-chip bg-rule-strong " + className} aria-hidden="true">
      <span className="bar-fill absolute inset-0 rounded-chip" style={{ transform: `scaleX(${scale})`, background: fill, opacity: muted ? 0.45 : 1 }} />
    </span>
  );
}
