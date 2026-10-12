# f1.sqlite schema

`v2/data/serve/f1.sqlite` holds the complete official F1 World Championship history from
1950 to the latest completed round. It is rebuilt from scratch by
`uv run python -m f1p.history.update` (run from `v2/pipeline`) and swapped in atomically. Open
it read only. This file is copied next to the database on every build; edit the source at
`v2/pipeline/src/f1p/history/SCHEMA.md`.

Sources: Jolpica-F1 (Ergast successor) dump plus live API, with F1DB (CC BY 4.0) filling
fastest laps before 2004, qualifying before 2003 and circuit layouts. Credit both on the site.

## Conventions

- Join keys are the Jolpica/Ergast string ids: `driverId` (`max_verstappen`),
  `constructorId` (`red_bull`), `circuitId` (`monza`).
- `raceId` = `season * 100 + round` (2026 round 16 is `202616`). Every round level table has
  `raceId`, `season` and `round`.
- Times and durations are integer milliseconds (`timeMs`, `q1Ms`, `durationMs`).
- Dates are ISO text `YYYY-MM-DD`; timestamps are ISO UTC text `YYYY-MM-DDTHH:MM:SSZ`.
- Booleans are `0`/`1` integers.
- `position` is NULL when the driver was not classified; `positionOrder` is always filled
  (finishing order, unclassified at the back) and is what to sort by. `positionText` is the
  display value: a number, or `R` retired, `D` disqualified, `W` withdrawn / did not start,
  `F` failed to qualify.
- Drivers in the 1950s and early 1960s sometimes appear twice in one race (shared or second
  car). Rows are unique on `(raceId, driverId, number)`, not `(raceId, driverId)`.

## Base tables

### seasons (one row per championship season)
`season` PK, `url` (Wikipedia), `rounds` (scheduled, cancelled rounds excluded),
`completedRounds` (rounds with results).

### races (one row per round, including upcoming rounds of the current season)
`raceId` PK, `season`, `round` (unique together), `raceName`, `circuitId`, `date`, `time`
(UTC `HH:MM:SS`, NULL before times were recorded), `raceUtc`, `timezone` (IANA, e.g.
`Europe/Rome`), `hasSprint`, `hasResults` (0 for upcoming rounds), `fp1Utc`, `fp2Utc`,
`fp3Utc`, `qualifyingUtc`, `sprintQualifyingUtc`, `sprintUtc` (session starts as actually
held, NULL when not held or unknown; known source errors are corrected in
`f1p/history/corrections.py`), `circuitLayoutId` (F1DB layout, e.g. `monza-7`), `courseLengthKm`,
`turns`, `url`.

### circuits
`circuitId` PK, `circuitName`, `locality`, `country`, `countryCode` (ISO alpha-3), `lat`,
`lng`, `alt` (metres), `url`.

### drivers
`driverId` PK, `permanentNumber`, `code` (3 letters, modern drivers only), `givenName`,
`familyName`, `fullName`, `dateOfBirth`, `nationality`, `countryCode`, `url`.

### constructors
`constructorId` PK, `name`, `nationality`, `countryCode`, `primaryColor` (`#RRGGBB`, set for
recent teams only), `url`.

### results (one row per car per Grand Prix) and sprint_results (same columns, 2021+)
`raceId`, `season`, `round`, `driverId`, `constructorId`, `number` (car number), `grid`
(0 = pit lane start), `position`, `positionText`, `positionOrder`, `points` (as awarded for
that race), `laps`, `timeMs` (total race time, classified finishers with a time),
`timeText` (Ergast style: winner `1:47:14.808`, others `+2.307`), `fastestLapRank`,
`fastestLap` (lap number), `fastestLapTimeMs`, `fastestLapAvgSpeed` (km/h, mostly NULL),
`status` (`Finished`, `+1 Lap`, `Engine`, `Collision`, ...), `statusCategory` (`finished`,
`lapped`, `accident`, `retired`, `disqualified`, `dns`).

Fastest laps: from Jolpica since 2004, from F1DB before that (1950 to 1979 only the holder
with rank 1, ties included; full order since 1980).

### qualifying (one row per driver per Grand Prix with a qualifying position)
`raceId`, `season`, `round`, `driverId`, `constructorId`, `number`, `position` (final
qualifying position, not the grid), `q1Ms`, `q2Ms`, `q3Ms`, `source` (`jolpica` or `f1db`).
Knockout era (2006+) uses Q1/Q2/Q3. 2025 Miami times come from F1DB (Jolpica has the
order only) while `source` stays `jolpica`. A driver disqualified from qualifying keeps his
position but no times. Single session eras put the best time in `q1Ms`; 2003
to 2005 formats follow Ergast (two runs in `q1Ms`/`q2Ms`).

### lap_times (1996+)
PK `(raceId, driverId, lap)`; `position` (running position at the end of the lap), `timeMs`.

### pit_stops (2011+)
PK `(raceId, driverId, stop)`; `lap`, `localTime` (local wall clock `HH:MM:SS`),
`durationMs` (pit lane time; very long values are red flag stoppages).

### driver_standings (after every round)
PK `(raceId, driverId)`; `points`, `position`, `positionText` (`D` disqualified from the
championship, `E` excluded, `-` ineligible), `wins`, `constructorIds` (comma list of teams
driven for that season up to that round, in order).

### constructor_standings (after every round, 1958+)
PK `(raceId, constructorId)`; `points`, `position`, `positionText`, `wins`.

