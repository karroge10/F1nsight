import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getDriversByYear } from "@/lib/openf1";

export default async function TeamsPage() {
  const year = new Date().getUTCFullYear();
  const drivers = await getDriversByYear(year);
  const teams = Array.from(
    drivers.reduce((map, d) => {
      const list = map.get(d.team_name) ?? [];
      list.push(d);
      map.set(d.team_name, list);
      return map;
    }, new Map<string, typeof drivers>())
  );

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Teams {year}</h1>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {teams.map(([teamName, list]) => (
          <Card key={teamName}>
            <CardHeader>
              <CardTitle className="text-lg">{teamName}</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              <ul className="list-disc pl-5">
                {list.map((d) => (
                  <li key={`${teamName}-${d.driver_number}`}>{d.full_name}</li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}


