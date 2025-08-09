'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { BarChart3, AlertCircle } from 'lucide-react';

export function RacePerformanceTracker({ 
  standings, 
  schedule, 
  selectedDriver 
}: { 
  standings: any[], 
  schedule: any[], 
  selectedDriver?: string 
}) {
  return (
    <Card className="bg-gray-800 border-gray-700">
      <CardHeader>
        <CardTitle className="text-white flex items-center gap-2">
          <BarChart3 className="w-5 h-5 text-blue-500" />
          Race Performance Tracker
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-center py-12">
          <AlertCircle className="w-16 h-16 text-gray-600 mx-auto mb-4" />
          <h3 className="text-xl font-semibold text-white mb-2">Race Performance Data Not Available</h3>
          <p className="text-gray-400 mb-6">
            Race-by-race performance tracking requires detailed race results data which is not currently implemented.
          </p>
          <Badge variant="secondary" className="bg-gray-700 text-gray-300">
            Feature requires race results API integration
          </Badge>
          <div className="mt-6 text-sm text-gray-500">
            <p>This feature would show:</p>
            <ul className="list-disc list-inside mt-2 space-y-1">
              <li>Race-by-race finishing positions</li>
              <li>Points progression throughout the season</li>
              <li>Qualifying vs race performance</li>
              <li>DNF tracking and reliability metrics</li>
              <li>Head-to-head driver comparisons</li>
            </ul>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}