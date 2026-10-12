import type { KeyboardEvent } from "react";

/** Index that the arrow, Home or End key moves a radio group or tab list to, or null for other keys. */
export function rovingIndex(key: string, index: number, count: number): number | null {
  switch (key) {
    case "ArrowRight":
    case "ArrowDown":
      return (index + 1) % count;
    case "ArrowLeft":
    case "ArrowUp":
      return (index - 1 + count) % count;
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return null;
  }
}

/** Arrow keys inside a radio group or tab list: focus and select the neighbouring button (its click handler sets the value). */
export function handleRovingKey(event: KeyboardEvent<HTMLElement>) {
  const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>(":scope > button")];
  const current = items.indexOf(event.target as HTMLButtonElement);
  const next = rovingIndex(event.key, current, items.length);
  if (current === -1 || next === null) return;
  event.preventDefault();
  items[next].focus();
  items[next].click();
}
