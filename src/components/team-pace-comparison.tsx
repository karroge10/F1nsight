'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { BarChart3, Clock, Trophy, TrendingUp, TrendingDown } from 'lucide-react'

interface TeamPaceData {
  team: string
  qualifying_pace: number // seconds
  race_pace: number // seconds
  pace_difference: number
  color: string
  drivers: string[]
}

interface PaceComparison {
  year: number
  round: number
  race_name: string
  teams: TeamPaceData[]
}

export function TeamPaceComparison() {
  const [paceData, setPaceData] = useState<PaceComparison | null>(null)
  const [viewMode, setViewMode] = useState<'qualifying' | 'race'>('race')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Mock team pace data
    const mockData: PaceComparison = {
      year: 2024,
      round: 20,
      race_name: "São Paulo Grand Prix",
      teams: [
        {
          team: "Red Bull Racing",
          qualifying_pace: 70.540,
          race_pace: 72.150,
          pace_difference: 1.610,
          color: "#3B82F6",
          drivers: ["Max Verstappen", "Sergio Perez"]
        },
        {
          team: "McLaren",
          qualifying_pace: 70.890,
          race_pace: 72.380,
          pace_difference: 1.490,
          color: "#F97316",
          drivers: ["Lando Norris", "Oscar Piastri"]
        },
        {
          team: "Ferrari",
          qualifying_pace: 71.120,
          race_pace: 72.620,
          pace_difference: 1.500,
          color: "#EF4444",
          drivers: ["Charles Leclerc", "Carlos Sainz"]
        },
        {
          team: "Mercedes",
          qualifying_pace: 71.340,
          race_pace: 72.890,
          pace_difference: 1.550,
          color: "#06B6D4",
          drivers: ["Lewis Hamilton", "George Russell"]
        },
        {
          team: "Aston Martin",
          qualifying_pace: 71.680,
          race_pace: 73.120,
          pace_difference: 1.440,
          color: "#16A34A",
          drivers: ["Fernando Alonso", "Lance Stroll"]
        }
      ]
    }

    setTimeout(() => {
      setPaceData(mockData)
      setLoading(false)
    }, 1000)
  }, [])

  if (loading) {
    return (
      <Card className="bg-gray-800 border-gray-700">
        <CardHeader>
          <div className="flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-purple-500 animate-pulse" />
            <CardTitle className="text-white">Loading Team Pace Data...</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <div className="h-96 bg-gray-700 rounded-lg animate-pulse"></div>
        </CardContent>
      </Card>
    )
  }

  if (!paceData) return null

  const sortedTeams = [...paceData.teams].sort((a, b) => {
    const timeA = viewMode === 'qualifying' ? a.qualifying_pace : a.race_pace
    const timeB = viewMode === 'qualifying' ? b.qualifying_pace : b.race_pace
    return timeA - timeB
  })

  const fastestTime = Math.min(...sortedTeams.map(t => 
    viewMode === 'qualifying' ? t.qualifying_pace : t.race_pace
  ))

  const formatTime = (seconds: number) => {
    const minutes = Math.floor(seconds / 60)
    const secs = (seconds % 60).toFixed(3)
    return `${minutes}:${secs.padStart(6, '0')}`
  }

  const formatGap = (time: number, fastest: number) => {
    const gap = time - fastest
    return gap === 0 ? '---' : `+${gap.toFixed(3)}s`
  }

  return (
    <Card className="bg-gray-800 border-gray-700">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-purple-500" />
            <CardTitle className="text-white">Team Pace Comparison - {paceData.race_name}</CardTitle>
          </div>
          <Badge className="bg-purple-600 text-white">
            {paceData.year}
          </Badge>
        </div>
        
        <div className="flex items-center gap-4 mt-4">
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant={viewMode === 'qualifying' ? 'default' : 'outline'}
              onClick={() => setViewMode('qualifying')}
              className={viewMode === 'qualifying' ? 'bg-yellow-600 hover:bg-yellow-700' : 'border-gray-600 text-gray-300 hover:bg-gray-700'}
            >
              <Trophy className="w-4 h-4 mr-1" />
              Qualifying
            </Button>
            
            <Button
              size="sm"
              variant={viewMode === 'race' ? 'default' : 'outline'}
              onClick={() => setViewMode('race')}
              className={viewMode === 'race' ? 'bg-red-600 hover:bg-red-700' : 'border-gray-600 text-gray-300 hover:bg-gray-700'}
            >
              <Clock className="w-4 h-4 mr-1" />
              Race
            </Button>
          </div>
          
          <div className="text-sm text-gray-400">
            {viewMode === 'qualifying' ? 'Best qualifying lap times' : 'Average race pace (excluding first/last 10 laps)'}
          </div>
        </div>
      </CardHeader>
      
      <CardContent>
        <div className="space-y-3">
          {sortedTeams.map((team, index) => {
            const time = viewMode === 'qualifying' ? team.qualifying_pace : team.race_pace
            const gap = formatGap(time, fastestTime)
            const isFirst = index === 0
            
            return (
              <div 
                key={team.team}
                className={`p-4 rounded-lg border-l-4 transition-all duration-300 hover:scale-[1.02] ${
                  isFirst ? 'bg-yellow-500/10 border-l-yellow-500' : 'bg-gray-700/50 border-l-gray-600'
                }`}
                style={{ borderLeftColor: team.color }}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="text-lg font-bold text-white w-6">
                      {index + 1}
                    </div>
                    
                    <div className="w-1 h-12 rounded" style={{ backgroundColor: team.color }} />
                    
                    <div>
                      <div className="font-semibold text-white text-lg">{team.team}</div>
                      <div className="text-sm text-gray-400">
                        {team.drivers.join(' • ')}
                      </div>
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-6">
                    <div className="text-center">
                      <div className={`text-xl font-bold ${isFirst ? 'text-yellow-500' : 'text-white'}`}>
                        {formatTime(time)}
                      </div>
                      <div className="text-xs text-gray-400">
                        {viewMode === 'qualifying' ? 'Best Lap' : 'Avg Pace'}
                      </div>
                    </div>
                    
                    <div className="text-center min-w-[80px]">
                      <div className={`text-lg font-bold ${isFirst ? 'text-yellow-500' : 'text-red-400'}`}>
                        {gap}
                      </div>
                      <div className="text-xs text-gray-400">Gap</div>
                    </div>
                    
                    {viewMode === 'race' && (
                      <div className="text-center">
                        <div className="flex items-center gap-1">
                          {team.pace_difference > 1.5 ? (
                            <TrendingDown className="w-4 h-4 text-red-500" />
                          ) : (
                            <TrendingUp className="w-4 h-4 text-green-500" />
                          )}
                          <span className="text-sm font-semibold text-white">
                            +{team.pace_difference.toFixed(3)}s
                          </span>
                        </div>
                        <div className="text-xs text-gray-400">Q → Race</div>
                      </div>
                    )}
                  </div>
                </div>
                
                {isFirst && (
                  <div className="mt-3 p-2 bg-yellow-500/10 rounded border border-yellow-500/20">
                    <div className="text-xs text-yellow-400">
                      🏆 Fastest {viewMode === 'qualifying' ? 'qualifying' : 'race'} pace
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
        
        {/* Pace Analysis */}
        <div className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="p-4 bg-gray-700/30 rounded-lg text-center">
            <div className="text-2xl font-bold text-green-500">
              {formatGap(sortedTeams[sortedTeams.length - 1][viewMode === 'qualifying' ? 'qualifying_pace' : 'race_pace'], fastestTime)}
            </div>
            <div className="text-sm text-gray-400">Slowest Gap</div>
          </div>
          
          <div className="p-4 bg-gray-700/30 rounded-lg text-center">
            <div className="text-2xl font-bold text-blue-500">
              {((sortedTeams[sortedTeams.length - 1][viewMode === 'qualifying' ? 'qualifying_pace' : 'race_pace'] - fastestTime) / fastestTime * 100).toFixed(2)}%
            </div>
            <div className="text-sm text-gray-400">Performance Spread</div>
          </div>
          
          <div className="p-4 bg-gray-700/30 rounded-lg text-center">
            <div className="text-2xl font-bold text-purple-500">
              {paceData.teams.length}
            </div>
            <div className="text-sm text-gray-400">Teams Analyzed</div>
          </div>
        </div>
        
        <div className="mt-6 p-4 bg-gray-700/30 rounded-lg">
          <div className="text-sm text-gray-300">
            <div className="flex items-center gap-2 mb-2">
              <BarChart3 className="w-4 h-4 text-purple-500" />
              <strong>Pace Analysis:</strong>
            </div>
            <ul className="space-y-1 text-xs">
              <li>• <strong>Qualifying:</strong> Best lap time achieved during Q3</li>
              <li>• <strong>Race:</strong> Average pace excluding first/last 10 laps (removes fuel/traffic effects)</li>
              <li>• <strong>Q → Race:</strong> Shows how much pace teams lose from qualifying to race conditions</li>
              <li>• Teams with smaller Q→Race gaps typically have better race setup and tyre management</li>
            </ul>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
