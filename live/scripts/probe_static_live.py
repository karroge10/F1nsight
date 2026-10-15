"""Does the free static archive get written while a session is running, and how late?

Run it during a live session. Every `--interval` seconds it checks, for the session's folder on
https://livetiming.formula1.com/static/: the session Index.json and the Position.z, CarData.z,
TimingData, Heartbeat, SessionStatus and TrackStatus streams, with HEAD and small Range requests
(never a full download). For each it logs the HTTP status, size, size growth, Last-Modified and
the lag between the newest record and now (Position.z: the newest sample Timestamp; other
streams: the newest line offset converted with the Heartbeat clock). It also logs whether the
season Index.json lists the session and what the root SessionInfo.json says is running.

    cd live
    uv run python scripts/probe_static_live.py --season 2026 --round 17 --session FP1
    uv run python scripts/probe_static_live.py --path "2026/2026-10-11_Singapore_Grand_Prix/2026-10-09_Practice_1/"

Writes one JSON line per check to data/raw/livetiming/probe/<session>_<start>.jsonl and prints a
verdict at the end (or on Ctrl+C). Runs until 30 min after the scheduled end, or `--minutes`.
"""

import argparse
import base64
import json
import re
import sys
import time
import zlib
from datetime import datetime, timedelta, timezone
from pathlib import Path

import httpx

STATIC = "https://livetiming.formula1.com/static"
JOLPICA = "https://api.jolpi.ca/ergast/f1"
TOPICS = ["Position.z", "CarData.z", "TimingData", "Heartbeat", "SessionStatus", "TrackStatus"]
SESSION_NAMES = {
    "FP1": "Practice_1", "FP2": "Practice_2", "FP3": "Practice_3", "SQ": "Sprint_Qualifying",
    "S": "Sprint", "Q": "Qualifying", "R": "Race",
}
JOLPICA_KEYS = {
    "FP1": "FirstPractice", "FP2": "SecondPractice", "FP3": "ThirdPractice",
    "SQ": "SprintQualifying", "S": "Sprint", "Q": "Qualifying",
}
TAIL_BYTES = 65_536
OFFSET_RE = re.compile(r"^(\d{2}):(\d{2}):(\d{2})\.(\d{3})")
UTC_RE = re.compile(r'"Utc"\s*:\s*"([^"]+)"')
OUT_DIR = Path(__file__).resolve().parents[2] / "data" / "raw" / "livetiming" / "probe"


def main() -> None:
    args = parse_args()
    http = httpx.Client(timeout=20.0, headers={"User-Agent": "f1nsight-probe/0.1"}, follow_redirects=True)
    target = resolve_target(http, args)
    print(f"probing {target['path']} (scheduled {target.get('start')} to {target.get('end')} UTC)")
    deadline = probe_deadline(target, args.minutes)
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M")
    slug = target["path"].strip("/").replace("/", "__")
    log_path = OUT_DIR / f"{slug}_{stamp}.jsonl"
    print(f"log: {log_path}")
    history: dict[str, list[dict]] = {topic: [] for topic in ["Index.json", *TOPICS]}
    try:
        with log_path.open("a", encoding="utf-8") as log:
            while datetime.now(timezone.utc) < deadline:
                round_started = time.monotonic()
                records = probe_once(http, target, history)
                for record in records:
                    line = json.dumps(record)
                    log.write(line + "\n")
                log.flush()
                print_round(records)
                elapsed = time.monotonic() - round_started
                time.sleep(max(1.0, args.interval - elapsed))
    except KeyboardInterrupt:
        print("stopped")
    print_verdict(history)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--season", type=int)
    parser.add_argument("--round", type=int)
    parser.add_argument("--session", default="FP1", help="FP1 FP2 FP3 SQ S Q R")
    parser.add_argument("--path", help="session folder, e.g. 2026/2026-10-11_Singapore_Grand_Prix/2026-10-09_Practice_1/")
    parser.add_argument("--interval", type=float, default=30.0, help="seconds between checks")
    parser.add_argument("--minutes", type=float, help="stop after this many minutes (default: end + 30 min)")
    return parser.parse_args()


def resolve_target(http: httpx.Client, args: argparse.Namespace) -> dict:
    """Session folder from --path, the season Index.json, or the Jolpica schedule (guessed path)."""
    if args.path:
        path = args.path if args.path.endswith("/") else args.path + "/"
        return {"path": path, "start": None, "end": None, "source": "argument"}
    if not args.season or not args.round:
        sys.exit("give --path, or --season and --round")
    code = args.session.upper()
    listed = target_from_index(http, args.season, args.round, code)
    if listed is not None:
        return listed
    return target_from_schedule(http, args.season, args.round, code)


def target_from_index(http: httpx.Client, season: int, round_number: int, code: str) -> dict | None:
    index = get_json(http, f"{STATIC}/{season}/Index.json")
    if not index:
        return None
    wanted = SESSION_NAMES[code].replace("_", " ").lower()
    for meeting in index.get("Meetings", []):
        if meeting.get("Number") != round_number or "testing" in (meeting.get("Name") or "").lower():
            continue
        for session in meeting.get("Sessions", []):
            if (session.get("Name") or "").lower() == wanted and session.get("Path"):
                offset = session.get("GmtOffset")
                start = local_to_utc(session.get("StartDate"), offset)
                end = local_to_utc(session.get("EndDate"), offset)
                return {"path": session["Path"], "start": start, "end": end, "source": "index"}
    return None


