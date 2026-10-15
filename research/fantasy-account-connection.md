# F1 Fantasy account connection and saved teams

Research date: 2026-10-08. Scope: how a user could link their official F1 Fantasy (fantasy.formula1.com)
team to our site, and where to store saved teams without Supabase.

Status legend used below:
- **Verified**: checked in our repo or with a live read-only request today.
- **Reported**: from a third-party repo, blog or aggregator. Not checked against the live game.
- **Unknown**: not found. Needs a check in a logged-in browser by the owner, not by us.

## 1. Summary

- The official game has **no public API and no OAuth**. The only documented-by-practice route is the
  game's own web front end, which talks to JSON endpoints. Two families exist:
  1. `https://fantasy.formula1.com/feeds/...` (CDN-cached, unauthenticated, season-level data). **Verified** working
     today, and already used by our pipeline.
  2. `https://fantasy-api.formula1.com/f1/<season>/...` (per-user endpoints, some marked "login required" in
     community notes). **Reported only**, and the host did not resolve from this machine today.
- Nothing we found shows a supported way to read a user's team by a public ID without logging in. Team
  identity in the community scrapers is `user_global_id` plus `slot` (or `teamNo`), which only the
  account owner can see.
- **Recommended primary approach: a browser-side "send my team" helper.** The user, already logged in on
  fantasy.formula1.com in their own browser, runs a small bookmarklet or copies a snippet from our site.
  It reads the user's own team JSON from the page they are already viewing, and hands only the team data
  to our site. Our server never sees a password or a cookie.
- **Recommended fallback (no login at all):** a quick team builder with a share URL, plus a "paste the team
  from the game" text parser and an optional screenshot-to-team step handled by the user, not by us.
- **Recommended backend:** Better Auth (optional, for accounts and passkeys) on **Cloudflare D1** via
  OpenNext, with a **no-account local-first mode** (localStorage plus a signed share link) as the default.
  Turso (libSQL) is the close second.

## 2. What exists today (verified in the repo and live)

### 2.1 Our pipeline reads the public feeds

`pipeline/src/f1p/fantasy/official.py` (read-only inspection):

- Base: `FEEDS = "https://fantasy.formula1.com/feeds"`.
- Fetches `schedule/raceday_en.json`, `limits/constraints.json`, `drivers/<gameday>_en.json`,
  `popup/playerstats_<PlayerId>.json` and `translations/web/en.json`.
- Docstring: "The game front end reads unauthenticated, CDN-cached feeds" and "The feeds only cover the
  running season; past seasons are not served any more."
- `http.py` sends a custom User-Agent, sleeps 0.35 s between requests and backs off on 429 and 5xx.

`data/raw/fantasy/README.md` records the same: no login, about 55 requests per refresh, terms at
fantasy.formula1.com/en/terms, and data owned by Formula One World Championship Ltd.

### 2.2 Live read-only test (today)

`GET https://fantasy.formula1.com/feeds/limits/constraints.json` with a plain User-Agent, no cookies:

- HTTP/2 200, `content-type: application/json; charset=utf-8`, 973 bytes.
- `server: F1-Gaming-prod`, behind CloudFront, `last-modified: Mon, 05 Oct 2026 11:49:49 GMT`.
- Shape: `Data.Value` with `GamedayId: 17`, `MatchdayId: 38`, `PhaseId: 1`, `MaxTeamValue: 100.0`,
  `DeadlineDate: "10/09/2026 00:00:00"`, `ActiveTour: 0`, `GMCSubScenario: "TR_PRE"`,
  `LPTourGamedayId: 16`, `ARRGamedayId: [17]`, `TREndGamedayId: 22`, `IsLateOnboard`,
  `IsActiveForNewUser`, `ShowRaceweekTab`, `isSwapSuggestion`, plus `Data.FeedTime` in UTC, IST and CEST.

Useful consequence: the deadline for gameday 17 (Singapore) is **2026-10-09 00:00**, which is about
16 hours from the date of this report. Any import feature must work with the deadline in mind.

