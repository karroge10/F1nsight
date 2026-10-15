"use client";

// Recent races in the track record: predicted against actual winner and podium, sortable by race
// and by the order correlation.

import Link from "next/link";
import {
  SortTh,
  sortRows,
  useSort,
  type SortValue,
} from "@/components/ui/sortable";

export interface TrackRecordRow {
  key: string;
  season: number;
  round: number;
  raceName: string;
  predictedCode: string;
  predictedWinText: string;
  actualCode: string;
  hit: boolean;
  predictedPodium: { driverId: string; code: string; inActual: boolean }[];
  actualPodium: { driverId: string; code: string }[];
  correlation: number | null;
}

type RecordSort = "race" | "corr";

export function TrackRecordTable({ rows }: { rows: TrackRecordRow[] }) {
  const { sort, toggle } = useSort<RecordSort>("race", "desc");
  const sorted = sortRows(rows, sort, recordValue);
  return (
    <table className="data-table sm:min-w-[520px]">
      <thead>
        <tr>
          <SortTh sortKey="race" sort={sort} onSort={toggle} align="start">
            Race
          </SortTh>
          <th>
            <span className="sm:hidden">Pred.</span>
            <span className="hidden sm:inline">Predicted winner</span>
          </th>
          <th>
            <span className="sm:hidden">Actual</span>
            <span className="hidden sm:inline">Actual winner</span>
          </th>
          <th className="hidden sm:table-cell">Predicted podium</th>
          <th className="hidden sm:table-cell">Actual podium</th>
          <SortTh sortKey="corr" sort={sort} onSort={toggle} className="num">
            Corr.
          </SortTh>
        </tr>
      </thead>
      <tbody>
        {sorted.map((r) => (
          <tr key={r.key}>
            <td>
              <Link
                href={`/races/${r.season}/${r.round}`}
                className="tap-hit text-ink hover:underline underline-offset-2"
              >
                <span className="timing mr-2 text-caption text-ink-3">
                  {r.season} R{r.round}
                </span>
                {r.raceName}
              </Link>
            </td>
            <td>
              <span className={"timing " + (r.hit ? "text-ink" : "text-ink-2")}>
                {r.predictedCode}
              </span>
              <span className="timing ml-2 text-caption text-ink-3">
                {r.predictedWinText}
              </span>
            </td>
            <td className="timing text-ink">
              {r.actualCode}
              <span
                className={
                  "ml-2 inline-block size-1.5 rounded-full align-middle " +
                  (r.hit ? "bg-delta-up" : "bg-rule-strong")
                }
                aria-label={r.hit ? "hit" : "miss"}
              />
            </td>
            <td className="timing hidden text-ink-2 sm:table-cell">
              {r.predictedPodium.map((d) => (
                <span
                  key={d.driverId}
                  className={"mr-2 " + (d.inActual ? "text-ink" : "text-ink-3")}
                >
                  {d.code}
                </span>
              ))}
            </td>
            <td className="timing hidden text-ink sm:table-cell">
              {r.actualPodium.map((a) => (
                <span key={a.driverId} className="mr-2">
                  {a.code}
                </span>
              ))}
            </td>
            <td className="num text-ink-2">
              {r.correlation === null ? "" : r.correlation.toFixed(2)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function recordValue(row: TrackRecordRow, key: RecordSort): SortValue {
  if (key === "corr") return row.correlation;
  return row.season * 100 + row.round;
}
