import { IconTrophy } from "@/components/icons";

export function ChampionBadge({ season }: { season: number }) {
  return (
    <span className="champion-badge" aria-label={`${season} world champion`}>
      <IconTrophy size="0.875rem" />
      <span>Champion</span>
    </span>
  );
}
