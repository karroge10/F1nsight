'use client'

import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { DriverAvatar } from '@/components/ui/driver-avatar'
import { RacePerformanceTracker } from '@/components/race-performance-tracker'
import { DriverAnalytics } from '@/components/driver-analytics'
import { useDriverStandings } from '@/hooks/use-driver-standings'
import { useF1Schedule } from '@/hooks/use-f1-schedule'
import { 
  Trophy, 
  Flag, 
  Calendar, 
  TrendingUp, 
  TrendingDown,
  Target,
  Zap,
  Award,
  Medal,
  ArrowLeft,
  BarChart3,
  Activity,
  Clock,
  MapPin
} from 'lucide-react'
import Link from 'next/link'

// Get country flag emoji
function getCountryFlag(nationality: string): string {
  const flagMap: Record<string, string> = {
    'NED': '🇳🇱', 'GBR': '🇬🇧', 'MON': '🇲🇨', 'AUS': '🇦🇺', 'ESP': '🇪🇸',
    'GER': '🇩🇪', 'MEX': '🇲🇽', 'JPN': '🇯🇵', 'DEN': '🇩🇰', 'THA': '🇹🇭',
    'CAN': '🇨🇦', 'FRA': '🇫🇷', 'ARG': '🇦🇷', 'CHN': '🇨🇳'
  };
  return flagMap[nationality] || '🏁';
}

// Get team color scheme
function getTeamColor(team: string) {
  const colors: Record<string, { border: string; bg: string; accent: string; primary: string }> = {
    "Red Bull Racing": { border: "border-blue-500", bg: "bg-blue-500/10", accent: "text-blue-400", primary: "bg-blue-600" },
    "McLaren": { border: "border-orange-500", bg: "bg-orange-500/10", accent: "text-orange-400", primary: "bg-orange-600" },
    "Ferrari": { border: "border-red-500", bg: "bg-red-500/10", accent: "text-red-400", primary: "bg-red-600" },
    "Mercedes": { border: "border-cyan-400", bg: "bg-cyan-400/10", accent: "text-cyan-400", primary: "bg-cyan-600" },
    "Aston Martin": { border: "border-green-500", bg: "bg-green-500/10", accent: "text-green-400", primary: "bg-green-600" },
    "Haas": { border: "border-gray-500", bg: "bg-gray-500/10", accent: "text-gray-400", primary: "bg-gray-600" },
    "RB": { border: "border-indigo-500", bg: "bg-indigo-500/10", accent: "text-indigo-400", primary: "bg-indigo-600" },
    "Williams": { border: "border-blue-400", bg: "bg-blue-400/10", accent: "text-blue-300", primary: "bg-blue-500" },
    "Alpine": { border: "border-pink-500", bg: "bg-pink-500/10", accent: "text-pink-400", primary: "bg-pink-600" },
    "Sauber": { border: "border-green-600", bg: "bg-green-600/10", accent: "text-green-500", primary: "bg-green-700" }
  };
  return colors[team] || { border: "border-gray-600", bg: "bg-gray-600/10", accent: "text-gray-400", primary: "bg-gray-600" };
}

// Mock career stats (in real app, would fetch from database)
function getMockCareerStats(driverName: string) {
  const careerStats: Record<string, any> = {
    "Max Verstappen": {
      careerWins: 54,
      careerPodiums: 98,
      championships: 3,
      firstRace: "2015 Australian Grand Prix",
      team: "Red Bull Racing",
      careerPoints: 2457,
      polePositions: 38,
      fastestLaps: 29,
      dnfs: 23,
      racesEntered: 185
    },
    "Lando Norris": {
      careerWins: 1,
      careerPodiums: 13,
      championships: 0,
      firstRace: "2019 Australian Grand Prix",
      team: "McLaren",
      careerPoints: 574,
      polePositions: 1,
      fastestLaps: 7,
      dnfs: 8,
      racesEntered: 118
    }
  };
  
  return careerStats[driverName] || {
    careerWins: "N/A",
    careerPodiums: "N/A", 
    championships: "N/A",
    firstRace: "Data not available",
    team: "Unknown",
    careerPoints: "N/A",
    polePositions: "N/A",
    fastestLaps: "N/A",
    dnfs: "N/A",
    racesEntered: "N/A"
  };
}