We did **not** request any per-user endpoint, and did not log in anywhere.

### 2.3 Our own data already covers the public side

The processed tables (`fantasy_prices`, `fantasy_points`, `id_map_fantasy`) and the site engine in
`site/src/lib/fantasy/engine/` already hold 2026 prices, selection percentages and per-session points
for every driver and constructor. That is the data needed for **projected points**. Only the user's
team and league membership is missing.

## 3. Community knowledge of the per-user API (reported, not verified)

### 3.1 Endpoint map from a 2022-era community cheat sheet (Reported, stale)

Source: [Cheatography, "Fantasy F1 API Endpoints" (draft, 2022 paths)](https://cheatography.com/sertalpbilal/cheat-sheets/fantasy-f1-api-endpoints/)

Public (no login), per the sheet:
- `https://fantasy-api.formula1.com/f1/2022/teams`
- `https://fantasy-api.formula1.com/f1/2022/players`

Login required, per the sheet:
- `.../f1/2022/picked_teams?my_current_picked_teams=true&my_next_picked_teams=true`: the user's current and next team.
- `.../f1/2022/league_entrants`: leagues the user has joined.
- `.../f1/2022/favourite_teams/current`, `.../f1/2022/boosters`, `.../f1/2022/live_stats?game_period_id=1`,
  `.../f1/2022/players/{PID}/game_periods_scores?season_name=2022`.

Other entries that take identifiers:
- `.../f1/2022/picked_teams/156736032-1934705`: a picked team by a composite ID (`<user>-<team>`).
- `.../f1/2022/leaderboards/leagues?league_id=354131`: league details.
- `.../f1/2022/leaderboards/league/history?league_id=...&slot=1&user_global_id=61879411-101784`: a team in a league.
- `.../f1/2022/picked_teams/for_slot?game_period_id=1&slot=1&user_global_id=35381981-323925`: picks per period.

Reading: a team is addressed by `user_global_id` and `slot` (the slot is the account's team number).
Whether any of these work without a session for 2026 is **Unknown**.

### 3.2 Open-source scraper (Reported, 2026-dated)

- [F1-fantazy-bot/f1-fantasy-api-data PR #23](https://github.com/F1-fantazy-bot/f1-fantasy-api-data/pull/23)
  and the [repo](https://github.com/F1-fantazy-bot/f1-fantasy-api-data): the scraper signs in with
  `F1_FANTASY_EMAIL` and `F1_FANTASY_PASSWORD` through Playwright, then calls the game's API. It
  derives a 12-character `accountId` from the lower-cased `user_guid` with SHA-256, keeps the raw GUID out
  of public output, and uses `accountId + teamNo` as the stable key. It fetches league standings, rosters,
  budget, transfers and chips, and a "locked" run must finish before the race ends. Their notes say
  Limitless is reverted if the locked team is not captured in time. No endpoint paths or cookie handling
  are documented in the page. Note: that project uses a stored password, which we must not copy.
- The PR says the stable key for a team is `accountId + teamNo`, and that `v` in the raw API is the
  `teamNo` discriminator.

### 3.3 Postman documentation (Reported, not readable)

- [Postman "F1 Fantasy API" docs](https://documenter.getpostman.com/view/11462073/TzY68Dsi) is listed as the
  reference for undocumented endpoints. The page we could fetch had only the title, so the endpoint and
  auth details are **Unknown**.
- A community note says password login needs an anti-bot cookie that is not documented. Reported, not checked.

### 3.4 Other tools seen (Reported)

- [npm `f1-fantasy-api`](https://www.npmjs.com/package/f1-fantasy-api): a JS client, described as a work in
  progress. Its example reads driver data only.
- [go-f1-fantasy](https://github.com/ferueda/go-f1-fantasy): a Go client that can fetch a team by ID. Auth is
  not described.
- [PyPI formula-fantasy](https://pypi.org/project/formula-fantasy/): reads public driver and constructor points
  (its data comes from the official scraper on GitHub). It does not read user teams.
- [PyPI f1-fantasy 0.1.3](https://pypi.org/project/f1-fantasy/0.1.3): a personal optimiser that brute-forces
  a team from predictions. No account link.
- f1fantasytools.com: we could not find any documentation of how it imports a team. Unknown.
- Reddit (r/F1Fantasy): no tool or thread found that imports teams through an API. Players mostly use
  third-party league apps (GridRival, RaceRival). Unknown how they import.

### 3.5 Reachability (verified today)

`fantasy-api.formula1.com` **did not resolve** from this machine (`curl` exit 6, "Could not resolve host").
So the per-user API host is either blocked from our network, moved, or only reachable from the game's own
origin. This does not prove the endpoints are gone, but it means we cannot confirm them from here.

## 4. Options assessed

| # | Option | How it works | Feasibility | UX | Security | ToS / legal | Maintenance |
|---|---|---|---|---|---|---|---|
| A | **Server-side login proxy** (user types F1 email and password into our site, we log in) | Our server calls the game's login, keeps the session, reads the team | Medium. Needs an anti-bot step and login endpoints nobody has documented for 2026 | Familiar, but it looks like a phishing form | **Bad.** We would receive and hold passwords. Ruled out by the owner's "never store passwords" rule | High risk. Credential handling by a third party and automated login are likely against the terms | High. Breaks on any login change |
| B | **Cookie paste** (user copies the session cookie from DevTools into our site) | We replay their session to read their team | High, when it works | Poor. Users do not know how | **Bad.** A session cookie is full account access and would be stored | High risk. Same as A | Medium |
| C | **Browser helper / bookmarklet / small extension** | Runs in the user's own logged-in tab. Reads the user's own team JSON from the game's page context, then posts only the team to our site | Medium. Needs the endpoint list confirmed in a real browser | Good for power users (one click). A bookmarklet cannot read cross-origin without the user being on the game's site, so the tab must be on fantasy.formula1.com | **Good.** Cookies never leave the browser. We receive team data only | Medium. Reads the user's own data, but still calls private endpoints. Lower than A and B | Medium. Extension needs store review; bookmarklet is simpler |
| D | **Public team or league link** (user pastes a league ID or public team ID) | Reads league leaderboard or team by ID without login | Unknown. Community endpoints take `league_id` and `user_global_id`, and may need a session | Good if it works | Good. No credentials | Medium. Public endpoint use is grey, but no account access | Medium |
| E | **Manual quick picker** (user builds their team on our site) | Pure local data from our prices and points tables | High, we already have prices | Fast for "what if" planning | Excellent | None | Low |
| F | **Paste team text or screenshot OCR** (user copies the team list from the game, or uploads a screenshot) | We parse the text or run OCR, then match names to our driver list | High for text. Medium for OCR | Good. Familiar for users | Good. No account needed. Do not send screenshots to a third-party AI service unless the user agrees | None | Low |
| G | **Share link / team code** (our own) | Saves a team snapshot with an ID we issue | High | Good for sharing | Good | None | Low |

Notes on the rating:
- Option C is the only one that gives the user a real "import my team and leagues" experience without us
  holding credentials. It is the primary path, but it depends on Unknown endpoint details that the owner
  must confirm.
- Options E, F and G work with no login and no game API at all. They are the fallback and also the default
  for users who do not want to install anything.

## 5. Recommendation

### 5.1 Primary: "send my team" from the user's own browser (option C, bookmarklet first)

Flow:
1. The user logs in to fantasy.formula1.com in their own browser, as they already do.
2. On our site the user presses "Import from F1 Fantasy". The page shows a one-line bookmarklet.
3. The user clicks the bookmarklet on the game's own page. It reads the team data the game has already
   loaded for that user (or calls the endpoints listed in section 3.1 with `credentials: "include"` from the
   game's origin), then opens our site with the team JSON in a short-lived, one-time import code.
4. Our site validates the JSON against our own schema, stores it under the user's session or local storage,
   and shows the projected points.

What we never do: ask for the F1 password, read the cookie jar, store a session, or send the user's
cookies to our server.

Open risks to check in a logged-in browser (owner, not us):
- Which URL the game's own page calls for the user's team, and whether it returns the team for the logged-in
  user only.
- Whether the bookmarklet can read it (same-origin from fantasy.formula1.com is required for cookies).
- The deadline: the import must run before 2026-10-09 00:00 for gameday 17.

### 5.2 Fallback: no login, always available

- E: quick team builder with the 2026 price list, budget (100.0 M) and the transfer planner.
- F: "paste from the game" parser for the team screen text, with name matching against `id_map_fantasy`.
  Screenshot OCR is optional and runs only if the user uploads an image themselves.
- G: a share link for any saved team (signed, unguessable ID), so a user can open their team on another device.

This fallback gives every user the projections and transfer suggestions even if the game's endpoints
change or the bookmarklet breaks.

### 5.3 What we explicitly do not build

- No password form, no login proxy, no cookie paste field.
- No copying of the stored-password scraper pattern from section 3.2.
- No bulk crawling of other users' teams or leagues by ID.

## 6. Security and legal notes

- Passwords: never requested, never stored, never sent. A bookmarklet runs in the user's own tab, so the
  password never leaves the game's page.
- Cookies: never stored by us. The helper must not log or forward the `Cookie` header.
- Team data: store only what the site needs (team picks, budget, chips, league IDs if given). Store the
  user's F1 identifiers only as a hash or as a per-site random key, not the raw `user_global_id` if it is not
  needed.
- Terms: F1 Fantasy's terms (fantasy.formula1.com/en/terms) were not retrieved; the search did not return
  them. The owner should read them before launch, especially the clauses on automated access and on
  reproducing data. Our pipeline notes already say the data is © Formula One World Championship Ltd and is
  for private, non-commercial analysis. A paid or public product would need that resolved.
- Rate limits: the feeds are CDN-cached. Keep our pipeline's 0.35 s spacing, and do not poll per user.
- Disclaimer: the site should say that it is not affiliated with F1 or F1 Fantasy, and that projections
  carry the error stated in `INTEGRATION_TODO.md` (about 2.6 points per driver and 4.0 per constructor).

## 7. Backend and storage options (non-Supabase)

Pricing comes from aggregator and review pages, not official pricing pages, unless noted. Re-check before
committing. Where sources disagree, both figures are given.

### 7.1 Cloudflare D1 (with Better Auth via OpenNext)

- Free (Workers Free): 5 million rows read per day, 100,000 rows written per day, 5 GB storage.
  Limits reset at 00:00 UTC. Going over blocks queries, it does not bill.
- Paid (Workers Paid, $5 per month): 25 billion rows read and 50 million written per month included,
  then $0.001 per million reads and $1.00 per million writes. 5 GB included, then $0.75 per GB-month.
- No egress or bandwidth charge for D1 data.
- Fit: the site is Next.js 16.4.0 (`site/package.json`). There is no deployment config yet (no
  wrangler, Vercel or OpenNext files). OpenNext for Cloudflare is reported to be at 1.0 (Feb 2026), with
  Node runtime and `nodejs_compat` plus a compatibility date of 2024-09-23 or later. Worker size limit:
  3 MiB free, 10 MiB paid.
- Better Auth: a third-party guide reports D1 native support from better-auth 1.6 (v1.5 and v1.6 features).
  The same guide warns that an earlier doc used a `d1Adapter()` that does not exist. Verify in the official
  Better Auth docs.
- Sources: [Cloudflare D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/index.md),
  [D1 FAQ](https://developers.cloudflare.com/d1/reference/faq), [OpenNext and Next.js on Workers guide](https://noqta.tn/en/tutorials/opennext-cloudflare-workers-nextjs-deployment-2026),
  [better-auth-cloudflare](https://github.com/zpg6/better-auth-cloudflare).

### 7.2 Turso (libSQL) with Better Auth or Drizzle

- Free: 5 GB, 500 million row reads, 10 million row writes, 100 databases (aggregator figures).
- Paid: Developer $4.99 per month, Scaler $24.92 or $29 (sources disagree), Pro $416.58 or $79 (sources disagree).
- libSQL is a SQLite fork. Turso is widely used for serverless SQLite. Better Auth's official SQLite page
  lists better-sqlite3, `node:sqlite`, `bun:sqlite` and Kysely, but **not** libSQL or Turso. Turso would
  therefore go through Kysely or Drizzle with a libSQL driver. Verify before use.
- Sources: [Turso pricing (aggregator)](https://basekv.com/articles/turso-pricing-free-tier-limits-2026),
  [Better Auth SQLite adapter](https://better-auth.com/docs/adapters/sqlite).

### 7.3 Neon (serverless Postgres) with Better Auth

- Free: 100 CU-hours and 0.5 GB storage per project, autoscale up to 2 CU, 10 branches.
- Paid: usage-based, about $0.106 per CU-hour (Launch) and $0.222 (Scale). One source says $0.14 (older).
- Fit: works well with Better Auth and Drizzle. More moving parts than we need for a small site, and
  Postgres is more than the data needs. Postgres-only features are not required.
- Source: [Neon pricing (aggregator)](https://costbench.com/software/database-as-service/neon/).

### 7.4 PocketBase (self-hosted, single binary)

- Free software. Self-hosting on a VPS costs about $5 to $10 per month (aggregator). Managed: PocketHost
  free plan (50 MB, 1 instance); PocketBase Cloud from $5 per month; Elestio from $11 per month.
- Fit: auth, a DB and an admin UI in one file. But it is a separate server process, so it does not fit
  Next.js on Workers well, and we would run and back it up ourselves.
- Source: [PocketBase FAQ](https://pocketbase.io/faq/), [hosting roundup](https://hostadvice.com/vps/pocketbase-hosting/free/).

### 7.5 Convex (not recommended)

- Free Starter: 1M function calls, 0.5 GB storage, 1 GB bandwidth, 6 developers. Professional $25 per
  developer per month. Its own backend model is a bigger change than we need.
- Source: [Convex pricing (aggregator)](https://www.saasodds.com/blog/convex-pricing).

### 7.6 Auth layer

- **Better Auth**: the successor to Auth.js. Auth.js was folded into Better Auth in September 2025
  (reported). Passkeys are a plugin (reported package name `@better-auth/passkey`, not verified).
  Email magic link and OAuth are available. Works with Next.js; the Cloudflare path needs checking.
- **Auth.js (NextAuth)**: keep only for existing projects. Larger OAuth catalogue.
- Sources: [Better Auth vs Auth.js comparison (aggregator)](https://gautamkhorana.com/authentication/compare/authjs-vs-better-auth/),
  [Better Auth SQLite](https://better-auth.com/docs/adapters/sqlite).

### 7.7 Comparison

| Option | Free tier | Paid entry | Fit with Next.js 16 on a Cloudflare-style host | Fit for small team data | Ops burden |
|---|---|---|---|---|---|
| D1 + Better Auth | 5M reads, 100k writes per day, 5 GB | $5 per month | Good (OpenNext, reported) | Good | Low |
| Turso + Drizzle or Kysely | 500M reads, 10M writes per month, 5 GB | $4.99 per month (Developer) | Good, needs a libSQL driver check | Good | Low |
| Neon + Better Auth | 100 CU-h, 0.5 GB per project | usage based | Good | Over-sized | Low |
| PocketBase | free, self-host | about $5 to $10 per month VPS | Poor (separate server) | Good | Medium to high |

### 7.8 Recommendation

**Cloudflare D1 with Better Auth, using OpenNext on Workers**, plus a **no-account default** that keeps
the team in the browser (localStorage) and shares it through a signed link.

Why:
- The free tier covers this site comfortably. A saved team is a few kilobytes and a few reads per visit.
- No Supabase, no separate server, one vendor, and no egress charges.
- Better Auth gives optional accounts and passkeys without making accounts mandatory.
- Turso is the fallback if OpenNext on Cloudflare turns out to be painful for this site.

Open questions for the owner:
- Where the site is hosted now (no deployment config exists in `site` today).
- Whether accounts are needed at launch, or the local-first plus share-link mode is enough.

## 8. Implementation plan

Assumes the recommended path. Each step is small and can ship on its own.

### Phase 0: confirm the unknowns (owner, 30 minutes, in the owner's own logged-in browser)

1. Open the game's team page while logged in. Note every request to `fantasy.formula1.com/feeds/...` and
   `fantasy-api.formula1.com/...` that carries team data (DevTools Network tab). Record URL, method and
   response keys only. Do not copy cookies or tokens into any file.
2. Check whether the same request works from a logged-out tab (it should not).
3. Read the game's terms at fantasy.formula1.com/en/terms, and record the clauses on automated access.

This step decides whether the bookmarklet can read the team, or whether we fall back to the paste flow.

### Phase 1: no-login team builder (ships first, no risk)

Files (new, under `site`):
- `src/app/fantasy/team/page.tsx`: team builder with budget and transfer planner.
- `src/lib/fantasy/team/schema.ts`: zod schema for a team (driver and constructor asset IDs, captain,
  chips, budget). Asset IDs come from the existing `fantasy_prices` export.
- `src/lib/fantasy/team/local-store.ts`: read and write the team to localStorage with a version field.
- `src/lib/fantasy/team/share-code.ts`: encode a team as a compact, signed, URL-safe string. The signature
  uses a server secret so links cannot be forged. Reuse the existing engine for projected points.
- `src/app/fantasy/team/[code]/page.tsx`: read-only shared view.
- `src/app/api/fantasy/team/route.ts`: validate a team payload and return the signed share code (POST).
- `src/lib/fantasy/team/paste-parser.ts`: parse pasted team text into asset IDs, matched by name against
  the current feed.

Export step (pipeline, read-only for the site): a small addition to `pipeline` writes the current
gameday's asset list (IDs, names, prices, selection %) to `site/public/data/fantasy/<season>/assets.json`
so the site needs no database for prices. Check how the existing site data export works before adding it.

### Phase 2: browser helper import (after Phase 0 confirms the endpoints)

- `src/app/fantasy/import/page.tsx`: instructions, one-click bookmarklet, and the import status.
- `src/lib/fantasy/import/bookmarklet.ts`: generates the bookmarklet source. It runs on
  fantasy.formula1.com, reads the team JSON the page loads, validates the shape, and sends only that
  team to our import URL with a one-time code. No cookies, no tokens, no passwords.
- `src/app/api/fantasy/import/route.ts` (POST): accepts `{ code, team }`, checks the one-time code
  (stored with a 10-minute expiry), validates the team with the Phase 1 schema, and returns a share code.
  Rejects anything with extra fields.
- Rate limit the route per IP. The import is a user action, so one import per minute is enough.

### Phase 3: optional accounts (Better Auth)

- `site/auth.ts`: Better Auth config with the D1 database binding, email magic link, and the passkey
  plugin (verify the package name first).
- `site/wrangler.jsonc`: D1 binding (`DB`), `nodejs_compat`, compatibility date 2024-09-23 or later.
- `site/migrations/0001_auth.sql` and `0002_teams.sql`: Better Auth tables and `saved_teams`
  (id, user_id, season, gameday, payload JSON, created_at, updated_at).
- `src/app/api/auth/[...all]/route.ts`: Better Auth handler.
- `src/app/api/teams/route.ts` (GET list, POST save) and `src/app/api/teams/[id]/route.ts` (GET, PUT, DELETE),
  each checking the session.
- Migrate local teams into the account on sign-in: the client posts the localStorage team once.

### Phase 4: leagues and history (only if Phase 0 shows a usable league endpoint)

- `src/lib/fantasy/leagues/`: league membership and standings read from the endpoint confirmed in Phase 0,
  with a 6-hour cache in D1.
- Show the projected rank in a league using the projected points we already have.

### Projections and transfer suggestions (all phases)

- Reuse `site/src/lib/fantasy/engine/` for points. Feed it the team, the 2026 price table and the
  per-asset expected points from the ML outputs in the pipeline. Read the existing `use-recommendation.ts`
  before writing new logic.
- Transfer suggestions: rank single swaps by projected gain per million of price change, within the budget
  and the free transfer count. Keep this in the engine, not in the route.

### Testing and checks

- Unit tests for the team schema, paste parser and share code (`vitest`, matching the existing
  `planner-state.test.ts`).
- Contract test for the import route with a saved fixture (not a live request).
- Before each deploy: the deadline check (no import after the gameday deadline shown in `constraints.json`).

## 9. Sources

- [F1-fantazy-bot/f1-fantasy-api-data, PR #23 (account IDs)](https://github.com/F1-fantazy-bot/f1-fantasy-api-data/pull/23)
- [F1-fantazy-bot/f1-fantasy-api-data (scraper)](https://github.com/F1-fantazy-bot/f1-fantasy-api-data)
- [Postman, "F1 Fantasy API" (undocumented, title only)](https://documenter.getpostman.com/view/11462073/TzY68Dsi)
- [Cheatography, "Fantasy F1 API Endpoints" (2022 draft)](https://cheatography.com/sertalpbilal/cheat-sheets/fantasy-f1-api-endpoints/)
- [npm f1-fantasy-api](https://www.npmjs.com/package/f1-fantasy-api)
- [go-f1-fantasy](https://github.com/ferueda/go-f1-fantasy)
- [PyPI formula-fantasy](https://pypi.org/project/formula-fantasy/)
- [PyPI f1-fantasy 0.1.3](https://pypi.org/project/f1-fantasy/0.1.3)
- [FanAmp, F1 Fantasy Tools v2 update (Aug 2024)](https://www.fanamp.com/f1-news/f1-fantasy-tools-major-update-august-2024)
- [Cloudflare D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/index.md)
- [Cloudflare D1 FAQ](https://developers.cloudflare.com/d1/reference/faq)
- [Better Auth, SQLite adapter](https://better-auth.com/docs/adapters/sqlite)
- [Turso pricing (aggregator)](https://basekv.com/articles/turso-pricing-free-tier-limits-2026)
- [Neon pricing (aggregator)](https://costbench.com/software/database-as-service/neon/)
- [Convex pricing (aggregator)](https://www.saasodds.com/blog/convex-pricing)
- [PocketBase FAQ](https://pocketbase.io/faq/)
- [PocketBase hosting (aggregator)](https://hostadvice.com/vps/pocketbase-hosting/free/)
- [Better Auth vs Auth.js (aggregator)](https://gautamkhorana.com/authentication/compare/authjs-vs-better-auth/)
- [OpenNext on Cloudflare Workers with Next.js (tutorial)](https://noqta.tn/en/tutorials/opennext-cloudflare-workers-nextjs-deployment-2026)
- [better-auth-cloudflare](https://github.com/zpg6/better-auth-cloudflare)
- Repo files read: `pipeline/src/f1p/fantasy/official.py`, `pipeline/src/f1p/fantasy/http.py`,
  `data/raw/fantasy/README.md`, `INTEGRATION_TODO.md`, `site/package.json`.
- Live request: `GET https://fantasy.formula1.com/feeds/limits/constraints.json` (2026-10-08, read-only).
- DNS check: `fantasy-api.formula1.com` did not resolve from the research machine (2026-10-08).

## 10. Not verified (be explicit)

- No per-user endpoint was called. Team and league endpoints in section 3 are from community notes.
- `fantasy-api.formula1.com` did not resolve here, so its current state is unknown.
- F1 Fantasy's terms were not retrieved.
- All storage prices are from aggregator pages. Check the vendor pages before committing.
- The Better Auth + D1 and passkey plugin details are third-party reports and need the official docs.
