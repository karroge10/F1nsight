"use client";

// Team builder in the style of the official game: seven slot cards (five drivers, two
// constructors) and a searchable, sortable market list beside them. Clicking a slot targets it;
// one click on a list row adds the asset or swaps it into the targeted slot. Locks and excludes
// live on the same rows. All state changes go through src/lib/fantasy/team-selection.ts.

import { useMemo, useState } from "react";
import type { MarketAsset } from "@/lib/fantasy/engine/market";
import type { PlannerState } from "@/lib/fantasy/planner-state";
import { DEFAULT_PICKER_SORT, isAffordable, nextSort, pointsPerMillion, shortfallText, slotAsset, sortPickerAssets, swapCost, type AssetKind, type PickerSort, type PickerSortState, type SlotRef } from "@/lib/fantasy/team-selection";
import { formatMoney, formatMoneySigned } from "@/lib/format";
import { handleRovingKey } from "@/lib/roving-keys";
import { DriverPortrait } from "@/components/ui/driver-portrait";
import { TeamLogo } from "@/components/ui/team-logo";
import { IconBoost, IconExclude, IconLock, IconMinus, IconSearch } from "@/components/icons";

export interface PickerMeta {
  codes: Record<string, string>;
  teams: Record<string, string>;
}

interface TeamSlotsProps {
  state: PlannerState;
  assetById: (id: string) => MarketAsset | undefined;
  meta: PickerMeta;
  target: SlotRef | null;
  boostMultiplier: number;
  onSelectSlot: (slot: SlotRef) => void;
  onRemove: (id: string) => void;
  onBoost: (id: string) => void;
}

interface AssetPickerProps {
  assets: MarketAsset[];
  state: PlannerState;
  meta: PickerMeta;
  kind: AssetKind;
  target: SlotRef | null;
  /** Money left for picks (Infinity while Limitless is played). */
  leftToSpend: number;
  assetById: (id: string) => MarketAsset | undefined;
  onKind: (kind: AssetKind) => void;
  onPick: (asset: MarketAsset) => void;
  onRemove: (id: string) => void;
  onLock: (id: string) => void;
  onBan: (id: string) => void;
  onClearTarget: () => void;
}

interface PickerColumn {
  key: PickerSort;
  label: string;
  title: string;
  numeric: boolean;
  /** Classes that hide the column on phones. */
  hide?: string;
}

/** Photo or logo size in the team slots; empty slots draw a placeholder of the same size. */
const SLOT_MEDIA = 32;

/** Header and row cells share this grid, so headers line up with their columns exactly. */
const PICKER_GRID = "grid grid-cols-[minmax(0,1fr)_3.25rem_2.25rem_9rem] items-center gap-x-1.5 sm:grid-cols-[minmax(0,1fr)_3.75rem_3.25rem_3.5rem_4.5rem_9.75rem] sm:gap-x-3";

const PICKER_COLUMNS: PickerColumn[] = [
  { key: "name", label: "Asset", title: "Sort by name", numeric: false },
  { key: "price", label: "Price", title: "Price", numeric: true },
  { key: "expectedPoints", label: "Pts", title: "Projected points this race", numeric: true },
  { key: "value", label: "Pts/M", title: "Projected points per million", numeric: true, hide: "hidden sm:block" },
  { key: "expectedPriceChange", label: "Change", title: "Projected price change", numeric: true, hide: "hidden sm:block" },
];

export function TeamSlots({ state, assetById, meta, target, boostMultiplier, onSelectSlot, onRemove, onBoost }: TeamSlotsProps) {
  return (
    <div className="flex flex-col gap-4">
      <SlotGroup title="Drivers" kind="driver" ids={state.drivers} state={state} assetById={assetById} meta={meta} target={target} boostMultiplier={boostMultiplier} onSelectSlot={onSelectSlot} onRemove={onRemove} onBoost={onBoost} />
      <SlotGroup title="Constructors" kind="constructor" ids={state.constructors} state={state} assetById={assetById} meta={meta} target={target} boostMultiplier={boostMultiplier} onSelectSlot={onSelectSlot} onRemove={onRemove} onBoost={onBoost} />
    </div>
  );
}

