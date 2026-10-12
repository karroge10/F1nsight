# F1nsight competitive gap analysis

Date: 2026-10-08. Scope: our site (F1nsight, `v2/site`) against f1fantasytools.com, the official F1 Fantasy and F1 TV products, and a few free F1 data and stats sites.

Method: our pages were fetched over HTTP from the dev server at localhost:3000 (not restarted), and `v2/site/src` was read for the feature list. Competitor data comes from WebFetch of their own pages where possible (f1fantasytools.com home, pricing, rhter profile) and from WebSearch snippets and FanAmp articles otherwise. Reddit was not reachable through search: no r/fantasyF1 thread was retrieved directly, so the pain points in section (d) come from mirrors, Patreon posts and App Store reviews, and are weaker evidence than the rest.

## Caveats on the evidence

- **f1fantasytools.com**: home page and pricing page were read directly. The team calculator, price predictor and budget builder were not used live (no account, and the tools were not exercised), so their behaviour is taken from descriptions.
- **GP Tempo / f1-tempo**: no app or site by that name was found. The closest match found was GP Time (Formula Widgets). It is not in the matrix as a separate column because the identity is unconfirmed.
- **StatsF1**: no primary description found. The only feature text came from an AI-generated encyclopedia entry, which says it is unverified. Left out of the matrix.
- **TracingInsights**: described through mintlify docs mirrors and a sponsor page, not its own site. Treat its feature list as provisional.
- **fantasyformula1, Pitwall-type apps, RaceFans, F1 TV Data Hub**: not researched in depth. F1 TV data is described only from third-party guides. Not covered: a live check of any of these.
- **Pricing in EUR**: as shown on f1fantasytools.com/pricing at the time of fetch. Billing periods were shown as yearly; the monthly figure is the monthly equivalent.

## Section 1: What we have today (inventory from the live pages and source)

| Area | Feature | Where it lives |
| --- | --- | --- |
| Home | Next race card (round, sprint flag, countdown), pre-weekend predicted winner, predicted podium with percentages | `/`, `components/forecast/forecast-hero.tsx`, `countdown.tsx` |
| Forecast | Finishing-order table with win, podium, points, DNF percentages, expected finish, full P1 to P22 distribution, "why" factor chips (recent form, car pace, one-lap pace) | `components/forecast/forecast-table.tsx`, `factor-chips.tsx`, `components/charts/position-dist.tsx` |
| Forecast | Constructor forecast, title odds (with `<1%` and `>99%` clamping), track record of past predictions (backtest) | `constructor-forecast.tsx`, `title-odds.tsx`, `track-record.tsx` |
| Fantasy | Planner: budget 100M, 5 drivers and 2 constructors, bank and free transfers, optimiser objectives (Expected, Safe, Aggressive, Value), shareable link, reset | `components/fantasy/planner.tsx`, `team-builder.tsx`, `src/lib/fantasy/planner-state.ts`, `use-recommendation.ts` |
| Fantasy | Chips: Limitless, Wildcard, Final Fix, Autopilot, No Negative, x3 Boost | `planner.tsx` (chip list), `src/lib/fantasy/engine/chips.ts` |
| Fantasy | Market table for all drivers and constructors: price, last move, projected points, projected price, points per million, season points, ownership, projected range, price trend, team filter, search, sortable columns | `components/fantasy/fantasy-table.tsx`, `range-bar.tsx` |
| Fantasy | Price change prediction with probabilities per outcome; explanation of each asset; scoring engine; backtest of the engine | `src/lib/fantasy/engine/priceChange.ts`, `explain.ts`, `scoring.ts`, `backtest.ts`, `optimiser.ts`, `planner.ts`, `market.ts` |
| Fantasy | Note that free-data fantasy scoring is off by about 2.6 pts per driver and 4.0 pts per constructor (stated in INTEGRATION_TODO, to appear in UI) | `INTEGRATION_TODO.md` |
| Live | Track map with cars moving, timing tower (gap, interval, last lap, tyre), race control feed, pit stops, weather strip, status bar | `components/live/*`, `src/lib/live/*`, `/live` |
| Live | Replays of past sessions from local fixtures, session browser, replay controls, player | `components/live/session-browser.tsx`, `replay-controls.tsx`, `player.tsx`, `/api/replay/[season]/[round]` |
| Stats | Season calendar, races per season with winner and pole, race results, qualifying, pit stops, lap chart, progression chart, circuit outline | `components/stats/*`, `/races/[season]/[round]` |
| Stats | Driver index (400 of 818 shown, sortable by starts, wins, podiums, poles, titles, points), driver and team pages | `/drivers`, `/drivers/[id]`, `/teams`, `/teams/[id]` |
| Stats | Circuits index with lap record and set-by, circuit pages | `/circuits`, `/circuits/[id]` |
| Stats | Standings per season (drivers and constructors) with gap and wins | `/standings/[season]` |
| History | Champions since 1950, all-time records (wins, poles, podiums, titles, starts, points) | `/history` |
| Site | Light and dark theme, season pickers, free with no login, fixture-backed data with SQLite source | `theme-toggle.tsx`, `src/lib/data/source.ts`, `sqlite-source.ts` |

