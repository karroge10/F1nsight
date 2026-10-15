# f1live: live timing and replay relay

A FastAPI service on `http://localhost:8765` that streams an F1 session to the website: every car
moving on a track map plus a full timing tower, race control, weather and track status. When no
session is live, the same WebSocket messages replay any past session from the official archive.
Without a paid token a live session has no car positions in the feed, so the service estimates
them from the free timing feed (see "Estimated positions"), labelled `estimated`.

```
cd live
uv sync
uv run python -m f1live                      # live relay on 127.0.0.1:8765
uv run python -m f1live --simulate 2026:16:R --sim-speed 4 --sim-start -120
                                             # /ws/live plays a recorded race through the live parser
uv run uvicorn f1live.app:create_app --factory --port 8765   # same service, plain uvicorn
uv run pytest                                # unit + end-to-end tests (first run downloads ~80 MB)
uv run python scripts/ws_client.py ws://127.0.0.1:8765/ws/live --seconds 20   # rates + samples
uv run python -m f1live --simulate 2026:14:R --sim-anonymous   # like live without a token: estimated cars
uv run python scripts/validate_estimator.py 2025:18:R --ref auto   # estimate vs real positions
uv run python scripts/probe_static_live.py --season 2026 --round 17 --session FP1   # during a session
```

Options: `--host`, `--port`, `--simulate SEASON:ROUND:SESSION`, `--sim-speed` (multiplier),
`--sim-start` (seconds relative to the green light, negative = before), `--sim-anonymous` (drop
`Position.z` and `CarData.z` from the simulation, exactly what an anonymous live connection
gets). Session codes: `FP1 FP2 FP3 SQ S Q R`. Environment overrides are listed in `src/f1live/config.py` (`F1LIVE_PORT`,
`F1LIVE_FRAME_HZ`, `F1LIVE_DATA_DIR`, `F1LIVE_CORS`, ...).

## Data sources and what needs auth

Checked on 2026-10-07 with real requests:

| Source | What it gives | Auth |
| --- | --- | --- |
| F1 SignalR Core hub `wss://livetiming.formula1.com/signalrcore` | Live timing: TimingData, TimingAppData (stints, tyres), TimingStats, DriverList, SessionInfo, SessionStatus, LapCount, TrackStatus, RaceControlMessages, WeatherData, ExtrapolatedClock, TopThree, PitLaneTimeCollection | **None** for all of these |
| same hub, `Position.z` and `CarData.z` | Car X/Y positions (about 4 Hz) and car telemetry | **F1TV subscription token** (Bearer). Without it the hub silently leaves these two topics out of the snapshot and the updates |
| F1 legacy SignalR hub `/signalr` | Same feed, old protocol | Answers **401** to anonymous negotiate; not used |
| OpenF1 `api.openf1.org/v1/location` etc. | Positions, intervals, laps, stints | Historical (2023+): free, no token. **Live during a session: paid sponsor account** (OAuth2 token from `POST /token`) |
| F1 static archive `livetiming.formula1.com/static/<year>/...` | The recorded live feed of every finished session (`Index.json`, one `<Topic>.jsonStream` per topic, positions included). HTTP Range requests work (`accept-ranges: bytes`). Whether it is written during a session is not known yet (see "Free options checked") | None |
| MultiViewer `api.multiviewer.app/api/v1/circuits/<key>/<year>` | Circuit rotation, corner numbers, outline | None (new circuits can be missing) |
| Jolpica `api.jolpi.ca/ergast/f1/<year>/races` | Season schedule with every session start | None |

Optional credentials (environment variables, nothing is required):

- `F1TV_SUBSCRIPTION_TOKEN`: the F1TV subscription JWT (the `subscriptionToken` FastF1 stores
  after `fastf1 auth`). Sent as `Authorization: Bearer` on negotiate and the WebSocket; unlocks
  live `Position.z` and `CarData.z` from the official hub.
- `OPENF1_TOKEN`, or `OPENF1_USERNAME` and `OPENF1_PASSWORD`: OpenF1 sponsor access for live
  positions when there is no F1TV token.

## Fallback chain

Live (`/ws/live`):

1. Official SignalR Core hub, always: timing, tyres, pit stops, race control, weather, track
   status, lap count, clock. With an F1TV token it also delivers positions and car data.
