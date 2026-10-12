"use client";

import { memo, useEffect, useRef, useState } from "react";
import type { LiveDriver, TimingRow } from "@/lib/data/types";
import { sectorFlag, tyreCode } from "@/lib/live/reducer";
import { constructorIdForTeam } from "@/lib/live/team-id";
import { IconFastestLap, IconTyre } from "@/components/icons";
import { TeamLogo } from "@/components/ui/team-logo";

interface TimingTowerProps {
  rows: TimingRow[];
  drivers: Map<number, LiveDriver>;
  season: number | null;
  showDrs: boolean;
  isRace: boolean;
  /** Car pinned by a click, shared with the map. */
  pinned: number | null;
  onSelect: (number: number) => void;
}

type Figure = "int" | "gap" | "last" | "best";

const GAP_OPTIONS: { id: Figure; label: string }[] = [
  { id: "int", label: "Int" },
  { id: "gap", label: "Gap" },
];
const LAP_OPTIONS: { id: Figure; label: string }[] = [
  { id: "last", label: "Last" },
  { id: "best", label: "Best" },
];

const TYRE_NAME: Record<string, string> = { S: "Soft", M: "Medium", H: "Hard", I: "Intermediate", W: "Wet" };

/**
 * Timing tower in the style of the site's data tables: one hairline row per car with position,
 * team logo, three-letter code, one gap figure (interval by default, a header button swaps to the gap to the
 * leader), one lap figure (last by default, swaps to best), three sector bars and the tyre with
 * its age in laps. Qualifying and practice show best, gap and last instead. Rows never change
 * size on hover, so nothing on the page moves; a click pins the driver.
 */
export function TimingTower({ rows, drivers, season, showDrs, isRace, pinned, onSelect }: TimingTowerProps) {
  const [gapFigure, setGapFigure] = useState<Figure>("int");
  const [lapFigure, setLapFigure] = useState<Figure>("last");
  const listRef = useRef<HTMLDivElement>(null);
  const gapToggle = <FigureToggle options={GAP_OPTIONS} active={gapFigure} onChange={setGapFigure} />;
  const lapToggle = <FigureToggle options={LAP_OPTIONS} active={lapFigure} onChange={setLapFigure} />;

  useEffect(() => {
    if (pinned === null || !listRef.current) return;
    const row = listRef.current.querySelector<HTMLElement>(`[data-row="${pinned}"]`);
    if (!row) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    row.scrollIntoView({ block: "nearest", behavior: reduced ? "auto" : "smooth" });
  }, [pinned]);

  return (
    <div className="lt" data-mode={isRace ? "race" : "laps"}>
      <div className="lt-head">
        <span>P</span>
        <span />
        <span>Driver</span>
        {isRace ? (
          <>
            <span>{gapToggle}</span>
            <span className="lt-sm">{lapToggle}</span>
          </>
        ) : (
          <>
            <span>Best</span>
            <span>{gapToggle}</span>
            <span className="lt-sm">Last</span>
          </>
        )}
        <span>Sectors</span>
        <span>Tyre</span>
      </div>
      <div ref={listRef} className="lt-rows">
        {rows.length === 0
          ? Array.from({ length: 20 }, (_, i) => <PlaceholderRow key={i} pos={i + 1} isRace={isRace} />)
          : rows.map((row) => (
              <TowerRow
                key={row.number}
                row={row}
                driver={drivers.get(row.number)}
                season={season}
                gapFigure={gapFigure}
                lapFigure={lapFigure}
                showDrs={showDrs}
                isRace={isRace}
                isPinned={pinned === row.number}
                onSelect={onSelect}
              />
            ))}
      </div>
    </div>
  );
}

interface TowerRowProps {
  row: TimingRow;
  driver: LiveDriver | undefined;
  season: number | null;
  gapFigure: Figure;
  lapFigure: Figure;
  showDrs: boolean;
  isRace: boolean;
  isPinned: boolean;
  onSelect: (number: number) => void;
}

