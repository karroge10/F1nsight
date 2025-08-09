import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Trophy, Users, Car, TrendingUp } from "lucide-react";

interface Team {
  id: number;
  name: string;
  shortName: string;
  drivers: string[];
  points: number;
  position: number;
  wins: number;
  podiums: number;
  color: string;
  founded: number;
  base: string;
  principal: string;
}

export default function TeamsPage() {
  const teams: Team[] = [
    {
      id: 1,
      name: "Red Bull Racing",
      shortName: "Red Bull",
      drivers: ["Max Verstappen", "Sergio Pérez"],
      points: 860,
      position: 1,
      wins: 21,
      podiums: 29,
      color: "bg-blue-600",
      founded: 2005,
      base: "Milton Keynes, UK",
      principal: "Christian Horner"
    },
    {
      id: 2,
      name: "Mercedes-AMG Petronas F1 Team",
      shortName: "Mercedes",
      drivers: ["Lewis Hamilton", "George Russell"],
      points: 409,
      position: 2,
      wins: 3,
      podiums: 12,
      color: "bg-cyan-400",
      founded: 2010,
      base: "Brackley, UK",
      principal: "Toto Wolff"
    },
    {
      id: 3,
      name: "Scuderia Ferrari",
      shortName: "Ferrari",
      drivers: ["Charles Leclerc", "Carlos Sainz Jr."],
      points: 365,
      position: 3,
      wins: 2,
      podiums: 11,
      color: "bg-red-600",
      founded: 1950,
      base: "Maranello, Italy",
      principal: "Frédéric Vasseur"
    },
    {
      id: 4,
      name: "Aston Martin Aramco Cognizant F1 Team",
      shortName: "Aston Martin",
      drivers: ["Fernando Alonso", "Lance Stroll"],
      points: 280,
      position: 4,
      wins: 0,
      podiums: 9,
      color: "bg-green-600",
      founded: 2021,
      base: "Silverstone, UK",
      principal: "Mike Krack"
    },
    {
      id: 5,
      name: "McLaren F1 Team",
      shortName: "McLaren",
      drivers: ["Lando Norris", "Oscar Piastri"],
      points: 212,
      position: 5,
      wins: 0,
      podiums: 4,
      color: "bg-orange-500",
      founded: 1966,
      base: "Woking, UK",
      principal: "Andrea Stella"
    }
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-red-900/20 to-gray-900">
      <div className="container mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-8 animate-in fade-in duration-1000">
          <h1 className="text-4xl font-bold text-white mb-4">F1 Teams 2024</h1>
          <p className="text-gray-300">Constructor championship standings and team information</p>
        </div>

        {/* Teams Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
          {teams.map((team, index) => (
            <Card 
              key={team.id} 
              className={`bg-gray-800 border-2 border-gray-700 hover:scale-105 hover:shadow-2xl transition-all duration-500 cursor-pointer group animate-in fade-in delay-${index * 200}`}
            >
              <CardHeader>
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className={`w-4 h-12 rounded ${team.color}`} />
                    <div>
                      <CardTitle className="text-white text-lg group-hover:text-yellow-400 transition-colors duration-300">
                        {team.shortName}
                      </CardTitle>
                      <p className="text-gray-400 text-sm">{team.name}</p>
                    </div>
                  </div>
                  <Badge className="bg-yellow-600 text-white hover:scale-110 transition-transform">
                    #{team.position}
                  </Badge>
                </div>
              </CardHeader>
              
              <CardContent>
                <div className="space-y-4">
                  {/* Drivers */}
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <Users className="w-4 h-4 text-blue-400" />
                      <span className="text-sm font-semibold text-gray-300">Drivers</span>
                    </div>
                    <div className="space-y-1">
                      {team.drivers.map((driver) => (
                        <div key={driver} className="text-white text-sm hover:text-yellow-400 transition-colors cursor-pointer">
                          • {driver}
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Stats */}
                  <div className="grid grid-cols-2 gap-4">
                    <div className="text-center hover:scale-110 transition-transform duration-300">
                      <div className="text-2xl font-bold text-yellow-500">{team.points}</div>
                      <div className="text-xs text-gray-400">Points</div>
                    </div>
                    <div className="text-center hover:scale-110 transition-transform duration-300">
                      <div className="text-2xl font-bold text-green-500">{team.wins}</div>
                      <div className="text-xs text-gray-400">Wins</div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="text-center hover:scale-110 transition-transform duration-300">
                      <div className="text-lg font-bold text-blue-400">{team.podiums}</div>
                      <div className="text-xs text-gray-400">Podiums</div>
                    </div>
                    <div className="text-center hover:scale-110 transition-transform duration-300">
                      <div className="text-lg font-bold text-purple-400">{team.founded}</div>
                      <div className="text-xs text-gray-400">Founded</div>
                    </div>
                  </div>

                  {/* Team Info */}
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-gray-400">Base:</span>
                      <span className="text-gray-300">{team.base}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-400">Principal:</span>
                      <span className="text-gray-300">{team.principal}</span>
                    </div>
                  </div>

                  <Button className="w-full mt-4 bg-gray-700 hover:bg-gray-600 text-white hover:scale-105 transition-all duration-300 group-hover:shadow-lg">
                    View Team Details
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Championship Progress */}
        <div className="mt-12 animate-in fade-in duration-1000 delay-1000">
          <Card className="bg-gray-800 border-gray-700">
            <CardHeader>
              <CardTitle className="text-white flex items-center gap-2">
                <Trophy className="w-5 h-5 text-yellow-500" />
                Constructor Championship Progress
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="text-center">
                  <div className="text-3xl font-bold text-red-500 mb-2">860</div>
                  <div className="text-gray-300">Leading Points</div>
                  <div className="text-sm text-gray-500">Red Bull Racing</div>
                </div>
                <div className="text-center">
                  <div className="text-3xl font-bold text-green-500 mb-2">21</div>
                  <div className="text-gray-300">Race Wins</div>
                  <div className="text-sm text-gray-500">Season total</div>
                </div>
                <div className="text-center">
                  <div className="text-3xl font-bold text-blue-500 mb-2">10</div>
                  <div className="text-gray-300">Active Teams</div>
                  <div className="text-sm text-gray-500">2024 season</div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}


