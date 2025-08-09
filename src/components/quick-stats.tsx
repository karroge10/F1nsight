'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Flag, Users, Car, Trophy } from 'lucide-react'

export function QuickStats() {
  const stats = [
    {
      icon: <Flag className="w-5 h-5 text-red-500" />,
      label: "Races Completed",
      value: "7",
      total: "24",
      color: "text-red-500"
    },
    {
      icon: <Users className="w-5 h-5 text-blue-500" />,
      label: "Active Drivers",
      value: "20",
      total: "20",
      color: "text-blue-500"
    },
    {
      icon: <Car className="w-5 h-5 text-green-500" />,
      label: "Teams",
      value: "10",
      total: "10",
      color: "text-green-500"
    },
    {
      icon: <Trophy className="w-5 h-5 text-yellow-500" />,
      label: "Championships",
      value: "74",
      total: "∞",
      color: "text-yellow-500"
    }
  ]

  return (
    <Card className="bg-gray-800 border-gray-700">
      <CardHeader>
        <CardTitle className="text-white">Season Overview</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {stats.map((stat, index) => (
            <div key={index} className="flex items-center justify-between p-3 rounded-lg bg-gray-700/50">
              <div className="flex items-center gap-3">
                {stat.icon}
                <span className="text-gray-300">{stat.label}</span>
              </div>
              <div className="text-right">
                <div className={`text-xl font-bold ${stat.color}`}>
                  {stat.value}
                </div>
                {stat.total !== "∞" && (
                  <div className="text-xs text-gray-500">
                    of {stat.total}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
        
        <div className="mt-6 p-4 rounded-lg bg-gradient-to-r from-red-600/20 to-transparent border border-red-600/30">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
            <span className="text-red-400 font-semibold">Live Season</span>
          </div>
          <p className="text-gray-300 text-sm">
            2024 Formula 1 World Championship is currently active
          </p>
        </div>
      </CardContent>
    </Card>
  )
}
