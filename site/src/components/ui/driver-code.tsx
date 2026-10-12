import { TeamLogo } from "./team-logo";
import { TeamMark } from "./team-mark";

interface DriverCodeProps {
  code: string;
  color: string;
  /** When given, the team logo stands in front of the code instead of the colour rule. */
  constructorId?: string;
  teamName?: string;
  season?: number | null;
  className?: string;
}

/** A driver's three-letter code with the team logo (or, without a team id, the colour rule) beside it, for compact tiles and labels. */
export function DriverCode({ code, color, constructorId, teamName, season = null, className = "" }: DriverCodeProps) {
  return (
    <span className={"inline-flex items-center gap-2 " + className}>
      {constructorId ? <TeamLogo constructorId={constructorId} name={teamName ?? constructorId} color={color} size={18} season={season} /> : <TeamMark color={color} />}
      {code}
    </span>
  );
}
