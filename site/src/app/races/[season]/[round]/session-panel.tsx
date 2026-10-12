import Link from "next/link";
import type { Lookups, PitStop, PredictionHistoryEntry, QualifyingRow, Race, ResultRow, SessionReport } from "@/lib/data";
import { formatGap, formatLapTime, formatRaceTime } from "@/lib/format";
import { analyseRace, toPitStopRows } from "@/lib/race-analysis";
import { sessionName, type SessionSpec } from "@/lib/sessions";
import { toRaceLaps, toResultRows } from "@/lib/session-report";
import { LocalTime } from "@/components/ui/local-time";
import { Section } from "@/components/ui/section";
import { QualifyingTable } from "@/components/stats/results-table";
import { LapChart } from "@/components/stats/lap-chart";
import { LongRunsTable, PracticeTable, QualifyingReportTable, SessionFacts, StintChart } from "@/components/stats/session-tables";
import { RaceAnalysisTiles } from "@/components/stats/race-analysis";
import { RaceDetailPair } from "@/components/stats/race-detail-pair";
import { SessionPodium, type PodiumEntry } from "@/components/stats/session-podium";
import { WeekendResultsTable } from "@/components/stats/weekend-results-table";
import { ReplayLink } from "@/components/stats/replay-link";
import { IconChequered, IconForecast, IconGauge, IconGridSlot, IconPitBox, IconSprint, IconThermometer, IconTimer, type IconComponent } from "@/components/icons";

export type SessionState = "done" | "live" | "upcoming";

export interface SessionPanelProps {
  spec: SessionSpec;
  state: SessionState;
  /** Scheduled start, or null for history-only sessions without a time. */
  start: string | null;
  race: Race;
  /** The timing export of this session, when there is one. */
  report: SessionReport | null;
  /** Site lookups, already merged with the report's entry list. */
  lookups: Lookups;
  forecast: PredictionHistoryEntry | null;
  /** True when the session replays from the files written at build time. */
  replayable: boolean;
}

