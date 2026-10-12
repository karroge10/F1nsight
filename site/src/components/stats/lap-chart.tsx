import type { Lookups, RaceLaps, ResultRow } from "@/lib/data";
import { LineChart, type LineSeries } from "@/components/charts/line-chart";

interface LapChartProps {
  laps: RaceLaps;
  results: ResultRow[];
  lookups: Lookups;
}

/** Position of every car at the end of every lap. Top finishers emphasised. */
export function LapChart({ laps, results, lookups }: LapChartProps) {
  const totalLaps = Math.max(...Object.values(laps.laps).map((arr) => arr.length), 1);
  const xLabels = Array.from({ length: totalLaps }, (_, i) => String(i + 1));
  const order = results.map((r) => r.driverId);
  const series: LineSeries[] = order
    .filter((id) => laps.laps[id])
    .map((id, i) => {
      const row = results.find((r) => r.driverId === id);
      const byLap = new Map(laps.laps[id].map((l) => [l[0], l[1]]));
      const values: (number | null)[] = [];
      for (let lap = 1; lap <= totalLaps; lap++) values.push(byLap.get(lap) ?? null);
      return {
        id,
        label: lookups.driverCode(id),
        color: lookups.teamColor(row?.constructorId ?? ""),
        values,
        emphasis: i < 5,
      };
    });
  const ticks = Array.from({ length: Math.ceil(series.length / 2) }, (_, i) => i * 2 + 1).filter((t) => t <= series.length);
  return (
    <div className="stagger-in">
      <LineChart series={series} xLabels={xLabels} yLabel="position" title="Race position by lap" invertY yTicks={ticks} height={420} maxLabels={5} />
    </div>
  );
}
