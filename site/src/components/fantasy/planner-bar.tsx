"use client";

// The control bar under the lineup, one line on desktop: projected points of the draft, the
// optimiser's best team per transfer count, free transfers, chip, Cost Cap, Save and Reset. Every
// control in the row is 2rem tall with the control radius and sits on the row's centre line.

import { useState } from "react";
import { fixed1, money, signed, tone } from "@/components/fantasy/planner-parts";

export type PlannerChip = "none" | "extraBoost" | "wildcard" | "limitless";

export interface TransferOption {
  transfers: number;
  score: number;
  penalty: number;
  pressed: boolean;
  best: boolean;
}

interface PlannerControlsProps {
  valueChange: number | null;
  projected: number | null;
  /** Picks in the draft (of 7), shown while the projection waits for a full team. */
  picked: number;
  /** Gain over keeping last week's team, null when there is nothing to compare. */
  gain: number | null;
  options: TransferOption[];
  used: number;
  free: number;
  /** Penalty of the draft's extra transfers (positive). */
  penalty: number;
  /** Wildcard or Limitless: transfers are free. */
  unlimited: boolean;
  chip: PlannerChip;
  /** Team value at today's prices plus the money in the bank ($M). */
  cap: number;
  /** Money left after buying the draft ($M), negative when over the cap. */
  bank: number;
  teamName: string;
  canSave: boolean;
  canReset: boolean;
  onOption: (transfers: number) => void;
  onChip: (chip: PlannerChip) => void;
  onCap: (cap: number) => void;
  onSave: () => void;
  onReset: () => void;
}

const CHIPS: { key: PlannerChip; label: string; title: string }[] = [
  { key: "none", label: "None", title: "No chip" },
  { key: "extraBoost", label: "3x", title: "3x Boost: one driver scores triple" },
  { key: "wildcard", label: "WC", title: "Wildcard: unlimited free transfers within the cost cap" },
  { key: "limitless", label: "LL", title: "Limitless: unlimited transfers and no cost cap for one race" },
];

type ControlBarProps = Pick<PlannerControlsProps, "projected" | "valueChange" | "picked" | "gain" | "options" | "used" | "free" | "penalty" | "teamName" | "canSave" | "canReset" | "onOption" | "onSave" | "onReset">;
type PlannerSettingsProps = Pick<PlannerControlsProps, "chip" | "cap" | "bank" | "onChip" | "onCap">;

