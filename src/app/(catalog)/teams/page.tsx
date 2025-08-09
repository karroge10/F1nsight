'use client'

import { useState, useMemo } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { DriverAvatar } from "@/components/ui/driver-avatar"
import { useDriverStandings } from "@/hooks/use-driver-standings"
import { useF1Schedule } from "@/hooks/use-f1-schedule"
import { Trophy, Users, Car, TrendingUp, Calendar, Award, Target, Building, MapPin, Crown } from "lucide-react"
import Link from 'next/link'

// Team information (this could be moved to a separate data file)
const teamInfo: Record<string, {
  fullName: string
  shortName: string
  founded: number
  base: string
  principal: string
  colors: { primary: string; secondary: string; bg: string; border: string }
}> = {
  "Red Bull Racing": {
    fullName: "Oracle Red Bull Racing",
    shortName: "Red Bull",
    founded: 2005,
    base: "Milton Keynes, UK",
    principal: "Christian Horner",
    colors: { primary: "bg-blue-600", secondary: "text-blue-400", bg: "bg-blue-500/10", border: "border-blue-500" }
  },
  "McLaren": {
    fullName: "McLaren F1 Team",
    shortName: "McLaren",
    founded: 1966,
    base: "Woking, UK",
    principal: "Andrea Stella",
    colors: { primary: "bg-orange-600", secondary: "text-orange-400", bg: "bg-orange-500/10", border: "border-orange-500" }
  },
  "Ferrari": {
    fullName: "Scuderia Ferrari",
    shortName: "Ferrari",
    founded: 1950,
    base: "Maranello, Italy",
    principal: "Frédéric Vasseur",
    colors: { primary: "bg-red-600", secondary: "text-red-400", bg: "bg-red-500/10", border: "border-red-500" }
  },
  "Mercedes": {
    fullName: "Mercedes-AMG Petronas F1 Team",
    shortName: "Mercedes",
    founded: 2010,
    base: "Brackley, UK",
    principal: "Toto Wolff",
    colors: { primary: "bg-cyan-600", secondary: "text-cyan-400", bg: "bg-cyan-500/10", border: "border-cyan-500" }
  },
  "Aston Martin": {
    fullName: "Aston Martin Aramco F1 Team",
    shortName: "Aston Martin",
    founded: 2021,
    base: "Silverstone, UK",
    principal: "Mike Krack",
    colors: { primary: "bg-green-600", secondary: "text-green-400", bg: "bg-green-500/10", border: "border-green-500" }
  },
  "Haas": {
    fullName: "MoneyGram Haas F1 Team",
    shortName: "Haas",
    founded: 2016,
    base: "Kannapolis, USA",
    principal: "Ayao Komatsu",
    colors: { primary: "bg-gray-600", secondary: "text-gray-400", bg: "bg-gray-500/10", border: "border-gray-500" }
  },
  "RB": {
    fullName: "Visa Cash App RB F1 Team",
    shortName: "RB",
    founded: 2006,
    base: "Faenza, Italy",
    principal: "Laurent Mekies",
    colors: { primary: "bg-indigo-600", secondary: "text-indigo-400", bg: "bg-indigo-500/10", border: "border-indigo-500" }
  },
  "Williams": {
    fullName: "Williams Racing",
    shortName: "Williams",
    founded: 1977,
    base: "Grove, UK",
    principal: "James Vowles",
    colors: { primary: "bg-blue-500", secondary: "text-blue-300", bg: "bg-blue-400/10", border: "border-blue-400" }
  },
  "Alpine": {
    fullName: "BWT Alpine F1 Team",
    shortName: "Alpine",
    founded: 2021,
    base: "Enstone, UK",
    principal: "Bruno Famin",
    colors: { primary: "bg-pink-600", secondary: "text-pink-400", bg: "bg-pink-500/10", border: "border-pink-500" }
  },
  "Sauber": {
    fullName: "Stake F1 Team Kick Sauber",
    shortName: "Sauber",
    founded: 1993,
    base: "Hinwil, Switzerland",
    principal: "Alessandro Alunni Bravi",
    colors: { primary: "bg-green-700", secondary: "text-green-500", bg: "bg-green-600/10", border: "border-green-600" }
  }
}

