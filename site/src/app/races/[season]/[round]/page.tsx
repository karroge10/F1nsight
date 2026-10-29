import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getCalendar, getLookups, getNextRacePrediction, getPredictionHistory, getRace, getSeasons, getSessionReport } from "@/lib/data";
import type { Lookups, Race, SessionReport } from "@/lib/data";
import { formatDate, formatLapTime } from "@/lib/format";
import { SESSION_SPECS, sessionFinished, type SessionSpec } from "@/lib/sessions";
import { reportLookups } from "@/lib/session-report";
import { replayableSessions } from "@/lib/live/replay-sessions";
import { LocalTime } from "@/components/ui/local-time";
import { PageIntro } from "@/components/ui/page-intro";
import { Flag } from "@/components/ui/flag";
import { RacePager } from "@/components/stats/race-pager";
import { RacePrediction } from "@/components/stats/race-prediction";
import { HeadlineStack, type HeadlineItem } from "@/components/stats/headline-stack";
import { SessionSwitcher, type SessionTab } from "@/components/stats/session-switcher";
import { SessionPanel, type SessionState } from "./session-panel";
import { buildBacktestRecord, hasVerifiedPublication, readPublishedForecastReport } from "@/lib/model-record";

type Params = Promise<{ season: string; round: string }>;

