'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Calendar, MapPin, Trophy } from 'lucide-react'
import Link from 'next/link'

interface Race {
  name: string
  circuit: string
  country: string
  date: string
  winner: string
  team: string
  round: number
  status: 'completed' | 'upcoming'
}

export function RecentRaces() {
  const races: Race[] = [
    {
      name: "Spanish Grand Prix",
      circuit: "Circuit de Barcelona-Catalunya",
      country: "Spain",
      date: "2024-05-12",
      winner: "Max Verstappen",
      team: "Red Bull Racing",
      round: 7,
      status: "completed"
    },
    {
      name: "Emilia Romagna Grand Prix",
      circuit: "Autodromo Enzo e Dino Ferrari",
      country: "Italy",
      date: "2024-04-28",
      winner: "Max Verstappen",
      team: "Red Bull Racing",
      round: 6,
      status: "completed"
    },
    {
      name: "Chinese Grand Prix",
      circuit: "Shanghai International Circuit",
      country: "China",
      date: "2024-04-14",
      winner: "Max Verstappen",
      team: "Red Bull Racing",
      round: 5,
      status: "completed"
    },
    {
      name: "Monaco Grand Prix",
      circuit: "Circuit de Monaco",
      country: "Monaco",
      date: "2024-05-26",
      winner: "TBD",
      team: "TBD",
      round: 8,
      status: "upcoming"
    }
  ]

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
                      <div className="text-sm font-semibold text-white">{race.winner}</div>
                      <div className="text-xs text-gray-400">{race.team}</div>
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
