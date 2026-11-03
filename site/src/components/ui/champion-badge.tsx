import { IconTrophy } from "@/components/icons";

export function ChampionBadge({ season, inline = false }: { season: number; inline?: boolean }) {
  return (
    <span className={`champion-badge${inline ? " champion-badge-inline" : ""}`} aria-label={`${season} world champion`}>
      <IconTrophy size="1em" />
      <span>Champion</span>
    </span>
  );
}
