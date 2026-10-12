export interface LineSeries {
  id: string;
  label: string;
  color: string;
  values: (number | null)[];
  emphasis?: boolean;
}

interface LineChartProps {
  series: LineSeries[];
  xLabels: string[];
  yLabel?: string;
  height?: number;
  maxLabels?: number;
  invertY?: boolean;
  yTicks?: number[];
  title: string;
}

const PAD = { top: 12, right: 96, bottom: 28, left: 40 };
const WIDTH = 960;
const COMPACT_WIDTH = 480;

/** Multi-series SVG line chart, hairline grid, end labels, legend and table twin. */
export function LineChart(props: LineChartProps) {
  const allValues = props.series.flatMap((s) => s.values).filter((v): v is number => v !== null);
  if (allValues.length === 0) return <p className="text-ui text-ink-3">No data yet.</p>;
  return (
    <figure className="min-w-0">
      <div className="hidden md:block">
        <ChartSvg {...props} width={WIDTH} />
      </div>
      <div className="md:hidden">
        <ChartSvg {...props} width={COMPACT_WIDTH} height={Math.round((props.height ?? 360) * 0.8)} maxLabels={Math.min(props.maxLabels ?? 6, 4)} />
      </div>
      <Legend series={props.series} />
      <TableTwin series={props.series} xLabels={props.xLabels} />
    </figure>
  );
}

function ChartSvg({ series, xLabels, yLabel, height = 360, maxLabels = 6, invertY = false, yTicks, title, width }: LineChartProps & { width: number }) {
  const WIDTH = width;
  const allValues = series.flatMap((s) => s.values).filter((v): v is number => v !== null);
  const n = xLabels.length;
  const maxValue = Math.max(...allValues, 0);
  const minValue = invertY ? 1 : 0;
  const ticks = yTicks ?? niceTicks(minValue, maxValue, 5);
  const yMin = invertY ? Math.min(...ticks) : 0;
  const yMax = Math.max(...ticks, maxValue);
  const plotW = WIDTH - PAD.left - PAD.right;
  const plotH = height - PAD.top - PAD.bottom;
  const toX = (i: number) => PAD.left + (n === 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const toY = (v: number) => {
    const ratio = (v - yMin) / (yMax - yMin || 1);
    return invertY ? PAD.top + ratio * plotH : PAD.top + (1 - ratio) * plotH;
  };
  const labelStep = Math.max(1, Math.ceil(n / (WIDTH < 600 ? 6 : 12)));
  const ordered = [...series].sort((a, b) => Number(Boolean(a.emphasis)) - Number(Boolean(b.emphasis)));
  const endLabels = placeEndLabels(series, toY, maxLabels, invertY);

  return (
      <svg viewBox={`0 0 ${WIDTH} ${height}`} className="h-auto w-full" role="img" aria-label={title}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={WIDTH - PAD.right} y1={toY(t)} y2={toY(t)} stroke="var(--rule)" strokeWidth={1} />
            <text x={PAD.left - 8} y={toY(t)} dy="0.35em" textAnchor="end" className="fill-[var(--ink-3)]" fontSize={11} fontFamily="var(--font-sans)">
              {t}
            </text>
          </g>
        ))}
        {xLabels.map((label, i) =>
          i % labelStep === 0 || i === n - 1 ? (
            <text key={i} x={toX(i)} y={height - 8} textAnchor="middle" className="fill-[var(--ink-3)]" fontSize={11} fontFamily="var(--font-sans)">
              {label}
            </text>
          ) : null,
        )}
        {ordered.map((s, i) => {
          const d = pathFor(s.values, toX, toY);
          const emphasised = s.emphasis !== false;
          return (
            <path
              key={s.id}
              d={d}
              pathLength={1}
              className="draw-in"
              style={{ animationDelay: `${i * 90}ms` }}
              fill="none"
              stroke={s.color}
              strokeWidth={emphasised ? 2 : 1.5}
              strokeOpacity={emphasised ? 1 : 0.6}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          );
        })}
        {endLabels.map((l) => (
          <g key={l.id}>
            <circle cx={toX(l.index)} cy={l.y} r={3.5} fill={l.color} stroke="var(--bg)" strokeWidth={2} />
            <text x={WIDTH - PAD.right + 10} y={l.labelY} dy="0.35em" fontSize={11} fontFamily="var(--font-sans)" fontWeight={550} className="fill-[var(--ink)]">
              {l.label}
            </text>
          </g>
        ))}
        {yLabel ? (
          <text x={PAD.left} y={PAD.top - 2} fontSize={10} className="fill-[var(--ink-3)]" fontFamily="var(--font-sans)" letterSpacing="0.06em">
            {yLabel.toUpperCase()}
          </text>
        ) : null}
      </svg>
  );
}