export default function DriverProfilePage() {
  const params = useParams()
  const slug = params?.slug as string
  const currentYear = new Date().getFullYear()
  
  const { data: drivers, loading: driversLoading } = useDriverStandings(currentYear)
  const { data: schedule } = useF1Schedule(currentYear)
  
  const [driver, setDriver] = useState<any>(null)
  const [careerStats, setCareerStats] = useState<any>(null)

  useEffect(() => {
    if (drivers.length > 0 && slug) {
      // Convert slug back to driver name
      const driverName = slug.replace(/-/g, ' ')
        .split(' ')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ')
      
      const foundDriver = drivers.find(d => 
        d.name.toLowerCase() === driverName.toLowerCase()
      )
      
      if (foundDriver) {
        setDriver(foundDriver)
        setCareerStats(getMockCareerStats(foundDriver.name))
      }
    }
  }, [drivers, slug])

  if (driversLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-red-900/20 to-gray-900">
        <div className="container mx-auto px-4 py-8">
          <div className="animate-pulse space-y-8">
            <div className="h-64 bg-gray-800 rounded-lg" />
            <div className="h-96 bg-gray-800 rounded-lg" />
          </div>
        </div>
      </div>
    )
  }

  if (!driver) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-red-900/20 to-gray-900">
        <div className="container mx-auto px-4 py-8">
          <div className="text-center">
            <h1 className="text-4xl font-bold text-white mb-4">Driver Not Found</h1>
            <p className="text-gray-400 mb-8">The requested driver profile could not be found.</p>
            <Link href="/drivers">
              <Button className="bg-red-600 hover:bg-red-700">
                <ArrowLeft className="w-4 h-4 mr-2" />
                Back to Drivers
              </Button>
            </Link>
          </div>
        </div>
      </div>
    )
  }

  const teamColors = getTeamColor(driver.team)
  const isChampionshipLeader = driver.position === 1
  const pointsGap = drivers[0]?.points - driver.points

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-red-900/20 to-gray-900">
      <div className="container mx-auto px-4 py-8">
        {/* Back Navigation */}
        <div className="mb-6">
          <Link href="/drivers">
            <Button variant="outline" className="border-gray-600 text-gray-300 hover:bg-gray-800">
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to Drivers
            </Button>
          </Link>
        </div>

        {/* Driver Hero Section */}
        <Card className={`${teamColors.bg} ${teamColors.border} border-2 mb-8 overflow-hidden relative`}>
          <div className="absolute inset-0 bg-gradient-to-r from-black/60 to-transparent z-10" />
          <CardContent className="relative z-20 p-8">
            <div className="flex flex-col lg:flex-row items-center gap-8">
              {/* Driver Avatar */}
              <div className="relative">
                <DriverAvatar 
                  driverName={driver.name} 
                  size="lg"
                  className="w-32 h-32 border-4 border-white/20"
                />
                {isChampionshipLeader && (
                  <div className="absolute -top-2 -right-2">
                    <Trophy className="w-8 h-8 text-yellow-500" />
                  </div>
                )}
              </div>

              {/* Driver Info */}
              <div className="flex-1 text-center lg:text-left">
                <div className="flex items-center justify-center lg:justify-start gap-4 mb-4">
                  <h1 className="text-4xl lg:text-5xl font-bold text-white">{driver.name}</h1>
                  <span className="text-3xl">{getCountryFlag(driver.nationality)}</span>
                </div>
                
                <div className="flex flex-col lg:flex-row items-center gap-4 mb-6">
                  <Badge className={`${teamColors.primary} text-white text-lg px-4 py-2`}>
                    {driver.team}
                  </Badge>
                  <Badge variant="outline" className="border-yellow-500 text-yellow-400 text-lg px-4 py-2">
                    Championship Position: #{driver.position}
                  </Badge>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
                  <div>
                    <div className="text-3xl font-bold text-white">{driver.points}</div>
                    <div className="text-sm text-gray-300">Current Points</div>
                  </div>
                  <div>
                    <div className="text-3xl font-bold text-yellow-400">{careerStats?.championships || 0}</div>
                    <div className="text-sm text-gray-300">Championships</div>
                  </div>
                  <div>
                    <div className="text-3xl font-bold text-green-400">{careerStats?.careerWins || 0}</div>
                    <div className="text-sm text-gray-300">Career Wins</div>
                  </div>
                  <div>
                    <div className="text-3xl font-bold text-blue-400">{careerStats?.careerPodiums || 0}</div>
                    <div className="text-sm text-gray-300">Career Podiums</div>
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Championship Status */}
        {pointsGap > 0 && (
          <Card className="bg-gray-800 border-gray-700 mb-8">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Target className="w-6 h-6 text-red-400" />
                  <div>
                    <h3 className="text-lg font-semibold text-white">Championship Gap</h3>
                    <p className="text-gray-400">Points behind leader</p>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-3xl font-bold text-red-400">-{pointsGap}</div>
                  <div className="text-sm text-gray-400">points</div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Tabs for Different Views */}
        <Tabs defaultValue="overview" className="space-y-6">
          <TabsList className="bg-gray-800 border-gray-700">
            <TabsTrigger value="overview" className="data-[state=active]:bg-red-600">
              Overview
            </TabsTrigger>
            <TabsTrigger value="performance" className="data-[state=active]:bg-red-600">
              Performance
            </TabsTrigger>
            <TabsTrigger value="career" className="data-[state=active]:bg-red-600">
              Career Stats
            </TabsTrigger>
            <TabsTrigger value="analytics" className="data-[state=active]:bg-red-600">
              Analytics
            </TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-6">
            {/* Season Overview */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card className="bg-gray-800 border-gray-700">
                <CardHeader>
                  <CardTitle className="text-white flex items-center gap-2">
                    <BarChart3 className="w-5 h-5 text-blue-500" />
                    {currentYear} Season Performance
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="text-center p-4 bg-gray-700/50 rounded-lg">
                      <div className="text-2xl font-bold text-white">{driver.points}</div>
                      <div className="text-sm text-gray-400">Points</div>
                    </div>
                    <div className="text-center p-4 bg-gray-700/50 rounded-lg">
                      <div className="text-2xl font-bold text-yellow-400">P{driver.position}</div>
                      <div className="text-sm text-gray-400">Position</div>
                    </div>
                  </div>
                  
                  <div className="space-y-2">
                    <div className="flex justify-between">
                      <span className="text-gray-300">Championship Progress</span>
                      <span className="text-gray-300">{((driver.points / (drivers[0]?.points || 1)) * 100).toFixed(1)}%</span>
                    </div>
                    <div className="w-full bg-gray-700 rounded-full h-2">
                      <div 
                        className={`h-2 rounded-full ${teamColors.primary}`}
                        style={{ width: `${(driver.points / (drivers[0]?.points || 1)) * 100}%` }}
                      />
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="bg-gray-800 border-gray-700">
                <CardHeader>
                  <CardTitle className="text-white flex items-center gap-2">
                    <Activity className="w-5 h-5 text-green-500" />
                    Recent Form
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="text-gray-300">Position Change</span>
                    <div className="flex items-center gap-2">
                      {driver.change > 0 ? (
                        <TrendingUp className="w-4 h-4 text-green-400" />
                      ) : driver.change < 0 ? (
                        <TrendingDown className="w-4 h-4 text-red-400" />
                      ) : (
                        <Target className="w-4 h-4 text-gray-400" />
                      )}
                      <span className={`font-bold ${driver.change > 0 ? 'text-green-400' : driver.change < 0 ? 'text-red-400' : 'text-gray-400'}`}>
                        {driver.change > 0 ? `+${driver.change}` : driver.change || '0'}
                      </span>
                    </div>
                  </div>
                  
                  <div className="space-y-2">
                    <span className="text-gray-300">Performance Trend</span>
                    <div className="flex gap-1">
                      {Array.from({ length: 5 }).map((_, i) => (
                        <div key={i} className={`h-8 flex-1 rounded ${i < 3 ? 'bg-green-500' : 'bg-gray-600'}`} />
                      ))}
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="performance">
            <RacePerformanceTracker 
              standings={drivers} 
              schedule={schedule}
              selectedDriver={driver.name}
            />
          </TabsContent>

          <TabsContent value="career" className="space-y-6">
            {/* Career Statistics */}
            <Card className="bg-gray-800 border-gray-700">
              <CardHeader>
                <CardTitle className="text-white flex items-center gap-2">
                  <Trophy className="w-5 h-5 text-yellow-500" />
                  Career Statistics
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
                  <div className="text-center p-4 bg-gray-700/50 rounded-lg">
                    <Award className="w-8 h-8 text-yellow-500 mx-auto mb-2" />
                    <div className="text-2xl font-bold text-white">{careerStats?.championships || 0}</div>
                    <div className="text-sm text-gray-400">World Championships</div>
                  </div>
                  
                  <div className="text-center p-4 bg-gray-700/50 rounded-lg">
                    <Trophy className="w-8 h-8 text-green-500 mx-auto mb-2" />
                    <div className="text-2xl font-bold text-white">{careerStats?.careerWins || 0}</div>
                    <div className="text-sm text-gray-400">Race Wins</div>
                  </div>
                  
                  <div className="text-center p-4 bg-gray-700/50 rounded-lg">
                    <Medal className="w-8 h-8 text-blue-500 mx-auto mb-2" />
                    <div className="text-2xl font-bold text-white">{careerStats?.careerPodiums || 0}</div>
                    <div className="text-sm text-gray-400">Podium Finishes</div>
                  </div>
                  
                  <div className="text-center p-4 bg-gray-700/50 rounded-lg">
                    <Flag className="w-8 h-8 text-purple-500 mx-auto mb-2" />
                    <div className="text-2xl font-bold text-white">{careerStats?.polePositions || 0}</div>
                    <div className="text-sm text-gray-400">Pole Positions</div>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-8">
                  <div className="space-y-4">
                    <h3 className="text-lg font-semibold text-white">Career Highlights</h3>
                    <div className="space-y-3">
                      <div className="flex justify-between">
                        <span className="text-gray-300">Total Points</span>
                        <span className="text-white font-semibold">{careerStats?.careerPoints || 0}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-300">Races Entered</span>
                        <span className="text-white font-semibold">{careerStats?.racesEntered || 0}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-300">Fastest Laps</span>
                        <span className="text-white font-semibold">{careerStats?.fastestLaps || 0}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-300">DNFs</span>
                        <span className="text-white font-semibold">{careerStats?.dnfs || 0}</span>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <h3 className="text-lg font-semibold text-white">Milestones</h3>
                    <div className="space-y-3">
                      <div className="flex items-center gap-3 p-3 bg-gray-700/30 rounded-lg">
                        <Calendar className="w-5 h-5 text-blue-400" />
                        <div>
                          <div className="text-white font-medium">First Race</div>
                          <div className="text-gray-400 text-sm">{careerStats?.firstRace}</div>
                        </div>
                      </div>
                      
                      <div className="flex items-center gap-3 p-3 bg-gray-700/30 rounded-lg">
                        <MapPin className="w-5 h-5 text-green-400" />
                        <div>
                          <div className="text-white font-medium">Current Team</div>
                          <div className="text-gray-400 text-sm">{driver.team}</div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="analytics">
            <DriverAnalytics 
              driverName={driver.name}
              team={driver.team}
              currentYear={currentYear}
            />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}
