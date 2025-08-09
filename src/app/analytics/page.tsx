import { Suspense } from "react";
import { PositionChanges } from "@/components/position-changes";
import { WDCCalculator } from "@/components/wdc-calculator";
import { LapTimesChart } from "@/components/lap-times-chart";
import { TeamPaceComparison } from "@/components/team-pace-comparison";

export default function AnalyticsPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-red-900/20 to-gray-900">
      <div className="container mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-8 opacity-0 animate-[fadeInUp_0.8s_ease-out_0.1s_forwards]">
          <h1 className="text-4xl font-bold text-white mb-4">F1 Advanced Analytics</h1>
          <p className="text-gray-300">Deep dive into Formula 1 data with advanced visualizations and analysis</p>
        </div>

        {/* Analytics Grid */}
        <div className="space-y-12">
          {/* WDC Calculator */}
          <div className="opacity-0 animate-[fadeInUp_0.8s_ease-out_0.3s_forwards]">
            <Suspense fallback={<div className="h-96 bg-gray-800 rounded-lg animate-pulse" />}>
              <WDCCalculator />
            </Suspense>
          </div>

          {/* Position Changes */}
          <div className="opacity-0 animate-[fadeInUp_0.8s_ease-out_0.5s_forwards]">
            <Suspense fallback={<div className="h-96 bg-gray-800 rounded-lg animate-pulse" />}>
              <PositionChanges />
            </Suspense>
          </div>

          {/* Lap Times Chart */}
          <div className="opacity-0 animate-[fadeInUp_0.8s_ease-out_0.7s_forwards]">
            <Suspense fallback={<div className="h-96 bg-gray-800 rounded-lg animate-pulse" />}>
              <LapTimesChart />
            </Suspense>
          </div>

          {/* Team Pace Comparison */}
          <div className="opacity-0 animate-[fadeInUp_0.8s_ease-out_0.9s_forwards]">
            <Suspense fallback={<div className="h-96 bg-gray-800 rounded-lg animate-pulse" />}>
              <TeamPaceComparison />
            </Suspense>
          </div>
        </div>
      </div>
    </div>
  );
}
