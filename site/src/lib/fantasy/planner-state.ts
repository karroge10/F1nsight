// Planner state: what the user tells the fantasy tool. Lives in localStorage and in the URL
// query string (shareable), both encoded by this module. Pure functions, tested.

import type { ChipId } from "@/lib/fantasy/engine/types";

export type PlannerObjective = "expected" | "safe" | "aggressive" | "value";
import { CHIP_IDS } from "@/lib/fantasy/engine/types";

export interface PlannerState {
  drivers: (string | null)[];
  constructors: (string | null)[];
  /**
   * Legacy: money left in the bank, from links and saves made before the Cost Cap field. Folded
   * into costCap (team value + bank) once the market prices are known, then reset to 0.
   */
  bank: number;
  /** Cost Cap: the total budget as shown in the game (100M at the start, then it moves with team value). */
  costCap: number;
  freeTransfers: number;
  chipsAvailable: ChipId[];
  chipToPlay: ChipId | null;
  /** The user's x2 Boost driver (one of the picked drivers), or null when not chosen. */
  boost: string | null;
  risk: PlannerObjective;
  locked: string[];
  banned: string[];
  teamRacesCompleted: number;
}

export const STORAGE_KEY = "f1nsight-fantasy-v1";
export const DEFAULT_COST_CAP = 110;
/** 2026: 2 free transfers per race plus at most 1 carried over, so 3 at most. */
export const DEFAULT_FREE_TRANSFERS = 3;

export function defaultPlannerState(): PlannerState {
  return {
    drivers: [null, null, null, null, null],
    constructors: [null, null],
    bank: 0,
    costCap: DEFAULT_COST_CAP,
    freeTransfers: DEFAULT_FREE_TRANSFERS,
    chipsAvailable: [...CHIP_IDS],
    chipToPlay: null,
    boost: null,
    risk: "expected",
    locked: [],
    banned: [],
    teamRacesCompleted: 16,
  };
}

/** A team is complete when every slot is filled with a different asset (no duplicate picks). */
export function isTeamComplete(state: PlannerState): boolean {
  const picks = [...state.drivers, ...state.constructors];
  return picks.every((id) => id !== null) && new Set(picks).size === picks.length;
}

/** Clears picks that are not in the market or that repeat an earlier pick (e.g. from a shared link). */
export function dropInvalidPicks(state: PlannerState, isKnown: (id: string) => boolean): PlannerState {
  const seen = new Set<string>();
  const keep = (id: string | null) => {
    if (!id || !isKnown(id) || seen.has(id)) return null;
    seen.add(id);
    return id;
  };
  const drivers = state.drivers.map(keep);
  const constructors = state.constructors.map(keep);
  const boost = state.boost && drivers.includes(state.boost) ? state.boost : null;
  return { ...state, drivers, constructors, boost };
}

export interface ConstraintAsset {
  id: string;
  kind: "driver" | "constructor";
}

export const MAX_LOCKED = { driver: 5, constructor: 2 } as const;

/**
 * Validates locks and excludes against the market: drops unknown and repeated ids, lets an
 * exclude win over a lock on the same asset, and keeps at most a full team of locks per kind
 * (the first ones in the list).
 */
export function normalizeConstraints(state: PlannerState, assets: ConstraintAsset[]): PlannerState {
  const kindById = new Map(assets.map((a) => [a.id, a.kind]));
  const banned = uniqueKnown(state.banned, kindById);
  const bannedSet = new Set(banned);
  const counts = { driver: 0, constructor: 0 };
  const locked: string[] = [];
  for (const id of uniqueKnown(state.locked, kindById)) {
    const kind = kindById.get(id);
    if (!kind || bannedSet.has(id) || counts[kind] >= MAX_LOCKED[kind]) continue;
    counts[kind] += 1;
    locked.push(id);
  }
  return { ...state, locked, banned };
}

/** Lock toggle: locking removes an exclude; refused (state unchanged) when that kind is already fully locked. */
export function toggleLocked(state: PlannerState, asset: ConstraintAsset, assets: ConstraintAsset[]): PlannerState {
  if (state.locked.includes(asset.id)) return { ...state, locked: state.locked.filter((x) => x !== asset.id) };
  const kindById = new Map(assets.map((a) => [a.id, a.kind]));
  const sameKind = state.locked.filter((id) => kindById.get(id) === asset.kind).length;
  if (sameKind >= MAX_LOCKED[asset.kind]) return state;
  return { ...state, locked: [...state.locked, asset.id], banned: state.banned.filter((x) => x !== asset.id) };
}

/** Exclude toggle: excluding removes a lock. */
export function toggleBanned(state: PlannerState, asset: ConstraintAsset): PlannerState {
  if (state.banned.includes(asset.id)) return { ...state, banned: state.banned.filter((x) => x !== asset.id) };
  return { ...state, banned: [...state.banned, asset.id], locked: state.locked.filter((x) => x !== asset.id) };
}

export function isTeamEmpty(state: PlannerState): boolean {
  return state.drivers.every((d) => d === null) && state.constructors.every((c) => c === null);
}

