"use client";

import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Calendar, Clock, MapPin } from "lucide-react";
import { getCountdown } from "@/lib/time";

type Props = {
  meetingName: string;
  circuit: string;
  startIso: string;
  roundLabel?: string;
};

export function CountdownCard({ meetingName, circuit, startIso, roundLabel }: Props) {
  const [now, setNow] = useState<Date>(new Date());
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const i = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(i);
  }, []);

  const c = useMemo(() => getCountdown(startIso, now), [startIso, now]);

  const start = new Date(startIso);
  const dateStr = start.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
  const timeStr = `${start.getUTCHours().toString().padStart(2, "0")}:${start
    .getUTCMinutes()
    .toString()
    .padStart(2, "0")} UTC`;

  return (
    <Card className="relative overflow-hidden bg-gradient-to-r from-red-600 to-red-800 border-red-500 text-white">
      <div className="absolute inset-0 bg-[url('/window.svg')] bg-cover bg-center opacity-20" />
      <div className="relative z-10">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-2xl font-bold">{meetingName}</CardTitle>
              <div className="mt-2 flex items-center gap-2 text-red-100">
                <MapPin className="h-4 w-4" />
                <span>{circuit}</span>
              </div>
            </div>
            {roundLabel ? (
              <Badge variant="secondary" className="bg-white text-red-600">
                {roundLabel}
              </Badge>
            ) : null}
          </div>
        </CardHeader>
        <CardContent>
          <div className="mb-6 grid grid-cols-4 gap-4 text-center">
            <TimeBox label="Days" value={mounted ? c.days : undefined} />
            <TimeBox label="Hours" value={mounted ? c.hours : undefined} />
            <TimeBox label="Minutes" value={mounted ? c.minutes : undefined} />
            <TimeBox label="Seconds" value={mounted ? c.seconds : undefined} />
          </div>
          <div className="flex items-center gap-2 text-red-100">
            <Calendar className="h-4 w-4" />
            <span>{dateStr}</span>
            <Clock className="ml-4 h-4 w-4" />
            <span>{timeStr}</span>
          </div>
        </CardContent>
      </div>
    </Card>
  );
}

function TimeBox({ label, value }: { label: string; value?: number }) {
  return (
    <div className="p-1">
      <div className="text-3xl font-bold tabular-nums">{value ?? "--"}</div>
      <div className="text-sm text-red-100">{label}</div>
    </div>
  );
}


