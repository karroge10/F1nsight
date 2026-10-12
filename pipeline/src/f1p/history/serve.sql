-- Derived tables and views for f1.sqlite. Run after the base tables are loaded.
-- Documented in data/serve/SCHEMA.md.

-- Seasons whose every scheduled round has results; only these award titles.
create table season_state as
select season, rounds, completedRounds, completedRounds >= rounds as isComplete,
       (select max(round) from driver_standings ds where ds.season = s.season) as lastStandingsRound
from seasons s;

-- One pole sitter per race, matching the official credit: the driver who started from grid
-- slot 1 (a qualifying fastest driver with a grid penalty loses pole; 2021 sprint winners got
-- pole), except 2022 sprint weekends where qualifying P1 was credited even though the sprint
-- set the grid. Races without a grid slot 1 fall back to qualifying P1.
create table race_poles as
with quali as (
    select raceId, min(driverId) as driverId, min(constructorId) as constructorId
    from qualifying where position = 1 group by raceId
),
grid as (
    select raceId, min(driverId) as driverId, min(constructorId) as constructorId
    from results where grid = 1 group by raceId
),
picked as (
    select r.raceId, r.season, r.round,
           case when r.season = 2022 and r.hasSprint = 1 and q.driverId is not null
                then 'qualifying'
                when g.driverId is not null then 'grid'
                when q.driverId is not null then 'qualifying' end as source,
           q.driverId as qDriverId, q.constructorId as qConstructorId,
           g.driverId as gDriverId, g.constructorId as gConstructorId
    from races r
    left join quali q on q.raceId = r.raceId
    left join grid g on g.raceId = r.raceId
    where r.hasResults = 1
)
select raceId, season, round,
       case source when 'grid' then gDriverId else qDriverId end as driverId,
       case source when 'grid' then gConstructorId else qConstructorId end as constructorId,
       source
from picked where source is not null;
create index ix_race_poles_driver on race_poles(driverId);
create index ix_race_poles_constructor on race_poles(constructorId);

-- Final championship order of each season (leader so far for the running season).
create table season_final_driver_standings as
select ds.*, st.isComplete
from driver_standings ds join season_state st
  on st.season = ds.season and ds.round = st.lastStandingsRound;

create table season_final_constructor_standings as
select cs.*, st.isComplete
from constructor_standings cs
join (select season, max(round) as lastRound from constructor_standings group by season) lr
  on lr.season = cs.season and lr.lastRound = cs.round
join season_state st on st.season = cs.season;

create table driver_career as
with entries as (
    select driverId, count(distinct raceId) as entries,
           count(distinct case when statusCategory not in ('dns', 'dnq', 'dnpq')
                               then raceId end) as starts,
           count(distinct case when position = 1 then raceId end) as wins,
           count(distinct case when position <= 3 then raceId end) as podiums,
           count(distinct case when fastestLapRank = 1 then raceId end) as fastestLaps,
           count(distinct case when position is null
                                and statusCategory in ('retired', 'accident')
                               then raceId end) as dnfs,
           sum(points) as racePoints, sum(laps) as lapsCompleted,
           min(position) as bestFinish, min(nullif(grid, 0)) as bestGrid,
           count(distinct season) as seasons,
           min(raceId) as firstRaceId, max(raceId) as lastRaceId,
           min(case when position = 1 then raceId end) as firstWinRaceId,
           max(case when position = 1 then raceId end) as lastWinRaceId
    from results group by driverId
),
sprints as (
    select driverId, sum(points) as sprintPoints,
           count(distinct case when position = 1 then raceId end) as sprintWins
    from sprint_results group by driverId
),
poles as (select driverId, count(*) as poles from race_poles group by driverId),
titles as (
    select driverId, count(*) as titles, group_concat(season) as titleSeasons
    from season_final_driver_standings where position = 1 and isComplete = 1
    group by driverId
),
teams as (
    select driverId, group_concat(constructorId) as constructorIds
    from (select driverId, constructorId, min(raceId) as firstRaceId from results
          group by driverId, constructorId order by driverId, firstRaceId)
    group by driverId
)
select d.driverId, d.fullName, d.code, d.nationality, d.permanentNumber,
       e.entries, e.starts, e.wins, e.podiums, coalesce(p.poles, 0) as poles,
       e.fastestLaps, coalesce(s.sprintWins, 0) as sprintWins,
       e.racePoints + coalesce(s.sprintPoints, 0) as points,
       coalesce(t.titles, 0) as titles, t.titleSeasons, e.bestFinish, e.bestGrid, e.dnfs,
       e.lapsCompleted, e.seasons, e.firstRaceId, e.lastRaceId, e.firstWinRaceId,
       e.lastWinRaceId, tm.constructorIds