Our fantasy planner is the most complete piece in the matrix against the paywalled competitor, which lists "Team Planner" and "Simulation Builder" as "coming later" on its top tier.

## Section 2: Feature matrix

Legend: Yes, Partial, No, Unknown (not verified), Paid (behind a subscription).

| Feature | Us (F1nsight) | f1fantasytools.com | F1 Fantasy (official app/game) | TracingInsights | GP Time (widgets app) |
| --- | --- | --- | --- | --- | --- |
| Team calculator / best team optimiser | Yes (4 objectives) | Yes (Free; Best Teams with adjustable inputs) | No (game only) | No | No |
| Include/exclude assets, adjust xPts by hand | No | Yes (right-click, +/- 1 pt steps) | No | No | No |
| Race weighting slider for simulations | No | Yes (weight earlier races) | No | No | No |
| Sprint-weekend simulation | Partial (sprint flag in race card, not a sim toggle) | Yes (on demand) | No | No | No |
| Price change predictor | Yes (probabilities per outcome) | Yes (Free, via Team Calculator and Budget Builder) | Game only, no prediction | No | No |
| Budget Builder (points needed for each price outcome) | Partial (projected range and pts per M, not the "points needed" table) | Yes (Free) | No | No | No |
| Chips planning | Yes (6 chips in planner) | Partial (Limitless button and 3X/Wildcard in calculator) | Game only | No | No |
| Personal team analysis by race (Team Analyzer) | No | Paid (Pro, EUR 4.50 per month) | Game only | No | No |
| Season summary of your team | No | Paid (Pro) | No | No | No |
| League analyzer (leagues by league code) | No | Paid (Pro) | Game only | No | No |
| Hindsight: optimal team for past races | No (backtest of model, not optimal-team hindsight) | Yes (Free) | No | No | No |
| Live scoring of your own team during race | No | Partial (Free shows live scoring, real-time own-team updates on Pro) | Yes (game) | No | No |
| Elite / top-player strategy comparison | No | Yes (Free, "Elite Data") | No | No | No |
| Account link to official game | No | Paid (Starter and up) | Native | No | No |
| Mobile app | No (responsive web only, not verified) | No app found (mobile web with 5 tabs per FanAmp) | Yes (official app) | No | Yes (iOS widgets) |
| Light theme | Yes | Yes | Game | Unknown | Unknown |
| Discord community | No | Yes (Free, linked) | No | No | No |
| Free tier with no login | Yes (whole site) | Yes (tools, with paid tiers) | Game needs account | Yes (site, data on GitHub) | Yes (free with IAP) |
| Premium / subscription | None | Starter EUR 2.50, Pro EUR 4.50, Pro Plus EUR 6 per month (yearly billing) | F1 TV Pro separate | No | Premium membership, IAP |
| Race predictions with finishing-order probability (P1 to P22) | Yes (full distribution, win, podium, DNF) | Not evidenced (public descriptions focus on expected points and price) | No | No | No |
| Title odds | Yes | Not evidenced | No | No | No |
| Track record of predictions (backtest on site) | Yes | Not evidenced | No | No | No |
| Live timing with track map | Yes (with replay of recorded sessions) | No | Yes (official app, free tier shows positions, gaps, sectors) | Partial (data via GitHub, not live site) | Partial (race time widget, race progress) |
| Telemetry (speed, throttle, brake, gear) for any lap | No (FastF1 2018+ in pipeline, not yet a page) | Not evidenced | Yes (official app, live) | Yes (2026 repo: speed, throttle, brake, DRS, RPM, gear, 3D position) | No |
| Weather in live / race | Yes (weather strip, ff1_weather in pipeline) | No | Partial | Yes (weather updates) | No |
| Full history since 1950 (drivers, teams, circuits, results) | Yes (1950 to 2026, 818 drivers, 205 constructors, 78 circuits) | Statistics on race, driver, constructor data (range not stated) | Limited | Yes (Ergast-schema mirror) | Partial (standings, team info) |
| Driver and team career stats with sorting | Yes | Statistics (Free) | No | Partial | No |
| Circuit lap records | Yes | Unknown | No | Unknown | No |
| Replays of past sessions | Yes | No | Yes (official F1 TV, paid) | No | No |
| Open data and licence credits | Yes (CREDITS.md, footer to be placed) | Unknown | No | Yes (Apache-2.0) | No |
| Stated accuracy of fantasy estimate | Yes (2.6 pts/driver, 4.0 pts/constructor, to be shown) | Not evidenced | n/a | n/a | n/a |

