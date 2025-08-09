import { NextResponse } from "next/server";
import { getDriversByYear } from "@/lib/openf1";

export const revalidate = 3600; // cache for 1 hour

// Fallback F1 grid data for current season
const fallbackF1Grid = {
  driver_count: 20,
  team_count: 10,
  teams: [
    "Red Bull Racing",
    "McLaren", 
    "Ferrari",
    "Mercedes",
    "Aston Martin",
    "Haas",
    "RB",
    "Williams", 
    "Alpine",
    "Sauber"
  ],
  drivers: [
    { driver_number: 1, full_name: "Max Verstappen", name_acronym: "VER", team_name: "Red Bull Racing", team_colour: "3671C6", country_code: "NED" },
    { driver_number: 11, full_name: "Sergio Perez", name_acronym: "PER", team_name: "Red Bull Racing", team_colour: "3671C6", country_code: "MEX" },
    { driver_number: 4, full_name: "Lando Norris", name_acronym: "NOR", team_name: "McLaren", team_colour: "FF8000", country_code: "GBR" },
    { driver_number: 81, full_name: "Oscar Piastri", name_acronym: "PIA", team_name: "McLaren", team_colour: "FF8000", country_code: "AUS" },
    { driver_number: 16, full_name: "Charles Leclerc", name_acronym: "LEC", team_name: "Ferrari", team_colour: "E8002D", country_code: "MON" },
    { driver_number: 55, full_name: "Carlos Sainz", name_acronym: "SAI", team_name: "Ferrari", team_colour: "E8002D", country_code: "ESP" },
    { driver_number: 44, full_name: "Lewis Hamilton", name_acronym: "HAM", team_name: "Mercedes", team_colour: "6CD3BF", country_code: "GBR" },
    { driver_number: 63, full_name: "George Russell", name_acronym: "RUS", team_name: "Mercedes", team_colour: "6CD3BF", country_code: "GBR" },
    { driver_number: 14, full_name: "Fernando Alonso", name_acronym: "ALO", team_name: "Aston Martin", team_colour: "229971", country_code: "ESP" },
    { driver_number: 18, full_name: "Lance Stroll", name_acronym: "STR", team_name: "Aston Martin", team_colour: "229971", country_code: "CAN" },
    { driver_number: 20, full_name: "Kevin Magnussen", name_acronym: "MAG", team_name: "Haas", team_colour: "B6BABD", country_code: "DEN" },
    { driver_number: 27, full_name: "Nico Hulkenberg", name_acronym: "HUL", team_name: "Haas", team_colour: "B6BABD", country_code: "GER" },
    { driver_number: 22, full_name: "Yuki Tsunoda", name_acronym: "TSU", team_name: "RB", team_colour: "6692FF", country_code: "JPN" },
    { driver_number: 3, full_name: "Daniel Ricciardo", name_acronym: "RIC", team_name: "RB", team_colour: "6692FF", country_code: "AUS" },
    { driver_number: 23, full_name: "Alexander Albon", name_acronym: "ALB", team_name: "Williams", team_colour: "64C4FF", country_code: "THA" },
    { driver_number: 2, full_name: "Logan Sargeant", name_acronym: "SAR", team_name: "Williams", team_colour: "64C4FF", country_code: "USA" },
    { driver_number: 10, full_name: "Pierre Gasly", name_acronym: "GAS", team_name: "Alpine", team_colour: "FF87BC", country_code: "FRA" },
    { driver_number: 31, full_name: "Esteban Ocon", name_acronym: "OCO", team_name: "Alpine", team_colour: "FF87BC", country_code: "FRA" },
    { driver_number: 77, full_name: "Valtteri Bottas", name_acronym: "BOT", team_name: "Sauber", team_colour: "52E252", country_code: "FIN" },
    { driver_number: 24, full_name: "Zhou Guanyu", name_acronym: "ZHO", team_name: "Sauber", team_colour: "52E252", country_code: "CHN" }
  ]
};

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const year = searchParams.get("year");
    
    if (!year) {
      return NextResponse.json({ error: "Year parameter is required" }, { status: 400 });
    }

    try {
      // Try to get real data from OpenF1 first
      const drivers = await getDriversByYear(parseInt(year));
      
      if (drivers && drivers.length > 0) {
        // Get unique teams from drivers
        const uniqueTeams = new Set(drivers.map(driver => driver.team_name));
        
        return NextResponse.json({ 
          data: {
            drivers: drivers.map(driver => ({
              driver_number: driver.driver_number,
              full_name: driver.full_name,
              name_acronym: driver.name_acronym,
              team_name: driver.team_name,
              team_colour: driver.team_colour,
              country_code: driver.country_code
            })),
            driver_count: drivers.length,
            team_count: uniqueTeams.size,
            teams: Array.from(uniqueTeams)
          },
          source: "openf1",
          success: true 
        });
      }
    } catch (openf1Error) {
      console.warn("OpenF1 API not available, using fallback data:", openf1Error);
    }

    // Fallback to static F1 grid data
    return NextResponse.json({ 
      data: fallbackF1Grid,
      source: "fallback",
      success: true 
    });

  } catch (e: unknown) {
    console.error("Error fetching drivers:", e);
    return NextResponse.json({ 
      error: (e as Error)?.message ?? "unknown",
      success: false
    }, { status: 500 });
  }
}