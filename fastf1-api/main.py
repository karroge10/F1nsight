from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import fastf1
import fastf1.ergast
import pandas as pd
import numpy as np
from typing import List, Dict, Any, Optional
import json
from datetime import datetime
from fastf1.ergast import Ergast

app = FastAPI(title="FastF1 Analytics API", version="1.0.0")

# Enable CORS for Next.js frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Enable FastF1 cache
fastf1.Cache.enable_cache('cache')

# Initialize Ergast client
ergast = Ergast()

@app.get("/")
async def root():
    return {"message": "FastF1 Analytics API is running"}

@app.get("/schedule/{year}")
async def get_schedule(year: int):
    """Get the complete race schedule for a given year"""
    try:
        print(f"[DEBUG] Fetching schedule for year: {year}")
        
        # Get the event schedule using FastF1
        schedule = fastf1.get_event_schedule(year)
        print("schedule", schedule)
        # Convert to dictionary format for JSON response
        schedule_dict = []
        for index, event in schedule.iterrows():
            event_dict = {
                "round_number": int(event['RoundNumber']) if pd.notna(event['RoundNumber']) else None,
                "country": str(event['Country']) if pd.notna(event['Country']) else None,
                "location": str(event['Location']) if pd.notna(event['Location']) else None,
                "official_name": str(event['OfficialEventName']) if pd.notna(event['OfficialEventName']) else None,
                "event_name": str(event['EventName']) if pd.notna(event['EventName']) else None,
                "event_date": str(event['EventDate']) if pd.notna(event['EventDate']) else None,
                "event_format": str(event['EventFormat']) if pd.notna(event['EventFormat']) else None,
                # Session times
                "session1_date": str(event['Session1Date']) if pd.notna(event['Session1Date']) else None,
                "session2_date": str(event['Session2Date']) if pd.notna(event['Session2Date']) else None,
                "session3_date": str(event['Session3Date']) if pd.notna(event['Session3Date']) else None,
                "session4_date": str(event['Session4Date']) if pd.notna(event['Session4Date']) else None,
                "session5_date": str(event['Session5Date']) if pd.notna(event['Session5Date']) else None,
                # Session names
                "session1": str(event['Session1']) if pd.notna(event['Session1']) else None,
                "session2": str(event['Session2']) if pd.notna(event['Session2']) else None,
                "session3": str(event['Session3']) if pd.notna(event['Session3']) else None,
                "session4": str(event['Session4']) if pd.notna(event['Session4']) else None,
                "session5": str(event['Session5']) if pd.notna(event['Session5']) else None,
                "f1_api_support": bool(event['F1ApiSupport']) if pd.notna(event['F1ApiSupport']) else False
            }
            schedule_dict.append(event_dict)
        
        return {"schedule": schedule_dict}
        
    except Exception as e:
        print(f"[ERROR] Failed to fetch schedule: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to fetch schedule: {str(e)}")

@app.get("/next-race/{year}")
async def get_next_race(year: int):
    """Get the next upcoming race for a given year"""
    try:
        print(f"[DEBUG] Fetching next race for year: {year}")
        
        # Get the event schedule using FastF1
        schedule = fastf1.get_event_schedule(year)
        
        # Get current datetime
        now = datetime.now()
        
        # Find the next race
        next_race = None
        for index, event in schedule.iterrows():
            event_date = pd.to_datetime(event['EventDate'])
            if event_date > now:
                next_race = event
                break
        
        if next_race is None:
            # Try next year if no races left in current year
            try:
                next_year_schedule = fastf1.get_event_schedule(year + 1)
                if not next_year_schedule.empty:
                    next_race = next_year_schedule.iloc[0]
            except:
                pass
        
        if next_race is None:
            return {"next_race": None, "message": "No upcoming races found"}
        
        # Convert to dictionary format
        race_dict = {
            "round_number": int(next_race['RoundNumber']) if pd.notna(next_race['RoundNumber']) else None,
            "country": str(next_race['Country']) if pd.notna(next_race['Country']) else None,
            "location": str(next_race['Location']) if pd.notna(next_race['Location']) else None,
            "official_name": str(next_race['OfficialEventName']) if pd.notna(next_race['OfficialEventName']) else None,
            "event_name": str(next_race['EventName']) if pd.notna(next_race['EventName']) else None,
            "event_date": str(next_race['EventDate']) if pd.notna(next_race['EventDate']) else None,
            "event_format": str(next_race['EventFormat']) if pd.notna(next_race['EventFormat']) else None,
            # Session times
            "session1_date": str(next_race['Session1Date']) if pd.notna(next_race['Session1Date']) else None,
            "session2_date": str(next_race['Session2Date']) if pd.notna(next_race['Session2Date']) else None,
            "session3_date": str(next_race['Session3Date']) if pd.notna(next_race['Session3Date']) else None,
            "session4_date": str(next_race['Session4Date']) if pd.notna(next_race['Session4Date']) else None,
            "session5_date": str(next_race['Session5Date']) if pd.notna(next_race['Session5Date']) else None,
            # Session names
            "session1": str(next_race['Session1']) if pd.notna(next_race['Session1']) else None,
            "session2": str(next_race['Session2']) if pd.notna(next_race['Session2']) else None,
            "session3": str(next_race['Session3']) if pd.notna(next_race['Session3']) else None,
            "session4": str(next_race['Session4']) if pd.notna(next_race['Session4']) else None,
            "session5": str(next_race['Session5']) if pd.notna(next_race['Session5']) else None,
            "f1_api_support": bool(next_race['F1ApiSupport']) if pd.notna(next_race['F1ApiSupport']) else False
        }
        
        return {"next_race": race_dict}
        
    except Exception as e:
        print(f"[ERROR] Failed to fetch next race: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to fetch next race: {str(e)}")

