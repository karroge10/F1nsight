import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CalendarPageContent } from "@/components/stats/calendar-page";
import { getSeasons } from "@/lib/data";

export const dynamicParams = false;

export async function generateStaticParams(): Promise<{ season: string }[]> {
  const seasons = await getSeasons();
  return seasons.map((s) => ({ season: String(s.season) }));
}

export async function generateMetadata({ params }: { params: Promise<{ season: string }> }): Promise<Metadata> {
  const { season } = await params;
  return { title: `${season} races` };
}

export default async function RacesSeasonPage({ params }: { params: Promise<{ season: string }> }) {
  const { season } = await params;
  const year = Number(season);
  const seasons = await getSeasons();
  if (!seasons.some((s) => s.season === year)) notFound();
  return <CalendarPageContent season={year} />;
}
