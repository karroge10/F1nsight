import Link from "next/link";
import type { LiveReplaySession } from "@/lib/live/replay-sessions";
import { formatDate } from "@/lib/format";
import { Flag } from "@/components/ui/flag";

interface SessionBrowserProps {
  sessions: LiveReplaySession[];
  selected: { season: number; round: number; session: string } | null;
}

interface Weekend {
  key: string;
  season: number;
  round: number;
  raceName: string;
  country: string | null;
  /** Start of the latest replayable session: race day once the weekend is complete. */
  date: string;
  sessions: LiveReplaySession[];
}

const ORDER = ["FP1", "FP2", "FP3", "SQ", "S", "Q", "R"];

/** Round, race day, flag, name, chips at the right edge. On phones the date hides and the chips take a line of their own. */
const GRID = "grid-cols-[var(--round-w)_18px_minmax(0,1fr)] sm:grid-cols-[var(--round-w)_3rem_18px_minmax(0,1fr)_auto]";

/**
 * Replay picker: one compact line per race weekend, newest first: round, race day, flag, name
 * and the weekend's sessions as short chips in running order. Two columns on wide
 * screens, read down the left column first.
 */
export function SessionBrowser({ sessions, selected }: SessionBrowserProps) {
  const weekends = groupWeekends(sessions);
  const seasons = new Set(weekends.map((w) => w.season));
  const showSeason = seasons.size > 1;

  return (
    <div>
      <p className="text-ui text-ink-3">
        Pick a session, then press play.
      </p>
      <ul className="mt-3 gap-x-10 border-t border-rule lg:columns-2" aria-label="Replayable sessions">
        {weekends.map((weekend) => (
          <WeekendRow key={weekend.key} weekend={weekend} selected={selected} showSeason={showSeason} />
        ))}
      </ul>
    </div>
  );
}

function WeekendRow({ weekend, selected, showSeason }: { weekend: Weekend; selected: SessionBrowserProps["selected"]; showSeason: boolean }) {
  const isSelected = selected !== null && selected.season === weekend.season && selected.round === weekend.round;
  const roundText = showSeason ? `${weekend.season} R${weekend.round}` : `R${weekend.round}`;
  const dateText = formatDate(weekend.date);
  return (
    <li className={"grid min-h-11 break-inside-avoid items-center gap-x-3 gap-y-1.5 border-b border-rule py-1.5 " + GRID} style={{ "--round-w": showSeason ? "3.5rem" : "1.75rem" } as React.CSSProperties} data-weekend={weekend.key}>
      <span className="timing text-caption text-ink-3">{roundText}</span>
      <span className="timing hidden text-caption text-ink-3 sm:block">{dateText}</span>
      <Flag of={weekend.country} size={18} />
      <span className={"truncate text-ui " + (isSelected ? "font-[600] text-ink" : "text-ink")}>{weekend.raceName}</span>
      <span className="col-span-full flex flex-wrap gap-1 sm:col-span-1 sm:justify-end">
        {weekend.sessions.map((s) => (
          <SessionChip key={s.session} session={s} active={isSelected && selected.session === s.session} />
        ))}
      </span>
    </li>
  );
}

function SessionChip({ session, active }: { session: LiveReplaySession; active: boolean }) {
  const href = `/live?season=${session.season}&round=${session.round}&session=${session.session}`;
  const tone = active ? "selected-pill border-transparent" : "border-rule text-ink-2 hover:border-rule-strong hover:text-ink";
  return (
    <Link
      href={href}
      scroll={false}
      title={session.sessionName}
      aria-label={session.sessionName}
      aria-current={active ? "true" : undefined}
      className={"press timing inline-flex h-11 min-w-9 items-center justify-center rounded-control border px-1.5 text-caption font-[550] sm:h-8 " + tone}
    >
      {session.session}
    </Link>
  );
}

function groupWeekends(sessions: LiveReplaySession[]): Weekend[] {
  const byKey = new Map<string, Weekend>();
  for (const s of sessions) {
    const key = `${s.season}-${s.round}`;
    const weekend = byKey.get(key) ?? { key, season: s.season, round: s.round, raceName: s.raceName, country: s.country, date: s.date, sessions: [] };
    weekend.sessions.push(s);
    if (s.date > weekend.date) weekend.date = s.date;
    if (!weekend.country) weekend.country = s.country;
    byKey.set(key, weekend);
  }
  const weekends = [...byKey.values()];
  for (const weekend of weekends) weekend.sessions.sort((a, b) => sessionRank(a.session) - sessionRank(b.session));
  weekends.sort((a, b) => b.season - a.season || b.round - a.round);
  return weekends;
}

function sessionRank(code: string): number {
  const index = ORDER.indexOf(code);
  return index === -1 ? ORDER.length : index;
}
