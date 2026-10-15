"""One command after every session or race: refresh every free source, then the forecast.

    refresh.ps1                                   # what the scheduled tasks run
    uv run python -m f1p.refresh                     # same, from pipeline
    uv run python -m f1p.refresh --force             # run every step even if nothing looks new
    uv run python -m f1p.refresh --only fastf1,predict
    uv run python -m f1p.refresh --only penalties,predict
    uv run python -m f1p.refresh --skip openf1

Steps, in order. Each runs as its own process, so a failure in one source never stops the next:

1. history   `f1p.history.update`: Jolpica + F1DB results, standings, f1.sqlite. Skipped unless a
             finished race has no results locally and Jolpica has them now, or the last
             successful run is older than HISTORY_MAX_AGE.
2. openf1    `f1p.openf1.download --refresh` for the current season, then `f1p.openf1.process`
             only when a raw file changed.
3. fantasy   `f1p.fantasy.update`, which also writes data/serve/fantasy_rounds.json: skipped
             unless a session ended since its last success, an OpenF1 table changed in this run,
             or the last success is older than FANTASY_MAX_AGE.
4. fastf1    `f1p.fastf1.incremental`: this weekend's finished sessions (lock-safe next to the
             bulk download), then `build_tables` when a session was added, then
             `f1p.fastf1.telemetry_export` for sessions with no telemetry file yet.
5. penalties `f1p.penalties.update`: grid penalties announced for the next races (FIA stewards'
             decisions, race control, data/manual/grid_penalties.json) into
             data/processed/grid_penalties.parquet. Runs every time; the file is only rewritten
             when a penalty changed, which then triggers the forecast.
6. predict   `f1ml.predict` (auto stage) when any input changed since the last forecast.

Logs: logs/refresh-<local time>.log (every line of every step) and logs/refresh-last.json
(step summary). Exit code 0 when every step succeeded or was skipped, 1 when a step failed,
3 when another refresh still held the lock after LOCK_WAIT.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path

import httpx
import pandas as pd

from f1p.locks import LockBusy, file_lock
from f1p.paths import PREDICTIONS_DIR, PROCESSED_DIR, RAW_DIR, SERVE_DIR, ROOT_DIR

STEPS = ["history", "openf1", "fantasy", "fastf1", "penalties", "predict"]
LOGS_DIR = ROOT_DIR / "logs"
STATE_PATH = LOGS_DIR / "refresh_state.json"
SUMMARY_PATH = LOGS_DIR / "refresh-last.json"
LOCK_PATH = LOGS_DIR / "refresh.lock"
LOCK_WAIT = timedelta(minutes=40)
KEEP_LOGS = 120
HISTORY_MAX_AGE = timedelta(days=7)
FANTASY_MAX_AGE = timedelta(days=3)
RACE_RESULTS_AFTER = timedelta(hours=3)
STEP_TIMEOUT_S = 3 * 3600
JOLPICA_URL = "https://api.jolpi.ca/ergast/f1"


@dataclass
class StepResult:
    name: str
    status: str = "pending"
    reason: str = ""
    seconds: float = 0.0
    details: dict = field(default_factory=dict)


def main() -> int:
    args = _parse_args()
    LOGS_DIR.mkdir(parents=True, exist_ok=True)
    started = datetime.now()
    log_path = LOGS_DIR / f"refresh-{started:%Y%m%d-%H%M%S}.log"
    with log_path.open("a", encoding="utf-8") as log:
        logger = RunLog(log)
        logger.line(f"F1nsight refresh started {started:%Y-%m-%d %H:%M:%S} local, log {log_path}")
        try:
            wait_s = LOCK_WAIT.total_seconds()
            with file_lock(LOCK_PATH, wait_s, purpose="refresh"):
                results = run_steps(args, logger)
        except LockBusy as exc:
            logger.line(f"Another refresh is still running: {exc}")
            return 3
        exit_code = 1 if any(result.status == "failed" for result in results) else 0
        write_summary(results, started, log_path, exit_code)
        summary = summary_text(results)
        logger.line(summary)
    _prune_logs()
    return exit_code


def run_steps(args: argparse.Namespace, logger: RunLog) -> list[StepResult]:
    """Run the selected steps in order; every step is attempted even if an earlier one failed."""
    selected = _selected_steps(args)
    state = _read_json(STATE_PATH) or {}
    runner = StepRunner(logger, state, args.force)
    results = []
    for name in STEPS:
        result = StepResult(name)
        if name not in selected:
            result.status = "skipped"
            result.reason = "not selected"
            results.append(result)
            continue
        step_started = time.monotonic()
        step = getattr(runner, f"step_{name}")
        logger.line(f"\n=== {name} ===")
        try:
            step(result)
        except Exception as exc:
            result.status = "failed"
            result.reason = f"{type(exc).__name__}: {exc}"
        elapsed = time.monotonic() - step_started
        result.seconds = round(elapsed, 1)
        logger.line(f"--- {name}: {result.status} ({result.seconds:.0f}s) {result.reason}")
        results.append(result)
    _write_json(STATE_PATH, state)
    return results


class StepRunner:
    """The six steps. Each fills in its StepResult and records success times in `state`."""

    def __init__(self, logger: RunLog, state: dict, force: bool) -> None:
        self.logger = logger
        self.state = state
        self.force = force
        self.openf1_changed = False

    def step_history(self, result: StepResult) -> None:
        reason = "forced" if self.force else _history_reason(self.state)
        if not reason:
            result.status = "skipped"
            result.reason = "no finished race is missing results"
            return
        result.reason = reason
        self._run_module(result, "pipeline", "f1p.history.update")
        self._mark_success("history", result)

    def step_openf1(self, result: StepResult) -> None:
        now = datetime.now(timezone.utc)
        season = str(now.year)
        season_dir = RAW_DIR / "openf1" / season
        before = _newest_mtime(season_dir)
        self._run_module(result, "pipeline", "f1p.openf1.download", "--refresh", "--seasons", season)
        if result.status == "failed":
            return
        after = _newest_mtime(season_dir)
        processed_at = _mtime(PROCESSED_DIR / "openf1_sessions.parquet")
        if after <= before and processed_at >= after and not self.force:
            result.reason = "no new OpenF1 data"
            self._mark_success("openf1", result)
            return
        self._run_module(result, "pipeline", "f1p.openf1.process")
        self.openf1_changed = result.status == "ok"
        result.reason = "new OpenF1 data processed"
        self._mark_success("openf1", result)

    def step_fantasy(self, result: StepResult) -> None:
        reason = "forced" if self.force else _fantasy_reason(self.state, self.openf1_changed)
        if not reason:
            result.status = "skipped"
            result.reason = "no session ended since the last fantasy update"
            return
        result.reason = reason
        self._run_module(result, "pipeline", "f1p.fantasy.update")
        self._mark_success("fantasy", result)

    def step_fastf1(self, result: StepResult) -> None:
        output = self._run_module(result, "pipeline", "f1p.fastf1.incremental")
        details = _result_line(output)
        result.details = details
        if details:
            new_keys = details.get("new", [])
            pending_keys = details.get("pending", [])
            new = ", ".join(new_keys) or "none"
            pending = ", ".join(pending_keys) or "none"
            result.reason = f"new sessions: {new}; still pending: {pending}; tables rebuilt: {details.get('built')}"
        # fastest-lap telemetry for /telemetry; only sessions not exported yet, from the cache just filled
        self._run_module(result, "pipeline", "f1p.fastf1.telemetry_export")
        self._mark_success("fastf1", result)

    def step_penalties(self, result: StepResult) -> None:
        output = self._run_module(result, "pipeline", "f1p.penalties.update")
        details = _result_line(output)
        result.details = details
        if details:
            state = "rewritten" if details.get("written") else "unchanged"
            result.reason = f"{details.get('race')}: {details.get('penalties')} grid penalties ({state})"
        self._mark_success("penalties", result)

    def step_predict(self, result: StepResult) -> None:
        fingerprint = _prediction_inputs()
        predict_state = self.state.get("predict", {})
        previous = predict_state.get("fingerprint")
        next_path = PREDICTIONS_DIR / "next.json"
        if fingerprint == previous and next_path.exists() and not self.force:
            result.status = "skipped"
            result.reason = "no input changed since the last forecast"
            return
        before = _read_json(next_path) or {}
        self._run_module(result, "ml", "f1ml.predict")
        if result.status != "ok":
            return
        after = _read_json(next_path) or {}
        if after.get("generatedAt") == before.get("generatedAt"):
            result.status = "failed"
            result.reason = "f1ml.predict exited 0 but next.json was not rewritten"
            return
        race = after.get("race", {})
        model = after.get("model", {})
        result.reason = (f"{race.get('season')} R{race.get('round')} {race.get('raceName')}, stage "
                         f"{race.get('stage')}, inputs {race.get('inputsUsed')}, model {model.get('version')}")
        self.state["predict"] = {"fingerprint": fingerprint}
        self._mark_success("predict", result)

    def _run_module(self, result: StepResult, project: str, module: str, *extra: str) -> str:
        """Run `python -m module` in <project>'s environment, tee its output to the log."""
        command = _python_command(project, module, extra)
        cwd = ROOT_DIR / project
        env = dict(os.environ, PYTHONIOENCODING="utf-8", PYTHONUNBUFFERED="1")
        shown_parts = len(extra) + 2
        printable = " ".join(command[-shown_parts:])
        self.logger.line(f"$ ({project}) python {printable}")
        lines: list[str] = []
        process = subprocess.Popen(command, cwd=cwd, env=env, stdout=subprocess.PIPE,
                                   stderr=subprocess.STDOUT, text=True, encoding="utf-8",
                                   errors="replace")
        deadline = time.monotonic() + STEP_TIMEOUT_S
        for line in process.stdout:
            text = line.rstrip()
            lines.append(text)
            self.logger.line(f"  {text}")
            if time.monotonic() > deadline:
                process.kill()
                break
        exit_code = process.wait()
        if exit_code != 0:
            result.status = "failed"
            last_lines = [text for text in lines if text.strip()][-1:]
            tail = last_lines[0] if last_lines else ""
            result.reason = f"{module} exited {exit_code}: {tail}"[:400]
        elif result.status != "failed":
            result.status = "ok"
        return "\n".join(lines)

    def _mark_success(self, name: str, result: StepResult) -> None:
        if result.status != "ok":
            return
        entry = self.state.setdefault(name, {})
        entry["lastSuccess"] = _now_iso()


