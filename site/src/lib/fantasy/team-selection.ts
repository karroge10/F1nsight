// Team builder logic: adding, swapping and removing picks, the Boost driver, the team totals and
// the Cost Cap input. Pure functions over PlannerState, tested; the UI only wires them up.

import type { PlannerState } from "@/lib/fantasy/planner-state";
import { formatMoney } from "@/lib/format";

export type AssetKind = "driver" | "constructor";

export interface SlotRef {
  kind: AssetKind;
  index: number;
}

export interface PickAsset {
  id: string;
  kind: AssetKind;
  price: number;
  expectedPoints: number;
  expectedPriceChange: number;
}

export type PickerSort = "name" | "expectedPoints" | "price" | "value" | "expectedPriceChange";
export type SortDir = "asc" | "desc";

export interface PickerSortState {
  key: PickerSort;
  dir: SortDir;
}

/** Default picker order: projected points, best first. */
export const DEFAULT_PICKER_SORT: PickerSortState = { key: "expectedPoints", dir: "desc" };

export interface TeamTotals {
  /** Sum of the prices of the picked assets ($M). */
  value: number;
  /** Projected points of the picked assets, with the x2 Boost on the chosen driver. */
  points: number;
  /** Money left to spend: the Cost Cap minus the prices of the picked assets (negative when over). */
  leftToSpend: number;
  complete: boolean;
  /** True when the picks cost more than the Cost Cap. */
  over: boolean;
}

/** The game's Cost Cap starts at 100M and moves with team value; these bounds only catch typos. */
export const COST_CAP_MIN = 50;
export const COST_CAP_MAX = 200;

/**
 * Puts an asset in the team. With a target slot of the same kind the asset goes there (a swap
 * when the slot is filled); without one it fills the first empty slot. Unchanged when the asset
 * is already picked or there is no slot for it.
 */
export function pickAsset(state: PlannerState, asset: Pick<PickAsset, "id" | "kind">, target: SlotRef | null): PlannerState {
  const picks = [...state.drivers, ...state.constructors];
  if (picks.includes(asset.id)) return state;
  const slot = target && target.kind === asset.kind ? target : nextEmptySlot(state, asset.kind);
  if (!slot) return state;
  const list = asset.kind === "driver" ? [...state.drivers] : [...state.constructors];
  const out = list[slot.index];
  list[slot.index] = asset.id;
  const boost = out !== null && out === state.boost ? null : state.boost;
  return asset.kind === "driver" ? { ...state, drivers: list, boost } : { ...state, constructors: list, boost };
}

/** Empties the slot holding the asset; the Boost goes with it. */
export function removePick(state: PlannerState, id: string): PlannerState {
  const clear = (x: string | null) => (x === id ? null : x);
  const drivers = state.drivers.map(clear);
  const constructors = state.constructors.map(clear);
  const boost = state.boost === id ? null : state.boost;
  return { ...state, drivers, constructors, boost };
}

/** Sets the x2 Boost on a picked driver, or clears it when that driver already has it. */
export function toggleBoost(state: PlannerState, id: string): PlannerState {
  if (state.boost === id) return { ...state, boost: null };
  if (!state.drivers.includes(id)) return state;
  return { ...state, boost: id };
}

export function nextEmptySlot(state: PlannerState, kind: AssetKind): SlotRef | null {
  const list = kind === "driver" ? state.drivers : state.constructors;
  const index = list.indexOf(null);
  return index === -1 ? null : { kind, index };
}

export function slotAsset(state: PlannerState, slot: SlotRef): string | null {
  const list = slot.kind === "driver" ? state.drivers : state.constructors;
  return list[slot.index] ?? null;
}

export function teamTotals(state: PlannerState, assets: PickAsset[], boostMultiplier: number): TeamTotals {
  const entries = assets.map((a) => [a.id, a] as const);
  const byId = new Map(entries);
  const picks = [...state.drivers, ...state.constructors];
  const complete = picks.every((id) => id !== null);
  let value = 0;
  let points = 0;
  for (const id of picks) {
    const asset = id ? byId.get(id) : undefined;
    if (!asset) continue;
    value += asset.price;
    points += asset.expectedPoints;
  }
  const boosted = state.boost ? byId.get(state.boost) : undefined;
  if (boosted) points += (boostMultiplier - 1) * boosted.expectedPoints;
  const leftToSpend = round1(state.costCap - value);
  return { value: round1(value), points, leftToSpend, complete, over: leftToSpend < -0.05 };
}

/**
 * Extra money an asset costs over what it replaces: its price minus the price of the asset in
 * the target slot (or nothing when it fills an empty slot).
 */
