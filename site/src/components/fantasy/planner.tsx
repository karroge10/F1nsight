"use client";

// Fantasy planner UI. The brain is the engine in src/lib/fantasy/engine: `recommend` runs in
// its Web Worker (see use-recommendation.ts) and returns the team to field, a reason per
// transfer, chip advice and a three-race plan. This component collects the user's situation
// and presents that answer; it contains no optimisation logic. Layout: a team summary (value,
// Cost Cap, projected points, transfers), the team builder, then the optimiser's suggestions.

import { useEffect, useMemo, useRef, useState } from "react";
import { prepareMarket, type Market, type MarketAsset } from "@/lib/fantasy/engine/market";
import { evaluateTeam } from "@/lib/fantasy/engine/optimiser";
import { CHIP_RULES } from "@/lib/fantasy/engine/rules";
import type { ChipId, FantasyFile, TeamResult, UserState } from "@/lib/fantasy/engine/types";
import { useRecommendation } from "@/lib/fantasy/use-recommendation";
import { CHIP_IDS } from "@/lib/fantasy/engine/types";
import { decodePlannerState, defaultPlannerState, dropInvalidPicks, encodePlannerState, isTeamComplete, loadStoredState, normalizeConstraints, saveStoredState, toggleBanned, toggleLocked, type PlannerObjective, type PlannerState } from "@/lib/fantasy/planner-state";
import { isAffordable, migrateLegacyBank, nextEmptySlot, pickAsset, removePick, spendableThisRound, swapCost, teamTotals, toggleBoost, type AssetKind, type SlotRef } from "@/lib/fantasy/team-selection";
import { handleRovingKey } from "@/lib/roving-keys";
import { Info } from "@/components/ui/info";
import { RecommendationView } from "@/components/fantasy/recommendation-view";
import { CostCapInput } from "@/components/fantasy/cost-cap-input";
import { AssetPicker, TeamSlots } from "@/components/fantasy/team-picker";
import { Section } from "@/components/ui/section";
import { IconAutopilot, IconBoost, IconChip, IconLimitless, IconShield, IconTransfers, IconTrophy, IconWildcard, IconWarning } from "@/components/icons";
import type { IconComponent } from "@/components/icons";
import { formatMoney } from "@/lib/format";

export interface PlannerMeta {
  codes: Record<string, string>;
  teams: Record<string, string>;
}

interface PlannerProps {
  meta: PlannerMeta;
}

const OBJECTIVES: { key: PlannerObjective; label: string }[] = [
  { key: "expected", label: "Expected" },
  { key: "safe", label: "Safe" },
  { key: "aggressive", label: "Aggressive" },
  { key: "value", label: "Value" },
];

const CHIP_ICON: Record<ChipId, IconComponent> = {
  limitless: IconLimitless,
  wildcard: IconWildcard,
  finalFix: IconTransfers,
  autopilot: IconAutopilot,
  noNegative: IconShield,
  extraBoost: IconBoost,
};

