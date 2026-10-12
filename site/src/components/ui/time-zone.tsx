"use client";

import { useSyncExternalStore } from "react";

/**
 * The visitor's time zone, read from the browser. The site is prerendered, so the server (and
 * the first render during hydration) does not know it and gets null, meaning "not known yet";
 * right after hydration it is the browser's zone.
 */
export function useTimeZone(): string | null {
  return useSyncExternalStore(subscribe, detectZone, unknownZone);
}

function subscribe() {
  return () => {};
}

function detectZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

function unknownZone(): null {
  return null;
}
