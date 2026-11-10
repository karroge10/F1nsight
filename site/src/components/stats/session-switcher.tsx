"use client";

import { Suspense, useState, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { sessionSpec } from "@/lib/sessions";
import { handleRovingKey } from "@/lib/roving-keys";
import { LocalTime } from "@/components/ui/local-time";

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
  /** Left side of the top bar (breadcrumb, pager); the session tabs sit on its right. */
  bar?: ReactNode;
  /** Page content between the top bar and the open session's panel. */
  children?: ReactNode;
}

const TAB_TIME: Intl.DateTimeFormatOptions = { weekday: "short", hour: "2-digit", minute: "2-digit" };

/**
 * The weekend's sessions as a compact segmented control at the right of the page's top bar,
 * and the open session's panel below the page content. Every panel is prerendered; switching
 * only swaps which one shows and rewrites `?session=` in place. The HTML opens the default
 * session and `?session=fp1` is applied in the browser. The panel box is at least a screen tall,
 * so a short session never pulls the page up.
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

function Switcher({ tabs, panels, initial, asked, bar, children }: SessionSwitcherProps & { asked: string | null }) {
  const [picked, setPicked] = useState<string | null>(null);
  const current = picked ?? asked ?? initial;
  const select = (slug: string) => {
    setPicked(slug);
    const url = `${window.location.pathname}?session=${slug}`;
    window.history.replaceState(null, "", url);
  };
  return (
    <>
      <div className="stagger-in mx-auto flex w-full max-w-[1440px] flex-wrap items-center justify-between gap-x-4 gap-y-3 px-4 pt-6 sm:px-6 sm:pt-8">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">{bar}</div>
        <div className="-mx-4 w-[calc(100%+2rem)] overflow-x-auto px-4 sm:mx-0 sm:w-auto sm:overflow-visible sm:px-0">
          <div role="tablist" aria-label="Session" onKeyDown={handleRovingKey} className="inline-flex h-8 rounded-control border border-rule">
            {tabs.map((tab) => (
              <TabButton key={tab.slug} tab={tab} on={tab.slug === current} onSelect={select} />
            ))}
          </div>
        </div>
      </div>
      {children}
      <div role="tabpanel" id="session-panel" aria-label={labelOf(tabs, current)} className="min-h-svh">
        {panels[current] ?? null}
      </div>
    </>
  );
}

function TabButton({ tab, on, onSelect }: { tab: SessionTab; on: boolean; onSelect: (slug: string) => void }) {
  const tone = on ? "segment-on" : tab.state === "upcoming" ? "text-ink-3 hover:text-ink-2" : "text-ink-2 hover:text-ink";
  return (
    <button
      type="button"
      role="tab"
      aria-selected={on}
      aria-controls="session-panel"
      tabIndex={on ? 0 : -1}
      data-session={tab.slug}
      onClick={() => onSelect(tab.slug)}
      className={"press segment -my-px inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-control px-3 text-caption font-[550] " + tone}
    >
      {tab.state === "live" ? <span className="live-dot inline-block size-1.5 shrink-0 rounded-full bg-accent" aria-label="Live" /> : null}
      <span className="lg:hidden">{tab.shortLabel}</span>
      <span className="hidden lg:inline">{tab.label}</span>
      {tab.time ? (
        <span className="sr-only">
          , <LocalTime iso={tab.time} options={TAB_TIME} />
        </span>
      ) : null}
    </button>
  );
}

function labelOf(tabs: SessionTab[], slug: string): string {
  return tabs.find((t) => t.slug === slug)?.label ?? "Session";
}
