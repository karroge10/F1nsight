"use client";

// View switch at the top of the fantasy page: Planner or Backtest, kept in the URL as
// ?view=backtest. The planner stays mounted while hidden so its state and data survive a switch.

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";

export type FantasyView = "planner" | "backtest";

const VIEWS: { key: FantasyView; label: string }[] = [
  { key: "planner", label: "Planner" },
  { key: "backtest", label: "Backtest" },
];

export function FantasyViews({ planner, backtest }: { planner: ReactNode; backtest: ReactNode }) {
  const [view, setView] = useState<FantasyView>("planner");

  useEffect(() => {
    const id = window.requestAnimationFrame(() => setView(viewFromUrl()));
    return () => window.cancelAnimationFrame(id);
  }, []);

  function choose(next: FantasyView) {
    setView(next);
    const params = new URLSearchParams(window.location.search);
    if (next === "backtest") params.set("view", "backtest");
    else params.delete("view");
    const query = params.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${query ? `?${query}` : ""}`);
  }

  return (
    <div className="mx-auto max-w-[1440px] px-4 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3 pt-5 pb-5">
        <div className="inline-flex h-8 items-stretch rounded-control border border-rule" role="group" aria-label="Fantasy view">
          {VIEWS.map((v) => (
            <button key={v.key} type="button" aria-pressed={view === v.key} onClick={() => choose(v.key)} className={"press segment -my-px rounded-control px-3.5 text-ui " + (view === v.key ? "segment-on font-[600]" : "text-ink-2 hover:text-ink")}>
              {v.label}
            </button>
          ))}
        </div>
        <Link href="/fantasy/hindsight" className="text-caption text-ink-2 underline underline-offset-2 hover:text-ink">
          Best teams in hindsight
        </Link>
      </div>
      <div hidden={view !== "planner"}>{planner}</div>
      {view === "backtest" ? backtest : null}
    </div>
  );
}

function viewFromUrl(): FantasyView {
  const params = new URLSearchParams(window.location.search);
  return params.get("view") === "backtest" ? "backtest" : "planner";
}