Notes on the matrix:

- Our fantasy engine is an estimate built from free data. The competitor's team calculator uses a Monte Carlo model of per-driver parameters (qualifying pace, race pace, DNF probability, fast-lap probability, grid penalties), run 10,000 times per race. That matches our approach in kind. The public description does not say how well it calibrates.
- The "Not evidenced" cells mean the public pages and articles I read did not mention the feature. They do not prove the feature is absent.

## Section 3: What they have that we miss (ranked by user value and effort)

Ranking is value first, effort second. Effort is a rough guess: S is a day or two, M is about a week, L is more.

1. **Hindsight: optimal team for past races, compared to your own team.** High value, M. Our `fantasy_points` table and the backtest engine already score teams per round. A page that shows the best team per past round, with the points gap, would be a clear win for fans who want to learn. Free on their side. Note: no login is needed if the user's team is entered by hand.
2. **Team Analyzer and Season Summary (review of your past decisions).** High value for engaged players, M to L. Requires the user's team per race. Without an account, the team would come from the browser (local storage) or a pasted share link. This is the paid feature that most fits a local-first design. Decide first whether it should be free, since they put it behind Pro.
3. **Optimiser with adjustable inputs.** High value, S to M. They let users include or exclude assets, edit xPts by 1-point steps, set max budget, and weight past races. We already have four objectives and `optimiser.ts`. Adding lock/exclude per asset and a points override is probably the cheapest high-value addition.
4. **Budget Builder: the points each asset needs to hit each price outcome.** High value, S. Our `priceChange.ts` already holds probabilities per outcome. Showing the threshold table per asset (points needed for each price change) directly answers "what do I need to score to go up?". Check first whether the market table already shows this; it appeared to show projected range and pts per M only.
5. **Sprint-weekend simulation on demand.** Medium value, S to M. Our race card flags sprint weekends, but the planner does not offer a separate sprint simulation. Their sprint sim is user-triggered. Only worth doing if the sprint model exists in `ml/`.
6. **Race weighting slider (earlier races weighted more, e.g. for similar circuit type).** Medium value, M. Useful for a power-user audience. Needs a clean way to re-weight the backtest or form inputs.
7. **Live scoring of your own team during a race.** Medium-high value, L. Official F1 Fantasy scores are not public, so we would estimate from live timing (OpenF1 or our live relay). Our free-data scoring error is about 2.6 pts per driver, so this must be labelled as an estimate. Effort is high because the reconstruction is complex (overtakes, DOTD, pit bands).
8. **Mobile layout with tabs or an installable PWA.** Medium value, S to M. Their mobile site uses five bottom tabs. We have not checked our mobile layout. A `visual-qa` pass (not the main session) would settle it.
9. **Discord or community link, and a feedback form.** Low to medium value, S. Cheap. Their Discord is the place where rhter posts simulation results, so a community channel is part of their moat.
10. **League analyzer.** Low to medium value, L and uncertain. It needs league data from the official game, which we cannot read freely. Their paywall is on league code search. Not recommended for now.
11. **Official account linking.** Not feasible without an official API. Do not plan for it.
12. **Elite data (top 500 comparisons) and a built-in FAQ AI assistant.** Low for us. The top-500 data is not public. Skip.

## Section 4: What they all miss that we could uniquely offer

These are grounded in what our site already has. Each point is tied to a data source in the repo.

