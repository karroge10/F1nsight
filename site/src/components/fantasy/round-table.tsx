"use client";

// Round by round table shared by the Backtest and Hindsight views: team, transfers in and out,
// Boost, chip, points, running total and the money columns, sortable by round, points and money.
// Picks and transfers list the constructors first, then the drivers, with a wider gap between
// the two groups.

import { chipLabel, type BacktestPick } from "@/lib/fantasy/backtest-data";
import { Flag } from "@/components/ui/flag";
import { TeamMark } from "@/components/ui/team-mark";
import { ResetSort, SortTh, sortRows, useSort, type SortDir, type SortValue } from "@/components/ui/sortable";

export interface RoundTableRow {
  round: number;
  raceName: string;
  raceCode: string;
  country: string | null;
  constructors: BacktestPick[];
  drivers: BacktestPick[];
  /** Codes of the constructors and drivers brought in, and taken out. */
  constructorsIn: string[];
  driversIn: string[];
  constructorsOut: string[];
  driversOut: string[];
  boost: string | null;
  extraBoost: string | null;
  chip: string | null;
  penalty: number;
  points: number;
  cumulative: number;
  /** Team value plus bank going into the round ($M); null when the view has no budget. */
  costCap: number | null;
  /** Money not spent after the round's transfers ($M); null when the view has no budget. */
  left: number | null;
  /** Price of the team ($M), shown when there is no Cost Cap. */
  cost: number | null;
}

type RoundSort = "round" | "points" | "costCap" | "left" | "cost";

const TH = "px-2 py-2 font-normal";

export function RoundTable({ rows }: { rows: RoundTableRow[] }) {
  const { sort, toggle, reset, isDefault } = useSort<RoundSort>("round", "asc");
  const withCap = rows.some((r) => r.costCap !== null);
  const withCost = !withCap && rows.some((r) => r.cost !== null);
  const sorted = sortRows(rows, sort, roundValue);
  const head = (key: RoundSort, label: string, firstDir: SortDir = "desc") => (
    <SortTh sortKey={key} sort={sort} onSort={toggle} firstDir={firstDir} className={TH}>
      {label}
    </SortTh>
  );
  return (
    <>
      <ResetSort onReset={reset} isDefault={isDefault} />
      <div className="overflow-x-auto rounded-float border border-rule">
        <table className="w-full min-w-[880px] text-ui tabular-nums">
          <thead className="text-left text-ink-3">
            <tr className="border-b border-rule">
              <SortTh sortKey="round" sort={sort} onSort={toggle} firstDir="asc" align="start" className={TH}>
                Round
              </SortTh>
              <th className={TH}>Team</th>
              <th className={TH}>In</th>
              <th className={TH}>Out</th>
              <th className={TH}>Boost</th>
              <th className={TH}>Chip</th>
              {head("points", "Pts")}
              <th className={TH + " text-right"}>Total</th>
              {withCap ? head("costCap", "Cost cap") : null}
              {withCap ? head("left", "Left") : null}
              {withCost ? head("cost", "Team cost") : null}
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => (
              <Row key={r.round} row={r} withCap={withCap} withCost={withCost} />
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function Row({ row, withCap, withCost }: { row: RoundTableRow; withCap: boolean; withCost: boolean }) {
  const chip = chipLabel(row.chip);
  return (
    <tr className="border-b border-rule last:border-b-0 hover:bg-bg-raised" data-round={row.round}>
      <td className="whitespace-nowrap px-2 py-1.5" title={row.raceName}>
        <span className="inline-flex items-center gap-2">
          <span className="w-5 text-ink-3">{row.round}</span>
          <Flag of={row.country} size={16} />
          <span className="font-[600]">{row.raceCode}</span>
        </span>
      </td>
      <td className="px-2 py-1.5">
        <span className="flex items-center gap-x-2 whitespace-nowrap">
          {row.constructors.map((p) => (
            <PickChip key={p.code} pick={p} />
          ))}
          <span className="w-2" aria-hidden="true" />
          {row.drivers.map((p) => (
            <PickChip key={p.code} pick={p} />
          ))}
        </span>
      </td>
      <td className="whitespace-nowrap px-2 py-1.5">
        <span className="inline-flex items-center">
          <Codes teams={row.constructorsIn} drivers={row.driversIn} tone="text-delta-up" />
          {row.penalty ? <span className="timing ms-2 rounded-chip bg-[color-mix(in_oklch,var(--delta-down)_16%,transparent)] px-1 py-px text-caption font-[650] text-delta-down" title="Points penalty for extra transfers">−{row.penalty}</span> : null}
        </span>
      </td>
      <td className="whitespace-nowrap px-2 py-1.5">
        <Codes teams={row.constructorsOut} drivers={row.driversOut} tone="text-ink-2" />
      </td>
      <td className="timing whitespace-nowrap px-2 py-1.5">
        <BoostCell row={row} />
      </td>
      <td className="whitespace-nowrap px-2 py-1.5">{chip ?? ""}</td>
      <td className="px-2 py-1.5 text-right timing">{Math.round(row.points)}</td>
      <td className="px-2 py-1.5 text-right timing text-ink-2">{Math.round(row.cumulative)}</td>
      {withCap ? <td className="px-2 py-1.5 text-right timing text-ink">{row.costCap === null ? "" : row.costCap.toFixed(1)}</td> : null}
      {withCap ? <td className="px-2 py-1.5 text-right timing text-ink-3">{row.left === null ? "" : row.left.toFixed(1)}</td> : null}
      {withCost ? <td className="px-2 py-1.5 text-right timing text-ink-2">{row.cost === null ? "" : row.cost.toFixed(1)}</td> : null}
    </tr>
  );
}

function roundValue(row: RoundTableRow, key: RoundSort): SortValue {
  if (key === "round") return row.round;
  if (key === "points") return row.points;
  if (key === "costCap") return row.costCap;
  if (key === "left") return row.left;
  return row.cost;
}

/** Transfer codes with room between them, constructors first, a wider gap before the drivers. */
function Codes({ teams, drivers, tone }: { teams: string[]; drivers: string[]; tone: string }) {
  if (teams.length === 0 && drivers.length === 0) return null;
  return (
    <span className={"timing inline-flex items-center gap-x-1.5 " + tone}>
      {teams.map((c) => (
        <span key={c}>{c}</span>
      ))}
      {teams.length > 0 && drivers.length > 0 ? <span className="w-2" aria-hidden="true" /> : null}
      {drivers.map((c) => (
        <span key={c}>{c}</span>
      ))}
    </span>
  );
}

/** Boost driver, with the 3x Boost driver first when that chip is played; autopilot shows "auto". */
function BoostCell({ row }: { row: RoundTableRow }) {
  if (row.chip === "autopilot") return <span className="text-ink-2">auto</span>;
  if (!row.extraBoost) return <>{row.boost}</>;
  return (
    <span className="inline-flex items-baseline gap-2">
      <span>
        {row.extraBoost}
        <span className="ms-0.5 text-caption text-ink-3">x3</span>
      </span>
      {row.boost ? (
        <span>
          {row.boost}
          <span className="ms-0.5 text-caption text-ink-3">x2</span>
        </span>
      ) : null}
    </span>
  );
}

function PickChip({ pick }: { pick: BacktestPick }) {
  const tone = pick.changed ? "text-delta-up" : "text-ink";
  return (
    <span className={"timing inline-flex items-center gap-1 " + tone}>
      <TeamMark color={pick.color} />
      {pick.code}
    </span>
  );
}
