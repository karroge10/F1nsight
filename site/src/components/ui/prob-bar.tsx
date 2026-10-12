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
  const raw = Math.max(0, Math.min(1, value / max));
  // anything above zero keeps a 2px stub so a sub-1% chance is still visible
  const ratio = raw > 0 ? Math.max(raw, 0.04) : 0;
  const text = formatPercent(value, digits);
  const fill = color ?? "var(--prob-4)";
  return (
    <span className="inline-flex items-center gap-2" aria-label={label ? `${label} ${text}` : undefined}>
      <span className={"relative h-1.5 overflow-hidden rounded-chip bg-bg-sunken shadow-[inset_0_0_0_1px_var(--rule-strong)] " + width} aria-hidden="true">
        <span className="bar-fill absolute inset-0 rounded-chip" style={{ transform: `scaleX(${ratio})`, background: fill, opacity: muted ? 0.45 : 1 }} />
      </span>
      <span className={"timing text-table " + (muted ? "text-ink-3" : "text-ink")}>{text}</span>
    </span>
  );
}
