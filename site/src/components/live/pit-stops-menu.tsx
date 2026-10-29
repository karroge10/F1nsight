"use client";

import type { LiveDriver } from "@/lib/data/types";
import type { PitStopEvent } from "@/lib/live/reducer";
import { tyreCode } from "@/lib/live/reducer";
import { constructorIdForTeam } from "@/lib/live/team-id";
import { TeamLogo } from "@/components/ui/team-logo";
import { IconPitBox, IconTyre } from "@/components/icons";
import { MapMenu } from "./map-menu";

interface PitStopsMenuProps {
  stops: PitStopEvent[];
  drivers: Map<number, LiveDriver>;
  season: number | null;
  /** Pinned driver: the list narrows to their stops until cleared. */
  driver: LiveDriver | null;
  onClearDriver: () => void;
}

const SHORT_NAME: Record<string, string> = { S: "Soft", M: "Medium", H: "Hard", I: "Inter", W: "Wet" };

/**
 * Pit stops as a button over the map, beside race control. The list is newest first (the state
 * keeps them in that order): lap, driver, old tyre to new tyre and the time in the pit lane. The
 * feed publishes pit lane time only, not the time stationary in the box.
 */
export function PitStopsMenu({ stops, drivers, season, driver, onClearDriver }: PitStopsMenuProps) {
  const shown = driver ? stops.filter((p) => p.number === driver.number) : stops;
  const summary = driver ? (
    <>
      <span className="font-[550] text-ink">{driver.code}</span> only, {shown.length} of {stops.length}
    </>
  ) : (
    `${stops.length} ${stops.length === 1 ? "stop" : "stops"}, times in the pit lane`
  );
  const empty = driver ? `No stops for ${driver.code} yet.` : "No pit stops yet.";
  return (
    <MapMenu
      id="pit-menu"
      label="Pit stops"
      icon={<IconPitBox size="1rem" />}
      count={stops.length}
      title="Pit stops"
      summary={summary}
      onClearDriver={driver ? onClearDriver : null}
    >
      {shown.length === 0 ? (
        <p className="py-2 text-ui text-ink-3">{empty}</p>
      ) : (
        <ol aria-label="Pit stops">
          {shown.map((stop, i) => (
            <PitRow key={`${stop.number}-${stop.t}-${i}`} stop={stop} driver={drivers.get(stop.number)} season={season} />
          ))}
        </ol>
      )}
    </MapMenu>
  );
}

function PitRow({ stop, driver, season }: { stop: PitStopEvent; driver: LiveDriver | undefined; season: number | null }) {
  const color = driver?.teamColor ?? "#8A8F98";
  const constructorId = constructorIdForTeam(driver?.team, season);
  const lapText = stop.lap !== null ? `L${stop.lap}` : "";
  const durationText = stop.duration !== null ? `${stop.duration.toFixed(1)}s` : "";
  return (
    <li className="pit-row" data-pit={stop.number}>
      <span className="timing text-caption text-ink-3">{lapText}</span>
      <span className="inline-flex items-center justify-center">
        {constructorId && driver ? <TeamLogo constructorId={constructorId} name={driver.team} color={color} size={18} season={season} /> : <span className="h-3.5 w-[3px] rounded-chip" style={{ background: color }} aria-hidden="true" />}
      </span>
      <span className="timing font-[550] text-ink">{driver?.code ?? stop.number}</span>
      <TyreChange previous={stop.previous} compound={stop.compound} />
      <span className="timing text-end text-ink" title={durationText ? "Time in the pit lane" : undefined}>
        {durationText}
      </span>
    </li>
  );
}

/** "Soft > Medium" with icons; an unknown compound is said, never drawn as an empty ring. */
function TyreChange({ previous, compound }: { previous: string | null; compound: string | null }) {
  const from = tyreCode(previous);
  const to = tyreCode(compound);
  const fromKnown = from !== "" && from !== "?";
  const toKnown = to !== "" && to !== "?";
  if (!fromKnown && !toKnown) return <span className="text-caption text-ink-3">Tyres unknown</span>;
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5 text-caption text-ink-2">
      {fromKnown ? <TyreName code={from} /> : <span>Unknown</span>}
      <span aria-hidden="true" className="text-ink-3">
        &gt;
      </span>
      {toKnown ? <TyreName code={to} /> : <span>Unknown</span>}
    </span>
  );
}

function TyreName({ code }: { code: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <IconTyre compound={code} />
      {SHORT_NAME[code]}
    </span>
  );
}