const TowerRow = memo(function TowerRow({ row, driver, season, gapFigure, lapFigure, showDrs, isRace, isPinned, onSelect }: TowerRowProps) {
  const compound = tyreCode(row.tyre);
  const faded = row.retired || row.stopped || row.knockedOut;
  const badge = row.retired ? "OUT" : row.stopped ? "STOP" : row.knockedOut ? "OUT" : row.inPit ? "PIT" : row.pitOut ? "OUT LAP" : null;
  const team = driver?.teamColor ?? "#8A8F98";
  const constructorId = constructorIdForTeam(driver?.team);
  const s1 = sectorFlag(row.s1);
  const s2 = sectorFlag(row.s2);
  const s3 = sectorFlag(row.s3);
  const lastTone = row.lastLap.ob ? "text-sector-purple" : row.lastLap.pb ? "text-sector-green" : "text-ink";
  const bestTone = row.bestLap.ob ? "text-sector-purple" : "text-ink";
  const gapValue = gapFigure === "gap" ? row.gap : row.interval;
  const lapValue = lapFigure === "best" ? row.bestLap.value : row.lastLap.value;
  const lapTone = lapFigure === "best" ? bestTone : lastTone;
  const tyreTitle = tyreTooltip(compound, row.tyreAge, isRace ? row.pits : null);
  return (
    <div
      role="button"
      tabIndex={0}
      aria-pressed={isPinned}
      aria-label={`${driver?.name ?? row.number}, position ${row.pos}`}
      data-row={row.number}
      data-pinned={isPinned || undefined}
      data-faded={faded || undefined}
      className="lt-row"
      style={{ "--team": team } as React.CSSProperties}
      onClick={() => onSelect(row.number)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect(row.number);
        }
      }}
    >
      <span className="lt-pos timing">{row.pos}</span>
      <span className="lt-logo">
        {/* a team without artwork (or an id the site does not know) gets TeamLogo's monogram */}
        {driver?.team ? <TeamLogo constructorId={constructorId ?? ""} name={driver.team} color={team} size={20} season={season} /> : null}
      </span>
      <span className="lt-code timing">
        {driver?.code ?? row.number}
        {row.bestLap.ob ? <IconFastestLap size="0.75rem" className="text-sector-purple" label="Fastest lap" /> : null}
        {showDrs && row.drs ? <span className="lt-drs" title="DRS open" /> : null}
      </span>
      {isRace ? (
        <>
          {badge ? <span className="lt-badge">{badge}</span> : <span className="lt-num timing text-ink">{gapValue ?? ""}</span>}
          <span className={"lt-num lt-sm timing " + lapTone}>{lapValue ?? ""}</span>
        </>
      ) : (
        <>
          <span className={"lt-num timing " + bestTone}>{row.bestLap.value ?? ""}</span>
          {badge ? <span className="lt-badge">{badge}</span> : <span className="lt-num timing text-ink-2">{gapValue ?? ""}</span>}
          <span className={"lt-num lt-sm timing " + lastTone}>{row.lastLap.value ?? ""}</span>
        </>
      )}
      <span className="lt-sectors" aria-label={`sectors ${s1 ?? "none"} ${s2 ?? "none"} ${s3 ?? "none"}`}>
        <span className="sector" data-flag={s1 ?? undefined} />
        <span className="sector" data-flag={s2 ?? undefined} />
        <span className="sector" data-flag={s3 ?? undefined} />
      </span>
      <span className="lt-tyre" title={tyreTitle}>
        {compound ? <IconTyre compound={compound === "?" ? "" : compound} label={tyreTitle} /> : <span className="inline-block size-[1.125rem]" />}
        <span className="timing">{row.tyreAge ?? ""}</span>
      </span>
    </div>
  );
});

/** One small button in the header: shows the current figure, a click swaps to the other one. */
function FigureToggle({ options, active, onChange }: { options: { id: Figure; label: string }[]; active: Figure; onChange: (f: Figure) => void }) {
  const current = options.find((o) => o.id === active) ?? options[0];
  const next = options.find((o) => o.id !== active) ?? options[0];
  const nextLabel = next.label.toLowerCase();
  return (
    <span className="inline-flex justify-end">
      <button type="button" onClick={() => onChange(next.id)} className="lt-toggle" aria-label={current.label + " shown, switch to " + nextLabel} title={"Switch to " + nextLabel}>
        {current.label}
        <svg width="8" height="8" viewBox="0 0 8 8" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true">
          <path d="M1 3h6M5 1l2 2-2 2M7 5H1M3 7L1 5l2-2" />
        </svg>
      </button>
    </span>
  );
}

function tyreTooltip(compound: string, age: number | null, pits: number | null): string {
  const name = compound === "?" ? "Unknown tyre" : compound ? `${TYRE_NAME[compound] ?? compound} tyre` : "No tyre data";
  const parts = [name];
  if (age !== null) parts.push(`${age} ${age === 1 ? "lap" : "laps"} on this tyre`);
  if (pits !== null) parts.push(`${pits} ${pits === 1 ? "pit stop" : "pit stops"}`);
  return parts.join(", ");
}

function PlaceholderRow({ pos, isRace }: { pos: number; isRace: boolean }) {
  return (
    <div className="lt-row" aria-hidden="true" style={{ "--team": "var(--rule-strong)" } as React.CSSProperties}>
      <span className="lt-pos timing">{pos}</span>
      <span className="lt-logo" />
      <span className="lt-placeholder w-8" />
      <span className="lt-placeholder w-10 justify-self-end" />
      {isRace ? null : <span className="lt-placeholder w-10 justify-self-end" />}
      <span className="lt-placeholder lt-sm w-12 justify-self-end" />
      <span />
      <span className="lt-placeholder lt-placeholder-dot" />
    </div>
  );
}
