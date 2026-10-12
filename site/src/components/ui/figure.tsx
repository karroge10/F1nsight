import type { ReactNode } from "react";

interface FigureProps {
  label: ReactNode;
  value: ReactNode;
  note?: ReactNode;
  size?: "md" | "lg";
}

/** Stat tile: label, proportional-figure value, optional note. */
export function Figure({ label, value, note, size = "md" }: FigureProps) {
  const valueClass = size === "lg" ? "headline text-[2.5rem] sm:text-[3rem]" : "headline text-h2";
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <p className="label">{label}</p>
      <p className={valueClass + " text-ink"}>{value}</p>
      {note ? <p className="text-caption text-ink-3">{note}</p> : null}
    </div>
  );
}
