type Point = [number, number];

const cache = new WeakMap<Point[], ReturnType<typeof buildSampler>>();

function buildSampler(outline: Point[]) {
  const distances = [0];
  for (let i = 0; i < outline.length; i++) {
    const a = outline[i], b = outline[(i + 1) % outline.length];
    distances.push(distances[i] + Math.hypot(b[0] - a[0], b[1] - a[1]));
  }
  const length = distances.at(-1) ?? 0;
  return {
    length,
    sample(fraction: number, lateral = 0) {
      if (!length || !outline.length) return { point: [0, 0] as Point, tangent: [1, 0] as Point };
      const distance = ((fraction % 1) + 1) % 1 * length;
      let low = 0, high = outline.length;
      while (low + 1 < high) { const middle = (low + high) >> 1; if (distances[middle] <= distance) low = middle; else high = middle; }
      const a = outline[low], b = outline[(low + 1) % outline.length];
      const segment = distances[low + 1] - distances[low];
      const alpha = segment ? (distance - distances[low]) / segment : 0;
      const tangent: Point = segment ? [(b[0] - a[0]) / segment, (b[1] - a[1]) / segment] : [1, 0];
      return { point: [a[0] + (b[0] - a[0]) * alpha - tangent[1] * lateral, a[1] + (b[1] - a[1]) * alpha + tangent[0] * lateral] as Point, tangent };
    },
  };
}

export function trackSampler(outline: Point[]) {
  let sampler = cache.get(outline);
  if (!sampler) { sampler = buildSampler(outline); cache.set(outline, sampler); }
  return sampler;
}

export function gridPlacement(position: number, trackLength: number, time: number) {
  const rank = Math.max(1, position);
  return { offset: (6 + (rank - 1) * 8) * 10 / Math.max(1, trackLength), lateral: (rank % 2 ? -25 : 25) * (time < 0 ? 1 : Math.exp(-time / 3500)) };
}
