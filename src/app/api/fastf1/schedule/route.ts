import { NextResponse } from "next/server";

export const revalidate = 86400; // cache for 24 hours (schedule doesn't change often)

const FASTF1_API_URL = "http://localhost:8000";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const year = searchParams.get('year') || new Date().getFullYear().toString();
    
    // Try to fetch from FastF1 API first
    try {
      const response = await fetch(`${FASTF1_API_URL}/schedule/${year}`, {
        next: { revalidate: 86400 }
      });
      
      if (response.ok) {
        const data = await response.json();
        return NextResponse.json({ 
          data: data.schedule,
          source: "fastf1",
          success: true
        });
      }
    } catch (fastf1Error) {
      console.warn("FastF1 API not available:", fastf1Error);
    }

    // Fallback to mock data if FastF1 API is not available
    const mockSchedule = [
      {
        round_number: 1,
        country: "Bahrain",
        location: "Sakhir",
        official_name: "Formula 1 Gulf Air Bahrain Grand Prix 2025",
        event_name: "Bahrain Grand Prix",
        event_date: "2025-03-02T15:00:00",
        event_format: "conventional",
        session1: "Practice 1",
        session1_date: "2025-02-28T11:30:00",
        session2: "Practice 2",
        session2_date: "2025-02-28T15:00:00",
        session3: "Practice 3",
        session3_date: "2025-03-01T11:30:00",
        session4: "Qualifying",
        session4_date: "2025-03-01T15:00:00",
        session5: "Race",
        session5_date: "2025-03-02T15:00:00",
        f1_api_support: true
      },
      {
        round_number: 2,
        country: "Saudi Arabia",
        location: "Jeddah",
        official_name: "Formula 1 STC Saudi Arabian Grand Prix 2025",
        event_name: "Saudi Arabian Grand Prix",
        event_date: "2025-03-09T18:00:00",
        event_format: "conventional",
        session1: "Practice 1",
        session1_date: "2025-03-07T14:30:00",
        session2: "Practice 2",
        session2_date: "2025-03-07T18:00:00",
        session3: "Practice 3",
        session3_date: "2025-03-08T14:30:00",
        session4: "Qualifying",
        session4_date: "2025-03-08T18:00:00",
        session5: "Race",
        session5_date: "2025-03-09T18:00:00",
        f1_api_support: true
      },
      {
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
      }
    ];

    return NextResponse.json({ 
      data: mockSchedule,
      source: "mock",
      success: true
    });

  } catch (error: unknown) {
    console.error("Error fetching schedule:", error);
    return NextResponse.json({ 
      error: (error as Error)?.message ?? "unknown",
      success: false
    }, { status: 500 });
  }
}

