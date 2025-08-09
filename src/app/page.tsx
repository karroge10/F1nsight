import { Suspense } from "react";
import { RaceCountdown } from "@/components/race-countdown";
import { StandingsWidget } from "@/components/standings-widget";
import { NewsCards } from "@/components/news-cards";
import { QuickStats } from "@/components/quick-stats";
import { PredictionsPreview } from "@/components/predictions-preview";
import { RecentRaces } from "@/components/recent-races";
import { 
  CountdownSkeleton, 
  QuickStatsSkeleton, 
  StandingsSkeleton, 
  PredictionsSkeleton, 
  RecentRacesSkeleton, 
  NewsCardsSkeleton 
} from "@/components/loading-skeletons";
// import { WDCCalculator } from "@/components/wdc-calculator";

export default function HomePage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-red-900/20 to-gray-900">
      <div className="container mx-auto px-4 py-8">
        {/* Main Dashboard Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 mb-12 opacity-0 animate-[fadeInUp_0.8s_ease-out_0.1s_forwards]">
          {/* Race Countdown - Takes full width on mobile, 2 cols on desktop */}
          <div className="lg:col-span-2">
            <Suspense fallback={<CountdownSkeleton />}>
              <RaceCountdown />
            </Suspense>
          </div>

          {/* Quick Stats */}
          <div>
            <Suspense fallback={<QuickStatsSkeleton />}>
              <QuickStats />
            </Suspense>
          </div>
        </div>

        {/* Secondary Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-12 opacity-0 animate-[fadeInUp_0.8s_ease-out_0.3s_forwards]">
          {/* Current Standings */}
          <Suspense fallback={<StandingsSkeleton />}>
            <StandingsWidget />
          </Suspense>

          {/* AI Predictions Preview */}
          <Suspense fallback={<PredictionsSkeleton />}>
            <PredictionsPreview />
          </Suspense>
        </div>

        {/* Recent Races */}
        <div className="mb-12 opacity-0 animate-[fadeInUp_0.8s_ease-out_0.5s_forwards]">
          <Suspense fallback={<RecentRacesSkeleton />}>
            <RecentRaces />
          </Suspense>
        </div>

        {/* News Section */}
        <div className="opacity-0 animate-[fadeInUp_0.8s_ease-out_0.7s_forwards]">
          <Suspense fallback={<NewsCardsSkeleton />}>
            <NewsCards />
          </Suspense>
        </div>
      </div>
    </div>
  );
}
