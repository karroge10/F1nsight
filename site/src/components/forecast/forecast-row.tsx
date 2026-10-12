"use client";

import { useState } from "react";
import Link from "next/link";
import type { DriverForecast } from "@/lib/data";
import { formatPercent } from "@/lib/format";
import { topWhyRows, whyRows, type WhyRow } from "@/lib/forecast";
import { ProbBar } from "@/components/ui/prob-bar";
import { PositionDist } from "@/components/charts/position-dist";
import { TeamLogo } from "@/components/ui/team-logo";
import { IconCaretDown } from "@/components/icons";
import { FactorStrip } from "./factor-chips";

/** Bars hide on phones so the table fits; the percentage stays. */
const BAR_WIDTH = "hidden w-14 bg-rule-strong! sm:block";

/** Enough to span every column at any width; the table clamps it to the real column count. */
const ALL_COLUMNS = 8;

/** How many factors show inline; the rest open in the expanded row. */
const INLINE_FACTORS = 2;

interface ForecastRowProps {
  driver: DriverForecast;
  place: number;
  poleMs: number | null;
}

/**
 * One driver in the predicted finishing order: a single compact row with the two factors that
 * moved the forecast most. Clicking anywhere on the row opens a full-width row with the
 * complete breakdown; the caret button does the same from the keyboard. Clicks on the driver
 * link and the button itself are left to those controls.
 */
export function ForecastRow({ driver, place, poleMs }: ForecastRowProps) {
  const [open, setOpen] = useState(false);
  const rows = whyRows(driver, poleMs);
  const top = topWhyRows(rows, INLINE_FACTORS);
  const dnfText = formatPercent(driver.pDnf);
  const detailId = `why-${driver.driverId}`;
  const toggle = () => setOpen((value) => !value);
  const onRowClick = (event: React.MouseEvent<HTMLTableRowElement>) => {
    const target = event.target as HTMLElement;
    if (target.closest("a, button")) return;
    toggle();
  };

  return (
    <>
      <tr onClick={onRowClick} className={"cursor-pointer " + (open ? "[&>td]:border-b-0!" : "")}>
        <td className="timing text-ink-2">P{place}</td>
        <td className="!pl-3">
          <div className="flex items-center gap-2">
            <TeamLogo constructorId={driver.constructorId} name={driver.team} color={driver.teamColor} size={20} />
            <Link href={`/drivers/${driver.driverId}`} className="tap-hit flex min-w-0 items-baseline gap-2 text-ink hover:underline underline-offset-2">
              <span className="timing font-[550] sm:hidden">{driver.code}</span>
              <span className="hidden font-[550] sm:inline">{driver.name}</span>
              <span className="hidden text-caption text-ink-3 sm:inline">{driver.team}</span>
            </Link>
            <ToggleButton open={open} onToggle={toggle} controls={detailId} name={driver.name} className="ml-auto" />
          </div>
        </td>
        <td className="num">
          <ProbBar value={driver.pWin} max={0.5} width={BAR_WIDTH} label="win" />
        </td>
        <td className="num">
          <ProbBar value={driver.pPodium} max={1} width={BAR_WIDTH} label="podium" />
        </td>
        <td className="num hidden md:table-cell">
          <ProbBar value={driver.pPoints} max={1} width={BAR_WIDTH} label="points" />
        </td>
        <td className={"num pr-4! " + (driver.pDnf >= 0.2 ? "text-delta-down" : "text-ink-2")}>{dnfText}</td>
        <td className="hidden xl:table-cell">
          <PositionDist dist={driver.positionDist} code={driver.code} />
        </td>
        <td className="hidden lg:table-cell">
          <InlineFactors rows={top} />
        </td>
      </tr>
      {open ? (
        <tr id={detailId}>
          <td colSpan={ALL_COLUMNS} className="whitespace-normal! pb-3 pt-1">
            {/* starts under the driver name, or the code on phones where cell padding is narrower */}
            <div className="pl-[4.1875rem] sm:pl-[4.625rem]">
              <FactorStrip rows={rows} />
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}

function InlineFactors({ rows }: { rows: WhyRow[] }) {
  if (rows.length === 0) return <span className="text-caption text-ink-3">no data</span>;
  return <FactorStrip rows={rows} className="flex-nowrap gap-x-4" />;
}

/** A 24px caret with an invisible 44px hit area (pseudo-element), so the row height stays put. */
function ToggleButton({ open, onToggle, controls, name, className }: { open: boolean; onToggle: () => void; controls: string; name: string; className: string }) {
  const label = open ? `Hide the forecast factors for ${name}` : `Show all forecast factors for ${name}`;
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      aria-controls={controls}
      aria-label={label}
      title={label}
      className={"relative inline-flex size-6 shrink-0 before:absolute before:-inset-2.5 before:content-[''] items-center justify-center rounded-control text-ink-3 hover:bg-bg-hover hover:text-ink " + className}
    >
      <IconCaretDown size="0.875rem" className={"transition-transform duration-150 " + (open ? "rotate-180" : "")} />
    </button>
  );
}
