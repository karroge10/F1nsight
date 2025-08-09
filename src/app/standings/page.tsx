import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Trophy, TrendingUp, TrendingDown, Minus, Users, Car } from 'lucide-react'

interface Driver {
  position: number
  name: string
  team: string
  points: number
  change: number
  nationality: string
  wins: number
  podiums: number
}

interface Team {
  position: number
  name: string
  points: number
  change: number
  color: string
}

export default function StandingsPage() {
  const drivers: Driver[] = [
    { position: 1, name: "Max Verstappen", team: "Red Bull Racing", points: 575, change: 0, nationality: "NED", wins: 19, podiums: 21 },
    { position: 2, name: "Sergio Perez", team: "Red Bull Racing", points: 285, change: 0, nationality: "MEX", wins: 2, podiums: 8 },
    { position: 3, name: "Lewis Hamilton", team: "Mercedes", points: 234, change: 1, nationality: "GBR", wins: 2, podiums: 8 },
    { position: 4, name: "Fernando Alonso", team: "Aston Martin", points: 206, change: -1, nationality: "ESP", wins: 0, podiums: 8 },
    { position: 5, name: "Carlos Sainz", team: "Ferrari", points: 200, change: 0, nationality: "ESP", wins: 1, podiums: 7 },
    { position: 6, name: "George Russell", team: "Mercedes", points: 175, change: 2, nationality: "GBR", wins: 1, podiums: 4 },
    { position: 7, name: "Charles Leclerc", team: "Ferrari", points: 165, change: -1, nationality: "MON", wins: 2, podiums: 4 },
    { position: 8, name: "Lando Norris", team: "McLaren", points: 115, change: 1, nationality: "GBR", wins: 0, podiums: 3 },
    { position: 9, name: "Oscar Piastri", team: "McLaren", points: 97, change: -1, nationality: "AUS", wins: 0, podiums: 1 },
    { position: 10, name: "Lance Stroll", team: "Aston Martin", points: 74, change: 0, nationality: "CAN", wins: 0, podiums: 1 },
  ]

  const teams: Team[] = [
    { position: 1, name: "Red Bull Racing", points: 860, change: 0, color: "bg-blue-600" },
    { position: 2, name: "Mercedes", points: 409, change: 1, color: "bg-cyan-400" },
    { position: 3, name: "Ferrari", points: 365, change: -1, color: "bg-red-600" },
    { position: 4, name: "Aston Martin", points: 280, change: 0, color: "bg-green-600" },
    { position: 5, name: "McLaren", points: 212, change: 0, color: "bg-orange-500" },
  ]

  const getChangeIcon = (change: number) => {
    if (change > 0) return <TrendingUp className="w-4 h-4 text-green-500" />
    if (change < 0) return <TrendingDown className="w-4 h-4 text-red-500" />
    return <Minus className="w-4 h-4 text-gray-500" />
  }

  const getTeamColor = (team: string) => {
    const colors: Record<string, string> = {
      "Red Bull Racing": "bg-blue-600",
      "Mercedes": "bg-cyan-400",
      "Ferrari": "bg-red-600",
      "Aston Martin": "bg-green-600",
      "McLaren": "bg-orange-500"
    }
    return colors[team] || "bg-gray-600"
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-red-900/20 to-gray-900">
      <div className="container mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-white mb-4">2024 F1 Championship Standings</h1>
          <p className="text-gray-300">Current standings after 22 races</p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Driver Standings */}
          <Card className="bg-gray-800 border-gray-700">
            <CardHeader>
              <CardTitle className="text-white flex items-center gap-2">
                <Trophy className="w-5 h-5 text-yellow-500" />
                Driver Championship
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {drivers.map((driver) => (
                  <div key={driver.position} className="flex items-center gap-3 p-3 rounded-lg bg-gray-700/50 hover:bg-gray-700 transition-colors">
                    <div className="flex items-center gap-3 flex-1">
                      <div className="text-lg font-bold text-white w-6">
                        {driver.position}
                      </div>
                      <div className={`w-1 h-8 rounded ${getTeamColor(driver.team)}`} />
                      <div className="flex-1">
                        <div className="font-semibold text-white">{driver.name}</div>
                        <div className="text-sm text-gray-400">{driver.team}</div>
                      </div>
                      <div className="text-center">
                        <Badge variant="secondary" className="bg-gray-600 text-white text-xs">
                          {driver.nationality}
                        </Badge>
                      </div>
                      <div className="text-right">
                        <div className="font-bold text-white">{driver.points}</div>
                        <div className="text-sm text-gray-400">pts</div>
                      </div>
                      {getChangeIcon(driver.change)}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Constructor Standings */}
          <Card className="bg-gray-800 border-gray-700">
            <CardHeader>
              <CardTitle className="text-white flex items-center gap-2">
                <Car className="w-5 h-5 text-blue-500" />
                Constructor Championship
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {teams.map((team) => (
                  <div key={team.position} className="flex items-center gap-3 p-4 rounded-lg bg-gray-700/50 hover:bg-gray-700 transition-colors">
                    <div className="text-lg font-bold text-white w-6">
                      {team.position}
                    </div>
                    <div className={`w-2 h-10 rounded ${team.color}`} />
                    <div className="flex-1">
                      <div className="font-semibold text-white text-lg">{team.name}</div>
                    </div>
                    <div className="text-right">
                      <div className="font-bold text-white text-xl">{team.points}</div>
                      <div className="text-sm text-gray-400">points</div>
                    </div>
                    {getChangeIcon(team.change)}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Championship Progress */}
        <div className="mt-8">
          <Card className="bg-gray-800 border-gray-700">
            <CardHeader>
              <CardTitle className="text-white">Championship Progress</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="text-center">
                  <div className="text-3xl font-bold text-yellow-500 mb-2">22</div>
                  <div className="text-gray-300">Races Completed</div>
                  <div className="text-sm text-gray-500">of 24 total</div>
                </div>
                <div className="text-center">
                  <div className="text-3xl font-bold text-red-500 mb-2">575</div>
                  <div className="text-gray-300">Championship Lead</div>
                  <div className="text-sm text-gray-500">Max Verstappen</div>
                </div>
                <div className="text-center">
                  <div className="text-3xl font-bold text-blue-500 mb-2">860</div>
                  <div className="text-gray-300">Constructor Lead</div>
                  <div className="text-sm text-gray-500">Red Bull Racing</div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