/** Compact query string, e.g. ?d=ver,ham,,,&c=mer,fer&cap=102.5&ft=2&chips=wildcard.autopilot&play=wildcard&risk=safe */
export function encodePlannerState(state: PlannerState): string {
  const params = new URLSearchParams();
  if (!isTeamEmpty(state)) {
    params.set("d", state.drivers.map((d) => d ?? "").join(","));
    params.set("c", state.constructors.map((c) => c ?? "").join(","));
  }
  if (state.bank !== 0) params.set("bank", String(state.bank));
  if (state.costCap !== DEFAULT_COST_CAP) params.set("cap", String(state.costCap));
  if (state.freeTransfers !== DEFAULT_FREE_TRANSFERS) params.set("ft", String(state.freeTransfers));
  if (state.chipsAvailable.length !== CHIP_IDS.length) params.set("chips", state.chipsAvailable.join("."));
  if (state.chipToPlay) params.set("play", state.chipToPlay);
  if (state.boost) params.set("boost", state.boost);
  if (state.risk !== "expected") params.set("risk", state.risk);
  if (state.locked.length) params.set("lock", state.locked.join(","));
  if (state.banned.length) params.set("ban", state.banned.join(","));
  if (state.teamRacesCompleted !== 16) params.set("races", String(state.teamRacesCompleted));
  const text = params.toString();
  return text ? `?${text}` : "";
}

export function decodePlannerState(query: string, base: PlannerState = defaultPlannerState()): PlannerState {
  const params = new URLSearchParams(query.startsWith("?") ? query.slice(1) : query);
  const state: PlannerState = { ...base, drivers: [...base.drivers], constructors: [...base.constructors] };
  const d = params.get("d");
  if (d !== null) state.drivers = padList(d.split(","), 5);
  const c = params.get("c");
  if (c !== null) state.constructors = padList(c.split(","), 2);
  const bank = params.get("bank");
  if (bank !== null && Number.isFinite(Number(bank))) state.bank = Number(bank);
  const cap = params.get("cap");
  if (cap !== null && Number.isFinite(Number(cap)) && Number(cap) > 0) state.costCap = Number(cap);
  const ft = params.get("ft");
  if (ft !== null && Number.isFinite(Number(ft))) state.freeTransfers = Math.max(0, Math.min(3, Math.round(Number(ft))));
  const chips = params.get("chips");
  if (chips !== null) state.chipsAvailable = chips.split(".").filter(isChip);
  const play = params.get("play");
  if (play !== null) state.chipToPlay = isChip(play) ? play : null;
  const boost = params.get("boost");
  if (boost !== null) state.boost = boost && state.drivers.includes(boost) ? boost : null;
  const risk = params.get("risk");
  if (risk === "safe" || risk === "expected" || risk === "aggressive" || risk === "value") state.risk = risk;
  if (risk === "balanced") state.risk = "expected";
  const lock = params.get("lock");
  if (lock !== null) state.locked = lock.split(",").filter(Boolean);
  const ban = params.get("ban");
  if (ban !== null) state.banned = ban.split(",").filter(Boolean);
  const races = params.get("races");
  if (races !== null && Number.isFinite(Number(races))) state.teamRacesCompleted = Math.max(1, Math.round(Number(races)));
  return state;
}

export function loadStoredState(): PlannerState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return sanitizeState(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function saveStoredState(state: PlannerState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // storage unavailable
  }
}

/** Saved state comes from localStorage and may be stale or hand-edited: keep only values of the right type. */
function sanitizeState(value: unknown): PlannerState {
  const saved = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const base = defaultPlannerState();
  const drivers = padList(stringList(saved.drivers), 5);
  const boost = typeof saved.boost === "string" && drivers.includes(saved.boost) ? saved.boost : null;
  const risk = saved.risk === "safe" || saved.risk === "expected" || saved.risk === "aggressive" || saved.risk === "value" ? saved.risk : base.risk;
  return {
    drivers,
    constructors: padList(stringList(saved.constructors), 2),
    bank: typeof saved.bank === "number" && Number.isFinite(saved.bank) ? saved.bank : base.bank,
    costCap: typeof saved.costCap === "number" && Number.isFinite(saved.costCap) && saved.costCap > 0 ? saved.costCap : base.costCap,
    freeTransfers: typeof saved.freeTransfers === "number" && Number.isFinite(saved.freeTransfers) ? Math.max(0, Math.min(3, Math.round(saved.freeTransfers))) : base.freeTransfers,
    chipsAvailable: stringList(saved.chipsAvailable).filter(isChip),
    chipToPlay: typeof saved.chipToPlay === "string" && isChip(saved.chipToPlay) ? saved.chipToPlay : null,
    boost,
    risk,
    locked: stringList(saved.locked),
    banned: stringList(saved.banned),
    teamRacesCompleted: typeof saved.teamRacesCompleted === "number" && Number.isFinite(saved.teamRacesCompleted) ? Math.max(1, Math.round(saved.teamRacesCompleted)) : base.teamRacesCompleted,
  };
}

function uniqueKnown(ids: string[], kindById: Map<string, string>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    if (!kindById.has(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((x): x is string => typeof x === "string" && x !== "") : [];
}

function padList(values: string[], length: number): (string | null)[] {
  const out: (string | null)[] = [];
  for (let i = 0; i < length; i++) {
    const value = values[i];
    out.push(value ? value : null);
  }
  return out;
}

function isChip(value: string): value is ChipId {
  return (CHIP_IDS as readonly string[]).includes(value);
}