const START_TIME: Intl.DateTimeFormatOptions = { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" };

/** Everything the weekend page shows for one session: podium, tables, charts and conditions. */
export function SessionPanel(props: SessionPanelProps) {
  const { spec, state, start } = props;
  const label = sessionName(spec.key);
  if (state === "upcoming") {
    return (
      <Section title={label} icon={iconFor(spec)}>
        <p className="text-ui text-ink-2">
          Not run yet{start ? <>, starts <LocalTime iso={start} options={START_TIME} /></> : null}. See the{" "}
          <Link href="/" className="text-ink underline underline-offset-2">
            forecast
          </Link>
          .
        </p>
      </Section>
    );
  }
  if (state === "live") {
    return (
      <Section title={label} icon={iconFor(spec)}>
        <p className="text-ui text-ink-2">
          Running now. Follow it on{" "}
          <Link href="/live" className="text-ink underline underline-offset-2">
            live timing
          </Link>
          ; results land here within an hour of the chequered flag.
        </p>
      </Section>
    );
  }
  if (spec.code === "R" || spec.code === "S") return <RacePanel {...props} />;
  if (spec.code === "Q" || spec.code === "SQ") return <QualifyingPanel {...props} />;
  return <PracticePanel {...props} />;
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function RacePanel({ spec, race, report, lookups, forecast, replayable }: SessionPanelProps) {
  const isRace = spec.code === "R";
  const history = isRace ? race.results : race.sprint;
  const results = history.length > 0 ? history : report ? toResultRows(report) : [];
  if (results.length === 0) return <NoData spec={spec} />;
  const season = race.season;
  const historyStops = isRace ? (race.laps?.pitStops ?? []) : [];
  const pitStops = historyStops.length > 0 ? historyStops : reportStops(report);
  const overtakes = (report?.overtakes ?? []).map((o) => ({ driverId: o.driverId, count: o.count }));
  const analysis = analyseRace(results, pitStops, overtakes, isRace ? forecast : null);
  const pitStopRows = toPitStopRows(pitStops, results, lookups);
  const historyLaps = isRace ? race.laps : null;
  const raceLaps = historyLaps ?? (report ? toRaceLaps(report) : null);
  const fastestLaps = results.filter((r) => r.fastestLapRank !== null).sort((a, b) => (a.fastestLapRank ?? 99) - (b.fastestLapRank ?? 99)).slice(0, 10);
  const classified = results.filter((r) => r.classified).length;
  const podium = podiumFromResults(results, lookups);
  const label = sessionName(spec.key);
  return (
    <>
      <Section title={label} icon={iconFor(spec)} info={`${classified} classified of ${results.length} starters. Overtakes are on-track passes; stops leave out red flag stoppages.`} aside={<ReplayLink season={race.season} round={race.round} code={spec.code} prerendered={replayable} />}>
        <SessionPodium entries={podium} season={season} label={`${label} podium`} />
        <div className="mt-8">
          <RaceAnalysisTiles analysis={analysis} lookups={lookups} season={season} />
        </div>
        <div className="mt-6">
          <WeekendResultsTable results={results} analysis={analysis} lookups={lookups} season={season} compact={!isRace} />
        </div>
      </Section>
      {report && report.stints.length > 0 ? (
        <Section title="Tyre strategy" icon={IconPitBox} info="One bar per driver in finishing order, a segment per stint with the compound and its length in laps.">
          <StintChart report={report} lookups={lookups} />
        </Section>
      ) : null}
      {raceLaps ? (
        <Section title="Lap chart" icon={IconForecast} info="Position of every car at the end of each lap.">
          <LapChart laps={raceLaps} results={results} lookups={lookups} />
        </Section>
      ) : null}
      <RaceDetailPair fastestLaps={fastestLaps} pitStops={pitStopRows} pitInfo={`${pitStops.length} stops. Pit lane time from pit entry to pit exit; over two minutes means a red flag stoppage.`} lookups={lookups} season={season} />
      <Conditions report={report} lookups={lookups} />
    </>
  );
}

function QualifyingPanel({ spec, race, report, lookups, replayable }: SessionPanelProps) {
  const history = spec.code === "Q" ? race.qualifying : [];
  if (!report && history.length === 0) return <NoData spec={spec} />;
  const label = sessionName(spec.key);
  const podium = report ? podiumFromQualifyingReport(report, lookups) : podiumFromQualifyingRows(history, lookups);
  return (
    <>
      <Section title={label} icon={iconFor(spec)} info="Before grid penalties. The gap is to the fastest time of the part a driver went out in." aside={<ReplayLink season={race.season} round={race.round} code={spec.code} prerendered={replayable} />}>
        <SessionPodium entries={podium} season={race.season} label={`${label} top three`} />
        <div className="mt-6">{report ? <QualifyingReportTable report={report} lookups={lookups} /> : <QualifyingTable qualifying={history} lookups={lookups} season={race.season} />}</div>
      </Section>
      <Conditions report={report} lookups={lookups} />
    </>
  );
}

function PracticePanel({ spec, race, report, lookups, replayable }: SessionPanelProps) {
  if (!report) return <NoData spec={spec} />;
  const label = sessionName(spec.key);
  const timed = report.classification.filter((r) => r.bestLapMs !== null).length;
  const podium = podiumFromPractice(report, lookups);
  return (
    <>
      <Section title={label} icon={iconFor(spec)} info={`By best lap. ${timed} of ${report.drivers.length} drivers set a time.`} aside={<ReplayLink season={race.season} round={race.round} code={spec.code} prerendered={replayable} />}>
        <SessionPodium entries={podium} season={race.season} label={`${label} fastest three`} />
        <div className="mt-6">
          <PracticeTable report={report} lookups={lookups} />
        </div>
      </Section>
      <Section title="Long runs" icon={IconGauge} info="Stints of five or more representative laps: timed, not deleted, no in or out laps, within 8% of the driver's best lap. Average lap time, fastest first." flush>
        <LongRunsTable report={report} lookups={lookups} />
      </Section>
      <Conditions report={report} lookups={lookups} />
    </>
  );
}

function NoData({ spec }: { spec: SessionSpec }) {
  return (
    <Section title={sessionName(spec.key)} icon={iconFor(spec)}>
      <p className="text-ui text-ink-2">Results not in yet. Timing data is picked up within an hour of the chequered flag.</p>
    </Section>
  );
}

function Conditions({ report, lookups }: { report: SessionReport | null; lookups: Lookups }) {
  if (!report) return null;
  return (
    <Section title="Conditions and bests" icon={IconThermometer}>
      <SessionFacts report={report} lookups={lookups} />
    </Section>
  );
}

function iconFor(spec: SessionSpec): IconComponent {
  if (spec.code === "R") return IconChequered;
  if (spec.code === "S") return IconSprint;
  if (spec.code === "Q" || spec.code === "SQ") return IconGridSlot;
  return IconTimer;
}

function reportStops(report: SessionReport | null): PitStop[] {
  if (!report) return [];
  return report.pitStops.map((p) => ({ driverId: p.driverId, stop: p.stop, lap: p.lap, durationMs: p.durationMs, localTime: null }));
}

/** Race or sprint: the winner's time, then each podium finisher's gap to it. */
function podiumFromResults(results: ResultRow[], lookups: Lookups): PodiumEntry[] {
  const winnerTime = results.find((r) => r.position === 1)?.timeMs ?? null;
  const top = results.filter((r) => r.classified && r.position !== null && r.position <= 3);
  return top.map((r) => {
    const gap = r.timeMs !== null && winnerTime !== null ? formatGap(r.timeMs - winnerTime) : r.status;
    const value = r.position === 1 ? formatRaceTime(r.timeMs) : gap;
    return entry(r.position as number, r.driverId, r.constructorId, value, lookups);
  });
}

/** Qualifying from the timing export: the pole lap, then the gap of P2 and P3 to it. */
function podiumFromQualifyingReport(report: SessionReport, lookups: Lookups): PodiumEntry[] {
  const top = report.classification.filter((r) => r.position !== null && r.position <= 3);
  const times = top.map((r) => ({ row: r, ms: r.q3Ms ?? r.q2Ms ?? r.q1Ms ?? r.bestLapMs }));
  return timedEntries(times, report, lookups);
}

/** Qualifying from the history database, for rounds without a timing export. */
function podiumFromQualifyingRows(rows: QualifyingRow[], lookups: Lookups): PodiumEntry[] {
  const top = rows.filter((q) => q.position !== null && q.position <= 3);
  const poleTime = bestPart(top.find((q) => q.position === 1));
  return top.map((q) => {
    const own = bestPart(q);
    const value = q.position === 1 ? formatLapTime(own) : gapText(own, poleTime);
    return entry(q.position as number, q.driverId, q.constructorId, value, lookups);
  });
}

/** Practice: the fastest lap, then the gap of the next two to it. */
function podiumFromPractice(report: SessionReport, lookups: Lookups): PodiumEntry[] {
  const top = report.classification.filter((r) => r.position !== null && r.position <= 3 && r.bestLapMs !== null);
  const times = top.map((r) => ({ row: r, ms: r.bestLapMs }));
  return timedEntries(times, report, lookups);
}

function timedEntries(times: { row: SessionReport["classification"][number]; ms: number | null }[], report: SessionReport, lookups: Lookups): PodiumEntry[] {
  const first = times.find((t) => t.row.position === 1)?.ms ?? null;
  return times.map(({ row, ms }) => {
    const constructorId = report.drivers.find((d) => d.driverId === row.driverId)?.constructorId ?? "";
    const value = row.position === 1 ? formatLapTime(ms) : gapText(ms, first);
    return entry(row.position as number, row.driverId, constructorId, value, lookups);
  });
}

function entry(position: number, driverId: string, constructorId: string, value: string, lookups: Lookups): PodiumEntry {
  const team = { constructorId, name: lookups.teamName(constructorId), color: lookups.teamColor(constructorId) };
  return { position, driverId, name: lookups.driverName(driverId), team, value };
}

function bestPart(row: QualifyingRow | undefined): number | null {
  if (!row) return null;
  return row.q3 ?? row.q2 ?? row.q1 ?? null;
}

function gapText(ms: number | null, reference: number | null): string {
  if (ms === null || reference === null) return "";
  return formatGap(ms - reference);
}
