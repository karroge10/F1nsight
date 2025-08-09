'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Brain, Lock, TrendingUp, Target } from 'lucide-react'
import Link from 'next/link'

interface Prediction {
  driver: string
  team: string
  probability: number
  position: number
  confidence: 'High' | 'Medium' | 'Low'
}

export function PredictionsPreview() {
  // Mock AI predictions data
  const predictions: Prediction[] = [
    { driver: "Max Verstappen", team: "Red Bull", probability: 85, position: 1, confidence: "High" },
    { driver: "Sergio Perez", team: "Red Bull", probability: 72, position: 2, confidence: "High" },
    { driver: "Lewis Hamilton", team: "Mercedes", probability: 68, position: 3, confidence: "Medium" },
    { driver: "Charles Leclerc", team: "Ferrari", probability: 45, position: 4, confidence: "Medium" }
  ]

  const getConfidenceColor = (confidence: string) => {
    switch (confidence) {
      case 'High': return 'bg-green-600'
      case 'Medium': return 'bg-yellow-600'
      case 'Low': return 'bg-red-600'
      default: return 'bg-gray-600'
    }
  }

  return (
    <Card className="bg-gradient-to-br from-purple-900 to-gray-800 border-purple-500">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-white flex items-center gap-2">
            <Brain className="w-5 h-5 text-purple-400" />
            AI Race Predictions
          </CardTitle>
          <Badge variant="secondary" className="bg-purple-600 text-white">
            <Lock className="w-3 h-3 mr-1" />
            Premium
          </Badge>
        </div>
        <p className="text-purple-200 text-sm">
          Next Race: Monaco GP - AI Confidence: 87%
        </p>
      </CardHeader>
      <CardContent>
        <div className="space-y-3 mb-4">
          {predictions.map((prediction, index) => (
            <div key={index} className="flex items-center gap-3 p-3 rounded-lg bg-gray-800/50">
              <div className="text-lg font-bold text-white w-6">
                {prediction.position}
              </div>
              <div className="flex-1">
                <div className="font-semibold text-white">{prediction.driver}</div>
                <div className="text-sm text-gray-400">{prediction.team}</div>
              </div>
              <div className="text-right">
                <div className="flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-green-400" />
                  <span className="font-bold text-white">{prediction.probability}%</span>
                </div>
                <Badge 
                  variant="secondary" 
                  className={`${getConfidenceColor(prediction.confidence)} text-white text-xs`}
                >
                  {prediction.confidence}
                </Badge>
              </div>
            </div>
          ))}
        </div>
        
        <div className="border-t border-gray-700 pt-4">
          <div className="flex items-center gap-2 mb-3">
            <Target className="w-4 h-4 text-purple-400" />
            <span className="text-sm text-purple-200">Model Accuracy: 78.5%</span>
          </div>
          <Link href="/predictions">
            <Button className="w-full bg-purple-600 hover:bg-purple-700">
              Unlock Full Predictions
            </Button>
          </Link>
        </div>
      </CardContent>
    </Card>
  )
}