export function Planner({ meta }: PlannerProps) {
  const [state, setState] = useState<PlannerState>(defaultPlannerState);
  const [file, setFile] = useState<FantasyFile | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [target, setTarget] = useState<SlotRef | null>(null);
  const [pickerKind, setPickerKind] = useState<AssetKind>("driver");
  const pickerRef = useRef<HTMLDivElement>(null);
  const hydrated = useRef(false);

  useEffect(() => {
    const fromUrl = window.location.search.length > 1 ? decodePlannerState(window.location.search) : null;
    const stored = loadStoredState();
    const initial = fromUrl ?? stored ?? defaultPlannerState();
    const id = window.requestAnimationFrame(() => {
      setState(initial);
      hydrated.current = true;
    });
    fetch("/api/fantasy.json")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`fantasy data ${r.status}`))))
      .then((json: FantasyFile) => {
        const known = new Set(json.assets.map((a) => a.id));
        const priceEntries = json.assets.map((a) => [a.id, a.price ?? undefined] as const);
        const prices = new Map(priceEntries);
        setState((s) => {
          const picks = dropInvalidPicks(s, (id) => known.has(id));
          const migrated = migrateLegacyBank(picks, (id) => prices.get(id));
          return normalizeConstraints(migrated, json.assets);
        });
        setFile(json);
      })
      .catch((e: Error) => setLoadError(e.message));
    return () => window.cancelAnimationFrame(id);
  }, []);

  useEffect(() => {
    if (!hydrated.current) return;
    saveStoredState(state);
    const query = encodePlannerState(state);
    window.history.replaceState(null, "", `${window.location.pathname}${query}`);
  }, [state]);

  const market = useMemo(() => (file ? safePrepare(file) : null), [file]);
  const userState = useMemo<UserState | null>(() => (market ? toUserState(state, market) : null), [state, market]);
  const recommendation = useRecommendation(file, userState);
  const current = useMemo(() => (market && userState && userState.team ? safeEvaluate(market, userState, userState.team) : null), [market, userState]);
  const assets = useMemo(() => market?.assets ?? [], [market]);
  const boostMultiplier = market?.rules.boostMultiplier ?? 2;
  const totals = teamTotals(state, assets, boostMultiplier);
  const pickedCount = [...state.drivers, ...state.constructors].filter(Boolean).length;
  const spendLimit = state.costCap;
  const budgetUsed = spendLimit > 0 ? Math.min(100, (totals.value / spendLimit) * 100) : 0;
  const overCap = totals.over;
  const spendable = spendableThisRound(state, totals.leftToSpend);

  function assetById(id: string): MarketAsset | undefined {
    const index = market?.byId.get(id);
    return index === undefined ? undefined : assets[index];
  }
  function update(patch: Partial<PlannerState>) {
    setState((s) => ({ ...s, ...patch }));
  }
  function selectSlot(slot: SlotRef) {
    const same = target?.kind === slot.kind && target.index === slot.index;
    setTarget(same ? null : slot);
    setPickerKind(slot.kind);
    const narrow = window.matchMedia("(max-width: 1023px)").matches;
    if (!same && narrow) pickerRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  function pick(asset: MarketAsset) {
    const priceOf = (id: string) => assetById(id)?.price ?? 0;
    const cost = swapCost(state, asset, target, priceOf);
    if (!isAffordable(cost, spendable)) return;
    const next = pickAsset(state, asset, target);
    setState(next);
    const following = nextEmptySlot(next, asset.kind);
    setTarget(following);
  }
  function remove(id: string) {
    setState((s) => removePick(s, id));
    setTarget(null);
  }
  function toggleLock(id: string) {
    const asset = assetById(id);
    if (asset) setState((s) => toggleLocked(s, asset, assets));
  }
  function toggleBan(id: string) {
    const asset = assetById(id);
    if (asset) setState((s) => toggleBanned(s, asset));
  }
  function toggleChip(chip: ChipId) {
    const has = state.chipsAvailable.includes(chip);
    update({ chipsAvailable: has ? state.chipsAvailable.filter((c) => c !== chip) : [...state.chipsAvailable, chip], chipToPlay: has && state.chipToPlay === chip ? null : state.chipToPlay });
  }
  function reset() {
    setState(defaultPlannerState());
    setTarget(null);
  }
  async function copyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  const boostAsset = state.boost ? assetById(state.boost) : undefined;
  const playingChip = state.chipToPlay && state.chipsAvailable.includes(state.chipToPlay) ? CHIP_RULES[state.chipToPlay].name : null;
  const boostNoteText = boostAsset ? `x${boostMultiplier} ${meta.codes[boostAsset.id] ?? boostAsset.name}` : "No Boost";
  const chipNote = playingChip && current ? `With ${playingChip}: ${current.expectedPoints.toFixed(1)}` : null;
  const leftText = overCap ? `${formatMoney(-totals.leftToSpend)} over` : `${formatMoney(totals.leftToSpend)} left`;
  const overText = formatMoney(-totals.leftToSpend);
  const teamActions = (
    <span className="flex flex-wrap gap-2">
      <button type="button" onClick={copyLink} className="press h-11 rounded-control border border-rule px-3 text-ui text-ink-2 hover:text-ink sm:h-9">
        {copied ? "Link copied" : "Copy link"}
      </button>
      <button type="button" onClick={reset} className="press h-11 rounded-control border border-rule px-3 text-ui text-ink-2 hover:text-ink sm:h-9">
        Reset
      </button>
    </span>
  );

  return (
    <>
      <Section title="Your team" icon={IconTrophy} info="Click a card, then Add or Swap. Lock or exclude in the list." aside={teamActions} flush>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-5 rounded-float border border-rule p-4 sm:p-5 lg:grid-cols-4">
          <SummaryItem label="Team value" value={formatMoney(totals.value)} note={`${pickedCount} of 7 picked`} />
          <div className="flex min-w-0 flex-col gap-1.5">
            <dt className="flex items-center gap-1 text-ui text-ink-3">
              <label htmlFor="cost-cap">Cost Cap</label>
              <Info text="Total budget as the game shows it. Starts at $100M, moves with team value." />
            </dt>
            <dd>
              <CostCapInput id="cost-cap" value={state.costCap} onChange={(costCap) => update({ costCap })} note={<span className={overCap ? "text-delta-down" : undefined}>{leftText}</span>} />
            </dd>
          </div>
          <SummaryItem label="Projected points" value={totals.points.toFixed(1)} note={chipNote ?? boostNoteText} />
          <div className="flex min-w-0 flex-col gap-1.5">
            <dt className="flex items-center gap-1 text-ui text-ink-3">
              Free transfers <Info text="2 per race, plus 1 carried over (3 max)." />
            </dt>
            <dd role="radiogroup" aria-label="Free transfers" onKeyDown={handleRovingKey} className="inline-flex self-start rounded-control border border-rule">
              {[1, 2, 3].map((n) => (
                <button key={n} type="button" role="radio" tabIndex={state.freeTransfers === n ? 0 : -1} aria-checked={state.freeTransfers === n} onClick={() => update({ freeTransfers: n })} className={"press segment timing -my-px h-11 sm:h-9 w-11 rounded-control text-ui sm:w-10 " + (state.freeTransfers === n ? "segment-on" : "text-ink-2 hover:text-ink")}>
                  {n}
                </button>
              ))}
            </dd>
          </div>
          <div className="col-span-2 lg:col-span-4">
            <div className="h-1.5 overflow-hidden rounded-chip bg-rule" role="meter" aria-label="Money spent against the budget" aria-valuemin={0} aria-valuemax={spendLimit} aria-valuenow={Math.min(totals.value, spendLimit)} aria-valuetext={`${formatMoney(totals.value)} of ${formatMoney(spendLimit)}`}>
              <span className={"block h-full rounded-chip transition-[width] duration-200 motion-reduce:transition-none " + (overCap ? "bg-delta-down" : "bg-ink")} style={{ width: `${budgetUsed}%` }} />
            </div>
            {overCap ? (
              <p className="mt-2 flex items-center gap-2 text-caption text-delta-down">
                <IconWarning size="0.875rem" /> Over by {overText}
              </p>
            ) : null}
          </div>
        </dl>

        {loadError ? (
          <p className="mt-6 flex items-center gap-2 text-ui text-ink-2">
            <IconWarning size="1rem" /> Could not load the fantasy data: {loadError}
          </p>
        ) : !market ? (
          <BuilderSkeleton />
        ) : (
          <div className="mt-6 grid gap-6 lg:grid-cols-12 lg:items-start">
            <div className="lg:col-span-5">
              <TeamSlots state={state} assetById={assetById} meta={meta} target={target} boostMultiplier={boostMultiplier} onSelectSlot={selectSlot} onRemove={remove} onBoost={(id) => setState((s) => toggleBoost(s, id))} />
              {state.locked.length + state.banned.length > 0 ? (
                <p className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-caption text-ink-3">
                  <span>
                    {state.locked.length} locked, {state.banned.length} excluded
                  </span>
                  <button type="button" onClick={() => update({ locked: [], banned: [] })} className="press inline-flex min-h-11 items-center text-ink-2 underline underline-offset-2 hover:text-ink sm:min-h-0">
                    Clear
                  </button>
                </p>
              ) : null}
            </div>
            <div ref={pickerRef} className="scroll-mt-20 lg:sticky lg:top-4 lg:col-span-7">
              <AssetPicker assets={assets} state={state} meta={meta} kind={pickerKind} target={target} leftToSpend={spendable} assetById={assetById} onKind={setPickerKind} onPick={pick} onRemove={remove} onLock={toggleLock} onBan={toggleBan} onClearTarget={() => setTarget(null)} />
            </div>
          </div>
        )}
      </Section>

      <Section title="Optimiser" icon={IconChip} info="Best transfers, Boost and chip for this race." flush>
        <div className="grid gap-6 lg:grid-cols-12">
          <fieldset className="lg:col-span-4">
            <legend className="flex items-center gap-1 text-ui font-[550] text-ink">
              Objective <Info text="Expected: average. Safe: avoids big swings. Aggressive: chases upside. Value: points plus price growth." />
            </legend>
            <div role="radiogroup" onKeyDown={handleRovingKey} className="mt-2 grid grid-cols-4 rounded-control border border-rule sm:inline-grid">
              {OBJECTIVES.map((o) => (
                <button key={o.key} type="button" role="radio" tabIndex={state.risk === o.key ? 0 : -1} aria-checked={state.risk === o.key} onClick={() => update({ risk: o.key })} className={"press segment -my-px h-11 sm:h-9 rounded-control px-1.5 text-ui sm:px-3.5 " + (state.risk === o.key ? "segment-on" : "text-ink-2 hover:text-ink")}>
                  {o.label}
                </button>
              ))}
            </div>
          </fieldset>
          <fieldset className="lg:col-span-8">
            <legend className="flex items-center gap-1 text-ui font-[550] text-ink">
              Chips <Info text="Used: tick once the chip is spent. Play: use it this race." />
            </legend>
            <ul className="mt-2 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {CHIP_IDS.map((chip) => (
                <ChipToggle key={chip} chip={chip} available={state.chipsAvailable.includes(chip)} playing={state.chipToPlay === chip} onToggle={() => toggleChip(chip)} onPlay={() => update({ chipToPlay: state.chipToPlay === chip ? null : chip })} />
              ))}
            </ul>
          </fieldset>
        </div>

        <div className="mt-8 border-t border-rule pt-6">
          {loadError ? (
            <p className="flex items-center gap-2 text-ui text-ink-2">
              <IconWarning size="1rem" /> Could not load the fantasy data: {loadError}
            </p>
          ) : recommendation.error ? (
            <p className="flex items-center gap-2 text-ui text-ink-2">
              <IconWarning size="1rem" /> {recommendation.error}
            </p>
          ) : !recommendation.result || !market ? (
            <RecommendationSkeleton />
          ) : (
            <div className={recommendation.pending ? "opacity-60 transition-opacity" : "transition-opacity"} aria-busy={recommendation.pending}>
              <RecommendationView rec={recommendation.result} market={market} current={current} state={state} meta={meta} ms={recommendation.ms} />
            </div>
          )}
        </div>
      </Section>
    </>
  );
}

