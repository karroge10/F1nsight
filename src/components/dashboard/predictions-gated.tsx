import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Brain, Lock, Target, TrendingUp } from "lucide-react";

export function PredictionsGated() {
  const predictions = [
    { position: 1, driver: "Max Verstappen", team: "Red Bull", probability: 85, confidence: "High" },
    { position: 2, driver: "Sergio Perez", team: "Red Bull", probability: 72, confidence: "High" },
    { position: 3, driver: "Lewis Hamilton", team: "Mercedes", probability: 68, confidence: "Medium" },
    { position: 4, driver: "Charles Leclerc", team: "Ferrari", probability: 45, confidence: "Medium" },
  ];

  return (
    <Card className="bg-gradient-to-br from-purple-900 to-gray-800 border-purple-500">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-white">
            <Brain className="h-5 w-5 text-purple-400" /> AI Race Predictions
          </CardTitle>
          <Badge variant="secondary" className="bg-purple-600 text-white">
            <Lock className="mr-1 h-3 w-3" /> Premium
          </Badge>
        </div>
        <p className="text-sm text-purple-200">Next Race: Monaco GP - AI Confidence: 87%</p>
      </CardHeader>
      <CardContent>
        <div className="mb-4 space-y-3">
          {predictions.map((p) => (
            <div key={p.position} className="flex items-center gap-3 rounded-lg bg-gray-800/50 p-3">
              <div className="w-6 text-lg font-bold text-white">{p.position}</div>
              <div className="flex-1">
                <div className="font-semibold text-white">{p.driver}</div>
                <div className="text-sm text-gray-400">{p.team}</div>
              </div>
              <div className="text-right">
                <div className="flex items-center gap-2">
                  <TrendingUp className="h-4 w-4 text-green-400" />
                  <span className="font-bold text-white">{p.probability}%</span>
                </div>
                <Badge className="bg-green-600 text-white text-xs">{p.confidence}</Badge>
              </div>
            </div>
          ))}
        </div>
        <div className="border-t border-gray-700 pt-4">
          <div className="mb-3 flex items-center gap-2">
            <Target className="h-4 w-4 text-purple-400" />
            <span className="text-sm text-purple-200">Model Accuracy: 78.5%</span>
          </div>
          <Button className="w-full bg-purple-600 hover:bg-purple-700">Unlock Full Predictions</Button>
        </div>
      </CardContent>
    </Card>
  );
}


