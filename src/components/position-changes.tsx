'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { TrendingUp, AlertCircle } from 'lucide-react'

export function PositionChanges() {
  return (
    <Card className="bg-gray-800 border-gray-700">
      <CardHeader>
        <CardTitle className="text-white flex items-center gap-2">
          <TrendingUp className="w-5 h-5 text-purple-500" />
          Position Changes
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-center py-12">
          <AlertCircle className="w-16 h-16 text-gray-600 mx-auto mb-4" />
          <h3 className="text-xl font-semibold text-white mb-2">Position Changes Data Not Available</h3>
          <p className="text-gray-400 mb-6">
            Race position tracking requires live timing data which is not currently implemented.
          </p>
          <Badge variant="secondary" className="bg-gray-700 text-gray-300">
            Feature requires live timing API integration
          </Badge>
          <div className="mt-6 text-sm text-gray-500">
            <p>This feature would show:</p>
            <ul className="list-disc list-inside mt-2 space-y-1">
              <li>Lap-by-lap position changes</li>
              <li>Overtaking and defending moves</li>
              <li>Pit stop strategy impact</li>
              <li>Safety car effects on positions</li>
              <li>Grid position vs finishing position</li>
            </ul>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}