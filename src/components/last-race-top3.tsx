"use client"

import { useEffect, useState } from "react"
import { DriverAvatar } from "@/components/ui/driver-avatar"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Trophy, Loader2, Calendar, MapPin } from "lucide-react"

interface TopItem {
  position: number | null
  driver: string
  team: string
  points: number
  status?: string
}

interface LastRace {
  round_number: number
  country: string
  location: string
  event_name: string
  race_date: string
}

interface LastRaceData {
  last_race: LastRace
  top3: TopItem[]
  source: string
}

export function LastRaceTop3() {
  const [data, setData] = useState<LastRaceData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const fetchLastRace = async () => {
      try {
        // Try OpenF1 first, fallback to FastF1
        let res = await fetch('/api/openf1/last-race-top3')
        if (!res.ok) {
          res = await fetch('/api/fastf1/last-race-top3')
        }
        
        const json = await res.json()
        if (json?.data) {
          setData(json.data)
        } else {
          throw new Error("No data received")
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load last race results")
      } finally {
        setLoading(false)
      }
    }

    fetchLastRace()
  }, [])

  if (loading) {
    return (
      <Card className="bg-gray-800/50 border-gray-700">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <Trophy className="w-5 h-5 text-yellow-500" />
            <CardTitle className="text-lg font-semibold text-white">Last Race Results</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-6 h-6 animate-spin text-yellow-500" />
          </div>
        </CardContent>
      </Card>
    )
  }

  if (error || !data || !data.last_race || data.top3.length === 0) {
    return (
      <Card className="bg-gray-800/50 border-gray-700">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <Trophy className="w-5 h-5 text-yellow-500" />
            <CardTitle className="text-lg font-semibold text-white">Last Race Results</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8 text-gray-400">
            {error || "No recent race data available"}
          </div>
        </CardContent>
      </Card>
    )
  }

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    })
  }

  return (
    <Card className="bg-gray-800/50 border-gray-700">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <Trophy className="w-5 h-5 text-yellow-500" />
          <CardTitle className="text-lg font-semibold text-white">Last Race Results</CardTitle>
        </div>
        <div className="flex items-center gap-4 text-sm text-gray-400">
          <div className="flex items-center gap-1">
            <Calendar className="w-4 h-4" />
            <span>{formatDate(data.last_race.race_date)}</span>
          </div>
          <div className="flex items-center gap-1">
            <MapPin className="w-4 h-4" />
            <span>{data.last_race.location}, {data.last_race.country}</span>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {data.top3.map((result, index) => (
            <div 
              key={`${result.position}-${result.driver}`} 
              className={`flex items-center gap-3 p-3 rounded-lg transition-colors ${
                index === 0 ? 'bg-yellow-500/20 border border-yellow-500/30' :
                index === 1 ? 'bg-gray-400/20 border border-gray-400/30' :
                index === 2 ? 'bg-amber-600/20 border border-amber-600/30' :
                'bg-gray-700/50 border border-gray-600'
              }`}
            >
              <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm ${
                index === 0 ? 'bg-yellow-500 text-black' :
                index === 1 ? 'bg-gray-400 text-black' :
                index === 2 ? 'bg-amber-600 text-white' :
                'bg-gray-600 text-white'
              }`}>
                {result.position ?? '-'}
              </div>
              <DriverAvatar driverName={result.driver} size="sm" />
              <div className="flex-1">
                <div className="text-sm font-medium text-white">{result.driver}</div>
                <div className="text-xs text-gray-400">{result.team}</div>
              </div>
              <div className="text-sm font-semibold text-yellow-500">{result.points} pts</div>
            </div>
          ))}
        </div>
        {data.source && (
          <div className="mt-4 pt-3 border-t border-gray-700">
            <div className="text-xs text-gray-500 text-center">
              Data source: {data.source.toUpperCase()}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
