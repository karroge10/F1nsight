import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DriverAvatar } from "@/components/ui/driver-avatar";
import { RaceCardResults } from "@/components/race-card-results";
import { TrackIcon } from "@/components/ui/track-icon";
import { MapPin, Calendar, Clock, Flag, Trophy, Users, Timer, Play } from "lucide-react";

// Get country flag emoji
function getCountryFlag(country: string): string {
  const flagMap: Record<string, string> = {
    'Bahrain': '🇧🇭',
    'Saudi Arabia': '🇸🇦', 
    'Australia': '🇦🇺',
    'Japan': '🇯🇵',
    'China': '🇨🇳',
    'Miami': '🇺🇸',
    'Italy': '🇮🇹',
    'Monaco': '🇲🇨',
    'Canada': '🇨🇦',
    'Spain': '🇪🇸',
    'Austria': '🇦🇹',
    'Great Britain': '🇬🇧',
    'Hungary': '🇭🇺',
    'Belgium': '🇧🇪',
    'Netherlands': '🇳🇱',
    'Singapore': '🇸🇬',
    'Azerbaijan': '🇦🇿',
    'United States': '🇺🇸',
    'Mexico': '🇲🇽',
    'Brazil': '🇧🇷',
    'Las Vegas': '🇺🇸',
    'Qatar': '🇶🇦',
    'Abu Dhabi': '🇦🇪'
  };
  return flagMap[country] || '🏁';
}

// Note: Race results are not implemented yet - showing real schedule data only

// Fetch schedule data from our FastF1 API
async function getScheduleData(year: number) {
  try {
    const response = await fetch(
      `${process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'}/api/fastf1/schedule?year=${year}`,
      { next: { revalidate: 86400 } } // Cache for 24 hours
    );
    
    if (!response.ok) {
      throw new Error('Failed to fetch schedule');
    }
    
    const result = await response.json();
    return result.data || [];
  } catch (error) {
    console.error('Error fetching schedule:', error);
    // Return fallback data
    return [
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
        session5_date: "2025-03-02T15:00:00"
      }
    ];
  }
}

export default async function RacesPage() {
  const year = new Date().getUTCFullYear();
  const schedule = await getScheduleData(year);
  
  // Transform schedule data - filter out testing
  const races = schedule
    .filter(race => 
      race.event_name.toLowerCase().includes('grand prix') ||
      race.official_name.toLowerCase().includes('grand prix')
    )
    .map(race => ({
      round: race.round_number,
      country: race.country,
      location: race.location,
      name: race.event_name,
      officialName: race.official_name,
      date: race.event_date,
      raceDate: race.session5_date || race.event_date,
      isCompleted: new Date(race.session5_date || race.event_date) < new Date(),
      isNextRace: false // We'll determine this below
    }));

  // Mark next race
  const nextRaceIndex = races.findIndex(race => !race.isCompleted);
  if (nextRaceIndex !== -1) {
    races[nextRaceIndex].isNextRace = true;
  }

  const formatDateRange = (dateStr: string) => {
    const date = new Date(dateStr);
    const endDate = new Date(date);
    endDate.setDate(date.getDate() + 2); // Assume 3-day weekend
    
    const startDay = date.getDate();
    const endDay = endDate.getDate();
    const month = date.toLocaleDateString('en-US', { month: 'short' }).toUpperCase();
    
    return `${startDay} - ${endDay} ${month}`;
  };

  const nextRace = races.find(race => race.isNextRace);

  return (
    <div className="min-h-screen bg-black text-white">
      <div className="container mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-4 mb-4">
            <div className="text-sm text-gray-400 uppercase tracking-wide">Next Race</div>
            {nextRace && (
              <>
                <div className="text-sm text-gray-400">{nextRace.country}</div>
                <div className="text-sm text-gray-400">{formatDateRange(nextRace.raceDate)}</div>
              </>
            )}
          </div>
        </div>

        {/* Race Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {races.map((race, index) => {
            
            return (
              <Card 
                key={race.round}
                className={`bg-gray-900 border-gray-800 hover:border-red-500 transition-all duration-300 overflow-hidden ${
                  race.isNextRace ? 'border-red-500 bg-red-900/20' : ''
                }`}
              >
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <span className="text-3xl">{getCountryFlag(race.country)}</span>
                      <div>
                        <div className="text-sm text-gray-400 uppercase tracking-wide">Round {race.round}</div>
                        <CardTitle className="text-xl font-bold text-white">{race.country}</CardTitle>
                      </div>
                    </div>
                    {race.isNextRace && (
                      <Badge className="bg-red-600 text-white">
                        NEXT RACE
                      </Badge>
                    )}
                    {race.isCompleted && (
                      <Badge className="bg-green-600 text-white">
                        COMPLETED
                      </Badge>
                    )}
                  </div>
                  <div className="text-sm text-gray-300 mt-2">
                    {race.officialName}
                  </div>
                </CardHeader>

                <CardContent className="pt-0">
                  <div className="text-center py-8">
                    <div className="text-3xl font-bold text-white mb-2">
                      {formatDateRange(race.raceDate)}
                    </div>
                    <div className="text-sm text-gray-400 uppercase tracking-wide mb-4">
                      {race.location}
                    </div>
                    
                    {race.isCompleted ? (
                      <div className="p-4 bg-gray-800/50 rounded-lg">
                        <div className="flex items-center gap-2 mb-3 justify-center">
                          <Trophy className="w-5 h-5 text-yellow-500" />
                          <div className="text-sm text-gray-300">Top 3 Finishers</div>
                        </div>
                        <RaceCardResults year={new Date().getUTCFullYear()} round={race.round} />
                      </div>
                    ) : (
                      <div className="text-center p-4 bg-blue-900/20 rounded-lg border border-blue-500/30">
                        <Calendar className="w-8 h-8 text-blue-400 mx-auto mb-2" />
                        <div className="text-sm text-blue-300">Upcoming Race</div>
                        <div className="text-xs text-gray-400 mt-1">
                          Schedule from FastF1 API
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Track Circuit Icon */}
                  <div className="mt-4 flex justify-center opacity-30">
                    <TrackIcon />
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    </div>
  );
}