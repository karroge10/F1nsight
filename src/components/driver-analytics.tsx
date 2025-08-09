'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { DriverAvatar } from '@/components/ui/driver-avatar'
import { 
  Clock, 
  Target, 
  Zap, 
  TrendingUp, 
  AlertCircle,
  BarChart3,
  PieChart,
  Activity
} from 'lucide-react'

interface DriverAnalyticsProps {
  driverName: string
  team: string
  position: number
  points: number
}

export function DriverAnalytics({ driverName, team, position, points }: DriverAnalyticsProps) {
  return (
    <div className="space-y-6">
      {/* Driver Header */}
      <Card className="bg-gray-800 border-gray-700">
        <CardHeader>
          <div className="flex items-center gap-4">
            <DriverAvatar driverName={driverName} size="lg" />
            <div>
              <h2 className="text-2xl font-bold text-white">{driverName}</h2>
              <p className="text-gray-400">{team}</p>
              <div className="flex gap-4 mt-2">
                <Badge className="bg-yellow-600">P{position}</Badge>
                <Badge variant="outline" className="border-blue-500 text-blue-400">{points} Points</Badge>
              </div>
            </div>
          </div>
        </CardHeader>
      </Card>

      {/* Analytics Tabs */}
      <Tabs defaultValue="overview" className="space-y-6">
        <TabsList className="bg-gray-800 border-gray-700">
          <TabsTrigger value="overview" className="data-[state=active]:bg-red-600">Overview</TabsTrigger>
          <TabsTrigger value="performance" className="data-[state=active]:bg-red-600">Performance</TabsTrigger>
          <TabsTrigger value="telemetry" className="data-[state=active]:bg-red-600">Telemetry</TabsTrigger>
          <TabsTrigger value="strategy" className="data-[state=active]:bg-red-600">Strategy</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Card className="bg-gray-800 border-gray-700">
              <CardHeader>
                <CardTitle className="text-white flex items-center gap-2">
                  <BarChart3 className="w-5 h-5 text-blue-500" />
                  Season Overview
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-4">
                  <div className="text-center p-4 bg-gray-700/50 rounded-lg">
                    <div className="text-2xl font-bold text-white">{position}</div>
                    <div className="text-sm text-gray-400">Championship Position</div>
                  </div>
                  <div className="text-center p-4 bg-gray-700/50 rounded-lg">
                    <div className="text-2xl font-bold text-white">{points}</div>
                    <div className="text-sm text-gray-400">Points Scored</div>
                  </div>
                </div>
                <div className="mt-4 text-center">
                  <Badge variant="secondary" className="bg-gray-700 text-gray-300">
                    Additional stats require race results API
                  </Badge>
                </div>
              </CardContent>
            </Card>

            <Card className="bg-gray-800 border-gray-700">
              <CardHeader>
                <CardTitle className="text-white flex items-center gap-2">
                  <Activity className="w-5 h-5 text-green-500" />
                  Team Performance
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-center py-8">
                  <p className="text-gray-400">Team: {team}</p>
                  <Badge variant="secondary" className="bg-gray-700 text-gray-300 mt-2">
                    Team analytics require additional data sources
                  </Badge>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="performance">
          <Card className="bg-gray-800 border-gray-700">
            <CardHeader>
              <CardTitle className="text-white flex items-center gap-2">
                <Clock className="w-5 h-5 text-purple-500" />
                Performance Analysis
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-center py-12">
                <AlertCircle className="w-16 h-16 text-gray-600 mx-auto mb-4" />
                <h3 className="text-xl font-semibold text-white mb-2">Performance Data Not Available</h3>
                <p className="text-gray-400 mb-6">
                  Detailed performance analysis requires lap timing and telemetry data.
                </p>
                <Badge variant="secondary" className="bg-gray-700 text-gray-300">
                  Feature requires telemetry API integration
                </Badge>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="telemetry">
          <Card className="bg-gray-800 border-gray-700">
            <CardHeader>
              <CardTitle className="text-white flex items-center gap-2">
                <Target className="w-5 h-5 text-orange-500" />
                Telemetry Analysis
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-center py-12">
                <AlertCircle className="w-16 h-16 text-gray-600 mx-auto mb-4" />
                <h3 className="text-xl font-semibold text-white mb-2">Telemetry Data Not Available</h3>
                <p className="text-gray-400 mb-6">
                  Telemetry analysis requires access to detailed car sensor data.
                </p>
                <Badge variant="secondary" className="bg-gray-700 text-gray-300">
                  Feature requires telemetry data access
                </Badge>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="strategy">
          <Card className="bg-gray-800 border-gray-700">
            <CardHeader>
              <CardTitle className="text-white flex items-center gap-2">
                <Zap className="w-5 h-5 text-yellow-500" />
                Strategy Analysis
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-center py-12">
                <AlertCircle className="w-16 h-16 text-gray-600 mx-auto mb-4" />
                <h3 className="text-xl font-semibold text-white mb-2">Strategy Data Not Available</h3>
                <p className="text-gray-400 mb-6">
                  Strategy analysis requires pit stop and tire compound data.
                </p>
                <Badge variant="secondary" className="bg-gray-700 text-gray-300">
                  Feature requires strategy data API
                </Badge>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}

        <TabsContent value="performance">
          <Card className="bg-gray-800 border-gray-700">
            <CardHeader>
              <CardTitle className="text-white flex items-center gap-2">
                <Clock className="w-5 h-5 text-purple-500" />
                Performance Analysis
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-center py-12">
                <AlertCircle className="w-16 h-16 text-gray-600 mx-auto mb-4" />
                <h3 className="text-xl font-semibold text-white mb-2">Performance Data Not Available</h3>
                <p className="text-gray-400 mb-6">
                  Detailed performance analysis requires lap timing and telemetry data.
                </p>
                <Badge variant="secondary" className="bg-gray-700 text-gray-300">
                  Feature requires telemetry API integration
                </Badge>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="telemetry">
          <Card className="bg-gray-800 border-gray-700">
            <CardHeader>
              <CardTitle className="text-white flex items-center gap-2">
                <Target className="w-5 h-5 text-orange-500" />
                Telemetry Analysis
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-center py-12">
                <AlertCircle className="w-16 h-16 text-gray-600 mx-auto mb-4" />
                <h3 className="text-xl font-semibold text-white mb-2">Telemetry Data Not Available</h3>
                <p className="text-gray-400 mb-6">
                  Telemetry analysis requires access to detailed car sensor data.
                </p>
                <Badge variant="secondary" className="bg-gray-700 text-gray-300">
                  Feature requires telemetry data access
                </Badge>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="strategy">
          <Card className="bg-gray-800 border-gray-700">
            <CardHeader>
              <CardTitle className="text-white flex items-center gap-2">
                <Zap className="w-5 h-5 text-yellow-500" />
                Strategy Analysis
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-center py-12">
                <AlertCircle className="w-16 h-16 text-gray-600 mx-auto mb-4" />
                <h3 className="text-xl font-semibold text-white mb-2">Strategy Data Not Available</h3>
                <p className="text-gray-400 mb-6">
                  Strategy analysis requires pit stop and tire compound data.
                </p>
                <Badge variant="secondary" className="bg-gray-700 text-gray-300">
                  Feature requires strategy data API
                </Badge>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}