"use client";

import { IconMoon, IconSun } from "@/components/icons";

export function ThemeToggle() {
  function toggle() {
    const root = document.documentElement;
    const next = root.dataset.theme === "light" ? "dark" : "light";
    root.dataset.theme = next;
    try {
      localStorage.setItem("f1nsight-theme", next);
    } catch {
      // storage unavailable, the choice lasts for this page only
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label="Toggle light and dark theme"
      title="Toggle light and dark theme"
      className="theme-toggle press inline-flex size-11 items-center sm:size-9 justify-center rounded-control text-ink-2 hover:bg-bg-hover hover:text-ink"
    >
      <IconSun size="1.125rem" className="theme-icon-sun" />
      <IconMoon size="1.125rem" className="theme-icon-moon" />
    </button>
  );
}
