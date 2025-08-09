'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Trophy, TrendingUp, TrendingDown, Minus, Calculator } from 'lucide-react'
import { getWDCCalculator, checkFastF1Health, type WDCCalculatorData } from '@/lib/fastf1-api'
import { DriverAvatar } from '@/components/ui/driver-avatar'

export function WDCCalculator() {
  const [wdcData, setWdcData] = useState<WDCCalculatorData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function loadData() {
      setLoading(true)
      setError(null)
      
      try {
        const apiAvailable = await checkFastF1Health()
        
        if (!apiAvailable) {
          throw new Error('FastF1 API is not available')
        }
        
        const data = await getWDCCalculator(2025)
        setWdcData(data)
      } catch (error) {
        console.error('Failed to fetch from FastF1 API:', error)
        setError(error instanceof Error ? error.message : 'Unknown error occurred')
        setWdcData(null)
      }
      
      setLoading(false)
    }
    
    loadData()
  }, [])



  const getTeamColor = (team: string) => {
    switch (team) {
      case 'Red Bull Racing': return 'border-l-blue-500 bg-blue-500/5'
      case 'McLaren': return 'border-l-orange-500 bg-orange-500/5'
      case 'Ferrari': return 'border-l-red-500 bg-red-500/5'
      case 'Mercedes': return 'border-l-cyan-400 bg-cyan-400/5'
      case 'Aston Martin': return 'border-l-green-600 bg-green-600/5'
      default: return 'border-l-gray-500 bg-gray-500/5'
    }
  }

  const getChanceIcon = (chance: number) => {
    if (chance > 50) return <TrendingUp className="w-4 h-4 text-green-500" />
    if (chance > 0) return <Minus className="w-4 h-4 text-yellow-500" />
    return <TrendingDown className="w-4 h-4 text-red-500" />
  }

  if (loading) {
    return (
      <Card className="bg-gray-800 border-gray-700">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Calculator className="w-5 h-5 text-yellow-500 animate-spin" />
            <CardTitle className="text-white">Calculating WDC Possibilities...</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {[...Array(7)].map((_, i) => (
              <div key={i} className="animate-pulse">
                <div className="h-16 bg-gray-700 rounded-lg"></div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    )
  }

  if (error) {
    return (
      <Card className="bg-gray-800 border-gray-700">
        <CardHeader>
          <div className="flex items-center gap-2">
            <TrendingDown className="w-5 h-5 text-red-500" />
            <CardTitle className="text-white">WDC Calculator Unavailable</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8">
            <p className="text-gray-400 mb-4">Unable to load championship data</p>
            <p className="text-sm text-gray-500">{error}</p>
            <Button 
              onClick={() => window.location.reload()} 
              className="mt-4 bg-blue-600 hover:bg-blue-700"
            >
              Retry
            </Button>
          </div>
        </CardContent>
      </Card>
    )
  }

  if (!wdcData) return null

  const stillInContention = wdcData.drivers.filter(d => d.can_win)
  const mathematicallyOut = wdcData.drivers.filter(d => !d.can_win)

  return (
    <Card className="bg-gray-800 border-gray-700">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Trophy className="w-5 h-5 text-yellow-500" />
            <CardTitle className="text-white">Who Can Still Win the {wdcData.year} WDC?</CardTitle>
          </div>
          <div className="flex items-center gap-2">
            <Badge className="bg-green-600 text-white">
              Live Data via FastF1
            </Badge>
            <Badge className="bg-blue-600 text-white">
              {wdcData.races_remaining} races left
            </Badge>
          </div>
        </div>
        <p className="text-gray-400 text-sm">
          Mathematical analysis based on maximum possible points remaining
        </p>
      </CardHeader>
      
      <CardContent>
        <div className="space-y-6">
          {/* Championship Leader */}
          <div className="p-4 rounded-lg bg-gradient-to-r from-yellow-500/10 to-yellow-600/10 border border-yellow-500/20">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Trophy className="w-6 h-6 text-yellow-500" />
                <div>
                  <div className="font-bold text-white text-lg">{wdcData.championship_leader}</div>
                  <div className="text-sm text-gray-400">Championship Leader</div>
                </div>
              </div>
              <div className="text-right">
                <div className="text-2xl font-bold text-yellow-500">{wdcData.leader_points}</div>
                <div className="text-xs text-gray-400">points</div>
              </div>
            </div>
          </div>

          {/* Still in Contention */}
          {stillInContention.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-green-400 mb-3 flex items-center gap-2">
                <TrendingUp className="w-4 h-4" />
                Still in Mathematical Contention ({stillInContention.length})
              </h3>
              <div className="space-y-3">
                {stillInContention.map((driver, index) => (
                  <div 
                    key={driver.driver} 
                    className={`p-4 rounded-lg border-l-4 ${getTeamColor(driver.team)} hover:scale-[1.02] transition-all duration-300`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="text-lg font-bold text-white w-6">
                          {index + 1}
                        </div>
                        <DriverAvatar driverName={driver.driver} size="md" />
                        <div>
                          <div className="font-semibold text-white">{driver.driver}</div>
                          <div className="text-sm text-gray-400">{driver.team}</div>
                        </div>
                      </div>
                      
                      <div className="flex items-center gap-6">
                        <div className="text-center">
                          <div className="text-lg font-bold text-white">{driver.current_points}</div>
                          <div className="text-xs text-gray-400">current</div>
                        </div>
                        
                        <div className="text-center">
                          <div className="text-lg font-bold text-green-400">{driver.max_possible}</div>
                          <div className="text-xs text-gray-400">max possible</div>
                        </div>
                        
                        <div className="text-center">
                          <div className="text-lg font-bold text-red-400">{driver.points_behind}</div>
                          <div className="text-xs text-gray-400">behind</div>
                        </div>
                      </div>
                    </div>
                    
                    {driver.can_win && (
                      <div className="mt-3 p-2 bg-green-500/10 rounded border border-green-500/20">
                        <div className="text-xs text-green-400">
                          ✓ Can still win mathematically if they win all remaining races
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Mathematically Eliminated */}
          {mathematicallyOut.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-red-400 mb-3 flex items-center gap-2">
                <TrendingDown className="w-4 h-4" />
                Mathematically Eliminated ({mathematicallyOut.length})
              </h3>
              <div className="space-y-2">
                {mathematicallyOut.map((driver, index) => (
                  <div 
                    key={driver.driver} 
                    className={`p-3 rounded-lg border-l-4 ${getTeamColor(driver.team)} opacity-75 hover:opacity-100 transition-opacity`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="text-sm font-bold text-gray-400 w-6">
                          {stillInContention.length + index + 1}
                        </div>
                        <DriverAvatar driverName={driver.driver} size="sm" />
                        <div>
                          <div className="font-semibold text-gray-300">{driver.driver}</div>
                          <div className="text-sm text-gray-500">{driver.team}</div>
                        </div>
                      </div>
                      
                      <div className="flex items-center gap-4">
                        <div className="text-center">
                          <div className="text-sm font-bold text-gray-300">{driver.current_points}</div>
                          <div className="text-xs text-gray-500">current</div>
                        </div>
                        
                        <div className="text-center">
                          <div className="text-sm font-bold text-gray-400">{driver.max_possible}</div>
                          <div className="text-xs text-gray-500">max possible</div>
                        </div>
                        
                        <div className="text-center">
                          <div className="text-sm font-bold text-red-400">{driver.points_behind}</div>
                          <div className="text-xs text-gray-500">behind</div>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Summary Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pt-4 border-t border-gray-700">
            <div className="text-center">
              <div className="text-2xl font-bold text-blue-400">{wdcData.races_completed}</div>
              <div className="text-xs text-gray-400">Races Completed</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-yellow-400">{wdcData.races_remaining}</div>
              <div className="text-xs text-gray-400">Races Remaining</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-green-400">{stillInContention.length}</div>
              <div className="text-xs text-gray-400">Still in Contention</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-red-400">{mathematicallyOut.length}</div>
              <div className="text-xs text-gray-400">Eliminated</div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
    </Card>
  )
}