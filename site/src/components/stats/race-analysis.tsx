import type { Lookups } from "@/lib/data";
import { formatLapTime } from "@/lib/format";
import { formatPlaces, type RaceAnalysis } from "@/lib/race-analysis";
import { Figure } from "@/components/ui/figure";
import { Info } from "@/components/ui/info";
import { DriverTag } from "./driver-tag";

interface RaceAnalysisProps {
  analysis: RaceAnalysis;
  lookups: Lookups;
  season?: number | null;
}

const FORECAST_INFO = "Finished the most places ahead of our pre-race forecast (the model's expected position, rounded). Our pick for the drive of the day from our own numbers.";
const OVERTAKES_INFO = "On-track passes reconstructed from OpenF1 position data, after dropping pit cycles, timing flicker and passes on failing cars. Within about two of the official count per driver.";

/** Headline tiles: overtakes, movers, our forecast pick, fastest stop and lap, DNFs. */
export function RaceAnalysisTiles({ analysis, lookups, season = null }: RaceAnalysisProps) {
  const mover = analysis.biggestMover;
  const best = analysis.bestVsForecast;
  const stop = analysis.fastestStop;
  const lap = analysis.fastestLap;
  const dnfCodes = analysis.dnfs.map((r) => lookups.driverCode(r.driverId)).join(", ");
  const tag = (driverId: string) => <CodeTag driverId={driverId} analysis={analysis} lookups={lookups} season={season} />;
  return (
    <div className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-3 lg:grid-cols-6">
      <Figure label={<LabelWithInfo text="Overtakes" info={OVERTAKES_INFO} />} value={analysis.overtakesTotal !== null ? String(analysis.overtakesTotal) : "–"} note={analysis.overtakesTotal !== null ? "on track" : "No overtake data"} />
      <Figure label="Biggest mover" value={mover ? tag(mover.driverId) : "–"} note={mover ? `${formatPlaces(mover.gained as number)} places, P${mover.grid} to P${mover.position}` : "Nobody gained places"} />
      <Figure label={<LabelWithInfo text="Beat our forecast" info={FORECAST_INFO} />} value={best ? tag(best.driverId) : "–"} note={best ? `${formatPlaces(best.vsForecast as number)} vs expected P${Math.round(best.expectedPosition as number)}` : analysis.forecastStage ? "Nobody beat it" : "No forecast for this race"} />
      <Figure label="Fastest Pit Stop" value={stop ? tag(stop.driverId) : "–"} note={stop ? `${((stop.durationMs as number) / 1000).toFixed(3)} s pit lane, lap ${stop.lap ?? "?"}` : "No pit stop data"} />
      <Figure label="Fastest lap" value={lap ? tag(lap.driverId) : "–"} note={lap?.fastestLapMs ? `${formatLapTime(lap.fastestLapMs)}${lap.fastestLapNumber ? `, lap ${lap.fastestLapNumber}` : ""}` : ""} />
      <Figure label="DNFs" value={String(analysis.dnfs.length)} note={dnfCodes || "Everyone classified"} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function LabelWithInfo({ text, info }: { text: string; info: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      {text}
      <Info text={info} />
    </span>
  );
}

function CodeTag({ driverId, analysis, lookups, season }: { driverId: string; analysis: RaceAnalysis; lookups: Lookups; season: number | null }) {
  const constructorId = teamOf(analysis, driverId);
  const team = { constructorId, name: lookups.teamName(constructorId), color: lookups.teamColor(constructorId) };
  return <DriverTag text={lookups.driverCode(driverId)} team={team} season={season} logo={24} />;
}

function teamOf(analysis: RaceAnalysis, driverId: string): string {
  return analysis.rows.find((r) => r.driverId === driverId)?.constructorId ?? "";
}
