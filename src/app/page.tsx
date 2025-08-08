import { CountdownCard } from "@/components/dashboard/countdown-card";
import { SeasonOverview } from "@/components/dashboard/season-overview";
import { getNextRace } from "@/lib/openf1";

export default async function Home() {
  const nextRace = await getNextRace();

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      <div className="lg:col-span-2">
        {nextRace ? (
          <CountdownCard
            meetingName={nextRace.meeting.meeting_name}
            circuit={`${nextRace.meeting.location}, ${nextRace.meeting.country_name}`}
            startIso={nextRace.session.date_start}
            roundLabel={nextRace.meeting.meeting_code}
          />
        ) : (
          <div className="rounded-md border p-6 text-sm text-muted-foreground">No upcoming race found.</div>
        )}
      </div>
      <div>
        <SeasonOverview
          stats={[
            { label: "Races Completed", value: "—", sublabel: "of season" },
            { label: "Active Drivers", value: "—" },
            { label: "Teams", value: "—" },
            { label: "Championships", value: "—" },
          ]}
        />
      </div>
    </div>
  );
}
