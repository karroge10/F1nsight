import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"

export function CountdownSkeleton() {
  return (
    <Card className="bg-gray-800 border-gray-700">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <Skeleton className="h-8 w-64 mb-2 bg-gray-700" />
            <Skeleton className="h-4 w-48 bg-gray-700" />
          </div>
          <Skeleton className="h-6 w-16 bg-gray-700" />
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-4 gap-4 mb-6">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="text-center">
              <Skeleton className="h-10 w-full mb-2 bg-gray-700" />
              <Skeleton className="h-4 w-16 mx-auto bg-gray-700" />
            </div>
          ))}
        </div>
        <Skeleton className="h-4 w-full bg-gray-700" />
      </CardContent>
    </Card>
  )
}

export function QuickStatsSkeleton() {
  return (
    <Card className="bg-gray-800 border-gray-700">
      <CardHeader>
        <Skeleton className="h-6 w-32 bg-gray-700" />
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="flex items-center justify-between p-3 rounded-lg bg-gray-700/50">
              <div className="flex items-center gap-3">
                <Skeleton className="h-5 w-5 bg-gray-600" />
                <Skeleton className="h-4 w-24 bg-gray-600" />
              </div>
              <div className="text-right">
                <Skeleton className="h-6 w-8 mb-1 bg-gray-600" />
                <Skeleton className="h-3 w-12 bg-gray-600" />
              </div>
            </div>
          ))}
        </div>
        <div className="mt-6 p-4 rounded-lg bg-gray-700/30">
          <Skeleton className="h-4 w-20 mb-2 bg-gray-600" />
          <Skeleton className="h-3 w-full bg-gray-600" />
        </div>
      </CardContent>
    </Card>
  )
}

export function StandingsSkeleton() {
  return (
    <Card className="bg-gray-800 border-gray-700">
      <CardHeader>
        <div className="flex items-center justify-between">
          <Skeleton className="h-6 w-40 bg-gray-700" />
          <Skeleton className="h-8 w-20 bg-gray-700" />
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {[...Array(8)].map((_, i) => (
            <div key={i} className="flex items-center gap-3 p-3 rounded-lg bg-gray-700/50">
              <Skeleton className="h-6 w-6 bg-gray-600" />
              <Skeleton className="h-8 w-1 bg-gray-600" />
              <div className="flex-1">
                <Skeleton className="h-4 w-32 mb-1 bg-gray-600" />
                <Skeleton className="h-3 w-24 bg-gray-600" />
              </div>
              <Skeleton className="h-6 w-12 bg-gray-600" />
              <div className="text-right">
                <Skeleton className="h-4 w-8 mb-1 bg-gray-600" />
                <Skeleton className="h-3 w-6 bg-gray-600" />
              </div>
              <Skeleton className="h-4 w-4 bg-gray-600" />
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

export function PredictionsSkeleton() {
  return (
    <Card className="bg-gray-800 border-gray-700">
      <CardHeader>
        <div className="flex items-center justify-between">
          <Skeleton className="h-6 w-40 bg-gray-700" />
          <Skeleton className="h-6 w-20 bg-gray-700" />
        </div>
        <Skeleton className="h-4 w-48 mt-2 bg-gray-700" />
      </CardHeader>
      <CardContent>
        <div className="space-y-3 mb-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="flex items-center gap-3 p-3 rounded-lg bg-gray-700/50">
              <Skeleton className="h-6 w-6 bg-gray-600" />
              <div className="flex-1">
                <Skeleton className="h-4 w-28 mb-1 bg-gray-600" />
                <Skeleton className="h-3 w-20 bg-gray-600" />
              </div>
              <div className="text-right">
                <Skeleton className="h-4 w-12 mb-1 bg-gray-600" />
                <Skeleton className="h-6 w-16 bg-gray-600" />
              </div>
            </div>
          ))}
        </div>
        <div className="border-t border-gray-700 pt-4">
          <Skeleton className="h-4 w-32 mb-3 bg-gray-700" />
          <Skeleton className="h-10 w-full bg-gray-700" />
        </div>
      </CardContent>
    </Card>
  )
}

export function RecentRacesSkeleton() {
  return (
    <Card className="bg-gray-800 border-gray-700">
      <CardHeader>
        <div className="flex items-center justify-between">
          <Skeleton className="h-6 w-48 bg-gray-700" />
          <Skeleton className="h-8 w-24 bg-gray-700" />
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="p-4 rounded-lg bg-gray-700/50">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <Skeleton className="h-4 w-40 mb-1 bg-gray-600" />
                  <Skeleton className="h-3 w-32 bg-gray-600" />
                </div>
                <Skeleton className="h-6 w-16 bg-gray-600" />
              </div>
              <div className="flex items-center justify-between">
                <Skeleton className="h-3 w-16 bg-gray-600" />
                <Skeleton className="h-6 w-20 bg-gray-600" />
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

export function NewsCardsSkeleton() {
  return (
    <Card className="bg-gray-800 border-gray-700">
      <CardHeader>
        <Skeleton className="h-6 w-48 bg-gray-700" />
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="space-y-3">
              <Skeleton className="h-48 w-full rounded-lg bg-gray-700" />
              <div className="space-y-2">
                <Skeleton className="h-5 w-full bg-gray-700" />
                <Skeleton className="h-4 w-3/4 bg-gray-700" />
                <div className="flex items-center justify-between">
                  <Skeleton className="h-3 w-16 bg-gray-700" />
                  <Skeleton className="h-8 w-20 bg-gray-700" />
                </div>
              </div>
            </div>
          ))}
        </div>
        <div className="mt-6 text-center">
          <Skeleton className="h-10 w-40 mx-auto bg-gray-700" />
        </div>
      </CardContent>
    </Card>
  )
}

export function DriverCardSkeleton() {
  return (
    <Card className="bg-gray-800 border-gray-700">
      <CardHeader className="text-center">
        <div className="relative mx-auto mb-4">
          <Skeleton className="h-30 w-30 rounded-full bg-gray-700" />
          <Skeleton className="absolute -top-2 -right-2 h-6 w-8 rounded bg-gray-700" />
        </div>
        <Skeleton className="h-6 w-32 mx-auto mb-2 bg-gray-700" />
        <Skeleton className="h-4 w-24 mx-auto bg-gray-700" />
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Skeleton className="h-4 w-20 bg-gray-700" />
            <Skeleton className="h-4 w-12 bg-gray-700" />
          </div>
          <div className="grid grid-cols-2 gap-4 text-center">
            <div>
              <Skeleton className="h-8 w-8 mx-auto mb-1 bg-gray-700" />
              <Skeleton className="h-3 w-16 mx-auto bg-gray-700" />
            </div>
            <div>
              <Skeleton className="h-8 w-8 mx-auto mb-1 bg-gray-700" />
              <Skeleton className="h-3 w-16 mx-auto bg-gray-700" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4 text-center">
            <div>
              <Skeleton className="h-6 w-6 mx-auto mb-1 bg-gray-700" />
              <Skeleton className="h-3 w-12 mx-auto bg-gray-700" />
            </div>
            <div>
              <Skeleton className="h-6 w-6 mx-auto mb-1 bg-gray-700" />
              <Skeleton className="h-3 w-16 mx-auto bg-gray-700" />
            </div>
          </div>
          <Skeleton className="h-10 w-full bg-gray-700" />
        </div>
      </CardContent>
    </Card>
  )
}
