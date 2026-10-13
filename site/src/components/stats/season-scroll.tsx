"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";

interface SeasonScrollProps {
  seasons: { season: number; href: string }[];
  current: number;
  className?: string;
}

/** Every season in one row that scrolls sideways (phones), opened with the current season in view. */
export function SeasonScroll({ seasons, current, className = "" }: SeasonScrollProps) {
  const navRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const nav = navRef.current;
    const active = nav?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!nav || !active) return;
    // viewport positions, so the result does not depend on the offsetParent chain
    const navBox = nav.getBoundingClientRect();
    const activeBox = active.getBoundingClientRect();
    const activeCentre = activeBox.left - navBox.left + nav.scrollLeft + activeBox.width / 2;
    const left = Math.max(0, activeCentre - nav.clientWidth / 2);
    nav.scrollTo({ left, behavior: "instant" });
  }, [current]);
  return (
    <nav ref={navRef} aria-label="Season" className={"flex gap-1 overflow-x-auto text-ui [scrollbar-width:none] [&::-webkit-scrollbar]:hidden " + className}>
      {seasons.map(({ season, href }) => (
        <Link
          key={season}
          href={href}
          aria-current={season === current ? "page" : undefined}
          className={"press timing inline-flex h-11 min-w-11 shrink-0 items-center justify-center rounded-control px-2.5 " + (season === current ? "selected-pill" : "text-ink-2 hover:bg-bg-hover hover:text-ink")}
        >
          {season}
        </Link>
      ))}
    </nav>
  );
}
