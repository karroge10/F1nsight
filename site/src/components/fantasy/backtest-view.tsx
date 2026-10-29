"use client";

// Season backtest of the optimiser: one fixed method replayed from round 1 of every season on
// real prices and real points. Season switch, summary line, cumulative chart, then one row per round.

import { useState } from "react";
import { hindsightShare, signed, type BacktestRound, type BacktestSeason, type FantasyBacktest } from "@/lib/fantasy/backtest-data";
import { Section } from "@/components/ui/section";
import { Info } from "@/components/ui/info";
import { RoundTable, type RoundTableRow } from "@/components/fantasy/round-table";
import { IconHistory, IconTrophy } from "@/components/icons";
import { formatMoney } from "@/lib/format";

interface BacktestViewProps {
  data: FantasyBacktest;
}

const METHOD_NOTE = "Team picked before qualifying, model trained only on earlier races, real game points and prices.";
const METHOD_INFO =
  "Forecast: model blended with recent form, blend weight fitted on earlier seasons only. 2 free transfers a race, no carry-over, -10 per extra. Chips: Wildcard, Limitless, x3 Boost, Autopilot on the engine's advice; Final Fix and No Negative not played.";
const RANK_INFO_TAIL = "Points cutoffs for the global league are not public. A rank appears once cutoffs are added to WORLD_RANK_ANCHORS.";
const AVERAGE_INFO =
  "Average player: every pick weighted by its ownership share, plus the most-owned driver once as the Boost. No penalties, no chips.";
const FORM_INFO =
  "Same optimiser and chips, but every driver and team is ranked by the points it has scored so far (half the last 3 races, half the season average) instead of by our model. The gap is what the model adds.";
/** Every F1 Fantasy season starts with a $100M Cost Cap. */
const STARTING_CAP = 100;
const KEEP_INFO = "Round 1 team kept all season.";
const HINDSIGHT_INFO = "Best team every round on actual points, same budget, no transfer limit. Not achievable.";

export function BacktestView({ data }: BacktestViewProps) {
  const latest = data.seasons[data.seasons.length - 1];
  const [selected, setSelected] = useState(latest?.season ?? 0);
  const season = data.seasons.find((s) => s.season === selected) ?? latest;
  if (!season) return null;
  const rows = tableRows(season.rounds);

  return (
    <>
      <Section title="Season backtest" icon={IconTrophy} info={METHOD_INFO} flush tight>
        <div className="grid gap-4">
          <SeasonSwitch seasons={data.seasons} selected={season.season} onSelect={setSelected} />
          <Summary season={season} />
          <CumulativeChart rounds={season.rounds} />
          <p className="text-ui text-ink-3">{METHOD_NOTE}</p>
          {season.leader?.source ? <p className="text-caption text-ink-3"><a href={season.leader.source} className="underline underline-offset-2">Official global leaderboard</a>{season.leader.sourceUpdatedAt ? `, updated ${new Date(season.leader.sourceUpdatedAt).toISOString().slice(0, 16).replace("T", " ")} UTC` : ""}. Leader: {season.leader.label}.</p> : null}
        </div>
      </Section>
      <Section title="Round by round" icon={IconHistory} flush>
        <RoundTable rows={rows} />
        <p className="mt-2 text-caption text-ink-2">Green: picked that round. Cost cap: team value plus bank going into the round, $M, starting at $100M. Left: money not spent after that round&apos;s transfers.</p>
      </Section>
    </>
  );
}

function SeasonSwitch({ seasons, selected, onSelect }: { seasons: BacktestSeason[]; selected: number; onSelect: (season: number) => void }) {
  return (
    <div role="tablist" aria-label="Season" className="fantasy-segmented w-fit">
      {seasons.map((s) => {
        const active = s.season === selected;
        const tone = active ? "font-[600]" : "text-ink-2 hover:text-ink";
        return (
          <button
            key={s.season}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onSelect(s.season)}
            className={"fantasy-choice timing px-3.5 " + tone}
          >
            {s.season}
          </button>
        );
      })}
    </div>
  );
}

