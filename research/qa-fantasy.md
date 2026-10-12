# Fantasy QA

Scope: `app/fantasy`, `app/api/fantasy`, `components/fantasy`, `lib/fantasy.ts`, `lib/fantasy/**` and their tests (site `src/`).
Checked against the running dev server at localhost:3000. No builds, no restarts, nothing outside the scope was edited.

## What I checked

- **Page load and console.** `/fantasy` renders with no console errors, no page errors and no failed requests (desktop and a 390px mobile context).
- **Planner flow (text assertions, Playwright).** Picked drivers and constructors, read the recommendation block, checked the reload persistence (the team comes back from localStorage) and the shared link (the `?d=...&c=...` query).
- **Duplicate picks.** Picked Russell in slot 1 and checked that slot 2 disables Russell. Loaded a link with `d=russell,russell,...`.
- **Invalid saved state.** Wrote `{drivers:"x", bank:"abc", freeTransfers:"many", chipsAvailable:[1,"nope"]}` to localStorage and reloaded: page renders, no errors.
- **Budget.** Filled a full team (top 5 drivers and 2 constructors) and read the budget meter text.
- **Mobile 390px.** No horizontal page overflow (scrollWidth 390). Team select and lock button measured 44px high.
- **Keyboard.** Tab order through the planner selects and chips was sequential. Select and lock controls are native or have `aria-label`.
- **Tests and types.** `npm run typecheck` and `npm test` pass after my edits (vitest exit 0).
- **Fixtures.** Read `lib/data/fixtures/fantasy/2026.json` and `predictions/next.json` to sanity check values (prices, points history, expected points).

Not checked: I did not visually review the design (I did not read screenshots in the main session; the scratch PNGs under `research/scratch/fantasy-qa/` are for a visual-qa pass). I did not verify the optimiser against the official 2026 rules (see Discrepancies). Live-timing and the model are out of scope.

## What I fixed

1. **Same driver or team could be picked twice.** Before: every slot offered all assets, so Russell could fill slots 1 and 2, and the engine would score him twice. After: an asset picked in another slot is disabled in the dropdown (`components/fantasy/planner.tsx`, `SlotRow`). Why: a duplicate team is not legal in F1 Fantasy.
2. **A team with repeats counted as complete.** `isTeamComplete` now also requires all picks to be different (`lib/fantasy/planner-state.ts`). Why: a team with a repeat is not a valid team to solve for.
3. **Repeated or unknown ids from a link or storage stayed in the team.** Before: `?d=russell,russell,zzz` kept both values in the form. After: `dropInvalidPicks` clears unknown ids and later repeats once the market loads (Planner effect). Covered by a new test in `planner-state.test.ts`. Why: the solver could otherwise get asset ids that do not exist.
4. **Saved state was trusted as-is.** Before: `loadStoredState` spread the parsed JSON into the state, so a string bank or a non-array list reached the solver. After: `sanitizeState` checks each field's type and falls back to the default. Why: localStorage can hold stale or hand-edited data.
5. **Over-cap team was not flagged.** Before: the budget was defined as the team's value plus the bank, so any team looked affordable, and the screen showed "199.9M of 199.9M" with no sign anything was wrong. After: a meter shows the team value against the 100M cap, with the text "Team X M of 100M" and a warning line when the team is above the cap. Why: a real F1 Fantasy team cannot cost more than the cap.
6. **Projection error was not disclosed.** Added a `ProjectionNote` (`components/fantasy/projection-note.tsx`) under the planner's headline stats and under the Market table: "In a typical race they miss by about 2.6 pts per driver and 4.0 pts per constructor." Why: the user asked for it next to the projections.
7. **Touch targets below 44px.** The team select and lock button were 36px on mobile. Now 44px below the `sm` breakpoint, 36px above it. Why: DESIGN.md asks for 44px touch rows.
8. **Motion.** Added CSS transitions (Tailwind `transition-*` with `motion-reduce:transition-none`): the team colour bar and price on each slot (`160ms` to `200ms`), and the budget bar width. Reduced motion turns them off. No change to `globals.css`.

