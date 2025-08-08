import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getRaceSessions, getMeetings } from "@/lib/openf1";

export default async function RacesPage() {
  const year = new Date().getUTCFullYear();
  const [sessions, meetings] = await Promise.all([
    getRaceSessions(year),
    getMeetings(year),
  ]);

  const rows = sessions
    .map((s) => ({
      session: s,
      meeting: meetings.find((m) => m.meeting_key === s.meeting_key),
    }))
    .filter((r) => r.meeting);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Season Calendar {year}</h1>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {rows.map(({ session, meeting }) => (
          <Card key={session.session_key}>
            <CardHeader>
              <CardTitle className="text-lg">{meeting!.meeting_name}</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              <div className="flex items-center justify-between">
                <span>Location</span>
                <span className="font-medium text-foreground">
                  {meeting!.location}, {meeting!.country_name}
                </span>
              </div>
              <div className="mt-2 flex items-center justify-between">
                <span>Date</span>
                <span className="font-medium text-foreground">
                  {new Date(session.date_start).toUTCString()}
                </span>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}


