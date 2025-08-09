import { NextResponse } from "next/server";
import { getNextRace } from "@/lib/openf1";

export const revalidate = 3600; // cache for 1 hour

const FASTF1_API_URL = "http://localhost:8000";

export async function GET() {
  try {
    // Try FastF1 API first (more reliable for upcoming races)
    try {
      const currentYear = new Date().getFullYear();
      const response = await fetch(`${FASTF1_API_URL}/next-race/${currentYear}`, {
        next: { revalidate: 3600 }
      });
      
      if (response.ok) {
        const fastf1Data = await response.json();
        if (fastf1Data.next_race) {
          // Transform FastF1 data to match OpenF1 format
          const transformedData = {
            meeting: {
              meeting_key: fastf1Data.next_race.round_number,
              circuit_short_name: fastf1Data.next_race.location,
              location: fastf1Data.next_race.location,
              country_name: fastf1Data.next_race.country,
              meeting_name: fastf1Data.next_race.event_name,
              meeting_official_name: fastf1Data.next_race.official_name,
              date_start: fastf1Data.next_race.event_date,
              year: currentYear
            },
            source: "fastf1"
          };
          return NextResponse.json({ data: transformedData });
        }
      }
    } catch (fastf1Error) {
      console.warn("FastF1 API not available, falling back to OpenF1:", fastf1Error);
    }

    // Fallback to OpenF1 API
    const data = await getNextRace();
    return NextResponse.json({ data });
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error)?.message ?? "unknown" }, { status: 500 });
  }
}


