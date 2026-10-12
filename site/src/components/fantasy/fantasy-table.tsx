"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { FantasyAssetRow } from "@/lib/fantasy";
import type { PriceThreshold } from "@/lib/fantasy/thresholds";
import { formatMoney, formatMoneySigned, formatSigned } from "@/lib/format";
import { handleRovingKey } from "@/lib/roving-keys";
import { Delta } from "@/components/ui/delta";
import { Sparkline } from "@/components/ui/sparkline";
import { TeamLogo } from "@/components/ui/team-logo";
import { RangeBar } from "./range-bar";

type SortKey = "name" | "price" | "priceDelta" | "expectedPoints" | "expectedPriceChange" | "value" | "seasonPoints" | "selectedPct";

interface FantasyTableProps {
  rows: FantasyAssetRow[];
  teams: { id: string; name: string }[];
  /** Points needed this gameday for each price move, by asset id (missing when the round data is not exported). */
  thresholds?: Record<string, PriceThreshold>;
}

const COLUMNS: { key: SortKey; label: string; numeric: boolean; hide?: string }[] = [
  { key: "name", label: "Asset", numeric: false },
  { key: "price", label: "Price", numeric: true },
  { key: "priceDelta", label: "Last move", numeric: true, hide: "hidden md:table-cell" },
  { key: "expectedPoints", label: "Proj. pts", numeric: true },
  { key: "expectedPriceChange", label: "Proj. price", numeric: true, hide: "hidden sm:table-cell" },
  { key: "value", label: "Pts / M", numeric: true, hide: "hidden sm:table-cell" },
  { key: "seasonPoints", label: "Season", numeric: true, hide: "hidden lg:table-cell" },
  { key: "selectedPct", label: "Owned", numeric: true, hide: "hidden lg:table-cell" },
];