2. If the hub delivers no positions while a session is running (20 s grace), OpenF1 `/location`
   is polled and converted into the same Position messages. With a sponsor token this works
   live; without one OpenF1 refuses and the poller stops after one attempt.
3. If the static archive's `Position.z.jsonStream` of the running session grows during the
   session (`DelayedPositions`, polled every 30 s with Range requests) and is at most 6 s behind,
   frames are drawn from it, labelled `official-delayed`. Up to 15 min behind it only corrects
   the estimate (mini-sector distances, where stopped cars are).
4. Otherwise the positions are **estimated** from the anonymous timing feed (`PositionEstimator`,
   reference built from an earlier session at the same circuit in the free archive). Frames
   carry `source: "estimated"` and `init.positionsSource` is `"estimated"`, with
   `positionsAvailable: true`.
5. Only if no reference can be built (a circuit never raced, archive unreachable) `frame.cars` is
   empty and `positionsAvailable` is `false`, so the site shows the tower without dots.

Replay (`/ws/replay`): the static archive alone (timing and positions), decoded once and cached
on disk. No auth anywhere. `&positions=estimated` ignores the recorded positions and shows the
estimate instead (reference from sessions before the replayed one), to compare it with reality.

Track map, best first: the session's own fastest clean lap from position data; the pipeline's
FastF1 export `data/raw/fastf1/<season>/<RR>_track.json` for sector lines, corners and rotation
when present; MultiViewer for rotation, corners, or the outline itself; the per circuit cache in
`data/raw/livetiming/tracks/circuit_<key>.json` (written whenever a track is built from
positions, and what the live mode uses before the first lap of a session).

## How it works

```
 SignalR Core hub ──text frames──┐
 archive lines ──feed_frame()────┤  signalr.parse_frames  (the live parser)
 (simulated live)                │        │ decode_feed: base64 + raw deflate for *.z topics
                                 │        ▼
 OpenF1 /location ──Position msg─┼──> SessionEngine.ingest
                                 │        ├─ SessionState: deep merge of every topic (deltas
 archive (replay) ──decode_feed──┘        │   keyed by driver number, list patches by index,
                                          │   _deleted keys), notices for new events
                                          ├─ PositionStore / TelemetryStore: per car series
                                          └─ tick(now): events + timing (if changed) + frame
                                                  │
                         LiveHub (one upstream, shared) / ReplayPlayer (one per client)
                                                  │
                                         WebSocket JSON messages
```

- `decode.py`: `decode_z` (base64, then raw deflate with no zlib header, then JSON), ISO
  timestamps with 7 fractional digits, archive line format `HH:MM:SS.mmm<json>`.
- `merge.py`: the feed sends a full object once, then sparse deltas. Lists are later patched
  with index-keyed objects (`{"Sectors": {"1": {...}}}`), `_deleted` removes keys. Values are
  copied so a message can be applied twice (replay seeks).
- `state.py`: merged topics, plus lap and sector completion marks, new race control messages,
  pit stops (PitLaneTimeCollection) and new tyre stints.
- `engine.py` and `messages.py`: build the outgoing messages.
- `hub.py`: `LiveHub` holds one upstream connection for every `/ws/live` client, ticks at
  `FRAME_HZ` (8) and broadcasts; per client bounded queues drop old frames for slow clients.
  The upstream starts with the first client and closes 60 s after the last one leaves.
  `SimulatedFeed` turns archive lines into the exact SignalR Core frame text the hub sends
  (`{"type":1,"target":"feed","arguments":[topic, data, utc]}`) and pushes it through the same
  `parse_frames`, at real or accelerated speed.
- `replay.py`: `RecordingCache` (3 sessions in memory) and `ReplayPlayer` with its own clock,
  speed, pause and seek (backward seeks rebuild the state from the start, about 0.5 s for a race).
- `archive.py`: `Index.json`, session lookup by season, round and code, cached downloads.
- `schedule.py`: `/status` from the Jolpica schedule, exact times from the archive index, and the
  archive root `SessionInfo.json` (the session the timing system is on right now).
- `reference.py`, `reference_source.py`, `estimator.py`: positions estimated from timing (see
  "Estimated positions"); `delayed.py`: the static archive's positions of a running session;
  `validation.py`: estimate against real positions.
- `engine.choose_positions_source`: `official` while the feed has positions not older than 15 s,
  else `official-delayed`, else `estimated`, else none.