def target_from_schedule(http: httpx.Client, season: int, round_number: int, code: str) -> dict:
    """The archive folder is <season>/<race date>_<Meeting_Name>/<session date>_<Session_Name>/."""
    schedule = get_json(http, f"{JOLPICA}/{season}/races.json")
    races = (schedule or {}).get("MRData", {}).get("RaceTable", {}).get("Races", [])
    race = next((item for item in races if int(item.get("round", 0)) == round_number), None)
    if race is None:
        sys.exit(f"round {round_number} of {season} not found in the Jolpica schedule")
    if code == "R":
        session = {"date": race["date"], "time": race.get("time", "00:00:00Z")}
    else:
        session = race.get(JOLPICA_KEYS[code])
    if session is None:
        sys.exit(f"{code} is not on the schedule of round {round_number}")
    meeting = race["raceName"].replace(" ", "_")
    path = f"{season}/{race['date']}_{meeting}/{session['date']}_{SESSION_NAMES[code]}/"
    start_text = f"{session['date']}T{session.get('time', '00:00:00Z')}"
    start = parse_utc(start_text)
    length = timedelta(hours=2) if code == "R" else timedelta(hours=1)
    return {"path": path, "start": start, "end": start + length, "source": "schedule (guessed path)"}


def probe_deadline(target: dict, minutes: float | None) -> datetime:
    now = datetime.now(timezone.utc)
    if minutes is not None:
        return now + timedelta(minutes=minutes)
    if target.get("end"):
        return max(target["end"] + timedelta(minutes=30), now + timedelta(minutes=10))
    return now + timedelta(hours=2)


def probe_once(http: httpx.Client, target: dict, history: dict[str, list[dict]]) -> list[dict]:
    now = datetime.now(timezone.utc)
    base = f"{STATIC}/{target['path']}"
    records = []
    heartbeat_zero = None
    for topic in ["Heartbeat", "Index.json", *[name for name in TOPICS if name != "Heartbeat"]]:
        url = base + topic if topic == "Index.json" else f"{base}{topic}.jsonStream"
        record = probe_file(http, url, topic, now, heartbeat_zero)
        if topic == "Heartbeat":
            heartbeat_zero = record.pop("_zero", None)
        previous = history[topic][-1] if history[topic] else None
        record["growth"] = growth(previous, record)
        history[topic].append(record)
        records.append(record)
    root = root_session_info(http, now)
    records.append(root)
    records.append(season_index_record(http, target, now))
    adopt_root_path(target, root)
    return records


def adopt_root_path(target: dict, root: dict) -> None:
    """If the timing system runs this session under a different folder than guessed, follow it."""
    path = root.get("path")
    if not path or path == target["path"] or target.get("source") == "argument":
        return
    wanted_folder = target["path"].rstrip("/").rsplit("/", 1)[-1].split("_", 1)[-1]
    running_folder = path.rstrip("/").rsplit("/", 1)[-1].split("_", 1)[-1]
    if path[:4] == target["path"][:4] and running_folder == wanted_folder:
        print(f"root SessionInfo runs this session as {path}, following it")
        target["path"] = path


def probe_file(http: httpx.Client, url: str, topic: str, now: datetime, heartbeat_zero: float | None) -> dict:
    record = {"utc": iso(now), "topic": topic, "url": url}
    try:
        head = http.head(url)
    except httpx.HTTPError as error:
        record["error"] = str(error)
        return record
    record["status"] = head.status_code
    record["lastModified"] = head.headers.get("last-modified")
    record["etag"] = head.headers.get("etag")
    size = head.headers.get("content-length")
    record["size"] = int(size) if size and size.isdigit() else None
    if head.status_code != 200:
        return record
    if record["size"] is None:
        record["size"] = size_by_range(http, url)
    if topic == "Index.json":
        return record
    tail = fetch_tail(http, url)
    if tail is None:
        return record
    newest = newest_record(tail, topic, heartbeat_zero)
    record.update({key: value for key, value in newest.items() if not key.startswith("_")})
    if newest.get("newestUtc"):
        newest_time = parse_utc(newest["newestUtc"])
        record["lagS"] = round((now - newest_time).total_seconds(), 1)
    if topic == "Heartbeat":
        record["_zero"] = newest.get("_zero")
    return record


def size_by_range(http: httpx.Client, url: str) -> int | None:
    response = http.get(url, headers={"Range": "bytes=0-0"})
    content_range = response.headers.get("content-range") or ""
    total = content_range.rsplit("/", 1)[-1]
    return int(total) if total.isdigit() else None


def fetch_tail(http: httpx.Client, url: str) -> str | None:
    try:
        response = http.get(url, headers={"Range": f"bytes=-{TAIL_BYTES}"})
    except httpx.HTTPError:
        return None
    if response.status_code not in (200, 206):
        return None
    return response.content.decode("utf-8", errors="replace")


