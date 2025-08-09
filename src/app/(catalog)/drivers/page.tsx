import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Trophy, Flag, Calendar, TrendingUp } from 'lucide-react'
import Image from 'next/image'

interface Driver {
  id: number
  name: string
  team: string
  nationality: string
  age: number
  championships: number
  raceWins: number
  podiums: number
  points2024: number
  position: number
  imageUrl: string
}

export default function DriversPage() {
  // Mock data - in real app, fetch from Ergast API
  const drivers: Driver[] = [
    {
      id: 1,
      name: "Max Verstappen",
      team: "Red Bull Racing",
      nationality: "Netherlands",
      age: 26,
      championships: 3,
      raceWins: 54,
      podiums: 98,
      points2024: 575,
      position: 1,
      imageUrl: "/max-verstappen-portrait.png"
    },
    {
      id: 2,
      name: "Lewis Hamilton",
      team: "Mercedes",
      nationality: "United Kingdom",
      age: 39,
      championships: 7,
      raceWins: 103,
      podiums: 197,
      points2024: 234,
      position: 3,
      imageUrl: "/lewis-hamilton-portrait.png"
    },
    {
      id: 3,
      name: "Charles Leclerc",
      team: "Ferrari",
      nationality: "Monaco",
      age: 26,
      championships: 0,
      raceWins: 5,
      podiums: 29,
      points2024: 165,
      position: 7,
      imageUrl: "/charles-leclerc-portrait.png"
    },
    {
      id: 4,
      name: "Lando Norris",
      team: "McLaren",
      nationality: "United Kingdom",
      age: 24,
      championships: 0,
      raceWins: 1,
      podiums: 13,
      points2024: 115,
      position: 8,
      imageUrl: "/lando-norris-portrait.png"
    }
  ]

  const getTeamColor = (team: string) => {
    const colors: Record<string, string> = {
      "Red Bull Racing": "border-blue-500 bg-blue-500/10",
      "Mercedes": "border-cyan-400 bg-cyan-400/10",
      "Ferrari": "border-red-500 bg-red-500/10",
      "McLaren": "border-orange-500 bg-orange-500/10"
    }
    return colors[team] || "border-gray-500 bg-gray-500/10"
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-red-900/20 to-gray-900">
      <div className="container mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-white mb-4">F1 Drivers 2024</h1>
          <div className="flex flex-col sm:flex-row gap-4">
            <Input 
              placeholder="Search drivers..." 
              className="bg-gray-800 border-gray-700 text-white max-w-md"
            />
            <div className="flex gap-2">
              <Button variant="outline" className="border-gray-600 text-gray-300">
                Filter by Team
              </Button>
              <Button variant="outline" className="border-gray-600 text-gray-300">
                Sort by Points
              </Button>
            </div>
          </div>
        </div>

        {/* Drivers Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {drivers.map((driver, index) => (
            <Card 
              key={driver.id} 
              className={`bg-gray-800 border-2 ${getTeamColor(driver.team)} hover:scale-105 hover:shadow-2xl transition-all duration-500 cursor-pointer group animate-in fade-in delay-${index * 150}`}
            >
              <CardHeader className="text-center">
                <div className="relative mx-auto mb-4">
                  <div className="relative overflow-hidden rounded-full">
                    <Image
                      src={driver.imageUrl || "/placeholder.svg"}
                      alt={driver.name}
                      width={120}
                      height={120}
                      className="rounded-full border-4 border-gray-600 group-hover:scale-110 transition-transform duration-500"
                    />
                  </div>
                  <Badge 
                    className="absolute -top-2 -right-2 bg-yellow-600 text-white hover:scale-110 transition-transform animate-pulse"
                  >
                    #{driver.position}
                  </Badge>
                </div>
                <CardTitle className="text-white text-xl group-hover:text-yellow-400 transition-colors duration-300">{driver.name}</CardTitle>
                <p className="text-gray-400 group-hover:text-gray-300 transition-colors duration-300">{driver.team}</p>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Flag className="w-4 h-4 text-gray-400 group-hover:text-blue-400 transition-colors duration-300" />
                      <span className="text-gray-300 text-sm">{driver.nationality}</span>
                    </div>
                    <span className="text-gray-300 text-sm">Age {driver.age}</span>
                  </div>

                  <div className="grid grid-cols-2 gap-4 text-center">
                    <div className="hover:scale-110 transition-transform duration-300">
                      <div className="text-2xl font-bold text-yellow-500">{driver.championships}</div>
                      <div className="text-xs text-gray-400">Championships</div>
                    </div>
                    <div className="hover:scale-110 transition-transform duration-300">
                      <div className="text-2xl font-bold text-green-500">{driver.raceWins}</div>
                      <div className="text-xs text-gray-400">Race Wins</div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4 text-center">
                    <div className="hover:scale-110 transition-transform duration-300">
                      <div className="text-lg font-bold text-blue-400">{driver.podiums}</div>
                      <div className="text-xs text-gray-400">Podiums</div>
                    </div>
                    <div className="hover:scale-110 transition-transform duration-300">
                      <div className="text-lg font-bold text-red-400">{driver.points2024}</div>
                      <div className="text-xs text-gray-400">2024 Points</div>
                    </div>
                  </div>

                  <Button className="w-full mt-4 bg-gray-700 hover:bg-gray-600 text-white hover:scale-105 transition-all duration-300 group-hover:shadow-lg">
                    View Profile
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Load More */}
        <div className="text-center mt-12">
          <Button variant="outline" className="border-gray-600 text-gray-300 hover:bg-gray-800">
            Load More Drivers
          </Button>
        </div>
      </div>
    </div>
  )
}


