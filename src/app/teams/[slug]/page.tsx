'use client'

import { useState, useEffect, useMemo } from 'react'
import { useParams } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { DriverAvatar } from '@/components/ui/driver-avatar'
import { useDriverStandings } from '@/hooks/use-driver-standings'
import { useF1Schedule } from '@/hooks/use-f1-schedule'
import { 
  Trophy, 
  Users, 
  Calendar, 
  TrendingUp, 
  TrendingDown,
  Target,
  Award,
  ArrowLeft,
  BarChart3,
  Activity,
  MapPin,
  Building,
  Crown,
  Car,
  Flag,
  Zap
} from 'lucide-react'
import Link from 'next/link'

// Team information (same as teams page)
const teamInfo: Record<string, {
  fullName: string
  shortName: string
  founded: number
  base: string
  principal: string
  colors: { primary: string; secondary: string; bg: string; border: string }
  carNumbers: number[]
  engine: string
  chassis: string
}> = {
  "Red Bull Racing": {
    fullName: "Oracle Red Bull Racing",
    shortName: "Red Bull",
    founded: 2005,
    base: "Milton Keynes, UK",
    principal: "Christian Horner",
    colors: { primary: "bg-blue-600", secondary: "text-blue-400", bg: "bg-blue-500/10", border: "border-blue-500" },
    carNumbers: [1, 11],
    engine: "Honda RBPT",
    chassis: "RB20"
  },
  "McLaren": {
    fullName: "McLaren F1 Team",
    shortName: "McLaren",
    founded: 1966,
    base: "Woking, UK",
    principal: "Andrea Stella",
    colors: { primary: "bg-orange-600", secondary: "text-orange-400", bg: "bg-orange-500/10", border: "border-orange-500" },
    carNumbers: [4, 81],
    engine: "Mercedes",
    chassis: "MCL38"
  },
  "Ferrari": {
    fullName: "Scuderia Ferrari",
    shortName: "Ferrari",
    founded: 1950,
    base: "Maranello, Italy",
    principal: "Frédéric Vasseur",
    colors: { primary: "bg-red-600", secondary: "text-red-400", bg: "bg-red-500/10", border: "border-red-500" },
    carNumbers: [16, 55],
    engine: "Ferrari",
    chassis: "SF-24"
  },
  "Mercedes": {
    fullName: "Mercedes-AMG Petronas F1 Team",
    shortName: "Mercedes",
    founded: 2010,
    base: "Brackley, UK",
    principal: "Toto Wolff",
    colors: { primary: "bg-cyan-600", secondary: "text-cyan-400", bg: "bg-cyan-500/10", border: "border-cyan-500" },
    carNumbers: [44, 63],
    engine: "Mercedes",
    chassis: "W15"
  },
  "Aston Martin": {
    fullName: "Aston Martin Aramco F1 Team",
    shortName: "Aston Martin",
    founded: 2021,
    base: "Silverstone, UK",
    principal: "Mike Krack",
    colors: { primary: "bg-green-600", secondary: "text-green-400", bg: "bg-green-500/10", border: "border-green-500" },
    carNumbers: [14, 18],
    engine: "Mercedes",
    chassis: "AMR24"
  },
  "Haas": {
    fullName: "MoneyGram Haas F1 Team",
    shortName: "Haas",
    founded: 2016,
    base: "Kannapolis, USA",
    principal: "Ayao Komatsu",
    colors: { primary: "bg-gray-600", secondary: "text-gray-400", bg: "bg-gray-500/10", border: "border-gray-500" },
    carNumbers: [20, 27],
    engine: "Ferrari",
    chassis: "VF-24"
  },
  "RB": {
    fullName: "Visa Cash App RB F1 Team",
    shortName: "RB",
    founded: 2006,
    base: "Faenza, Italy",
    principal: "Laurent Mekies",
    colors: { primary: "bg-indigo-600", secondary: "text-indigo-400", bg: "bg-indigo-500/10", border: "border-indigo-500" },
    carNumbers: [22, 3],
    engine: "Honda RBPT",
    chassis: "VCARB 01"
  },
  "Williams": {
    fullName: "Williams Racing",
    shortName: "Williams",
    founded: 1977,
    base: "Grove, UK",
    principal: "James Vowles",
    colors: { primary: "bg-blue-500", secondary: "text-blue-300", bg: "bg-blue-400/10", border: "border-blue-400" },
    carNumbers: [23, 2],
    engine: "Mercedes",
    chassis: "FW46"
  },
  "Alpine": {
    fullName: "BWT Alpine F1 Team",
    shortName: "Alpine",
    founded: 2021,
    base: "Enstone, UK",
    principal: "Bruno Famin",
    colors: { primary: "bg-pink-600", secondary: "text-pink-400", bg: "bg-pink-500/10", border: "border-pink-500" },
    carNumbers: [10, 31],
    engine: "Renault",
    chassis: "A524"
  },
  "Sauber": {
    fullName: "Stake F1 Team Kick Sauber",
    shortName: "Sauber",
    founded: 1993,
    base: "Hinwil, Switzerland",
    principal: "Alessandro Alunni Bravi",
    colors: { primary: "bg-green-700", secondary: "text-green-500", bg: "bg-green-600/10", border: "border-green-600" },
    carNumbers: [77, 24],
    engine: "Ferrari",
    chassis: "C44"
  }
}

