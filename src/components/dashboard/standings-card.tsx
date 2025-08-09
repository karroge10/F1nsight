import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Minus, Trophy } from "lucide-react";

type Row = { pos: number; driver: string; team: string; points: number };

export function StandingsCard({ rows }: { rows: Row[] }) {
  const teamColorClass = (team: string) => {
    if (/red bull/i.test(team)) return "bg-blue-600";
    if (/mercedes/i.test(team)) return "bg-cyan-400";
    if (/ferrari/i.test(team)) return "bg-red-600";
    if (/aston/i.test(team)) return "bg-green-600";
    return "bg-gray-500";
  };
  const nationality = (driver: string) => {
    const map: Record<string, string> = {
      "Max Verstappen": "NED",
      "Sergio Perez": "MEX",
      "Lewis Hamilton": "GBR",
      "Fernando Alonso": "ESP",
      "Carlos Sainz": "ESP",
    };
    return map[driver] ?? "N/A";
  };

  return (
    <Card className="bg-gray-800 border-gray-700">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-white">
            <Trophy className="h-5 w-5 text-yellow-500" /> Driver Standings 2024
          </CardTitle>
          <Button variant="outline" size="sm">View All</Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {rows.map((r) => (
            <div key={r.pos} className="flex items-center gap-3 rounded-lg bg-gray-700/50 p-3 transition-colors hover:bg-gray-700">
              <div className="w-6 text-lg font-bold text-white">{r.pos}</div>
              <div className={`w-px h-8 rounded ${teamColorClass(r.team)}`} />
              <div className="flex-1">
                <div className="font-semibold text-white">{r.driver}</div>
                <div className="text-sm text-gray-400">{r.team}</div>
              </div>
              <Badge variant="secondary" className="bg-gray-600 text-white">{nationality(r.driver)}</Badge>
              <div className="text-right">
                <div className="font-bold text-white">{r.points}</div>
                <div className="text-sm text-gray-400">pts</div>
              </div>
              <Minus className="h-4 w-4 text-gray-500" />
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}


