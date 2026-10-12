import Link from "next/link";
import type { RaceSummary } from "@/lib/data";
import { sessionFinished, sessionName } from "@/lib/sessions";
import { weekendHref } from "./weekend-href";
import { LocalTime } from "@/components/ui/local-time";

export interface ScheduleEntry {
  key: string;
  label: string;
  time: string;
}

interface WeekendScheduleProps {
  season: number;
  round: number;
  schedule: ScheduleEntry[];
  now: Date;
  /** The session to emphasise (live, or the next one to start). */
  nextKey?: string | null;
  /** The session running right now; it gets a Live badge linking to /live. */
  liveKey?: string | null;
}

/**
 * The sessions of a weekend in the visitor's time zone. A finished session links to the race
 * weekend page with that session open; upcoming sessions stay plain text; the live one carries
 * a Live badge.
 */
export function WeekendSchedule({ season, round, schedule, now, nextKey = null, liveKey = null }: WeekendScheduleProps) {
  return (
    <ul className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-ui">
      {schedule.map((s) => {
        const tone = s.key === nextKey ? "text-ink font-[550]" : "text-ink-2";
        const finished = s.key !== liveKey && sessionFinished(s.key, s.time, now);
        const href = finished ? weekendHref(season, round, s.key) : null;
        const label = href ? (
          <Link href={href} className="hover:text-ink hover:underline underline-offset-2">
            {s.label}
          </Link>
        ) : (
          s.label
        );
        const liveBadge =
          s.key === liveKey ? (
            <Link href="/live" className="inline-flex items-center gap-1.5 text-caption text-accent hover:underline underline-offset-2">
              <span className="live-dot inline-block size-1.5 rounded-full bg-accent" aria-hidden="true" />
              Live
            </Link>
          ) : null;
        return (
          <li key={s.key} className={"col-span-2 grid grid-cols-subgrid " + tone}>
            <span className="inline-flex items-center gap-2">
              {label}
              {liveBadge}
            </span>
            <span className="timing text-end">
              <LocalTime iso={s.time} options={LIST_TIME} />
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/** The weekend's sessions in start order, from the calendar entry (or just the race date). */
export function weekendSchedule(race: RaceSummary | null, raceDate: string): ScheduleEntry[] {
  const sessions: Partial<Record<string, string>> = race ? race.sessions : { race: raceDate };
  return Object.entries(sessions)
    .filter((entry): entry is [string, string] => typeof entry[1] === "string")
    .map(([key, time]) => ({ key, label: sessionName(key), time }))
    .sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());
}

const LIST_TIME: Intl.DateTimeFormatOptions = { weekday: "short", hour: "2-digit", minute: "2-digit" };