from entries e
join drivers d on d.driverId = e.driverId
left join sprints s on s.driverId = e.driverId
left join poles p on p.driverId = e.driverId
left join titles t on t.driverId = e.driverId
left join teams tm on tm.driverId = e.driverId;
create unique index ux_driver_career on driver_career(driverId);

create table constructor_career as
with entries as (
    select constructorId, count(distinct raceId) as entries,
           count(distinct case when position = 1 then raceId end) as wins,
           sum(case when position <= 3 then 1 else 0 end) as podiums,
           count(distinct case when fastestLapRank = 1 then raceId end) as fastestLaps,
           sum(points) as racePoints, min(position) as bestFinish,
           count(distinct driverId) as drivers, count(distinct season) as seasons,
           min(raceId) as firstRaceId, max(raceId) as lastRaceId,
           min(case when position = 1 then raceId end) as firstWinRaceId,
           max(case when position = 1 then raceId end) as lastWinRaceId
    from results group by constructorId
),
one_twos as (
    select constructorId, count(*) as oneTwos from (
        select raceId, constructorId from results where position in (1, 2)
        group by raceId, constructorId having count(distinct position) = 2
    ) group by constructorId
),
sprints as (
    select constructorId, sum(points) as sprintPoints,
           count(distinct case when position = 1 then raceId end) as sprintWins
    from sprint_results group by constructorId
),
poles as (select constructorId, count(*) as poles from race_poles group by constructorId),
titles as (
    select constructorId, count(*) as titles, group_concat(season) as titleSeasons
    from season_final_constructor_standings where position = 1 and isComplete = 1
    group by constructorId
),
champ_points as (
    select constructorId, sum(points) as championshipPoints
    from season_final_constructor_standings group by constructorId
)
select c.constructorId, c.name, c.nationality, c.primaryColor,
       e.entries, e.wins, e.podiums, coalesce(o.oneTwos, 0) as oneTwos,
       coalesce(p.poles, 0) as poles, e.fastestLaps, coalesce(s.sprintWins, 0) as sprintWins,
       e.racePoints + coalesce(s.sprintPoints, 0) as points,
       coalesce(cp.championshipPoints, 0) as championshipPoints,
       coalesce(t.titles, 0) as titles, t.titleSeasons, e.bestFinish, e.drivers, e.seasons,
       e.firstRaceId, e.lastRaceId, e.firstWinRaceId, e.lastWinRaceId
from entries e
join constructors c on c.constructorId = e.constructorId
left join one_twos o on o.constructorId = e.constructorId
left join sprints s on s.constructorId = e.constructorId
left join poles p on p.constructorId = e.constructorId
left join titles t on t.constructorId = e.constructorId
left join champ_points cp on cp.constructorId = e.constructorId;
create unique index ux_constructor_career on constructor_career(constructorId);

-- Lap record = fastest race lap in the data on the layout used at the circuit's latest race
-- (lap_times since 1996 plus results fastest laps, which reach back to 1950 via F1DB).
create table circuit_stats as
with held as (
    select circuitId, count(*) as racesHeld, min(season) as firstSeason,
           max(season) as lastSeason, max(raceId) as lastRaceId
    from races where hasResults = 1 group by circuitId
),
scheduled as (
    select circuitId, min(raceId) as nextRaceId from races where hasResults = 0
    group by circuitId
),
current_layout as (
    select h.circuitId, r.circuitLayoutId, r.courseLengthKm, r.turns
    from held h join races r on r.raceId = h.lastRaceId
),
all_laps as (
    select raceId, driverId, timeMs from lap_times
    union all
    select raceId, driverId, fastestLapTimeMs from results where fastestLapTimeMs is not null
),
lap_record as (
    select circuitId, raceId, driverId, timeMs from (
        select r.circuitId, l.raceId, l.driverId, l.timeMs,
               row_number() over (partition by r.circuitId order by l.timeMs, l.raceId) as rn
        from all_laps l
        join races r on r.raceId = l.raceId
        join current_layout cl on cl.circuitId = r.circuitId
        where cl.circuitLayoutId is null or r.circuitLayoutId = cl.circuitLayoutId
    ) where rn = 1
),
win_counts as (
    select r.circuitId, res.driverId, count(*) as wins,
           row_number() over (partition by r.circuitId order by count(*) desc,
                              max(res.raceId) desc) as rn
    from results res join races r on r.raceId = res.raceId
    where res.position = 1 group by r.circuitId, res.driverId
)
select c.circuitId, c.circuitName, c.locality, c.country, c.countryCode, c.lat, c.lng,
       coalesce(h.racesHeld, 0) as racesHeld, h.firstSeason, h.lastSeason, h.lastRaceId,
       s.nextRaceId, cl.circuitLayoutId as currentLayoutId, cl.courseLengthKm, cl.turns,
       lr.timeMs as lapRecordMs, lr.driverId as lapRecordDriverId,
       lr.raceId as lapRecordRaceId, w.driverId as mostWinsDriverId, w.wins as mostWins
