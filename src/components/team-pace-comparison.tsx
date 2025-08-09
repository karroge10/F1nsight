'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { BarChart3, AlertCircle } from 'lucide-react'

export function TeamPaceComparison() {
  return (
    <Card className="bg-gray-800 border-gray-700">
      <CardHeader>
        <CardTitle className="text-white flex items-center gap-2">
          <BarChart3 className="w-5 h-5 text-orange-500" />
          Team Pace Comparison
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-center py-12">
          <AlertCircle className="w-16 h-16 text-gray-600 mx-auto mb-4" />
          <h3 className="text-xl font-semibold text-white mb-2">Team Pace Data Not Available</h3>
          <p className="text-gray-400 mb-6">
            Team pace analysis requires detailed session timing data which is not currently implemented.
          </p>
          <Badge variant="secondary" className="bg-gray-700 text-gray-300">
            Feature requires session timing API integration
          </Badge>
          <div className="mt-6 text-sm text-gray-500">
            <p>This feature would show:</p>
            <ul className="list-disc list-inside mt-2 space-y-1">
              <li>Qualifying pace comparisons</li>
              <li>Race pace analysis</li>
              <li>Long run vs short run performance</li>
              <li>Track-specific team strengths</li>
              <li>Development progression over time</li>
            </ul>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}