"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

interface MapMenuProps {
  id: string;
  label: string;
  icon: ReactNode;
  /** Items in the log; the badge counts the ones added since the menu was last open. */
  count: number;
  /** Accessible name of the open panel. */
  title: string;
  /** Header line of the open panel, left side. */
  summary: ReactNode;
  /** Shown on the right of the header while a driver filter is on; clears it. */
  onClearDriver: (() => void) | null;
  children: ReactNode;
}

/**
 * A button over the track map that opens a log in a popover below it (race control, pit
 * stops). The panel anchors to the nearest positioned ancestor, the toolbar, so every menu
 * opens at the same place. Closes on Esc, on a click outside, or with the button.
 */
export function MapMenu({ id, label, icon, count, title, summary, onClearDriver, children }: MapMenuProps) {
  const [open, setOpen] = useState(false);
  const [seen, setSeen] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const unread = open ? 0 : Math.max(0, count - seen);

  const toggle = useCallback(
    (next: boolean) => {
      setSeen(count);
      setOpen(next);
    },
    [count],
  );

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopImmediatePropagation();
      toggle(false);
    };
    const onPointer = (e: PointerEvent) => {
      const root = rootRef.current;
      if (root && e.target instanceof Node && !root.contains(e.target)) toggle(false);
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("pointerdown", onPointer);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("pointerdown", onPointer);
    };
  }, [open, toggle]);

  return (
    <div ref={rootRef}>
      <button type="button" className="rc-button press" aria-expanded={open} aria-haspopup="dialog" aria-controls={id} onClick={() => toggle(!open)}>
        {icon}
        {label}
        <CountBadge unread={unread} count={count} />
      </button>
      {open ? (
        <div id={id} role="dialog" aria-label={title} className="rc-menu">
          <div className="map-menu-head">
            <span>{summary}</span>
            {onClearDriver ? (
              <button type="button" onClick={onClearDriver} className="map-menu-clear press">
                All drivers
              </button>
            ) : null}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-1">{children}</div>
        </div>
      ) : null}
    </div>
  );
}

function CountBadge({ unread, count }: { unread: number; count: number }) {
  if (unread > 0) {
    return (
      <span className="rc-badge" aria-label={`${unread} new`}>
        {unread}
      </span>
    );
  }
  if (count === 0) return null;
  return <span className="timing text-ink-3">{count}</span>;
}
