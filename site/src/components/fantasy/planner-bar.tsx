"use client";

// The control bar under the lineup, one line on desktop: projected points of the draft, the
// optimiser's best team per transfer count, free transfers, chip, Cost Cap, Save and Reset. Every
// control in the row is 2rem tall with the control radius and sits on the row's centre line.

import { useRef, useState } from "react";
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
    <div className="flex max-w-full flex-wrap items-center gap-4" aria-label="Team settings">
      <CostCapField cap={cap} bank={bank} unlimited={chip === "limitless"} onCap={onCap} />
      <div className="fantasy-segmented shrink-0" role="group" aria-label="Chip">
        {CHIPS.map((c) => (
          <button key={c.key} type="button" aria-pressed={chip === c.key} title={c.title} onClick={() => onChip(c.key)} className={"fantasy-choice min-w-11 px-3 " + (chip === c.key ? "font-[600]" : "text-ink-2 hover:text-ink")}>
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
          <button type="button" aria-label={`Save ${teamName}`} onClick={props.onSave} disabled={!canSave} title={canSave ? `Save ${teamName}` : "No unsaved changes"} className="fantasy-button fantasy-primary">Save</button>
          <button type="button" onClick={props.onReset} disabled={!canReset} title="Back to the last saved team" className="fantasy-button">Reset</button>
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
  const cancelBlur = useRef(false);
  const negative = !unlimited && bank < -0.049;
  const leftText = unlimited ? "no cap this race" : negative ? `${money(-bank)} over` : `${money(bank)} left`;
  function commit() {
    if (cancelBlur.current) { cancelBlur.current = false; setEditing(null); return; }
    const value = Number(editing);
    if (editing !== null && editing.trim() !== "" && Number.isFinite(value) && value > 0 && value <= 1000) onCap(value);
    setEditing(null);
  }
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1">
      <label className="flex items-center gap-2 text-caption text-ink-2">
        Cost cap
        <span className="flex h-11 items-center rounded-control border border-rule bg-bg px-3 focus-within:border-rule-strong sm:h-9">
          <span className="text-ink-3">$</span>
          <input
            aria-label="Cost cap, $M"
            type="number"
            min="0.1"
            max="1000"
            step="0.1"
            inputMode="decimal"
            value={editing ?? cap.toFixed(1)}
            onFocus={() => setEditing(cap.toFixed(1))}
            onChange={(e) => setEditing(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
              if (e.key === "Escape") { cancelBlur.current = true; e.currentTarget.blur(); }
            }}
            className="timing w-20 appearance-none bg-transparent px-1 text-base text-ink outline-none sm:text-ui"
          />
          <span className="text-ink-3">M</span>
        </span>
      </label>
      <span aria-label="Budget remaining" className={"timing text-caption " + (unlimited ? "text-ink-3" : negative ? "text-delta-down" : "text-ink-2")}>{leftText}</span>
    </div>
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
