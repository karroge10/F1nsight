"use client";

// The three views under the control bar: Best teams (the optimiser's ranked lineups), Prices
// (price, recent points, projection and price move odds per asset) and Next races (a plan for
// the next four races starting from the draft).

import { Fragment, type ReactNode } from "react";
import type { TeamResult, TransferPlan } from "@/lib/fantasy/engine/types";
import { placeInSlots, type Lineup } from "@/lib/fantasy/lineup";
import { priceMoveOdds } from "@/lib/fantasy/thresholds";
import { Flag } from "@/components/ui/flag";
import { CodeCell, CodeChip, Footnote, fixed1, money, signed, tone, type AssetLookup, type AssetView, type PlannerMeta } from "@/components/fantasy/planner-parts";

// ---------------------------------------------------------------- Best teams

interface BestTeamsProps {
  teams: TeamResult[];
  /** Last week's picks, empty for a new team. */
  savedIds: Set<string>;
  keepScore: number | null;
  isLoaded: (team: TeamResult) => boolean;
  assetOf: AssetLookup;
  onLoad: (team: TeamResult) => void;
}

export function BestTeams({ teams, savedIds, keepScore, isLoaded, assetOf, onLoad }: BestTeamsProps) {
  if (teams.length === 0) return <Footnote>No lineup fits the budget with these always and never picks.</Footnote>;
  const pointsOf = (id: string) => assetOf(id)?.points ?? 0;
  const byPoints = (a: string, b: string) => pointsOf(b) - pointsOf(a);
  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-table">
          <thead>
            <tr className="text-[0.6875rem] text-ink-3">
              <Th left className="w-8">#</Th>
              <Th left>Team</Th>
              <Th title="Transfers from last week's team">Transfers</Th>
              <Th title="Total cost">Cost</Th>
              <Th title="Expected change in team value after this race, $M">Value change</Th>
              <Th title="Projected points after Boost and transfer penalties">Projected</Th>
              {keepScore !== null ? <Th title="Gain over keeping last week's team">vs keeping</Th> : null}
            </tr>
          </thead>
          <tbody>
            {teams.map((team, i) => {
              const loaded = isLoaded(team);
              const constructors = [...team.constructors].sort(byPoints);
              const drivers = [...team.drivers].sort(byPoints);
              const multiplierOf = (id: string) => (id === team.extraBoost ? 3 : id === team.boost ? 2 : 1);
              const chip = (id: string) => {
                const asset = assetOf(id);
                if (!asset) return null;
                const changed = savedIds.size > 0 && !savedIds.has(id);
                return <CodeChip key={id} asset={asset} changed={changed} multiplier={multiplierOf(id)} />;
              };
              const rowTone = loaded ? "bg-[color-mix(in_oklch,var(--prob-4)_14%,transparent)]" : "hover:bg-bg-raised";
              const key = [...team.drivers, ...team.constructors].join(",");
              return (
                <tr key={key} tabIndex={0} onClick={() => onLoad(team)} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onLoad(team)} aria-selected={loaded} className={"cursor-pointer border-t border-rule " + rowTone} title="Load into your lineup">
                  <td className={"h-9 px-1.5 text-ink-3 " + (loaded ? "shadow-[inset_3px_0_0_var(--prob-4)]" : "")}>{i + 1}</td>
                  <td className="px-1.5">
                    <span className="flex items-center gap-[3px]">
                      {constructors.map(chip)}
                      <span className="w-5" aria-hidden="true" />
                      {drivers.map(chip)}
                    </span>
                  </td>
                  <td className="timing px-1.5 text-end whitespace-nowrap">
                    {team.transferCount}
                    {team.penalty > 0 ? <span className="ms-1.5 text-[0.6875rem] text-delta-down">−{team.penalty}</span> : null}
                  </td>
                  <td className="timing px-1.5 text-end text-ink-2">{money(team.cost)}</td>
                  <td className={"timing px-1.5 text-end " + tone(team.expectedValueChange)}>{signed(team.expectedValueChange, 2)}</td>
                  <td className="timing px-1.5 text-end text-ui font-[700] text-ink">{fixed1(team.score)}</td>
                  {keepScore !== null ? <td className={"timing px-1.5 text-end " + tone(team.score - keepScore)}>{signed(team.score - keepScore)}</td> : null}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <Footnote>Click a row to load it into your lineup. Green: not in last week&apos;s team. x2: Boost.</Footnote>
    </>
  );
}

// ---------------------------------------------------------------- Prices

interface PriceTablesProps {
  drivers: AssetView[];
  constructors: AssetView[];
  meta: PlannerMeta;
}

const ODDS_COLORS = ["oklch(0.62 0.2 28)", "oklch(0.62 0.2 28 / 0.5)", "oklch(0.7 0.15 150 / 0.55)", "oklch(0.72 0.16 150)"];

export function PriceTables({ drivers, constructors, meta }: PriceTablesProps) {
  return (
    <div className="grid gap-x-7 gap-y-4 xl:grid-cols-2">
      <PriceTable title="Drivers" assets={drivers} meta={meta} />
      <div>
        <PriceTable title="Constructors" assets={constructors} meta={meta} />
        <Footnote>Prices move after each race on points per $M over the last three races: from $18.5M by 0.1 or 0.3, cheaper by 0.2 or 0.6. Hover a bar for the odds.</Footnote>
      </div>
    </div>
  );
}

function PriceTable({ title, assets, meta }: { title: string; assets: AssetView[]; meta: PlannerMeta }) {
  const sorted = [...assets].sort((a, b) => b.priceChange - a.priceChange);
  const [older, newer] = meta.recent.rounds;
  return (
    <table className="w-full border-collapse text-table">
      <thead>
        <tr className="text-[0.6875rem] text-ink-3">
          <Th left>{title}</Th>
          <Th>Price</Th>
          {older !== undefined ? <Th title={`Points in round ${older}`}>R{older}</Th> : null}
          {newer !== undefined ? <Th title={`Points in round ${newer}`}>R{newer}</Th> : null}
          <Th title="Projected points this race">Projected</Th>
          <Th left title="Chance of each price move: red falls, green rises. Hover for numbers.">Price move odds</Th>
          <Th title="Expected price change, $M">Expected</Th>
        </tr>
      </thead>
      <tbody>
        {sorted.map((asset) => {
          const recent = meta.recent.points[asset.id] ?? [];
          return (
            <tr key={asset.id} className="border-t border-rule hover:bg-bg-raised">
              <td className="h-8 px-1.5">
                <CodeCell asset={asset} />
              </td>
              <td className="timing px-1.5 text-end text-ink-2">{money(asset.price)}</td>
              {older !== undefined ? <td className="timing px-1.5 text-end text-ink-3">{recent[0] ?? ""}</td> : null}
              {newer !== undefined ? <td className="timing px-1.5 text-end text-ink-3">{recent[1] ?? ""}</td> : null}
              <td className="timing px-1.5 text-end font-[650] text-ink">{fixed1(asset.points)}</td>
              <td className="px-1.5">
                <OddsBar asset={asset} />
              </td>
              <td className={"timing px-1.5 text-end font-[600] " + tone(asset.priceChange)}>{signed(asset.priceChange, 2)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function OddsBar({ asset }: { asset: AssetView }) {
  const odds = priceMoveOdds(asset.price, asset.probs);
  const parts = [odds.bigFall, odds.smallFall, odds.smallRise, odds.bigRise];
  const total = parts.reduce((a, b) => a + b, 0);
  if (total <= 0) return <span className="text-caption text-ink-3">no change</span>;
  const labels = [`−${odds.big}`, `−${odds.small}`, `+${odds.small}`, `+${odds.big}`];
  const title = parts.map((p, i) => `${labels[i]}M: ${Math.round(p * 100)}%`).join("  ");
  return (
    <span className="inline-flex h-2 w-[6.5rem] overflow-hidden rounded-full bg-bg-hover align-middle" title={title} role="img" aria-label={title}>
      {parts.map((p, i) => (p > 0 ? <span key={i} className="h-full" style={{ width: `${(p / total) * 100}%`, background: ODDS_COLORS[i] }} /> : null))}
    </span>
  );
}

// ---------------------------------------------------------------- Next races

interface NextRacesProps {
  plan: TransferPlan | null;
  draft: Lineup;
  complete: boolean;
  meta: PlannerMeta;
  assetOf: AssetLookup;
  /** Expected points of an asset in a planned round. */
  pointsIn: (id: string, round: number) => number;
  /** Expected price change of an asset after a planned round. */
  changeIn: (id: string, round: number) => number;
}

export function NextRaces({ plan, draft, complete, meta, assetOf, pointsIn, changeIn }: NextRacesProps) {
  if (!complete) return <Footnote>Fill all 7 slots to see the plan.</Footnote>;
  if (!plan || plan.stages.length === 0) return <Footnote>Planning the next races…</Footnote>;
  const columns = alignColumns(plan, draft);
  const raceOf = (round: number) => meta.races.find((r) => r.round === round);
  const grid = { gridTemplateColumns: `6.25rem repeat(${columns.length}, minmax(0, 1fr))` };
  const cell = (id: string | null, c: number, previous: (string | null)[]) => {
    const asset = id ? assetOf(id) : undefined;
    if (!id || !asset) return <div key={c} className="h-10 border-t border-rule" />;
    const stage = plan.stages[c];
    const multiplier = stage.boost === id ? 2 : 1;
    const changed = !previous.includes(id);
    const points = pointsIn(id, stage.round) * multiplier;
    return (
      <div key={c} className="flex h-10 items-center justify-between gap-2 border-t border-rule px-2">
        <CodeChip asset={asset} changed={changed} multiplier={multiplier} />
        <span className="timing text-table text-ink-2">{fixed1(points)}</span>
      </div>
    );
  };
  const rows = (kind: "constructors" | "drivers", label: string) => {
    const count = kind === "drivers" ? 5 : 2;
    return Array.from({ length: count }, (_, i) => (
      <Fragment key={`${kind}-${i}`}>
        <div className="flex h-10 items-center border-t border-rule px-2 text-caption text-ink-3">{i === 0 ? label : ""}</div>
        {columns.map((column, c) => {
          const previous = c === 0 ? [...draft.drivers, ...draft.constructors] : [...columns[c - 1].drivers, ...columns[c - 1].constructors];
          const id = column[kind][i] ?? null;
          return cell(id, c, previous);
        })}
      </Fragment>
    ));
  };
  return (
    <>
      <div className="overflow-x-auto">
        <div className="grid min-w-[40rem] text-table" style={grid}>
          <div />
          {plan.stages.map((stage) => {
            const race = raceOf(stage.round);
            return (
              <div key={stage.round} className="flex items-center gap-2 px-2 pt-3 pb-2 text-ui font-[650] text-ink">
                <Flag of={race?.country ?? null} size={20} keepSpace={false} />
                <span className="truncate">{race?.name ?? stage.raceName}</span>
                <span className="text-[0.6875rem] font-[450] text-ink-3">R{stage.round}</span>
              </div>
            );
          })}
          {rows("constructors", "Constructors")}
          {rows("drivers", "Drivers")}
          <div className="flex h-10 items-center border-t border-rule px-2 text-caption text-ink-3">Transfers</div>
          {plan.stages.map((stage, c) => (
            <div key={stage.round} className="flex h-10 items-center border-t border-rule px-2 text-caption text-ink-2">
              {c === 0 ? "your lineup" : `${stage.transferCount} of ${stage.freeTransfers} free`}
              {stage.penalty > 0 ? <span className="timing ms-1.5 text-delta-down">−{stage.penalty}</span> : null}
            </div>
          ))}
          <div className="flex h-10 items-center border-t border-rule px-2 text-caption text-ink-3">Projected</div>
          {plan.stages.map((stage, c) => {
            const ids = [...columns[c].drivers, ...columns[c].constructors].filter((id): id is string => id !== null);
            const valueChange = ids.reduce((sum, id) => sum + changeIn(id, stage.round), 0);
            return (
              <div key={stage.round} className="flex h-10 items-center justify-between border-t border-rule px-2">
                <b className="timing text-[0.9375rem] font-[700] text-ink">{fixed1(stage.expectedPoints - stage.penalty)}</b>
                <span className={"timing text-caption " + tone(valueChange)} title="Expected team value change">
                  {signed(valueChange)}M
                </span>
              </div>
            );
          })}
        </div>
      </div>
      <Footnote>Starts from your lineup above. Later races use rougher projections; the plan reruns after every race.</Footnote>
    </>
  );
}

/** Slot order per planned race: kept picks stay in their row, new ones take the freed rows. */
function alignColumns(plan: TransferPlan, draft: Lineup): Lineup[] {
  const columns: Lineup[] = [];
  let previous: Lineup = draft;
  for (const stage of plan.stages) {
    const drivers = placeInSlots(previous.drivers, stage.drivers);
    const constructors = placeInSlots(previous.constructors, stage.constructors);
    const column = { drivers, constructors };
    columns.push(column);
    previous = column;
  }
  return columns;
}

function Th({ children, left = false, title, className = "" }: { children?: ReactNode; left?: boolean; title?: string; className?: string }) {
  const align = left ? "text-start" : "text-end";
  const help = title ? "cursor-help" : "";
  return (
    <th scope="col" title={title} className={"px-1.5 pt-2.5 pb-1.5 font-[500] whitespace-nowrap " + align + " " + help + " " + className}>
      {children}
    </th>
  );
}
