import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getDriversByYear } from "@/lib/openf1";

export default async function DriversPage() {
  const year = new Date().getUTCFullYear();
  const drivers = await getDriversByYear(year);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">F1 Drivers {year}</h1>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {drivers.map((d) => (
          <Card key={`${d.session_key}-${d.driver_number}`} className="overflow-hidden">
            <CardHeader>
              <CardTitle className="text-lg">{d.full_name}</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              <div className="flex items-center justify-between">
                <span>Team</span>
                <span className="font-medium text-foreground">{d.team_name}</span>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}


