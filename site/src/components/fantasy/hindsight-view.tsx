"use client";

// Hindsight teams for every scored round: the best team on real points with no budget and the
// best within the user's budget, solved in the browser so the budget can be edited. The budget is
// shared with the planner (same ?cap= query and stored planner state).

import { useDeferredValue, useEffect, useMemo, useState, type CSSProperties } from "react";
import { hindsightSeason, type HindsightRound, type HindsightRoundInput, type HindsightTeam } from "@/lib/fantasy/hindsight";
import { DEFAULT_COST_CAP, defaultPlannerState, loadStoredState, saveStoredState } from "@/lib/fantasy/planner-state";
import { COST_CAP_MAX, COST_CAP_MIN } from "@/lib/fantasy/team-selection";
import { CostCapInput } from "@/components/fantasy/cost-cap-input";
import { Section } from "@/components/ui/section";
import { Info } from "@/components/ui/info";
import { IconHistory, IconTrophy } from "@/components/icons";
import { formatMoney } from "@/lib/format";
import { BoostBadge, TeamLine } from "@/components/fantasy/planner-parts";

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

const ROUNDS_INFO = "Fresh team each round: 5 drivers, 2 constructors, x2 Boost (bolt) on the top driver, no chips. Prices as of that round.";

export function HindsightView({ season: seasonYear, inputs, labels }: HindsightViewProps) {
  const [cap, setCap] = useState(DEFAULT_COST_CAP);
  const [ready, setReady] = useState(false);
  const deferredCap = useDeferredValue(cap);
  const season = useMemo(() => hindsightSeason(inputs, deferredCap), [inputs, deferredCap]);
  const newestFirst = useMemo(() => [...season].reverse(), [season]);
  const freeTotal = sumBy(season, (r) => r.free.score);
  const cappedTotal = sumBy(season, (r) => r.capped?.score ?? 0);
  const noTeam = season.filter((r) => r.capped === null).length;
  const cappedLabel = `Within ${formatMoney(deferredCap)}`;

  useEffect(() => {
    const initial = initialCap();
    // the URL and storage only exist in the browser, so the saved budget is read after mount
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCap(initial);
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    saveCap(cap);
  }, [cap, ready]);

  return (
    <>
      <Section title={`${seasonYear} best teams in hindsight`} icon={IconTrophy} info="Totals over every scored round." flush tight>
        <p className="mb-4 text-ui text-ink-3">Each round&apos;s top team on real points, with no budget and within yours.</p>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-5 rounded-float border border-rule p-4 sm:p-5 lg:grid-cols-3">
          <div className="flex min-w-0 flex-col gap-1.5">
            <dt className="flex items-center gap-1 text-ui text-ink-3">
              <label htmlFor="hindsight-cap">Budget</label>
              <Info text={`Total price limit per round, ${formatMoney(COST_CAP_MIN)} to ${formatMoney(COST_CAP_MAX)}. Shared with the planner.`} />
            </dt>
            <dd>
              <CostCapInput id="hindsight-cap" value={cap} onChange={setCap} note={`${season.length} rounds`} />
            </dd>
          </div>
          <SummaryItem label="No budget" value={freeTotal.toFixed(0)} note="pts" testId="total-free" />
          <SummaryItem label={cappedLabel} value={cappedTotal.toFixed(0)} note={noTeam ? `pts, ${noTeam} rounds no team` : "pts"} testId="total-capped" />
        </dl>
      </Section>

      <Section title="Round by round" icon={IconHistory} info={ROUNDS_INFO} flush>
        <ul className="grid gap-2 md:hidden">
          {newestFirst.map((r, i) => (
            <RoundCard key={r.round} round={r} labels={labels} index={i} cappedLabel={cappedLabel} />
          ))}
        </ul>
        <div className="scroll-x hidden md:block">
          <table className="data-table min-w-[880px] table-fixed">
            <colgroup>
              <col className="w-12" />
              <col className="w-52" />
              <col />
              <col className="w-20" />
              <col />
              <col className="w-20" />
            </colgroup>
            <thead>
              <tr>
                <th className="num">Rd</th>
                <th>Race</th>
                <th>No budget</th>
                <th className="num">Pts</th>
                <th>{cappedLabel}</th>
                <th className="num">Pts</th>
              </tr>
            </thead>
            <tbody>
              {newestFirst.map((r, i) => (
                <RoundRow key={r.round} round={r} labels={labels} index={i} />
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </>
  );
}

function SummaryItem({ label, value, note, testId }: { label: string; value: string; note: string; testId: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <dt className="text-ui text-ink-3">{label}</dt>
      <dd className="headline timing text-[1.75rem] leading-none text-ink" data-testid={testId}>
        {value}
      </dd>
      <dd className="text-caption text-ink-3">{note}</dd>
    </div>
  );
}

function RoundRow({ round, labels, index }: { round: HindsightRound; labels: HindsightLabels; index: number }) {
  const style = rowAnimation(index);
  const capped = round.capped;
  return (
    <tr className="stagger-in" style={style} data-round={round.round}>
      <td className="num text-ink-3">{round.round}</td>
      <td className="text-ink">{round.raceName}</td>
      <td>
        <TeamChips team={round.free} labels={labels} />
      </td>
      <td className="num font-[550] text-ink">{round.free.score.toFixed(0)}</td>
      <td>{capped ? <TeamChips team={capped} labels={labels} /> : <span className="text-ink-3">No team fits</span>}</td>
      <td className="num font-[550] text-ink">{capped ? capped.score.toFixed(0) : ""}</td>
    </tr>
  );
}

function RoundCard({ round, labels, index, cappedLabel }: { round: HindsightRound; labels: HindsightLabels; index: number; cappedLabel: string }) {
  const style = rowAnimation(index);
  const capped = round.capped;
  return (
    <li className="stagger-in min-w-0 rounded-control border border-rule p-4" style={style} data-round={round.round}>
      <p className="flex min-w-0 items-baseline gap-2">
        <span className="timing text-caption text-ink-3">R{round.round}</span>
        <span className="truncate font-[550] text-ink">{round.raceName}</span>
      </p>
      <TeamBlock label="No budget" team={round.free} labels={labels} />
      <TeamBlock label={cappedLabel} team={capped} labels={labels} />
    </li>
  );
}

function TeamBlock({ label, team, labels }: { label: string; team: HindsightTeam | null; labels: HindsightLabels }) {
  return (
    <div className="mt-3">
      <div className="flex items-baseline justify-between gap-3">
        <span className="label">{label}</span>
        <span className="timing font-[550] text-ink">{team ? `${team.score.toFixed(0)} pts` : ""}</span>
      </div>
      <div className="mt-1">{team ? <TeamChips team={team} labels={labels} /> : <span className="text-caption text-ink-3">No team fits</span>}</div>
    </div>
  );
}

function TeamChips({ team, labels }: { team: HindsightTeam; labels: HindsightLabels }) {
  return (
    <span className="flex flex-wrap items-center gap-[3px]">
      {team.constructors.map((id) => (
        <Chip key={id} id={id} labels={labels} boosted={false} />
      ))}
      <span className="w-5" aria-hidden="true" />
      {team.drivers.map((id) => (
        <Chip key={id} id={id} labels={labels} boosted={id === team.boost} />
      ))}
      <span className="timing ms-2 text-caption text-ink-3">{formatMoney(team.cost)}</span>
    </span>
  );
}

function Chip({ id, labels, boosted }: { id: string; labels: HindsightLabels; boosted: boolean }) {
  const name = labels.names[id] ?? id;
  const code = labels.codes[id] ?? id;
  const color = labels.colors[id] ?? "var(--rule)";
  const title = boosted ? `${name}, x2 Boost` : name;
  return (
    <span title={title} className="inline-flex h-6 items-center gap-1.5 rounded-control bg-bg-raised ps-1.5 pe-2 text-caption font-[650] text-ink">
      <TeamLine color={color} className="h-3.5" />
      {code}
      {boosted ? <BoostBadge multiplier={2} small /> : null}
    </span>
  );
}

/** Short entry animation: 240ms, at most 120ms of stagger, so every row settles within 360ms. */
function rowAnimation(index: number): CSSProperties {
  const delay = Math.min(index, 4) * 30;
  return { animationDuration: "240ms", animationDelay: `${delay}ms` };
}

/** Budget from the URL first, then the planner's stored state, then the default. */
function initialCap(): number {
  const params = new URLSearchParams(window.location.search);
  const fromUrl = params.get("cap");
  const parsed = fromUrl === null ? Number.NaN : Number(fromUrl);
  if (Number.isFinite(parsed) && parsed >= COST_CAP_MIN && parsed <= COST_CAP_MAX) return parsed;
  const stored = loadStoredState();
  return stored?.costCap ?? DEFAULT_COST_CAP;
}

function saveCap(cap: number) {
  const stored = loadStoredState() ?? defaultPlannerState();
  saveStoredState({ ...stored, costCap: cap });
  const params = new URLSearchParams(window.location.search);
  params.set("cap", String(cap));
  window.history.replaceState(null, "", `${window.location.pathname}?${params.toString()}`);
}

function sumBy<T>(items: T[], pick: (item: T) => number): number {
  let total = 0;
  for (const item of items) total += pick(item);
  return total;
}
