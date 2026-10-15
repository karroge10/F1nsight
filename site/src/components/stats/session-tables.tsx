import Link from "next/link";
import type { Lookups, SessionReport, SessionStint } from "@/lib/data";
import { formatGap, formatLapTime } from "@/lib/format";
import { lapsCompleted, longRuns, partTime, qualifyingGroups } from "@/lib/session-report";
import { DriverTag } from "./driver-tag";
import { Figure } from "@/components/ui/figure";
import { SortableTable, type SortColumn } from "@/components/ui/sortable-table";

interface ReportTableProps {
  report: SessionReport;
  lookups: Lookups;
}

/** Practice: everyone by best lap, with the gap to the fastest, the tyre it was set on and laps run. */
export function PracticeTable({ report, lookups }: ReportTableProps) {
  const fastest = report.classification.find((r) => r.position === 1)?.bestLapMs ?? null;
  return (
    <div className="scroll-x">
      <SortableTable className="data-table phone-tight sm:min-w-[560px]" columns={PRACTICE_COLUMNS} initialKey="pos" initialDir="asc"
        rows={report.classification.map((row, i) => {
            const hasLap = row.bestLapMs !== null;
            const gap = hasLap && fastest !== null && row.position !== 1 ? formatGap((row.bestLapMs as number) - fastest) : "";
            const laps = lapsCompleted(report, row.driverId);
            const values = { pos: i, name: lookups.driverName(row.driverId), best: row.bestLapMs, laps };
            const tr = (
              <tr className={hasLap ? "" : "text-ink-3"}>
                <td className="num text-ink-2">{row.positionText || "–"}</td>
                <DriverCell driverId={row.driverId} lookups={lookups} constructorId={constructorOf(report, row.driverId)} season={report.season} />
                <TeamCell constructorId={constructorOf(report, row.driverId)} lookups={lookups} />
                <td className={"num " + (row.position === 1 ? "text-sector-purple" : "text-ink")}>{hasLap ? formatLapTime(row.bestLapMs) : "No time"}</td>
                <td className="num text-ink-2">{gap}</td>
                <td className="num hidden text-ink-3 sm:table-cell">{row.bestLapNumber ?? ""}</td>
                <td className="num">
                  <TyreChip compound={row.bestLapCompound} />
                </td>
                <td className="num text-ink-2">{laps}</td>
              </tr>
            );
            return { key: row.driverId, values, row: tr };
          })}
      />
    </div>
  );
}