1. **Full finishing-order probabilities and title odds, not just points.** The competitor's public material centres on expected points and price. Our `next.json` has P1 to P22 probabilities, pWin, pPodium, pDnf and title odds. Showing "why" the team score is what it is (podium chance, DNF risk) is something no public competitor describes. Lean into it on the fantasy page: for each asset, show the win/podium/DNF probabilities next to projected points.
2. **Full stats archive since 1950 linked to fantasy and predictions.** They have Statistics and Hindsight for the current era. We have 1950 to 2026 for every driver, team and circuit, plus lap records. "This driver's record at this circuit, and what he scored there in fantasy" is a page no competitor offers.
3. **Telemetry from FastF1 2018+ tied to fantasy decisions.** TracingInsights does telemetry, but it does not connect it to fantasy prices or to predictions. Our pipeline already has `ff1_laps` (every lap, compound, stint, sector times, speed traps). A "car pace vs price" page (is this driver overpriced for his car's pace?) combines our telemetry with the fantasy market. This is the most distinctive angle.
4. **Weather-aware forecast and fantasy.** We have `ff1_weather` and a weather strip. Ask whether the model uses wet or dry conditions and show it. No competitor I found mentions weather in fantasy tools.
5. **Transparent accuracy.** Our backtest (track record component, ML report, retrain gate) is public. The competitor's own Patreon post admits its 2025 price thresholds came from dummy data left in the game at launch, and its Team Calculator was first released as a beta for paying subscribers. Publishing our calibration numbers and the 2.6 / 4.0 points error is a trust advantage. Make it visible on the fantasy page, not only in the footer.
6. **Free and local-first, with no login and no paywall.** Their free tier leaves out Team Analyzer, League Analyzer, Season Summary, personal team suggestions, and real-time scoring for your team. A fully free tool that keeps the user's team in the browser is a clear pitch. It also fits the stated spec: everything free.
7. **Live timing and replay of any recent session, as context for fantasy.** The official F1 app has live timing, but it is not a fantasy tool, and F1 TV is paid. Our replay of past sessions lets a user see how a fantasy-relevant event happened (a DNF, a late pit stop, a safety car) on a track map. That is an educational angle they do not offer.
8. **Open data credits and honesty about sources.** OpenF1 (CC BY-NC-SA), F1DB (CC BY 4.0), Jolpica, and the DHL pit stop feed are credited in `CREDITS.md`. Put them on the site as the spec requires. This is a small point, but none of the competitors cite data licences that I could see.

## Section 5: Pain points users raise (with evidence strength)

Reddit was not reachable directly, so these come from secondary sources. Each is labelled.

1. **The price-change model is predictable, and users feel it is a formula, not a race result.** A Reddit post mirrored on a Redlib site says price swings now follow a predictable formula tied to the last three races, not overall race weekend performance. Date unconfirmed, so possibly from 2025. Evidence: weak (mirror, undated).
2. **The price model's thresholds were unverified.** A 2025 Patreon post warned that the predicted PPM thresholds came from dummy data left in the game at launch. Evidence: medium (author is a community member, not confirmed by the game). It points to a trust issue with every price tool, including ours. Our honest labelling of estimates is the answer to it.
3. **Price tools are paywalled or beta-gated.** The competitor's Team Calculator was first released as a closed beta to Patreon subscribers only in 2024. League analysis needs Patreon. Evidence: strong (their own pages and FanAmp). Users who want the full toolset must pay.
4. **Subscription tiers are unclear at the start.** The competitor's homepage says plans start at EUR 2.50 per month, and only the pricing page lists the three tiers and their differences. Evidence: strong (their pages), but this is an observation, not a user complaint.
5. **The official F1 Fantasy app has a poor fantasy section.** An App Store review summary says the fantasy section is particularly buggy, one reviewer had to switch to a browser to manage their team, and another says elements fall off-screen and cannot be clicked on a phone. Evidence: medium (App Store reviews via Kimola summary; dates from 2024).
6. **Third-party fantasy apps charge unexpectedly or push ads.** Two unverified reviews of third-party "F1 Fantasy" apps complain about a surprise charge and forced ads. Evidence: weak (unverified app identity).
7. **Live data access is confusing.** OpenF1 sources disagree on whether live data is paid and whether free users are locked out around live sessions. Evidence: medium (conflicting third-party descriptions). Relevant to us: our live relay must not depend on a free-tier window that might close.
8. **Rules keep changing.** 2026 changed transfer netting, sprint DNF penalty (from -20 to -10), and the cap. Tools built for the old rules need rework. Evidence: strong (FanAmp, Motorsport.com).

## Section 6: Recommended next steps (for the owner to decide)

Ordered by value over effort. None of these have been built.

1. Show the points-needed threshold table per asset (gap item 4). Small change, answers a direct question.
2. Add include/exclude and xPts override to the optimiser (gap item 3).
3. Build a Hindsight page for past rounds, using `fantasy_points` (gap item 1).
4. Add a "car pace vs price" page that joins `ff1_laps` with the fantasy market (unique item 3). This is the strongest differentiator.
5. Make the accuracy and estimate error visible on the fantasy page (unique item 5).
6. Decide whether a browser-stored team history (Team Analyzer lite) should be free. Our spec says everything is free, which settles it in favour of free.
7. Run a `visual-qa` pass on mobile before deciding on a PWA or tabs (gap item 8).

## Sources

Competitor (f1fantasytools.com):
- https://f1fantasytools.com/ (home: free and premium tools, subscriber benefits)
- https://f1fantasytools.com/pricing (plans and features)
- https://f1fantasytools.com/rhter (analyst profile, simulation model, tool list)
- https://www.fanamp.com/f1-news/introducing-league-analyzer-from-f1-fantasy-tools (League Analyzer, Patreon gating, May 2025)
- https://www.fanamp.com/f1-news/f1-fantasy-tools-major-update-august-2024 (v2 update, Patreon beta, calculator features)
- https://www.fanamp.com/f1-news/3x-extra-drs-boost-chip-explained (chip rules)
- https://www.fanamp.com/f1-news/limitless-chip-explained (Limitless chip)
- https://www.fanamp.com/f1-news/f1-fantasy-budgets-explained-f1-fantasy-guide-2025 (price tiers and cost cap, 2025)
- https://www.fanamp.com/articles/2023-fantasy-innovation-price-gain-estimator-and-interview-with-rhter (price gain estimator history)
- https://www.patreon.com/posts/potential-new-124351728 (2025 price change algorithm post; dummy-data claim)
- https://www.fanamp.com/articles/f1-fantasy-2026-rules-scoring-and-whats-changed-this-season (2026 rules; Sprint DNF penalty)
- https://www.motorsport.com/f1/news/f1-fantasy-2026-prizes-and-changes-coming-to-this-season-explained/10800060/ (2026 changes: netting, cap)
- https://www.motorsportmagazine.com/articles/single-seaters/f1/f1-fantasy-chips-what-they-are-and-when-to-use-them/ (chips overview)
- https://www.fanamp.com/articles/best-and-worst-f1-fantasy-picks-for-the-austrian-grand-prix-2026 (2026 pick analysis, price-change tiers)
- https://www.fanamp.com/articles/f1-fantasy-can-ollie-bearman-avoid-a-price-drop-in-miami-and-canada-2026 (2026 price-drop analysis)

Official and other products:
- https://www.formula1.com/en/latest/article/f1-live-timing-bigger-and-better-than-ever.3wTlvar6VFvyDbm8GWnyMM (official live timing)
- https://apps.apple.com/hn/app/gp-time-formula-widgets/id6483362180 (GP Time: widgets, free with IAP)
- https://apps.apple.com/app/id6743395104 (Pit Stop GP Live, unofficial live timing app)
- https://www.mintlify.com/TracingInsights/2026/introduction (TracingInsights 2026 data: telemetry fields, licence)
- https://www.mintlify.com/TracingInsights/2026/data-sources (TracingInsights source mix: FastF1, MultiViewer, Jolpica)
- https://sponsors.ecosyste.ms/accounts/tracinginsights (TracingInsights scope and single-developer note)
- https://pypi.org/project/tif1/ (tif1: TracingInsights-cache FastF1 alternative)
- https://www.xatakandroid.com/aplicaciones-android/f1lt-una-app-gratuita-para-seguir-la-formula-1-en-tiempo-real (F1LT free live timing app)
- https://jonathansblog.co.uk/formula-1-live-timing-car-stats (2026 live timing overview, F1 TV tiers, weak source)
- https://macmyths.com/how-to-watch-f1-with-f1-tv-pro-plans-devices-and-the-2026-u-s-apple-tv-change/ (2026 US distribution change, weak source)
- https://github.com/br-g/openf1 (OpenF1 project)
- https://docs.fastf1.dev/api_reference/jolpica.html (FastF1 docs on Jolpica and Ergast shutdown)
- https://kimola.com/reports/in-depth-feedback-analysis-of-the-formula-1r-app-app-store-us-148412 (F1 app App Store feedback summary)
- https://redlib.ssps.io/r/fantasyF1 (r/fantasyF1 mirror, used for Reddit pain points)
- https://axebps-redlib.hf.space/r/fantasyF1/rising (Redlib mirror of r/fantasyF1, price-change complaint)

Our site (fetched and read locally):
- http://localhost:3000/ , /races, /races/2026, /drivers, /teams, /circuits, /standings, /history, /live, /fantasy (HTTP 200 each, text extracted)
- `v2/site/src/components/forecast/*`, `v2/site/src/components/fantasy/*`, `v2/site/src/components/live/*`, `v2/site/src/components/stats/*`, `v2/site/src/lib/fantasy/engine/*`
- `v2/INTEGRATION_TODO.md` (fantasy error figures, OpenF1 licence, credits), `v2/SPEC.md` (free-only rule, pillars)