### Timing and the map

Position samples carry the time they were taken; they reach the hub 2 to 3 s later. Timing
updates are published about 2.25 s after the moment the positions show (calibrated on three 2026
races against FastF1 sector points, median 2.2 to 2.4 s, `TIMING_LAG_MS`).

- Live: the map is drawn `LIVE_RENDER_DELAY_MS` (6.5 s) behind the newest data, so there is
  always a sample on both sides to interpolate; frames go out at 8 Hz with linear
  interpolation between the 4 Hz samples. The tower is about 4.25 s ahead of the map. At 3 s
  the estimate mostly extrapolated and the dots crept and lurched (Singapore 2026 FP1).
- Replay: positions are preloaded and the map is drawn `TIMING_LAG_MS` behind the replay clock,
  so a car crossing the line on the map and the tower updating happen together.
- Track sector lines and the finish point are taken from where the car was 2.25 s before its
  sector and lap times appeared (within about 4 to 21 m of FastF1's on the circuits checked).

## Endpoints

`GET /status`

```json
{"live": false, "session": null,
 "next": {"season": 2026, "round": 17, "raceName": "Singapore Grand Prix", "session": "FP1",
          "name": "Practice 1", "start": "2026-10-09T08:30:00.000Z", "end": "2026-10-09T09:30:00.000Z"},
 "now": "2026-10-07T06:20:00.000Z", "simulated": false,
 "hub": {"mode": "live", "running": false, "clients": 0, "sources": {...}, "upstream": {...}, "openf1": null}}
```

`live` is true from 15 min before a scheduled session to 30 min after its end, or while the
archive root SessionInfo shows an unfinished session. In `--simulate` mode `live` is true and
`session` is the simulated one.

`GET /sessions?season=2026`: every finished session in the archive index, with `round`,
`session` code, names, circuit key, UTC start and end, and a ready `replay` WebSocket path
(`null` for pre-season testing, which has no round).

`WS /ws/live` and `WS /ws/replay?season=2026&round=16&session=R&speed=1&start=<t ms>` send the
same messages. Add `&positions=estimated` to a replay to see the estimate from timing alone
instead of the recorded positions (an error message if no earlier session at that circuit
exists). Replay commands (client to server, JSON text):
`{"cmd":"seek","t":3600000}`, `{"cmd":"speed","value":4}` (0.1 to 64), `{"cmd":"pause"}`,
`{"cmd":"resume"}`. Each command is answered with a `playback` message.

## Messages

`t` is always milliseconds since `init.origin` (epoch ms of the scheduled session start, UTC).
Coordinates are the feed's units (decimetres), the same for the outline, corners and cars;
rotate by `track.rotation` degrees for the usual broadcast orientation.

| type | when | content |
| --- | --- | --- |
| `loading` | replay only, first | `season`, `round`, `session` |
| `init` | on connect, and again if the session, drivers or track change | `mode` (live, simulated, replay), `origin`, `session` {key, season, round, code, name, type, meeting, officialName, location, country, circuit, circuitKey, start, end, gmtOffset, path, status}, `track` {outline [[x,y]], rotation, corners [{number, letter, x, y, angle}], sectors [{number, start, end} as outline indexes], finish [x,y], source, circuitKey}, `drivers` [{number, code, name, firstName, lastName, team, teamColor "#RRGGBB", headshotUrl, line}], `positionsSource` (`official`, `official-delayed`, `estimated` or null), `sources` {timing, positions, positionsAvailable, positionsSource, estimator {reference, circuitKey, layout, referenceLayout, cars, truthCorrections} or null, delayed {url, httpStatus, available, growing, bytes, samples, lagMs, polls, error} (live only, once followed)}, `timeline` {start, end, green} (replay). Sent again when the positions source changes |
| `frame` | every tick (8 Hz) | `source` (as `init.positionsSource`), `cars` [{number, x, y, status (onTrack, offTrack, pit, stopped, retired, stale), speed (km/h or null; always null when estimated)}]. `official-delayed` frames show the moment `t`, which is the archive lag plus 1 s behind the feed |
| `timing` | when anything in the tower changed, at most 4 Hz | `lap` {current, total} (race and sprint), `sessionPart` (qualifying 1 to 3), `clock` {remainingMs, running}, `rows` [{pos, number, gap, interval, laps, lastLap {value, pb, ob}, bestLap {value, lap, ob}, s1, s2, s3 {value, pb, ob}, tyre, tyreAge, tyreNew, stint, pits, inPit, pitOut, retired, stopped, knockedOut, drs}] |
| `raceControl` | new messages; full history (`history: true`) on connect | `messages` [{utc, lap, category, flag, scope, sector, driver, status, mode, message}] |
| `trackStatus` | on change, and on connect | `code` (feed code), `state` (green, yellow, sc, vsc, vscEnding, red), `message`, `sessionStatus` (Inactive, Started, Aborted, Finished, Finalised, Ends) |
| `weather` | on change, and on connect | `airTemp`, `trackTemp`, `humidity`, `pressure`, `windSpeed`, `windDirection`, `rainfall` |
| `pitStop` | a pit lane time is published | `number`, `duration` (s, pit lane time), `lap` |
| `tyreChange` | a new stint starts | `number`, `stint`, `compound`, `previous`, `tyresNotChanged`, `lap` (null before the car's first lap, a swap on the grid) (the feed opens a stint for a pit lane pass without a tyre change, for example under a red flag) |
| `playback` | replay: start, every command, end | `t`, `speed`, `paused`, `ended` |
| `error` | bad session or command | `message` |

Notes: `gap` and `interval` are the strings the tower shows (`+1.234`, `LAP 12`, `1L`); for
qualifying they come from the current part. `pos` is the tower order 1..N (the feed's
positions, ties broken by line); `drs` is `null` when the car data has no DRS channel (2026 cars
have no DRS, and live car data needs a token).

Measured on this machine (simulated live of 2026 R16 at 4x, and replay):
frames 7.9/s (about 1.4 KB each with 22 cars), timing 3.9/s (about 10 KB), race control, track
status and weather a few per minute; replay seek in a 4 h race under 0.5 s. A first replay of a
race downloads about 35 MB and decodes in about 10 s; later loads read the cached `.npz` car
arrays and take about 1 to 3 s.

## Estimated positions (no token, completely free)

The anonymous hub sends no car positions, but every car still flips 20 to 30 mini-sectors a lap:
`TimingData.Lines[n].Sectors[i].Segments[j].Status` goes from 0 to a colour code (2048 yellow,
2049 green, 2051 purple, 2064 driven in the pit lane) when the car completes that mini-sector,
about `TIMING_LAG_MS` (2.25 s) after it got there. The estimator turns those flips back into
moving cars.

**Circuit reference** (`reference.py`, `CircuitReference`), built from any recorded session at
the same circuit in the free static archive, where `Position.z` is included:

- the racing line of the fastest clean lap, densified to 2 m, with cumulative distance, starting
  at the end of the last mini-sector (so a lap is exactly one turn of the line);
- the distance where every mini-sector ends: the median of where the cars really were 2.25 s
  before each green-flag flip was published (25 000 to 30 000 flips per race);
- a normalised speed profile: the median fraction of the lap time needed to reach each 5 m of
  the lap, over every clean green lap (about 1 000 per race);
- the pit lane polyline (from a median pit visit), the speed limiter pace, the box of every team,
  the usual pit lane time of a race stop, and where a car is when its out-lap pit lane
  mini-sectors are published;
- grid slot coordinates by starting position (races only; kept from the last race when a newer
  practice or qualifying reference replaces it).

`reference_source.py` picks the newest usable session: the earlier sessions of the same weekend
first (FP1 is archived some time after it ends; the live hub retries every 10 min,
`F1LIVE_REFERENCE_REFRESH_S`), then the same circuit in the two previous seasons. Built
references are cached as `data/raw/livetiming/estimator/reference_<circuitKey>.json`; the
Singapore one (circuit 61, from the 2025 race) is already built for Friday. A build takes 3 to
10 s and downloads the timing and position streams once (about 20 MB).

**Live estimate** (`estimator.py`, `PositionEstimator`):

- Each flip is an anchor (time minus 2.25 s, distance of that mini-sector end). A pass counter
  gives every flip an absolute index; it only counts a segment going from unset to set (the feed
  recolours passed segments later, 2048 to 2049), counts the lap reset message (first segment
  set, the rest zeroed in one message), ignores late or out of order copies (a pit lane batch can
  arrive as 25, 22, 23, 24) and resynchronises when two consecutive segments are far ahead.
- Between anchors the car moves along the line in reference time. When the next flip is already
  known (the map is drawn 3 s behind the feed, timing is 2.25 s late, so about 0.75 s ahead) it
  interpolates between the two; otherwise it expects the next mini-sector to take what this car
  needed for the same mini-sector on its previous lap, scaled by its recent pace ratio, with a
  soft clamp (linear to 90 %, then easing towards 99 %) so it never passes the next checkpoint
  before the feed says so.
- When an anchor arrives, the difference to what was on screen is blended out over 1.5 s
  (no teleporting): in a full simulated race the 99.9th percentile of the step between two
  frames (125 ms) is 18 m; the largest single steps are about 120 m, at lap 1 and restarts.
- SC and VSC: the pace ratio comes from the last mini-sectors, so it follows the slowdown after
  one or two of them; when the track status changes after the last pace sample, the expected
  time is scaled by 1.4 (or 1 / 1.4 when it goes green). Queues need no special case, every car
  follows its own flips.
- Pit lane: `InPit` is an anchor at the pit entry, the car follows the pit lane polyline at the
  limiter pace to its team's box, waits, and leaves so it reaches the exit when `PitOut` comes
  (or after the usual race stop time when it is not known yet). Still in the pit 15 s after a
  normal stop would be over: it is in the garage (shown at the box). Under a red flag cars queue
  at the exit in the order they came in. `PitOut` is an anchor at the pit exit, and the out-lap's
  2064 batch is another anchor at a learnt point. Practice: cars in the garage sit at their box.
- Race start: before SessionStatus Started cars hold their grid slot (by `GridPos`); a car coming
  back from the formation lap stops at its slot, and leaves it just in time to reach its next
  checkpoint. Cars leave the grid about 1 s before "Started" is published (measured on 2026
  races); from there a standing start (10 m/s2) until the first lap 1 flip.
- `Stopped` and `Retired` freeze the car where it was at that moment.
- The layout check: the lap reset message lists every segment of every sector, so a mini-sector
  count different from the reference is detected on the first lap and the reference distances
  are spread over the new count by reference time.

**Validation** (`validation.py`, `scripts/validate_estimator.py`): only the anonymous topics of
a recorded session go through the estimator, the session's own `Position.z` is the ground truth,
compared every 2 s of feed time at the moment drawn on the map. Distances are straight line
errors in metres. "Neighbour order" is the share of pairs of cars less than 500 m apart on track
that the estimate puts in the same order. Windows where the archived positions contradict the
timing feed itself (positions frozen while mini-sectors flip, 2025 Canada start) are left out and
counted. Results on 2026-10-07, reference = the qualifying of the same weekend (what the service
has on race day), map 3 s behind the feed (the default):

Median / p95 error in metres per phase (green is green or yellow flag after lap 1; "all" is
every compared sample, including pre-start, pit, stopped and retired cars):

| session | green | SC/VSC/red | lap 1 | pit | all samples | neighbour order | all neighbours right | truth left out |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2025 R18 Singapore | 4 / 40 | none | 15 / 84 | 17 / 120 | 4 / 86 | 96 % | 73 % | 0 % |
| 2025 R14 Hungary | 5 / 50 | none | 20 / 115 | 15 / 118 | 5 / 101 | 98 % | 79 % | 0.1 % |
| 2025 R10 Canada | 5 / 57 | 22 / 94 | (truth frozen) | 49 / 208 | 7 / 218 | 89 % | 60 % | 4.7 % |
| 2026 R14 Madring | 5 / 89 | 18 / 95 | 19 / 164 | 6 / 169 | 6 / 235 | 91 % | 75 % | 0 % |
| 2026 R16 Kuala Lumpur (wet start, red, SC, VSC) | 7 / 50 | 16 / 90 | 42 / 435 | 80 / 193 | 11 / 383 | 93 % | 58 % | 0 % |
| 2026 R11 Hungary (degraded truth, see below) | 88 / 191 | 94 / 310 | 15 / 100 | 532 / 606 | 75 / 206 | 85 % | 40 % | 51 % |

"All neighbours right" is the share of 2 s ticks in which every pair of nearby cars is in the
right order. Cars are shown 97 to 100 % of the time the truth has them.

The Friday case (reference = last year's race at the same circuit, nothing from this weekend):

| session (reference 2024 Singapore race) | green | lap 1 / first 150 s | pit | all samples | neighbour order |
| --- | --- | --- | --- | --- | --- |
| 2025 Singapore race | 4 / 39 | 16 / 86 | 46 / 124 | 5 / 84 | 96 % |
| 2025 Singapore FP1 | 11 / 68 | 16 / 139 | 50 / 175 | 15 / 154 | 96 % |
| 2025 Singapore qualifying | 10 / 92 | 14 / 159 | 54 / 1351 | 31 / 184 | 96 % |

In practice and qualifying many samples are cars in the garage (pit), shown at last year's team
box; the p95 of 1351 m in qualifying is one car (10) whose `InPit` flag and real position
disagree for most of the session.

Drawing the map further behind the feed means the next flip is known more often, so more
interpolation and less extrapolation. With `F1LIVE_RENDER_DELAY_MS=6000` (map 6 s behind the
feed, tower 3.75 s ahead of the map) green medians are 3 to 6 m with p95 12 to 41 m, SC/VSC 9
to 12 m, lap 1 6 to 24 m, and the neighbour order 90 to 99 %. The default is now 6.5 s.

Notes on the numbers:

- 2026 Hungarian GP (R11) is not a usable ground truth: about half of its archived position
  samples repeat the previous one and 5 % jump impossibly (2025 Hungary has none of that). The
  builder refuses such sessions as references (`repeated_share`), and the validation prints the
  share for every session.
- "beforeStart" and "grid" are the 10 minutes before the start. Before the formation lap the
  archived positions are often frozen (2025 Canada) or not at the grid (2026 Madring), so these
  errors are partly in the truth.
- Stopped cars: until the `Stopped` flag comes the estimate creeps to just short of the next
  checkpoint, so a car that stops mid mini-sector is shown up to one mini-sector too far (about
  120 to 400 m in the races checked). Only the delayed archive (if it exists live) fixes that.
- Pit: errors are mostly the stop duration (known only when `PitOut` arrives) and, with a
  qualifying reference, the box of each team.

## Free options checked (2026-10-07)

No account was created and nothing was logged in to.

- **A free (non subscriber) F1 account token**: no evidence that it unlocks `Position.z`, and the
  evidence there is says it does not. FastF1's auth module (`fastf1/internals/f1auth.py`) says
  the feature "requires an active F1TV Access/Pro/Premium subscription", reads the
  `subscriptionToken` of the login session and checks its `SubscriptionStatus` and
  `SubscribedProduct` claims; FastF1's live client docstring warns that without auth the hub
  "may only return empty or partial data". undercutf1's README says live positions need "an
  active F1 TV subscription" since the 2025 Dutch GP. Nobody published a test with a free token,
  so it is not proven, but logging in to try it was out of scope.
- **OpenF1 free tier**: historical only. openf1.org: free gives "All historical sessions since
  2023" (3 requests/s, 30/min); live data during sessions is the sponsor tier; data counts as
  live from 30 min before a session until 30 min after it ends. So the earliest free OpenF1
  positions of a session come about 30 min after its end.
- **Static archive during a session**: unknown, measured on Friday with
  `scripts/probe_static_live.py`. Circumstantial evidence says it is written after the session:
  for every finished session checked, every file of the session folder has the same
  `Last-Modified` to the second, 30 to 100 minutes after the session ended (2026 R16 race:
  10:41:51 UTC, race over before 09:00; its qualifying: 09:24 UTC, about 80 min after it ended;
  2026 R14 race: 15:07 UTC), which looks like one upload after the session rather than appends;
  FastF1 only says "If this session only finished recently, please try again in a few minutes".
  The Singapore FP1 folder answers 403 today, as any not yet uploaded file does. The service is
  ready either way (`DelayedPositions`, tested with a simulated growing file).
- **Other sources**: MultiViewer is an F1TV client (needs F1TV), undercutf1 and f1-dash use the
  same hub (same token rule), OpenF1 live is paid. No free public source of live car positions
  was found. Scraping a paid stream is not done.

Probe for Friday 2026-10-09: Singapore FP1 starts at **08:30 UTC** (16:30 local, ends 09:30 UTC;
Jolpica schedule, sprint weekend: Sprint Qualifying 12:30 UTC the same day). Start a few minutes
early:

```
cd live
uv run python scripts/probe_static_live.py --season 2026 --round 17 --session FP1 --interval 30
```

It runs until 30 min after the scheduled end (10:00 UTC), logs to
`data/raw/livetiming/probe/<session>_<start>.jsonl` and prints a verdict per file (available,
grew, median lag while growing). It follows the root `SessionInfo.json` if the session runs
under a different folder than the one guessed from the schedule.

## Caches (all under `data`, not in git)

- `raw/livetiming/<season>/Index.json` (refreshed hourly), `jolpica_races.json` (6 h).
- `raw/livetiming/<session path>/<Topic>.jsonStream`: raw archive streams, stored once the
  session ended more than 3 hours ago, plus `_positions.npz` and `_telemetry.npz` (decoded cars).
- `raw/livetiming/tracks/`: `circuit_<key>.json` built tracks and `multiviewer_<key>_<year>.json`.
- `raw/livetiming/estimator/reference_<key>.json`: estimator references (`validation/` holds the
  ones the validation script builds per session).
- `raw/livetiming/probe/`: logs of `scripts/probe_static_live.py`.

## Tests

`uv run pytest` (about 1 min once the archive is cached):

- `test_decode.py`: base64 and raw deflate decoding, timestamps, archive lines, and the live
  parser on feed invocations (compressed and plain) and the Subscribe snapshot.
- `test_merge.py`: delta merge (nested dicts, index-keyed list patches, list growth,
  `_deleted`, no aliasing), race control, pit stop, tyre change and lap mark detection.
- `test_openf1.py`: OpenF1 rows to Position messages, interpolation, no-signal samples dropped.
- `test_e2e_race.py`, for 2026 R16 (wet start, red flag, safety car, VSC) and 2025 R10: every
  archived line goes through `SimulatedFeed -> parse_frames -> LiveHub -> SessionEngine`, and
  the test asserts 20+ cars get moving positions, the tower is 1..N without duplicates (and so
  are the feed's own positions), the lap count climbs to the total, 10+ pit stops and compound
  changes, yellow plus safety car (and SC, VSC and red for 2026), DRS present in 2025 and null in
  2026, then the replay player produces the same message shapes and seeks back and forth.
- `test_estimator.py`: the pass counter (lap reset, recolours, out of order pit lane batches,
  resynchronisation), on a synthetic circular track: cars move without going backwards or
  jumping, wait before a checkpoint that has not flipped, sit on the checkpoints when flips are
  known, pit entry, box and exit, a stopped car stays put, delayed truth corrects mini-sector
  distances, the engine sends `estimated` frames with `positionsAvailable: true`. On the archive:
  2026 R14 race estimated from timing only with a reference from its qualifying (green median
  under 15 m, p95 under 150 m, neighbour order over 85 %), and the replay `estimate_with` mode.
- `test_delayed.py`: a mock server serves a real Position.z stream as if it were growing live
  (lines appear `lag` after their samples, cut mid line, Range requests answered with 206 or 416):
  only appended bytes are read, no sample lost or doubled, lag measured, 404 handled, and the
  engine switches between `official-delayed` (lag 5 s) and `estimated` (lag 2 min).

## Limitations

- Without an F1TV token (or an OpenF1 sponsor token) a real live session has no car positions
  in the feed; the map shows estimated positions (see "Estimated positions" for how good they
  are), with no speed. The estimate was validated by replaying archived sessions through the
  live parser; a real live session could not be observed today. A circuit that was never raced
  before has no reference until its first session is archived (cars hidden until then).
- The F1TV token is a JWT that expires; renew it with FastF1 (`fastf1 auth`, outside this
  service) and restart. The service never logs in or opens a browser.
- OpenF1 live use is untested (needs a paid account); the conversion is tested with historical
  rows.
- Positions come from the feed at about 4 Hz and are linearly interpolated; tight corners can be
  cut slightly. The live map runs 3 s behind real time on top of the broadcast delay of the feed.
- Track outlines from position data follow the racing line of one lap and exclude the pit lane.
  New circuits without MultiViewer data have no corner numbers unless the pipeline's FastF1
  export provides them.
- `/status` relies on Jolpica for future sessions; if it is unreachable the cached schedule is
  used, and the archive root SessionInfo still flags a running session.