// ---------------------------------------------------------------------------
// pieces
// ---------------------------------------------------------------------------

function SummaryItem({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <dt className="text-ui text-ink-3">{label}</dt>
      <dd className="headline timing text-[1.75rem] leading-none text-ink">{value}</dd>
      <dd className="text-caption text-ink-3">{note}</dd>
    </div>
  );
}

/**
 * A chip: its name, a "Used" checkbox-style toggle (ticked once the chip is spent) and a primary
 * "Play" button for this race. The two controls look and read differently on purpose.
 */
function ChipToggle({ chip, available, playing, onToggle, onPlay }: { chip: ChipId; available: boolean; playing: boolean; onToggle: () => void; onPlay: () => void }) {
  const rule = CHIP_RULES[chip];
  const Icon = CHIP_ICON[chip];
  const used = !available;
  return (
    <li className={"flex items-center gap-1 rounded-control border p-0.5 " + (playing ? "border-[var(--accent)]" : "border-rule")}>
      <span className={"flex h-[2.375rem] min-w-0 flex-1 items-center gap-2 px-2.5 text-ui sm:h-[1.875rem] " + (used ? "text-ink-3 line-through" : "text-ink")} title={rule.effect}>
        <Icon size="1.125rem" className={"shrink-0 " + (used ? "text-ink-3" : "text-ink-2")} />
        <span className="truncate">{rule.name}</span>
      </span>
      <button type="button" role="checkbox" aria-checked={used} onClick={onToggle} aria-label={`${rule.name} used`} className="press hit-y inline-flex h-[2.375rem] shrink-0 items-center gap-1.5 rounded-[3px] px-2.5 text-ui text-ink-2 hover:bg-bg-hover hover:text-ink sm:h-[1.875rem]">
        <span className={"inline-flex size-4 items-center justify-center rounded-chip border text-[0.6875rem] leading-none " + (used ? "border-ink bg-ink text-bg" : "border-rule-strong")} aria-hidden="true">
          {used ? "✓" : ""}
        </span>
        Used
      </button>
      <button type="button" disabled={used} aria-pressed={playing} aria-label={`${playing ? "Stop playing" : "Play"} ${rule.name} this weekend`} onClick={onPlay} className={"press hit-y h-[2.375rem] w-[4.5rem] shrink-0 rounded-[3px] border text-ui font-[550] sm:h-[1.875rem] " + (playing ? "border-transparent bg-accent text-accent-ink" : "border-[var(--accent)] text-accent hover:bg-bg-hover disabled:border-rule disabled:text-ink-3 disabled:opacity-60")}>
        {playing ? "Playing" : "Play"}
      </button>
    </li>
  );
}

