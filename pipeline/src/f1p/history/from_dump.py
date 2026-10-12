"""Turn the native Jolpica-F1 CSV dump into Ergast shaped tables.

The semantics follow Jolpica's own Ergast API serializers (jolpica_api/ergastapi), so a table
built here matches what the live API returns for the same race:
- results: session type R (SR for sprints), positionText R/D/W/F for unclassified entries
- qualifying: per round entry, all Q* sessions with a position, final position from the last one
- standings: championship rows bound to a round (round_id set) are the after-round snapshots
"""

from __future__ import annotations

from pathlib import Path

import duckdb
import pandas as pd

DUMP_TABLES = [
    "circuit", "driver", "team", "season", "round", "roundentry", "teamdriver", "session",
    "sessionentry", "lap", "pitstop", "driverchampionship", "teamchampionship",
]
TEXT_COLUMNS = {
    "lap": ["time", "average_speed"],
    "sessionentry": ["time"],
    "pitstop": ["duration", "local_timestamp"],
    "session": ["timestamp"],
}
ROLE_NAMES = "case td.role when 0 then 'permanent' when 1 then 'reserve' when 2 then 'junior' end"


def load_dump_tables(csv_dir: Path) -> dict[str, pd.DataFrame]:
    """Read the dump and return every processed table built from it."""
    con = _connect(csv_dir)
    tables = {
        "circuits": _circuits(con),
        "drivers": _drivers(con),
        "constructors": _constructors(con),
        "seasons": _seasons(con),
        "races": _races(con),
        "results": _results(con, "R"),
        "sprint_results": _results(con, "SR"),
        "qualifying": _qualifying(con),
        "lap_times": _lap_times(con),
        "pit_stops": _pit_stops(con),
        "driver_standings": _driver_standings(con),
        "constructor_standings": _constructor_standings(con),
        "season_entries": _season_entries(con),
    }
    con.close()
    return tables


def _connect(csv_dir: Path) -> duckdb.DuckDBPyConnection:
    con = duckdb.connect()
    for name in DUMP_TABLES:
        csv_path = (csv_dir / f"formula_one_{name}.csv").as_posix()
        text_columns = TEXT_COLUMNS.get(name, [])
        type_overrides = ", ".join(f"'{column}': 'VARCHAR'" for column in text_columns)
        con.execute(
            f"create view {name} as select * from read_csv('{csv_path}', header=true, "
            f"types={{{type_overrides}}})"
            if text_columns
            else f"create view {name} as select * from read_csv('{csv_path}', header=true)"
        )
    con.execute(
        """
        create macro to_ms(s) as case when s is null or s = '' then null else cast(round((
            cast(split_part(s, ':', 1) as bigint) * 3600
            + cast(split_part(s, ':', 2) as bigint) * 60
            + cast(split_part(s, ':', 3) as double)) * 1000) as bigint) end
        """
    )
    con.execute(
        """
        create macro status_category(code) as case code
            when 0 then 'finished' when 1 then 'lapped' when 10 then 'accident'
            when 11 then 'retired' when 20 then 'disqualified' when 30 then 'dns'
            when 40 then 'dnq' when 41 then 'dnpq' end
        """
    )
    con.execute("create macro to_utc(s) as strptime(substr(s, 1, 19), '%Y-%m-%d %H:%M:%S')")
    con.execute(
        """
        create view rnd as
        select r.id as round_pk, y.year as season, r.number as round,
               y.year * 100 + r.number as raceId, r.name, r.date, r.circuit_id,
               r.wikipedia, r.is_cancelled
        from round r join season y on y.id = r.season_id
        """
    )
    con.execute(
        """
        create view entry as
        select re.id as round_entry_id, re.round_id as round_pk, re.car_number,
               d.reference as driverId, t.reference as constructorId
        from roundentry re
        join teamdriver td on td.id = re.team_driver_id
        join driver d on d.id = td.driver_id
        join team t on t.id = td.team_id
        """
    )
    con.execute(
        """
        create view race_entry as
        select se.*, s.type as session_type, s.number as session_number, e.driverId,
               e.constructorId, e.car_number, rnd.raceId, rnd.season, rnd.round
        from sessionentry se
        join session s on s.id = se.session_id
        join entry e on e.round_entry_id = se.round_entry_id
        join rnd on rnd.round_pk = s.round_id
        where not rnd.is_cancelled
        """
    )
    return con


def _circuits(con: duckdb.DuckDBPyConnection) -> pd.DataFrame:
    return con.sql(
        """
        select reference as circuitId, name as circuitName, locality, country,
               country_code as countryCode, latitude as lat, longitude as lng,
               altitude as alt, wikipedia as url
        from circuit order by reference
        """
    ).df()


