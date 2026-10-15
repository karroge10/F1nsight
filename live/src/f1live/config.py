"""Paths, tunables and optional credentials, all overridable through environment variables."""

import os
from pathlib import Path

PACKAGE_DIR = Path(__file__).resolve().parent
ROOT_DIR = PACKAGE_DIR.parents[2]
DATA_DIR = Path(os.environ.get("F1LIVE_DATA_DIR", ROOT_DIR / "data"))

ARCHIVE_CACHE_DIR = DATA_DIR / "raw" / "livetiming"
TRACK_CACHE_DIR = ARCHIVE_CACHE_DIR / "tracks"
ESTIMATOR_CACHE_DIR = ARCHIVE_CACHE_DIR / "estimator"
FASTF1_CACHE_DIR = DATA_DIR / "fastf1_cache"
FASTF1_RAW_DIR = DATA_DIR / "raw" / "fastf1"

HOST = os.environ.get("F1LIVE_HOST", "127.0.0.1")
PORT = int(os.environ.get("F1LIVE_PORT", "8765"))
CORS_ORIGINS = os.environ.get("F1LIVE_CORS", "http://localhost:3000,http://127.0.0.1:3000").split(",")
# Any local port, so a production build on another port (e.g. 3100) can reach the service.
CORS_ORIGIN_REGEX = os.environ.get("F1LIVE_CORS_REGEX", r"http://(localhost|127\.0\.0\.1)(:\d+)?")

# Output cadence. Frames are sent every tick, timing at most every TIMING_EVERY_TICKS ticks.
FRAME_HZ = float(os.environ.get("F1LIVE_FRAME_HZ", "8"))
TIMING_EVERY_TICKS = int(os.environ.get("F1LIVE_TIMING_EVERY_TICKS", "2"))

# Live position samples arrive 2 to 3 s after they were taken, so the live map is drawn this far
# behind the newest data to always have a sample on both sides for interpolation. Without a token
# the cars are estimated from mini-sector flips (published 2.25 s late, about 4 s apart): at 3 s
# the next flip was rarely known, so cars crept towards the checkpoint and then lurched ahead.
# 6.5 s makes the estimate interpolate almost always (0 reversals in Singapore 2026 FP1).
LIVE_RENDER_DELAY_MS = int(os.environ.get("F1LIVE_RENDER_DELAY_MS", "6500"))
# Timing messages (lap and sector completions, positions in the tower) are published about
# 2.25 s after the moment shown by the position samples (calibrated on 3 races of 2026 against
# FastF1 sector points: median 2.2 to 2.4 s). Replay draws the map this far behind the replay
# clock so the map and the tower line up; the track builder uses it to place sector lines.
TIMING_LAG_MS = int(os.environ.get("F1LIVE_TIMING_LAG_MS", "2250"))
# A car whose last sample is older than this is reported as "stale" (no fresh position).
STALE_AFTER_MS = 10_000
# Official positions older than this (relative to the map time) count as gone: the map falls
# back to the delayed archive stream or to positions estimated from timing.
OFFICIAL_FRESH_MS = 15_000

# Estimated positions (no token): build a circuit reference from the free static archive and
# refresh it when an earlier session of the same weekend has been archived.
ESTIMATOR_ENABLED = os.environ.get("F1LIVE_ESTIMATOR", "1") != "0"
REFERENCE_REFRESH_S = float(os.environ.get("F1LIVE_REFERENCE_REFRESH_S", "600"))

# The static archive's Position.z of a running session, if it grows during the session.
DELAYED_ENABLED = os.environ.get("F1LIVE_DELAYED", "1") != "0"
DELAYED_POLL_S = float(os.environ.get("F1LIVE_DELAYED_POLL_S", "30"))
# Up to this lag the map shows the delayed real positions (frames labelled official-delayed);
# beyond it they only correct the estimate (mini-sector distances, stopped cars).
DELAYED_REPLACE_MAX_LAG_MS = int(os.environ.get("F1LIVE_DELAYED_REPLACE_MAX_LAG_MS", "6000"))
DELAYED_CORRECT_MAX_LAG_MS = int(os.environ.get("F1LIVE_DELAYED_CORRECT_MAX_LAG_MS", "900000"))

# Optional credentials. Nothing here is required; see README for what each one unlocks.
F1TV_TOKEN = os.environ.get("F1TV_SUBSCRIPTION_TOKEN") or os.environ.get("F1LIVE_F1TV_TOKEN")
OPENF1_TOKEN = os.environ.get("OPENF1_TOKEN")
OPENF1_USERNAME = os.environ.get("OPENF1_USERNAME")
OPENF1_PASSWORD = os.environ.get("OPENF1_PASSWORD")

LIVETIMING_BASE = "https://livetiming.formula1.com"
STATIC_BASE = f"{LIVETIMING_BASE}/static"
SIGNALR_CORE_URL = f"{LIVETIMING_BASE}/signalrcore"
OPENF1_BASE = "https://api.openf1.org/v1"
MULTIVIEWER_BASE = "https://api.multiviewer.app/api/v1"
JOLPICA_BASE = "https://api.jolpi.ca/ergast/f1"

USER_AGENT = "f1nsight-live/0.1"

# Topics requested from the live hub.
LIVE_TOPICS = [
    "Heartbeat", "SessionInfo", "SessionStatus", "SessionData", "DriverList", "ExtrapolatedClock",
    "TimingData", "TimingAppData", "TimingStats", "LapCount", "TrackStatus", "RaceControlMessages",
    "WeatherData", "TopThree", "PitLaneTimeCollection", "Position.z", "CarData.z",
]

# Topics downloaded from the static archive for replay and simulation.
ARCHIVE_TOPICS = [
    "Heartbeat", "SessionInfo", "SessionStatus", "DriverList", "ExtrapolatedClock", "TimingData",
    "TimingAppData", "TimingStats", "LapCount", "TrackStatus", "RaceControlMessages", "WeatherData",
    "TopThree", "PitLaneTimeCollection", "Position.z", "CarData.z",
]
