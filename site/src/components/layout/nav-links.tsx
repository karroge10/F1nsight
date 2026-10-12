"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import type { IconComponent } from "@/components/icons";
import { IconBroadcast, IconChequered, IconCoins, IconForecast, IconGarage, IconGauge, IconHelmet, IconHistory, IconListNumbers, IconMap } from "@/components/icons";

const LINKS: { href: string; label: string; icon: IconComponent; match: (p: string) => boolean }[] = [
  { href: "/", label: "Forecast", icon: IconForecast, match: (p) => p === "/" },
  { href: "/fantasy", label: "Fantasy", icon: IconCoins, match: (p) => p.startsWith("/fantasy") },
  { href: "/live", label: "Live", icon: IconBroadcast, match: (p) => p.startsWith("/live") },
  { href: "/telemetry", label: "Telemetry", icon: IconGauge, match: (p) => p.startsWith("/telemetry") },
  { href: "/standings", label: "Standings", icon: IconListNumbers, match: (p) => p.startsWith("/standings") },
  { href: "/races", label: "Races", icon: IconChequered, match: (p) => p.startsWith("/races") },
  { href: "/drivers", label: "Drivers", icon: IconHelmet, match: (p) => p.startsWith("/drivers") },
  { href: "/teams", label: "Teams", icon: IconGarage, match: (p) => p.startsWith("/teams") },
  { href: "/circuits", label: "Circuits", icon: IconMap, match: (p) => p.startsWith("/circuits") },
  { href: "/history", label: "History", icon: IconHistory, match: (p) => p.startsWith("/history") },
];

export function NavLinks() {
  const pathname = usePathname();
  const navRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const active = navRef.current?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!active || !navRef.current) return;
    const nav = navRef.current;
    // Positions from the viewport, so the result does not depend on the offsetParent chain.
    // Scroll only as far as needed to show the active link, so links before it (and the first
    // one next to the logo) are not cut in half.
    const navBox = nav.getBoundingClientRect();
    const activeBox = active.getBoundingClientRect();
    const margin = 16;
    const activeStart = activeBox.left - navBox.left + nav.scrollLeft;
    const activeEnd = activeStart + activeBox.width;
    const visibleEnd = nav.scrollLeft + nav.clientWidth;
    if (activeEnd + margin > visibleEnd) nav.scrollTo({ left: activeEnd + margin - nav.clientWidth, behavior: "instant" });
    else if (activeStart - margin < nav.scrollLeft) nav.scrollTo({ left: Math.max(0, activeStart - margin), behavior: "instant" });
  }, [pathname]);
  return (
    <nav ref={navRef} aria-label="Primary" className="nav-scroll relative -mx-4 flex w-[calc(100%+2rem)] min-w-0 snap-x snap-mandatory scroll-px-4 overflow-x-auto border-t border-rule py-1 [scrollbar-width:none] sm:mx-0 sm:w-auto sm:flex-1 sm:snap-none sm:border-t-0 [&::-webkit-scrollbar]:hidden">
      <ul className="flex items-center gap-0.5 ps-4 pe-8 text-ui sm:px-1">
        {LINKS.map((link) => {
          const active = link.match(pathname ?? "");
          const Icon = link.icon;
          return (
            <li key={link.href} className="shrink-0 snap-start">
              <Link
                href={link.href}
                aria-current={active ? "page" : undefined}
                className={
                  "press inline-flex h-11 items-center sm:h-9 gap-1.5 rounded-control px-2.5 whitespace-nowrap " +
                  (active ? "text-ink shadow-[inset_0_-2px_0_0_var(--accent)]" : "text-ink-2 hover:bg-bg-hover hover:text-ink")
                }
              >
                <Icon size="1rem" className={active ? "text-accent" : "text-ink-3"} />
                {link.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