export function FantasyTable({ rows, teams, thresholds = {} }: FantasyTableProps) {
  const [kind, setKind] = useState<"driver" | "constructor">("driver");
  const [team, setTeam] = useState<string>("all");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({ key: "expectedPoints", dir: "desc" });

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = rows.filter((r) => r.kind === kind && (team === "all" || r.constructorId === team) && (q === "" || r.name.toLowerCase().includes(q) || r.code.toLowerCase().includes(q)));
    const dir = sort.dir === "asc" ? 1 : -1;
    filtered.sort((a, b) => {
      if (sort.key === "name") return a.name.localeCompare(b.name) * dir;
      return (a[sort.key] - b[sort.key]) * dir;
    });
    return filtered;
  }, [rows, kind, team, query, sort]);

  const range = useMemo(() => {
    const scoped = rows.filter((r) => r.kind === kind);
    const min = Math.min(0, ...scoped.map((r) => r.p10));
    const max = Math.max(...scoped.map((r) => r.p90), 1);
    return { min, max };
  }, [rows, kind]);

  function toggleSort(key: SortKey, numeric: boolean) {
    setSort((current) => {
      if (current.key === key) return { key, dir: current.dir === "asc" ? "desc" : "asc" };
      return { key, dir: numeric ? "desc" : "asc" };
    });
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        <div role="tablist" aria-label="Asset type" onKeyDown={handleRovingKey} className="inline-flex rounded-control border border-rule">
          {(["driver", "constructor"] as const).map((k) => (
            <button
              key={k}
              role="tab"
              type="button"
              tabIndex={kind === k ? 0 : -1}
              aria-selected={kind === k}
              onClick={() => setKind(k)}
              className={"press segment -my-px h-11 sm:h-9 rounded-control px-3.5 text-ui " + (kind === k ? "segment-on" : "text-ink-2 hover:text-ink")}
            >
              {k === "driver" ? "Drivers" : "Constructors"}
            </button>
          ))}
        </div>
        <label className="flex min-w-0 items-center gap-2 text-ui text-ink-2">
          <span className="sr-only">Team</span>
          <select value={team} onChange={(e) => setTeam(e.target.value)} className="h-11 max-w-full rounded-control border border-rule bg-bg px-3 text-base text-ink sm:h-9 sm:text-ui">
            <option value="all">All teams</option>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-ui text-ink-2">
          <span className="sr-only">Search</span>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search"
            className="h-11 w-36 rounded-control border border-rule bg-bg px-3 text-base text-ink placeholder:text-ink-3 sm:h-9 sm:text-ui"
          />
        </label>
        <p className="text-caption text-ink-3 sm:ml-auto">{visible.length} assets</p>
      </div>

      <div className="scroll-x mt-4">
        <table className="data-table sm:min-w-[720px]">
          <thead>
            <tr>
              {COLUMNS.map((col) => {
                const active = sort.key === col.key;
                const arrow = active ? (sort.dir === "asc" ? "↑" : "↓") : "";
                const header = (
                  <th key={col.key} className={(col.numeric ? "num " : "") + (col.hide ?? "")} aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}>
                    <button type="button" onClick={() => toggleSort(col.key, col.numeric)} className={"inline-flex min-h-11 min-w-11 items-center gap-1 hover:text-ink sm:min-h-0 sm:min-w-0 " + (active ? "text-ink" : "")}>
                      {col.label}
                      <span className="w-2 text-ink-3" aria-hidden="true">
                        {arrow}
                      </span>
                    </button>
                  </th>
                );
                if (col.key !== "expectedPoints") return header;
                return [
                  header,
                  <th key="rise" className="num" title="Points needed this gameday for the price to rise. Below it, the price falls. The second line gives the scores for a big rise and a big fall.">
                    Pts to rise
                  </th>,
                ];
              })}
              <th className="hidden xl:table-cell">Projected range</th>
              <th className="hidden md:table-cell">Price trend</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => {
              const href = r.kind === "driver" ? `/drivers/${r.id}` : `/teams/${r.id}`;
              const priceText = formatMoney(r.price);
              const expectedText = r.expectedPoints.toFixed(1);
              const valueText = r.value.toFixed(2);
              const seasonText = String(r.seasonPoints);
              const ownedText = `${r.selectedPct}%`;
              const rangeText = `${formatSigned(r.p10, 0)} to ${formatSigned(r.p90, 0)}`;
              return (
                <tr key={r.id} className={r.active ? "" : "opacity-60"}>
                  <td>
                    <Link href={href} className="flex min-h-11 items-center gap-2 text-ink hover:underline underline-offset-2 sm:min-h-0" aria-label={r.name}>
                      <TeamLogo constructorId={r.constructorId} name={r.team} color={r.teamColor} size={18} />
                      {/* phones show only the code, wider screens only the full name */}
                      <span className="timing font-[550] sm:hidden">{r.code}</span>
                      <span className="hidden font-[550] sm:inline">{r.name}</span>
                      {r.kind === "driver" ? <span className="hidden text-caption text-ink-3 sm:inline">{r.team}</span> : null}
                      {!r.active ? <span className="text-caption text-ink-3">inactive</span> : null}
                    </Link>
                  </td>
                  <td className="num text-ink">{priceText}</td>
                  <td className="num hidden md:table-cell">
                    <Delta value={r.priceDelta} money />
                  </td>
                  <td className="num text-ink">{expectedText}</td>
                  <td className="num">
                    <ThresholdCell threshold={thresholds[r.id]} expected={r.expectedPoints} />
                  </td>
                  <td className="num hidden sm:table-cell">
                    <Delta value={r.expectedPriceChange} digits={2} money />
                  </td>
                  <td className="num hidden text-ink-2 sm:table-cell">{valueText}</td>
                  <td className="num hidden text-ink-2 lg:table-cell">{seasonText}</td>
                  <td className="num hidden text-ink-2 lg:table-cell">{ownedText}</td>
                  <td className="hidden xl:table-cell">
                    <span className="inline-flex items-center gap-2">
                      <RangeBar p10={r.p10} expected={r.expectedPoints} p90={r.p90} min={range.min} max={range.max} color={r.teamColor} />
                      <span className="timing text-caption text-ink-3">{rangeText}</span>
                    </span>
                  </td>
                  <td className="hidden md:table-cell">
                    <Sparkline values={r.priceHistory} color={r.teamColor} title={`${r.name} price by round, ${formatMoney(r.priceHistory[0] ?? r.price)} to ${formatMoney(r.price)}`} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ThresholdCell({ threshold, expected }: { threshold: PriceThreshold | undefined; expected: number }) {
  if (!threshold) return <span className="text-ink-3">n/a</span>;
  const onTrack = expected >= threshold.rise;
  const riseText = minusSign(threshold.rise);
  const detail = `Big rise (${formatMoneySigned(threshold.steps.bigRise)}) at ${minusSign(threshold.bigRise)} · big fall (${formatMoneySigned(threshold.steps.bigFall)}) below ${minusSign(threshold.avoidBigFall)}`;
  return (
    <span className={"cursor-help underline decoration-dotted underline-offset-4 " + (onTrack ? "text-delta-up" : "text-delta-down")} title={detail}>
      {riseText}
    </span>
  );
}

function minusSign(n: number): string {
  return n < 0 ? `−${-n}` : String(n);
}
