from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import fastf1
import fastf1.ergast
import pandas as pd
import numpy as np
from typing import List, Dict, Any, Optional
import json
from datetime import datetime

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
ergast = fastf1.ergast.Ergast()

@app.get("/")
async def root():
    return {"message": "FastF1 Analytics API is running"}

@app.get("/wdc-calculator/{year}")
async def calculate_wdc_possibilities(year: int):
    """Calculate who can still win the World Drivers Championship"""
    try:
        print(f"[DEBUG] Fetching WDC data for year: {year}")
        
        # Get current driver standings from Ergast API
        print(f"[DEBUG] Requesting driver standings for {year}...")
        driver_standings_response = ergast.get_driver_standings(season=year, result_type='pandas')
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
