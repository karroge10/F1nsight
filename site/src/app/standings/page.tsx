import type { Metadata } from "next";
import { StandingsPageContent } from "@/components/stats/standings-page";
import { getCurrentSeason } from "@/lib/data";

export const metadata: Metadata = {
  title: "Standings",
};

export default async function StandingsPage() {
  const season = await getCurrentSeason();
  return <StandingsPageContent season={season} />;
}
