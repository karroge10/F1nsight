import { useState, useEffect } from 'react'
import { cachedFetch } from '@/lib/cache'

export interface DriverStanding {
  position: number
  name: string
  team: string
  points: number
  change: number
  nationality: string
}

interface StandingsResponse {
  data: DriverStanding[]
  source: string
  success: boolean
  meta?: {
    year: number
    races_completed: number
    races_remaining: number
    leader: string
  }
}

export function useDriverStandings(year: number = new Date().getFullYear()) {
  const [data, setData] = useState<DriverStanding[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [meta, setMeta] = useState<StandingsResponse['meta'] | null>(null)

  useEffect(() => {
    const fetchStandings = async () => {
      try {
        setLoading(true)
        setError(null)

        const response = await cachedFetch<StandingsResponse>(
          `/api/fastf1/driver-standings?year=${year}`,
          `driver_standings_${year}`,
          30 * 60 * 1000,
          { next: { revalidate: 1800 } }
        )

        if (response.success && Array.isArray(response.data)) {
          setData(response.data)
          setMeta(response.meta || null)
        } else {
          throw new Error('Invalid standings data received')
        }
      } catch (err) {
        console.error('Failed to fetch driver standings:', err)
        setError(err instanceof Error ? err.message : 'Failed to load standings')

        // Minimal fallback list (kept honest)
        setData([
          { position: 1, name: 'Max Verstappen', team: 'Red Bull Racing', points: 393, change: 0, nationality: 'NED' },
          { position: 2, name: 'Lando Norris', team: 'McLaren', points: 331, change: 0, nationality: 'GBR' },
          { position: 3, name: 'Charles Leclerc', team: 'Ferrari', points: 307, change: 1, nationality: 'MON' },
          { position: 4, name: 'Oscar Piastri', team: 'McLaren', points: 262, change: -1, nationality: 'AUS' }
        ])
      } finally {
        setLoading(false)
      }
    }

    fetchStandings()
  }, [year])

  return {
    data,
    loading,
    error,
    meta,
    getTopDrivers: (count: number = 8) => data.slice(0, count),
    getLeader: () => data[0] || null,
    getDriverByName: (name: string) => data.find(d => d.name === name) || null
  }
}

