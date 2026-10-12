// The fantasy market (prices, moves, history, ownership) from data/serve/fantasy_rounds.json,
// which every refresh rewrites (f1p.fantasy.update runs f1p.fantasy.serve_rounds). The latest
// round in the file is the next gameday: its prices are the current market.

import type { Constructor, Driver, FantasyConstructorAsset, FantasyDriverAsset, FantasyMarket, FantasyRules } from "@/lib/data/types";
import type { FantasyRoundAsset, FantasyRoundsFile } from "./thresholds";

const FALLBACK_COLOR = "#8A8F98";

interface AssetHistory {
  prices: number[];
  points: (number | null)[];
}

/** The market going into the latest round of `file`; names and colours come from the site's driver and team data. */
export function marketFromRounds(file: FantasyRoundsFile, rules: FantasyRules, drivers: Driver[], constructors: Constructor[]): FantasyMarket {
  const latest = file.rounds[file.rounds.length - 1];
  const driverById = new Map(drivers.map((d) => [d.driverId, d]));
  const constructorById = new Map(constructors.map((c) => [c.constructorId, c]));
  const driverAssets: FantasyDriverAsset[] = [];
  const constructorAssets: FantasyConstructorAsset[] = [];
  for (const asset of currentAssets(latest?.assets ?? [])) {
    if (asset.price === null) continue;
    const history = assetHistory(file, asset);
    const team = constructorById.get(asset.constructorId ?? asset.id);
    const common = {
      teamColor: team?.color ?? FALLBACK_COLOR,
      price: asset.price,
      previousPrice: history.prices.at(-2) ?? asset.price,
      priceHistory: history.prices,
      pointsHistory: history.points,
      seasonPoints: seasonPoints(history.points),
      selectedPct: asset.selectedPct ?? 0,
    };
    if (asset.kind === "constructor") {
      constructorAssets.push({ constructorId: asset.id, name: team?.name ?? asset.id, ...common });
      continue;
    }
    const driver = driverById.get(asset.id);
    driverAssets.push({
      driverId: asset.id,
      code: driver?.code ?? asset.id.slice(0, 3).toUpperCase(),
      name: driver ? `${driver.givenName} ${driver.familyName}` : asset.id,
      constructorId: asset.constructorId ?? "",
      team: team?.name ?? asset.constructorId ?? "",
      active: asset.active,
      ...common,
    });
  }
  return {
    season: file.season,
    gameday: latest?.round ?? 0,
    deadline: null,
    rules,
    rounds: file.rounds.map((r) => r.round),
    drivers: driverAssets,
    constructors: constructorAssets,
  };
}

/** One asset per id: a driver who changed seats has two game assets, the active one wins. */
function currentAssets(assets: FantasyRoundAsset[]): FantasyRoundAsset[] {
  const byId = new Map<string, FantasyRoundAsset>();
  for (const asset of assets) {
    const key = `${asset.kind}:${asset.id}`;
    const existing = byId.get(key);
    if (existing && existing.active) continue;
    byId.set(key, asset);
  }
  return [...byId.values()];
}

/** Price and points per round for the asset's id, oldest first (both seats of a mid-season move). */
function assetHistory(file: FantasyRoundsFile, asset: FantasyRoundAsset): AssetHistory {
  const history: AssetHistory = { prices: [], points: [] };
  for (const entry of file.rounds) {
    const matches = entry.assets.filter((a) => a.kind === asset.kind && a.id === asset.id);
    const row = matches.find((a) => a.active) ?? matches[0];
    if (!row || row.price === null) continue;
    history.prices.push(row.price);
    history.points.push(row.points);
  }
  return history;
}

function seasonPoints(points: (number | null)[]): number {
  let total = 0;
  for (const value of points) total += value ?? 0;
  return Math.round(total * 10) / 10;
}