class RunLog:
    """Writes every line to the run log and to the console."""

    def __init__(self, handle) -> None:
        self.handle = handle

    def line(self, text: str) -> None:
        stamp = datetime.now().strftime("%H:%M:%S")
        for part in text.split("\n"):
            self.handle.write(f"{stamp} {part}\n")
            print(part, flush=True)
        self.handle.flush()


def write_summary(results: list[StepResult], started: datetime, log_path: Path, exit_code: int) -> None:
    payload = {
        "startedAt": started.astimezone(timezone.utc).isoformat(timespec="seconds"),
        "finishedAt": _now_iso(),
        "exitCode": exit_code,
        "log": str(log_path),
        "steps": [result.__dict__ for result in results],
    }
    _write_json(SUMMARY_PATH, payload)


def summary_text(results: list[StepResult]) -> str:
    lines = ["\nSummary"]
    for result in results:
        lines.append(f"  {result.name:9s} {result.status:8s} {result.seconds:6.0f}s  {result.reason}")
    failed = [result.name for result in results if result.status == "failed"]
    failed_text = ", ".join(failed)
    lines.append(f"FAILED: {failed_text}" if failed else "All steps succeeded or had nothing new.")
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------


def _history_reason(state: dict) -> str:
    """Why the history update should run now, or "" to skip it."""
    last = _last_success(state, "history")
    now = datetime.now(timezone.utc)
    if last is None or now - last > HISTORY_MAX_AGE:
        return "last successful history update is older than 7 days"
    missing = _finished_rounds_without_results(now)
    if not missing:
        return ""
    available = [key for key in missing if _jolpica_has_results(*key)]
    if not available:
        return ""
    labels = ", ".join(f"{season} R{round_number}" for season, round_number in available)
    return f"Jolpica now has results for {labels}"