function Legend({ series }: { series: LineSeries[] }) {
  return (
      <figcaption className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-caption text-ink-2">
        {series.map((s) => (
          <span key={s.id} className="inline-flex items-center gap-1.5">
            <span className="inline-block h-0.5 w-3 rounded-chip" style={{ background: s.color }} aria-hidden="true" />
            {s.label}
          </span>
        ))}
      </figcaption>
  );
}

function TableTwin({ series, xLabels }: { series: LineSeries[]; xLabels: string[] }) {
  return (
      <details className="mt-2 text-caption text-ink-3">
        <summary className="cursor-pointer select-none hover:text-ink-2">Table view</summary>
        <div className="scroll-x mt-2">
          <table className="data-table">
            <thead>
              <tr>
                <th>Series</th>
                {xLabels.map((l, i) => (
                  <th key={i} className="num">
                    {l}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {series.map((s) => (
                <tr key={s.id}>
                  <td>{s.label}</td>
                  {s.values.map((v, i) => (
                    <td key={i} className="num">
                      {v === null ? "" : v}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
  );
}

function pathFor(values: (number | null)[], toX: (i: number) => number, toY: (v: number) => number): string {
  let d = "";
  let pen = false;
  values.forEach((v, i) => {
    if (v === null) {
      pen = false;
      return;
    }
    const x = toX(i).toFixed(1);
    const y = toY(v).toFixed(1);
    d += `${pen ? "L" : "M"}${x} ${y} `;
    pen = true;
  });
  return d.trim();
}

function placeEndLabels(series: LineSeries[], toY: (v: number) => number, maxLabels: number, invertY: boolean) {
  const ends = series
    .map((s) => {
      let index = -1;
      for (let i = s.values.length - 1; i >= 0; i--) {
        if (s.values[i] !== null) {
          index = i;
          break;
        }
      }
      if (index === -1) return null;
      const value = s.values[index] as number;
      return { id: s.id, label: s.label, color: s.color, index, value, y: toY(value), labelY: toY(value), emphasis: s.emphasis };
    })
    .filter((e): e is NonNullable<typeof e> => e !== null)
    .sort((a, b) => (invertY ? a.value - b.value : b.value - a.value));
  const chosen = ends.filter((e) => e.emphasis !== false).slice(0, maxLabels);
  chosen.sort((a, b) => a.y - b.y);
  const minGap = 14;
  for (let i = 1; i < chosen.length; i++) {
    if (chosen[i].labelY - chosen[i - 1].labelY < minGap) {
      chosen[i].labelY = chosen[i - 1].labelY + minGap;
    }
  }
  return chosen;
}

export function niceTicks(min: number, max: number, count: number): number[] {
  if (max <= min) return [min, min + 1];
  const rawStep = (max - min) / count;
  const magnitude = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const residual = rawStep / magnitude;
  let step = magnitude;
  if (residual > 5) step = magnitude * 10;
  else if (residual > 2) step = magnitude * 5;
  else if (residual > 1) step = magnitude * 2;
  const ticks: number[] = [];
  for (let v = Math.floor(min / step) * step; v <= max + step * 0.5; v += step) {
    ticks.push(Math.round(v * 1000) / 1000);
  }
  return ticks;
}