### season_entries (roster per season)
PK `(season, driverId, constructorId)`; `role` (`permanent`, `reserve`, `junior` from
Jolpica, NULL for older seasons), `races` (Grands Prix entered for that team that season),
`firstRound`, `lastRound`, `carNumbers` (comma list). Race drivers are rows with
`races > 0`; for the running season, `role = 'permanent'` gives the current line up.

### status
`status` PK, `statusCategory`, `results` (how many race and sprint rows have it).

## Derived tables (precomputed on every build)

### race_poles (one row per completed Grand Prix)
`raceId`, `season`, `round`, `driverId`, `constructorId`, `source`. Official pole credit:
the driver on grid slot 1 (a fastest qualifier with a grid penalty does not get pole, 2021
sprint winners did), except 2022 sprint weekends, where qualifying P1 was credited.
Matches official totals (Hamilton 104 through 2024, Verstappen 40, Senna 65).

### driver_career (one row per driver who entered a Grand Prix)
`driverId`, `fullName`, `code`, `nationality`, `permanentNumber`, `entries` (Grands Prix
entered), `starts` (entries minus did not start), `wins`, `podiums`, `poles`,
`fastestLaps`, `sprintWins`, `points` (race plus sprint points as awarded, no dropped
scores), `titles`, `titleSeasons` (comma list), `bestFinish`, `bestGrid`, `dnfs`
(retirements and accidents while unclassified), `lapsCompleted`, `seasons`, `firstRaceId`,
`lastRaceId`, `firstWinRaceId`, `lastWinRaceId`, `constructorIds` (comma list, in order of
first race for the team).

### constructor_career (one row per constructor that entered a Grand Prix)
`constructorId`, `name`, `nationality`, `primaryColor`, `entries` (Grands Prix entered),
`wins` (races won), `podiums` (podium finishes, both cars count), `oneTwos`, `poles`,
`fastestLaps`, `sprintWins`, `points` (sum of its drivers' race and sprint points),
`championshipPoints` (sum of final constructors' championship points, 1958+), `titles`
(constructors' championships), `titleSeasons`, `bestFinish`, `drivers`, `seasons`,
`firstRaceId`, `lastRaceId`, `firstWinRaceId`, `lastWinRaceId`.

### circuit_stats (one row per circuit)
`circuitId`, `circuitName`, `locality`, `country`, `countryCode`, `lat`, `lng`,
`racesHeld`, `firstSeason`, `lastSeason`, `lastRaceId`, `nextRaceId` (next scheduled round
there, NULL if none), `currentLayoutId`, `courseLengthKm`, `turns` (of the layout used at the
latest race), `lapRecordMs`, `lapRecordDriverId`, `lapRecordRaceId` (fastest race lap in the
data on the current layout; lap_times since 1996 plus race fastest laps, so it is a race lap
record, not a qualifying record), `mostWinsDriverId`, `mostWins`.

### season_state, season_summary
`season_state`: `season`, `rounds`, `completedRounds`, `isComplete`, `lastStandingsRound`.
`season_summary`: `season`, `rounds`, `completedRounds`, `isComplete`, `sprintRounds`,
`driverLeaderId`, `driverLeaderPoints`, `driverLeaderWins`, `constructorLeaderId`,
`constructorLeaderPoints`, `differentWinners`, `differentWinningTeams`,
`mostWinsDriverId`, `mostWins`. When `isComplete = 1` the leaders are the champions; for
the running season they are the current leaders.

### season_final_driver_standings, season_final_constructor_standings
The standings rows of each season's last completed round, plus `isComplete`. Champions:
`position = 1 and isComplete = 1`.

## Views

- `v_current_season`: `season` (latest season with results).
- `v_race_results`: `results` plus `raceName`, `date`, `circuitId`, `driverName`, `code`,
  `constructorName`, `primaryColor`.
- `v_circuit_winners`: every Grand Prix winner per circuit (`circuitId`, `season`, `round`,
  `raceId`, `raceName`, `date`, `driverId`, `driverName`, `constructorId`,
  `constructorName`, `grid`, `timeText`).
- `v_driver_standings_progression`, `v_constructor_standings_progression`: standings after
  each round with names and `pointsGained` in that round. Filter by `season` for the
  per round progression chart.
- `v_current_driver_standings`, `v_current_constructor_standings`: latest round of the
  current season, ordered by position.

## Example queries

```sql
-- Current championship
select position, driverName, code, points, wins from v_current_driver_standings;

-- Result of one race
select positionText, driverName, constructorName, grid, laps, timeText, points, status
from v_race_results where raceId = 202616 order by positionOrder;

-- Driver page
select * from driver_career where driverId = 'hamilton';

-- Points progression for a season chart
select round, driverId, points from driver_standings where season = 2026 order by round;
```

## Known gaps

- Lap times start in 1996 and pit stops in 2011 (source limits).
- Constructor standings start in 1958, when that championship began.
- `qualifying` has no rows for drivers who never started a Grand Prix (no Jolpica id), so
  some 1950s to 1980s non-qualifiers are missing from those sessions.
- `fastestLapAvgSpeed` is sparse. 1950s to 1970s fastest laps give only the holder.
- Results land after each race weekend: once the update has run, finished rounds have
  `hasResults = 1`. A round fetched less than 3 days after the race is re-fetched on the next
  run to pick up penalties.
