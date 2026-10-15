"use client";

// Click-to-sort table columns, shared by every sortable table. `useSort` keeps the column and
// direction; `sortRows` orders a copy of the rows (missing values always last, ties keep their
// original order); `SortTh` is the header cell: a button with an arrow on the sorted column.
// The first click on a column sorts it in its natural direction (high to low for numbers unless
// the column says otherwise), the next click flips it.

import { useState, type ReactNode } from "react";

export type SortDir = "asc" | "desc";

export interface SortState<K extends string> {
  key: K | null;
  dir: SortDir;
}

export type SortValue = number | string | null | undefined;

export function useSort<K extends string>(initialKey: K | null = null, initialDir: SortDir = "desc") {
  const [sort, setSort] = useState<SortState<K>>({ key: initialKey, dir: initialDir });
  function toggle(key: K, firstDir: SortDir = "desc") {
    setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: firstDir }));
  }
  function reset() {
    setSort({ key: initialKey, dir: initialDir });
  }
  const isDefault = sort.key === initialKey && sort.dir === initialDir;
  return { sort, toggle, reset, isDefault };
}

export function ResetSort({ onReset, isDefault }: { onReset: () => void; isDefault: boolean }) {
  if (isDefault) return null;
  return <button type="button" onClick={onReset} className="press inline-flex min-h-11 items-center rounded-control px-2 text-caption text-ink-2 underline underline-offset-4 hover:text-ink">Reset sort</button>;
}

/** A sorted copy of `rows`; `value` reads the sort value of a row for a column. */
export function sortRows<T, K extends string>(rows: T[], sort: SortState<K>, value: (row: T, key: K) => SortValue): T[] {
  const key = sort.key;
  if (key === null) return rows;
  const sign = sort.dir === "asc" ? 1 : -1;
  const indexed = rows.map((row, index) => ({ row, index, v: value(row, key) }));
  indexed.sort((a, b) => {
    const missingA = a.v === null || a.v === undefined || (typeof a.v === "number" && Number.isNaN(a.v));
    const missingB = b.v === null || b.v === undefined || (typeof b.v === "number" && Number.isNaN(b.v));
    if (missingA || missingB) return missingA === missingB ? a.index - b.index : missingA ? 1 : -1;
    const diff = typeof a.v === "number" && typeof b.v === "number" ? a.v - b.v : String(a.v).localeCompare(String(b.v));
    return diff * sign || a.index - b.index;
  });
  return indexed.map((item) => item.row);
}

interface SortThProps<K extends string> {
  sortKey: K;
  sort: SortState<K>;
  onSort: (key: K, firstDir?: SortDir) => void;
  children: ReactNode;
  /** Direction of the first click; "asc" for columns where low is good (rank, round, cost). */
  firstDir?: SortDir;
  align?: "start" | "end" | "center";
  title?: string;
  className?: string;
}

/** Header cell with a sort button; the arrow shows on the sorted column only. */
export function SortTh<K extends string>({ sortKey, sort, onSort, children, firstDir = "desc", align = "end", title, className = "" }: SortThProps<K>) {
  const active = sort.key === sortKey;
  const ariaSort = active ? (sort.dir === "asc" ? "ascending" : "descending") : "none";
  const justify = align === "start" ? "justify-start" : align === "center" ? "justify-center" : "justify-end";
  const arrow = active ? (sort.dir === "asc" ? "↑" : "↓") : "";
  return (
    <th scope="col" aria-sort={ariaSort} title={title} className={"whitespace-nowrap " + className}>
      <button type="button" onClick={() => onSort(sortKey, firstDir)} className={"flex w-full items-center gap-0.5 hover:text-ink " + justify + " " + (active ? "text-ink" : "")}>
        {children}
        <span aria-hidden="true" className="inline-block w-[0.6em] text-center">
          {arrow}
        </span>
      </button>
    </th>
  );
}