def _finished_rounds_without_results(now: datetime) -> list[tuple[int, int]]:
    races = pd.read_parquet(PROCESSED_DIR / "races.parquet", columns=["season", "round", "raceUtc"])
    results = pd.read_parquet(PROCESSED_DIR / "results.parquet", columns=["season", "round"])
    result_keys = zip(results["season"], results["round"])
    have = set(result_keys)
    cutoff = now.replace(tzinfo=None) - RACE_RESULTS_AFTER
    season_races = races[races["season"] == now.year]
    finished = season_races[season_races["raceUtc"] < cutoff]
    keys = zip(finished["season"], finished["round"])
    return [(int(season), int(round_number)) for season, round_number in keys
            if (season, round_number) not in have]


def _jolpica_has_results(season: int, round_number: int) -> bool:
    url = f"{JOLPICA_URL}/{season}/{round_number}/results/"
    response = httpx.get(url, params={"limit": 1}, timeout=30)
    response.raise_for_status()
    payload = response.json()
    return int(payload["MRData"]["total"]) > 0


def _fantasy_reason(state: dict, openf1_changed: bool) -> str:
    last = _last_success(state, "fantasy")
    now = datetime.now(timezone.utc)
    if last is None or now - last > FANTASY_MAX_AGE:
        return "last successful fantasy update is older than 3 days"
    if openf1_changed:
        return "OpenF1 tables changed (overtakes)"
    ended = _sessions_ended_between(last, now)
    if ended:
        ended_text = ", ".join(ended)
        return f"sessions ended since the last update: {ended_text}"
    return ""