@app.get("/last-race-top3/{year}")
async def get_last_race_top3(year: int):
    """Get the most recent completed race's top 3 finishers for a given year"""
    try:
        schedule = fastf1.get_event_schedule(year)

        # Build a race date column using Session5Date (race) falling back to EventDate
        race_dates = pd.to_datetime(schedule.get('Session5Date', schedule['EventDate']))
        if 'Session5Date' in schedule.columns:
            # fillna with EventDate where Session5Date is NaT
            race_dates = pd.to_datetime(schedule['Session5Date']).fillna(pd.to_datetime(schedule['EventDate']))
        schedule = schedule.copy()
        schedule['RaceDate'] = race_dates

        # Completed races only, and only Grand Prix (exclude testing)
        now = pd.Timestamp.now(tz=schedule['RaceDate'].dt.tz)
        completed = schedule[(schedule['RaceDate'] < now)]
        completed = completed[
            completed['EventName'].astype(str).str.contains('Grand Prix', case=False, na=False) |
            completed['OfficialEventName'].astype(str).str.contains('Grand Prix', case=False, na=False)
        ]

        if completed.empty:
            return {"last_race": None, "top3": [], "message": "No completed races found"}

        last_event = completed.sort_values('RaceDate').iloc[-1]
        round_number = int(last_event['RoundNumber']) if pd.notna(last_event['RoundNumber']) else None

        if round_number is None:
            return {"last_race": None, "top3": [], "message": "Unable to determine last race round"}

        session = fastf1.get_session(year, round_number, 'R')
        session.load()
        results_df = session.results

        if results_df is None or results_df.empty:
            # Fallback to Ergast classification
            try:
                erg = fastf1.ergast.Ergast()
                er = erg.get_results(season=year, round=round_number, result_type='pandas')
                df = getattr(er, 'content', None)
                if df is not None and not df.empty:
                    # Expect columns positionText/positionOrder, givenName/familyName, constructorName, points, status, time
                    df = df.sort_values(by=[c for c in ['positionOrder', 'position'] if c in df.columns])
                    top3_rows = df.head(3)
                    top3 = []
                    for _, row in top3_rows.iterrows():
                        driver_name = f"{row.get('givenName', '')} {row.get('familyName', '')}".strip() or str(row.get('driverId', 'Unknown'))
                        team_name = str(row.get('constructorName', 'Unknown'))
                        pts = float(row.get('points', 0) or 0)
                        pos = int(row.get('positionOrder') or row.get('position') or 0) or None
                        top3.append({
                            "position": pos,
                            "driver": driver_name,
                            "team": team_name,
                            "points": pts,
                            "status": str(row.get('status', ''))
                        })

                    return {
                        "last_race": {
                            "round_number": round_number,
                            "country": str(last_event['Country']),
                            "location": str(last_event['Location']),
                            "event_name": str(last_event['EventName']),
                            "race_date": str(last_event['RaceDate'])
                        },
                        "top3": top3,
                        "source": "ergast"
                    }
            except Exception:
                pass
            return {"last_race": {
                "round_number": round_number,
                "country": str(last_event['Country']),
                "location": str(last_event['Location']),
                "event_name": str(last_event['EventName']),
                "race_date": str(last_event['RaceDate'])
            }, "top3": [], "message": "No classification data available"}

        # Normalize column names in case of version differences
        cols = {c.lower(): c for c in results_df.columns}
        def col(name: str) -> str:
            return cols.get(name.lower(), name)

        results_df = results_df.sort_values(by=col('Position'))
        top3_rows = results_df.head(3)
        top3 = []
        for _, row in top3_rows.iterrows():
            # Prefer FullName if available, else Driver or Abbreviation as last resort
            driver_name = row.get(col('FullName'))
            if pd.isna(driver_name) or driver_name is None:
                driver_name = row.get(col('Driver'))
            if pd.isna(driver_name) or driver_name is None:
                driver_name = row.get(col('Abbreviation'), 'Unknown')

            team_name = row.get(col('TeamName'))
            if pd.isna(team_name) or team_name is None:
                team_name = row.get(col('Team'), 'Unknown')

            points_val = row.get(col('Points'), 0)
            try:
                points_val = float(points_val) if not pd.isna(points_val) else 0.0
            except Exception:
                points_val = 0.0

            top3.append({
                "position": int(row[col('Position')]) if pd.notna(row.get(col('Position'))) else None,
                "driver": str(driver_name),
                "team": str(team_name),
                "points": points_val,
                "status": str(row.get(col('Status'), ''))
            })

        return {
            "last_race": {
                "round_number": round_number,
                "country": str(last_event['Country']),
                "location": str(last_event['Location']),
                "event_name": str(last_event['EventName']),
                "race_date": str(last_event['RaceDate'])
            },
            "top3": top3
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch last race results: {str(e)}")

@app.get("/race-results/{year}/{round}")
async def get_race_results(year: int, round: int, limit: int = 3):
    """Get classification results for a specific race (default top 3)."""
    try:
        session = fastf1.get_session(year, round, 'R')
        session.load()
        results_df = session.results

        if results_df is None or results_df.empty:
            return {
                "year": year,
                "round": round,
                "race_name": session.event['EventName'] if session and session.event is not None else None,
                "top": [],
                "message": "No classification data available"
            }

        cols = {c.lower(): c for c in results_df.columns}
        def col(name: str) -> str:
            return cols.get(name.lower(), name)

        ordered = results_df.sort_values(by=col('Position'))
        subset = ordered.head(max(1, limit))
        top = []
        for _, row in subset.iterrows():
            driver_name = row.get(col('FullName'))
            if pd.isna(driver_name) or driver_name is None:
                driver_name = row.get(col('Driver'))
            if pd.isna(driver_name) or driver_name is None:
                driver_name = row.get(col('Abbreviation'), 'Unknown')

            team_name = row.get(col('TeamName'))
            if pd.isna(team_name) or team_name is None:
                team_name = row.get(col('Team'), 'Unknown')

            status_val = row.get(col('Status'))
            race_time = row.get(col('Time'))
            pts = row.get(col('Points'), 0)
            try:
                pts = float(pts) if not pd.isna(pts) else 0.0
            except Exception:
                pts = 0.0

            top.append({
                "position": int(row[col('Position')]) if pd.notna(row.get(col('Position'))) else None,
                "driver": str(driver_name),
                "team": str(team_name),
                "points": pts,
                "status": str(status_val) if status_val is not None else None,
                "time": str(race_time) if race_time is not None else None
            })

        return {
            "year": year,
            "round": round,
            "race_name": session.event['EventName'] if session and session.event is not None else None,
            "top": top
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch race results: {str(e)}")

@app.get("/wdc-calculator/{year}")
async def calculate_wdc_possibilities(year: int):
    """Calculate who can still win the World Drivers Championship"""
    try:
        print(f"[DEBUG] Fetching WDC data for year: {year}")
        
        # Get current driver standings from Ergast API
        print(f"[DEBUG] Requesting driver standings for {year}...")
        driver_standings_response = ergast.get_driver_standings(season=2025)
        print(f"[DEBUG] Driver standings response type: {type(driver_standings_response)}")
        print(f"[DEBUG] Driver standings content shape: {driver_standings_response.content.shape if hasattr(driver_standings_response, 'content') else 'No content attr'}")
        
        if driver_standings_response.content.empty:
            print(f"[ERROR] No driver standings data for {year}")
            raise HTTPException(status_code=404, detail=f"No driver standings data available for {year}")
        
        print(f"[DEBUG] Driver standings columns: {list(driver_standings_response.content.columns)}")
        print(f"[DEBUG] First few rows:\n{driver_standings_response.content.head()}")
        
        # Get season schedule to calculate remaining races
        print(f"[DEBUG] Requesting race schedule for {year}...")
        schedule_response = ergast.get_races(season=year, result_type='pandas')
        print(f"[DEBUG] Schedule response shape: {schedule_response.content.shape if hasattr(schedule_response, 'content') else 'No content attr'}")
        
        if schedule_response.content.empty:
            print(f"[ERROR] No race schedule data for {year}")
            raise HTTPException(status_code=404, detail=f"No race schedule data available for {year}")
        
        # Calculate races completed and remaining
        current_date = datetime.now()
        schedule_df = schedule_response.content
        print(f"[DEBUG] Current date: {current_date.date()}")
        print(f"[DEBUG] Schedule columns: {list(schedule_df.columns)}")
        print(f"[DEBUG] Race dates: {schedule_df['raceDate'].tolist() if 'raceDate' in schedule_df.columns else 'No raceDate column'}")
        
        # Filter races that have already happened
        completed_races = schedule_df[schedule_df['raceDate'] < current_date.date()]
        total_races = len(schedule_df)
        completed_races_count = len(completed_races)
        races_left = max(0, total_races - completed_races_count)
        
        print(f"[DEBUG] Total races: {total_races}, Completed: {completed_races_count}, Remaining: {races_left}")
        
        # Process driver standings
        standings_df = driver_standings_response.content
        
        # Convert to our format
        current_standings = []
        for _, row in standings_df.iterrows():
            driver_name = f"{row['givenName']} {row['familyName']}"
            print(f"[DEBUG] Processing driver: {driver_name}, Points: {row['points']}, Team: {row['constructorName']}")
            current_standings.append({
                "driver": driver_name,
                "points": float(row['points']),
                "team": row['constructorName'],
                "position": int(row['position'])
            })
        
        # Sort by points descending
        current_standings.sort(key=lambda x: x['points'], reverse=True)
        
        # Calculate maximum possible points for remaining races
        max_points_per_race = 26  # 25 for win + 1 for fastest lap
        max_remaining_points = races_left * max_points_per_race
        
        leader_points = current_standings[0]["points"]
        print(f"[DEBUG] Championship leader: {current_standings[0]['driver']} with {leader_points} points")
        
        # Calculate who can still win
        can_still_win = []
        for driver in current_standings:
            max_possible = driver["points"] + max_remaining_points
            can_win = max_possible >= leader_points
            points_behind = leader_points - driver["points"]
            
            can_still_win.append({
                "driver": driver["driver"],
                "team": driver["team"],
                "current_points": driver["points"],
                "max_possible": max_possible,
                "can_win": can_win,
                "points_behind": points_behind,
                "races_left": races_left
            })
        
        print(f"[DEBUG] Successfully calculated WDC possibilities for {year}")
        return {
            "year": year,
            "races_completed": completed_races_count,
            "races_remaining": races_left,
            "total_races": total_races,
            "max_points_per_race": max_points_per_race,
            "championship_leader": current_standings[0]["driver"],
            "leader_points": leader_points,
            "drivers": can_still_win
        }
        
    except Exception as e:
        print(f"[ERROR] Exception in calculate_wdc_possibilities: {str(e)}")
        print(f"[ERROR] Exception type: {type(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/constructor-standings/{year}")
async def get_constructor_standings(year: int):
    """Get current constructor standings"""
    try:
        print(f"[DEBUG] Fetching constructor standings for year: {year}")
        
        # Get constructor standings from Ergast API
        constructor_standings_response = ergast.get_constructor_standings(season=year, result_type='pandas')
        print(f"[DEBUG] Constructor standings response type: {type(constructor_standings_response)}")
        print(f"[DEBUG] Constructor standings content shape: {constructor_standings_response.content.shape if hasattr(constructor_standings_response, 'content') else 'No content attr'}")
        
        if constructor_standings_response.content.empty:
            print(f"[ERROR] No constructor standings data for {year}")
            raise HTTPException(status_code=404, detail=f"No constructor standings data available for {year}")
        
        standings_df = constructor_standings_response.content
        print(f"[DEBUG] Constructor standings columns: {list(standings_df.columns)}")
        print(f"[DEBUG] Constructor standings data:\n{standings_df.head()}")
        
        # Convert to our format
        constructor_standings = []
        for _, row in standings_df.iterrows():
            constructor_name = row['constructorName']
            print(f"[DEBUG] Processing constructor: {constructor_name}, Points: {row['points']}, Wins: {row['wins']}")
            constructor_standings.append({
                "constructor": constructor_name,
                "nationality": row['nationality'],
                "position": int(row['position']),
                "points": float(row['points']),
                "wins": int(row['wins'])
            })
        
        print(f"[DEBUG] Successfully processed {len(constructor_standings)} constructors for {year}")
        return {
            "year": year,
            "constructors": constructor_standings
        }
        
    except Exception as e:
        print(f"[ERROR] Exception in get_constructor_standings: {str(e)}")
        print(f"[ERROR] Exception type: {type(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/position-changes/{year}/{round}")
async def get_position_changes(year: int, round: int):
    """Get position changes during a specific race"""
    try:
        session = fastf1.get_session(year, round, 'R')
        session.load()
        
        # Get lap data for all drivers
        laps = session.laps
        
        # Calculate position changes throughout the race
        position_data = []
        
        max_lap = int(laps['LapNumber'].max())
        for lap_num in range(1, max_lap + 1):
            lap_data = laps[laps['LapNumber'] == lap_num].sort_values('LapTime')
            
            for pos, (_, lap) in enumerate(lap_data.iterrows(), 1):
                position_data.append({
                    "lap": lap_num,
                    "driver": lap['Driver'],
                    "position": pos,
                    "lap_time": lap['LapTime'].total_seconds() if pd.notna(lap['LapTime']) else None,
                    "team": lap['Team']
                })
        
        return {
            "year": year,
            "round": round,
            "race_name": session.event['EventName'],
            "total_laps": max_lap,
            "position_data": position_data
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/lap-times/{year}/{round}")
async def get_lap_times(year: int, round: int):
    """Get lap times for all drivers in a race"""
    try:
        session = fastf1.get_session(year, round, 'R')
        session.load()
        
        laps = session.laps
        
        lap_times_data = []
        for _, lap in laps.iterrows():
            if pd.notna(lap['LapTime']):
                lap_times_data.append({
                    "driver": lap['Driver'],
                    "team": lap['Team'],
                    "lap_number": lap['LapNumber'],
                    "lap_time": lap['LapTime'].total_seconds(),
                    "compound": lap['Compound'],
                    "tyre_life": lap['TyreLife']
                })
        
        return {
            "year": year,
            "round": round,
            "race_name": session.event['EventName'],
            "lap_times": lap_times_data
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/team-pace/{year}/{round}")
async def get_team_pace_comparison(year: int, round: int):
    """Compare team pace across a race weekend"""
    try:
        # Get qualifying and race sessions
        quali = fastf1.get_session(year, round, 'Q')
        race = fastf1.get_session(year, round, 'R')
        
        quali.load()
        race.load()
        
        # Calculate average lap times per team
        team_pace = {}
        
        # Qualifying pace
        quali_laps = quali.laps[quali.laps['LapTime'].notna()]
        quali_pace = quali_laps.groupby('Team')['LapTime'].apply(
            lambda x: x.nsmallest(3).mean().total_seconds()
        ).to_dict()
        
        # Race pace (exclude first and last 10 laps)
        race_laps = race.laps[
            (race.laps['LapTime'].notna()) & 
            (race.laps['LapNumber'] > 10) & 
            (race.laps['LapNumber'] < race.laps['LapNumber'].max() - 10)
        ]
        race_pace = race_laps.groupby('Team')['LapTime'].mean().dt.total_seconds().to_dict()
        
        # Combine data
        for team in set(list(quali_pace.keys()) + list(race_pace.keys())):
            team_pace[team] = {
                "team": team,
                "qualifying_pace": quali_pace.get(team),
                "race_pace": race_pace.get(team),
                "pace_difference": (race_pace.get(team, 0) - quali_pace.get(team, 0)) if team in quali_pace and team in race_pace else None
            }
        
        return {
            "year": year,
            "round": round,
            "race_name": race.event['EventName'],
            "team_pace": list(team_pace.values())
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
