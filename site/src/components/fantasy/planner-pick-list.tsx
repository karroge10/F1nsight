"use client";

// Pick list beside the views: every driver or constructor with price, projection (read only),
// expected price change, the optimiser's always/never pick toggles and one action button
// (add, remove, or swap into the selected slot). Sized to show all 22 drivers without an inner
// scroll box.

import type { ReactNode } from "react";
import { IconExclude, IconLock } from "@/components/icons";
import { CodeCell, fixed1, money, signed, tone, type AssetLookup, type AssetView } from "@/components/fantasy/planner-parts";
import type { SlotKind, SlotRef } from "@/components/fantasy/planner-lineup";
import type { Lineup } from "@/lib/fantasy/lineup";

interface PickListProps {
  kind: SlotKind;
  assets: AssetView[];
  draft: Lineup;
  selected: SlotRef | null;
  bank: number;
  /** Limitless: no cost cap. */
  noCap: boolean;
  teamName: string;
  locked: string[];
  banned: string[];
  assetOf: AssetLookup;
  onKind: (kind: SlotKind) => void;
  onPick: (asset: AssetView) => void;
  onRemove: (id: string) => void;
  onLock: (id: string) => void;
  onBan: (id: string) => void;
  onCancel: () => void;
  onClearSettings: () => void;
}

