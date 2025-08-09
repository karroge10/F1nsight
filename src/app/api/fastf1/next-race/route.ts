import { NextResponse } from "next/server";

export const revalidate = 3600; // cache for 1 hour

const FASTF1_API_URL = "http://localhost:8000";

export async function GET() {
  try {
    const currentYear = new Date().getFullYear();
    
    // Try to fetch from FastF1 API first
    try {
      const response = await fetch(`${FASTF1_API_URL}/next-race/${currentYear}`, {
        next: { revalidate: 3600 }
      });
      
      if (response.ok) {
        const data = await response.json();
        return NextResponse.json({ 
          data: data.next_race,
          source: "fastf1",
          success: true
        });
      }
    } catch (fastf1Error) {
      console.warn("FastF1 API not available:", fastf1Error);
    }

    // Fallback to mock data if FastF1 API is not available
    const mockNextRace = {
      round_number: 3,
      country: "Australia",
      location: "Melbourne",
      official_name: "Formula 1 Rolex Australian Grand Prix 2025",
      event_name: "Australian Grand Prix",
      event_date: "2025-03-16T05:00:00",
      event_format: "conventional",
      session1: "Practice 1",
      session1_date: "2025-03-14T01:30:00",
      session2: "Practice 2", 
      session2_date: "2025-03-14T05:00:00",
      session3: "Practice 3",
      session3_date: "2025-03-15T01:30:00",
      session4: "Qualifying",
      session4_date: "2025-03-15T05:00:00",
      session5: "Race",
      session5_date: "2025-03-16T05:00:00",
      f1_api_support: true
    };

    return NextResponse.json({ 
      data: mockNextRace,
      source: "mock",
      success: true
    });

  } catch (error: unknown) {
    console.error("Error fetching next race:", error);
    return NextResponse.json({ 
      error: (error as Error)?.message ?? "unknown",
      success: false
    }, { status: 500 });
  }
}
