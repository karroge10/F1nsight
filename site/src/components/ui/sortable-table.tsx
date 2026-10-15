"use client";

// A sortable table for server components: the server renders every row as a finished <tr> and
// passes the values to sort by next to it, so data loading and row markup stay on the server and
// only the header clicks and the reordering run in the browser. The first row order is the
// order the rows arrive in, until a header is clicked (or `initialKey` names the column that
// order already follows, so its arrow shows).

import { Fragment, type ReactNode } from "react";
import { SortTh, sortRows, useSort, type SortDir, type SortState, type SortValue } from "./sortable";

export interface SortColumn {
  /** Column to sort by; a column without a key is a plain header. */
  key?: string;
  label: ReactNode;
  /** Direction of the first click: "asc" for text and for columns where low is good. */
  firstDir?: SortDir;
  /** Defaults to "end" for `num` columns and "start" otherwise. */
  align?: "start" | "end" | "center";
  className?: string;
  title?: string;
  ariaLabel?: string;
}

export interface SortableRow {
  key: string;
  values: Record<string, SortValue>;
  /** The finished <tr>. */
  row: ReactNode;
}

interface SortableTableProps {
  columns: SortColumn[];
  rows: SortableRow[];
  className?: string;
  /** Column the incoming order already follows, with its direction. */
  initialKey?: string | null;
  initialDir?: SortDir;
}

export function SortableTable({ columns, rows, className, initialKey = null, initialDir = "asc" }: SortableTableProps) {
  const { sort, toggle } = useSort<string>(initialKey, initialDir);
  const sorted = sortRows(rows, sort, rowValue);
  return (
    <table className={className}>
      <thead>
        <tr>
          {columns.map((col, i) => (
            <HeaderCell key={col.key ?? "col-" + i} col={col} sort={sort} onSort={toggle} />
          ))}
        </tr>
      </thead>
      <tbody>
        {sorted.map((r) => (
          <Fragment key={r.key}>{r.row}</Fragment>
        ))}
      </tbody>
    </table>
  );
}

function HeaderCell({ col, sort, onSort }: { col: SortColumn; sort: SortState<string>; onSort: (key: string, firstDir?: SortDir) => void }) {
  const className = col.className ?? "";
  if (!col.key) {
    return (
      <th className={col.className} title={col.title} aria-label={col.ariaLabel}>
        {col.label}
      </th>
    );
  }
  const align = col.align ?? (className.split(" ").includes("num") ? "end" : "start");
  return (
    <SortTh sortKey={col.key} sort={sort} onSort={onSort} firstDir={col.firstDir} align={align} title={col.title} className={className}>
      {col.label}
    </SortTh>
  );
}

function rowValue(row: SortableRow, key: string): SortValue {
  return row.values[key];
}