export function PickList(props: PickListProps) {
  const { kind, assets, draft, selected, bank, noCap, teamName, locked, banned, assetOf } = props;
  const slots = kind === "driver" ? draft.drivers : draft.constructors;
  const target = selected && selected.kind === kind ? slots[selected.index] : null;
  const targetAsset = target ? assetOf(target) : undefined;
  const room = slots.some((id) => id === null);
  const inLineup = new Set([...draft.drivers, ...draft.constructors]);
  const rows = assets.filter((a) => a.kind === kind).sort((a, b) => b.points - a.points);
  const settings = locked.length + banned.length;

  const action = (asset: AssetView) => {
    if (inLineup.has(asset.id)) {
      return <ActionButton label="−" title={`Remove from ${teamName}`} outline onClick={() => props.onRemove(asset.id)} />;
    }
    if (!asset.pickable) return <ActionButton label="+" title="Not available to buy" disabled />;
    const slotSelected = selected?.kind === kind;
    if (!slotSelected && !room) return <ActionButton label="+" title="Lineup full: click a card above to swap it" disabled />;
    const freed = targetAsset ? targetAsset.price : 0;
    const left = bank + freed - asset.price;
    if (!noCap && left < -1e-9) return <ActionButton label={targetAsset ? "⇄" : "+"} title={`${money(-left)} over budget`} disabled />;
    const title = targetAsset ? `Swap in for ${targetAsset.code}` : `Add to ${teamName}`;
    return <ActionButton label={targetAsset ? "⇄" : "+"} title={title} onClick={() => props.onPick(asset)} />;
  };

  return (
    <div>
      <div className="flex h-8 items-stretch rounded-control border border-rule" role="group" aria-label="Pick list">
        {(["driver", "constructor"] as const).map((k) => (
          <button key={k} type="button" aria-pressed={kind === k} onClick={() => props.onKind(k)} className={"press segment -my-px flex-1 rounded-control text-ui font-[600] " + (kind === k ? "segment-on" : "text-ink-2 hover:text-ink")}>
            {k === "driver" ? "Drivers" : "Constructors"}
          </button>
        ))}
      </div>
      <p className="mt-1.5 mb-1 min-h-[1.125rem] text-caption text-ink-2">
        {targetAsset ? (
          <>
            Swapping <b className="text-ink">{targetAsset.code}</b>: pick a replacement or{" "}
            <button type="button" onClick={props.onCancel} className="underline underline-offset-2 hover:text-ink">
              cancel
            </button>
          </>
        ) : room || selected?.kind === kind ? (
          "+ adds to your lineup"
        ) : (
          "Click a card above to swap it, − to remove"
        )}
      </p>
      <table className="w-full table-fixed border-collapse text-table">
        <colgroup>
          <col />
          <col className="w-[3.25rem]" />
          <col className="w-[2.75rem]" />
          <col className="w-[3.75rem]" />
          <col className="w-[3.5rem]" />
          <col className="w-[2.5rem]" />
        </colgroup>
        <thead>
          <tr className="text-[0.6875rem] text-ink-3">
            <th scope="col" className="pt-1 pb-1 ps-1 text-start font-[500]">
              <span className="sr-only">{kind === "driver" ? "Driver" : "Constructor"}</span>
            </th>
            <th scope="col" title="Price, $M" className="cursor-help px-1 pt-1 pb-1 text-end font-[500]">Price</th>
            <th scope="col" title="Projected points this race" className="cursor-help px-1 pt-1 pb-1 text-end font-[500]">Proj</th>
            <th scope="col" title="Expected price change after this race, $M" className="cursor-help px-1 pt-1 pb-1 text-end font-[500]">Price chg</th>
            <th scope="col" title="For the optimiser: always pick or never pick" className="cursor-help px-1 pt-1 pb-1 text-center font-[500]">Optimiser</th>
            <th scope="col" className="pt-1 pb-1">
              <span className="sr-only">Action</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((asset) => {
            const isIn = inLineup.has(asset.id);
            const isLocked = locked.includes(asset.id);
            const isBanned = banned.includes(asset.id);
            const fade = isBanned ? "opacity-35" : "";
            return (
              <tr key={asset.id} className={"border-t border-rule " + (isIn ? "bg-bg-raised" : "hover:bg-bg-raised")}>
                <td className={"h-[1.8125rem] ps-1 " + fade}>
                  <CodeCell asset={asset} />
                </td>
                <td className={"timing px-1 text-end text-ink-2 " + fade}>{asset.price.toFixed(1)}</td>
                <td className={"timing px-1 text-end font-[650] text-ink " + fade}>{fixed1(asset.points)}</td>
                <td className={"timing px-1 text-end " + tone(asset.priceChange) + " " + fade}>{signed(asset.priceChange)}</td>
                <td className="px-1 text-center">
                  <span className="inline-flex gap-0.5">
                    <ToggleIcon on={isLocked} danger={false} label={`Always pick ${asset.code}`} onClick={() => props.onLock(asset.id)}>
                      <IconLock size="0.8125rem" />
                    </ToggleIcon>
                    <ToggleIcon on={isBanned} danger label={`Never pick ${asset.code}`} onClick={() => props.onBan(asset.id)}>
                      <IconExclude size="0.8125rem" />
                    </ToggleIcon>
                  </span>
                </td>
                <td className="pe-1 text-end">{action(asset)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {settings > 0 ? (
        <button type="button" onClick={props.onClearSettings} className="press mt-2 h-8 rounded-control bg-bg-hover px-3 text-ui text-ink">
          Reset {settings} optimiser setting{settings === 1 ? "" : "s"}
        </button>
      ) : null}
    </div>
  );
}

function ActionButton({ label, title, onClick, disabled = false, outline = false }: { label: string; title: string; onClick?: () => void; disabled?: boolean; outline?: boolean }) {
  const look = outline ? "shadow-[inset_0_0_0_1px_var(--rule-strong)] text-ink-2 hover:text-ink" : "bg-bg-hover text-ink hover:bg-ink hover:text-bg";
  const off = disabled ? "cursor-not-allowed opacity-35 hover:bg-bg-hover hover:text-ink" : "";
  return (
    <button type="button" title={title} aria-label={title} aria-disabled={disabled || undefined} onClick={disabled ? undefined : onClick} className={"press inline-flex h-[1.375rem] min-w-[1.875rem] items-center justify-center rounded-control text-table font-[700] " + look + " " + off}>
      {label}
    </button>
  );
}

function ToggleIcon({ on, danger, label, onClick, children }: { on: boolean; danger: boolean; label: string; onClick: () => void; children: ReactNode }) {
  const active = on ? (danger ? "bg-delta-down text-accent-ink" : "bg-ink text-bg") : "text-ink-2 hover:bg-bg-hover hover:text-ink";
  return (
    <button type="button" aria-pressed={on} aria-label={label} title={label} onClick={onClick} className={"press inline-flex size-[1.375rem] items-center justify-center rounded-control " + active}>
      {children}
    </button>
  );
}
