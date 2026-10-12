"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Flag } from "@/components/ui/flag";
import { TeamLogo } from "@/components/ui/team-logo";

export interface IndexRow {
  id: string;
  name: string;
  sub: string;
  color: string;
  /** The team whose logo leads the row: the team itself, or a driver's last team. */
  team: { constructorId: string; name: string; season: number | null };
  /** Country code tried for the flag when `sub` (the nationality) does not resolve. */
  countryCode: string | null;
  span: string;
  numbers: number[];
}

interface EntityIndexProps {
  rows: IndexRow[];
  columns: string[];
  hrefBase: string;
  label: string;
  defaultSort?: number;
}

/** Filterable, sortable all-time index for drivers or teams. Hundreds of rows, plain table. */
export function EntityIndex({ rows, columns, hrefBase, label, defaultSort = 0 }: EntityIndexProps) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<{ col: number; dir: 1 | -1 }>({ col: defaultSort, dir: -1 });

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q ? rows.filter((r) => r.name.toLowerCase().includes(q) || r.sub.toLowerCase().includes(q)) : rows;
    const sorted = [...filtered].sort((a, b) => {
      if (sort.col === -1) return a.name.localeCompare(b.name) * -sort.dir;
      const diff = (a.numbers[sort.col] ?? 0) - (b.numbers[sort.col] ?? 0);
      return diff * sort.dir || a.name.localeCompare(b.name);
    });
    return sorted.slice(0, 400);
  }, [rows, query, sort]);

  function toggle(col: number) {
    setSort((s) => (s.col === col ? { col, dir: s.dir === 1 ? -1 : 1 } : { col, dir: col === -1 ? 1 : -1 }));
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-ui text-ink-2">
          <span className="sr-only">Filter {label}</span>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`Filter ${label}`}
            className="h-11 w-48 sm:h-9 rounded-control border border-rule bg-bg px-2 text-base text-ink placeholder:text-ink-3 sm:text-ui"
          />
        </label>
        <p className="text-caption text-ink-3">
          {visible.length < rows.length ? `${visible.length} of ${rows.length}` : rows.length} {label}. Click a column to sort.
        </p>
      </div>
      <div className="scroll-x mt-4">
        <table className="data-table min-w-[640px]">
          <thead>
            <tr>
              <th>
                <button type="button" onClick={() => toggle(-1)} className="hover:text-ink">
                  Name {sort.col === -1 ? (sort.dir === 1 ? "↑" : "↓") : ""}
                </button>
              </th>
              <th className="hidden md:table-cell">Seasons</th>
              {columns.map((c, i) => (
                <th key={c} className="num">
                  <button type="button" onClick={() => toggle(i)} className={"hover:text-ink " + (sort.col === i ? "text-ink" : "")}>
                    {c} {sort.col === i ? (sort.dir === 1 ? "↑" : "↓") : ""}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => (
              <tr key={r.id}>
                <td>
                  <Link href={`${hrefBase}/${r.id}`} className="flex items-center gap-2 text-ink hover:underline underline-offset-2">
                    <TeamLogo constructorId={r.team.constructorId} name={r.team.name} color={r.color} size={18} season={r.team.season} />
                    <span className="font-[550]">{r.name}</span>
                    <span className="hidden items-center gap-1.5 text-caption text-ink-3 sm:inline-flex">
                      <Flag of={r.sub} fallback={r.countryCode} keepSpace={false} />
                      {r.sub}
                    </span>
                  </Link>
                </td>
                <td className="timing hidden text-ink-3 md:table-cell">{r.span}</td>
                {r.numbers.map((n, i) => (
                  <td key={i} className={"num " + (n ? "text-ink" : "text-ink-3")}>
                    {Number.isInteger(n) ? n : n.toFixed(1)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