function Summary({ season }: { season: BacktestSeason }) {
  const share = hindsightShare(season);
  const vsForm = signed(season.total - season.form);
  const vsKeep = signed(season.total - season.keep);
  const rank = rankText(season);
  const vsAverage = season.average === null ? "n/a" : signed(season.total - season.average);
  const averageTone = season.average === null ? "text-ink-3" : toneOf(season.total - season.average);
  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-3 rounded-float border border-rule p-4 sm:grid-cols-3 lg:grid-cols-7">
      <Stat label="Points" value={String(season.total)} note={`${season.rounds.length} rounds`} />
      <Stat label={rank.label} value={rank.value} note={rank.note} info={season.worldRank ? undefined : rankInfo(season)} />
      <Stat label="vs average player" value={vsAverage} note={season.average === null ? undefined : `${season.average}`} info={AVERAGE_INFO} tone={averageTone} />
      <Stat label="Of hindsight" value={`${share}%`} note={`${season.hindsight} max`} info={HINDSIGHT_INFO} />
      <Stat label="Team value" value={formatMoney(season.finalTeamValue)} />
      <Stat label="vs no model" value={vsForm} note={`${season.form}`} info={FORM_INFO} tone={toneOf(season.total - season.form)} />
      <Stat label="vs keep team" value={vsKeep} note={`${season.keep}`} info={KEEP_INFO} tone={toneOf(season.total - season.keep)} />
    </dl>
  );
}

function Stat({ label, value, note, info, tone = "text-ink" }: { label: string; value: string; note?: string; info?: string; tone?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <dt className="flex items-center gap-1 text-ui text-ink-3">
        {label}
        {info ? <Info text={info} /> : null}
      </dt>
      <dd className="flex items-baseline gap-1.5">
        <span className={"timing text-lg font-[650] " + tone}>{value}</span>
        {note ? <span className="timing text-ui text-ink-3">{note}</span> : null}
      </dd>
    </div>
  );
}

interface SeriesStyle {
  color: string;
  dash?: string;
}

/** One distinct style per series, shared by the lines and the legend. */
const SERIES: Record<"ours" | "form" | "average" | "hindsight", SeriesStyle> = {
  ours: { color: "var(--accent)" },
  form: { color: "var(--prob-4)" },
  average: { color: "var(--ink-2)", dash: "5 3" },
  hindsight: { color: "var(--ink-3)", dash: "1.5 3" },
};

const CHART_W = 1320;
const CHART_H = 220;
const PAD = { left: 40, right: 1, top: 8, bottom: 20 };

function CumulativeChart({ rounds }: { rounds: BacktestRound[] }) {
  if (rounds.length === 0) return null;
  const top = Math.max(...rounds.map((r) => Math.max(r.hindsightCumulative, r.cumulative, r.formCumulative)));
  const scaleTop = niceCeiling(top);
  const ours = pathOf(rounds, (r) => r.cumulative, scaleTop);
  const form = pathOf(rounds, (r) => r.formCumulative, scaleTop);
  const hasAverage = rounds.every((r) => r.averageCumulative !== null);
  const average = hasAverage ? pathOf(rounds, (r) => r.averageCumulative ?? 0, scaleTop) : null;
  const hindsight = pathOf(rounds, (r) => r.hindsightCumulative, scaleTop);
  const ticks = [0, scaleTop / 2, scaleTop];
  const first = rounds[0].round;
  const last = rounds[rounds.length - 1].round;
  return (
    <figure className="grid gap-2">
      <svg viewBox={`0 0 ${CHART_W} ${CHART_H}`} className="h-auto w-full" role="img" aria-label="Cumulative points by round: ours, no-model baseline, average player and hindsight">
        {ticks.map((t) => {
          const y = yOf(t, scaleTop);
          return (
            <g key={t}>
              <line x1={PAD.left} x2={CHART_W - PAD.right} y1={y} y2={y} stroke="var(--rule)" strokeWidth={1} />
              <text x={PAD.left - 6} y={y + 3} textAnchor="end" className="fill-ink-3 timing text-[11px]">{Math.round(t)}</text>
            </g>
          );
        })}
        <text x={PAD.left} y={CHART_H - 4} className="fill-ink-3 timing text-[11px]">R{first}</text>
        <text x={CHART_W - PAD.right} y={CHART_H - 4} textAnchor="end" className="fill-ink-3 timing text-[11px]">R{last}</text>
        <path d={hindsight} fill="none" stroke={SERIES.hindsight.color} strokeWidth={1.5} strokeDasharray={SERIES.hindsight.dash} />
        {average ? <path d={average} fill="none" stroke={SERIES.average.color} strokeWidth={1.5} strokeDasharray={SERIES.average.dash} /> : null}
        <path d={form} fill="none" stroke={SERIES.form.color} strokeWidth={1.75} />
        <path d={ours} fill="none" stroke={SERIES.ours.color} strokeWidth={2.25} />
      </svg>
      <figcaption className="flex flex-wrap gap-4 text-ui text-ink-3">
        <Legend series={SERIES.ours} label="Ours" />
        <Legend series={SERIES.form} label="No model (points so far)" />
        {hasAverage ? <Legend series={SERIES.average} label="Average player" /> : null}
        <Legend series={SERIES.hindsight} label="Hindsight" />
      </figcaption>
    </figure>
  );
}