def _sessions_ended_between(start: datetime, end: datetime) -> list[str]:
    columns = ["season", "round", "fp1Utc", "fp2Utc", "fp3Utc", "sprintQualifyingUtc",
               "sprintUtc", "qualifyingUtc", "raceUtc"]
    races = pd.read_parquet(PROCESSED_DIR / "races.parquet", columns=columns)
    start_naive = start.replace(tzinfo=None) - timedelta(hours=1)
    end_naive = end.replace(tzinfo=None) - timedelta(hours=1)
    labels = []
    for column in columns[2:]:
        hits = races[(races[column] > start_naive) & (races[column] <= end_naive)]
        session = column.removesuffix("Utc")
        for _, race in hits.iterrows():
            labels.append(f"{race['season']} R{race['round']} {session}")
    return labels


def _prediction_inputs() -> str:
    """Fingerprint of everything f1ml.predict reads: processed tables, serve db, model, archive.

    Modification times are whole seconds: the cloud refresh restores these files from a tar
    archive, which keeps the time to about a microsecond, not to the nanosecond.
    """
    now = datetime.now(timezone.utc)
    season = str(now.year)
    parts = []
    found = PROCESSED_DIR.glob("*.parquet")
    tables = sorted(found)
    for path in tables:
        stat = path.stat()
        parts.append(f"{path.name}:{int(stat.st_mtime)}:{stat.st_size}")
    for path in (SERVE_DIR / "f1.sqlite", ROOT_DIR / "ml" / "models" / "latest.json"):
        modified = _mtime(path)
        parts.append(f"{path.name}:{int(modified)}")
    livetiming = RAW_DIR / "livetiming" / season
    livetiming_modified = _newest_mtime(livetiming)
    parts.append(f"livetiming:{int(livetiming_modified)}")
    return "|".join(parts)


def _python_command(project: str, module: str, extra: tuple[str, ...]) -> list[str]:
    """The project's venv interpreter; `uv run` when the venv does not exist yet."""
    venv = ROOT_DIR / project / ".venv"
    venv_python = venv / "Scripts" / "python.exe" if os.name == "nt" else venv / "bin" / "python"
    if venv_python.exists():
        return [str(venv_python), "-m", module, *extra]
    return ["uv", "run", "python", "-m", module, *extra]


def _result_line(output: str) -> dict:
    prefix = "RESULT "
    lines = output.splitlines()
    for line in reversed(lines):
        if line.startswith(prefix):
            payload = line[len(prefix):]
            return json.loads(payload)
    return {}


def _selected_steps(args: argparse.Namespace) -> list[str]:
    only = _step_list(args.only) or STEPS
    skip = _step_list(args.skip)
    return [name for name in only if name not in skip]


def _step_list(text: str | None) -> list[str]:
    if not text:
        return []
    names = [part.strip() for part in text.split(",") if part.strip()]
    unknown = [name for name in names if name not in STEPS]
    if unknown:
        raise SystemExit(f"unknown step(s) {unknown}; steps are {STEPS}")
    return names


def _newest_mtime(folder: Path) -> float:
    if not folder.exists():
        return 0.0
    newest = 0.0
    for path in folder.rglob("*"):
        if path.is_file():
            modified = path.stat().st_mtime
            newest = max(newest, modified)
    return newest


def _mtime(path: Path) -> float:
    return path.stat().st_mtime if path.exists() else 0.0


def _last_success(state: dict, step: str) -> datetime | None:
    entry = state.get(step, {})
    text = entry.get("lastSuccess")
    return datetime.fromisoformat(text) if text else None


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _read_json(path: Path):
    if not path.exists():
        return None
    text = path.read_text(encoding="utf-8")
    return json.loads(text)


def _write_json(path: Path, payload) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = path.with_suffix(".tmp")
    text = json.dumps(payload, indent=1, default=str)
    temp_path.write_text(text, encoding="utf-8")
    temp_path.replace(path)


def _prune_logs() -> None:
    found = LOGS_DIR.glob("refresh-2*.log")
    logs = sorted(found)
    for path in logs[:-KEEP_LOGS]:
        path.unlink()


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--force", action="store_true", help="run every selected step even if nothing looks new")
    step_names = ",".join(STEPS)
    parser.add_argument("--only", help=f"comma separated subset of {step_names}")
    parser.add_argument("--skip", help="comma separated steps to leave out")
    return parser.parse_args()


if __name__ == "__main__":
    sys.exit(main())
