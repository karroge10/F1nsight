import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { UpcomingRace } from "@/lib/placeholder";

export function UpcomingRaces({ races }: { races: UpcomingRace[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent & Upcoming Races</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {races.map((r) => (
          <div key={`${r.round}-${r.name}`} className="rounded-md border p-3">
            <div className="flex items-center justify-between">
              <div>
                <div className="font-medium leading-none">{r.name}</div>
                <div className="text-xs text-muted-foreground">{r.location}</div>
              </div>
              <div className="text-xs text-muted-foreground">Round {r.round}</div>
            </div>
            <div className="mt-2 text-xs text-muted-foreground">{new Date(r.date).toUTCString()}</div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}