function Legend({ series, label }: { series: SeriesStyle; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <svg width="18" height="4" aria-hidden="true">
        <line x1="0" x2="18" y1="2" y2="2" stroke={series.color} strokeWidth={2} strokeDasharray={series.dash} />
      </svg>
      {label}
    </span>
  );
}

// ------------------------------------------------------------------------------ helpers

/** Rows of the shared round table: cost cap going into each round (the season starts at $100M),
 * transfers split into constructors and drivers. */
function tableRows(rounds: BacktestRound[]): RoundTableRow[] {
  const constructorCodes = new Set(rounds.flatMap((r) => r.constructors.map((c) => c.code)));
  const isTeam = (code: string) => constructorCodes.has(code);
  return rounds.map((r, k) => {
    const previous = k > 0 ? rounds[k - 1] : null;
    const costCap = previous ? previous.teamValue + previous.bank : STARTING_CAP;
    const ins = r.transfersIn.map(codeOf);
    const outs = r.transfersOut.map(codeOf);
    return {
      round: r.round,
      raceName: r.raceName,
      raceCode: r.raceCode,
      country: r.country,
      constructors: r.constructors,
      drivers: r.drivers,
      constructorsIn: ins.filter(isTeam),
      driversIn: ins.filter((c) => !isTeam(c)),
      constructorsOut: outs.filter(isTeam),
      driversOut: outs.filter((c) => !isTeam(c)),
      boost: r.boost ? codeOf(r.boost) : null,
      extraBoost: r.extraBoost ? codeOf(r.extraBoost) : null,
      chip: r.chip,
      penalty: r.penalty,
      points: r.points,
      cumulative: r.cumulative,
      costCap,
      left: r.bank,
      cost: null,
    };
  });
}

/** Three-letter code; an id that slipped through without a label ("hadjar") becomes "HAD". */
function codeOf(label: string): string {
  if (label === label.toUpperCase()) return label;
  return label.slice(0, 3).toUpperCase();
}

function rankText(season: BacktestSeason): { label: string; value: string; note?: string } {
  const rank = season.worldRank;
  const leader = season.leader;
  if (!rank && leader) return { label: `Leader after R${leader.round}`, value: String(leader.points), note: leader.share === null ? `Backtest through R${season.rounds.at(-1)?.round ?? 0}` : `ours ${leader.share}%` };
  if (!rank) return { label: "World rank", value: "Not published" };
  const range = `${formatCount(rank.low)} to ${formatCount(rank.high)}`;
  const percentile = rank.percentile === null ? range : `top ${rank.percentile}%, ${range}`;
  return { label: "World rank", value: formatCount(rank.rank), note: percentile };
}

function rankInfo(season: BacktestSeason): string {
  const field = season.players ? `Field: over ${formatCount(season.players)} teams. ` : "Field size not published. ";
  return field + RANK_INFO_TAIL;
}

function formatCount(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 10_000) return `${Math.round(value / 1000)}k`;
  return value.toLocaleString("en-GB");
}

function toneOf(delta: number): string {
  if (delta > 0) return "text-delta-up";
  if (delta < 0) return "text-delta-down";
  return "text-ink";
}

function niceCeiling(value: number): number {
  const step = value > 4000 ? 1000 : 500;
  return Math.max(step, Math.ceil(value / step) * step);
}

function yOf(value: number, top: number): number {
  const height = CHART_H - PAD.top - PAD.bottom;
  return PAD.top + height * (1 - value / top);
}

function pathOf(rounds: BacktestRound[], pick: (r: BacktestRound) => number, top: number): string {
  const width = CHART_W - PAD.left - PAD.right;
  const steps = Math.max(1, rounds.length - 1);
  const points = rounds.map((r, k) => {
    const x = PAD.left + (width * k) / steps;
    const value = pick(r);
    const y = yOf(value, top);
    return `${k === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
  });
  return points.join(" ");
}
