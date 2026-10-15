"use client";

// Season backtest of the optimiser: one fixed method replayed from round 1 of every season on
// real prices and real points. Season switch, summary line, cumulative chart, then one row per round.

import { useState } from "react";
import { chipLabel, hindsightShare, signed, type BacktestPick, type BacktestRound, type BacktestSeason, type FantasyBacktest } from "@/lib/fantasy/backtest-data";
import { Section } from "@/components/ui/section";
import { Info } from "@/components/ui/info";
import { Flag } from "@/components/ui/flag";
import { TeamMark } from "@/components/ui/team-mark";
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
const FORM_INFO = "Same optimiser and chips, forecast = recent and season average points.";
const KEEP_INFO = "Round 1 team kept all season.";
const HINDSIGHT_INFO = "Best team every round on actual points, same budget, no transfer limit. Not achievable.";

export function BacktestView({ data }: BacktestViewProps) {
  const latest = data.seasons[data.seasons.length - 1];
  const [selected, setSelected] = useState(latest?.season ?? 0);
  const season = data.seasons.find((s) => s.season === selected) ?? latest;
  if (!season) return null;

  return (
    <>
      <Section title="Season backtest" icon={IconTrophy} info={METHOD_INFO} flush tight>
        <div className="grid gap-4">
          <SeasonSwitch seasons={data.seasons} selected={season.season} onSelect={setSelected} />
          <Summary season={season} />
          <CumulativeChart rounds={season.rounds} />
          <p className="text-ui text-ink-3">{METHOD_NOTE}</p>
        </div>
      </Section>
      <Section title="Round by round" icon={IconHistory} flush>
        <RoundTable rounds={season.rounds} />
      </Section>
    </>
  );
}

