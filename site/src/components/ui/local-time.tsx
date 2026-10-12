"use client";

import { useTimeZone } from "./time-zone";

/** Used when no `options` are passed; passed options replace these rather than merge. */
const DEFAULT_OPTIONS: Intl.DateTimeFormatOptions = { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" };

interface LocalTimeProps {
  iso: string;
  options?: Intl.DateTimeFormatOptions;
}

/**
 * Renders a time in the visitor's time zone, always, with no zone label. Pages are prerendered,
 * so the zone is not known in the HTML: it carries the UTC text invisibly as a same-width
 * placeholder and the real local time appears right after hydration without moving the layout.
 */
export function LocalTime({ iso, options }: LocalTimeProps) {
  const zone = useTimeZone();
  const date = new Date(iso);
  const formatOptions = options ?? DEFAULT_OPTIONS;
  const formatter = new Intl.DateTimeFormat("en-GB", { ...formatOptions, timeZone: zone ?? "UTC" });
  const text = formatter.format(date);
  const pending = zone === null;
  return (
    <time dateTime={iso} className={pending ? "invisible" : undefined} aria-busy={pending || undefined} suppressHydrationWarning>
      {text}
    </time>
  );
}
