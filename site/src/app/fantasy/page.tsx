import type { Metadata } from "next";
import { getCalendar, getEntryList, getFantasyBacktest, getFantasyFile, getFantasyRounds } from "@/lib/data";
import type { RaceSummary } from "@/lib/data/types";
import { fantasyDeadline } from "@/lib/fantasy";
import { recentRoundPoints } from "@/lib/fantasy/thresholds";
import { hindsightInputs } from "@/lib/fantasy/hindsight";
import { FantasyViews } from "@/components/fantasy/fantasy-views";
import { FantasyPlanner } from "@/components/fantasy/fantasy-planner";
import { BacktestView } from "@/components/fantasy/backtest-view";
import { HindsightView } from "@/components/fantasy/hindsight-view";
import { buildHindsightLabels } from "@/components/fantasy/hindsight-labels";
import type { PlannerMeta, PlannerRace } from "@/components/fantasy/planner-parts";

export const metadata: Metadata = {
  title: "Fantasy planner",
  description: "Best transfers, Boost and chips for your F1 Fantasy teams, with projected points, price moves and a plan for the next races. Free, no login.",
};

/** Short constructor codes for the dense planner (drivers use their three-letter codes). */
const CONSTRUCTOR_CODES: Record<string, string> = {
  mclaren: "MCL",
  ferrari: "FER",
  red_bull: "RBR",
  mercedes: "MER",
  williams: "WIL",
  aston_martin: "AMR",
  alpine: "ALP",
  haas: "HAA",
  rb: "RB",
  sauber: "SAU",
  audi: "AUD",
  cadillac: "CAD",
};

export default async function FantasyPage() {
  const file = await getFantasyFile();
  const calendar = await getCalendar(file.season);
  const entries = await getEntryList(file.season);
  const rounds = await getFantasyRounds();
  const backtestData = await getFantasyBacktest();
  const meta = plannerMeta(file, calendar, entries, rounds);
  const backtest = backtestData ? <BacktestView data={backtestData} /> : <BacktestMissing />;
  const hindsight = rounds ? await hindsightPanel(rounds, file.season, calendar, entries) : <HindsightMissing />;

  return <FantasyViews planner={<FantasyPlanner meta={meta} />} backtest={backtest} hindsight={hindsight} />;
}

/** Hindsight view for the rounds' season, reusing the calendar and entry list when it is the planner's season. */
async function hindsightPanel(rounds: NonNullable<RoundsData>, plannerSeason: number, plannerCalendar: RaceSummary[], plannerEntries: EntryListData) {
  const sameSeason = rounds.season === plannerSeason;
  const calendar = sameSeason ? plannerCalendar : await getCalendar(rounds.season);
  const entries = sameSeason ? plannerEntries : await getEntryList(rounds.season);
  const raceNames = Object.fromEntries(calendar.map((race) => [race.round, race.raceName]));
  const inputs = hindsightInputs(rounds, raceNames);
  const labels = buildHindsightLabels(entries, constructorCode);
  return <HindsightView season={rounds.season} inputs={inputs} labels={labels} />;
}

/** Shown when the per-round fantasy file has not been exported yet. */
function HindsightMissing() {
  return <div className="flex h-40 items-center justify-center rounded-float border border-rule text-ui text-ink-3">Round data not exported yet</div>;
}

/** Shown when the backtest file has not been generated yet. */
function BacktestMissing() {
  return <div className="flex h-40 items-center justify-center rounded-float border border-rule text-ui text-ink-3">No backtest data yet</div>;
}

type FantasyFileData = Awaited<ReturnType<typeof getFantasyFile>>;
type EntryListData = Awaited<ReturnType<typeof getEntryList>>;
type RoundsData = Awaited<ReturnType<typeof getFantasyRounds>>;

function plannerMeta(file: FantasyFileData, calendar: RaceSummary[], entries: EntryListData, rounds: RoundsData): PlannerMeta {
  const raceByRound = new Map(calendar.map((race) => [race.round, race]));
  const thisRace = raceByRound.get(file.round);
  const horizonRaces = (file.horizon ?? []).map((h) => plannerRace(h.round, h.raceName, raceByRound));
  const firstRace = plannerRace(file.round, file.raceName, raceByRound);
  const codes: Record<string, string> = {};
  for (const d of entries.drivers) codes[d.driverId] = d.code;
  for (const asset of file.assets) {
    if (asset.kind === "constructor") codes[asset.id] = constructorCode(asset.id);
  }
  const recent = rounds ? recentRoundPoints(rounds, file.round) : { rounds: [], points: new Map<string, (number | null)[]>() };
  return {
    season: file.season,
    round: file.round,
    raceName: file.raceName,
    country: thisRace ? (thisRace.countryCode ?? thisRace.country) : null,
    deadline: thisRace ? fantasyDeadline(thisRace.sessions) : null,
    races: [firstRace, ...horizonRaces],
    codes,
    recent: { rounds: recent.rounds, points: Object.fromEntries(recent.points) },
  };
}

function plannerRace(round: number, raceName: string, raceByRound: Map<number, RaceSummary>): PlannerRace {
  const race = raceByRound.get(round);
  const name = (race?.raceName ?? raceName).replace(/ Grand Prix$/, "");
  const country = race ? (race.countryCode ?? race.country) : null;
  return { round, name, country };
}

function constructorCode(id: string): string {
  return CONSTRUCTOR_CODES[id] ?? id.slice(0, 3).toUpperCase();
}
