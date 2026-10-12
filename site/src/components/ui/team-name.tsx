import { Fragment } from "react";
import { TeamLogo } from "./team-logo";

interface TeamNameProps {
  constructorId: string;
  name: string;
  color: string;
  /** Season the logo should represent. Defaults to the latest brand. */
  season?: number | null;
  /** Logo box in px. */
  size?: number;
  /** Classes for the text; the default truncates inside a narrow cell. */
  textClassName?: string;
  className?: string;
}

interface TeamNamesProps {
  teams: { constructorId: string; name: string; color: string }[];
  season?: number | null;
  size?: number;
  /** Punctuation after the last team, e.g. the full stop of a sentence; it never wraps on its own. */
  suffix?: string;
  className?: string;
}

/** A team name with its logo in front: the one way a team is labelled across the site. */
export function TeamName({ constructorId, name, color, season = null, size = 18, textClassName = "min-w-0 truncate", className = "" }: TeamNameProps) {
  return (
    // baseline-aligned so the name sits on the surrounding text's baseline; the logo centres on the line
    <span className={"inline-flex min-w-0 items-baseline gap-2 " + className}>
      <TeamLogo constructorId={constructorId} name={name} color={color} size={size} season={season} className="self-center" />
      <span className={textClassName}>{name}</span>
    </span>
  );
}

/**
 * Several teams in a row, each with its logo, separated by commas (a season with a mid-year move,
 * a career). Inline text flow, so in a sentence the list wraps like words; each team keeps its
 * comma (or the suffix) on its own line.
 */
export function TeamNames({ teams, season = null, size = 18, suffix = "", className = "" }: TeamNamesProps) {
  return (
    <span className={className}>
      {teams.map((t, i) => {
        const last = i === teams.length - 1;
        return (
          <Fragment key={t.constructorId + i}>
            <span className="whitespace-nowrap">
              <TeamName constructorId={t.constructorId} name={t.name} color={t.color} season={season} size={size} textClassName="" />
              {last ? suffix : ","}
            </span>
            {last ? null : " "}
          </Fragment>
        );
      })}
    </span>
  );
}
