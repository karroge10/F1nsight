"use client";

// Hindsight season: the best team of every scored round on real points, played as a season in
// the same round by round table as the backtest. "No budget" ignores prices; "Budget" starts at
// the $100M every game season starts with and carries the Cost Cap from round to round. The x3
// Boost and (with a budget) Limitless sit on the rounds where they add most.

import { useMemo, useState } from "react";
import { hindsightPath, STARTING_COST_CAP, type HindsightPathRound, type HindsightRoundInput } from "@/lib/fantasy/hindsight";
import type { BacktestPick } from "@/lib/fantasy/backtest-data";
import { RoundTable, type RoundTableRow } from "@/components/fantasy/round-table";
import { Section } from "@/components/ui/section";
import { IconHistory, IconTrophy } from "@/components/icons";
import { formatMoney } from "@/lib/format";

export interface HindsightLabels {
  codes: Record<string, string>;
  names: Record<string, string>;
  colors: Record<string, string>;
}

interface HindsightViewProps {
  season: number;
  inputs: HindsightRoundInput[];
  labels: HindsightLabels;
}

type Mode = "free" | "budget";

const MODES: { key: Mode; label: string }[] = [
  { key: "free", label: "No budget" },
  { key: "budget", label: "Budget" },
];

const SEASON_INFO =
  "Best team of every round on the points actually scored, as if every round had unlimited free transfers. x3 Boost and Limitless go on their best rounds; Wildcard and Autopilot add nothing here. Not achievable, it shows the ceiling.";

export function HindsightView({ season, inputs, labels }: HindsightViewProps) {
  const [mode, setMode] = useState<Mode>("budget");
  const free = useMemo(() => hindsightPath(inputs, false), [inputs]);
  const budget = useMemo(() => hindsightPath(inputs, true), [inputs]);
  const path = mode === "budget" ? budget : free;
  const rows = useMemo(() => tableRows(path, labels), [path, labels]);
  const freeTotal = sumBy(free, (r) => r.team.score);
  const budgetTotal = sumBy(budget, (r) => r.team.score);
  const lastCap = budget.length ? (budget[budget.length - 1].costCap ?? STARTING_COST_CAP) : STARTING_COST_CAP;

  return (
    <>
      <Section title={`${season} best teams in hindsight`} icon={IconTrophy} info={SEASON_INFO} flush tight>
        <div className="grid gap-4">
          <div role="tablist" aria-label="Budget" className="inline-flex h-8 w-fit items-stretch rounded-control border border-rule">
            {MODES.map((m) => {
              const active = m.key === mode;
              return (
                <button key={m.key} type="button" role="tab" aria-selected={active} onClick={() => setMode(m.key)} className={"press segment -my-px rounded-control px-3.5 text-ui " + (active ? "segment-on font-[600]" : "text-ink-2 hover:text-ink")}>
                  {m.label}
                </button>
              );
            })}
          </div>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 rounded-float border border-rule p-4 sm:grid-cols-4">
            <Stat label="No budget" value={freeTotal.toFixed(0)} note="pts" testId="total-free" />
            <Stat label="Budget" value={budgetTotal.toFixed(0)} note={`pts from ${formatMoney(STARTING_COST_CAP)}`} testId="total-capped" />
            <Stat label="Cost cap now" value={formatMoney(lastCap)} note={`R${budget[budget.length - 1]?.round ?? 1}`} />
            <Stat label="Rounds" value={String(path.length)} />
          </dl>
        </div>
      </Section>

      <Section title="Round by round" icon={IconHistory} flush>
        <RoundTable rows={rows} />
        <p className="mt-2 text-caption text-ink-2">
          Green: new that round. {mode === "budget" ? "Cost cap: team value plus bank going into the round, $M, starting at $100M. Left: money not spent." : "Team cost in $M at that round's prices."}
        </p>
      </Section>
    </>
  );
}

function Stat({ label, value, note, testId }: { label: string; value: string; note?: string; testId?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <dt className="text-ui text-ink-3">{label}</dt>
      <dd className="flex items-baseline gap-1.5">
        <span className="timing text-lg font-[650] text-ink" data-testid={testId}>
          {value}
        </span>
        {note ? <span className="timing text-ui text-ink-3">{note}</span> : null}
      </dd>
    </div>
  );
}

// ------------------------------------------------------------------------------ helpers

/** Table rows: picks marked new against the round before, transfers as the difference. */
function tableRows(path: HindsightPathRound[], labels: HindsightLabels): RoundTableRow[] {
  let cumulative = 0;
  return path.map((r, k) => {
    const previous = k > 0 ? path[k - 1].team : null;
    const before = new Set(previous ? [...previous.drivers, ...previous.constructors] : []);
    const now = new Set([...r.team.drivers, ...r.team.constructors]);
    cumulative += r.team.score;
    const code = (id: string) => labels.codes[id] ?? id.slice(0, 3).toUpperCase();
    const pick = (id: string): BacktestPick => ({ code: code(id), color: labels.colors[id] ?? "var(--rule)", changed: previous !== null && !before.has(id) });
    const added = (ids: string[]) => (previous ? ids.filter((id) => !before.has(id)).map(code) : []);
    const removed = (ids: string[]) => ids.filter((id) => !now.has(id)).map(code);
    return {
      round: r.round,
      raceName: r.raceName,
      raceCode: r.raceCode,
      country: r.country,
      constructors: r.team.constructors.map(pick),
      drivers: r.team.drivers.map(pick),
      constructorsIn: added(r.team.constructors),
      driversIn: added(r.team.drivers),
      constructorsOut: previous ? removed(previous.constructors) : [],
      driversOut: previous ? removed(previous.drivers) : [],
      boost: code(r.team.boost),
      extraBoost: r.team.extraBoost ? code(r.team.extraBoost) : null,
      chip: r.chip,
      penalty: 0,
      points: r.team.score,
      cumulative,
      costCap: r.costCap,
      left: r.left,
      cost: r.team.cost,
    };
  });
}

function sumBy<T>(items: T[], pick: (item: T) => number): number {
  let total = 0;
  for (const item of items) total += pick(item);
  return total;
}