export function AssetPicker({ assets, state, meta, kind, target, leftToSpend, assetById, onKind, onPick, onRemove, onLock, onBan, onClearTarget }: AssetPickerProps) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<PickerSortState>(DEFAULT_PICKER_SORT);
  const picked = useMemo(() => new Set([...state.drivers, ...state.constructors]), [state.drivers, state.constructors]);
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const scoped = assets.filter((a) => a.kind === kind && (q === "" || a.name.toLowerCase().includes(q) || (meta.codes[a.id] ?? "").toLowerCase().includes(q) || (meta.teams[a.constructorId] ?? "").toLowerCase().includes(q)));
    return sortPickerAssets(scoped, sort.key, sort.dir);
  }, [assets, kind, query, sort, meta]);
  const targetId = target && target.kind === kind ? slotAsset(state, target) : null;
  const targetAsset = targetId ? assetById(targetId) : undefined;
  const slotsOfKind = kind === "driver" ? state.drivers : state.constructors;
  const hasRoom = slotsOfKind.includes(null) || (target !== null && target.kind === kind);
  const priceOf = (id: string) => assetById(id)?.price ?? 0;
  const targetText = targetAsset ? `Swap out ${targetAsset.name}` : null;

  return (
    <div className="flex min-w-0 flex-col rounded-float border border-rule bg-bg-raised/40">
      <div className="flex flex-col gap-3 border-b border-rule p-3">
        <div className="flex items-center gap-2">
          <div role="tablist" aria-label="Pick from" onKeyDown={handleRovingKey} className="inline-flex shrink-0 rounded-control border border-rule">
            {(["driver", "constructor"] as const).map((k) => (
              <button key={k} role="tab" type="button" tabIndex={kind === k ? 0 : -1} aria-selected={kind === k} onClick={() => onKind(k)} className={"press segment -my-px h-11 sm:h-9 rounded-control px-3.5 text-ui " + (kind === k ? "segment-on" : "text-ink-2 hover:text-ink")}>
                {k === "driver" ? "Drivers" : "Teams"}
              </button>
            ))}
          </div>
          <label className="relative flex min-w-0 flex-1 items-center">
            <span className="sr-only">Search {kind === "driver" ? "drivers" : "teams"}</span>
            <IconSearch size="1rem" className="pointer-events-none absolute left-2.5 text-ink-3" />
            <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search" className="h-11 w-full min-w-0 rounded-control border border-rule bg-bg pe-2 ps-8 text-base text-ink placeholder:text-ink-3 sm:h-9 sm:text-ui" />
          </label>
        </div>
        <div className={"items-center justify-between gap-3 text-caption " + (targetText || target ? "flex" : "hidden")}>
          <p className="text-ink-2" aria-live="polite">
            {targetText}
          </p>
          {target ? (
            <button type="button" onClick={onClearTarget} className="press inline-flex min-h-11 shrink-0 items-center text-ink-3 underline underline-offset-2 hover:text-ink sm:min-h-6">
              Clear slot
            </button>
          ) : null}
        </div>
      </div>
      {/* header and rows scroll in one container, so a vertical scrollbar narrows both alike */}
      <div role="table" aria-label={kind === "driver" ? "Drivers" : "Constructors"} className="scroll-y-fade min-w-0 lg:max-h-[24rem] lg:overflow-y-auto">
        <div role="rowgroup" className="sticky top-0 z-10 border-b border-rule bg-bg [background-image:linear-gradient(color-mix(in_oklab,var(--bg-raised)_40%,transparent),color-mix(in_oklab,var(--bg-raised)_40%,transparent))]">
          <div role="row" className={PICKER_GRID + " px-2 text-caption text-ink-3"}>
            {PICKER_COLUMNS.map((col) => (
              <SortHeader key={col.key} column={col} sort={sort} onSort={(key) => setSort((current) => nextSort(current, key))} />
            ))}
            <span role="columnheader" className="text-end">
              <span className="sr-only">Actions</span>
            </span>
          </div>
        </div>
        <ul role="rowgroup" aria-label={kind === "driver" ? "Drivers" : "Constructors"}>
          {visible.map((a) => {
            const cost = swapCost(state, a, target, priceOf);
            const affordable = isAffordable(cost, leftToSpend);
            return (
              <PickerRow
                key={a.id}
                asset={a}
                meta={meta}
                inTeam={picked.has(a.id)}
                hasRoom={hasRoom}
                swapping={Boolean(targetAsset)}
                affordable={affordable}
                shortfall={shortfallText(cost, leftToSpend)}
                locked={state.locked.includes(a.id)}
                banned={state.banned.includes(a.id)}
                onPick={() => onPick(a)}
                onRemove={() => onRemove(a.id)}
                onLock={() => onLock(a.id)}
                onBan={() => onBan(a.id)}
              />
            );
          })}
          {visible.length === 0 ? <li className="p-4 text-ui text-ink-3">No match.</li> : null}
        </ul>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// pieces
// ---------------------------------------------------------------------------

function SlotGroup({ title, kind, ids, state, assetById, meta, target, boostMultiplier, onSelectSlot, onRemove, onBoost }: TeamSlotsProps & { title: string; kind: AssetKind; ids: (string | null)[] }) {
  // a fixed list: one row per slot, filled or empty, so adding a pick never changes its length
  return (
    <div>
      <h3 className="label">{title}</h3>
      <ul className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-1">
        {ids.map((id, index) => {
          const asset = id ? assetById(id) : undefined;
          const slot = { kind, index };
          const selected = target?.kind === kind && target.index === index;
          return (
            <li key={`${kind}${index}`} data-slot={kind}>
              {asset ? (
                <FilledSlot asset={asset} meta={meta} selected={selected} boosted={state.boost === asset.id} boostMultiplier={boostMultiplier} locked={state.locked.includes(asset.id)} onSelect={() => onSelectSlot(slot)} onRemove={() => onRemove(asset.id)} onBoost={() => onBoost(asset.id)} />
              ) : (
                <EmptySlot kind={kind} selected={selected} onSelect={() => onSelectSlot(slot)} />
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function FilledSlot({ asset, meta, selected, boosted, boostMultiplier, locked, onSelect, onRemove, onBoost }: { asset: MarketAsset; meta: PickerMeta; selected: boolean; boosted: boolean; boostMultiplier: number; locked: boolean; onSelect: () => void; onRemove: () => void; onBoost: () => void }) {
  const isDriver = asset.kind === "driver";
  const code = isDriver ? (meta.codes[asset.id] ?? "") : "";
  const points = boosted ? asset.expectedPoints * boostMultiplier : asset.expectedPoints;
  const priceText = formatMoney(asset.price);
  const pointsText = `${points.toFixed(1)} pts`;
  return (
    <div className={"flex h-11 items-stretch rounded-control border bg-bg sm:h-14 transition-colors duration-150 " + (selected ? "border-ink" : "border-rule")}>
      <button type="button" onClick={onSelect} aria-pressed={selected} aria-label={`${asset.name}, ${priceText}, ${pointsText}. Select to swap`} className="press flex min-w-0 flex-1 items-center gap-2.5 ps-3 pe-1 text-start hover:bg-bg-hover">
        {isDriver ? <DriverPortrait driverId={asset.id} name={asset.name} teamColor={asset.teamColor} size={SLOT_MEDIA} /> : <TeamLogo constructorId={asset.id} name={asset.name} color={asset.teamColor} size={SLOT_MEDIA} />}
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-x-1.5 text-ui leading-tight text-ink">
            {/* phones show a driver's code, wider screens the full name; never both */}
            {isDriver ? <TeamLogo constructorId={asset.constructorId} name={meta.teams[asset.constructorId] ?? asset.name} color={asset.teamColor} size={16} className="self-center" /> : null}
            {code ? <span className="timing font-[550] sm:hidden">{code}</span> : null}
            <span className={"min-w-0 truncate font-[550] " + (code ? "hidden sm:inline" : "")} title={asset.name}>
              {asset.name}
            </span>
            {locked ? <IconLock size="0.75rem" className="shrink-0 text-ink-3" label="Locked" /> : null}
          </span>
          <span className="timing flex gap-3 text-caption leading-tight text-ink-2">
            <span>{priceText}</span>
            <span className={boosted ? "text-ink" : ""}>{pointsText}</span>
          </span>
        </span>
      </button>
      <span className="flex shrink-0 items-center gap-1 pe-1.5">
        {isDriver ? (
          <button type="button" onClick={onBoost} aria-pressed={boosted} aria-label={boosted ? `Remove the ${boostMultiplier}x Boost from ${asset.name}` : `Boost ${asset.name} (${boostMultiplier}x)`} title={`${boostMultiplier}x Boost`} className={"press inline-flex h-11 min-w-11 items-center justify-center gap-0.5 rounded-control border px-1.5 text-caption font-[600] sm:h-9 sm:min-w-9 " + (boosted ? "selected-pill border-transparent" : "border-rule text-ink-3 hover:text-ink")}>
            <IconBoost size="0.875rem" />
            {boostMultiplier}x
          </button>
        ) : null}
        <button type="button" onClick={onRemove} aria-label={`Remove ${asset.name}`} title="Remove" className="press inline-flex size-11 items-center justify-center rounded-control text-ink-3 hover:bg-bg-hover hover:text-ink sm:size-9">
          <IconMinus size="1rem" />
        </button>
      </span>
    </div>
  );
}

function EmptySlot({ kind, selected, onSelect }: { kind: AssetKind; selected: boolean; onSelect: () => void }) {
  const text = kind === "driver" ? "Empty driver slot" : "Empty constructor slot";
  return (
    <button type="button" onClick={onSelect} aria-pressed={selected} className={"press flex h-11 w-full items-center gap-2.5 rounded-control border border-dashed bg-bg ps-3 text-start text-ui hover:bg-bg-hover sm:h-14 " + (selected ? "border-ink text-ink" : "border-rule-strong text-ink-3")}>
      <span className={"shrink-0 border border-dashed border-rule-strong bg-bg-hover " + (kind === "driver" ? "rounded-full" : "rounded-control")} style={{ width: SLOT_MEDIA, height: SLOT_MEDIA }} aria-hidden="true" />
      {text}
    </button>
  );
}

function SortHeader({ column, sort, onSort }: { column: PickerColumn; sort: PickerSortState; onSort: (key: PickerSort) => void }) {
  const active = sort.key === column.key;
  const ariaSort = active ? (sort.dir === "asc" ? "ascending" : "descending") : "none";
  const arrow = active ? (sort.dir === "asc" ? "↑" : "↓") : "";
  const align = column.numeric ? "justify-end text-end" : "justify-start text-start";
  return (
    <span role="columnheader" aria-sort={ariaSort} className={column.hide ?? ""}>
      <button type="button" onClick={() => onSort(column.key)} title={column.title} className={"press flex min-h-11 w-full items-center gap-0.5 hover:text-ink sm:min-h-8 " + align + (active ? " text-ink" : "")}>
        {column.numeric ? <span className="w-2 text-ink-3" aria-hidden="true">{arrow}</span> : null}
        <span>{column.label}</span>
        {column.numeric ? null : <span className="w-2 text-ink-3" aria-hidden="true">{arrow}</span>}
      </button>
    </span>
  );
}

function PickerRow({ asset, meta, inTeam, hasRoom, swapping, affordable, shortfall, locked, banned, onPick, onRemove, onLock, onBan }: { asset: MarketAsset; meta: PickerMeta; inTeam: boolean; hasRoom: boolean; swapping: boolean; affordable: boolean; shortfall: string; locked: boolean; banned: boolean; onPick: () => void; onRemove: () => void; onLock: () => void; onBan: () => void }) {
  const code = asset.kind === "driver" ? (meta.codes[asset.id] ?? "") : "";
  const ppm = pointsPerMillion(asset).toFixed(2);
  const changeText = formatMoneySigned(asset.expectedPriceChange, 2);
  const changeTone = asset.expectedPriceChange > 0.005 ? "text-delta-up" : asset.expectedPriceChange < -0.005 ? "text-delta-down" : "text-ink-3";
  return (
    <li role="row" className={PICKER_GRID + " h-12 px-2 shadow-[inset_0_-1px_0_var(--rule)] " + (inTeam ? "bg-bg-hover" : "")}>
      <span role="cell" className={"flex min-w-0 items-center gap-1.5 text-ui " + (banned ? "text-ink-3 line-through" : "text-ink")}>
        <TeamLogo constructorId={asset.constructorId} name={meta.teams[asset.constructorId] ?? asset.name} color={asset.teamColor} size={18} />
        {code ? <span className="timing font-[550] sm:hidden">{code}</span> : null}
        <span className={"min-w-0 truncate font-[550] " + (code ? "hidden sm:inline" : "")} title={asset.name}>
          {asset.name}
        </span>
        {!asset.pickable ? <span className="text-caption text-ink-3">off</span> : null}
      </span>
      <span role="cell" className="timing text-end text-table text-ink">
        {formatMoney(asset.price)}
      </span>
      <span role="cell" className="timing text-end text-table text-ink">
        {asset.expectedPoints.toFixed(1)}
      </span>
      <span role="cell" className="timing hidden text-end text-table text-ink-2 sm:block">
        {ppm}
      </span>
      <span role="cell" className={"timing hidden text-end text-table sm:block " + changeTone}>
        {changeText}
      </span>
      <span role="cell" className="flex items-center justify-end gap-1">
        <RowAction asset={asset} inTeam={inTeam} hasRoom={hasRoom} swapping={swapping} affordable={affordable} shortfall={shortfall} banned={banned} onPick={onPick} onRemove={onRemove} />
        <button type="button" onClick={onLock} disabled={!asset.pickable && !locked} aria-pressed={locked} aria-label={`${locked ? "Unlock" : "Lock in"} ${asset.name}`} title={locked ? "Locked in: the optimiser keeps it" : "Lock in: the optimiser must keep it"} className={"press inline-flex size-11 items-center justify-center rounded-control border sm:size-9 " + (locked ? "selected-pill border-transparent" : "border-rule text-ink-3 hover:text-ink disabled:opacity-40")}>
          <IconLock size="0.875rem" />
        </button>
        <button type="button" onClick={onBan} aria-pressed={banned} aria-label={`${banned ? "Allow" : "Exclude"} ${asset.name}`} title={banned ? "Excluded: the optimiser never picks it" : "Exclude: the optimiser never picks it"} className={"press inline-flex size-11 items-center justify-center rounded-control border sm:size-9 " + (banned ? "selected-pill border-transparent" : "border-rule text-ink-3 hover:text-ink")}>
          <IconExclude size="0.875rem" />
        </button>
      </span>
    </li>
  );
}

function RowAction({ asset, inTeam, hasRoom, swapping, affordable, shortfall, banned, onPick, onRemove }: { asset: MarketAsset; inTeam: boolean; hasRoom: boolean; swapping: boolean; affordable: boolean; shortfall: string; banned: boolean; onPick: () => void; onRemove: () => void }) {
  const base = "press inline-flex h-11 w-12 flex-col items-center justify-center rounded-control border text-caption font-[550] leading-tight sm:h-9 sm:w-[4.75rem]";
  if (inTeam) {
    return (
      <button type="button" onClick={onRemove} aria-label={`Remove ${asset.name}`} className={base + " border-rule text-ink-2 hover:text-ink"}>
        <span className="sm:hidden">In</span>
        <span className="hidden sm:inline">In team</span>
      </button>
    );
  }
  const unavailable = !asset.pickable || banned || !hasRoom;
  if (unavailable) {
    const reason = !asset.pickable ? "Inactive" : banned ? "Excluded" : "Full";
    const short = !asset.pickable ? "Off" : banned ? "Excl" : "Full";
    return (
      <button type="button" disabled aria-label={`${asset.name}: ${reason}`} className={base + " border-rule text-ink-3 opacity-60"}>
        <span className="sm:hidden">{short}</span>
        <span className="hidden sm:inline">{reason}</span>
      </button>
    );
  }
  const verb = swapping ? "Swap" : "Add";
  if (!affordable) {
    const amount = shortfall.replace("Need ", "");
    return (
      <button type="button" disabled aria-label={`${verb} ${asset.name}: ${shortfall}`} title={shortfall} className={base + " border-rule text-ink-3"}>
        <span className="hidden sm:inline">Need</span>
        <span className="timing text-[0.625rem] font-normal">{amount}</span>
      </button>
    );
  }
  return (
    <button type="button" onClick={onPick} aria-label={`${verb} ${asset.name}`} className={base + " selected-pill border-transparent hover:opacity-90"}>
      <span>{verb}</span>
    </button>
  );
}
