"use client"

import { useEffect, useState } from "react"
import { DriverAvatar } from "@/components/ui/driver-avatar"
import { Trophy, Loader2 } from "lucide-react"

interface TopItem {
  position: number | null
  driver: string
  team: string
  points: number
  status?: string
  time?: string
}

export function RaceCardResults({ year, round }: { year: number; round: number }) {
  const [top, setTop] = useState<TopItem[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const fetchResults = async () => {
      try {
        const res = await fetch(`/api/fastf1/race-results?year=${year}&round=${round}&limit=3`)
        const json = await res.json()
        if (json?.data?.top) setTop(json.data.top)
        else throw new Error("No results")
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load results")
      } finally {
        setLoading(false)
      }
    }
    fetchResults()
  }, [year, round])

  if (loading) return <div className="flex items-center justify-center py-4"><Loader2 className="w-4 h-4 animate-spin text-yellow-500" /></div>
  if (error || !top || top.length === 0) return <div className="text-xs text-gray-400 text-center">No results</div>

  return (
    <div className="space-y-2">
      {top.map((r) => (
        <div key={`${r.position}-${r.driver}`} className="flex items-center gap-3 p-2 rounded bg-gray-800/50">
          <div className="w-6 text-center font-bold text-white">{r.position ?? '-'}</div>
          <DriverAvatar driverName={r.driver} size="sm" />
          <div className="flex-1">
            <div className="text-sm font-medium text-white">{r.driver}</div>
            <div className="text-xs text-gray-400">{r.team}</div>
          </div>
          <div className="text-xs text-gray-300">{r.points} pts</div>
        </div>
      ))}
    </div>
  )
}