function SeasonSwitch({ seasons, selected, onSelect }: { seasons: BacktestSeason[]; selected: number; onSelect: (season: number) => void }) {
  return (
    <div role="tablist" aria-label="Season" className="inline-flex h-8 w-fit items-stretch rounded-control border border-rule">
      {seasons.map((s) => {
        const active = s.season === selected;
        const tone = active ? "segment-on font-[600]" : "text-ink-2 hover:text-ink";
        return (
          <button
            key={s.season}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onSelect(s.season)}
            className={"press segment timing -my-px rounded-control px-3.5 text-ui " + tone}
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
      <Stat label={season.leader && !season.worldRank ? "Of leader" : "World rank"} value={rank.value} note={rank.note} info={season.worldRank ? undefined : rankInfo(season)} />
      <Stat label="vs average player" value={vsAverage} note={season.average === null ? undefined : `${season.average}`} info={AVERAGE_INFO} tone={averageTone} />
      <Stat label="Of hindsight" value={`${share}%`} note={`${season.hindsight} max`} info={HINDSIGHT_INFO} />
      <Stat label="Team value" value={formatMoney(season.finalTeamValue)} />
      <Stat label="vs form" value={vsForm} note={`${season.form}`} info={FORM_INFO} tone={toneOf(season.total - season.form)} />
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
      <svg viewBox={`0 0 ${CHART_W} ${CHART_H}`} className="h-auto w-full" role="img" aria-label="Cumulative points by round: ours, form baseline, average player and hindsight">
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
        <Legend series={SERIES.form} label="Form" />
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

function RoundTable({ rounds }: { rounds: BacktestRound[] }) {
  return (
    <div className="overflow-x-auto rounded-float border border-rule">
      <table className="w-full min-w-[820px] text-ui tabular-nums">
        <thead className="text-left text-ink-3">
          <tr className="border-b border-rule">
            <th className="px-3 py-2 font-normal">Round</th>
            <th className="px-3 py-2 font-normal">Team</th>
            <th className="px-3 py-2 font-normal">In</th>
            <th className="px-3 py-2 font-normal">Out</th>
            <th className="px-3 py-2 font-normal">Boost</th>
            <th className="px-3 py-2 font-normal">Chip</th>
            <th className="px-3 py-2 text-right font-normal">Pts</th>
            <th className="px-3 py-2 text-right font-normal">Total</th>
            <th className="px-3 py-2 text-right font-normal">Value</th>
            <th className="px-3 py-2 text-right font-normal">Bank</th>
          </tr>
        </thead>
        <tbody>
          {rounds.map((r) => (
            <RoundRow key={r.round} round={r} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RoundRow({ round }: { round: BacktestRound }) {
  const picks = [...round.drivers, ...round.constructors];
  const chip = chipLabel(round.chip);
  const ins = round.transfersIn.map(codeOf);
  const outs = round.transfersOut.map(codeOf);
  const transfersIn = ins.join(" ");
  const transfersOut = outs.join(" ");
  return (
    <tr className="border-b border-rule last:border-b-0 hover:bg-bg-raised">
      <td className="whitespace-nowrap px-3 py-1.5" title={round.raceName}>
        <span className="inline-flex items-center gap-2">
          <span className="w-5 text-ink-3">{round.round}</span>
          <Flag of={round.country} size={16} />
          <span className="font-[600]">{round.raceCode}</span>
        </span>
      </td>
      <td className="px-3 py-1.5">
        <span className="flex flex-wrap gap-x-2.5 gap-y-1">
          {picks.map((p) => (
            <PickChip key={p.code} pick={p} />
          ))}
        </span>
      </td>
      <td className="whitespace-nowrap px-3 py-1.5">
        <span className="timing text-delta-up">{transfersIn}</span>
        {round.penalty ? <span className="timing ms-2 rounded-chip bg-[color-mix(in_oklch,var(--delta-down)_16%,transparent)] px-1 py-px text-caption font-[650] text-delta-down" title="Points penalty for extra transfers">−{round.penalty}</span> : null}
      </td>
      <td className="timing whitespace-nowrap px-3 py-1.5 text-ink-2">{transfersOut}</td>
      <td className="timing whitespace-nowrap px-3 py-1.5">
        <BoostCell round={round} />
      </td>
      <td className="whitespace-nowrap px-3 py-1.5">{chip ?? ""}</td>
      <td className="px-3 py-1.5 text-right timing">{Math.round(round.points)}</td>
      <td className="px-3 py-1.5 text-right timing text-ink-2">{Math.round(round.cumulative)}</td>
      <td className="px-3 py-1.5 text-right timing text-ink-2">{round.teamValue.toFixed(1)}</td>
      <td className="px-3 py-1.5 text-right timing text-ink-3">{round.bank.toFixed(1)}</td>
    </tr>
  );
}

/** Boost driver, with the 3x Boost driver first when that chip is played; autopilot shows "auto". */
function BoostCell({ round }: { round: BacktestRound }) {
  if (round.chip === "autopilot") return <span className="text-ink-2">auto</span>;
  const boost = round.boost ? codeOf(round.boost) : null;
  if (!round.extraBoost) return <>{boost}</>;
  const extra = codeOf(round.extraBoost);
  return (
    <span className="inline-flex items-baseline gap-2">
      <span>
        {extra}
        <span className="ms-0.5 text-caption text-ink-3">x3</span>
      </span>
      {boost ? (
        <span>
          {boost}
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

// ------------------------------------------------------------------------------ helpers

/** Three-letter code; an id that slipped through without a label ("hadjar") becomes "HAD". */
function codeOf(label: string): string {
  if (label === label.toUpperCase()) return label;
  return label.slice(0, 3).toUpperCase();
}

function rankText(season: BacktestSeason): { value: string; note?: string } {
  const rank = season.worldRank;
  const leader = season.leader;
  if (!rank && leader) return { value: `${leader.share}%`, note: `of leader ${leader.points} (R${leader.round})` };
  if (!rank) return { value: "Not published" };
  const range = `${formatCount(rank.low)} to ${formatCount(rank.high)}`;
  const percentile = rank.percentile === null ? range : `top ${rank.percentile}%, ${range}`;
  return { value: formatCount(rank.rank), note: percentile };
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
