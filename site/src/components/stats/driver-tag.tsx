import Link from "next/link";
import { TeamLogo } from "@/components/ui/team-logo";

export interface DriverTeam {
  constructorId: string;
  name: string;
  color: string;
}

interface DriverTagProps {
  /** The full name in tables and lists, or the three-letter code in compact spots. Never both. */
  text: string;
  /** Shown instead of `text` below the sm breakpoint, so a wide table fits a phone: the code. */
  compactText?: string;
  team: DriverTeam;
  season?: number | null;
  /** Logo box in px. */
  logo?: number;
  href?: string;
  /** Classes for the logo, e.g. to hide it where a team column shows the logo already. */
  logoClassName?: string;
  className?: string;
}

/**
 * A driver as the race weekend page shows one: the team logo, then either the full name or the
 * code. Team identity comes from the logo, not from a colour rule.
 */
export function DriverTag({ text, compactText, team, season = null, logo = 20, href, logoClassName = "", className = "" }: DriverTagProps) {
  const body = (
    <>
      <TeamLogo constructorId={team.constructorId} name={team.name} color={team.color} size={logo} season={season} className={logoClassName} />
      {compactText ? <span className="sm:hidden">{compactText}</span> : null}
      <span className={"min-w-0 truncate " + (compactText ? "hidden sm:inline" : "")}>{text}</span>
    </>
  );
  const classes = "inline-flex min-w-0 items-center gap-2 " + className;
  if (!href) return <span className={classes}>{body}</span>;
  return (
    <Link href={href} className={classes + " hover:underline underline-offset-2"}>
      {body}
    </Link>
  );
}
