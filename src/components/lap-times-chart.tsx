'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { LineChart, AlertCircle } from 'lucide-react'

export function LapTimesChart() {
  return (
    <Card className="bg-gray-800 border-gray-700">
      <CardHeader>
        <CardTitle className="text-white flex items-center gap-2">
          <LineChart className="w-5 h-5 text-green-500" />
          Lap Times Analysis
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-center py-12">
          <AlertCircle className="w-16 h-16 text-gray-600 mx-auto mb-4" />
          <h3 className="text-xl font-semibold text-white mb-2">Lap Times Data Not Available</h3>
          <p className="text-gray-400 mb-6">
            Detailed lap timing analysis requires race telemetry data which is not currently implemented.
          </p>
          <Badge variant="secondary" className="bg-gray-700 text-gray-300">
            Feature requires telemetry API integration
          </Badge>
          <div className="mt-6 text-sm text-gray-500">
            <p>This feature would show:</p>
            <ul className="list-disc list-inside mt-2 space-y-1">
              <li>Lap-by-lap timing progression</li>
              <li>Sector time comparisons</li>
              <li>Tire compound performance</li>
              <li>Fuel load effects on pace</li>
              <li>Weather impact analysis</li>
            </ul>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}