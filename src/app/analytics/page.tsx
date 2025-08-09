'use client'

import { useState, Suspense } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { WDCCalculator } from "@/components/wdc-calculator";
import { DriverAvatar } from "@/components/ui/driver-avatar";
import { RacePerformanceTracker } from "@/components/race-performance-tracker";
import { useDriverStandings } from "@/hooks/use-driver-standings";
import { useF1Schedule } from "@/hooks/use-f1-schedule";
import { 
  BarChart3, 
  TrendingUp, 
  Trophy, 
  Zap, 
  Target, 
  Clock,
  Calendar,
  Users,
  Award,
  Activity,
  PieChart,
  LineChart
} from "lucide-react";

export default function AnalyticsPage() {
  const currentYear = new Date().getFullYear();
  const [selectedYear, setSelectedYear] = useState(currentYear);
  const [selectedRace, setSelectedRace] = useState<string>('all');
  
  const { data: standings, loading: standingsLoading } = useDriverStandings(selectedYear);
  const { data: schedule, loading: scheduleLoading } = useF1Schedule(selectedYear);

  // Calculate analytics data
  const completedRaces = schedule.filter(race => 
    new Date(race.session5_date || race.event_date) < new Date()
  );
  
  const upcomingRaces = schedule.filter(race => 
    new Date(race.session5_date || race.event_date) > new Date()
  );

  // Generate years for dropdown (2020-current year)
  const availableYears = Array.from({ length: currentYear - 2019 }, (_, i) => currentYear - i);

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-red-900/20 to-gray-900">
      <div className="container mx-auto px-4 py-8">
        {/* Header with Controls */}
        <div className="mb-8">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-6">
            <div>
              <h1 className="text-4xl font-bold text-white mb-2">F1 Advanced Analytics</h1>
              <p className="text-gray-300">Deep dive into Formula 1 data with interactive analysis</p>
            </div>
            
            {/* Year and Race Selection */}
            <div className="flex gap-4">
              <div className="flex flex-col gap-2">
                <label className="text-sm text-gray-400">Season</label>
                <Select value={selectedYear.toString()} onValueChange={(value) => setSelectedYear(parseInt(value))}>
                  <SelectTrigger className="w-32 bg-gray-800 border-gray-700 text-white">
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
              
              <div className="flex flex-col gap-2">
                <label className="text-sm text-gray-400">Race</label>
                <Select value={selectedRace} onValueChange={setSelectedRace}>
                  <SelectTrigger className="w-48 bg-gray-800 border-gray-700 text-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-gray-800 border-gray-700">
                    <SelectItem value="all" className="text-white hover:bg-gray-700">All Races</SelectItem>
                    {schedule.map(race => (
                      <SelectItem 
                        key={race.round_number} 
                        value={race.round_number.toString()}
                        className="text-white hover:bg-gray-700"
                      >
                        Round {race.round_number}: {race.location}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          {/* Season Overview Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
            <Card className="bg-gray-800/50 border-gray-700">
              <CardContent className="p-4">
                <div className="flex items-center gap-2">
                  <Trophy className="w-5 h-5 text-yellow-500" />
                  <div>
                    <div className="text-2xl font-bold text-white">{completedRaces.length}</div>
                    <div className="text-xs text-gray-400">Races Complete</div>
                  </div>
                </div>
              </CardContent>
            </Card>
            
            <Card className="bg-gray-800/50 border-gray-700">
              <CardContent className="p-4">
                <div className="flex items-center gap-2">
                  <Calendar className="w-5 h-5 text-blue-500" />
                  <div>
                    <div className="text-2xl font-bold text-white">{upcomingRaces.length}</div>
                    <div className="text-xs text-gray-400">Races Left</div>
                  </div>
                </div>
              </CardContent>
            </Card>
            
            <Card className="bg-gray-800/50 border-gray-700">
              <CardContent className="p-4">
                <div className="flex items-center gap-2">
                  <Users className="w-5 h-5 text-green-500" />
                  <div>
                    <div className="text-2xl font-bold text-white">{standings.length}</div>
                    <div className="text-xs text-gray-400">Active Drivers</div>
                  </div>
                </div>
              </CardContent>
            </Card>
            
            <Card className="bg-gray-800/50 border-gray-700">
              <CardContent className="p-4">
                <div className="flex items-center gap-2">
                  <Award className="w-5 h-5 text-purple-500" />
                  <div>
                    <div className="text-2xl font-bold text-white">{standings[0]?.points || 0}</div>
                    <div className="text-xs text-gray-400">Leader Points</div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Analytics Tabs */}
        <Tabs defaultValue="championship" className="space-y-6">
          <TabsList className="bg-gray-800 border-gray-700">
            <TabsTrigger value="championship" className="data-[state=active]:bg-red-600">
              Championship Analysis
            </TabsTrigger>
            <TabsTrigger value="performance" className="data-[state=active]:bg-red-600">
              Performance Metrics  
            </TabsTrigger>
            <TabsTrigger value="trends" className="data-[state=active]:bg-red-600">
              Season Trends
            </TabsTrigger>
            <TabsTrigger value="comparison" className="data-[state=active]:bg-red-600">
              Team Comparison
            </TabsTrigger>
            <TabsTrigger value="race-tracker" className="data-[state=active]:bg-red-600">
              Race Tracker
            </TabsTrigger>
          </TabsList>

          <TabsContent value="championship" className="space-y-6">
            {/* WDC Calculator */}
            <Suspense fallback={<div className="h-96 bg-gray-800 rounded-lg animate-pulse" />}>
              <WDCCalculator />
            </Suspense>

            {/* Championship Battle Visualization */}
            <ChampionshipBattle standings={standings} loading={standingsLoading} />
          </TabsContent>

          <TabsContent value="performance" className="space-y-6">
            <PerformanceMetrics standings={standings} schedule={schedule} loading={standingsLoading || scheduleLoading} />
          </TabsContent>

          <TabsContent value="trends" className="space-y-6">
            <SeasonTrends standings={standings} schedule={schedule} loading={standingsLoading || scheduleLoading} />
          </TabsContent>

          <TabsContent value="comparison" className="space-y-6">
            <TeamComparison standings={standings} loading={standingsLoading} />
          </TabsContent>

          <TabsContent value="race-tracker" className="space-y-6">
            <RacePerformanceTracker 
              standings={standings} 
              schedule={schedule} 
            />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

// Championship Battle Component
function ChampionshipBattle({ standings, loading }: { standings: any[], loading: boolean }) {
  if (loading) {
    return <div className="h-64 bg-gray-800 rounded-lg animate-pulse" />;
  }

  const top5 = standings.slice(0, 5);
  const maxPoints = standings[0]?.points || 1;

  return (
    <Card className="bg-gray-800 border-gray-700">
      <CardHeader>
        <CardTitle className="text-white flex items-center gap-2">
          <Trophy className="w-5 h-5 text-yellow-500" />
          Championship Battle - Top 5
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {top5.map((driver, index) => {
            const pointsWidth = (driver.points / maxPoints) * 100;
            const gapToLeader = standings[0].points - driver.points;
            
            return (
              <div key={driver.position} className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="text-lg font-bold text-white w-6">{driver.position}</div>
                    <DriverAvatar driverName={driver.name} size="sm" />
                    <div>
                      <div className="font-semibold text-white">{driver.name}</div>
                      <div className="text-sm text-gray-400">{driver.team}</div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-xl font-bold text-white">{driver.points}</div>
                    {index > 0 && (
                      <div className="text-sm text-red-400">-{gapToLeader}</div>
                    )}
                  </div>
                </div>
                
                <div className="w-full bg-gray-700 rounded-full h-2">
                  <div 
                    className="bg-gradient-to-r from-red-500 to-red-600 h-2 rounded-full transition-all duration-1000"
                    style={{ width: `${pointsWidth}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

// Performance Metrics Component
function PerformanceMetrics({ standings, schedule, loading }: { standings: any[], schedule: any[], loading: boolean }) {
  if (loading) {
    return <div className="h-64 bg-gray-800 rounded-lg animate-pulse" />;
  }

  const completedRaces = schedule.filter(race => 
    new Date(race.session5_date || race.event_date) < new Date()
  ).length;

  const metrics = standings.slice(0, 10).map(driver => ({
    ...driver,
    pointsPerRace: completedRaces > 0 ? (driver.points / completedRaces).toFixed(1) : '0.0',
    efficiency: completedRaces > 0 ? ((driver.points / (completedRaces * 25)) * 100).toFixed(1) : '0.0'
  }));

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <Card className="bg-gray-800 border-gray-700">
        <CardHeader>
          <CardTitle className="text-white flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-blue-500" />
            Points Per Race
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {metrics.slice(0, 8).map((driver) => (
              <div key={driver.position} className="flex items-center justify-between p-2 rounded bg-gray-700/50">
                <div className="flex items-center gap-3">
                  <DriverAvatar driverName={driver.name} size="sm" />
                  <div>
                    <div className="text-sm font-medium text-white">{driver.name.split(' ')[1] || driver.name}</div>
                    <div className="text-xs text-gray-400">{driver.team}</div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-lg font-bold text-white">{driver.pointsPerRace}</div>
                  <div className="text-xs text-gray-400">pts/race</div>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card className="bg-gray-800 border-gray-700">
        <CardHeader>
          <CardTitle className="text-white flex items-center gap-2">
            <Target className="w-5 h-5 text-green-500" />
            Race Efficiency
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {metrics.slice(0, 8).map((driver) => (
              <div key={driver.position} className="flex items-center justify-between p-2 rounded bg-gray-700/50">
                <div className="flex items-center gap-3">
                  <DriverAvatar driverName={driver.name} size="sm" />
                  <div>
                    <div className="text-sm font-medium text-white">{driver.name.split(' ')[1] || driver.name}</div>
                    <div className="text-xs text-gray-400">{driver.team}</div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-lg font-bold text-white">{driver.efficiency}%</div>
                  <div className="text-xs text-gray-400">efficiency</div>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// Season Trends Component  
function SeasonTrends({ standings, schedule, loading }: { standings: any[], schedule: any[], loading: boolean }) {
  if (loading) {
    return <div className="h-64 bg-gray-800 rounded-lg animate-pulse" />;
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <Card className="bg-gray-800 border-gray-700">
        <CardHeader>
          <CardTitle className="text-white flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-green-500" />
            Momentum Leaders
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {standings.slice(0, 5).map((driver) => (
              <div key={driver.position} className="flex items-center justify-between p-3 rounded bg-gray-700/50">
                <div className="flex items-center gap-3">
                  <DriverAvatar driverName={driver.name} size="sm" />
                  <div>
                    <div className="font-medium text-white">{driver.name}</div>
                    <div className="text-sm text-gray-400">{driver.team}</div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="secondary" className="bg-gray-600/20 text-gray-400">
                    No Trend Data
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card className="bg-gray-800 border-gray-700">
        <CardHeader>
          <CardTitle className="text-white flex items-center gap-2">
            <Activity className="w-5 h-5 text-purple-500" />
            Race Participation
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="text-center">
              <div className="text-3xl font-bold text-white mb-2">{schedule.length}</div>
              <div className="text-sm text-gray-400">Total Races Scheduled</div>
            </div>
            
            <div className="grid grid-cols-2 gap-4 mt-6">
              <div className="text-center p-4 bg-gray-700/50 rounded">
                <div className="text-xl font-bold text-green-400">
                  {schedule.filter(r => new Date(r.session5_date || r.event_date) < new Date()).length}
                </div>
                <div className="text-xs text-gray-400">Completed</div>
              </div>
              <div className="text-center p-4 bg-gray-700/50 rounded">
                <div className="text-xl font-bold text-blue-400">
                  {schedule.filter(r => new Date(r.session5_date || r.event_date) > new Date()).length}
                </div>
                <div className="text-xs text-gray-400">Remaining</div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// Team Comparison Component
function TeamComparison({ standings, loading }: { standings: any[], loading: boolean }) {
  if (loading) {
    return <div className="h-64 bg-gray-800 rounded-lg animate-pulse" />;
  }

  // Calculate team standings
  const teamStandings = standings.reduce((acc: any, driver) => {
    if (!acc[driver.team]) {
      acc[driver.team] = {
        team: driver.team,
        points: 0,
        drivers: []
      };
    }
    acc[driver.team].points += driver.points;
    acc[driver.team].drivers.push(driver);
    return acc;
  }, {});

  const sortedTeams = Object.values(teamStandings)
    .sort((a: any, b: any) => b.points - a.points)
    .slice(0, 10);

  return (
    <Card className="bg-gray-800 border-gray-700">
      <CardHeader>
        <CardTitle className="text-white flex items-center gap-2">
          <PieChart className="w-5 h-5 text-orange-500" />
          Constructors Championship
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {sortedTeams.map((team: any, index) => (
            <div key={team.team} className="p-4 rounded-lg bg-gray-700/50">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className="text-lg font-bold text-white w-6">{index + 1}</div>
                  <div>
                    <div className="font-semibold text-white">{team.team}</div>
                    <div className="text-sm text-gray-400">{team.drivers.length} drivers</div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-xl font-bold text-white">{team.points}</div>
                  <div className="text-sm text-gray-400">points</div>
                </div>
              </div>
              
              <div className="flex gap-2">
                {team.drivers.map((driver: any) => (
                  <div key={driver.name} className="flex items-center gap-2 px-2 py-1 bg-gray-600/50 rounded text-xs">
                    <DriverAvatar driverName={driver.name} size="sm" />
                    <span className="text-white">{driver.name.split(' ')[1] || driver.name}</span>
                    <span className="text-gray-400">({driver.points})</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

        {/* Header with Controls */}
        <div className="mb-8">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-6">
            <div>
              <h1 className="text-4xl font-bold text-white mb-2">F1 Advanced Analytics</h1>
              <p className="text-gray-300">Deep dive into Formula 1 data with interactive analysis</p>
            </div>
            
            {/* Year and Race Selection */}
            <div className="flex gap-4">
              <div className="flex flex-col gap-2">
                <label className="text-sm text-gray-400">Season</label>
                <Select value={selectedYear.toString()} onValueChange={(value) => setSelectedYear(parseInt(value))}>
                  <SelectTrigger className="w-32 bg-gray-800 border-gray-700 text-white">
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
              
              <div className="flex flex-col gap-2">
                <label className="text-sm text-gray-400">Race</label>
                <Select value={selectedRace} onValueChange={setSelectedRace}>
                  <SelectTrigger className="w-48 bg-gray-800 border-gray-700 text-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-gray-800 border-gray-700">
                    <SelectItem value="all" className="text-white hover:bg-gray-700">All Races</SelectItem>
                    {schedule.map(race => (
                      <SelectItem 
                        key={race.round_number} 
                        value={race.round_number.toString()}
                        className="text-white hover:bg-gray-700"
                      >
                        Round {race.round_number}: {race.location}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          {/* Season Overview Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
            <Card className="bg-gray-800/50 border-gray-700">
              <CardContent className="p-4">
                <div className="flex items-center gap-2">
                  <Trophy className="w-5 h-5 text-yellow-500" />
                  <div>
                    <div className="text-2xl font-bold text-white">{completedRaces.length}</div>
                    <div className="text-xs text-gray-400">Races Complete</div>
                  </div>
                </div>
              </CardContent>
            </Card>
            
            <Card className="bg-gray-800/50 border-gray-700">
              <CardContent className="p-4">
                <div className="flex items-center gap-2">
                  <Calendar className="w-5 h-5 text-blue-500" />
                  <div>
                    <div className="text-2xl font-bold text-white">{upcomingRaces.length}</div>
                    <div className="text-xs text-gray-400">Races Left</div>
                  </div>
                </div>
              </CardContent>
            </Card>
            
            <Card className="bg-gray-800/50 border-gray-700">
              <CardContent className="p-4">
                <div className="flex items-center gap-2">
                  <Users className="w-5 h-5 text-green-500" />
                  <div>
                    <div className="text-2xl font-bold text-white">{standings.length}</div>
                    <div className="text-xs text-gray-400">Active Drivers</div>
                  </div>
                </div>
              </CardContent>
            </Card>
            
            <Card className="bg-gray-800/50 border-gray-700">
              <CardContent className="p-4">
                <div className="flex items-center gap-2">
                  <Award className="w-5 h-5 text-purple-500" />
                  <div>
                    <div className="text-2xl font-bold text-white">{standings[0]?.points || 0}</div>
                    <div className="text-xs text-gray-400">Leader Points</div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Analytics Tabs */}
        <Tabs defaultValue="championship" className="space-y-6">
          <TabsList className="bg-gray-800 border-gray-700">
            <TabsTrigger value="championship" className="data-[state=active]:bg-red-600">
              Championship Analysis
            </TabsTrigger>
            <TabsTrigger value="performance" className="data-[state=active]:bg-red-600">
              Performance Metrics  
            </TabsTrigger>
            <TabsTrigger value="trends" className="data-[state=active]:bg-red-600">
              Season Trends
            </TabsTrigger>
            <TabsTrigger value="comparison" className="data-[state=active]:bg-red-600">
              Team Comparison
            </TabsTrigger>
            <TabsTrigger value="race-tracker" className="data-[state=active]:bg-red-600">
              Race Tracker
            </TabsTrigger>
          </TabsList>

          <TabsContent value="championship" className="space-y-6">
            {/* WDC Calculator */}
            <Suspense fallback={<div className="h-96 bg-gray-800 rounded-lg animate-pulse" />}>
              <WDCCalculator />
            </Suspense>

            {/* Championship Battle Visualization */}
            <ChampionshipBattle standings={standings} loading={standingsLoading} />
          </TabsContent>

          <TabsContent value="performance" className="space-y-6">
            <PerformanceMetrics standings={standings} schedule={schedule} loading={standingsLoading || scheduleLoading} />
          </TabsContent>

          <TabsContent value="trends" className="space-y-6">
            <SeasonTrends standings={standings} schedule={schedule} loading={standingsLoading || scheduleLoading} />
          </TabsContent>

          <TabsContent value="comparison" className="space-y-6">
            <TeamComparison standings={standings} loading={standingsLoading} />
          </TabsContent>

          <TabsContent value="race-tracker" className="space-y-6">
            <RacePerformanceTracker 
              standings={standings} 
              schedule={schedule} 
            />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

// Championship Battle Component
function ChampionshipBattle({ standings, loading }: { standings: any[], loading: boolean }) {
  if (loading) {
    return <div className="h-64 bg-gray-800 rounded-lg animate-pulse" />;
  }

  const top5 = standings.slice(0, 5);
  const maxPoints = standings[0]?.points || 1;

  return (
    <Card className="bg-gray-800 border-gray-700">
      <CardHeader>
        <CardTitle className="text-white flex items-center gap-2">
          <Trophy className="w-5 h-5 text-yellow-500" />
          Championship Battle - Top 5
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {top5.map((driver, index) => {
            const pointsWidth = (driver.points / maxPoints) * 100;
            const gapToLeader = standings[0].points - driver.points;
            
            return (
              <div key={driver.position} className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="text-lg font-bold text-white w-6">{driver.position}</div>
                    <DriverAvatar driverName={driver.name} size="sm" />
                    <div>
                      <div className="font-semibold text-white">{driver.name}</div>
                      <div className="text-sm text-gray-400">{driver.team}</div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-xl font-bold text-white">{driver.points}</div>
                    {index > 0 && (
                      <div className="text-sm text-red-400">-{gapToLeader}</div>
                    )}
                  </div>
                </div>
                
                <div className="w-full bg-gray-700 rounded-full h-2">
                  <div 
                    className="bg-gradient-to-r from-red-500 to-red-600 h-2 rounded-full transition-all duration-1000"
                    style={{ width: `${pointsWidth}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

// Performance Metrics Component
function PerformanceMetrics({ standings, schedule, loading }: { standings: any[], schedule: any[], loading: boolean }) {
  if (loading) {
    return <div className="h-64 bg-gray-800 rounded-lg animate-pulse" />;
  }

  const completedRaces = schedule.filter(race => 
    new Date(race.session5_date || race.event_date) < new Date()
  ).length;

  const metrics = standings.slice(0, 10).map(driver => ({
    ...driver,
    pointsPerRace: completedRaces > 0 ? (driver.points / completedRaces).toFixed(1) : '0.0',
    efficiency: completedRaces > 0 ? ((driver.points / (completedRaces * 25)) * 100).toFixed(1) : '0.0'
  }));

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <Card className="bg-gray-800 border-gray-700">
        <CardHeader>
          <CardTitle className="text-white flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-blue-500" />
            Points Per Race
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {metrics.slice(0, 8).map((driver) => (
              <div key={driver.position} className="flex items-center justify-between p-2 rounded bg-gray-700/50">
                <div className="flex items-center gap-3">
                  <DriverAvatar driverName={driver.name} size="sm" />
                  <div>
                    <div className="text-sm font-medium text-white">{driver.name.split(' ')[1] || driver.name}</div>
                    <div className="text-xs text-gray-400">{driver.team}</div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-lg font-bold text-white">{driver.pointsPerRace}</div>
                  <div className="text-xs text-gray-400">pts/race</div>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card className="bg-gray-800 border-gray-700">
        <CardHeader>
          <CardTitle className="text-white flex items-center gap-2">
            <Target className="w-5 h-5 text-green-500" />
            Race Efficiency
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {metrics.slice(0, 8).map((driver) => (
              <div key={driver.position} className="flex items-center justify-between p-2 rounded bg-gray-700/50">
                <div className="flex items-center gap-3">
                  <DriverAvatar driverName={driver.name} size="sm" />
                  <div>
                    <div className="text-sm font-medium text-white">{driver.name.split(' ')[1] || driver.name}</div>
                    <div className="text-xs text-gray-400">{driver.team}</div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-lg font-bold text-white">{driver.efficiency}%</div>
                  <div className="text-xs text-gray-400">efficiency</div>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// Season Trends Component  
function SeasonTrends({ standings, schedule, loading }: { standings: any[], schedule: any[], loading: boolean }) {
  if (loading) {
    return <div className="h-64 bg-gray-800 rounded-lg animate-pulse" />;
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <Card className="bg-gray-800 border-gray-700">
        <CardHeader>
          <CardTitle className="text-white flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-green-500" />
            Momentum Leaders
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {standings.slice(0, 5).map((driver) => (
              <div key={driver.position} className="flex items-center justify-between p-3 rounded bg-gray-700/50">
                <div className="flex items-center gap-3">
                  <DriverAvatar driverName={driver.name} size="sm" />
                  <div>
                    <div className="font-medium text-white">{driver.name}</div>
                    <div className="text-sm text-gray-400">{driver.team}</div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="secondary" className="bg-gray-600/20 text-gray-400">
                    No Trend Data
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card className="bg-gray-800 border-gray-700">
        <CardHeader>
          <CardTitle className="text-white flex items-center gap-2">
            <Activity className="w-5 h-5 text-purple-500" />
            Race Participation
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="text-center">
              <div className="text-3xl font-bold text-white mb-2">{schedule.length}</div>
              <div className="text-sm text-gray-400">Total Races Scheduled</div>
            </div>
            
            <div className="grid grid-cols-2 gap-4 mt-6">
              <div className="text-center p-4 bg-gray-700/50 rounded">
                <div className="text-xl font-bold text-green-400">
                  {schedule.filter(r => new Date(r.session5_date || r.event_date) < new Date()).length}
                </div>
                <div className="text-xs text-gray-400">Completed</div>
              </div>
              <div className="text-center p-4 bg-gray-700/50 rounded">
                <div className="text-xl font-bold text-blue-400">
                  {schedule.filter(r => new Date(r.session5_date || r.event_date) > new Date()).length}
                </div>
                <div className="text-xs text-gray-400">Remaining</div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// Team Comparison Component
function TeamComparison({ standings, loading }: { standings: any[], loading: boolean }) {
  if (loading) {
    return <div className="h-64 bg-gray-800 rounded-lg animate-pulse" />;
  }

  // Calculate team standings
  const teamStandings = standings.reduce((acc: any, driver) => {
    if (!acc[driver.team]) {
      acc[driver.team] = {
        team: driver.team,
        points: 0,
        drivers: []
      };
    }
    acc[driver.team].points += driver.points;
    acc[driver.team].drivers.push(driver);
    return acc;
  }, {});

  const sortedTeams = Object.values(teamStandings)
    .sort((a: any, b: any) => b.points - a.points)
    .slice(0, 10);

  return (
    <Card className="bg-gray-800 border-gray-700">
      <CardHeader>
        <CardTitle className="text-white flex items-center gap-2">
          <PieChart className="w-5 h-5 text-orange-500" />
          Constructors Championship
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {sortedTeams.map((team: any, index) => (
            <div key={team.team} className="p-4 rounded-lg bg-gray-700/50">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className="text-lg font-bold text-white w-6">{index + 1}</div>
                  <div>
                    <div className="font-semibold text-white">{team.team}</div>
                    <div className="text-sm text-gray-400">{team.drivers.length} drivers</div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-xl font-bold text-white">{team.points}</div>
                  <div className="text-sm text-gray-400">points</div>
                </div>
              </div>
              
              <div className="flex gap-2">
                {team.drivers.map((driver: any) => (
                  <div key={driver.name} className="flex items-center gap-2 px-2 py-1 bg-gray-600/50 rounded text-xs">
                    <DriverAvatar driverName={driver.name} size="sm" />
                    <span className="text-white">{driver.name.split(' ')[1] || driver.name}</span>
                    <span className="text-gray-400">({driver.points})</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