const RACE_TIME: Intl.DateTimeFormatOptions = { weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" };

const SHORT_LABELS: Record<string, string> = { fp1: "FP1", fp2: "FP2", fp3: "FP3", sprintQualifying: "SQ", sprint: "Sprint", qualifying: "Quali", race: "Race" };
const TAB_LABELS: Record<string, string> = { fp1: "FP1", fp2: "FP2", fp3: "FP3", sprintQualifying: "Sprint Qualifying", sprint: "Sprint", qualifying: "Qualifying", race: "Race" };

export const dynamicParams = false;

/** Every round of every season, cancelled ones included. */
export async function generateStaticParams(): Promise<{ season: string; round: string }[]> {
  const seasons = await getSeasons();
  const params: { season: string; round: string }[] = [];
  for (const { season } of seasons) {
    const calendar = await getCalendar(season);
    for (const race of calendar) params.push({ season: String(season), round: String(race.round) });
  }
  return params;
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { season, round } = await params;
  const race = await getRace(Number(season), Number(round));
  return { title: race ? `${race.raceName} ${season}` : "Race" };
}

/**
 * A race weekend on one page. The header carries the weekend's headline facts; below it the
 * sessions sit in a row of tabs, and the open session (the race by default, or the latest one
 * run while the weekend is under way) shows its podium, classification and charts.
 * `?session=fp1` opens a given session (applied in the browser, the page is prerendered); the
 * old per-session URLs (`/races/2026/1/fp1`) redirect here from public/_redirects and the 404 page.
 */
export default async function RacePage({ params }: { params: Params }) {
  const { season, round } = await params;
  const year = Number(season);
  const rnd = Number(round);
  const race = await getRace(year, rnd);
  if (!race) notFound();
  const siteLookups = await getLookups();
  const calendar = await getCalendar(year);
  const replays = await replayableSessions();
  const history = await getPredictionHistory();
  const nextForecast = await getNextRacePrediction();
  const forecastCandidates = history.filter((h) => h.race.season === year && h.race.round === rnd);
  const stagePriority: Record<string, number> = { "pre-weekend": 0, "post-practice": 1, "post-qualifying": 2 };
  const forecast = forecastCandidates.sort((a, b) => (stagePriority[b.race.stage] ?? -1) - (stagePriority[a.race.stage] ?? -1))[0]
    ?? (nextForecast.race.season === year && nextForecast.race.round === rnd ? nextForecast : null);
  const predictionRows = buildBacktestRecord(history).rows.filter((row) => row.season === year && row.round === rnd);
  const publicationVerified = hasVerifiedPublication(readPublishedForecastReport(), year, rnd);
  const prediction = predictionRows.sort((a, b) => (stagePriority[b.stage] ?? -1) - (stagePriority[a.stage] ?? -1))[0] ?? null;
  const now = new Date();
  const sessions = weekendSessions(race, now);
  const reports = await loadReports(race, sessions);
  const previous = calendar.find((r) => r.round === rnd - 1) ?? null;
  const next = calendar.find((r) => r.round === rnd + 1) ?? null;
  const pager = <RacePager previous={previous} next={next} hrefFor={(r) => `/races/${r.season}/${r.round}`} />;
  const headline = headlineItems(race, siteLookups);
  const raceDateText = formatDate(race.date, { weekday: "short", day: "numeric", month: "short", year: "numeric" });
  const initial = initialSession(sessions, race, reports);
  const tabs: SessionTab[] = sessions.map((s) => ({ slug: s.spec.slug, label: TAB_LABELS[s.spec.key], shortLabel: SHORT_LABELS[s.spec.key], time: s.start, state: s.state }));
  const panels: Record<string, ReactNode> = {};
  for (const s of sessions) {
    const report = reports.get(s.spec.code) ?? null;
    const lookups = report ? reportLookups(report, siteLookups) : siteLookups;
    const replayable = replays.some((r) => r.season === year && r.round === rnd && r.session === s.spec.code);
    panels[s.spec.slug] = <SessionPanel spec={s.spec} state={s.state} start={s.start} race={race} report={report} lookups={lookups} forecast={forecast} replayable={replayable} />;
  }

  return (
    <>
      <PageIntro
        label={
          <>
            <Link href={`/races/${year}`} className="hover:text-ink">
              {year} season
            </Link>
            <span className="mx-1.5 text-ink-3">/</span> Round {race.round}
            {race.hasSprint ? (
              <>
                <span className="mx-1.5 text-ink-3">/</span> Sprint weekend
              </>
            ) : null}
          </>
        }
        title={race.raceName}
        dek={
          <>
            <Link href={`/circuits/${race.circuitId}`} className="text-ink hover:underline underline-offset-2">
              {race.circuitName}
            </Link>
            , {race.locality},{" "}
            <span className="inline-flex items-baseline gap-1.5 whitespace-nowrap">
              <Flag of={race.country} fallback={race.countryCode} className="self-center" />
              {race.country}
            </span>
            . {race.time ? <LocalTime iso={race.time} options={RACE_TIME} /> : raceDateText}.{race.scheduledLaps ? ` ${race.scheduledLaps} laps.` : ""}
          </>
        }
        extra={pager}
        aside={<HeadlineStack items={headline} season={year} />}
      />

      <RacePrediction record={prediction} forecastDrivers={prediction ? [] : forecast?.drivers ?? []} publicationVerified={publicationVerified} />

      <SessionSwitcher key={`${year}-${rnd}-${initial}`} tabs={tabs} panels={panels} initial={initial} />


      <div className="mx-auto mt-10 w-full max-w-[1440px] px-4 sm:mt-14 sm:px-6">{pager}</div>
    </>
  );
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

interface WeekendSession {
  spec: SessionSpec;
  start: string | null;
  state: SessionState;
}

/**
 * The weekend's sessions in running order with their state. Rounds from the history database
 * may lack session times; a qualifying, sprint or race with results still gets a tab.
 */
function weekendSessions(race: Race, now: Date): WeekendSession[] {
  const list: WeekendSession[] = [];
  for (const spec of SESSION_SPECS) {
    const start = race.sessions[spec.key] ?? null;
    if (start) {
      list.push({ spec, start, state: sessionState(spec, start, now) });
    } else if (hasHistory(race, spec)) {
      list.push({ spec, start: null, state: "done" });
    }
  }
  const allTimed = list.every((s) => s.start !== null);
  if (allTimed) list.sort((a, b) => new Date(a.start as string).getTime() - new Date(b.start as string).getTime());
  return list;
}

/** Timing exports of every session that has finished, by timing code. */
async function loadReports(race: Race, sessions: WeekendSession[]): Promise<Map<string, SessionReport>> {
  const done = sessions.filter((s) => s.state === "done");
  const loaded = await Promise.all(done.map((s) => getSessionReport(race.season, race.round, s.spec.code)));
  const reports = new Map<string, SessionReport>();
  done.forEach((s, i) => {
    const report = loaded[i];
    if (report) reports.set(s.spec.code, report);
  });
  return reports;
}

/**
 * The session to open by default: the race once it has results, else the latest finished
 * session with data, else the latest finished one, else the first.
 */
function initialSession(sessions: WeekendSession[], race: Race, reports: Map<string, SessionReport>): string {
  const done = sessions.filter((s) => s.state === "done");
  const withData = done.filter((s) => reports.has(s.spec.code) || hasHistory(race, s.spec));
  const raceSession = withData.find((s) => s.spec.code === "R");
  const pick = raceSession ?? withData.at(-1) ?? done.at(-1) ?? sessions[0];
  return pick?.spec.slug ?? "race";
}

function sessionState(spec: SessionSpec, start: string, now: Date): SessionState {
  if (sessionFinished(spec.key, start, now)) return "done";
  if (new Date(start).getTime() <= now.getTime()) return "live";
  return "upcoming";
}

function hasHistory(race: Race, spec: SessionSpec): boolean {
  if (spec.code === "R") return race.results.length > 0;
  if (spec.code === "S") return race.sprint.length > 0;
  if (spec.code === "Q") return race.qualifying.length > 0;
  return false;
}

/** Winner, pole and fastest lap of the race, as codes with the team logo. */
function headlineItems(race: Race, lookups: Lookups): HeadlineItem[] {
  const winner = race.results.find((r) => r.position === 1) ?? null;
  const pole = race.results.find((r) => r.grid === 1) ?? race.qualifying.find((r) => r.position === 1) ?? null;
  const fastest = race.results.find((r) => r.fastestLapRank === 1) ?? null;
  const teamOf = (constructorId: string) => ({ constructorId, name: lookups.teamName(constructorId), color: lookups.teamColor(constructorId) });
  return [
    { label: "Winner", value: winner ? lookups.driverCode(winner.driverId) : "–", note: winner ? lookups.teamName(winner.constructorId) : "Not run yet", team: winner ? teamOf(winner.constructorId) : undefined },
    { label: "Pole", value: pole ? lookups.driverCode(pole.driverId) : "–", note: pole ? lookups.teamName(pole.constructorId) : "", team: pole ? teamOf(pole.constructorId) : undefined },
    { label: "Fastest lap", value: fastest ? lookups.driverCode(fastest.driverId) : "–", note: fastest?.fastestLapMs ? formatLapTime(fastest.fastestLapMs) : "", team: fastest ? teamOf(fastest.constructorId) : undefined },
  ];
}
