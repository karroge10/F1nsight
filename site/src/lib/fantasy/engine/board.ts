// Everything the fantasy planner page shows below the lineup, in one engine call: the best full
// lineups reachable from the saved team, the best lineup for each transfer count, and a plan for
// the next races that starts from the user's draft.

import type { Market } from "./market";
import { evaluateTeam, optimiseTeam } from "./optimiser";
import { planTransfers } from "./planner";
import type { TeamResult, TeamSelection, TransferPlan, UserState } from "./types";

export interface BoardOptions {
  /** Lineups in the ranked list. Default 16. */
  topN?: number;
  /** Highest transfer count with its own best lineup (0 = keep the team). Default 3. */
  maxTransfers?: number;
  /** The lineup being edited this week. The plan starts from it when it is complete. */
  draft?: TeamSelection | null;
  /** Races in the plan, this one included. Default 4. */
  planRounds?: number;
  /** Time limit of each single-race search (ms). */
  maxMs?: number;
}

export interface PlannerBoard {
  /** Best lineups from the saved team (state.team), best first. */
  best: TeamResult[];
  /** Best lineup with exactly i transfers; index 0 is the saved team kept as it is. Empty for a new team. */
  byTransfers: (TeamResult | null)[];
  /** Plan over the next races: the draft in the first race, then the best transfers. */
  plan: TransferPlan | null;
  /** False when a search hit its time limit. */
  exact: boolean;
}

export function plannerBoard(market: Market, state: UserState, options: BoardOptions = {}): PlannerBoard {
  const maxMs = options.maxMs;
  const ranked = optimiseTeam(market, state, { topN: options.topN ?? 16, maxMs });
  let exact = ranked.exact;
  const byTransfers: (TeamResult | null)[] = [];
  if (state.team) {
    const keep = evaluateTeam(market, state, state.team);
    byTransfers.push(keep);
    for (let count = 1; count <= (options.maxTransfers ?? 3); count++) {
      const result = optimiseTeam(market, state, { topN: 1, exactTransfers: count, maxMs });
      exact = exact && result.exact;
      byTransfers.push(result.best);
    }
  }
  const plan = options.draft ? planFromDraft(market, state, options.draft, options.planRounds ?? 4) : null;
  return { best: ranked.alternatives, byTransfers, plan, exact };
}

function planFromDraft(market: Market, state: UserState, draft: TeamSelection, rounds: number): TransferPlan | null {
  const complete = draft.drivers.length === market.rules.drivers && draft.constructors.length === market.rules.constructors;
  if (!complete) return null;
  const planState: UserState = { ...state, team: draft, chipsToPlay: [], freeTransfers: market.rules.freeTransfersPerRace };
  return planTransfers(market, planState, { rounds, holdFirst: true });
}
