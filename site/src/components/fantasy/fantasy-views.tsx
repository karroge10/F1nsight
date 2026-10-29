"use client";

// View switch at the top of the fantasy page: Planner, Backtest or Hindsight, kept in the URL as
// ?view=backtest or ?view=hindsight (no param for the planner). Other params such as ?cap= stay. The planner stays mounted while hidden so its state and data survive a switch.

import { useEffect, useState, type ReactNode } from "react";

export type FantasyView = "planner" | "backtest" | "hindsight";

const VIEWS: { key: FantasyView; label: string }[] = [
  { key: "planner", label: "Planner" },
  { key: "backtest", label: "Backtest" },
  { key: "hindsight", label: "Hindsight" },
];

export function FantasyViews({ planner, backtest, hindsight }: { planner: ReactNode; backtest: ReactNode; hindsight: ReactNode }) {
  const [view, setView] = useState<FantasyView>("planner");
  const [visited, setVisited] = useState<FantasyView[]>(["planner"]);

  useEffect(() => {
    const id = window.requestAnimationFrame(() => { const initial = viewFromUrl(); setView(initial); setVisited((previous) => previous.includes(initial) ? previous : [...previous, initial]); });
    return () => window.cancelAnimationFrame(id);
  }, []);

  function choose(next: FantasyView) {
    setView(next);
    setVisited((previous) => previous.includes(next) ? previous : [...previous, next]);
    const params = new URLSearchParams(window.location.search);
    if (next !== "planner") params.set("view", next);
    else params.delete("view");
    const query = params.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${query ? `?${query}` : ""}`);
  }

  return (
    <div className="fantasy-ui mx-auto max-w-[1440px] px-4 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3 pt-5 pb-5">
        <div className="fantasy-segmented" role="group" aria-label="Fantasy view">
          {VIEWS.map((v) => (
            <button key={v.key} type="button" aria-pressed={view === v.key} onClick={() => choose(v.key)} className={"fantasy-choice px-3.5 " + (view === v.key ? "font-[600]" : "text-ink-2 hover:text-ink")}>
              {v.label}
            </button>
          ))}
        </div>
      </div>
      <div hidden={view !== "planner"}>{planner}</div>
      <div hidden={view !== "backtest"}>{visited.includes("backtest") ? backtest : null}</div>
      <div hidden={view !== "hindsight"}>{visited.includes("hindsight") ? hindsight : null}</div>
    </div>
  );
}

function viewFromUrl(): FantasyView {
  const params = new URLSearchParams(window.location.search);
  const view = params.get("view");
  if (view === "backtest" || view === "hindsight") return view;
  return "planner";
}
