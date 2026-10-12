/**
 * Typical miss of one race projection made at team lock, per asset (mean absolute error,
 * ml/reports/backtest_summary.json, 2024 to 2026). Not the 2.6 / 4.0 pts error of reconstructing
 * actual scores from free data. Shown as a footnote under the projected numbers.
 */
export const PROJECTION_MISS = { driver: 10, constructor: 16.5 };

export function ProjectionNote() {
  return (
    <span className="text-caption text-ink-3">
      Typical miss ±{PROJECTION_MISS.driver} pts per driver, ±{PROJECTION_MISS.constructor} per constructor
    </span>
  );
}
