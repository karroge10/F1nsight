export const documentedPicks = [{
  season: 2026,
  round: 17,
  driverId: "max_verstappen",
  name: "Max Verstappen",
  probability: 0.29,
  stage: "post-practice",
  recordedAt: "2026-10-09T20:04:43.897Z",
  source: "t3-thread://v1/50940139-d87d-48a7-92f1-544c363cec06",
  sourcePosition: 570,
  evidence: "Project log records Verstappen as the favourite at a rounded 29% after Russell's grid penalty was applied. A later message at 20:42 UTC records the local site rebuild. This supports a pre-race pick, not recovery of the complete forecast or verification of a public deployment.",
}];

export function documentedPick(season: number, round: number) {
  return documentedPicks.find(pick => pick.season === season && pick.round === round) ?? null;
}
