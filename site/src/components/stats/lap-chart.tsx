import type { Lookups, RaceLaps, ResultRow } from "@/lib/data";
import { LineChart, type LineSeries } from "@/components/charts/line-chart";

interface LapChartProps {
  laps: RaceLaps;
  results: ResultRow[];
  lookups: Lookups;
}

/**
 * Position of every car on the grid (lap 0) and at the end of every lap. Top finishers are
 * emphasised; clicking a driver highlights their line.
 */
export function LapChart({ laps, results, lookups }: LapChartProps) {
  const lapCounts = Object.values(laps.laps).map((arr) => arr.length);
  const totalLaps = Math.max(...lapCounts, 1);
  const xLabels = Array.from({ length: totalLaps + 1 }, (_, i) => (i === 0 ? "Grid" : String(i)));
  const starters = results.filter((r) => laps.laps[r.driverId]);
  const gridOf = startingGrid(starters);
  const series: LineSeries[] = starters.map((row, i) => {
    const byLap = new Map(laps.laps[row.driverId].map((l) => [l[0], l[1]]));
    const values: (number | null)[] = [gridOf.get(row.driverId) ?? null];
    for (let lap = 1; lap <= totalLaps; lap++) values.push(byLap.get(lap) ?? null);
    return {
      id: row.driverId,
      label: lookups.driverCode(row.driverId),
      color: lookups.teamColor(row.constructorId),
      values,
      emphasis: i < 5,
    };
  });
  const ticks = Array.from({ length: Math.ceil(series.length / 2) }, (_, i) => i * 2 + 1).filter((t) => t <= series.length);
  return (
    <div className="stagger-in">
      <LineChart series={series} xLabels={xLabels} yLabel="position" title="Race position by lap" invertY yTicks={ticks} height={420} maxLabels={5} selectable />
    </div>
  );
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/**
 * Starting slot of every car that took the start: the official grid, with pit lane starters
 * (grid 0) behind the last grid slot in grid order of the results.
 */
function startingGrid(starters: ResultRow[]): Map<string, number> {
  const slots = starters.map((r) => r.grid ?? 0).filter((g) => g > 0);
  const lastSlot = Math.max(...slots, 0);
  const grid = new Map<string, number>();
  let pitLane = 0;
  for (const row of starters) {
    if (row.grid !== null && row.grid > 0) {
      grid.set(row.driverId, row.grid);
      continue;
    }
    pitLane += 1;
    grid.set(row.driverId, lastSlot + pitLane);
  }
  return grid;
}
