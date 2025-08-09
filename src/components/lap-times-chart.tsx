'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
// import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ScatterChart, Filter, Zap } from 'lucide-react'

interface LapTimeData {
  driver: string
  team: string
  lap_number: number
  lap_time: number // in seconds
  compound: string
  tyre_life: number
  sector1?: number
  sector2?: number
  sector3?: number
}

interface ChartData {
  year: number
  round: number
  race_name: string
  lap_times: LapTimeData[]
}

export function LapTimesChart() {
  const [chartData, setChartData] = useState<ChartData | null>(null)
  const [selectedDriver, setSelectedDriver] = useState<string>('all')
  const [selectedCompound, setSelectedCompound] = useState<string>('all')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Mock data for lap times
    const mockData: ChartData = {
      year: 2024,
      round: 20,
      race_name: "São Paulo Grand Prix",
      lap_times: generateMockLapTimes()
    }

    setTimeout(() => {
      setChartData(mockData)
      setLoading(false)
    }, 1000)
  }, [])

  function generateMockLapTimes(): LapTimeData[] {
    const drivers = [
      { name: "Max Verstappen", team: "Red Bull Racing", baseTime: 72.5 },
      { name: "Lando Norris", team: "McLaren", baseTime: 73.0 },
      { name: "Charles Leclerc", team: "Ferrari", baseTime: 73.2 },
      { name: "Oscar Piastri", team: "McLaren", baseTime: 73.1 },
      { name: "Carlos Sainz", team: "Ferrari", baseTime: 73.3 },
      { name: "George Russell", team: "Mercedes", baseTime: 73.4 },
      { name: "Lewis Hamilton", team: "Mercedes", baseTime: 73.5 },
      { name: "Sergio Perez", team: "Red Bull Racing", baseTime: 73.8 }
    ]

    const compounds = ['SOFT', 'MEDIUM', 'HARD']
    const data: LapTimeData[] = []

    drivers.forEach(driver => {
      // Generate lap times for each driver
      for (let lap = 1; lap <= 71; lap++) {
        let compound = 'MEDIUM'
        let tyreLife = lap

        // Simulate pit stops and compound changes
        if (lap <= 15) {
          compound = 'SOFT'
          tyreLife = lap
        } else if (lap <= 35) {
          compound = 'MEDIUM'
          tyreLife = lap - 15
        } else if (lap <= 55) {
          compound = 'HARD'
          tyreLife = lap - 35
        } else {
          compound = 'SOFT'
          tyreLife = lap - 55
        }

        // Calculate lap time with realistic variations
        let lapTime = driver.baseTime
        
        // Tyre degradation
        lapTime += (tyreLife * 0.02)
        
        // Compound differences
        if (compound === 'SOFT') lapTime -= 0.8
        if (compound === 'HARD') lapTime += 0.5
        
        // Add some randomness and traffic
        lapTime += (Math.random() - 0.5) * 2
        
        // Fuel effect (lighter as race progresses)
        lapTime -= (lap / 71) * 0.3
        
        // Outliers for incidents/safety cars
        if (Math.random() < 0.05) {
          lapTime += Math.random() * 10 // Yellow flags, incidents
        }

        data.push({
          driver: driver.name,
          team: driver.team,
          lap_number: lap,
          lap_time: Math.max(lapTime, 65), // Minimum reasonable lap time
          compound,
          tyre_life: tyreLife
        })
      }
    })

    return data
  }

  const getTeamColor = (team: string) => {
    switch (team) {
      case 'Red Bull Racing': return '#3B82F6' // blue-500
      case 'McLaren': return '#F97316' // orange-500
      case 'Ferrari': return '#EF4444' // red-500
      case 'Mercedes': return '#06B6D4' // cyan-500
      default: return '#6B7280' // gray-500
    }
  }

  const getCompoundColor = (compound: string) => {
    switch (compound) {
      case 'SOFT': return '#EF4444' // red
      case 'MEDIUM': return '#EAB308' // yellow
      case 'HARD': return '#F8F8F8' // white
      default: return '#6B7280'
    }
  }

  if (loading) {
    return (
      <Card className="bg-gray-800 border-gray-700">
        <CardHeader>
          <div className="flex items-center gap-2">
            <ScatterChart className="w-5 h-5 text-green-500 animate-pulse" />
            <CardTitle className="text-white">Loading Lap Times...</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <div className="h-96 bg-gray-700 rounded-lg animate-pulse"></div>
        </CardContent>
      </Card>
    )
  }

  if (!chartData) return null

  const drivers = [...new Set(chartData.lap_times.map(d => d.driver))].sort()
  const compounds = [...new Set(chartData.lap_times.map(d => d.compound))].sort()

  // Filter data based on selections
  let filteredData = chartData.lap_times
  if (selectedDriver !== 'all') {
    filteredData = filteredData.filter(d => d.driver === selectedDriver)
  }
  if (selectedCompound !== 'all') {
    filteredData = filteredData.filter(d => d.compound === selectedCompound)
  }

  // Calculate chart dimensions and scales
  const chartWidth = 800
  const chartHeight = 400
  const margin = { top: 20, right: 20, bottom: 60, left: 80 }
  const plotWidth = chartWidth - margin.left - margin.right
  const plotHeight = chartHeight - margin.top - margin.bottom

  const minLapTime = Math.min(...filteredData.map(d => d.lap_time))
  const maxLapTime = Math.max(...filteredData.map(d => d.lap_time))
  const maxLap = Math.max(...filteredData.map(d => d.lap_number))

  // Create data points for visualization
  const dataPoints = filteredData.map(d => ({
    x: (d.lap_number / maxLap) * plotWidth,
    y: plotHeight - ((d.lap_time - minLapTime) / (maxLapTime - minLapTime)) * plotHeight,
    ...d
  }))

  return (
    <Card className="bg-gray-800 border-gray-700">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ScatterChart className="w-5 h-5 text-green-500" />
            <CardTitle className="text-white">Lap Times Analysis - {chartData.race_name}</CardTitle>
          </div>
          <Badge className="bg-green-600 text-white">
            {chartData.year}
          </Badge>
        </div>
        
        <div className="flex items-center gap-4 mt-4">
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-gray-400" />
            <span className="text-sm text-gray-400">Filters:</span>
          </div>
          
          <select 
            value={selectedDriver} 
            onChange={(e) => setSelectedDriver(e.target.value)}
            className="w-40 bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
          >
            <option value="all">All Drivers</option>
            {drivers.map(driver => (
              <option key={driver} value={driver}>
                {driver.split(' ').pop()} {/* Last name only */}
              </option>
            ))}
          </select>
          
          <select 
            value={selectedCompound} 
            onChange={(e) => setSelectedCompound(e.target.value)}
            className="w-32 bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
          >
            <option value="all">All Compounds</option>
            {compounds.map(compound => (
              <option key={compound} value={compound}>
                {compound}
              </option>
            ))}
          </select>
        </div>
      </CardHeader>
      
      <CardContent>
        <div className="mb-4">
          <svg width={chartWidth} height={chartHeight} className="border border-gray-600 rounded bg-gray-900">
            {/* Grid lines */}
            <defs>
              <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
                <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#374151" strokeWidth="1"/>
              </pattern>
            </defs>
            <rect width={plotWidth} height={plotHeight} x={margin.left} y={margin.top} fill="url(#grid)" />
            
            {/* Y-axis labels */}
            {[0, 0.25, 0.5, 0.75, 1].map(ratio => {
              const y = margin.top + plotHeight - (ratio * plotHeight)
              const lapTime = minLapTime + (ratio * (maxLapTime - minLapTime))
              return (
                <g key={ratio}>
                  <line x1={margin.left} y1={y} x2={margin.left + plotWidth} y2={y} stroke="#4B5563" strokeWidth="1" />
                  <text x={margin.left - 10} y={y + 4} fill="#9CA3AF" fontSize="12" textAnchor="end">
                    {lapTime.toFixed(1)}s
                  </text>
                </g>
              )
            })}
            
            {/* X-axis labels */}
            {[0, 0.25, 0.5, 0.75, 1].map(ratio => {
              const x = margin.left + (ratio * plotWidth)
              const lap = Math.round(ratio * maxLap)
              return (
                <g key={ratio}>
                  <line x1={x} y1={margin.top} x2={x} y2={margin.top + plotHeight} stroke="#4B5563" strokeWidth="1" />
                  <text x={x} y={margin.top + plotHeight + 20} fill="#9CA3AF" fontSize="12" textAnchor="middle">
                    {lap}
                  </text>
                </g>
              )
            })}
            
            {/* Data points */}
            {dataPoints.map((point, index) => (
              <circle
                key={index}
                cx={margin.left + point.x}
                cy={margin.top + point.y}
                r="3"
                fill={selectedDriver === 'all' ? getTeamColor(point.team) : getCompoundColor(point.compound)}
                opacity="0.7"
                className="hover:opacity-1 hover:r-4 transition-all"
              >
                <title>
                  {point.driver} - Lap {point.lap_number}: {point.lap_time.toFixed(3)}s ({point.compound})
                </title>
              </circle>
            ))}
            
            {/* Axis labels */}
            <text x={chartWidth / 2} y={chartHeight - 10} fill="#9CA3AF" fontSize="14" textAnchor="middle">
              Lap Number
            </text>
            <text x={20} y={chartHeight / 2} fill="#9CA3AF" fontSize="14" textAnchor="middle" transform={`rotate(-90 20 ${chartHeight / 2})`}>
              Lap Time (seconds)
            </text>
          </svg>
        </div>
        
        {/* Legend */}
        <div className="flex flex-wrap gap-4 mt-4">
          {selectedDriver === 'all' ? (
            // Show team colors when all drivers selected
            [...new Set(filteredData.map(d => d.team))].map(team => (
              <div key={team} className="flex items-center gap-2">
                <div 
                  className="w-3 h-3 rounded-full" 
                  style={{ backgroundColor: getTeamColor(team) }}
                />
                <span className="text-sm text-gray-300">{team}</span>
              </div>
            ))
          ) : (
            // Show compound colors when single driver selected
            compounds.map(compound => (
              <div key={compound} className="flex items-center gap-2">
                <div 
                  className="w-3 h-3 rounded-full" 
                  style={{ backgroundColor: getCompoundColor(compound) }}
                />
                <span className="text-sm text-gray-300">{compound}</span>
              </div>
            ))
          )}
        </div>
        
        <div className="mt-6 p-4 bg-gray-700/30 rounded-lg">
          <div className="text-sm text-gray-300">
            <div className="flex items-center gap-2 mb-2">
              <Zap className="w-4 h-4 text-yellow-500" />
              <strong>Analysis Tips:</strong>
            </div>
            <ul className="space-y-1 text-xs">
              <li>• Hover over points to see detailed lap information</li>
              <li>• Filter by driver to see tyre compound performance</li>
              <li>• Look for outliers that might indicate incidents or safety cars</li>
              <li>• Notice how lap times improve as fuel load decreases throughout the race</li>
            </ul>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
