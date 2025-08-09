'use client'

import { useState, useMemo } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { DriverAvatar } from '@/components/ui/driver-avatar'
import { useDriverStandings } from '@/hooks/use-driver-standings'
import { Trophy, Flag, Calendar, TrendingUp, Search, Filter, Users, Award, Target, Zap } from 'lucide-react'
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
  const colors: Record<string, { border: string; bg: string; accent: string }> = {
    "Red Bull Racing": { border: "border-blue-500", bg: "bg-blue-500/10", accent: "text-blue-400" },
    "McLaren": { border: "border-orange-500", bg: "bg-orange-500/10", accent: "text-orange-400" },
    "Ferrari": { border: "border-red-500", bg: "bg-red-500/10", accent: "text-red-400" },
    "Mercedes": { border: "border-cyan-400", bg: "bg-cyan-400/10", accent: "text-cyan-400" },
    "Aston Martin": { border: "border-green-500", bg: "bg-green-500/10", accent: "text-green-400" },
    "Haas": { border: "border-gray-500", bg: "bg-gray-500/10", accent: "text-gray-400" },
    "RB": { border: "border-indigo-500", bg: "bg-indigo-500/10", accent: "text-indigo-400" },
    "Williams": { border: "border-blue-400", bg: "bg-blue-400/10", accent: "text-blue-300" },
    "Alpine": { border: "border-pink-500", bg: "bg-pink-500/10", accent: "text-pink-400" },
    "Sauber": { border: "border-green-600", bg: "bg-green-600/10", accent: "text-green-500" }
  };
  return colors[team] || { border: "border-gray-600", bg: "bg-gray-600/10", accent: "text-gray-400" };
}