def newest_record(tail: str, topic: str, heartbeat_zero: float | None) -> dict:
    """Offset (and UTC where it can be told) of the newest complete line."""
    lines = [line for line in tail.splitlines() if OFFSET_RE.match(line.lstrip("﻿"))]
    if not lines:
        return {}
    last = lines[-1].lstrip("﻿")
    match = OFFSET_RE.match(last)
    hours, minutes, seconds, millis = (int(part) for part in match.groups())
    offset_s = hours * 3600 + minutes * 60 + seconds + millis / 1000
    out = {"newestOffsetS": offset_s}
    body = last[match.end():]
    if topic == "Position.z":
        out["newestUtc"] = position_timestamp(body)
    elif topic == "Heartbeat":
        found = UTC_RE.search(body)
        if found:
            out["newestUtc"] = found.group(1)
            found_utc = found.group(1)
            utc = parse_utc(found_utc)
            out["_zero"] = utc.timestamp() - offset_s
    elif heartbeat_zero is not None:
        newest = datetime.fromtimestamp(heartbeat_zero + offset_s, tz=timezone.utc)
        out["newestUtc"] = iso(newest)
    return out


def position_timestamp(body: str) -> str | None:
    try:
        encoded = json.loads(body)
        compressed = base64.b64decode(encoded)
        raw = zlib.decompress(compressed, -zlib.MAX_WBITS)
        data = json.loads(raw)
    except (ValueError, zlib.error):
        return None
    frames = data.get("Position") or []
    return frames[-1].get("Timestamp") if frames else None


def root_session_info(http: httpx.Client, now: datetime) -> dict:
    info = get_json(http, f"{STATIC}/SessionInfo.json") or {}
    archive = info.get("ArchiveStatus") or {}
    return {
        "utc": iso(now), "topic": "root SessionInfo", "path": info.get("Path"),
        "name": info.get("Name"), "archiveStatus": archive.get("Status"),
    }


def season_index_record(http: httpx.Client, target: dict, now: datetime) -> dict:
    season = target["path"][:4]
    index = get_json(http, f"{STATIC}/{season}/Index.json") or {}
    listed = any(
        session.get("Path") == target["path"]
        for meeting in index.get("Meetings", [])
        for session in meeting.get("Sessions", [])
    )
    return {"utc": iso(now), "topic": "season Index.json", "listsSession": listed}


def growth(previous: dict | None, record: dict) -> int | None:
    if previous is None or previous.get("size") is None or record.get("size") is None:
        return None
    return record["size"] - previous["size"]


def print_round(records: list[dict]) -> None:
    stamp = records[0]["utc"][11:19]
    parts = []
    for record in records:
        topic = record["topic"]
        if topic == "root SessionInfo":
            parts.append(f"root={record.get('name')}/{record.get('archiveStatus')}")
        elif topic == "season Index.json":
            parts.append(f"indexed={record.get('listsSession')}")
        else:
            lag = record.get("lagS")
            lag_text = f" lag {lag:.0f}s" if lag is not None else ""
            parts.append(f"{topic} {record.get('status')} {record.get('size')} (+{record.get('growth')}){lag_text}")
    print(stamp, " | ".join(parts), flush=True)


def print_verdict(history: dict[str, list[dict]]) -> None:
    print("\nverdict")
    for topic, records in history.items():
        available = [record for record in records if record.get("status") == 200]
        grew = [record for record in records if (record.get("growth") or 0) > 0]
        lags = sorted(record["lagS"] for record in grew if record.get("lagS") is not None)
        median_lag = lags[len(lags) // 2] if lags else None
        first = available[0]["utc"] if available else None
        print(f"  {topic:14s} available in {len(available)}/{len(records)} checks (first {first}),"
              f" grew in {len(grew)}, median lag while growing {median_lag} s")


def get_json(http: httpx.Client, url: str) -> dict | None:
    try:
        response = http.get(url)
    except httpx.HTTPError:
        return None
    if response.status_code != 200:
        return None
    text = response.content.decode("utf-8-sig")
    return json.loads(text)


def local_to_utc(local: str | None, offset: str | None) -> datetime | None:
    if not local:
        return None
    sign = -1 if (offset or "").startswith("-") else 1
    hours, minutes, seconds = (int(part) for part in (offset or "00:00:00").lstrip("+-").split(":"))
    moment = datetime.fromisoformat(local).replace(tzinfo=timezone.utc)
    shift = timedelta(hours=hours, minutes=minutes, seconds=seconds)
    return moment - shift if sign > 0 else moment + shift


def parse_utc(value: str) -> datetime:
    cleaned = value.strip().replace("Z", "")
    if "." in cleaned:
        head, fraction = cleaned.split(".", 1)
        cleaned = f"{head}.{fraction[:6]}"
    moment = datetime.fromisoformat(cleaned)
    return moment.replace(tzinfo=timezone.utc) if moment.tzinfo is None else moment


def iso(moment: datetime) -> str:
    return moment.astimezone(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


if __name__ == "__main__":
    main()
