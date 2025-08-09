import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getRaceSessions, getMeetings } from "@/lib/openf1";
import { MapPin, Calendar, Clock, Flag, Trophy, Users } from "lucide-react";

export default async function RacesPage() {
  const year = new Date().getUTCFullYear();
  const [sessions, meetings] = await Promise.all([
    getRaceSessions(year),
    getMeetings(year),
  ]);

  const rows = sessions
    .map((s) => ({
      session: s,
      meeting: meetings.find((m) => m.meeting_key === s.meeting_key),
    }))
    .filter((r) => r.meeting);

  // Group by race weekend
  const raceWeekends = rows.reduce((acc, { session, meeting }) => {
    const key = meeting!.meeting_key;
    if (!acc[key]) {
      acc[key] = {
        meeting: meeting!,
        sessions: []
      };
    }
    acc[key].sessions.push(session);
    return acc;
  }, {} as Record<string, { meeting: any; sessions: any[] }>);

  const weekends = Object.values(raceWeekends).sort((a, b) => 
    new Date(a.sessions[0].date_start).getTime() - new Date(b.sessions[0].date_start).getTime()
  );

  const getSessionType = (sessionName: string) => {
    if (sessionName.includes('Practice')) return { name: 'Practice', color: 'bg-blue-600' };
    if (sessionName.includes('Qualifying')) return { name: 'Qualifying', color: 'bg-yellow-600' };
    if (sessionName.includes('Sprint')) return { name: 'Sprint', color: 'bg-orange-600' };
    if (sessionName.includes('Race')) return { name: 'Race', color: 'bg-red-600' };
    return { name: sessionName, color: 'bg-gray-600' };
  };

  const isUpcoming = (dateStr: string) => new Date(dateStr) > new Date();

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-red-900/20 to-gray-900">
      <div className="container mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-8 opacity-0 animate-[fadeInUp_0.8s_ease-out_0.1s_forwards]">
          <h1 className="text-4xl font-bold text-white mb-4">F1 Season Calendar {year}</h1>
          <p className="text-gray-300">Complete race weekend schedule with all sessions</p>
        </div>

        {/* Season Stats */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-12 opacity-0 animate-[fadeInUp_0.8s_ease-out_0.3s_forwards]">
          <Card className="bg-gray-800 border-gray-700 text-center">
            <CardContent className="p-6">
              <Trophy className="w-8 h-8 text-yellow-500 mx-auto mb-2" />
              <div className="text-2xl font-bold text-white">{weekends.length}</div>
              <div className="text-sm text-gray-400">Race Weekends</div>
            </CardContent>
          </Card>
          <Card className="bg-gray-800 border-gray-700 text-center">
            <CardContent className="p-6">
              <Flag className="w-8 h-8 text-green-500 mx-auto mb-2" />
              <div className="text-2xl font-bold text-white">
                {weekends.filter(w => !isUpcoming(w.sessions[0].date_start)).length}
              </div>
              <div className="text-sm text-gray-400">Completed</div>
            </CardContent>
          </Card>
          <Card className="bg-gray-800 border-gray-700 text-center">
            <CardContent className="p-6">
              <Clock className="w-8 h-8 text-blue-500 mx-auto mb-2" />
              <div className="text-2xl font-bold text-white">
                {weekends.filter(w => isUpcoming(w.sessions[0].date_start)).length}
              </div>
              <div className="text-sm text-gray-400">Upcoming</div>
            </CardContent>
          </Card>
          <Card className="bg-gray-800 border-gray-700 text-center">
            <CardContent className="p-6">
              <Users className="w-8 h-8 text-purple-500 mx-auto mb-2" />
              <div className="text-2xl font-bold text-white">{rows.length}</div>
              <div className="text-sm text-gray-400">Total Sessions</div>
            </CardContent>
          </Card>
        </div>

        {/* Race Weekends Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {weekends.map((weekend, index) => {
            const upcoming = isUpcoming(weekend.sessions[0].date_start);
            return (
              <Card 
                key={weekend.meeting.meeting_key}
                className={`bg-gray-800 border-2 ${upcoming ? 'border-red-500' : 'border-gray-700'} hover:scale-[1.02] transition-all duration-500 opacity-0 animate-[fadeInUp_0.8s_ease-out_${0.5 + index * 0.1}s_forwards]`}
              >
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <CardTitle className="text-white text-xl mb-2 group-hover:text-red-400 transition-colors">
                        {weekend.meeting.meeting_name}
                      </CardTitle>
                      <div className="flex items-center gap-2 text-gray-300 mb-2">
                        <MapPin className="w-4 h-4 text-red-400" />
                        <span>{weekend.meeting.location}, {weekend.meeting.country_name}</span>
                      </div>
                      <div className="flex items-center gap-2 text-gray-300">
                        <Calendar className="w-4 h-4 text-blue-400" />
                        <span>{new Date(weekend.sessions[0].date_start).toLocaleDateString('en-US', {
                          weekday: 'long',
                          month: 'long',
                          day: 'numeric'
                        })}</span>
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-2">
                      {upcoming && (
                        <Badge className="bg-red-600 text-white animate-pulse">
                          Upcoming
                        </Badge>
                      )}
                      <Badge variant="outline" className="border-gray-600 text-gray-300">
                        Round {weekend.meeting.meeting_key}
                      </Badge>
                    </div>
                  </div>
                </CardHeader>
                
                <CardContent>
                  <div className="space-y-3">
                    <div className="text-sm font-semibold text-gray-300 mb-3">Race Weekend Sessions</div>
                    {weekend.sessions
                      .sort((a, b) => new Date(a.date_start).getTime() - new Date(b.date_start).getTime())
                      .map((session) => {
                        const sessionType = getSessionType(session.session_name);
                        const sessionDate = new Date(session.date_start);
                        return (
                          <div key={session.session_key} className="flex items-center justify-between p-3 rounded-lg bg-gray-700/50 hover:bg-gray-700 transition-colors">
                            <div className="flex items-center gap-3">
                              <div className={`w-3 h-3 rounded-full ${sessionType.color}`} />
                              <div>
                                <div className="text-white font-medium">{session.session_name}</div>
                                <div className="text-xs text-gray-400">
                                  {sessionDate.toLocaleDateString('en-US', { 
                                    month: 'short', 
                                    day: 'numeric' 
                                  })} • {sessionDate.toLocaleTimeString('en-US', { 
                                    hour: '2-digit', 
                                    minute: '2-digit',
                                    timeZoneName: 'short'
                                  })}
                                </div>
                              </div>
                            </div>
                            {isUpcoming(session.date_start) && (
                              <Badge variant="outline" className="border-blue-500 text-blue-400 text-xs">
                                Live
                              </Badge>
                            )}
                          </div>
                        );
                      })}
                  </div>
                  
                  <Button className="w-full mt-6 bg-gray-700 hover:bg-gray-600 text-white hover:scale-105 transition-all duration-300">
                    View Race Details
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    </div>
  );
}