export default function TeamProfilePage() {
  const params = useParams()
  const slug = params?.slug as string
  const currentYear = new Date().getFullYear()
  
  const { data: drivers, loading: driversLoading } = useDriverStandings(currentYear)
  const { data: schedule } = useF1Schedule(currentYear)
  
  const [team, setTeam] = useState<any>(null)

  // Calculate team data from drivers
  const teamData = useMemo(() => {
    if (!team || !drivers.length) return null

    const teamDrivers = drivers.filter(d => d.team === team.name)
    const totalPoints = teamDrivers.reduce((sum, d) => sum + d.points, 0)
    
    // Calculate team position
    const teamStandings = drivers.reduce((teams: Record<string, number>, driver) => {
      teams[driver.team] = (teams[driver.team] || 0) + driver.points
      return teams
    }, {})
    
    const sortedTeams = Object.entries(teamStandings)
      .sort(([,a], [,b]) => b - a)
      .map(([name], index) => ({ name, position: index + 1 }))
    
    const teamPosition = sortedTeams.find(t => t.name === team.name)?.position || 0
    
    return {
      ...team,
      drivers: teamDrivers,
      points: totalPoints,
      position: teamPosition,
      isChampionshipLeader: teamPosition === 1
    }
  }, [team, drivers])

  useEffect(() => {
    if (drivers.length > 0 && slug) {
      // Convert slug back to team name
      const teamName = slug.replace(/-/g, ' ')
        .split(' ')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ')
      
      // Find team by matching driver teams
      const teamNames = Array.from(new Set(drivers.map(d => d.team)))
      const foundTeamName = teamNames.find(t => 
        t.toLowerCase() === teamName.toLowerCase()
      )
      
      if (foundTeamName && teamInfo[foundTeamName]) {
        setTeam({
          name: foundTeamName,
          info: teamInfo[foundTeamName]
        })
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

  if (!team || !teamData) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-red-900/20 to-gray-900">
        <div className="container mx-auto px-4 py-8">
          <div className="text-center">
            <h1 className="text-4xl font-bold text-white mb-4">Team Not Found</h1>
            <p className="text-gray-400 mb-8">The requested team profile could not be found.</p>
            <Link href="/teams">
              <Button className="bg-red-600 hover:bg-red-700">
                <ArrowLeft className="w-4 h-4 mr-2" />
                Back to Teams
              </Button>
            </Link>
          </div>
        </div>
      </div>
    )
  }

  const completedRaces = schedule.filter(race => 
    new Date(race.session5_date || race.event_date) < new Date()
  ).length

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-red-900/20 to-gray-900">
      <div className="container mx-auto px-4 py-8">
        {/* Back Navigation */}
        <div className="mb-6">
          <Link href="/teams">
            <Button variant="outline" className="border-gray-600 text-gray-300 hover:bg-gray-800">
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to Teams
            </Button>
          </Link>
        </div>

        {/* Team Hero Section */}
        <Card className={`${teamData.info.colors.bg} ${teamData.info.colors.border} border-2 mb-8 overflow-hidden relative`}>
          <div className="absolute inset-0 bg-gradient-to-r from-black/60 to-transparent z-10" />
          <CardContent className="relative z-20 p-8">
            <div className="flex flex-col lg:flex-row items-center gap-8">
              {/* Team Logo/Branding */}
              <div className="relative">
                <div className={`w-32 h-32 rounded-full ${teamData.info.colors.primary} flex items-center justify-center border-4 border-white/20`}>
                  <Car className="w-16 h-16 text-white" />
                </div>
                {teamData.isChampionshipLeader && (
                  <div className="absolute -top-2 -right-2">
                    <Crown className="w-8 h-8 text-yellow-500" />
                  </div>
                )}
              </div>

              {/* Team Info */}
              <div className="flex-1 text-center lg:text-left">
                <div className="flex items-center justify-center lg:justify-start gap-4 mb-4">
                  <h1 className="text-4xl lg:text-5xl font-bold text-white">{teamData.info.shortName}</h1>
                </div>
                
                <p className="text-xl text-gray-300 mb-4">{teamData.info.fullName}</p>
                
                <div className="flex flex-col lg:flex-row items-center gap-4 mb-6">
                  <Badge className={`${teamData.info.colors.primary} text-white text-lg px-4 py-2`}>
                    Constructor Position: #{teamData.position}
                  </Badge>
                  <Badge variant="outline" className="border-yellow-500 text-yellow-400 text-lg px-4 py-2">
                    {teamData.points} Championship Points
                  </Badge>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
                  <div>
                    <div className="text-3xl font-bold text-white">{teamData.points}</div>
                    <div className="text-sm text-gray-300">Total Points</div>
                  </div>
                  <div>
                    <div className="text-3xl font-bold text-blue-400">{teamData.drivers.length}</div>
                    <div className="text-sm text-gray-300">Drivers</div>
                  </div>
                  <div>
                    <div className="text-3xl font-bold text-green-400">{teamData.info.founded}</div>
                    <div className="text-sm text-gray-300">Founded</div>
                  </div>
                  <div>
                    <div className="text-3xl font-bold text-purple-400">#{teamData.position}</div>
                    <div className="text-sm text-gray-300">Championship</div>
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Team Details */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
          <Card className="bg-gray-800 border-gray-700">
            <CardHeader>
              <CardTitle className="text-white flex items-center gap-2">
                <Building className="w-5 h-5 text-blue-500" />
                Team Information
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-2">
                <MapPin className="w-4 h-4 text-green-400" />
                <span className="text-gray-400">Headquarters:</span>
                <span className="text-gray-300">{teamData.info.base}</span>
              </div>
              <div className="flex items-center gap-2">
                <Users className="w-4 h-4 text-blue-400" />
                <span className="text-gray-400">Team Principal:</span>
                <span className="text-gray-300">{teamData.info.principal}</span>
              </div>
              <div className="flex items-center gap-2">
                <Calendar className="w-4 h-4 text-purple-400" />
                <span className="text-gray-400">Founded:</span>
                <span className="text-gray-300">{teamData.info.founded}</span>
              </div>
              <div className="flex items-center gap-2">
                <Car className="w-4 h-4 text-orange-400" />
                <span className="text-gray-400">Chassis:</span>
                <span className="text-gray-300">{teamData.info.chassis}</span>
              </div>
              <div className="flex items-center gap-2">
                <Zap className="w-4 h-4 text-yellow-400" />
                <span className="text-gray-400">Engine:</span>
                <span className="text-gray-300">{teamData.info.engine}</span>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-gray-800 border-gray-700">
            <CardHeader>
              <CardTitle className="text-white flex items-center gap-2">
                <Users className="w-5 h-5 text-green-500" />
                Team Drivers
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {teamData.drivers.map((driver: any) => (
                <Link 
                  key={driver.name} 
                  href={`/drivers/${encodeURIComponent(driver.name.toLowerCase().replace(/\s+/g, '-'))}`}
                  className="flex items-center gap-4 p-4 bg-gray-700/50 rounded-lg hover:bg-gray-700 transition-colors group"
                >
                  <DriverAvatar driverName={driver.name} size="md" />
                  <div className="flex-1">
                    <div className="text-white font-semibold group-hover:text-yellow-400 transition-colors">
                      {driver.name}
                    </div>
                    <div className="text-gray-400 text-sm">
                      Car #{teamData.info.carNumbers[teamData.drivers.indexOf(driver)] || '?'}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-white font-bold">P{driver.position}</div>
                    <div className="text-gray-400 text-sm">{driver.points} pts</div>
                  </div>
                </Link>
              ))}
            </CardContent>
          </Card>
        </div>

        {/* Tabs for Different Views */}
        <Tabs defaultValue="overview" className="space-y-6">
          <TabsList className="bg-gray-800 border-gray-700">
            <TabsTrigger value="overview" className="data-[state=active]:bg-red-600">
              Season Overview
            </TabsTrigger>
            <TabsTrigger value="performance" className="data-[state=active]:bg-red-600">
              Performance
            </TabsTrigger>
            <TabsTrigger value="history" className="data-[state=active]:bg-red-600">
              Team History
            </TabsTrigger>
            <TabsTrigger value="technical" className="data-[state=active]:bg-red-600">
              Technical
            </TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-6">
            {/* Season Performance */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card className="bg-gray-800 border-gray-700">
                <CardHeader>
                  <CardTitle className="text-white flex items-center gap-2">
                    <BarChart3 className="w-5 h-5 text-blue-500" />
                    {currentYear} Constructor Championship
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="text-center p-4 bg-gray-700/50 rounded-lg">
                      <div className="text-2xl font-bold text-white">{teamData.points}</div>
                      <div className="text-sm text-gray-400">Total Points</div>
                    </div>
                    <div className="text-center p-4 bg-gray-700/50 rounded-lg">
                      <div className="text-2xl font-bold text-yellow-400">#{teamData.position}</div>
                      <div className="text-sm text-gray-400">Position</div>
                    </div>
                  </div>
                  
                  {/* Points contribution by driver */}
                  <div className="space-y-3">
                    <h4 className="text-white font-semibold">Points Contribution</h4>
                    {teamData.drivers.map((driver: any) => {
                      const percentage = teamData.points > 0 ? (driver.points / teamData.points) * 100 : 0
                      return (
                        <div key={driver.name} className="space-y-2">
                          <div className="flex justify-between">
                            <span className="text-gray-300">{driver.name.split(' ')[1] || driver.name}</span>
                            <span className="text-gray-300">{driver.points} pts ({percentage.toFixed(1)}%)</span>
                          </div>
                          <div className="w-full bg-gray-700 rounded-full h-2">
                            <div 
                              className={`h-2 rounded-full ${teamData.info.colors.primary}`}
                              style={{ width: `${percentage}%` }}
                            />
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </CardContent>
              </Card>

              <Card className="bg-gray-800 border-gray-700">
                <CardHeader>
                  <CardTitle className="text-white flex items-center gap-2">
                    <Activity className="w-5 h-5 text-green-500" />
                    Season Statistics
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 gap-4 text-center">
                    <div className="p-3 bg-gray-700/50 rounded">
                      <div className="text-xl font-bold text-white">{completedRaces}</div>
                      <div className="text-xs text-gray-400">Races Completed</div>
                    </div>
                    <div className="p-3 bg-gray-700/50 rounded">
                      <div className="text-xl font-bold text-white">{schedule.length - completedRaces}</div>
                      <div className="text-xs text-gray-400">Races Remaining</div>
                    </div>
                    <div className="p-3 bg-gray-700/50 rounded">
                      <div className="text-xl font-bold text-green-400">
                        {completedRaces > 0 ? (teamData.points / completedRaces).toFixed(1) : '0.0'}
                      </div>
                      <div className="text-xs text-gray-400">Avg Points/Race</div>
                    </div>
                    <div className="p-3 bg-gray-700/50 rounded">
                      <div className="text-xl font-bold text-blue-400">2</div>
                      <div className="text-xs text-gray-400">Active Drivers</div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="performance">
            <Card className="bg-gray-800 border-gray-700">
              <CardHeader>
                <CardTitle className="text-white flex items-center gap-2">
                  <Target className="w-5 h-5 text-purple-500" />
                  Team Performance Analysis
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-center py-12">
                  <BarChart3 className="w-16 h-16 text-gray-600 mx-auto mb-4" />
                  <h3 className="text-xl font-semibold text-white mb-2">Performance Analytics</h3>
                  <p className="text-gray-400 mb-6">Detailed team performance metrics and race analysis</p>
                  <p className="text-gray-500 text-sm">
                    This section would include race-by-race performance, 
                    qualifying vs race performance, pit stop analysis, and more.
                  </p>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="history">
            <Card className="bg-gray-800 border-gray-700">
              <CardHeader>
                <CardTitle className="text-white flex items-center gap-2">
                  <Trophy className="w-5 h-5 text-yellow-500" />
                  Team History & Achievements
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div className="text-center p-6 bg-gray-700/50 rounded-lg">
                      <Trophy className="w-8 h-8 text-yellow-500 mx-auto mb-2" />
                      <div className="text-2xl font-bold text-white">?</div>
                      <div className="text-sm text-gray-400">Constructor Titles</div>
                    </div>
                    <div className="text-center p-6 bg-gray-700/50 rounded-lg">
                      <Flag className="w-8 h-8 text-green-500 mx-auto mb-2" />
                      <div className="text-2xl font-bold text-white">?</div>
                      <div className="text-sm text-gray-400">Race Wins</div>
                    </div>
                    <div className="text-center p-6 bg-gray-700/50 rounded-lg">
                      <Award className="w-8 h-8 text-blue-500 mx-auto mb-2" />
                      <div className="text-2xl font-bold text-white">?</div>
                      <div className="text-sm text-gray-400">Podium Finishes</div>
                    </div>
                  </div>
                  
                  <div className="text-center py-8">
                    <p className="text-gray-400">
                      Team history and achievements data would be displayed here,
                      including championship years, notable drivers, and major milestones.
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="technical">
            <Card className="bg-gray-800 border-gray-700">
              <CardHeader>
                <CardTitle className="text-white flex items-center gap-2">
                  <Car className="w-5 h-5 text-orange-500" />
                  Technical Specifications
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-4">
                    <h3 className="text-lg font-semibold text-white">Car Details</h3>
                    <div className="space-y-3">
                      <div className="flex justify-between">
                        <span className="text-gray-300">Chassis:</span>
                        <span className="text-white font-semibold">{teamData.info.chassis}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-300">Engine:</span>
                        <span className="text-white font-semibold">{teamData.info.engine}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-300">Car Numbers:</span>
                        <span className="text-white font-semibold">{teamData.info.carNumbers.join(', ')}</span>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <h3 className="text-lg font-semibold text-white">Technical Analysis</h3>
                    <div className="text-center py-8">
                      <Zap className="w-12 h-12 text-gray-600 mx-auto mb-4" />
                      <p className="text-gray-400 text-sm">
                        Technical analysis including aerodynamics, 
                        power unit performance, and car development would be shown here.
                      </p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}

