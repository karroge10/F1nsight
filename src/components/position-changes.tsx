'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
// import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { TrendingUp, TrendingDown, BarChart3, Play, Pause } from 'lucide-react'

interface PositionData {
  lap: number
  driver: string
  position: number
  team: string
  gap?: number
}

interface RaceData {
  year: number
  round: number
  race_name: string
  total_laps: number
  position_data: PositionData[]
}

export function PositionChanges() {
  const [raceData, setRaceData] = useState<RaceData | null>(null)
  const [selectedLap, setSelectedLap] = useState(1)
  const [isPlaying, setIsPlaying] = useState(false)
  const [loading, setLoading] = useState(true)

  // Mock data for position changes
  useEffect(() => {
    const mockData: RaceData = {
      year: 2024,
      round: 20,
      race_name: "São Paulo Grand Prix",
      total_laps: 71,
      position_data: generateMockPositionData()
    }

    setTimeout(() => {
      setRaceData(mockData)
      setLoading(false)
    }, 1000)
  }, [])

  // Auto-play functionality
  useEffect(() => {
    if (!isPlaying || !raceData) return

    const interval = setInterval(() => {
      setSelectedLap(prev => {
        if (prev >= raceData.total_laps) {
          setIsPlaying(false)
          return 1
        }
        return prev + 1
      })
    }, 200) // 200ms per lap

    return () => clearInterval(interval)
  }, [isPlaying, raceData])

  function generateMockPositionData(): PositionData[] {
    const drivers = [
      { name: "Max Verstappen", team: "Red Bull Racing" },
      { name: "Lando Norris", team: "McLaren" },
      { name: "Charles Leclerc", team: "Ferrari" },
      { name: "Oscar Piastri", team: "McLaren" },
      { name: "Carlos Sainz", team: "Ferrari" },
      { name: "George Russell", team: "Mercedes" },
      { name: "Lewis Hamilton", team: "Mercedes" },
      { name: "Sergio Perez", team: "Red Bull Racing" },
      { name: "Fernando Alonso", team: "Aston Martin" },
      { name: "Lance Stroll", team: "Aston Martin" }
    ]

    const data: PositionData[] = []
    
    // Generate position data for each lap
    for (let lap = 1; lap <= 71; lap++) {
      // Start with grid positions, then add some realistic changes
      let positions = drivers.map((driver, index) => ({
        lap,
        driver: driver.name,
        team: driver.team,
        position: index + 1
      }))

      // Add some position changes based on lap
      if (lap > 1) {
        // Simulate overtakes and strategy changes
        if (lap === 15) {
          // Pit stops shuffle
          positions = shufflePositions(positions, [0, 2, 4])
        } else if (lap === 30) {
          // More pit stops
          positions = shufflePositions(positions, [1, 3, 5, 7])
        } else if (lap === 45) {
          // Final pit stops
          positions = shufflePositions(positions, [0, 1, 6, 8])
        } else if (lap > 60) {
          // Late race battles
          positions = addRandomOvertakes(positions, 0.1)
        }
      }

      data.push(...positions)
    }

    return data
  }

  function shufflePositions(positions: PositionData[], indices: number[]) {
    const shuffled = [...positions]
    indices.forEach(i => {
      if (i < shuffled.length - 1) {
        // Swap with next position
        const temp = shuffled[i].position
        shuffled[i].position = shuffled[i + 1].position
        shuffled[i + 1].position = temp
      }
    })
    return shuffled.sort((a, b) => a.position - b.position)
  }

  function addRandomOvertakes(positions: PositionData[], probability: number) {
    const shuffled = [...positions]
    for (let i = 0; i < shuffled.length - 1; i++) {
      if (Math.random() < probability) {
        const temp = shuffled[i].position
        shuffled[i].position = shuffled[i + 1].position
        shuffled[i + 1].position = temp
      }
    }
    return shuffled.sort((a, b) => a.position - b.position)
  }

  const getTeamColor = (team: string) => {
    switch (team) {
      case 'Red Bull Racing': return 'bg-blue-500'
      case 'McLaren': return 'bg-orange-500'
      case 'Ferrari': return 'bg-red-500'
      case 'Mercedes': return 'bg-cyan-400'
      case 'Aston Martin': return 'bg-green-600'
      default: return 'bg-gray-500'
    }
  }

  const getPositionChange = (driver: string, currentLap: number) => {
    if (!raceData || currentLap <= 1) return { change: 0, icon: null }

    const current = raceData.position_data.find(d => d.driver === driver && d.lap === currentLap)
    const previous = raceData.position_data.find(d => d.driver === driver && d.lap === currentLap - 1)

    if (!current || !previous) return { change: 0, icon: null }

    const change = previous.position - current.position

    if (change > 0) return { change, icon: <TrendingUp className="w-3 h-3 text-green-500" /> }
    if (change < 0) return { change, icon: <TrendingDown className="w-3 h-3 text-red-500" /> }
    return { change: 0, icon: null }
  }

  if (loading) {
    return (
      <Card className="bg-gray-800 border-gray-700">
        <CardHeader>
          <div className="flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-blue-500 animate-pulse" />
            <CardTitle className="text-white">Loading Position Changes...</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <div className="h-96 bg-gray-700 rounded-lg animate-pulse"></div>
        </CardContent>
      </Card>
    )
  }

  if (!raceData) return null

  const currentLapData = raceData.position_data
    .filter(d => d.lap === selectedLap)
    .sort((a, b) => a.position - b.position)

  return (
    <Card className="bg-gray-800 border-gray-700">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-blue-500" />
            <CardTitle className="text-white">Position Changes - {raceData.race_name}</CardTitle>
          </div>
          <Badge className="bg-blue-600 text-white">
            {raceData.year}
          </Badge>
        </div>
        
        <div className="flex items-center gap-4 mt-4">
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              onClick={() => setIsPlaying(!isPlaying)}
              className="bg-red-600 hover:bg-red-700"
            >
              {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
              {isPlaying ? 'Pause' : 'Play'}
            </Button>
            
            <select
              value={selectedLap.toString()}
              onChange={(e) => {
                setSelectedLap(parseInt(e.target.value))
                setIsPlaying(false)
              }}
              className="w-32 bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
            >
              {Array.from({ length: raceData.total_laps }, (_, i) => i + 1).map(lap => (
                <option key={lap} value={lap.toString()}>
                  Lap {lap}
                </option>
              ))}
            </select>
          </div>
          
          <div className="text-sm text-gray-400">
            Lap {selectedLap} of {raceData.total_laps}
          </div>
        </div>

        {/* Progress Bar */}
        <div className="mt-3 w-full bg-gray-700 rounded-full h-2">
          <div 
            className="bg-red-500 h-2 rounded-full transition-all duration-200"
            style={{ width: `${(selectedLap / raceData.total_laps) * 100}%` }}
          />
        </div>
      </CardHeader>
      
      <CardContent>
        <div className="space-y-2">
          {currentLapData.map((data, index) => {
            const positionChange = getPositionChange(data.driver, selectedLap)
            return (
              <div 
                key={data.driver}
                className="flex items-center gap-3 p-3 rounded-lg bg-gray-700/50 hover:bg-gray-700 transition-all duration-300"
              >
                {/* Position */}
                <div className="w-8 h-8 rounded-full bg-gray-600 flex items-center justify-center text-white font-bold text-sm">
                  {data.position}
                </div>
                
                {/* Team Color Strip */}
                <div className={`w-1 h-8 rounded ${getTeamColor(data.team)}`} />
                
                {/* Driver Info */}
                <div className="flex-1">
                  <div className="font-semibold text-white">{data.driver}</div>
                  <div className="text-sm text-gray-400">{data.team}</div>
                </div>
                
                {/* Position Change */}
                <div className="flex items-center gap-2">
                  {positionChange.icon}
                  {positionChange.change !== 0 && (
                    <span className={`text-sm font-semibold ${
                      positionChange.change > 0 ? 'text-green-500' : 'text-red-500'
                    }`}>
                      {positionChange.change > 0 ? '+' : ''}{positionChange.change}
                    </span>
                  )}
                </div>
                
                {/* Gap */}
                {index > 0 && (
                  <div className="text-sm text-gray-400 min-w-[60px] text-right">
                    +{(Math.random() * 30).toFixed(1)}s
                  </div>
                )}
              </div>
            )
          })}
        </div>
        
        <div className="mt-6 p-4 bg-gray-700/30 rounded-lg">
          <div className="text-sm text-gray-300">
            <strong>How to use:</strong> Use the play button to watch position changes throughout the race, 
            or select a specific lap to see the running order at that point.
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
