import Link from "next/link";
import type { ConstructorForecast } from "@/lib/data";
import { TeamLogo } from "@/components/ui/team-logo";
import { Meter } from "@/components/ui/prob-bar";

interface ConstructorForecastListProps {
  constructors: ConstructorForecast[];
}

/** Expected constructor points for the race as thin bars from one baseline. */
export function ConstructorForecastList({ constructors }: ConstructorForecastListProps) {
  const max = Math.max(...constructors.map((c) => c.expectedPoints), 1);
  return (
    <ul className="grid gap-x-10 gap-y-1 md:grid-cols-2">
      {constructors.map((c, i) => {
        const ratio = c.expectedPoints / max;
        const pointsText = c.expectedPoints.toFixed(1);
        return (
          <li key={c.constructorId} className="stagger-in grid grid-cols-[minmax(0,10rem)_1fr_3rem] items-center gap-3 py-1.5" style={{ "--stagger": i } as React.CSSProperties}>
            <Link href={`/teams/${c.constructorId}`} className="tap-hit flex min-w-0 items-center gap-2 text-ui text-ink hover:underline underline-offset-2">
              <TeamLogo constructorId={c.constructorId} name={c.name} color={c.teamColor} size={24} />
              <span className="truncate">{c.name}</span>
            </Link>
            <Meter ratio={ratio} color={c.teamColor} />
            <span className="timing text-table text-ink text-end">{pointsText}</span>
          </li>
        );
      })}
    </ul>
  );
}
