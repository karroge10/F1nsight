"use client";

import { Suspense, useState, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { sessionSpec } from "@/lib/sessions";
import { handleRovingKey } from "@/lib/roving-keys";
import { LocalTime } from "@/components/ui/local-time";
import { SectionTitle } from "@/components/ui/section";
import { IconCalendar } from "@/components/icons";

export interface SessionTab {
  /** URL slug, also the panel key: `fp1`, `sq`, `sprint`, `qualifying`, `race`. */
  slug: string;
  label: string;
  /** Narrow screens: `FP1`, `SQ`, `Quali`. */
  shortLabel: string;
  time: string | null;
  state: "done" | "live" | "upcoming";
}

interface SessionSwitcherProps {
  tabs: SessionTab[];
  /** One server-rendered panel per tab, keyed by slug. */
  panels: Record<string, ReactNode>;
  /** The session open by default, when the URL names none. */
  initial: string;
}

const TAB_TIME: Intl.DateTimeFormatOptions = { weekday: "short", hour: "2-digit", minute: "2-digit" };

/**
 * The weekend's sessions as one row of tabs, each with its local start time, and the open
 * session's panel below. Every panel is prerendered; switching only swaps which one shows and
 * rewrites `?session=` in place, so nothing above the panel moves. The HTML opens the default
 * session and `?session=fp1` is applied in the browser. The panel box is at least a screen tall,
 * so a short session never pulls the page up under the tabs.
 */
export function SessionSwitcher(props: SessionSwitcherProps) {
  return (
    <Suspense fallback={<Switcher {...props} asked={null} />}>
      <SwitcherFromUrl {...props} />
    </Suspense>
  );
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function SwitcherFromUrl(props: SessionSwitcherProps) {
  const search = useSearchParams();
  const text = search.get("session");
  const spec = text ? sessionSpec(text) : null;
  const asked = spec && props.tabs.some((t) => t.slug === spec.slug) ? spec.slug : null;
  return <Switcher {...props} asked={asked} />;
}

function Switcher({ tabs, panels, initial, asked }: SessionSwitcherProps & { asked: string | null }) {
  const [picked, setPicked] = useState<string | null>(null);
  const current = picked ?? asked ?? initial;
  const select = (slug: string) => {
    setPicked(slug);
    const url = `${window.location.pathname}?session=${slug}`;
    window.history.replaceState(null, "", url);
  };
  const columns = { gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` };
  return (
    <>
      <section className="stagger-in mx-auto mt-4 w-full max-w-[1440px] px-4 sm:mt-6 sm:px-6">
        <SectionTitle title="Weekend" icon={IconCalendar} info="Pick a session to open its results below. Times are in your time zone." />
        <div role="tablist" aria-label="Session" onKeyDown={handleRovingKey} className="mt-3 grid rounded-control border border-rule" style={columns}>
          {tabs.map((tab) => (
            <TabButton key={tab.slug} tab={tab} on={tab.slug === current} onSelect={select} />
          ))}
        </div>
      </section>
      <div role="tabpanel" id="session-panel" aria-label={labelOf(tabs, current)} className="min-h-svh">
        {panels[current] ?? null}
      </div>
    </>
  );
}

function TabButton({ tab, on, onSelect }: { tab: SessionTab; on: boolean; onSelect: (slug: string) => void }) {
  const tone = on ? "segment-on" : tab.state === "upcoming" ? "text-ink-3 hover:text-ink-2" : "text-ink-2 hover:text-ink";
  const captionTone = on ? "opacity-75" : "text-ink-3";
  return (
    <button
      type="button"
      role="tab"
      aria-selected={on}
      aria-controls="session-panel"
      tabIndex={on ? 0 : -1}
      data-session={tab.slug}
      onClick={() => onSelect(tab.slug)}
      className={"press segment -my-px flex h-14 min-w-0 flex-col items-center justify-center gap-0.5 rounded-control px-1 text-ui " + tone}
    >
      <span className="inline-flex max-w-full items-center gap-1.5 font-[550]">
        {tab.state === "live" ? <span className="live-dot inline-block size-1.5 shrink-0 rounded-full bg-accent" aria-label="Live" /> : null}
        <span className="truncate sm:hidden">{tab.shortLabel}</span>
        <span className="hidden truncate sm:inline">{tab.label}</span>
      </span>
      <span className={"timing max-w-full truncate text-caption " + captionTone}>{tab.time ? <LocalTime iso={tab.time} options={TAB_TIME} /> : "Result"}</span>
    </button>
  );
}

function labelOf(tabs: SessionTab[], slug: string): string {
  return tabs.find((t) => t.slug === slug)?.label ?? "Session";
}
