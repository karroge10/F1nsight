import type { Metadata } from "next";
import Link from "next/link";
import { getCircuits, getCurrentSeason, getCalendar, getLookups } from "@/lib/data";
import { formatLapTime } from "@/lib/format";
import { Flag } from "@/components/ui/flag";
import { PageIntro } from "@/components/ui/page-intro";
import { Section } from "@/components/ui/section";
import { IconCalendar, IconMap } from "@/components/icons";

export const metadata: Metadata = {
  title: "Circuits",
};

export default async function CircuitsPage() {
  const circuits = await getCircuits();
  const season = await getCurrentSeason();
  const calendar = await getCalendar(season);
  const lookups = await getLookups();
  const currentIds = new Set(calendar.map((r) => r.circuitId));
  const current = circuits.filter((c) => currentIds.has(c.circuitId)).sort((a, b) => (calendar.find((r) => r.circuitId === a.circuitId)?.round ?? 0) - (calendar.find((r) => r.circuitId === b.circuitId)?.round ?? 0));
  const past = circuits.filter((c) => !currentIds.has(c.circuitId)).sort((a, b) => b.raceCount - a.raceCount);

  return (
    <>
      <PageIntro label="Circuits" title={`${circuits.length} circuits since 1950`} dek={`${current.length} on the ${season} calendar.`} />
      <Section title={`${season} calendar`} icon={IconCalendar} flush>
        <CircuitTable circuits={current} lookups={lookups} calendarRound={(id) => calendar.find((r) => r.circuitId === id)?.round ?? null} />
      </Section>
      <Section title="Former circuits" icon={IconMap} info="Lap records are the fastest race laps in the data, not qualifying laps." flush>
        <CircuitTable circuits={past} lookups={lookups} calendarRound={() => null} />
      </Section>
    </>
  );
}

function CircuitTable({ circuits, lookups, calendarRound }: { circuits: Awaited<ReturnType<typeof getCircuits>>; lookups: Awaited<ReturnType<typeof getLookups>>; calendarRound: (id: string) => number | null }) {
  return (
    <div className="scroll-x">
      <table className="data-table min-w-[640px]">
        <thead>
          <tr>
            <th className="num w-10">Rd</th>
            <th>Circuit</th>
            <th className="hidden md:table-cell">Location</th>
            <th className="num">Races</th>
            <th className="hidden sm:table-cell">Seasons</th>
            <th className="num hidden lg:table-cell">Lap record</th>
            <th className="hidden lg:table-cell">Set by</th>
          </tr>
        </thead>
        <tbody>
          {circuits.map((c) => {
            const round = calendarRound(c.circuitId);
            return (
              <tr key={c.circuitId}>
                <td className="num text-ink-2">{round ?? ""}</td>
                <td>
                  <Link href={`/circuits/${c.circuitId}`} className="font-[550] text-ink hover:underline underline-offset-2">
                    {c.name}
                  </Link>
                </td>
                <td className="hidden text-ink-2 md:table-cell">
                  <Flag of={c.country} fallback={c.countryCode} keepSpace={false} className="mr-1.5" />
                  {c.locality}, {c.country}
                </td>
                <td className="num text-ink">{c.raceCount}</td>
                <td className="timing hidden text-ink-3 sm:table-cell">{c.firstSeason === c.lastSeason ? c.firstSeason : `${c.firstSeason} to ${c.lastSeason}`}</td>
                <td className="num hidden text-ink lg:table-cell">{c.lapRecord ? formatLapTime(c.lapRecord.timeMs) : ""}</td>
                <td className="hidden text-ink-2 lg:table-cell">{c.lapRecord ? `${lookups.driverName(c.lapRecord.driverId)}, ${c.lapRecord.season}` : ""}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
