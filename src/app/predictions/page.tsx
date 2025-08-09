'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Brain, Lock, TrendingUp, Target, BarChart3, Zap, Crown, CheckCircle } from 'lucide-react'

export default function PredictionsPage() {
  const isPremium = false // Mock user subscription status

  if (!isPremium) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-purple-900/20 to-gray-900">
        <div className="container mx-auto px-4 py-8">
          {/* Premium Upgrade Section */}
          <div className="max-w-4xl mx-auto">
            <Card className="bg-gradient-to-r from-purple-900 to-blue-900 border-purple-500 text-center">
              <CardHeader className="pb-8">
                <div className="mx-auto mb-4 p-4 bg-purple-600 rounded-full w-fit">
                  <Brain className="w-12 h-12 text-white" />
                </div>
                <CardTitle className="text-4xl font-bold text-white mb-4">
                  AI-Powered Race Predictions
                </CardTitle>
                <p className="text-xl text-purple-200 max-w-2xl mx-auto">
                  Unlock advanced machine learning predictions with 87% accuracy rate. 
                  Get detailed race forecasts, driver performance analysis, and strategic insights.
                </p>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                  <div className="text-center">
                    <Target className="w-8 h-8 text-purple-400 mx-auto mb-2" />
                    <h3 className="font-semibold text-white mb-1">87% Accuracy</h3>
                    <p className="text-sm text-purple-200">Proven prediction model</p>
                  </div>
                  <div className="text-center">
                    <BarChart3 className="w-8 h-8 text-purple-400 mx-auto mb-2" />
                    <h3 className="font-semibold text-white mb-1">Deep Analytics</h3>
                    <p className="text-sm text-purple-200">Historical data analysis</p>
                  </div>
                  <div className="text-center">
                    <Zap className="w-8 h-8 text-purple-400 mx-auto mb-2" />
                    <h3 className="font-semibold text-white mb-1">Real-time Updates</h3>
                    <p className="text-sm text-purple-200">Live prediction adjustments</p>
                  </div>
                </div>

                <div className="bg-gray-800/50 rounded-lg p-6 mb-8">
                  <h3 className="text-xl font-bold text-white mb-4">What You'll Get:</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-left">
                    {[
                      "Race winner predictions with confidence scores",
                      "Podium finish probabilities for all drivers",
                      "Qualifying position forecasts",
                      "Weather impact analysis",
                      "Tire strategy recommendations",
                      "Historical performance comparisons",
                      "Championship probability tracking",
                      "Exclusive prediction insights"
                    ].map((feature, index) => (
                      <div key={index} className="flex items-center gap-2">
                        <CheckCircle className="w-5 h-5 text-green-400 flex-shrink-0" />
                        <span className="text-gray-300">{feature}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <Button 
                  size="lg" 
                  className="bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 text-white px-8 py-3 text-lg"
                >
                  <Crown className="w-5 h-5 mr-2" />
                  Upgrade to Pro - $9.99/month
                </Button>
                <p className="text-sm text-purple-200 mt-4">
                  7-day free trial • Cancel anytime • 30-day money-back guarantee
                </p>
              </CardContent>
            </Card>

            {/* Preview Section */}
            <div className="mt-12">
              <h2 className="text-2xl font-bold text-white mb-6 text-center">
                Preview: Monaco GP Predictions
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <Card className="bg-gray-800 border-gray-700 relative overflow-hidden">
                  <div className="absolute inset-0 bg-gradient-to-r from-transparent to-gray-900/90 z-10" />
                  <div className="absolute top-4 right-4 z-20">
                    <Badge className="bg-purple-600 text-white">
                      <Lock className="w-3 h-3 mr-1" />
                      Premium
                    </Badge>
                  </div>
                  <CardHeader className="relative z-10">
                    <CardTitle className="text-white">Race Winner Prediction</CardTitle>
                  </CardHeader>
                  <CardContent className="relative z-10">
                    <div className="space-y-4 opacity-60">
                      <div className="flex items-center justify-between">
                        <span className="text-gray-300">Max Verstappen</span>
                        <span className="font-bold text-green-400">78%</span>
                      </div>
                      <Progress value={78} className="h-2" />
                      <div className="flex items-center justify-between">
                        <span className="text-gray-300">Charles Leclerc</span>
                        <span className="font-bold text-blue-400">65%</span>
                      </div>
                      <Progress value={65} className="h-2" />
                    </div>
                  </CardContent>
                </Card>

                <Card className="bg-gray-800 border-gray-700 relative overflow-hidden">
                  <div className="absolute inset-0 bg-gradient-to-r from-transparent to-gray-900/90 z-10" />
                  <div className="absolute top-4 right-4 z-20">
                    <Badge className="bg-purple-600 text-white">
                      <Lock className="w-3 h-3 mr-1" />
                      Premium
                    </Badge>
                  </div>
                  <CardHeader className="relative z-10">
                    <CardTitle className="text-white">Podium Predictions</CardTitle>
                  </CardHeader>
                  <CardContent className="relative z-10">
                    <div className="space-y-3 opacity-60">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className="w-6 h-6 bg-yellow-500 rounded text-center text-xs font-bold text-black">1</div>
                          <span className="text-gray-300">Verstappen</span>
                        </div>
                        <span className="text-green-400">78%</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className="w-6 h-6 bg-gray-400 rounded text-center text-xs font-bold text-black">2</div>
                          <span className="text-gray-300">Leclerc</span>
                        </div>
                        <span className="text-blue-400">65%</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className="w-6 h-6 bg-orange-600 rounded text-center text-xs font-bold text-white">3</div>
                          <span className="text-gray-300">Hamilton</span>
                        </div>
                        <span className="text-purple-400">52%</span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // Premium user content would go here
  return null
}