export function PlannerSettings({ chip, cap, bank, onChip, onCap }: PlannerSettingsProps) {
  return (
    <div className="flex max-w-full items-center gap-2 overflow-x-auto" aria-label="Team settings">
      <CostCapField cap={cap} bank={bank} unlimited={chip === "limitless"} onCap={onCap} />
      <div className="inline-flex min-h-11 shrink-0 items-stretch rounded-control border border-rule" role="group" aria-label="Chip">
        {CHIPS.map((c) => (
          <button key={c.key} type="button" aria-pressed={chip === c.key} title={c.title} onClick={() => onChip(c.key)} className={"press segment -my-px w-11 min-w-11 shrink-0 rounded-control px-1 text-caption " + (chip === c.key ? "segment-on font-[600]" : "text-ink-2 hover:text-ink")}>
            {c.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function ControlBar(props: ControlBarProps) {
  const { projected, valueChange, picked, gain, options, used, free, penalty, teamName, canSave, canReset } = props;
  return (
    <div className="flex min-w-0 flex-col gap-2 py-2">
      <div className="flex items-center justify-between gap-2" aria-label="Team projection and actions">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
          {projected === null ? (
            <span className="text-caption text-ink-3"><b className="timing font-[600] text-ink">{picked}</b> of 7 picked</span>
          ) : (
            <span className="inline-flex flex-wrap items-baseline gap-x-1.5" aria-label="Projected points">
              <span className="headline timing text-[1.375rem] leading-none text-ink">{fixed1(projected)}</span>
              <span className="text-caption text-ink-3">pts</span>
              {gain !== null && Math.abs(gain) > 0.05 ? <span className={"timing text-caption font-[650] " + tone(gain)} title="Against keeping last week's team">{signed(gain)}</span> : null}
            </span>
          )}
          {valueChange !== null ? (
            <span className="inline-flex items-baseline gap-1 whitespace-nowrap" title="Total expected price change of your lineup after this race" aria-label="Projected price change">
              <b className={"timing text-ui font-[650] " + tone(valueChange)}>{signed(valueChange, 2)}M</b>
              <span className="text-caption text-ink-3">price</span>
            </span>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <button type="button" aria-label={`Save ${teamName}`} onClick={props.onSave} disabled={!canSave} title={canSave ? `Save ${teamName}` : "No unsaved changes"} className="press min-h-11 rounded-control bg-accent px-2.5 text-ui font-[650] text-accent-ink disabled:cursor-default disabled:opacity-85">Save</button>
          <button type="button" onClick={props.onReset} disabled={!canReset} title="Back to the last saved team" className="press min-h-11 rounded-control bg-bg-hover px-2.5 text-ui text-ink disabled:cursor-default disabled:text-ink-3">Reset</button>
        </div>
      </div>
      {penalty > 0 ? <p role="status" className="text-caption font-[600] text-delta-down">{used} transfers: {signed(-penalty, 0)} points. Only {free} transfers are free.</p> : null}
      {options.length > 0 ? (
        <div className="inline-flex h-8 max-w-full self-start items-stretch overflow-x-auto rounded-control border border-rule" role="group" aria-label="Optimiser teams by number of transfers">
          {options.map((option) => (
            <button key={option.transfers} type="button" aria-pressed={option.pressed} onClick={() => props.onOption(option.transfers)} title={optionTitle(option.transfers)} className={"press segment -my-px flex items-baseline gap-1.5 rounded-control px-2.5 py-1.5 whitespace-nowrap " + (option.pressed ? "segment-on" : "text-ink-2 hover:text-ink")}>
              <span className="text-caption">{optionLabel(option.transfers)}</span>
              <span className="timing text-ui font-[700]">{fixed1(option.score)}</span>
              {option.penalty > 0 ? <span className={"timing ms-0.5 text-ui font-[650] " + (option.pressed ? "" : "text-delta-down")}>{signed(-option.penalty, 0)}</span> : null}
              {option.best ? <span className={"text-[0.6875rem] font-[650] " + (option.pressed ? "" : "text-[var(--prob-4)]")}>best</span> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** Cost Cap: the total the team may cost (team value plus bank) and what the draft leaves of it.
 * Click the cap to type the one the game shows. */
function CostCapField({ cap, bank, unlimited, onCap }: { cap: number; bank: number; unlimited: boolean; onCap: (cap: number) => void }) {
  const [editing, setEditing] = useState<string | null>(null);
  const negative = !unlimited && bank < -0.049;
  const leftText = unlimited ? "no cap this race" : negative ? `${money(-bank)} over` : `${money(bank)} left`;
  function commit() {
    const value = Number(editing);
    if (editing !== null && editing.trim() !== "" && Number.isFinite(value)) onCap(value);
    setEditing(null);
  }
  return (
    <span className="relative flex min-h-11 shrink-0 flex-col items-start justify-center whitespace-nowrap rounded-control px-2 shadow-[inset_0_0_0_1px_var(--rule-strong)]" title="Team value at today's prices plus the bank. Click the amount to match it to the game.">
      <span className="flex items-baseline gap-1.5">
        <span className="text-[0.6875rem] text-ink-3">Cost cap</span>
        {editing === null ? (
          <button type="button" onClick={() => setEditing(cap.toFixed(1))} className="press timing -mx-1 rounded-control px-1 text-[0.8125rem] font-[700] text-ink after:absolute after:inset-0 hover:bg-bg-hover">
            {money(cap)}
          </button>
        ) : (
          <input
            autoFocus
            aria-label="Cost cap, $M"
            type="number"
            step={0.1}
            inputMode="decimal"
            value={editing}
            onChange={(e) => setEditing(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit();
              if (e.key === "Escape") setEditing(null);
            }}
            className="timing h-6 w-16 rounded-control border border-rule-strong bg-bg px-2 text-ui text-ink"
          />
        )}
      </span>
      <span aria-label="Budget remaining" className={"timing text-[0.6875rem] font-[600] " + (unlimited ? "text-ink-3" : negative ? "text-delta-down" : "text-delta-up")}>{leftText}</span>
    </span>
  );
}

function optionLabel(transfers: number): string {
  if (transfers === 0) return "Keep";
  return transfers === 1 ? "1 move" : `${transfers} moves`;
}

function optionTitle(transfers: number): string {
  if (transfers === 0) return "Keep last week's team";
  return `Best team with ${transfers} transfer${transfers === 1 ? "" : "s"}`;
}
