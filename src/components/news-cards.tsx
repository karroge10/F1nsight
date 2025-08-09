'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Clock, ExternalLink } from 'lucide-react'
import Image from 'next/image'

interface NewsItem {
  id: number
  title: string
  summary: string
  category: string
  publishedAt: string
  imageUrl: string
  isPremium: boolean
}

export function NewsCards() {
  const news: NewsItem[] = [
    {
      id: 1,
      title: "Verstappen Dominates Spanish GP with Record-Breaking Performance",
      summary: "Max Verstappen secured his seventh victory of the season with a commanding performance at Barcelona, extending his championship lead.",
      category: "Race Results",
      publishedAt: "2024-05-12T16:30:00Z",
      imageUrl: "/placeholder-n3byz.png",
      isPremium: false
    },
    {
      id: 2,
      title: "Technical Analysis: Red Bull's Aerodynamic Advantage Explained",
      summary: "Our exclusive technical breakdown reveals how Red Bull's innovative floor design gives them the edge over competitors.",
      category: "Technical",
      publishedAt: "2024-05-11T10:15:00Z",
      imageUrl: "/f1-technical-diagram.png",
      isPremium: true
    },
    {
      id: 3,
      title: "Hamilton Reflects on Mercedes' Improved Pace",
      summary: "Lewis Hamilton discusses the team's recent upgrades and their impact on performance as Mercedes closes the gap to the front runners.",
      category: "Interviews",
      publishedAt: "2024-05-10T14:20:00Z",
      imageUrl: "/formula-one-interview.png",
      isPremium: false
    },
    {
      id: 4,
      title: "Monaco GP Preview: AI Predictions and Key Storylines",
      summary: "Our machine learning model analyzes historical data to predict outcomes for the most prestigious race on the calendar.",
      category: "Predictions",
      publishedAt: "2024-05-09T09:00:00Z",
      imageUrl: "/monaco-f1-aerial.png",
      isPremium: true
    }
  ]

  const formatTimeAgo = (dateString: string) => {
    const date = new Date(dateString)
    const now = new Date()
    const diffInHours = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60))
    
    if (diffInHours < 24) {
      return `${diffInHours}h ago`
    } else {
      const diffInDays = Math.floor(diffInHours / 24)
      return `${diffInDays}d ago`
    }
  }

  const getCategoryColor = (category: string) => {
    const colors: Record<string, string> = {
      "Race Results": "bg-green-600",
      "Technical": "bg-blue-600",
      "Interviews": "bg-purple-600",
      "Predictions": "bg-orange-600"
    }
    return colors[category] || "bg-gray-600"
  }

  return (
    <Card className="bg-gray-800 border-gray-700">
      <CardHeader>
        <CardTitle className="text-white">Latest F1 News & Analysis</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {news.map((item, index) => (
            <div 
              key={item.id} 
              className={`group cursor-pointer hover:scale-[1.02] transition-all duration-500 animate-in fade-in delay-${index * 200}`}
            >
              <div className="relative overflow-hidden rounded-lg mb-3 shadow-lg hover:shadow-xl transition-shadow duration-300">
                <Image
                  src={item.imageUrl || "/placeholder.svg"}
                  alt={item.title}
                  width={300}
                  height={200}
                  className="w-full h-48 object-cover group-hover:scale-110 transition-transform duration-500"
                />
                {item.isPremium && (
                  <Badge className="absolute top-2 right-2 bg-yellow-600 text-white hover:scale-110 transition-transform animate-pulse">
                    Premium
                  </Badge>
                )}
                <Badge 
                  className={`absolute bottom-2 left-2 ${getCategoryColor(item.category)} text-white hover:scale-105 transition-transform`}
                >
                  {item.category}
                </Badge>
              </div>
              
              <div className="space-y-2">
                <h3 className="font-semibold text-white group-hover:text-red-400 transition-colors duration-300 line-clamp-2">
                  {item.title}
                </h3>
                <p className="text-sm text-gray-400 line-clamp-2 group-hover:text-gray-300 transition-colors duration-300">
                  {item.summary}
                </p>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1 text-xs text-gray-500">
                    <Clock className="w-3 h-3" />
                    {formatTimeAgo(item.publishedAt)}
                  </div>
                  <Button variant="ghost" size="sm" className="text-red-400 hover:text-red-300 hover:scale-105 transition-all duration-300">
                    Read More
                    <ExternalLink className="w-3 h-3 ml-1" />
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
        
        <div className="mt-6 text-center">
          <Button variant="outline" className="border-gray-600 text-gray-300 hover:bg-gray-700">
            Load More Articles
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}


