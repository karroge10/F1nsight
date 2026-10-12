interface PositionDistProps {
  dist: number[];
  code: string;
  cell?: number;
}

/** 22 cell heat strip, one hue, light to dark. Each cell carries its value in a title. */
export function PositionDist({ dist, code, cell = 8 }: PositionDistProps) {
  const total = dist.length;
  const width = total * (cell + 1) - 1;
  return (
    <svg width={width} height={cell + 2} viewBox={`0 0 ${width} ${cell + 2}`} role="img" aria-label={`${code} finishing position distribution`} className="inline-block">
      {dist.map((p, i) => {
        const level = probLevel(p);
        const x = i * (cell + 1);
        const percent = Math.round(p * 100);
        return (
          <rect key={i} x={x} y={1} width={cell} height={cell} rx={1} className="prob-cell" data-level={level}>
            <title>{`P${i + 1}: ${percent}%`}</title>
          </rect>
        );
      })}
    </svg>
  );
}

export function probLevel(p: number): number {
  if (p >= 0.3) return 5;
  if (p >= 0.15) return 4;
  if (p >= 0.08) return 3;
  if (p >= 0.04) return 2;
  if (p >= 0.01) return 1;
  return 0;
}
