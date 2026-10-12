// Human-readable reasons for the recommended transfers and team choices, computed only from
// the numbers in the market (expected points, risk, price change odds, upcoming races).

import type { Market, MarketAsset } from "./market";
import { horizonMeans } from "./market";
import type { ChipPlan, TeamResult, TransferExplanation, TransferPlan } from "./types";

export interface ExplainOptions {
  /** Races to sum the window gain over (this one included). Default: the plan's races. */
  plan?: TransferPlan | null;
  chips?: ChipPlan | null;
  /** The user is building a new team (no current team, so no transfers). */
  newTeam?: boolean;
}

/** One explanation per transfer pair (out -> in, same kind), best gain first. */
export function explainTransfers(market: Market, team: TeamResult, options: ExplainOptions = {}): TransferExplanation[] {
  const windowMeans = windowOf(market, options.plan ?? null);
  const raceNames = windowMeans.map((w) => shortRace(w.raceName));
  const pairs = pairTransfers(market, team, windowMeans);
  return pairs.map(({ out, into }) => {
    const kind = (into ?? out)?.kind ?? "driver";
    const gainNow = (into?.expectedPoints ?? 0) - (out?.expectedPoints ?? 0);
    const gainWindow = windowGain(windowMeans, into, out);
    const priceDelta = (into?.price ?? 0) - (out?.price ?? 0);
    const text = transferText(market, into, out, gainNow, gainWindow, raceNames);
    return { out: out?.id ?? null, in: into?.id ?? null, kind, gainNow, gainWindow, priceDelta, text };
  });
}

/** Short notes about the whole recommendation: Boost, penalty, chip, risk, value. */
export function explainTeam(market: Market, team: TeamResult, options: ExplainOptions = {}): string[] {
  const notes: string[] = [];
  const asset = (id: string | null) => (id ? market.assets[market.byId.get(id) as number] : null);
  const boost = asset(team.boost);
  const extra = asset(team.extraBoost);
  if (extra) notes.push(`x3 Boost on ${extra.name} (${fmt(extra.expectedPoints)} expected points), x2 Boost on ${boost?.name ?? "the next best driver"}.`);
  else if (boost) notes.push(`Boost on ${boost.name}: the highest expected score in the team (${fmt(boost.expectedPoints)}).`);
  if (team.chip === "autopilot") notes.push("Autopilot gives the x2 Boost to whichever driver scores most, so no Boost pick is needed.");
  if (team.penalty > 0) {
    const extraTransfers = team.penalty / market.rules.extraTransferPenalty;
    notes.push(`${extraTransfers} transfer${extraTransfers > 1 ? "s" : ""} beyond the free ones cost ${team.penalty} points. The expected gain covers it.`);
  }
  const unchanged = team.transferCount === 0 && team.transfersOut.length === 0;
  if (unchanged && !options.newTeam) notes.push("No transfers. No change beats the current team by enough this race.");
  const spread = team.stats.p90 - team.stats.p10;
  notes.push(`Expected ${fmt(team.expectedPoints)} points. A bad weekend (1 in 10) gives ${fmt(team.stats.p10)} or less, a great one ${fmt(team.stats.p90)} or more (range ${fmt(spread)}).`);
  if (Math.abs(team.expectedValueChange) >= 0.05) {
    const direction = team.expectedValueChange > 0 ? "grow" : "shrink";
    notes.push(`Team value is expected to ${direction} by $${fmt(Math.abs(team.expectedValueChange))}M after this race.`);
  }
  const plan = options.plan;
  if (plan && plan.stages.length > 1) {
    const gainVsMyopic = plan.score - plan.myopicScore;
    const gainVsHold = plan.score - plan.holdScore;
    if (gainVsMyopic > 0.5) notes.push(`Planning ${plan.stages.length} races ahead adds about ${fmt(gainVsMyopic)} points over choosing one race at a time.`);
    if (gainVsHold > 0.5) notes.push(`The plan is worth about ${fmt(gainVsHold)} points more than keeping the current team for ${plan.stages.length} races.`);
  }
  const chip = options.chips?.advice.find((a) => a.recommendation === "play");
  if (chip) notes.push(`${chip.name}: ${chip.reason}`);
  if (market.synthetic) notes.push("These numbers come from a synthetic test file, not from the real model.");
  return notes;
}

// ------------------------------------------------------------------------------ helpers

interface WindowRound {
  round: number;
  raceName: string;
  means: Float64Array;
}

function windowOf(market: Market, plan: TransferPlan | null): WindowRound[] {
  const rounds: WindowRound[] = [{ round: market.round, raceName: market.raceName, means: market.mean }];
  const count = plan ? plan.stages.length : 1;
  for (let k = 0; k < count - 1 && k < market.horizon.length; k++) {
    const horizon = market.horizon[k];
    const means = horizonMeans(market, horizon);
    rounds.push({ round: horizon.round, raceName: horizon.raceName, means });
  }
  return rounds;
}

