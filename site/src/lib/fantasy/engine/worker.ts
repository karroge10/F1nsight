// Web Worker entry for the fantasy engine. Keeps the parsed market between messages, so only
// the first request pays for parsing the 2000 scenario rows.
//
// UI side:
//   const worker = new Worker(new URL("@/lib/fantasy/engine/worker.ts", import.meta.url), { type: "module" });
//   worker.postMessage({ id: 1, type: "recommend", file, state });
//   worker.onmessage = (event) => { const { id, ok, result, error } = event.data; };

import { adviseChips } from "./chips";
import { recommend, type RecommendOptions } from "./index";
import { prepareMarket, type Market } from "./market";
import { optimiseTeam, type OptimiseOptions } from "./optimiser";
import { planTransfers, type PlanOptions } from "./planner";
import type { FantasyFile, UserState } from "./types";

export type EngineRequest =
  | { id: number; type: "recommend"; file?: FantasyFile; state: UserState; options?: RecommendOptions }
  | { id: number; type: "optimise"; file?: FantasyFile; state: UserState; options?: OptimiseOptions }
  | { id: number; type: "plan"; file?: FantasyFile; state: UserState; options?: PlanOptions }
  | { id: number; type: "chips"; file?: FantasyFile; state: UserState };

export type EngineResponse = { id: number; ok: true; result: unknown; ms: number } | { id: number; ok: false; error: string };

let cached: { key: string; market: Market } | null = null;

/** Handle one request (also usable without a worker). `file` may be omitted after the first request. */
export function handleEngineRequest(request: EngineRequest): EngineResponse {
  const started = performance.now();
  try {
    const market = marketFor(request.file);
    const result = run(market, request);
    return { id: request.id, ok: true, result, ms: performance.now() - started };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { id: request.id, ok: false, error: message };
  }
}

function run(market: Market, request: EngineRequest): unknown {
  if (request.type === "recommend") return recommend(market, request.state, request.options);
  if (request.type === "optimise") return optimiseTeam(market, request.state, request.options);
  if (request.type === "plan") return planTransfers(market, request.state, request.options);
  return adviseChips(market, request.state);
}

function marketFor(file: FantasyFile | undefined): Market {
  if (!file) {
    if (!cached) throw new Error("send the fantasy file with the first request");
    return cached.market;
  }
  const key = `${file.season}:${file.round}:${file.generatedAt}`;
  if (cached && cached.key === key) return cached.market;
  const market = prepareMarket(file);
  cached = { key, market };
  return market;
}

interface WorkerScope {
  postMessage: (message: unknown) => void;
  onmessage: ((event: { data: EngineRequest }) => void) | null;
}

const scope = globalThis as unknown as Partial<WorkerScope> & { document?: unknown };
if (typeof scope.postMessage === "function" && scope.document === undefined && "onmessage" in scope) {
  scope.onmessage = (event) => {
    const response = handleEngineRequest(event.data);
    scope.postMessage?.(response);
  };
}
