'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Trophy, TrendingUp, TrendingDown, Minus } from 'lucide-react'
import Link from 'next/link'

interface Driver {
  position: number
  name: string
  team: string
  points: number
  change: number
  nationality: string
}

export function StandingsWidget() {
  // Mock data - in real app, fetch from Ergast API
  const drivers: Driver[] = [
    { position: 1, name: "Max Verstappen", team: "Red Bull Racing", points: 575, change: 0, nationality: "NED" },
    { position: 2, name: "Sergio Perez", team: "Red Bull Racing", points: 285, change: 0, nationality: "MEX" },
    { position: 3, name: "Lewis Hamilton", team: "Mercedes", points: 234, change: 1, nationality: "GBR" },
    { position: 4, name: "Fernando Alonso", team: "Aston Martin", points: 206, change: -1, nationality: "ESP" },
    { position: 5, name: "Carlos Sainz", team: "Ferrari", points: 200, change: 0, nationality: "ESP" },
    { position: 6, name: "George Russell", team: "Mercedes", points: 175, change: 2, nationality: "GBR" },
    { position: 7, name: "Charles Leclerc", team: "Ferrari", points: 165, change: -1, nationality: "MON" },
    { position: 8, name: "Lando Norris", team: "McLaren", points: 115, change: 1, nationality: "GBR" }
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
    <Card className="bg-gray-800 border-gray-700">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-white flex items-center gap-2">
            <Trophy className="w-5 h-5 text-yellow-500" />
            Driver Standings 2024
          </CardTitle>
          <Link href="/standings">
            <Button variant="outline" size="sm">
              View All
            </Button>
          </Link>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {drivers.map((driver, index) => (
            <div 
              key={driver.position} 
              className={`flex items-center gap-3 p-3 rounded-lg bg-gray-700/50 hover:bg-gray-700 hover:scale-[1.02] transition-all duration-300 cursor-pointer animate-in slide-in-from-left delay-${index * 100}`}
            >
              <div className="flex items-center gap-3 flex-1">
                <div className="text-lg font-bold text-white w-6 hover:scale-110 transition-transform">
                  {driver.position}
                </div>
                <div className={`w-1 h-8 rounded ${getTeamColor(driver.team)} hover:w-2 transition-all duration-300`} />
                <div className="flex-1">
                  <div className="font-semibold text-white">{driver.name}</div>
                  <div className="text-sm text-gray-400">{driver.team}</div>
                </div>
                <Badge variant="secondary" className="bg-gray-600 text-white hover:scale-105 transition-transform">
                  {driver.nationality}
                </Badge>
                <div className="text-right">
                  <div className="font-bold text-white">{driver.points}</div>
                  <div className="text-sm text-gray-400">pts</div>
                </div>
                <div className="hover:scale-125 transition-transform">
                  {getChangeIcon(driver.change)}
                </div>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