from circuits c
left join held h on h.circuitId = c.circuitId
left join scheduled s on s.circuitId = c.circuitId
left join current_layout cl on cl.circuitId = c.circuitId
left join lap_record lr on lr.circuitId = c.circuitId
left join win_counts w on w.circuitId = c.circuitId and w.rn = 1;
create unique index ux_circuit_stats on circuit_stats(circuitId);

create table season_summary as
with winners as (
    select season, count(distinct driverId) as differentWinners,
           count(distinct constructorId) as differentWinningTeams
    from results where position = 1 group by season
),
top_winner as (
    select season, driverId, wins from (
        select season, driverId, count(*) as wins,
               row_number() over (partition by season order by count(*) desc,
                                  min(raceId)) as rn
        from results where position = 1 group by season, driverId
    ) where rn = 1
),
driver_leader as (
    select season, driverId, points, wins from season_final_driver_standings where position = 1
),
team_leader as (
    select season, constructorId, points, wins
    from season_final_constructor_standings where position = 1
)
select st.season, st.rounds, st.completedRounds, st.isComplete,
       (select count(*) from races r where r.season = st.season and r.hasSprint = 1)
           as sprintRounds,
       dl.driverId as driverLeaderId, dl.points as driverLeaderPoints,
       dl.wins as driverLeaderWins, tl.constructorId as constructorLeaderId,
       tl.points as constructorLeaderPoints, w.differentWinners, w.differentWinningTeams,
       tw.driverId as mostWinsDriverId, tw.wins as mostWins
from season_state st
left join driver_leader dl on dl.season = st.season
left join team_leader tl on tl.season = st.season
left join winners w on w.season = st.season
left join top_winner tw on tw.season = st.season;
create unique index ux_season_summary on season_summary(season);

-- Views (cheap joins the site will use a lot).

create view v_current_season as
select max(season) as season from races where hasResults = 1;

create view v_race_results as
select res.*, r.raceName, r.date, r.circuitId, d.fullName as driverName, d.code,
       c.name as constructorName, c.primaryColor
from results res
join races r on r.raceId = res.raceId
join drivers d on d.driverId = res.driverId
join constructors c on c.constructorId = res.constructorId;

create view v_circuit_winners as
select r.circuitId, r.season, r.round, r.raceId, r.raceName, r.date, res.driverId,
       d.fullName as driverName, res.constructorId, c.name as constructorName, res.grid,
       res.timeText
from results res
join races r on r.raceId = res.raceId
join drivers d on d.driverId = res.driverId
join constructors c on c.constructorId = res.constructorId
where res.position = 1;

create view v_driver_standings_progression as
select ds.season, ds.round, ds.raceId, r.raceName, ds.driverId, d.fullName as driverName,
       d.code, ds.position, ds.positionText, ds.points, ds.wins, ds.constructorIds,
       ds.points - coalesce(lag(ds.points) over (partition by ds.season, ds.driverId
                                                 order by ds.round), 0) as pointsGained
from driver_standings ds
join races r on r.raceId = ds.raceId
join drivers d on d.driverId = ds.driverId;

create view v_constructor_standings_progression as
select cs.season, cs.round, cs.raceId, r.raceName, cs.constructorId, c.name,
       c.primaryColor, cs.position, cs.positionText, cs.points, cs.wins,
       cs.points - coalesce(lag(cs.points) over (partition by cs.season, cs.constructorId
                                                 order by cs.round), 0) as pointsGained
from constructor_standings cs
join races r on r.raceId = cs.raceId
join constructors c on c.constructorId = cs.constructorId;

create view v_current_driver_standings as
select p.* from v_driver_standings_progression p
where p.season = (select season from v_current_season)
  and p.round = (select max(round) from driver_standings
                 where season = (select season from v_current_season))
order by p.position;

create view v_current_constructor_standings as
select p.* from v_constructor_standings_progression p
where p.season = (select season from v_current_season)
  and p.round = (select max(round) from constructor_standings
                 where season = (select season from v_current_season))
order by p.position;
