"use client";

import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getCountdown } from "@/lib/time";

type Props = {
  meetingName: string;
  circuit: string;
  startIso: string;
  roundLabel?: string;
};

export function CountdownCard({ meetingName, circuit, startIso, roundLabel }: Props) {
  const [now, setNow] = useState<Date>(new Date());

  useEffect(() => {
    const i = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(i);
  }, []);

  const c = useMemo(() => getCountdown(startIso, now), [startIso, now]);

  return (
    <Card className="overflow-hidden">
      <CardHeader>
        <div className="flex items-center gap-2">
          <CardTitle className="text-xl">{meetingName}</CardTitle>
          {roundLabel ? <Badge variant="secondary">{roundLabel}</Badge> : null}
        </div>
        <CardDescription>{circuit}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-4 gap-4 text-center">
          <TimeBox label="Days" value={c.days} />
          <TimeBox label="Hours" value={c.hours} />
          <TimeBox label="Minutes" value={c.minutes} />
          <TimeBox label="Seconds" value={c.seconds} />
        </div>
        <p className="mt-4 text-center text-xs text-muted-foreground">Starts at {new Date(startIso).toUTCString()}</p>
      </CardContent>
    </Card>
  );
}

function TimeBox({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md bg-muted p-4">
      <div className="text-3xl font-bold tabular-nums">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}


