'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Clock, MapPin, Calendar } from 'lucide-react'

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

  // Mock next race data - in real app, fetch from Ergast API
  const nextRace: NextRace = {
    name: "Abu Dhabi Grand Prix",
    circuit: "Yas Marina Circuit",
    country: "United Arab Emirates",
    date: "2024-12-08",
    time: "13:00",
    round: 24
  }

  useEffect(() => {
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
  }, [nextRace.date, nextRace.time])

  return (
    <Card className="bg-gradient-to-r from-red-600 to-red-800 border-red-500 text-white overflow-hidden relative hover:scale-[1.02] transition-all duration-500 shadow-2xl hover:shadow-red-500/20">
      <div className="absolute inset-0 bg-[url('/f1-aerial.png')] bg-cover bg-center opacity-20 transition-opacity duration-500 hover:opacity-30" />
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