## Rule and math discrepancies (not fixed, need an owner)

- **Top lineup projection looks high.** The sum of the top five driver expected points in `predictions/next.json` is about 126. The planner's best team says 274 expected points (with the p10 to p90 of +176 to +367). A boost (x2 or x3) and a chip can explain part of that, but I did not confirm it. The engine owner should show the breakdown (driver points, boost, chip) for the headline number.
- **2026 rule constants are documented best guesses.** `lib/fantasy/engine/rules.ts` says so in `assumptions`: carry-over of free transfers (1 max), Final Fix allowing a constructor, the No Negative clamp, the price tier split at 18.5M. I could not confirm these against the official 2026 rules from memory, so they are unverified.
- **Price bounds.** The page says "3 to 34" million. That matches `RULES_2026` (priceFloor 3, priceCeiling 34). Not checked against the official list.
- **Team totals ignore transfer and chip cost in the Stat row.** "vs your team" subtracts the transfer penalty, but the expected points number on the best team does not show the chip. Worth a note on the card.
- **Constructor code is `name.slice(0, 3)`** (`lib/fantasy.ts`). "Aston Martin" gives "AST", "Red Bull" gives "RED". Readable, but not the official three-letter codes. The fixtures could carry the code.
- **Dead code.** `components/fantasy/team-builder.tsx` and `solveLineups` in `lib/fantasy.ts` are not used by the page any more (the planner uses the engine in `lib/fantasy/engine`). Either remove them or wire them in. I did not delete them.

## UX gaps for team management

- No per-slot "clear" other than choosing the placeholder row, and no undo after Reset.
- The bank is typed by hand. There is no "use my real team" import; the user must re-enter the team and bank each time (the shared link helps but has to be made first).
- The bank input turns a typed "-" into 0 (`Number(e.target.value) || 0`). Typing a negative bank is awkward.
- The objective tabs (Expected, Safe, Aggressive, Value) are radio buttons without arrow-key handling. Tab works, arrow keys do not.
- `FantasyTable` uses `role="tablist"` for the Drivers and Constructors switch with no `tabpanel`, and no arrow-key behaviour. Either use plain buttons with `aria-pressed` or add the arrow keys.
- The projected points number has no change animation when the team changes (only the colour bar and price transition). A short number flash would need a keyframe, which belongs in the shared CSS.

## Requests for other areas

- **Design system (`globals.css`).** Optional: a shared `@keyframes` fade or flash for changed numbers, so the planner can animate projected points without inline styles. I did not add one.
- **Visual QA.** Someone should look at the planner at 390px and 1280px (the scratch PNGs `research/scratch/fantasy-qa/mobile.png` and `meter.png` are the starting points). I could not read the images in this session.
- **Scratch scripts.** Playwright probes live in `research/scratch/fantasy-qa/` (`run.mjs`, `probe.mjs`, `probe2.mjs`, `probe3.mjs`). Delete them when no longer needed.

## Files changed

- `src/lib/fantasy/planner-state.ts`: `isTeamComplete` checks for repeats; `sanitizeState`, `stringList`, `dropInvalidPicks` added; `loadStoredState` uses the sanitizer.
- `src/lib/fantasy/planner-state.test.ts`: two tests (repeat picks are incomplete; unknown and repeated picks are dropped).
- `src/components/fantasy/planner.tsx`: `picked` set disables taken assets; budget meter and cap warning; `dropInvalidPicks` effect on load; 44px touch sizes; motion transitions; `ProjectionNote` under the headline stats.
- `src/components/fantasy/projection-note.tsx` (new): the projection-miss note.
- `src/app/fantasy/page.tsx`: `ProjectionNote` under the Market table.
