import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getCircuit, getCircuits, getLookups, getTrackOutline } from "@/lib/data";
import { formatLapTime } from "@/lib/format";
import { EntityHeader } from "@/components/stats/entity-header";
import { Section } from "@/components/ui/section";
import { Flag } from "@/components/ui/flag";
import { TeamLogo } from "@/components/ui/team-logo";
import { TeamName } from "@/components/ui/team-name";
import { CircuitOutline } from "@/components/stats/circuit-outline";
import { IconHistory, IconMap, IconTrophy } from "@/components/icons";
import { SortableTable, type SortColumn } from "@/components/ui/sortable-table";

type Params = Promise<{ id: string }>;

export const dynamicParams = false;

export async function generateStaticParams(): Promise<{ id: string }[]> {
  const circuits = await getCircuits();
  return circuits.map((c) => ({ id: c.circuitId }));
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { id } = await params;
  const circuit = await getCircuit(id);
  return { title: circuit ? circuit.name : "Circuit" };
}

export default async function CircuitPage({ params }: { params: Params }) {
  const { id } = await params;
  const circuit = await getCircuit(id);
  if (!circuit) notFound();
  const lookups = await getLookups();
  const track = await getTrackOutline(id);
  const winCounts = new Map<string, number>();
  for (const race of circuit.races) {
    if (race.winnerDriverId) winCounts.set(race.winnerDriverId, (winCounts.get(race.winnerDriverId) ?? 0) + 1);
  }
  const mostWins = [...winCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  const span = circuit.firstSeason === circuit.lastSeason ? String(circuit.firstSeason) : `${circuit.firstSeason} to ${circuit.lastSeason}`;

  return (
    <>
      <EntityHeader
        label={
          <>
            <Link href="/circuits" className="hover:text-ink">
              Circuits
            </Link>
            <span className="mx-1.5 text-ink-3">/</span>
            <Flag of={circuit.country} fallback={circuit.countryCode} keepSpace={false} className="mr-1.5" />
            {circuit.country}
          </>
        }
        title={circuit.name}
        meta={
          <>
            <Flag of={circuit.country} fallback={circuit.countryCode} keepSpace={false} className="mr-1.5" />
            {circuit.locality}, {circuit.country}. {span}.{circuit.altitude !== null ? ` ${circuit.altitude} m above sea level.` : ""}
          </>
        }
        figures={[
          { label: "Races held", value: circuit.raceCount },
          { label: "First", value: circuit.firstSeason },
          { label: "Latest", value: circuit.lastSeason },
          { label: "Lap record", value: circuit.lapRecord ? formatLapTime(circuit.lapRecord.timeMs) : "–", note: circuit.lapRecord ? `${lookups.driverName(circuit.lapRecord.driverId)}, ${circuit.lapRecord.season}` : "No lap data" },
          { label: "Most wins", value: mostWins[0] ? mostWins[0][1] : "–", note: mostWins[0] ? lookups.driverName(mostWins[0][0]) : "" },
        ]}
      />

      <div className="mx-auto grid max-w-[1440px] grid-cols-1 gap-x-10 lg:grid-cols-12">
        <div className="lg:col-span-5">
          {track ? (
            <Section title="Layout" icon={IconMap} info={track.source}>
              <CircuitOutline track={track} />
            </Section>
          ) : (
            <Section title="Layout" icon={IconMap}>
              <p className="text-ui text-ink-3">No outline on file yet.</p>
            </Section>
          )}
          {mostWins.length ? (
            <Section title="Most wins" icon={IconTrophy} flush>
              <ul className="divide-y divide-rule text-ui">
                {mostWins.map(([driverId, count]) => (
                  <li key={driverId} className="flex items-center justify-between py-2">
                    <Link href={`/drivers/${driverId}`} className="text-ink hover:underline underline-offset-2">
                      {lookups.driverName(driverId)}
                    </Link>
                    <span className="timing text-ink-2">{count}</span>
                  </li>
                ))}
              </ul>
            </Section>
          ) : null}
        </div>
        <div className="lg:col-span-7">
          <Section title={`${circuit.races.length} Grands Prix`} icon={IconHistory} flush>
            <div className="scroll-x">
              <SortableTable
                className="data-table min-w-[480px]"
                columns={RACE_COLUMNS}
                initialKey="season"
                initialDir="desc"
                rows={[...circuit.races].sort((a, b) => b.season - a.season || b.round - a.round).map((r) => ({
                  key: `${r.season}-${r.round}`,
                  values: {
                    season: r.season,
                    winner: r.winnerDriverId ? lookups.driverName(r.winnerDriverId) : null,
                    team: r.winnerConstructorId ? lookups.teamName(r.winnerConstructorId) : null,
                    pole: r.poleDriverId ? lookups.driverName(r.poleDriverId) : null,
                  },
                  row: (
                    <tr>
                      <td className="timing text-ink-2">{r.season}</td>
                      <td>
                        <Link href={`/races/${r.season}/${r.round}`} className="text-ink hover:underline underline-offset-2">
                          {r.raceName}
                        </Link>
                      </td>
                      <td>
                        {r.winnerDriverId ? (
                          <Link href={`/drivers/${r.winnerDriverId}`} className="flex items-center gap-2 text-ink hover:underline underline-offset-2">
                            {/* below md the team column is hidden, so the logo moves in front of the name */}
                            <TeamLogo constructorId={r.winnerConstructorId ?? ""} name={lookups.teamName(r.winnerConstructorId ?? "")} color={lookups.teamColor(r.winnerConstructorId ?? "")} size={18} season={r.season} className="md:hidden" />
                            {lookups.driverName(r.winnerDriverId)}
                          </Link>
                        ) : (
                          ""
                        )}
                      </td>
                      <td className="hidden text-ink-2 md:table-cell">
                        {r.winnerConstructorId ? <TeamName constructorId={r.winnerConstructorId} name={lookups.teamName(r.winnerConstructorId)} color={lookups.teamColor(r.winnerConstructorId)} season={r.season} /> : null}
                      </td>
                      <td className="hidden text-ink-2 lg:table-cell">{r.poleDriverId ? lookups.driverName(r.poleDriverId) : ""}</td>
                    </tr>
                  ),
                }))}
              />
            </div>
          </Section>
        </div>
      </div>
    </>
  );
}

const RACE_COLUMNS: SortColumn[] = [
  { key: "season", label: "Season" },
  { label: "Race" },
  { key: "winner", label: "Winner", firstDir: "asc" },
  { key: "team", label: "Team", firstDir: "asc", className: "hidden md:table-cell" },
  { key: "pole", label: "Pole", firstDir: "asc", className: "hidden lg:table-cell" },
];