function BuilderSkeleton() {
  return (
    <div className="mt-6 grid gap-6 lg:grid-cols-12" aria-busy="true" aria-label="Loading the market">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:col-span-5 lg:grid-cols-1">
        {Array.from({ length: 7 }, (_, i) => (
          <div key={i} className="skeleton h-14 rounded-control" />
        ))}
      </div>
      <div className="skeleton h-[32rem] rounded-float lg:col-span-7" />
    </div>
  );
}

function RecommendationSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading recommendation">
      <div className="grid grid-cols-2 gap-6 sm:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="flex flex-col gap-2">
            <div className="h-4 w-20 animate-pulse rounded-control bg-bg-raised" />
            <div className="h-7 w-16 animate-pulse rounded-control bg-bg-raised" />
          </div>
        ))}
      </div>
      <div className="mt-6 border-y border-rule">
        {Array.from({ length: 7 }, (_, i) => (
          <div key={i} className="flex h-[3.25rem] items-center gap-3 border-b border-rule last:border-b-0">
            <div className="size-10 animate-pulse rounded-control bg-bg-raised" />
            <div className="h-3 w-40 animate-pulse rounded-control bg-bg-raised" />
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// glue
// ---------------------------------------------------------------------------

function toUserState(state: PlannerState, market: Market): UserState {
  const complete = isTeamComplete(state);
  return {
    team: complete ? { drivers: state.drivers as string[], constructors: state.constructors as string[] } : null,
    bank: 0,
    budget: state.costCap,
    freeTransfers: state.freeTransfers,
    chipsAvailable: state.chipsAvailable,
    chipsToPlay: state.chipToPlay ? [state.chipToPlay] : [],
    locked: state.locked.filter((id) => market.byId.has(id)),
    banned: state.banned,
    boost: state.boost,
    risk: state.risk === "value" ? "balanced" : state.risk === "expected" ? "balanced" : state.risk,
    objective: state.risk === "value" ? { kind: "value" } : state.risk === "expected" ? { kind: "expected" } : undefined,
    teamRacesCompleted: state.teamRacesCompleted,
  };
}

function safePrepare(file: FantasyFile): Market | null {
  try {
    return prepareMarket(file);
  } catch {
    return null;
  }
}

function safeEvaluate(market: Market, state: UserState, team: NonNullable<UserState["team"]>): TeamResult | null {
  try {
    return evaluateTeam(market, state, team);
  } catch {
    return null;
  }
}
