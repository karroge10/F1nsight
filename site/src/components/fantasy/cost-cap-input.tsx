"use client";

// Cost Cap field: the total budget as shown in the game. A text input with a local draft: the
// old number input wrote `Number(value) || 0` back on every keystroke, so clearing it, typing
// "-", a comma decimal or a partial value snapped the field to 0. Now the draft is free text,
// only a valid value is committed, and an out-of-range value stays visible with a hint below
// instead of being clamped.

import { useId, useState, type ReactNode } from "react";
import { costCapError, formatCostCap, parseCostCap } from "@/lib/fantasy/team-selection";

interface CostCapInputProps {
  value: number;
  onChange: (value: number) => void;
  id?: string;
  /** Shown under the field when the value is valid (e.g. money left to spend). */
  note?: ReactNode;
}

export function CostCapInput({ value, onChange, id, note }: CostCapInputProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const hintId = useId();
  const shown = draft ?? formatCostCap(value);
  const error = draft === null ? null : costCapError(draft);

  function handleChange(text: string) {
    setDraft(text);
    const parsed = parseCostCap(text);
    const problem = costCapError(text);
    if (parsed !== null && problem === null && parsed !== value) onChange(parsed);
  }

  function handleBlur() {
    if (draft !== null && costCapError(draft) === null) setDraft(null);
  }

  return (
    <span className="flex flex-col gap-1.5">
      <span data-focus-group className={"inline-flex cursor-text items-center self-start rounded-control border bg-bg focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[var(--focus)] " + (error ? "border-[var(--delta-down)]" : "border-rule")}>
        <span className="timing ps-2 text-ui text-ink-3" aria-hidden="true">
          $
        </span>
        <input
          id={id}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          spellCheck={false}
          value={shown}
          onChange={(e) => handleChange(e.target.value)}
          onBlur={handleBlur}
          onFocus={(e) => e.target.select()}
          aria-invalid={error ? true : undefined}
          aria-describedby={hintId}
          className="timing h-[2.625rem] w-20 bg-transparent ps-1 pe-2 text-end text-base text-ink outline-none sm:h-[2.125rem] sm:text-ui"
        />
        <span className="timing pe-2 text-ui text-ink-3" aria-hidden="true">
          M
        </span>
      </span>
      <span id={hintId} className={"timing text-caption " + (error ? "text-delta-down" : "text-ink-3")} aria-live="polite">
        {error ? `${error}. Not applied.` : note}
      </span>
    </span>
  );
}
