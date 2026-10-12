import type { Metadata } from "next";
import { CalendarPageContent } from "@/components/stats/calendar-page";
import { getCurrentSeason } from "@/lib/data";

export const metadata: Metadata = {
  title: "Races",
};

export default async function RacesPage() {
  const season = await getCurrentSeason();
  return <CalendarPageContent season={season} />;
}
