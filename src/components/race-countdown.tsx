'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Clock, MapPin, Calendar, Loader2 } from 'lucide-react'
import { useF1Schedule } from '@/hooks/use-f1-schedule'

interface NextRaceData {
  meeting: {
    meeting_key?: number
    circuit_short_name?: string
    location: string
    country_name: string
    meeting_name: string
    meeting_official_name: string
    date_start: string
    year: number
  }
  source?: string
}

interface NextRace {
  name: string
  circuit: string
  country: string
  date: string
  time: string
  round: number
}

export function RaceCountdown() {
  const [timeLeft, setTimeLeft] = useState({
    days: 0,
    hours: 0,
    minutes: 0,
    seconds: 0
  })
  
  const { loading, error, getNextRace } = useF1Schedule(2025);
  const nextRaceData = getNextRace();
  
  // Transform to NextRace format
  const nextRace: NextRace | null = nextRaceData ? {
    name: nextRaceData.event_name,
    circuit: nextRaceData.location,
    country: nextRaceData.country,
    date: new Date(nextRaceData.session5_date || nextRaceData.event_date).toISOString().split('T')[0],
    time: new Date(nextRaceData.session5_date || nextRaceData.event_date).toTimeString().split(' ')[0].substring(0, 5),
    round: nextRaceData.round_number
  } : null;

  useEffect(() => {
    if (!nextRace) return

    const targetDate = new Date(`${nextRace.date}T${nextRace.time}:00Z`)
    
    const timer = setInterval(() => {
      const now = new Date().getTime()
      const distance = targetDate.getTime() - now

      if (distance > 0) {
        setTimeLeft({
          days: Math.floor(distance / (1000 * 60 * 60 * 24)),
          hours: Math.floor((distance % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60)),
          minutes: Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60)),
          seconds: Math.floor((distance % (1000 * 60)) / 1000)
        })
      }
    }, 1000)

    return () => clearInterval(timer)
  }, [nextRace])

  if (loading) {
    return (
      <Card className="bg-gradient-to-r from-red-600 to-red-800 border-red-500 text-white overflow-hidden relative shadow-2xl">
        <div className="absolute inset-0 bg-[url('/f1-aerial.png')] bg-cover bg-center opacity-20" />
        <div className="relative z-10 flex items-center justify-center h-64">
          <div className="flex items-center gap-3">
            <Loader2 className="w-6 h-6 animate-spin" />
            <span>Loading next race...</span>
          </div>
        </div>
      </Card>
    )
  }

  if (!nextRace) {
    return (
      <Card className="bg-gradient-to-r from-gray-600 to-gray-800 border-gray-500 text-white overflow-hidden relative shadow-2xl">
        <div className="relative z-10 flex items-center justify-center h-64">
          <div className="text-center">
            <div className="text-xl font-bold mb-2">No upcoming race found</div>
            {error && <div className="text-sm text-gray-300">{error}</div>}
          </div>
        </div>
      </Card>
    )
  }

  // Generate dynamic background image path
  const getTrackImage = (circuit: string) => {
    if (!circuit) return '/f1-aerial.png'
    const trackName = circuit
      .toLowerCase()
      .replace(/circuit/gi, '')
      .replace(/international/gi, '')
      .replace(/grand prix/gi, '')
      .replace(/de\s+/gi, '')
      .replace(/\s+/g, '-')
      .replace(/^-+|-+$/g, '')
    return `/images/tracks/${trackName}.jpg`
  }

  const trackImage = getTrackImage(nextRace.circuit);

  return (
    <Card className="bg-gradient-to-r from-red-600 to-red-800 border-red-500 text-white overflow-hidden relative hover:scale-[1.02] transition-all duration-500 shadow-2xl hover:shadow-red-500/20">
      <div 
        className="absolute inset-0 bg-cover bg-center opacity-30 transition-opacity duration-500 hover:opacity-40" 
        style={{
          backgroundImage: `url('${trackImage}'), url('/images/tracks/zandvoort.jpg'), url('/f1-aerial.png')`
        }}
      />
      <div className="relative z-10">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="animate-in slide-in-from-left duration-700">
              <CardTitle className="text-2xl font-bold">{nextRace.name}</CardTitle>
              <div className="flex items-center gap-2 mt-2 text-red-100">
                <MapPin className="w-4 h-4 animate-in fade-in duration-1000" />
                <span>{nextRace.circuit}, {nextRace.country}</span>
              </div>
            </div>
            <Badge variant="secondary" className="bg-white text-red-600 animate-in slide-in-from-right duration-700 hover:scale-110 transition-transform">
              Round {nextRace.round}
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-4 gap-4 mb-6">
            {[
              { value: timeLeft.days, label: 'Days' },
              { value: timeLeft.hours, label: 'Hours' },
              { value: timeLeft.minutes, label: 'Minutes' },
              { value: timeLeft.seconds, label: 'Seconds' }
            ].map((item, index) => (
              <div key={item.label} className={`text-center animate-in fade-in duration-1000 delay-${(index + 1) * 200} hover:scale-110 transition-transform`}>
                <div className="text-3xl font-bold tabular-nums">{item.value}</div>
                <div className="text-sm text-red-100">{item.label}</div>
              </div>
            ))}
          </div>
          <div className="flex items-center gap-2 text-red-100 animate-in slide-in-from-bottom duration-1000 delay-800">
            <Calendar className="w-4 h-4" />
            <span>{new Date(nextRace.date).toLocaleDateString('en-US', { 
              weekday: 'long', 
              year: 'numeric', 
              month: 'long', 
              day: 'numeric' 
            })}</span>
            <Clock className="w-4 h-4 ml-4" />
            <span>{nextRace.time} UTC</span>
          </div>
        </CardContent>
      </div>
    </Card>
  )
}
