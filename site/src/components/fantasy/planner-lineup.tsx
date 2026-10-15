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
    <div className="grid gap-4 xl:grid-cols-[2fr_5fr]">
      <section aria-label="Your constructors" className="min-w-0">
        <h2 className="mb-2 flex items-baseline gap-2 text-caption font-[650] text-ink-2">Constructors <span className="font-normal text-ink-3">{draft.constructors.filter(Boolean).length} / 2</span></h2>
        <div className="grid grid-cols-1 gap-1.5 min-[360px]:grid-cols-2">
          {card("constructor", 0)}
          {card("constructor", 1)}
        </div>
      </section>
      <section aria-label="Your drivers" className="min-w-0 border-t border-rule pt-3 xl:border-s xl:border-t-0 xl:ps-4 xl:pt-0">
        <h2 className="mb-2 flex items-baseline gap-2 text-caption font-[650] text-ink-2">Drivers <span className="font-normal text-ink-3">{draft.drivers.filter(Boolean).length} / 5</span></h2>
        <div className="grid grid-cols-1 gap-1.5 min-[360px]:grid-cols-2 sm:grid-cols-3 xl:grid-cols-5">
          {[0, 1, 2, 3, 4].map((i) => card("driver", i))}
        </div>
      </section>
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
    <div className={"group relative grid grid-cols-[minmax(0,1fr)_2.75rem] rounded-float " + surface + " " + ring}>
      <button type="button" aria-pressed={selected} onClick={onSelect} title="Click to swap" className="press grid h-14 min-w-0 grid-cols-[minmax(0,1fr)_auto] content-center items-baseline gap-x-1.5 gap-y-0.5 rounded-float py-1.5 ps-2.5 pe-1 text-start">
        <span aria-hidden="true" className="absolute start-0 top-1.5 bottom-1.5 w-[3px] rounded-[2px] bg-[var(--tc)]" style={lineStyle} />
        <span className="flex items-center gap-1 text-[0.8125rem] font-[750] tracking-[0.02em] text-ink">
          {asset.code}
          {multiplier > 1 ? <BoostBadge multiplier={multiplier} small /> : null}
        </span>
        <span className="timing text-end text-[0.8125rem] font-[700] text-ink" title="Projected points">{fixed1(points)}</span>
        <span className="truncate text-[0.6875rem] text-ink-3">{replaced ? <span className="font-[550] text-delta-up">in for {replaced}</span> : money(asset.price)}</span>
        <span className={"timing text-end text-[0.6875rem] " + tone(asset.priceChange)} title="Expected price change after this race">
          {signed(asset.priceChange)}M
        </span>
      </button>
      <button type="button" onClick={onRemove} aria-label={`Remove ${asset.code}`} title={`Remove ${asset.code}`} className="press flex min-h-11 w-11 items-center justify-center rounded-float text-lg text-ink-3 hover:bg-bg-hover hover:text-delta-down focus-visible:text-ink">
        ×
      </button>
    </div>
  );
}

function EmptyCard({ kind, selected, onSelect }: { kind: SlotKind; selected: boolean; onSelect: () => void }) {
  const ring = selected ? "shadow-[inset_0_0_0_2px_var(--prob-4)] text-ink" : "shadow-[inset_0_0_0_1px_var(--rule-strong)] text-ink-3 hover:text-ink";
  return (
    <button type="button" aria-pressed={selected} onClick={onSelect} className={"press flex h-14 w-full items-center justify-center rounded-float text-caption " + ring}>
      + {kind === "driver" ? "Driver" : "Constructor"}
    </button>
  );
}
