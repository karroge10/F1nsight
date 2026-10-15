"use client";

// The lineup strip: two constructor cards, a gap, five driver cards, all one short row. A card
// shows the code, Boost, projected points, and the price or who it replaced plus the expected
// price change. Click selects the slot for a swap; the cross removes the pick.

import type { CSSProperties } from "react";
import type { Lineup } from "@/lib/fantasy/lineup";
import { BoostBadge, fixed1, money, signed, tone, type AssetLookup } from "@/components/fantasy/planner-parts";

export type SlotKind = "driver" | "constructor";

export interface SlotRef {
  kind: SlotKind;
  index: number;
}

interface LineupStripProps {
  draft: Lineup;
  saved: Lineup;
  /** Multiplier per driver id (2 for Boost, 3 for the 3x Boost). */
  multipliers: Record<string, number>;
  selected: SlotRef | null;
  assetOf: AssetLookup;
  onSelect: (slot: SlotRef) => void;
  onRemove: (id: string) => void;
}

export function LineupStrip({ draft, saved, multipliers, selected, assetOf, onSelect, onRemove }: LineupStripProps) {
  const savedIds = new Set([...saved.drivers, ...saved.constructors]);
  const hasSaved = [...savedIds].some((id) => id !== null);
  const card = (kind: SlotKind, index: number) => {
    const list = kind === "driver" ? draft.drivers : draft.constructors;
    const savedList = kind === "driver" ? saved.drivers : saved.constructors;
    const id = list[index];
    const isSelected = selected?.kind === kind && selected.index === index;
    const slot = { kind, index };
    const key = `${kind}-${index}`;
    if (!id) return <EmptyCard key={key} kind={kind} selected={isSelected} onSelect={() => onSelect(slot)} />;
    const previous = savedList[index];
    const changed = hasSaved && !savedIds.has(id);
    const replaced = changed && previous && previous !== id ? (assetOf(previous)?.code ?? null) : null;
    return <PickCard key={key} id={id} assetOf={assetOf} multiplier={multipliers[id] ?? 1} changed={changed} replaced={replaced} selected={isSelected} onSelect={() => onSelect(slot)} onRemove={() => onRemove(id)} />;
  };
  return (
    <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4 lg:grid-cols-[repeat(2,minmax(0,1fr))_0.375rem_repeat(5,minmax(0,1fr))]">
      {card("constructor", 0)}
      {card("constructor", 1)}
      <span aria-hidden="true" className="hidden lg:block" />
      {[0, 1, 2, 3, 4].map((i) => card("driver", i))}
    </div>
  );
}

interface PickCardProps {
  id: string;
  assetOf: AssetLookup;
  multiplier: number;
  changed: boolean;
  replaced: string | null;
  selected: boolean;
  onSelect: () => void;
  onRemove: () => void;
}

function PickCard({ id, assetOf, multiplier, changed, replaced, selected, onSelect, onRemove }: PickCardProps) {
  const asset = assetOf(id);
  if (!asset) return null;
  const surface = changed
    ? "bg-[color-mix(in_oklch,var(--delta-up)_12%,var(--bg-raised))] shadow-[inset_0_0_0_1px_color-mix(in_oklch,var(--delta-up)_45%,transparent)]"
    : "bg-bg-raised hover:bg-bg-hover";
  const ring = selected ? "shadow-[inset_0_0_0_2px_var(--prob-4)]" : "";
  const lineStyle = { "--tc": asset.color } as CSSProperties;
  const points = asset.points * multiplier;
  return (
    <div className="group relative">
      <button type="button" aria-pressed={selected} onClick={onSelect} title="Click to swap" className={"press grid h-12 w-full grid-cols-[minmax(0,1fr)_auto] content-center items-baseline gap-x-2 rounded-float py-1.5 ps-3 pe-2.5 text-start " + surface + " " + ring}>
        <span aria-hidden="true" className="absolute start-0 top-1.5 bottom-1.5 w-[3px] rounded-[2px] bg-[var(--tc)]" style={lineStyle} />
        <span className="flex items-center gap-1.5 text-[0.9375rem] font-[750] tracking-[0.02em] text-ink">
          {asset.code}
          {multiplier > 1 ? <BoostBadge multiplier={multiplier} /> : null}
        </span>
        <span className="timing text-end text-[0.9375rem] font-[700] text-ink group-hover:invisible">{fixed1(points)}</span>
        <span className="truncate text-[0.71875rem] text-ink-3">{replaced ? <span className="font-[550] text-delta-up">in for {replaced}</span> : money(asset.price)}</span>
        <span className={"timing text-end text-[0.71875rem] " + tone(asset.priceChange)} title="Expected price change after this race">
          {signed(asset.priceChange)}M
        </span>
      </button>
      <button type="button" onClick={onRemove} aria-label={`Remove ${asset.code}`} title="Remove" className="absolute end-1 top-1 hidden size-5 items-center justify-center rounded-control bg-bg-sunken text-[0.75rem] text-ink-2 hover:text-ink group-hover:inline-flex focus-visible:inline-flex">
        ×
      </button>
    </div>
  );
}

function EmptyCard({ kind, selected, onSelect }: { kind: SlotKind; selected: boolean; onSelect: () => void }) {
  const ring = selected ? "shadow-[inset_0_0_0_2px_var(--prob-4)] text-ink" : "shadow-[inset_0_0_0_1px_var(--rule-strong)] text-ink-3 hover:text-ink";
  return (
    <button type="button" aria-pressed={selected} onClick={onSelect} className={"press flex h-12 w-full items-center justify-center rounded-float text-caption " + ring}>
      + {kind === "driver" ? "Driver" : "Constructor"}
    </button>
  );
}
