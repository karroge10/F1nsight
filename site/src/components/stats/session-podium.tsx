import Link from "next/link";
import { DriverPortrait } from "@/components/ui/driver-portrait";
import { TeamName } from "@/components/ui/team-name";
import type { DriverTeam } from "./driver-tag";

export interface PodiumEntry {
  position: number;
  driverId: string;
  name: string;
  team: DriverTeam;
  /** Race time or lap time for P1, the gap for P2 and P3. */
  value: string;
}

interface SessionPodiumProps {
  entries: PodiumEntry[];
  season: number;
  label: string;
}

// P2 on the left, P1 in the middle, P3 on the right. Everything above the steps has the same
// fixed height in every column, so the steps alone set the difference and all three stand on
// one baseline. Fixed sizes also keep the podium the same height in every session.
const SLOTS = [
  { position: 2, portrait: 80, step: "h-16 sm:h-20" },
  { position: 1, portrait: 80, step: "h-24 sm:h-28" },
  { position: 3, portrait: 80, step: "h-10 sm:h-12" },
];

/** The top three of a session on a three-step podium: photo, full name, team logo and time or gap. */
export function SessionPodium({ entries, season, label }: SessionPodiumProps) {
  return (
    <ol aria-label={label} className="mx-auto grid max-w-2xl grid-cols-3 items-end gap-x-2 border-b border-rule sm:gap-x-3">
      {SLOTS.map((slot) => {
        const entry = entries.find((e) => e.position === slot.position) ?? null;
        return <Step key={slot.position} slot={slot} entry={entry} season={season} />;
      })}
    </ol>
  );
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function Step({ slot, entry, season }: { slot: (typeof SLOTS)[number]; entry: PodiumEntry | null; season: number }) {
  const order = slot.position === 1 ? "order-2" : slot.position === 2 ? "order-1" : "order-3";
  const valueTone = slot.position === 1 ? "text-ink" : "text-ink-2";
  const accent = entry ? { borderTopColor: entry.team.color } : undefined;
  return (
    <li className={"flex min-w-0 flex-col items-center text-center " + order} data-podium-position={slot.position}>
      {entry ? (
        <>
          <DriverPortrait driverId={entry.driverId} name={entry.name} teamColor={entry.team.color} size={slot.portrait} />
          <Link href={`/drivers/${entry.driverId}`} className="mt-2 line-clamp-2 h-[2lh] max-w-full text-ui leading-tight font-[550] text-ink hover:underline underline-offset-2 sm:line-clamp-1 sm:h-[1lh] sm:text-body">
            {entry.name}
          </Link>
          <span className="mt-1 flex h-6 max-w-full items-center justify-center text-caption text-ink-3">
            <TeamName constructorId={entry.team.constructorId} name={entry.team.name} color={entry.team.color} season={season} size={20} className="max-w-full gap-1.5 sm:gap-2" />
          </span>
          <span className={"timing mt-0.5 h-5 text-ui " + valueTone}>{entry.value}</span>
        </>
      ) : null}
      <span
        className={"mt-3 flex w-full items-start justify-center rounded-t-control border border-b-0 border-t-[3px] border-rule bg-bg-raised pt-2 " + slot.step}
        style={accent}
      >
        <span className="headline text-h2 text-ink-2" aria-label={`Position ${slot.position}`}>
          {slot.position}
        </span>
      </span>
    </li>
  );
}
