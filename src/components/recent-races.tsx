'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Calendar, MapPin, Trophy, Loader2 } from 'lucide-react'
import Link from 'next/link'
import { useF1Schedule } from '@/hooks/use-f1-schedule'

interface Race {
  name: string
  circuit: string
  country: string
  date: string
  winner?: string
  team?: string
  round: number
  status: 'completed' | 'upcoming'
}

export function RecentRaces() {
  const { loading, error, getRecentRaces } = useF1Schedule(2025);

  // Transform schedule data to Race format - filter out testing
  const races: Race[] = getRecentRaces(6)
    .filter(race => 
      race.event_name.toLowerCase().includes('grand prix') ||
      race.official_name.toLowerCase().includes('grand prix')
    )
    .map((race) => ({
    name: race.event_name,
    circuit: race.location,
    country: race.country,
    date: race.raceDate.toISOString().split('T')[0],
    round: race.round_number,
    status: race.isCompleted ? 'completed' as const : 'upcoming' as const,
    // For completed races, we'd need additional API calls to get winners
    winner: race.isCompleted ? 'Results TBD' : undefined,
    team: race.isCompleted ? 'TBD' : undefined
  }));

  if (loading) {
    return (
      <Card className="bg-gray-800 border-gray-700">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-white flex items-center gap-2">
              <Calendar className="w-5 h-5 text-blue-500" />
              Recent & Upcoming Races
            </CardTitle>
            <Link href="/races">
              <Button variant="outline" size="sm">
                Full Calendar
              </Button>
            </Link>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-8">
            <div className="flex items-center gap-3">
              <Loader2 className="w-5 h-5 animate-spin text-blue-500" />
              <span className="text-gray-400">Loading races...</span>
            </div>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="bg-gray-800 border-gray-700">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-white flex items-center gap-2">
            <Calendar className="w-5 h-5 text-blue-500" />
            Recent & Upcoming Races
            {error && <Badge variant="destructive" className="ml-2 text-xs">API Error</Badge>}
          </CardTitle>
          <Link href="/races">
            <Button variant="outline" size="sm">
              Full Calendar
            </Button>
          </Link>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {races.map((race) => (
            <div key={race.round} className="p-4 rounded-lg bg-gray-700/50 hover:bg-gray-700 transition-colors">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <h3 className="font-semibold text-white">{race.name}</h3>
                  <div className="flex items-center gap-1 text-sm text-gray-400 mt-1">
                    <MapPin className="w-3 h-3" />
                    {race.circuit}, {race.country}
                  </div>
                </div>
                <Badge 
                  variant={race.status === 'completed' ? 'default' : 'secondary'}
                  className={race.status === 'completed' ? 'bg-green-600' : 'bg-blue-600'}
                >
                  Round {race.round}
                </Badge>
              </div>
              
              <div className="flex items-center justify-between">
                <div className="text-sm text-gray-400">
                  {new Date(race.date).toLocaleDateString('en-US', { 
                    month: 'short', 
                    day: 'numeric' 
                  })}
                </div>
                {race.status === 'completed' ? (
                  <div className="flex items-center gap-2">
                    <Trophy className="w-4 h-4 text-yellow-500" />
                    <div className="text-right">
                      <div className="text-sm font-semibold text-white">{race.winner || 'Results TBD'}</div>
                      <div className="text-xs text-gray-400">{race.team || 'TBD'}</div>
                    </div>
                  </div>
                ) : (
                  <Badge variant="outline" className="border-blue-500 text-blue-400">
                    Upcoming
                  </Badge>
                )}
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
