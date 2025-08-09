import { NextResponse } from "next/server";

export const revalidate = 1800; // cache for 30 minutes

const FASTF1_API_URL = "http://localhost:8000";

interface DriverStanding {
  driver: string;
  points: number;
  team: string;
  position: number;
}

interface WDCData {
  year: number;
  races_completed: number;
  races_remaining: number;
  championship_leader: string;
  leader_points: number;
  drivers: {
    driver: string;
    team: string;
    current_points: number;
    max_possible: number;
    can_win: boolean;
    points_behind: number;
    races_left: number;
  }[];
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const year = searchParams.get('year') || new Date().getFullYear().toString();
    
    // Try to fetch from FastF1 API first
    try {
      const response = await fetch(`${FASTF1_API_URL}/wdc-calculator/${year}`, {
        next: { revalidate: 1800 }
      });
      
      if (response.ok) {
        const wdcData: WDCData = await response.json();
        
        // Transform WDC data to standings format
        const standings = wdcData.drivers
          .sort((a, b) => b.current_points - a.current_points)
          .map((driver, index) => ({
            position: index + 1,
            name: driver.driver,
            team: driver.team,
            points: driver.current_points,
            change: 0, // We don't have historical data for change
            nationality: getDriverNationality(driver.driver) // Helper function
          }));
        
        return NextResponse.json({ 
          data: standings,
          source: "fastf1",
          success: true,
          meta: {
            year: wdcData.year,
            races_completed: wdcData.races_completed,
            races_remaining: wdcData.races_remaining,
            leader: wdcData.championship_leader
          }
        });
      }
    } catch (fastf1Error) {
      console.warn("FastF1 API not available:", fastf1Error);
    }

    // Fallback to complete F1 grid mock data (20 drivers, 10 teams)
    const mockStandings = [
      { position: 1, name: "Max Verstappen", team: "Red Bull Racing", points: 393, change: 0, nationality: "NED" },
      { position: 2, name: "Lando Norris", team: "McLaren", points: 331, change: 0, nationality: "GBR" },
      { position: 3, name: "Charles Leclerc", team: "Ferrari", points: 307, change: 1, nationality: "MON" },
      { position: 4, name: "Oscar Piastri", team: "McLaren", points: 262, change: -1, nationality: "AUS" },
      { position: 5, name: "Carlos Sainz", team: "Ferrari", points: 244, change: 0, nationality: "ESP" },
      { position: 6, name: "George Russell", team: "Mercedes", points: 192, change: 1, nationality: "GBR" },
      { position: 7, name: "Lewis Hamilton", team: "Mercedes", points: 190, change: -1, nationality: "GBR" },
      { position: 8, name: "Sergio Perez", team: "Red Bull Racing", points: 151, change: 0, nationality: "MEX" },
      { position: 9, name: "Fernando Alonso", team: "Aston Martin", points: 62, change: 0, nationality: "ESP" },
      { position: 10, name: "Nico Hulkenberg", team: "Haas", points: 31, change: 1, nationality: "GER" },
      { position: 11, name: "Lance Stroll", team: "Aston Martin", points: 24, change: -1, nationality: "CAN" },
      { position: 12, name: "Yuki Tsunoda", team: "RB", points: 22, change: 0, nationality: "JPN" },
      { position: 13, name: "Kevin Magnussen", team: "Haas", points: 14, change: 0, nationality: "DEN" },
      { position: 14, name: "Alexander Albon", team: "Williams", points: 12, change: 1, nationality: "THA" },
      { position: 15, name: "Daniel Ricciardo", team: "RB", points: 12, change: -1, nationality: "AUS" },
      { position: 16, name: "Pierre Gasly", team: "Alpine", points: 8, change: 0, nationality: "FRA" },
      { position: 17, name: "Oliver Bearman", team: "Ferrari", points: 7, change: 0, nationality: "GBR" },
      { position: 18, name: "Franco Colapinto", team: "Williams", points: 5, change: 0, nationality: "ARG" },
      { position: 19, name: "Esteban Ocon", team: "Alpine", points: 5, change: 0, nationality: "FRA" },
      { position: 20, name: "Zhou Guanyu", team: "Sauber", points: 0, change: 0, nationality: "CHN" }
    ];

    return NextResponse.json({ 
      data: mockStandings,
      source: "mock",
      success: true,
      warning: "Using fallback data - real standings not available"
    });

  } catch (error: unknown) {
    console.error("Error fetching driver standings:", error);
    return NextResponse.json({ 
      error: (error as Error)?.message ?? "unknown",
      success: false
    }, { status: 500 });
  }
}

// Helper function to get driver nationality
function getDriverNationality(driverName: string): string {
  const nationalities: Record<string, string> = {
    "Max Verstappen": "NED",
    "Lando Norris": "GBR", 
    "Charles Leclerc": "MON",
    "Oscar Piastri": "AUS",
    "Carlos Sainz": "ESP",
    "George Russell": "GBR",
    "Lewis Hamilton": "GBR",
    "Sergio Perez": "MEX",
    "Fernando Alonso": "ESP",
    "Lance Stroll": "CAN",
    "Nico Hulkenberg": "GER",
    "Yuki Tsunoda": "JPN",
    "Daniel Ricciardo": "AUS",
    "Pierre Gasly": "FRA",
    "Alexander Albon": "THA",
    "Esteban Ocon": "FRA",
    "Logan Sargeant": "USA",
    "Kevin Magnussen": "DEN",
    "Valtteri Bottas": "FIN",
    "Zhou Guanyu": "CHN"
  };
  
  return nationalities[driverName] || "UNK";
}
