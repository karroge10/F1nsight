import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type Stat = {
  label: string;
  value: string | number;
  sublabel?: string;
};

export function SeasonOverview({ stats }: { stats: Stat[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Season Overview</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {stats.map((s) => (
          <div key={s.label} className="flex items-center justify-between rounded-md bg-muted p-3">
            <div className="text-sm">{s.label}</div>
            <div className="text-right">
              <div className="text-lg font-semibold">{s.value}</div>
              {s.sublabel ? <div className="text-xs text-muted-foreground">{s.sublabel}</div> : null}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}


