'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Trophy, TrendingUp, TrendingDown, Minus, Loader2 } from 'lucide-react'
import Link from 'next/link'
import { useDriverStandings } from '@/hooks/use-driver-standings'
import { DriverAvatar } from '@/components/ui/driver-avatar'

export function StandingsWidget() {
  const currentYear = new Date().getFullYear()
  const { data: drivers, loading, error, getTopDrivers } = useDriverStandings(currentYear)
  
  // Get top 8 drivers for display
  const topDrivers = getTopDrivers(8)

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
      "McLaren": "bg-orange-500",
      "Alpine": "bg-pink-500",
      "Williams": "bg-blue-400",
      "AlphaTauri": "bg-indigo-600",
      "Alfa Romeo": "bg-red-800",
      "Haas": "bg-gray-500",
      "Sauber": "bg-green-500",
      "RB": "bg-blue-500" // RB team (formerly AlphaTauri)
    }
    return colors[team] || "bg-gray-600"
  }

  if (loading) {
    return (
      <Card className="bg-gray-800 border-gray-700">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-white flex items-center gap-2">
              <Trophy className="w-5 h-5 text-yellow-500" />
              Driver Standings {currentYear}
            </CardTitle>
            <Link href="/standings">
              <Button variant="outline" size="sm">
                View All
              </Button>
            </Link>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-8">
            <div className="flex items-center gap-3">
              <Loader2 className="w-5 h-5 animate-spin text-yellow-500" />
              <span className="text-gray-400">Loading standings...</span>
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
            <Trophy className="w-5 h-5 text-yellow-500" />
            Driver Standings {currentYear}
            {error && <Badge variant="destructive" className="ml-2 text-xs">API Error</Badge>}
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
          {topDrivers.map((driver, index) => (
            <div 
              key={driver.position} 
              className={`flex items-center gap-3 p-3 rounded-lg bg-gray-700/50 hover:bg-gray-700 hover:scale-[1.02] transition-all duration-300 cursor-pointer animate-in slide-in-from-left delay-${index * 100}`}
            >
              <div className="flex items-center gap-3 flex-1">
                <div className="text-lg font-bold text-white w-6 hover:scale-110 transition-transform">
                  {driver.position}
                </div>
                <div className={`w-1 h-8 rounded ${getTeamColor(driver.team)} hover:w-2 transition-all duration-300`} />
                
                {/* Driver Avatar */}
                <DriverAvatar driverName={driver.name} size="md" />
                
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