/** Match each sold asset to a bought one of the same kind, greedily by the window gain. */
function pairTransfers(market: Market, team: TeamResult, window: WindowRound[]): { out: MarketAsset | null; into: MarketAsset | null }[] {
  const lookup = (id: string) => market.assets[market.byId.get(id) as number];
  const ins = team.transfersIn.map(lookup);
  const outs = team.transfersOut.map(lookup);
  const pairs: { out: MarketAsset | null; into: MarketAsset | null; gain: number }[] = [];
  for (const kind of ["driver", "constructor"] as const) {
    const kindIns = ins.filter((a) => a.kind === kind);
    const kindOuts = outs.filter((a) => a.kind === kind);
    kindIns.sort((x, y) => y.price - x.price);
    kindOuts.sort((x, y) => y.price - x.price);
    const count = Math.max(kindIns.length, kindOuts.length);
    for (let k = 0; k < count; k++) {
      const into = kindIns[k] ?? null;
      const out = kindOuts[k] ?? null;
      const gain = windowGain(window, into, out);
      pairs.push({ out, into, gain });
    }
  }
  pairs.sort((x, y) => y.gain - x.gain);
  return pairs.map(({ out, into }) => ({ out, into }));
}

function windowGain(window: WindowRound[], into: MarketAsset | null, out: MarketAsset | null): number {
  let total = 0;
  for (const round of window) {
    const gained = into ? round.means[into.index] : 0;
    const lost = out ? round.means[out.index] : 0;
    total += gained - lost;
  }
  return total;
}

function transferText(
  market: Market,
  into: MarketAsset | null,
  out: MarketAsset | null,
  gainNow: number,
  gainWindow: number,
  raceNames: string[],
): string {
  if (!into && out) return `Sell ${out.name} ($${fmt(out.price)}M) to fund the other changes.`;
  if (into && !out) return `Add ${into.name} ($${fmt(into.price)}M).`;
  if (!into || !out) return "";
  const parts: string[] = [];
  const race = shortRace(market.raceName);
  const money = into.price - out.price;
  const funding = gainWindow < 0 && money < 0;
  const lead = funding ? `${into.name} in for ${out.name} frees $${fmt(-money)}M for the upgrades elsewhere` : `${into.name} in for ${out.name}`;
  parts.push(`${lead}: ${signed(gainNow)} expected points at ${race} (${fmt(into.expectedPoints)} vs ${fmt(out.expectedPoints)})`);
  if (raceNames.length > 1) parts.push(`${signed(gainWindow)} over ${raceNames.join(", ")}`);
  if (!funding && Math.abs(money) >= 0.05) parts.push(money < 0 ? `frees $${fmt(-money)}M` : `costs $${fmt(money)}M more`);
  const price = priceNote(into, out);
  if (price) parts.push(price);
  const risk = riskNote(into, out);
  if (risk) parts.push(risk);
  return `${parts.join("; ")}.`;
}

function priceNote(into: MarketAsset, out: MarketAsset): string | null {
  const notes: string[] = [];
  if (into.pRise >= 0.5) notes.push(`${pct(into.pRise)} chance ${into.name} rises (${signedMoney(into.expectedPriceChange)} expected)`);
  if (out.pFall >= 0.5) notes.push(`${out.name} is ${pct(out.pFall)} likely to drop`);
  if (notes.length === 0 && Math.abs(into.expectedPriceChange - out.expectedPriceChange) >= 0.1) {
    notes.push(`price outlook ${signedMoney(into.expectedPriceChange)} vs ${signedMoney(out.expectedPriceChange)}`);
  }
  return notes.length ? notes.join(", ") : null;
}

function riskNote(into: MarketAsset, out: MarketAsset): string | null {
  const floorGain = into.p10 - out.p10;
  const negative = into.pNegative - out.pNegative;
  if (floorGain >= 3) return `safer floor: bad-weekend score ${fmt(into.p10)} vs ${fmt(out.p10)}`;
  if (floorGain <= -3) return `riskier: bad-weekend score ${fmt(into.p10)} vs ${fmt(out.p10)}`;
  if (negative <= -0.05) return `less likely to score negative (${pct(into.pNegative)} vs ${pct(out.pNegative)})`;
  if (negative >= 0.05) return `more likely to score negative (${pct(into.pNegative)} vs ${pct(out.pNegative)})`;
  return null;
}

function shortRace(name: string): string {
  return name.replace(/ Grand Prix.*$/, "");
}

function fmt(value: number): string {
  return (Math.round(value * 10) / 10).toFixed(1);
}

function signed(value: number): string {
  const text = fmt(value);
  return value >= 0 ? `+${text}` : text;
}

/** Signed money change, e.g. "+$0.3M" or "−$1.6M". */
function signedMoney(value: number): string {
  const text = fmt(Math.abs(value));
  const sign = value >= 0 ? "+" : "−";
  return `${sign}$${text}M`;
}

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}
