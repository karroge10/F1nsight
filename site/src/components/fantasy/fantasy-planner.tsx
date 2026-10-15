"use client";

// Fantasy planner page body. Layout, top to bottom: race header with the saved team tabs, the
// lineup strip (this week's draft), one control bar, then the views (Best teams, Prices, Next
// races) beside the pick list. Transfers count from the saved team (last week's lineup); the
// draft is this week's edits until Save. The engine (src/lib/fantasy/engine) does all the
// optimisation: fixed lineups are scored here on the main thread, the searches and the plan run
// in its Web Worker through usePlannerBoard.

import { useEffect, useMemo, useRef, useState } from "react";
import { prepareMarket, type Market } from "@/lib/fantasy/engine/market";
import { evaluateTeam } from "@/lib/fantasy/engine/optimiser";
import type { ChipId, FantasyFile, TeamResult, UserState } from "@/lib/fantasy/engine/types";
import { usePlannerBoard } from "@/lib/fantasy/use-recommendation";
import { isLineupComplete, lineupValue, placeTeam, sameLineup, transfersIn, type FullLineup, type Lineup } from "@/lib/fantasy/lineup";
import {
  addTeam,
  decodeTeamQuery,
  defaultPlannerTeams,
  encodeTeamQuery,
  loadStoredState,
  loadStoredTeams,
  MAX_TEAMS,
  mergeSharedTeam,
  sanitizeTeams,
  saveStoredTeams,
  teamsFromLegacy,
  toggleBanned,
  toggleLocked,
  updateTeam,
  type PlannerTeams,
  type SavedTeam,
} from "@/lib/fantasy/planner-state";
import { LocalTime } from "@/components/ui/local-time";
import { Flag } from "@/components/ui/flag";
import { IconWarning } from "@/components/icons";
import { fixed1, projectedPoints, type AssetView, type PlannerMeta } from "@/components/fantasy/planner-parts";
import { LineupStrip, type SlotKind, type SlotRef } from "@/components/fantasy/planner-lineup";
import { ControlBar, PlannerSettings, type PlannerChip, type TransferOption } from "@/components/fantasy/planner-bar";
import { BestTeams, NextRaces, PriceTables } from "@/components/fantasy/planner-views";
import { PickList } from "@/components/fantasy/planner-pick-list";

type Tab = "best" | "prices" | "plan";
const TABS: { key: Tab; label: string }[] = [
  { key: "best", label: "Best teams" },
  { key: "prices", label: "Prices" },
  { key: "plan", label: "Next races" },
];

