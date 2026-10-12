// Projects a track outline (feed units, rotation in degrees) into SVG space.

import type { LiveTrack } from "@/lib/data/types";

export interface Projected {
  path: string;
  viewBox: string;
  scale: number;
  project: (x: number, y: number) => [number, number];
  sectorMarks: { number: number; x: number; y: number }[];
  corners: { number: number; x: number; y: number }[];
  finish: [number, number];
}

export function projectTrack(track: LiveTrack): Projected {
  const rad = (track.rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const xs = track.outline.map((p) => p[0]);
  const ys = track.outline.map((p) => p[1]);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  const rotate = (x: number, y: number): [number, number] => {
    const dx = x - cx;
    const dy = y - cy;
    return [dx * cos - dy * sin, -(dx * sin + dy * cos)];
  };
  const rotated = track.outline.map((p) => rotate(p[0], p[1]));
  const rx = rotated.map((p) => p[0]);
  const ry = rotated.map((p) => p[1]);
  const minX = Math.min(...rx);
  const maxX = Math.max(...rx);
  const minY = Math.min(...ry);
  const maxY = Math.max(...ry);
  const width = maxX - minX;
  const height = maxY - minY;
  const scale = Math.max(width, height) / 720;
  const pad = 40 * scale;
  const viewBox = `${(minX - pad).toFixed(0)} ${(minY - pad).toFixed(0)} ${(width + pad * 2).toFixed(0)} ${(height + pad * 2).toFixed(0)}`;
  const path = rotated.map((p, i) => `${i === 0 ? "M" : "L"}${p[0].toFixed(0)} ${p[1].toFixed(0)}`).join(" ") + " Z";
  const sectorMarks = (track.sectors ?? [])
    .map((s) => {
      const point = rotated[Math.min(rotated.length - 1, Math.max(0, s.start))];
      return point ? { number: s.number, x: point[0], y: point[1] } : null;
    })
    .filter((s): s is { number: number; x: number; y: number } => s !== null);
  const corners = (track.corners ?? []).map((c) => {
    const [x, y] = rotate(c.x, c.y);
    const offset = 22 * scale;
    const angle = ((c.angle ?? 0) * Math.PI) / 180 - rad;
    return { number: c.number, x: x + Math.cos(angle) * offset, y: y - Math.sin(angle) * offset };
  });
  const finishSource = track.finish ?? track.outline[0];
  const finish = rotate(finishSource[0], finishSource[1]);
  return { path, viewBox, scale, project: rotate, sectorMarks, corners, finish };
}
