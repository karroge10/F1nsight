import Link from "next/link";
import type { ConstructorForecast } from "@/lib/data";
import { TeamLogo } from "@/components/ui/team-logo";

interface ConstructorForecastListProps {
  constructors: ConstructorForecast[];
}

/** Expected constructor points for the race as thin bars from one baseline. */
export function ConstructorForecastList({ constructors }: ConstructorForecastListProps) {
  const max = Math.max(...constructors.map((c) => c.expectedPoints), 1);
  return (
    <ul className="grid gap-x-10 gap-y-1 md:grid-cols-2">
      {constructors.map((c, i) => {
        const widthPercent = `${((c.expectedPoints / max) * 100).toFixed(1)}%`;
        const pointsText = c.expectedPoints.toFixed(1);
        return (
          <li key={c.constructorId} className="stagger-in grid grid-cols-[minmax(0,10rem)_1fr_3rem] items-center gap-3 py-1.5" style={{ "--stagger": i } as React.CSSProperties}>
            <Link href={`/teams/${c.constructorId}`} className="tap-hit flex min-w-0 items-center gap-2 text-ui text-ink hover:underline underline-offset-2">
              <TeamLogo constructorId={c.constructorId} name={c.name} color={c.teamColor} size={24} />
              <span className="truncate">{c.name}</span>
            </Link>
            <span className="relative h-1.5 rounded-chip bg-bg-sunken" aria-hidden="true">
              <span className="absolute inset-y-0 start-0 rounded-chip" style={{ width: widthPercent, background: c.teamColor }} />
            </span>
            <span className="timing text-table text-ink text-end">{pointsText}</span>
          </li>
        );
      })}
    </ul>
  );
}