def _drivers(con: duckdb.DuckDBPyConnection) -> pd.DataFrame:
    return con.sql(
        """
        select reference as driverId, permanent_car_number as permanentNumber,
               abbreviation as code, forename as givenName, surname as familyName,
               forename || ' ' || surname as fullName, date_of_birth as dateOfBirth,
               nationality, country_code as countryCode, wikipedia as url
        from driver order by reference
        """
    ).df()


def _constructors(con: duckdb.DuckDBPyConnection) -> pd.DataFrame:
    return con.sql(
        """
        select reference as constructorId, name, nationality, country_code as countryCode,
               primary_color as primaryColor, wikipedia as url
        from team order by reference
        """
    ).df()


def _seasons(con: duckdb.DuckDBPyConnection) -> pd.DataFrame:
    return con.sql(
        """
        select year as season, wikipedia as url from season order by year
        """
    ).df()


def _races(con: duckdb.DuckDBPyConnection) -> pd.DataFrame:
    return con.sql(
        """
        with sess as (
            select round_id, type, timezone,
                   case when has_time_data then to_utc(timestamp) end as start_utc,
                   cast(to_utc(timestamp) as date) as start_date
            from session
        ),
        per_round as (
            select round_id,
                   max(start_date) filter (where type = 'R') as race_date,
                   max(start_utc) filter (where type = 'R') as race_utc,
                   max(timezone) filter (where type = 'R') as timezone,
                   min(start_utc) filter (where type = 'FP1') as fp1Utc,
                   min(start_utc) filter (where type = 'FP2') as fp2Utc,
                   min(start_utc) filter (where type = 'FP3') as fp3Utc,
                   min(start_utc) filter (where type = 'Q1') as qualifyingUtc,
                   min(start_utc) filter (where type = 'SQ1') as sprintQualifyingUtc,
                   min(start_utc) filter (where type = 'SR') as sprintUtc,
                   count(*) filter (where type = 'SR') > 0 as hasSprint
            from sess group by round_id
        )
        select rnd.raceId, rnd.season, rnd.round, rnd.name as raceName,
               c.reference as circuitId, coalesce(p.race_date, rnd.date) as date,
               strftime(p.race_utc, '%H:%M:%S') as time, p.race_utc as raceUtc,
               p.timezone, coalesce(p.hasSprint, false) as hasSprint,
               p.fp1Utc, p.fp2Utc, p.fp3Utc, p.qualifyingUtc, p.sprintQualifyingUtc,
               p.sprintUtc, rnd.wikipedia as url
        from rnd
        join circuit c on c.id = rnd.circuit_id
        left join per_round p on p.round_id = rnd.round_pk
        where not rnd.is_cancelled
        order by rnd.season, rnd.round
        """
    ).df()


def _results(con: duckdb.DuckDBPyConnection, session_type: str) -> pd.DataFrame:
    return con.sql(
        f"""
        with fl as (
            select session_entry_id, number, time, average_speed
            from lap where is_entry_fastest_lap
        )
        select e.raceId, e.season, e.round, e.driverId, e.constructorId,
               e.car_number as number, e.grid,
               case when e.is_classified then e.position end as position,
               case
                   when e.is_classified then cast(e.position as varchar)
                   when e.status = 30 then 'W'
                   when e.status = 20 then 'D'
                   when e.status in (40, 41) then 'F'
                   else 'R'
               end as positionText,
               e.position as positionOrder, e.points, e.laps_completed as laps,
               case when e.is_classified then to_ms(e.time) end as timeMs,
               e.fastest_lap_rank as fastestLapRank, fl.number as fastestLap,
               to_ms(fl.time) as fastestLapTimeMs,
               try_cast(fl.average_speed as double) as fastestLapAvgSpeed,
               coalesce(e.detail, status_category(e.status)) as status,
               status_category(e.status) as statusCategory
        from race_entry e
        left join fl on fl.session_entry_id = e.id
        where e.session_type = '{session_type}'
        order by e.season, e.round, e.position
        """
    ).df()