export default function DriversPage() {
  const currentYear = new Date().getFullYear();
  const { data: drivers, loading, error } = useDriverStandings(currentYear);
  
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedTeam, setSelectedTeam] = useState<string>('all');
  const [sortBy, setSortBy] = useState<string>('position');

  // Get unique teams for filter
  const teams = useMemo(() => {
    const uniqueTeams = Array.from(new Set(drivers.map(driver => driver.team)));
    return uniqueTeams.sort();
  }, [drivers]);

  // Filter and sort drivers
  const filteredAndSortedDrivers = useMemo(() => {
    let filtered = drivers.filter(driver => {
      const matchesSearch = driver.name.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesTeam = selectedTeam === 'all' || driver.team === selectedTeam;
      return matchesSearch && matchesTeam;
    });

    // Sort drivers
    filtered.sort((a, b) => {
      switch (sortBy) {
        case 'position':
          return a.position - b.position;
        case 'points':
          return b.points - a.points;
        case 'name':
          return a.name.localeCompare(b.name);
        case 'team':
          return a.team.localeCompare(b.team);
        default:
          return a.position - b.position;
      }
    });

    return filtered;
  }, [drivers, searchTerm, selectedTeam, sortBy]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-red-900/20 to-gray-900">
        <div className="container mx-auto px-4 py-8">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {Array.from({ length: 20 }).map((_, i) => (
              <div key={i} className="h-96 bg-gray-800 rounded-lg animate-pulse" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-red-900/20 to-gray-900">
        <div className="container mx-auto px-4 py-8">
          <div className="text-center">
            <h1 className="text-4xl font-bold text-white mb-4">Error Loading Drivers</h1>
            <p className="text-gray-400">{error}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-red-900/20 to-gray-900">
      <div className="container mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-4">
            <Users className="w-8 h-8 text-red-500" />
            <h1 className="text-4xl font-bold text-white">F1 Drivers {currentYear}</h1>
          </div>
          <p className="text-gray-300 mb-6">Current Formula 1 World Championship standings and driver profiles</p>
          
          {/* Search and Filters */}
          <div className="flex flex-col lg:flex-row gap-4">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-3 w-4 h-4 text-gray-400" />
              <Input 
                placeholder="Search drivers..." 
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="bg-gray-800 border-gray-700 text-white pl-10"
              />
            </div>
            
            <div className="flex gap-4">
              <Select value={selectedTeam} onValueChange={setSelectedTeam}>
                <SelectTrigger className="w-48 bg-gray-800 border-gray-700 text-white">
                  <Filter className="w-4 h-4 mr-2" />
                  <SelectValue placeholder="Filter by Team" />
                </SelectTrigger>
                <SelectContent className="bg-gray-800 border-gray-700">
                  <SelectItem value="all" className="text-white hover:bg-gray-700">All Teams</SelectItem>
                  {teams.map(team => (
                    <SelectItem key={team} value={team} className="text-white hover:bg-gray-700">
                      {team}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              
              <Select value={sortBy} onValueChange={setSortBy}>
                <SelectTrigger className="w-48 bg-gray-800 border-gray-700 text-white">
                  <TrendingUp className="w-4 h-4 mr-2" />
                  <SelectValue placeholder="Sort by" />
                </SelectTrigger>
                <SelectContent className="bg-gray-800 border-gray-700">
                  <SelectItem value="position" className="text-white hover:bg-gray-700">Championship Position</SelectItem>
                  <SelectItem value="points" className="text-white hover:bg-gray-700">Points</SelectItem>
                  <SelectItem value="name" className="text-white hover:bg-gray-700">Name</SelectItem>
                  <SelectItem value="team" className="text-white hover:bg-gray-700">Team</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        {/* Stats Overview */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <Card className="bg-gray-800/50 border-gray-700">
            <CardContent className="p-4 text-center">
              <Users className="w-6 h-6 text-blue-500 mx-auto mb-2" />
              <div className="text-2xl font-bold text-white">{drivers.length}</div>
              <div className="text-sm text-gray-400">Active Drivers</div>
            </CardContent>
          </Card>
          <Card className="bg-gray-800/50 border-gray-700">
            <CardContent className="p-4 text-center">
              <Trophy className="w-6 h-6 text-yellow-500 mx-auto mb-2" />
              <div className="text-2xl font-bold text-white">{teams.length}</div>
              <div className="text-sm text-gray-400">Teams</div>
            </CardContent>
          </Card>
          <Card className="bg-gray-800/50 border-gray-700">
            <CardContent className="p-4 text-center">
              <Award className="w-6 h-6 text-green-500 mx-auto mb-2" />
              <div className="text-2xl font-bold text-white">{drivers[0]?.points || 0}</div>
              <div className="text-sm text-gray-400">Leader Points</div>
            </CardContent>
          </Card>
          <Card className="bg-gray-800/50 border-gray-700">
            <CardContent className="p-4 text-center">
              <Target className="w-6 h-6 text-purple-500 mx-auto mb-2" />
              <div className="text-2xl font-bold text-white">{filteredAndSortedDrivers.length}</div>
              <div className="text-sm text-gray-400">Showing</div>
            </CardContent>
          </Card>
        </div>

        {/* Drivers Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {filteredAndSortedDrivers.map((driver, index) => {
            const teamColors = getTeamColor(driver.team);
            const isChampionshipLeader = driver.position === 1;
            const isTopThree = driver.position <= 3;
            
            return (
              <Link key={driver.name} href={`/drivers/${encodeURIComponent(driver.name.toLowerCase().replace(/\s+/g, '-'))}`}>
                <Card 
                  className={`bg-gray-800 border-2 ${teamColors.border} ${teamColors.bg} hover:scale-105 hover:shadow-2xl transition-all duration-500 cursor-pointer group relative overflow-hidden`}
                >
                  {/* Championship Leader Crown */}
                  {isChampionshipLeader && (
                    <div className="absolute top-2 left-2 z-10">
                      <Trophy className="w-6 h-6 text-yellow-500 animate-pulse" />
                    </div>
                  )}
                  
                  {/* Position Badge */}
                  <div className="absolute top-2 right-2 z-10">
                    <Badge 
                      className={`${isTopThree ? 'bg-yellow-600' : 'bg-gray-600'} text-white font-bold`}
                    >
                      P{driver.position}
                    </Badge>
                  </div>

                  <CardHeader className="text-center pt-8">
                    <div className="relative mx-auto mb-4">
                      <DriverAvatar 
                        driverName={driver.name} 
                        size="lg"
                        className="group-hover:scale-110 transition-transform duration-500 border-4 border-gray-600 group-hover:border-gray-400"
                      />
                    </div>
                    <CardTitle className={`text-white text-xl group-hover:${teamColors.accent} transition-colors duration-300`}>
                      {driver.name}
                    </CardTitle>
                    <p className={`${teamColors.accent} font-medium group-hover:text-white transition-colors duration-300`}>
                      {driver.team}
                    </p>
                  </CardHeader>
                  
                  <CardContent className="space-y-4">
                    {/* Nationality */}
                    <div className="flex items-center justify-center gap-2">
                      <span className="text-2xl">{getCountryFlag(driver.nationality)}</span>
                      <span className="text-gray-300 text-sm">{driver.nationality}</span>
                    </div>

                    {/* Points - Prominent Display */}
                    <div className="text-center p-4 bg-gray-700/50 rounded-lg">
                      <div className="text-3xl font-bold text-white">{driver.points}</div>
                      <div className="text-sm text-gray-400">Championship Points</div>
                    </div>

                    {/* Quick Stats */}
                    <div className="grid grid-cols-2 gap-3 text-center">
                      <div className="p-2 bg-gray-700/30 rounded">
                        <div className="text-lg font-bold text-green-400">
                          {driver.change > 0 ? `+${driver.change}` : driver.change || '–'}
                        </div>
                        <div className="text-xs text-gray-400">Position Change</div>
                      </div>
                      <div className="p-2 bg-gray-700/30 rounded">
                        <Zap className="w-5 h-5 mx-auto text-yellow-400 mb-1" />
                        <div className="text-xs text-gray-400">Performance</div>
                      </div>
                    </div>

                    <Button className={`w-full mt-4 bg-gray-700 hover:bg-gray-600 text-white hover:scale-105 transition-all duration-300 group-hover:shadow-lg group-hover:${teamColors.bg}`}>
                      View Profile
                    </Button>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>

        {/* No Results */}
        {filteredAndSortedDrivers.length === 0 && (
          <div className="text-center py-12">
            <Users className="w-16 h-16 text-gray-600 mx-auto mb-4" />
            <h3 className="text-xl font-semibold text-white mb-2">No drivers found</h3>
            <p className="text-gray-400">Try adjusting your search or filter criteria.</p>
          </div>
        )}
      </div>
    </div>
  );
}