export default function TeamsPage() {
  const currentYear = new Date().getFullYear()
  const [selectedYear, setSelectedYear] = useState(currentYear)
  
  const { data: drivers, loading, error } = useDriverStandings(selectedYear)
  const { data: schedule } = useF1Schedule(selectedYear)

  // Generate years for dropdown (2020-current year)
  const availableYears = Array.from({ length: currentYear - 2019 }, (_, i) => currentYear - i)

  // Calculate team standings from driver data
  const teamStandings = useMemo(() => {
    const teams: Record<string, {
      name: string
      drivers: any[]
      points: number
      info: any
    }> = {}

    drivers.forEach(driver => {
      if (!teams[driver.team]) {
        teams[driver.team] = {
          name: driver.team,
          drivers: [],
          points: 0,
          info: teamInfo[driver.team] || {
            fullName: driver.team,
            shortName: driver.team,
            founded: 2000,
            base: "Unknown",
            principal: "Unknown",
            colors: { primary: "bg-gray-600", secondary: "text-gray-400", bg: "bg-gray-500/10", border: "border-gray-500" }
          }
        }
      }
      teams[driver.team].drivers.push(driver)
      teams[driver.team].points += driver.points
    })

    return Object.values(teams)
      .sort((a, b) => b.points - a.points)
      .map((team, index) => ({ ...team, position: index + 1 }))
  }, [drivers])

  // Calculate championship stats
  const championshipStats = useMemo(() => {
    const completedRaces = schedule.filter(race => 
      new Date(race.session5_date || race.event_date) < new Date()
    ).length

    return {
      leadingTeam: teamStandings[0]?.name || 'Unknown',
      leadingPoints: teamStandings[0]?.points || 0,
      totalRaces: schedule.length,
      completedRaces,
      activeTeams: teamStandings.length
    }
  }, [teamStandings, schedule])

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-red-900/20 to-gray-900">
        <div className="container mx-auto px-4 py-8">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {Array.from({ length: 10 }).map((_, i) => (
              <div key={i} className="h-96 bg-gray-800 rounded-lg animate-pulse" />
            ))}
          </div>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-red-900/20 to-gray-900">
        <div className="container mx-auto px-4 py-8">
          <div className="text-center">
            <h1 className="text-4xl font-bold text-white mb-4">Error Loading Teams</h1>
            <p className="text-gray-400">{error}</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-red-900/20 to-gray-900">
      <div className="container mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-8">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 mb-6">
            <div>
              <div className="flex items-center gap-3 mb-4">
                <Car className="w-8 h-8 text-red-500" />
                <h1 className="text-4xl font-bold text-white">F1 Teams {selectedYear}</h1>
              </div>
              <p className="text-gray-300">Constructor Championship standings and team information</p>
            </div>
            
            {/* Year Selection */}
            <div className="flex flex-col gap-2">
              <label className="text-sm text-gray-400">Season</label>
              <Select value={selectedYear.toString()} onValueChange={(value) => setSelectedYear(parseInt(value))}>
                <SelectTrigger className="w-32 bg-gray-800 border-gray-700 text-white">
                  <Calendar className="w-4 h-4 mr-2" />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-gray-800 border-gray-700">
                  {availableYears.map(year => (
                    <SelectItem key={year} value={year.toString()} className="text-white hover:bg-gray-700">
                      {year}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Season Overview */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
            <Card className="bg-gray-800/50 border-gray-700">
              <CardContent className="p-4 text-center">
                <Car className="w-6 h-6 text-blue-500 mx-auto mb-2" />
                <div className="text-2xl font-bold text-white">{championshipStats.activeTeams}</div>
                <div className="text-sm text-gray-400">Active Teams</div>
              </CardContent>
            </Card>
            <Card className="bg-gray-800/50 border-gray-700">
              <CardContent className="p-4 text-center">
                <Trophy className="w-6 h-6 text-yellow-500 mx-auto mb-2" />
                <div className="text-2xl font-bold text-white">{championshipStats.leadingPoints}</div>
                <div className="text-sm text-gray-400">Leader Points</div>
              </CardContent>
            </Card>
            <Card className="bg-gray-800/50 border-gray-700">
              <CardContent className="p-4 text-center">
                <Award className="w-6 h-6 text-green-500 mx-auto mb-2" />
                <div className="text-2xl font-bold text-white">{championshipStats.completedRaces}</div>
                <div className="text-sm text-gray-400">Races Complete</div>
              </CardContent>
            </Card>
            <Card className="bg-gray-800/50 border-gray-700">
              <CardContent className="p-4 text-center">
                <Target className="w-6 h-6 text-purple-500 mx-auto mb-2" />
                <div className="text-2xl font-bold text-white">{championshipStats.totalRaces - championshipStats.completedRaces}</div>
                <div className="text-sm text-gray-400">Races Left</div>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Teams Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {teamStandings.map((team, index) => {
            const isChampionshipLeader = team.position === 1
            const isTopThree = team.position <= 3
            
            return (
              <Link key={team.name} href={`/teams/${encodeURIComponent(team.name.toLowerCase().replace(/\s+/g, '-'))}`}>
                <Card 
                  className={`bg-gray-800 border-2 ${team.info.colors.border} ${team.info.colors.bg} hover:scale-105 hover:shadow-2xl transition-all duration-500 cursor-pointer group relative overflow-hidden`}
                >
                  {/* Championship Leader Crown */}
                  {isChampionshipLeader && (
                    <div className="absolute top-2 left-2 z-10">
                      <Crown className="w-6 h-6 text-yellow-500 animate-pulse" />
                    </div>
                  )}
                  
                  {/* Position Badge */}
                  <div className="absolute top-2 right-2 z-10">
                    <Badge 
                      className={`${isTopThree ? 'bg-yellow-600' : 'bg-gray-600'} text-white font-bold`}
                    >
                      #{team.position}
                    </Badge>
                  </div>

                  <CardHeader className="pt-8">
                    <div className="flex items-center gap-3 mb-4">
                      <div className={`w-1 h-16 rounded ${team.info.colors.primary}`} />
                      <div className="flex-1">
                        <CardTitle className="text-white text-xl transition-colors duration-300">
                          {team.info.shortName}
                        </CardTitle>
                        <p className="text-gray-400 text-sm">{team.info.fullName}</p>
                      </div>
                    </div>
                  </CardHeader>
                  
                  <CardContent className="space-y-4">
                    {/* Drivers */}
                    <div>
                      <div className="flex items-center gap-2 mb-3">
                        <Users className="w-4 h-4 text-blue-400" />
                        <span className="text-sm font-semibold text-gray-300">Drivers</span>
                      </div>
                      <div className="flex gap-3">
                        {team.drivers.map((driver) => (
                          <Link 
                            key={driver.name} 
                            href={`/drivers/${encodeURIComponent(driver.name.toLowerCase().replace(/\s+/g, '-'))}`}
                            className="flex items-center gap-2 p-2 bg-gray-700/50 rounded-lg hover:bg-gray-700 transition-colors group/driver"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <DriverAvatar driverName={driver.name} size="sm" />
                            <div>
                              <div className="text-white text-sm font-medium group-hover/driver:text-yellow-400 transition-colors">
                                {driver.name.split(' ')[1] || driver.name}
                              </div>
                              <div className="text-xs text-gray-400">P{driver.position} • {driver.points}pts</div>
                            </div>
                          </Link>
                        ))}
                      </div>
                    </div>

                    {/* Team Points - Prominent Display */}
                    <div className="text-center p-4 bg-gray-700/50 rounded-lg">
                      <div className="text-3xl font-bold text-white">{team.points}</div>
                      <div className="text-sm text-gray-400">Championship Points</div>
                    </div>

                    {/* Team Info */}
                    <div className="space-y-3">
                      <div className="flex items-center gap-2">
                        <Calendar className="w-4 h-4 text-purple-400" />
                        <span className="text-gray-400 text-sm">Founded:</span>
                        <span className="text-gray-300 text-sm">{team.info.founded}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <MapPin className="w-4 h-4 text-green-400" />
                        <span className="text-gray-400 text-sm">Base:</span>
                        <span className="text-gray-300 text-sm">{team.info.base}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Building className="w-4 h-4 text-blue-400" />
                        <span className="text-gray-400 text-sm">Principal:</span>
                        <span className="text-gray-300 text-sm">{team.info.principal}</span>
                      </div>
                    </div>

                    <Button className="w-full mt-4 bg-gray-700 hover:bg-gray-600 text-white hover:scale-105 transition-all duration-300 group-hover:shadow-lg">
                      View Team Profile
                    </Button>
                  </CardContent>
                </Card>
              </Link>
            )
          })}
        </div>

        {/* Enhanced Championship Progress */}
        <div className="mt-12">
          <Card className="bg-gray-800 border-gray-700">
            <CardHeader>
              <CardTitle className="text-white flex items-center gap-2">
                <Trophy className="w-5 h-5 text-yellow-500" />
                Constructor Championship Battle {selectedYear}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-6">
                {/* Top 5 Teams Progress */}
                <div className="space-y-4">
                  {teamStandings.slice(0, 5).map((team, index) => {
                    const maxPoints = teamStandings[0]?.points || 1
                    const pointsWidth = (team.points / maxPoints) * 100
                    const gapToLeader = teamStandings[0].points - team.points
                    
                    return (
                      <div key={team.name} className="space-y-2">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <div className="text-lg font-bold text-white w-6">{team.position}</div>
                            <div className={`w-1 h-8 rounded ${team.info.colors.primary}`} />
                            <div>
                              <div className="font-semibold text-white">{team.info.shortName}</div>
                              <div className="text-sm text-gray-400">{team.drivers.length} drivers</div>
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="text-xl font-bold text-white">{team.points}</div>
                            {index > 0 && (
                              <div className="text-sm text-red-400">-{gapToLeader}</div>
                            )}
                          </div>
                        </div>
                        
                        <div className="w-full bg-gray-700 rounded-full h-2">
                          <div 
                            className={`h-2 rounded-full ${team.info.colors.primary} transition-all duration-1000`}
                            style={{ width: `${pointsWidth}%` }}
                          />
                        </div>
                      </div>
                    )
                  })}
                </div>

                {/* Championship Summary */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-6 border-t border-gray-700">
                  <div className="text-center">
                    <div className="text-3xl font-bold text-yellow-500 mb-2">{championshipStats.leadingTeam}</div>
                    <div className="text-gray-300">Championship Leader</div>
                    <div className="text-sm text-gray-500">{championshipStats.leadingPoints} points</div>
                  </div>
                  <div className="text-center">
                    <div className="text-3xl font-bold text-green-500 mb-2">{championshipStats.completedRaces}</div>
                    <div className="text-gray-300">Races Completed</div>
                    <div className="text-sm text-gray-500">of {championshipStats.totalRaces} total</div>
                  </div>
                  <div className="text-center">
                    <div className="text-3xl font-bold text-blue-500 mb-2">{championshipStats.activeTeams}</div>
                    <div className="text-gray-300">Active Teams</div>
                    <div className="text-sm text-gray-500">{selectedYear} season</div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Quick Stats Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <Card className="bg-gray-800/50 border-gray-700">
            <CardContent className="p-4 text-center">
              <Car className="w-6 h-6 text-blue-500 mx-auto mb-2" />
              <div className="text-2xl font-bold text-white">{championshipStats.activeTeams}</div>
              <div className="text-sm text-gray-400">Active Teams</div>
            </CardContent>
          </Card>
          <Card className="bg-gray-800/50 border-gray-700">
            <CardContent className="p-4 text-center">
              <Trophy className="w-6 h-6 text-yellow-500 mx-auto mb-2" />
              <div className="text-2xl font-bold text-white">{championshipStats.leadingPoints}</div>
              <div className="text-sm text-gray-400">Leader Points</div>
            </CardContent>
          </Card>
          <Card className="bg-gray-800/50 border-gray-700">
            <CardContent className="p-4 text-center">
              <Award className="w-6 h-6 text-green-500 mx-auto mb-2" />
              <div className="text-2xl font-bold text-white">{championshipStats.completedRaces}</div>
              <div className="text-sm text-gray-400">Races Complete</div>
            </CardContent>
          </Card>
          <Card className="bg-gray-800/50 border-gray-700">
            <CardContent className="p-4 text-center">
              <Target className="w-6 h-6 text-purple-500 mx-auto mb-2" />
              <div className="text-2xl font-bold text-white">{championshipStats.totalRaces - championshipStats.completedRaces}</div>
              <div className="text-sm text-gray-400">Races Left</div>
            </CardContent>
          </Card>
        </div>

        {/* Teams Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {teamStandings.map((team, index) => {
            const isChampionshipLeader = team.position === 1
            const isTopThree = team.position <= 3
            
            return (
              <Link key={team.name} href={`/teams/${encodeURIComponent(team.name.toLowerCase().replace(/\s+/g, '-'))}`}>
                <Card 
                  className={`bg-gray-800 border-2 ${team.info.colors.border} ${team.info.colors.bg} hover:scale-105 hover:shadow-2xl transition-all duration-500 cursor-pointer group relative overflow-hidden`}
                >
                  {/* Championship Leader Crown */}
                  {isChampionshipLeader && (
                    <div className="absolute top-2 left-2 z-10">
                      <Crown className="w-6 h-6 text-yellow-500 animate-pulse" />
                    </div>
                  )}
                  
                  {/* Position Badge */}
                  <div className="absolute top-2 right-2 z-10">
                    <Badge 
                      className={`${isTopThree ? 'bg-yellow-600' : 'bg-gray-600'} text-white font-bold`}
                    >
                      #{team.position}
                    </Badge>
                  </div>

                  <CardHeader className="pt-8">
                    <div className="flex items-center gap-3 mb-4">
                      <div className={`w-1 h-16 rounded ${team.info.colors.primary}`} />
                      <div className="flex-1">
                        <CardTitle className="text-white text-xl transition-colors duration-300">
                          {team.info.shortName}
                        </CardTitle>
                        <p className="text-gray-400 text-sm">{team.info.fullName}</p>
                      </div>
                    </div>
                  </CardHeader>
                  
                  <CardContent className="space-y-4">
                    {/* Drivers */}
                    <div>
                      <div className="flex items-center gap-2 mb-3">
                        <Users className="w-4 h-4 text-blue-400" />
                        <span className="text-sm font-semibold text-gray-300">Drivers</span>
                      </div>
                      <div className="flex gap-3">
                        {team.drivers.map((driver) => (
                          <Link 
                            key={driver.name} 
                            href={`/drivers/${encodeURIComponent(driver.name.toLowerCase().replace(/\s+/g, '-'))}`}
                            className="flex items-center gap-2 p-2 bg-gray-700/50 rounded-lg hover:bg-gray-700 transition-colors group/driver"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <DriverAvatar driverName={driver.name} size="sm" />
                            <div>
                              <div className="text-white text-sm font-medium group-hover/driver:text-yellow-400 transition-colors">
                                {driver.name.split(' ')[1] || driver.name}
                              </div>
                              <div className="text-xs text-gray-400">P{driver.position} • {driver.points}pts</div>
                            </div>
                          </Link>
                        ))}
                      </div>
                    </div>

                    {/* Team Points - Prominent Display */}
                    <div className="text-center p-4 bg-gray-700/50 rounded-lg">
                      <div className="text-3xl font-bold text-white">{team.points}</div>
                      <div className="text-sm text-gray-400">Championship Points</div>
                    </div>

                    {/* Team Info */}
                    <div className="space-y-3">
                      <div className="flex items-center gap-2">
                        <Calendar className="w-4 h-4 text-purple-400" />
                        <span className="text-gray-400 text-sm">Founded:</span>
                        <span className="text-gray-300 text-sm">{team.info.founded}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <MapPin className="w-4 h-4 text-green-400" />
                        <span className="text-gray-400 text-sm">Base:</span>
                        <span className="text-gray-300 text-sm">{team.info.base}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Building className="w-4 h-4 text-blue-400" />
                        <span className="text-gray-400 text-sm">Principal:</span>
                        <span className="text-gray-300 text-sm">{team.info.principal}</span>
                      </div>
                    </div>

                    <Button className="w-full mt-4 bg-gray-700 hover:bg-gray-600 text-white hover:scale-105 transition-all duration-300 group-hover:shadow-lg">
                      View Team Profile
                    </Button>
                  </CardContent>
                </Card>
              </Link>
            )
          })}
        </div>

        {/* Enhanced Championship Progress */}
        <div className="mt-12">
          <Card className="bg-gray-800 border-gray-700">
            <CardHeader>
              <CardTitle className="text-white flex items-center gap-2">
                <Trophy className="w-5 h-5 text-yellow-500" />
                Constructor Championship Battle {selectedYear}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-6">
                {/* Top 5 Teams Progress */}
                <div className="space-y-4">
                  {teamStandings.slice(0, 5).map((team, index) => {
                    const maxPoints = teamStandings[0]?.points || 1
                    const pointsWidth = (team.points / maxPoints) * 100
                    const gapToLeader = teamStandings[0].points - team.points
                    
                    return (
                      <div key={team.name} className="space-y-2">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <div className="text-lg font-bold text-white w-6">{team.position}</div>
                            <div className={`w-1 h-8 rounded ${team.info.colors.primary}`} />
                            <div>
                              <div className="font-semibold text-white">{team.info.shortName}</div>
                              <div className="text-sm text-gray-400">{team.drivers.length} drivers</div>
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="text-xl font-bold text-white">{team.points}</div>
                            {index > 0 && (
                              <div className="text-sm text-red-400">-{gapToLeader}</div>
                            )}
                          </div>
                        </div>
                        
                        <div className="w-full bg-gray-700 rounded-full h-2">
                          <div 
                            className={`h-2 rounded-full ${team.info.colors.primary} transition-all duration-1000`}
                            style={{ width: `${pointsWidth}%` }}
                          />
                        </div>
                      </div>
                    )
                  })}
                </div>

                {/* Championship Summary */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-6 border-t border-gray-700">
                  <div className="text-center">
                    <div className="text-3xl font-bold text-yellow-500 mb-2">{championshipStats.leadingTeam}</div>
                    <div className="text-gray-300">Championship Leader</div>
                    <div className="text-sm text-gray-500">{championshipStats.leadingPoints} points</div>
                  </div>
                  <div className="text-center">
                    <div className="text-3xl font-bold text-green-500 mb-2">{championshipStats.completedRaces}</div>
                    <div className="text-gray-300">Races Completed</div>
                    <div className="text-sm text-gray-500">of {championshipStats.totalRaces} total</div>
                  </div>
                  <div className="text-center">
                    <div className="text-3xl font-bold text-blue-500 mb-2">{championshipStats.activeTeams}</div>
                    <div className="text-gray-300">Active Teams</div>
                    <div className="text-sm text-gray-500">{selectedYear} season</div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}


