interface TeamMarkProps {
  color: string;
  kind?: "rule" | "dot";
  className?: string;
}

/** Team colour as data: a short vertical rule or a dot beside a name. */
export function TeamMark({ color, kind = "rule", className = "" }: TeamMarkProps) {
  if (kind === "dot") {
    return <span aria-hidden="true" className={"inline-block size-2 shrink-0 rounded-full " + className} style={{ background: color }} />;
  }
  return <span aria-hidden="true" className={"inline-block h-4 w-[3px] shrink-0 rounded-chip " + className} style={{ background: color }} />;
}
