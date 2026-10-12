"use client";

import Link from "next/link";
import { useState } from "react";
import type { Lineup } from "@/lib/fantasy";
import { formatMoney, formatSigned } from "@/lib/format";
import { TeamLogo } from "@/components/ui/team-logo";
import { Figure } from "@/components/ui/figure";

interface TeamBuilderProps {
  lineups: Lineup[];
  budget: number;
}

export function TeamBuilder({ lineups, budget }: TeamBuilderProps) {
  const [key, setKey] = useState<Lineup["key"]>("points");
  const lineup = lineups.find((l) => l.key === key) ?? lineups[0];
  const left = Math.round((budget - lineup.cost) * 10) / 10;
  const costText = formatMoney(lineup.cost);
  const leftText = `${formatMoney(left)} left`;
  const pointsText = lineup.expectedPoints.toFixed(1);
  const rangeText = `${formatSigned(lineup.p10, 0)} to ${formatSigned(lineup.p90, 0)} (p10 to p90)`;

  return (
    <div className="grid gap-8 lg:grid-cols-12">
      <div className="lg:col-span-4">
        <div role="tablist" aria-label="Optimisation target" className="flex flex-col gap-1">
          {lineups.map((l) => (
            <button
              key={l.key}
              role="tab"
              type="button"
              aria-selected={l.key === key}
              onClick={() => setKey(l.key)}
              className={"press flex flex-col items-start rounded-control border px-3 py-2 text-start " + (l.key === key ? "border-ink" : "border-rule hover:border-rule-strong")}
            >
              <span className="text-ui font-[550] text-ink">{l.title}</span>
              <span className="text-caption text-ink-3">{l.description}</span>
            </button>
          ))}
        </div>
        <div className="mt-6 grid grid-cols-2 gap-4">
          <Figure label="Cost" value={costText} note={leftText} />
          <Figure label="Projected points" value={pointsText} note={rangeText} />
        </div>
      </div>
      <div className="lg:col-span-8">
        <ul className="divide-y divide-rule border-y border-rule">
          {[...lineup.drivers, ...lineup.constructors].map((r) => {
            const href = r.kind === "driver" ? `/drivers/${r.id}` : `/teams/${r.id}`;
            const priceText = formatMoney(r.price);
            const pointsEach = r.expectedPoints.toFixed(1);
            const valueText = r.value.toFixed(2);
            return (
              <li key={r.id} className="grid grid-cols-[auto_1fr_auto_auto] items-center gap-x-4 py-2.5 sm:grid-cols-[auto_1fr_5rem_5rem_5rem]">
                <TeamLogo constructorId={r.constructorId} name={r.team} color={r.teamColor} size={18} />
                <Link href={href} className="min-w-0 truncate text-ui text-ink hover:underline underline-offset-2">
                  {r.name}
                </Link>
                <span className="timing text-table text-ink text-end">{priceText}</span>
                <span className="timing text-table text-ink-2 text-end">{pointsEach} pts</span>
                <span className="timing hidden text-table text-ink-3 text-end sm:inline">{valueText} /M</span>
              </li>
            );
          })}
        </ul>
        <p className="mt-3 text-caption text-ink-3">Exhaustive search over every legal team. The search ignores chips, transfers and the DRS boost. Give the boost to the highest projected driver.</p>
      </div>
    </div>
  );
}