export function swapCost(state: PlannerState, asset: Pick<PickAsset, "price" | "kind">, target: SlotRef | null, priceOf: (id: string) => number): number {
  const out = target && target.kind === asset.kind ? slotAsset(state, target) : null;
  const outPrice = out ? priceOf(out) : 0;
  return round1(asset.price - outPrice);
}

/**
 * Whether a pick with this net cost (see swapCost) is allowed. A team already over the cap (an old
 * link) may still make changes that do not cost money, but never one that adds to the overspend.
 */
export function isAffordable(cost: number, leftToSpend: number): boolean {
  const limit = Math.max(leftToSpend, 0);
  return cost <= limit + 1e-9;
}

/** Money left for picks this round: unlimited while Limitless is played (no cost cap). Wildcard keeps the cap. */
export function spendableThisRound(state: Pick<PlannerState, "chipToPlay" | "chipsAvailable">, leftToSpend: number): number {
  const limitless = state.chipToPlay === "limitless" && state.chipsAvailable.includes("limitless");
  return limitless ? Number.POSITIVE_INFINITY : leftToSpend;
}

/** Short reason an unaffordable pick is blocked, e.g. "Need +$1.2M". */
export function shortfallText(cost: number, leftToSpend: number): string {
  const missing = round1(cost - Math.max(leftToSpend, 0));
  return `Need +${formatMoney(missing)}`;
}

/**
 * Sorted copy of the picker list. Numbers default to best (largest) first; name sorts A to Z.
 * Ties keep a stable order by name so the list does not jump.
 */
export function sortPickerAssets<T extends PickAsset & { name?: string }>(assets: T[], key: PickerSort, dir: SortDir = key === "name" ? "asc" : "desc"): T[] {
  const sign = dir === "asc" ? 1 : -1;
  const byName = (a: T, b: T) => (a.name ?? a.id).localeCompare(b.name ?? b.id);
  if (key === "name") return [...assets].sort((a, b) => sign * byName(a, b));
  const score = (a: T) => (key === "value" ? pointsPerMillion(a) : a[key]);
  return [...assets].sort((a, b) => sign * (score(a) - score(b)) || byName(a, b));
}

/** Header click: the same column flips direction; a new column starts best first (names A to Z). */
export function nextSort(current: PickerSortState, key: PickerSort): PickerSortState {
  if (current.key === key) return { key, dir: current.dir === "asc" ? "desc" : "asc" };
  return { key, dir: key === "name" ? "asc" : "desc" };
}

export function pointsPerMillion(asset: Pick<PickAsset, "price" | "expectedPoints">): number {
  return asset.price > 0 ? asset.expectedPoints / asset.price : 0;
}

/**
 * Folds a legacy bank (money left, from old links and saves) into the Cost Cap: the game's cap
 * is the team value plus what is left in the bank. Unchanged when there is no bank or the team
 * is not complete (the value is unknown then, so the default cap stays).
 */
export function migrateLegacyBank(state: PlannerState, priceOf: (id: string) => number | undefined): PlannerState {
  if (state.bank === 0) return state;
  const picks = [...state.drivers, ...state.constructors];
  const prices = picks.map((id) => (id ? priceOf(id) : undefined));
  if (prices.some((price) => price === undefined)) return { ...state, bank: 0 };
  const value = prices.reduce<number>((sum, price) => sum + (price ?? 0), 0);
  const costCap = round1(value + state.bank);
  return { ...state, bank: 0, costCap };
}

/**
 * Reads the Cost Cap text field. Accepts a comma or a dot as the decimal mark and surrounding
 * spaces, rounded to the game's 0.1M step. Returns null while the text is not a number yet
 * (empty, "-", "abc"). Range checks are separate (costCapError), so nothing is clamped silently.
 */
export function parseCostCap(text: string): number | null {
  const normalized = text.trim().replace(",", ".");
  if (!/^-?\d*\.?\d*$/.test(normalized)) return null;
  const n = Number(normalized);
  if (normalized === "" || normalized === "-" || normalized === "." || !Number.isFinite(n)) return null;
  return round1(n);
}

/** Why a typed Cost Cap is refused, or null when it is usable. */
export function costCapError(text: string): string | null {
  if (text.trim() === "") return "Enter your Cost Cap";
  const n = parseCostCap(text);
  if (n === null) return "Numbers only, like 102.5";
  if (n < COST_CAP_MIN) return `Min $${formatCostCap(COST_CAP_MIN)}M`;
  if (n > COST_CAP_MAX) return `Max $${formatCostCap(COST_CAP_MAX)}M`;
  return null;
}

export function formatCostCap(n: number): string {
  return n.toFixed(1);
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