def _qualifying(con: duckdb.DuckDBPyConnection) -> pd.DataFrame:
    return con.sql(
        """
        with q as (
            select e.round_entry_id, e.raceId, e.season, e.round, e.driverId, e.constructorId,
                   e.car_number, e.session_type, e.session_number, e.position,
                   to_ms(l.time) as ms
            from race_entry e
            left join lap l
              on l.session_entry_id = e.id and l.is_entry_fastest_lap and not l.is_deleted
            where e.session_type like 'Q%' and e.position is not null
        ),
        ranked as (
            select *,
                   row_number() over (partition by round_entry_id
                                      order by session_number desc) as rn_last,
                   row_number() over (partition by round_entry_id, session_type in ('Q1', 'Q2', 'Q3')
                                      order by session_number) as rn_generic
            from q
        )
        select raceId, season, round, driverId, constructorId, car_number as number,
               max(position) filter (where rn_last = 1) as position,
               coalesce(max(ms) filter (where session_type = 'Q1'),
                        max(ms) filter (where session_type not in ('Q1', 'Q2', 'Q3')
                                        and rn_generic = 1)) as q1Ms,
               coalesce(max(ms) filter (where session_type = 'Q2'),
                        max(ms) filter (where session_type not in ('Q1', 'Q2', 'Q3')
                                        and rn_generic = 2)) as q2Ms,
               max(ms) filter (where session_type = 'Q3') as q3Ms
        from ranked
        group by round_entry_id, raceId, season, round, driverId, constructorId, car_number
        order by season, round, position
        """
    ).df()


def _lap_times(con: duckdb.DuckDBPyConnection) -> pd.DataFrame:
    return con.sql(
        """
        select e.raceId, e.season, e.round, e.driverId, l.number as lap, l.position,
               to_ms(l.time) as timeMs
        from lap l
        join race_entry e on e.id = l.session_entry_id
        where e.session_type = 'R' and l.number is not null and l.time is not null
        order by e.season, e.round, l.number, l.position
        """
    ).df()


def _pit_stops(con: duckdb.DuckDBPyConnection) -> pd.DataFrame:
    return con.sql(
        """
        select e.raceId, e.season, e.round, e.driverId, p.number as stop, l.number as lap,
               p.local_timestamp as localTime, to_ms(p.duration) as durationMs
        from pitstop p
        join race_entry e on e.id = p.session_entry_id
        left join lap l on l.id = p.lap_id
        where e.session_type = 'R'
        order by e.season, e.round, p.local_timestamp, e.driverId
        """
    ).df()


def _driver_standings(con: duckdb.DuckDBPyConnection) -> pd.DataFrame:
    return con.sql(
        """
        with stints as (
            select rnd.season, e.driverId, e.constructorId, min(rnd.round) as first_round
            from entry e join rnd on rnd.round_pk = e.round_pk
            group by all
        ),
        standings as (
            select dc.year as season, rnd.round, dc.year * 100 + rnd.round as raceId,
                   d.reference as driverId, dc.points, dc.position, dc.win_count as wins,
                   case
                       when dc.adjustment_type = 101 then 'D'
                       when dc.adjustment_type = 102 then 'E'
                       when not dc.is_eligible then '-'
                       else cast(dc.position as varchar)
                   end as positionText
            from driverchampionship dc
            join driver d on d.id = dc.driver_id
            join rnd on rnd.round_pk = dc.round_id
        )
        select s.raceId, s.season, s.round, s.driverId, s.points, s.position, s.positionText,
               s.wins,
               string_agg(st.constructorId, ',' order by st.first_round, st.constructorId)
                   as constructorIds
        from standings s
        left join stints st
          on st.season = s.season and st.driverId = s.driverId and st.first_round <= s.round
        group by all
        order by s.season, s.round, s.position
        """
    ).df()


def _constructor_standings(con: duckdb.DuckDBPyConnection) -> pd.DataFrame:
    return con.sql(
        """
        select tc.year * 100 + rnd.round as raceId, tc.year as season, rnd.round,
               t.reference as constructorId, tc.points, tc.position,
               case
                   when tc.adjustment_type = 101 then 'D'
                   when tc.adjustment_type = 102 then 'E'
                   when not tc.is_eligible then '-'
                   else cast(tc.position as varchar)
               end as positionText,
               tc.win_count as wins
        from teamchampionship tc
        join team t on t.id = tc.team_id
        join rnd on rnd.round_pk = tc.round_id
        order by season, rnd.round, tc.position
        """
    ).df()


def _season_entries(con: duckdb.DuckDBPyConnection) -> pd.DataFrame:
    """Season rosters (team, driver, role); race counts are added after merging sources."""
    return con.sql(
        f"""
        select y.year as season, d.reference as driverId, t.reference as constructorId,
               {ROLE_NAMES} as role
        from teamdriver td
        join season y on y.id = td.season_id
        join driver d on d.id = td.driver_id
        join team t on t.id = td.team_id
        order by season, constructorId, driverId
        """
    ).df()
