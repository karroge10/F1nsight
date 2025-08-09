import { NextResponse } from "next/server";

export const revalidate = 3600; // cache for 1 hour

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const year = searchParams.get("year");
    const round = searchParams.get("round");
    
    if (!year) {
      return NextResponse.json({ error: "Year parameter is required" }, { status: 400 });
    }

    // For now, return that results are not available instead of fake data
    // This can be expanded later to fetch real results from Ergast or other sources
    return NextResponse.json({ 
      data: {
        race_results: null,
        message: "Race results not yet implemented - showing real schedule data only",
        year: parseInt(year),
        round: round ? parseInt(round) : null
      },
      success: true 
    });

  } catch (e: unknown) {
    console.error("Error fetching race results:", e);
    return NextResponse.json({ 
      error: (e as Error)?.message ?? "unknown",
      success: false
    }, { status: 500 });
  }
}
export const revalidate = 3600; // cache for 1 hour

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const year = searchParams.get("year");
    const round = searchParams.get("round");
    
    if (!year) {
      return NextResponse.json({ error: "Year parameter is required" }, { status: 400 });
    }

    // For now, return that results are not available instead of fake data
    // This can be expanded later to fetch real results from Ergast or other sources
    return NextResponse.json({ 
      data: {
        race_results: null,
        message: "Race results not yet implemented - showing real schedule data only",
        year: parseInt(year),
        round: round ? parseInt(round) : null
      },
      success: true 
    });

  } catch (e: unknown) {
    console.error("Error fetching race results:", e);
    return NextResponse.json({ 
      error: (e as Error)?.message ?? "unknown",
      success: false
    }, { status: 500 });
  }
}