/** 2026: every race has exactly 2 free transfers, unused ones do not carry over. */
const FREE_TRANSFERS = 2;
const DEADLINE_FORMAT: Intl.DateTimeFormatOptions = { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" };

export function FantasyPlanner({ meta }: { meta: PlannerMeta }) {
  const [teams, setTeams] = useState<PlannerTeams>(defaultPlannerTeams);
  const [drafts, setDrafts] = useState<Record<number, Lineup>>({});
  const [file, setFile] = useState<FantasyFile | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [chip, setChip] = useState<PlannerChip>("none");
  const [tab, setTab] = useState<Tab>("best");
  const [listKind, setListKind] = useState<SlotKind>("driver");
  const [selected, setSelected] = useState<SlotRef | null>(null);
  const hydrated = useRef(false);
  const now = useNow();

  useEffect(() => {
    fetch("/api/fantasy.json")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`fantasy data ${r.status}`))))
      .then((json: FantasyFile) => {
        const initial = initialTeams(json);
        setTeams(initial);
        setFile(json);
        hydrated.current = true;
      })
      .catch((e: Error) => setLoadError(e.message));
  }, []);

  const saved = teams.teams[teams.active];
  useEffect(() => {
    if (!hydrated.current) return;
    saveStoredTeams(teams);
    const params = new URLSearchParams(window.location.search);
    for (const key of ["d", "c", "bank"]) params.delete(key);
    const teamParams = encodeTeamQuery(saved);
    teamParams.forEach((value, key) => params.set(key, value));
    const query = params.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${query ? `?${query}` : ""}`);
  }, [teams, saved]);

  const market = useMemo(() => (file ? safePrepare(file) : null), [file]);
  const assets = useMemo(() => (market && file ? assetViews(market, file, meta.codes) : []), [market, file, meta.codes]);
  const assetById = useMemo(() => {
    const entries = assets.map((a) => [a.id, a] as const);
    return new Map(entries);
  }, [assets]);
  const assetOf = (id: string) => assetById.get(id);
  const priceOf = (id: string) => assetById.get(id)?.price;

  const draft = drafts[teams.active] ?? lineupOf(saved);
  const savedLineup = useMemo(() => lineupOf(saved), [saved]);
  const savedFull = isLineupComplete(savedLineup);
  const draftFull = isLineupComplete(draft);
  const savedValue = lineupValue(savedLineup, priceOf);
  const draftValue = lineupValue(draft, priceOf);
  const cap = savedValue + saved.bank;
  const bank = cap - draftValue;
  const engineChip: ChipId | null = chip === "none" ? null : chip;
  const unlimited = chip === "wildcard" || chip === "limitless";

  const userState = useMemo<UserState | null>(() => {
    if (!market) return null;
    const team = isLineupComplete(savedLineup) ? { drivers: [...savedLineup.drivers], constructors: [...savedLineup.constructors] } : null;
    const chips = engineChip ? [engineChip] : [];
    return { team, budget: Math.round(cap * 10) / 10, freeTransfers: FREE_TRANSFERS, chipsAvailable: chips, chipsToPlay: chips, teamRacesCompleted: 5, locked: teams.locked, banned: teams.banned, objective: { kind: "expected" } };
  }, [market, savedLineup, cap, engineChip, teams.locked, teams.banned]);

  const boardDraft = draftFull ? { drivers: [...draft.drivers], constructors: [...draft.constructors] } : null;
  const board = usePlannerBoard(file, userState, { topN: 16, maxTransfers: 3, draft: boardDraft, planRounds: 4 });
  const draftResult = market && userState && draftFull ? safeEvaluate(market, userState, draft) : null;
  const keepResult = market && userState && savedFull ? safeEvaluate(market, userState, savedLineup) : null;
  const teamScores = teams.teams.map((team) => savedScore(market, userState, team));

  const used = savedFull ? transfersIn(savedLineup, draft).length : 0;
  const penalty = unlimited || !savedFull ? 0 : Math.max(0, used - FREE_TRANSFERS) * 10;
  const projected = draftResult ? projectedPoints(draftResult) : null;
  const pickedCount = [...draft.drivers, ...draft.constructors].filter(Boolean).length;
  const keepPoints = keepResult ? projectedPoints(keepResult) : null;
  const gain = projected !== null && keepPoints !== null && used > 0 ? projected - keepPoints : null;
  const multipliers = boostMultipliers(draftResult);
  const options = transferOptions(board.result?.byTransfers ?? [], draft);
  const teamName = `Team ${teams.active + 1}`;
  const savedPicks = savedFull ? [...savedLineup.drivers, ...savedLineup.constructors] : [];
  const savedIds = new Set(savedPicks);
  const changedDraft = draft.drivers.join() !== savedLineup.drivers.join() || draft.constructors.join() !== savedLineup.constructors.join();

  /** Sets the draft; a team with nothing saved yet keeps its first full lineup as the saved team,
   * so transfers, points change and the optimiser count from it without a Save click. */
  function setDraft(next: Lineup) {
    if (!savedFull && isLineupComplete(next)) {
      saveLineup(next);
      return;
    }
    setDrafts((d) => ({ ...d, [teams.active]: next }));
  }
  function selectSlot(slot: SlotRef) {
    const same = selected?.kind === slot.kind && selected.index === slot.index;
    setSelected(same ? null : slot);
    setListKind(slot.kind);
  }
  function removePick(id: string) {
    const di = draft.drivers.indexOf(id);
    const ci = draft.constructors.indexOf(id);
    const drivers = draft.drivers.map((x) => (x === id ? null : x));
    const constructors = draft.constructors.map((x) => (x === id ? null : x));
    setDraft({ drivers, constructors });
    const slot: SlotRef = di >= 0 ? { kind: "driver", index: di } : { kind: "constructor", index: ci };
    setSelected(slot);
    setListKind(slot.kind);
  }
  function pick(asset: AssetView) {
    const kind = asset.kind;
    const list = kind === "driver" ? [...draft.drivers] : [...draft.constructors];
    const index = selected?.kind === kind ? selected.index : list.indexOf(null);
    if (index < 0) return;
    list[index] = asset.id;
    const next: Lineup = kind === "driver" ? { ...draft, drivers: list } : { ...draft, constructors: list };
    setDraft(next);
    const empty = list.indexOf(null);
    setSelected(empty >= 0 ? { kind, index: empty } : null);
  }
  function loadTeam(team: FullLineup) {
    const base = savedFull ? savedLineup : draft;
    const placed = placeTeam(base, team);
    setDraft(placed);
    setSelected(null);
  }
  function chooseOption(transfers: number) {
    const result = board.result?.byTransfers[transfers];
    if (result) loadTeam(result);
  }
  function save() {
    saveLineup(draft);
  }
  function saveLineup(lineup: Lineup) {
    const left = cap - lineupValue(lineup, priceOf);
    const team: SavedTeam = { drivers: [...lineup.drivers], constructors: [...lineup.constructors], bank: Math.round(left * 10) / 10 };
    const next = updateTeam(teams, team);
    setTeams(next);
    clearDraft();
  }
  function clearDraft() {
    setDrafts((d) => {
      const rest = { ...d };
      delete rest[teams.active];
      return rest;
    });
    setSelected(null);
  }
  function changeCap(value: number) {
    const savedBank = value - savedValue;
    const team: SavedTeam = { ...saved, bank: Math.round(savedBank * 10) / 10 };
    setTeams((s) => updateTeam(s, team));
  }
  function switchTeam(index: number) {
    setTeams((s) => ({ ...s, active: index }));
    setSelected(null);
  }
  function newTeam() {
    setTeams((s) => addTeam(s));
    setSelected(null);
  }
  function toggleLock(id: string) {
    const asset = assetOf(id);
    if (asset) setTeams((s) => toggleLocked(s, asset, assets));
  }
  function toggleBan(id: string) {
    const asset = assetOf(id);
    if (asset) setTeams((s) => toggleBanned(s, asset));
  }

  const listKindShown = selected ? selected.kind : listKind;
  const thisRace = meta.races[0]?.name ?? meta.raceName;
  const notes: Record<Tab, string> = {
    best: savedFull ? `From last week's ${teamName}` : "New team: no transfer limit",
    prices: `Price changes after the ${thisRace} race`,
    plan: `${teamName}, next ${meta.races.length} races`,
  };

  return (
    <div className="pb-12">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <Flag of={meta.country} size={24} keepSpace={false} />
        <div className="min-w-0">
          <h1 className="headline text-[1.625rem] leading-tight text-ink">{meta.raceName}</h1>
          <p className="mt-0.5 text-caption text-ink-3">
            Round {meta.round}
            {meta.deadline ? (
              <>
                {" · team lock "}
                <LocalTime iso={meta.deadline} options={DEADLINE_FORMAT} />
                {now !== null ? ` · ${untilText(meta.deadline, now)}` : null}
              </>
            ) : null}
          </p>
        </div>
        <div className="flex basis-full flex-wrap gap-1.5" role="group" aria-label="Your teams">
          {teams.teams.map((team, i) => {
            const on = i === teams.active;
            const score = on && projected !== null ? projected : teamScores[i];
            return (
              <button key={i} type="button" aria-pressed={on} onClick={() => switchTeam(i)} className={"press inline-flex min-h-11 items-center gap-2.5 rounded-control px-3.5 text-ui leading-none " + (on ? "selected-pill" : "bg-bg-raised text-ink-2 hover:text-ink")} title={team.drivers.some(Boolean) ? "Projected points" : "Empty team"}>
                Team {i + 1}
                {score === null ? null : <b className={"timing font-[650] " + (on ? "text-bg" : "text-ink")}>{fixed1(score)}</b>}
              </button>
            );
          })}
          {teams.teams.length < MAX_TEAMS ? (
            <button type="button" onClick={newTeam} className="press inline-flex min-h-11 items-center rounded-control px-3.5 text-ui leading-none text-ink-3 shadow-[inset_0_0_0_1px_var(--rule-strong)] hover:text-ink">
              + Add team
            </button>
          ) : null}
        </div>
      </header>

      {loadError ? (
        <p className="mt-6 flex items-center gap-2 text-ui text-ink-2">
          <IconWarning size="1rem" /> Could not load the fantasy data: {loadError}
        </p>
      ) : !market ? (
        <PlannerSkeleton />
      ) : (
        <>
          <div className="mt-3 flex flex-col gap-3">
            <PlannerSettings chip={chip} cap={cap} bank={bank} onChip={setChip} onCap={changeCap} />
            <LineupStrip draft={draft} saved={savedFull ? savedLineup : lineupOf(emptySaved())} multipliers={multipliers} selected={selected} assetOf={assetOf} onSelect={selectSlot} onRemove={removePick} />
            <ControlBar
              projected={projected}
              valueChange={draftResult?.expectedValueChange ?? null}
              picked={pickedCount}
              gain={gain}
              options={options}
              used={used}
              free={FREE_TRANSFERS}
              penalty={penalty}
              teamName={teamName}
              canSave={changedDraft}
              canReset={changedDraft}
              onOption={chooseOption}
              onSave={save}
              onReset={clearDraft}
            />
          </div>

          <div className="mt-4 grid border-t border-rule lg:grid-cols-[minmax(0,1fr)_22rem]">
            <section className="min-w-0 lg:border-e lg:border-rule lg:pe-6" aria-label="Optimiser views">
              <div className="flex flex-wrap items-center gap-x-1 border-b border-rule">
                {TABS.map((t) => (
                  <button key={t.key} type="button" aria-pressed={tab === t.key} onClick={() => setTab(t.key)} className={"-mb-px border-b-2 px-3 pt-2.5 pb-2 text-ui font-[600] first:ps-0 " + (tab === t.key ? "border-accent text-ink" : "border-transparent text-ink-3 hover:text-ink")}>
                    {t.label}
                  </button>
                ))}
              </div>
              <div className="flex flex-col items-start gap-2 border-b border-rule py-3">
                <p className="text-caption text-ink-3">{notes[tab]}</p>
              </div>
              <div className={board.pending ? "opacity-70 transition-opacity" : "transition-opacity"} aria-busy={board.pending}>
                {board.error ? (
                  <p className="mt-4 flex items-center gap-2 text-ui text-ink-2">
                    <IconWarning size="1rem" /> {board.error}
                  </p>
                ) : tab === "best" ? (
                  board.result ? <BestTeams teams={board.result.best} savedIds={savedIds} keepScore={keepPoints} isLoaded={(team) => sameLineup(draft, team)} assetOf={assetOf} onLoad={loadTeam} /> : <ListSkeleton />
                ) : tab === "prices" ? (
                  <PriceTables drivers={assets.filter((a) => a.kind === "driver")} constructors={assets.filter((a) => a.kind === "constructor")} meta={meta} />
                ) : (
                  <NextRaces plan={board.result?.plan ?? null} draft={draft} complete={draftFull} meta={meta} assetOf={assetOf} pointsIn={(id, round) => pointsIn(market, id, round)} changeIn={(id, round) => changeIn(market, id, round)} />
                )}
              </div>
            </section>
            <aside className="pt-3 lg:ps-4" aria-label="Pick list">
              <PickList
                kind={listKindShown}
                assets={assets}
                draft={draft}
                selected={selected}
                bank={bank}
                noCap={chip === "limitless"}
                teamName={teamName}
                locked={teams.locked}
                banned={teams.banned}
                assetOf={assetOf}
                onKind={(k) => {
                  setListKind(k);
                  setSelected(null);
                }}
                onPick={pick}
                onRemove={removePick}
                onLock={toggleLock}
                onBan={toggleBan}
                onCancel={() => setSelected(null)}
                onClearSettings={() => setTeams((s) => ({ ...s, locked: [], banned: [] }))}
              />
            </aside>
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// pieces
// ---------------------------------------------------------------------------

function PlannerSkeleton() {
  return (
    <div className="mt-6 flex flex-col gap-2" aria-busy="true" aria-label="Loading the market">
      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4 lg:grid-cols-7">
        {Array.from({ length: 7 }, (_, i) => (
          <div key={i} className="skeleton h-12 rounded-float" />
        ))}
      </div>
      <div className="skeleton h-12 rounded-float" />
      <div className="skeleton mt-4 h-[32rem] rounded-float" />
    </div>
  );
}

function ListSkeleton() {
  return (
    <div className="mt-3 flex flex-col gap-1.5" aria-busy="true" aria-label="Searching the best teams">
      {Array.from({ length: 10 }, (_, i) => (
        <div key={i} className="skeleton h-8 rounded-control" />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// glue
// ---------------------------------------------------------------------------

/** Re-renders every 30 seconds with the current time (null before hydration). */
function useNow(): number | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const first = window.requestAnimationFrame(tick);
    const id = window.setInterval(tick, 30_000);
    return () => {
      window.cancelAnimationFrame(first);
      window.clearInterval(id);
    };
  }, []);
  return now;
}

/** Saved teams on first load: storage (or the old single-team save), then a shared link, checked against the market. */
function initialTeams(file: FantasyFile): PlannerTeams {
  const priceEntries = file.assets.map((a) => [a.id, a.price ?? undefined] as const);
  const prices = new Map(priceEntries);
  const priceOf = (id: string) => prices.get(id);
  const legacy = loadStoredState();
  const stored = loadStoredTeams() ?? (legacy ? teamsFromLegacy(legacy, priceOf) : defaultPlannerTeams());
  const shared = decodeTeamQuery(window.location.search);
  const merged = shared ? mergeSharedTeam(stored, shared) : stored;
  const known = file.assets.filter((a) => a.price !== null).map((a) => ({ id: a.id, kind: a.kind }));
  return sanitizeTeams(merged, known);
}

function assetViews(market: Market, file: FantasyFile, codes: Record<string, string>): AssetView[] {
  const probEntries = file.assets.map((a) => [a.id, a.priceChangeProbs] as const);
  const probsById = new Map(probEntries);
  return market.assets.map((a) => ({
    id: a.id,
    kind: a.kind,
    code: codes[a.id] ?? a.id.slice(0, 3).toUpperCase(),
    color: a.teamColor,
    price: a.price,
    points: market.mean[a.index],
    priceChange: a.expectedPriceChange,
    pickable: a.pickable,
    probs: probsById.get(a.id),
  }));
}

function lineupOf(team: SavedTeam): Lineup {
  return { drivers: team.drivers, constructors: team.constructors };
}

function emptySaved(): SavedTeam {
  return { drivers: [null, null, null, null, null], constructors: [null, null], bank: 0 };
}

function savedScore(market: Market | null, state: UserState | null, team: SavedTeam): number | null {
  const lineup = lineupOf(team);
  if (!market || !state || !isLineupComplete(lineup)) return null;
  const plain: UserState = { ...state, team: lineup, chipsToPlay: [], chipsAvailable: [] };
  const result = safeEvaluate(market, plain, lineup);
  return result ? projectedPoints(result) : null;
}

function boostMultipliers(result: TeamResult | null): Record<string, number> {
  const out: Record<string, number> = {};
  if (!result) return out;
  if (result.boost) out[result.boost] = 2;
  if (result.extraBoost) out[result.extraBoost] = 3;
  return out;
}

function transferOptions(byTransfers: (TeamResult | null)[], draft: Lineup): TransferOption[] {
  const scores = byTransfers.map((r) => r?.score ?? Number.NEGATIVE_INFINITY);
  const top = Math.max(...scores);
  const options: TransferOption[] = [];
  byTransfers.forEach((result, transfers) => {
    if (!result) return;
    options.push({ transfers, score: projectedPoints(result), penalty: result.penalty, pressed: sameLineup(draft, result), best: result.score === top && byTransfers.length > 1 });
  });
  return options;
}

/** Expected points of an asset in this race or a horizon race. */
function pointsIn(market: Market, id: string, round: number): number {
  const index = market.byId.get(id);
  if (index === undefined) return 0;
  if (round === market.round) return market.mean[index];
  const horizon = market.horizon.find((h) => h.round === round);
  return horizon?.expectedPoints[id] ?? market.mean[index];
}

/** Expected price change of an asset after this race or a horizon race. */
function changeIn(market: Market, id: string, round: number): number {
  const index = market.byId.get(id);
  if (index === undefined) return 0;
  if (round === market.round) return market.assets[index].expectedPriceChange;
  const horizon = market.horizon.find((h) => h.round === round);
  return horizon?.expectedPriceChange[id] ?? 0;
}

/** "in 2d 4h", "in 3h 20m", or "locked". */
function untilText(deadline: string, now: number): string {
  const ms = new Date(deadline).getTime() - now;
  if (ms <= 0) return "locked";
  const minutes = Math.floor(ms / 60000);
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  if (days > 0) return `in ${days}d ${hours}h`;
  return `in ${hours}h ${minutes % 60}m`;
}

function safePrepare(file: FantasyFile): Market | null {
  try {
    return prepareMarket(file);
  } catch {
    return null;
  }
}

function safeEvaluate(market: Market, state: UserState, lineup: Lineup): TeamResult | null {
  if (!isLineupComplete(lineup)) return null;
  try {
    return evaluateTeam(market, state, lineup);
  } catch {
    return null;
  }
}