/** Qualifying and sprint qualifying: the three parts with the gap inside the part a driver went out in. */
export function QualifyingReportTable({ report, lookups }: ReportTableProps) {
  const groups = qualifyingGroups(report);
  const prefix = report.code === "SQ" ? "SQ" : "Q";
  const bestOfPart = (stage: 1 | 2 | 3) => groups.find((g) => g.stage === stage)?.bestMs ?? null;
  return (
    <div className="scroll-x">
      <table className="data-table phone-tight sm:min-w-[560px]">
        <thead>
          <tr>
            <th className="num w-10">Pos</th>
            <th>Driver</th>
            <th className="hidden md:table-cell">Team</th>
            <th className="num">{prefix}1</th>
            <th className="num">{prefix}2</th>
            <th className="num">{prefix}3</th>
            <th className="num">Gap</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((group) => (
            <GroupRows key={group.stage} group={group} prefix={prefix} report={report} lookups={lookups} bestOfPart={bestOfPart} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Practice long runs: stints of five or more representative laps, fastest average first. */
export function LongRunsTable({ report, lookups }: ReportTableProps) {
  const runs = longRuns(report);
  if (runs.length === 0) return <p className="text-ui text-ink-2">No run of five or more representative laps.</p>;
  const fastest = runs[0].averageMs;
  return (
    <div className="scroll-x">
      <SortableTable className="data-table sm:min-w-[420px]" columns={LONG_RUN_COLUMNS} initialKey="average" initialDir="asc"
        rows={runs.map((run, i) => ({
          key: `${run.driverId}-${i}`,
          values: { name: lookups.driverName(run.driverId), laps: run.laps, average: run.averageMs, best: run.bestMs },
          row: (
            <tr>
              <DriverCell driverId={run.driverId} lookups={lookups} constructorId={constructorOf(report, run.driverId)} season={report.season} />
              <td className="num">
                <TyreChip compound={run.compound} />
              </td>
              <td className="num text-ink-2">{run.laps}</td>
              <td className={"num " + (i === 0 ? "text-sector-purple" : "text-ink")}>{formatLapTime(run.averageMs)}</td>
              <td className="num text-ink-2">{i === 0 ? "" : formatGap(run.averageMs - fastest)}</td>
              <td className="num hidden text-ink-3 sm:table-cell">{formatLapTime(run.bestMs)}</td>
            </tr>
          ),
        }))}
      />
    </div>
  );
}

/** Tyre strategy: one bar per driver in finishing order, a segment per stint, coloured by compound. */
export function StintChart({ report, lookups }: ReportTableProps) {
  const totalLaps = Math.max(...report.stints.map((s) => s.lapEnd ?? 0), 1);
  const byDriver = new Map<string, SessionStint[]>();
  for (const stint of report.stints) {
    const list = byDriver.get(stint.driverId) ?? [];
    list.push(stint);
    byDriver.set(stint.driverId, list);
  }
  const order = report.classification.map((r) => r.driverId).filter((id) => byDriver.has(id));
  return (
    <div className="flex flex-col gap-1.5">
      {order.map((driverId) => {
        const stints = byDriver.get(driverId) ?? [];
        const constructorId = constructorOf(report, driverId);
        return (
          <div key={driverId} className="grid grid-cols-[3.5rem_1fr] items-center gap-x-3 text-caption">
            <DriverTag text={lookups.driverCode(driverId)} team={teamOf(constructorId, lookups)} season={report.season} logo={16} className="timing gap-1.5 text-ink-2" />
            <div className="flex h-4 w-full gap-px overflow-hidden rounded-chip">
              {stints.map((s) => {
                const width = ((s.lapEnd ?? 0) - (s.lapStart ?? 1) + 1) / totalLaps;
                const widthPercent = `${Math.max(width * 100, 0.5)}%`;
                return (
                  <span
                    key={s.stint}
                    className="stint flex items-center justify-center overflow-hidden whitespace-nowrap text-[0.625rem] font-[650] leading-none"
                    data-compound={s.compound ?? ""}
                    style={{ width: widthPercent }}
                    title={`${compoundName(s.compound)}, laps ${s.lapStart ?? "?"} to ${s.lapEnd ?? "?"} (${s.laps})`}
                  >
                    {s.laps >= 4 ? `${s.compound ?? "?"} ${s.laps}` : s.laps >= 2 ? s.compound ?? "" : ""}
                  </span>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Conditions and session bests: weather range, fastest sectors and the speed trap. */
export function SessionFacts({ report, lookups }: ReportTableProps) {
  const weather = report.weather;
  const trap = report.speedTrap[0] ?? null;
  const tiles: { label: string; value: string; note?: string }[] = [];
  if (weather) {
    tiles.push({ label: "Air", value: rangeText(weather.airTemp, "°C") });
    tiles.push({ label: "Track", value: rangeText(weather.trackTemp, "°C") });
    if (weather.humidity !== null) tiles.push({ label: "Humidity", value: `${Math.round(weather.humidity)}%` });
    if (weather.windSpeed !== null) tiles.push({ label: "Wind", value: `${weather.windSpeed.toFixed(1)} m/s`, note: weather.rainfall ? "Rain during the session" : "Dry" });
  }
  for (const sector of report.sectorBests) {
    tiles.push({ label: `Sector ${sector.sector}`, value: formatLapTime(sector.ms), note: lookups.driverCode(sector.driverId) });
  }
  if (trap) tiles.push({ label: "Speed trap", value: `${Math.round(trap.kph)} km/h`, note: lookups.driverCode(trap.driverId) });
  if (tiles.length === 0) return null;
  return (
    <div className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-4 lg:grid-cols-8">
      {tiles.map((t) => (
        <Figure key={t.label} label={t.label} value={<span className="timing">{t.value}</span>} note={t.note} />
      ))}
    </div>
  );
}

/** Tyre compound letter in a ring of the compound's colour. */
export function TyreChip({ compound }: { compound: string | null }) {
  if (!compound) return <span className="text-ink-3">–</span>;
  return (
    <span className="tyre" data-compound={compound} title={compoundName(compound)}>
      {compound}
    </span>
  );
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

const PRACTICE_COLUMNS: SortColumn[] = [
  { key: "pos", label: "Pos", firstDir: "asc", className: "num w-10" },
  { key: "name", label: "Driver", firstDir: "asc" },
  { label: "Team", className: "hidden md:table-cell" },
  { key: "best", label: "Best lap", firstDir: "asc", className: "num" },
  { label: "Gap", className: "num" },
  { label: "On lap", className: "num hidden sm:table-cell" },
  { label: "Tyre", className: "num" },
  { key: "laps", label: "Laps run", className: "num" },
];

const LONG_RUN_COLUMNS: SortColumn[] = [
  { key: "name", label: "Driver", firstDir: "asc" },
  { label: "Tyre", className: "num" },
  { key: "laps", label: "Laps", className: "num" },
  { key: "average", label: "Average", firstDir: "asc", className: "num" },
  { label: "Gap", className: "num" },
  { key: "best", label: "Best", firstDir: "asc", className: "num hidden sm:table-cell" },
];

interface GroupRowsProps {
  group: ReturnType<typeof qualifyingGroups>[number];
  prefix: string;
  report: SessionReport;
  lookups: Lookups;
  bestOfPart: (stage: 1 | 2 | 3) => number | null;
}

function GroupRows({ group, prefix, report, lookups, bestOfPart }: GroupRowsProps) {
  const columnCount = 7;
  return (
    <>
      {group.stage !== 3 ? (
        <tr className="group-divider">
          <td colSpan={columnCount} className="text-caption text-ink-3">
            Out in {prefix}
            {group.stage}
          </td>
        </tr>
      ) : null}
      {group.rows.map((row) => {
        const own = partTime(row, group.stage);
        const gap = own !== null && group.bestMs !== null && own !== group.bestMs ? formatGap(own - group.bestMs) : "";
        return (
          <tr key={row.driverId}>
            <td className="num text-ink-2">{row.positionText || ""}</td>
            <DriverCell driverId={row.driverId} lookups={lookups} constructorId={constructorOf(report, row.driverId)} season={report.season} />
            <TeamCell constructorId={constructorOf(report, row.driverId)} lookups={lookups} />
            <PartCell ms={row.q1Ms} best={bestOfPart(1)} />
            <PartCell ms={row.q2Ms} best={bestOfPart(2)} />
            <PartCell ms={row.q3Ms} best={bestOfPart(3)} />
            <td className="num text-ink-2">{gap}</td>
          </tr>
        );
      })}
    </>
  );
}

function PartCell({ ms, best }: { ms: number | null; best: number | null }) {
  const purple = ms !== null && best !== null && ms === best;
  return <td className={"num " + (purple ? "text-sector-purple" : ms !== null ? "text-ink" : "text-ink-3")}>{formatLapTime(ms)}</td>;
}

function DriverCell({ driverId, constructorId, lookups, season }: { driverId: string; constructorId: string; lookups: Lookups; season: number }) {
  return (
    <td>
      <DriverTag text={lookups.driverName(driverId)} compactText={lookups.driverCode(driverId)} team={teamOf(constructorId, lookups)} season={season} href={`/drivers/${driverId}`} className="font-[550] text-ink" />
    </td>
  );
}

function teamOf(constructorId: string, lookups: Lookups) {
  return { constructorId, name: lookups.teamName(constructorId), color: lookups.teamColor(constructorId) };
}

function TeamCell({ constructorId, lookups }: { constructorId: string; lookups: Lookups }) {
  return (
    <td className="hidden text-ink-2 md:table-cell">
      <Link href={`/teams/${constructorId}`} className="hover:underline underline-offset-2">
        {lookups.teamName(constructorId)}
      </Link>
    </td>
  );
}

function constructorOf(report: SessionReport, driverId: string): string {
  return report.drivers.find((d) => d.driverId === driverId)?.constructorId ?? "";
}

function compoundName(compound: string | null): string {
  switch (compound) {
    case "S":
      return "Soft";
    case "M":
      return "Medium";
    case "H":
      return "Hard";
    case "I":
      return "Intermediate";
    case "W":
      return "Wet";
    default:
      return "Unknown tyre";
  }
}

function rangeText(range: [number | null, number | null], unit: string): string {
  const [low, high] = range;
  if (low === null || high === null) return "–";
  if (Math.round(low) === Math.round(high)) return `${Math.round(low)}${unit}`;
  return `${Math.round(low)} to ${Math.round(high)}${unit}`;
}
