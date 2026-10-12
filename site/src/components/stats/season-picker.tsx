import Link from "next/link";

interface SeasonPickerProps {
  seasons: number[];
  current: number;
  hrefFor: (season: number) => string;
}

/** Recent seasons as links plus a jump list for the rest. Server rendered, no JS. */
export function SeasonPicker({ seasons, current, hrefFor }: SeasonPickerProps) {
  const sorted = [...seasons].sort((a, b) => b - a);
  const recent = sorted.slice(0, 8);
  const rest = sorted.slice(8);
  return (
    <nav aria-label="Season" className="flex flex-wrap items-center gap-1 text-ui">
      {recent.map((s) => (
        <Link
          key={s}
          href={hrefFor(s)}
          aria-current={s === current ? "page" : undefined}
          className={"press timing inline-flex h-11 min-w-11 items-center justify-center rounded-control px-2.5 sm:h-9 sm:min-w-0 " + (s === current ? "selected-pill" : "text-ink-2 hover:bg-bg-hover hover:text-ink")}
        >
          {s}
        </Link>
      ))}
      {rest.length ? (
        <details className="relative">
          <summary className="press timing inline-flex h-11 cursor-pointer list-none items-center rounded-control px-2.5 sm:h-9 text-ink-2 hover:bg-bg-hover hover:text-ink">
            {rest.includes(current) ? current : "Earlier"} ↓
          </summary>
          <div className="absolute end-0 z-10 mt-1 grid max-h-72 w-72 grid-cols-4 gap-0.5 overflow-y-auto rounded-float bg-bg-raised p-2 shadow-float">
            {rest.map((s) => (
              <Link key={s} href={hrefFor(s)} className={"timing tap justify-center rounded-control px-2 py-1 text-center text-table hover:bg-bg-hover " + (s === current ? "text-ink" : "text-ink-2")}>
                {s}
              </Link>
            ))}
          </div>
        </details>
      ) : null}
    </nav>
  );
}
