import Link from "next/link";
import type { RaceSummary } from "@/lib/data";
import { IconCaretLeft, IconCaretRight } from "@/components/icons";

interface RacePagerProps {
  previous: RaceSummary | null;
  next: RaceSummary | null;
  /** Builds the href for a race, so the pager can stay on a session page. */
  hrefFor: (race: RaceSummary) => string;
}

/** Previous and next race as two bordered buttons with chevrons. */
export function RacePager({ previous, next, hrefFor }: RacePagerProps) {
  return (
    <nav aria-label="Previous and next race" className="flex flex-wrap gap-2">
      {previous ? (
        <PagerLink href={hrefFor(previous)} label="Previous" name={shortName(previous.raceName)} side="left" />
      ) : null}
      {next ? <PagerLink href={hrefFor(next)} label="Next" name={shortName(next.raceName)} side="right" /> : null}
    </nav>
  );
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function PagerLink({ href, label, name, side }: { href: string; label: string; name: string; side: "left" | "right" }) {
  const Chevron = side === "left" ? IconCaretLeft : IconCaretRight;
  const chevron = <Chevron size="1rem" className="shrink-0 text-ink-3" />;
  return (
    <Link href={href} className="press inline-flex min-h-10 items-center gap-2 rounded-control border border-rule px-3 text-ui text-ink hover:border-rule-strong">
      {side === "left" ? chevron : null}
      <span className="flex flex-col leading-tight">
        <span className="text-caption text-ink-3">{label}</span>
        <span>{name}</span>
      </span>
      {side === "right" ? chevron : null}
    </Link>
  );
}

function shortName(raceName: string): string {
  return raceName.replace(" Grand Prix", " GP");
}
