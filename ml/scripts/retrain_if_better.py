"""Retrain gate: build features, train, backtest, and promote the new model only if it is not worse.

Run from v2/ml:
    uv run python scripts/retrain_if_better.py                    # run the gate now
    uv run python scripts/retrain_if_better.py --when-due         # scheduled task: run only when
                                                                  # results are newer than the model
    uv run python scripts/retrain_if_better.py --no-promote       # dry run: everything up to the
                                                                  # comparison, never promotes
    uv run python scripts/retrain_if_better.py --no-promote --seed 1 --gbm-bags 5 --nn-seeds 8
                                                                  # seed and ensemble sizes, passed
                                                                  # to f1ml.train and the backtest

Steps:
1. (with --when-due) exit quietly unless results.parquet has a race newer than the one the current
   model was trained through, no FastF1 bulk download is running and the gate has not already
   run for that race (a rejected candidate is not retried until the next race).
2. Rebuild data/processed/ff1_* when a FastF1 session is newer than ff1_laps (lock-safe).
3. `f1ml.features`, then `f1ml.train` (new folder under models/). models/latest.json is put back
   to the current model straight away, under the refresh lock, so nothing uses the candidate yet.
4. `f1ml.backtest` for the candidate into ml/staging/<version>/ (the live data/predictions files
   are not touched).
5. Compare on the races both backtests cover. The candidate must not be worse on any of:
   post-qualifying win log loss, post-qualifying Spearman, pre-weekend win log loss.
6. Promote: models/latest.json -> candidate, staged backtest.json, history/*.json and reports
   copied into place, then `f1ml.predict`. Reject: the current model stays, the candidate folder
   and staging stay on disk for inspection.

The decision and both sets of metrics go to ml/reports/retrain_gate.json; the full output to
v2/logs/retrain-<time>.log. Seconds per phase (FastF1 tables, features, train, backtest) are in
the report too. With --no-promote the decision is "would promote" or "would reject": nothing is
copied, f1ml.predict does not run and models/latest.json keeps pointing at the current model.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

ML_DIR = Path(__file__).resolve().parents[1]
_ML_PATH = str(ML_DIR)
sys.path.insert(0, _ML_PATH)

from f1ml import paths  # noqa: E402

_PIPELINE_PATH = str(paths.PIPELINE_SRC)
sys.path.insert(0, _PIPELINE_PATH)

from f1p.locks import file_lock, pipeline_processes  # noqa: E402

V2_DIR = paths.V2_DIR
LOGS_DIR = V2_DIR / "logs"
REFRESH_LOCK = LOGS_DIR / "refresh.lock"
REFRESH_LOCK_WAIT_S = 60 * 60
GATE_REPORT = paths.REPORTS_DIR / "retrain_gate.json"
STAGING_DIR = ML_DIR / "staging"
# (stage, metric, direction): +1 means higher is better, -1 means lower is better.
CRITERIA = [
    ("post-qualifying", "logLossWin", -1),
    ("post-qualifying", "spearman", +1),
    ("pre-weekend", "logLossWin", -1),
]
# Floating point slack only; any real regression rejects the candidate.
EPSILON = 1e-9
FINISHED_DECISIONS = ("promoted", "rejected", "would promote", "would reject")


def main() -> int:
    args = _parse_args()
    ensemble = _ensemble_arguments(args)
    if args.backtest_into:
        staging = Path(args.backtest_into)
        return run_staged_backtest(staging, ensemble)
    LOGS_DIR.mkdir(parents=True, exist_ok=True)
    if args.when_due:
        reason = not_due_reason()
        if reason:
            print(f"retrain gate waiting: {reason}")
            return 0
    log_path = LOGS_DIR / f"retrain-{datetime.now():%Y%m%d-%H%M%S}.log"
    with log_path.open("a", encoding="utf-8") as log:
        try:
            report = run_gate(log, args.no_promote, ensemble)
        except Exception as exc:
            problem = f"{exc.__class__.__name__}: {exc}"
            _log(log, f"retrain gate failed: {problem}")
            finished_at = _now_iso()
            report = {"decision": "error", "reason": problem, "finishedAt": finished_at}
    report["log"] = str(log_path)
    report["trigger"] = "due" if args.when_due else "manual"
    _write_json(GATE_REPORT, report)
    print(f"retrain gate: {report['decision']} ({report.get('reason', '')}); report {GATE_REPORT}")
    return 0 if report["decision"] in FINISHED_DECISIONS else 1


def run_gate(log, no_promote: bool = False, ensemble: list[str] | None = None) -> dict:
    ensemble = ensemble or []
    report = {"startedAt": _now_iso(), "criteria": [f"{s} {m}" for s, m, _ in CRITERIA],
              "dryRun": no_promote, "ensembleArguments": ensemble, "phaseSeconds": {}}
    report["resultsThroughRaceId"] = _latest_results_race_id()
    _log(log, "retrain gate started" + (" (no promote)" if no_promote else ""))
    phase_started = time.monotonic()
    _rebuild_fastf1_tables(log)
    _phase_done(log, report, "fastf1Tables", phase_started)
    current = _read_json(paths.MODELS_DIR / "latest.json")
    report["currentModel"] = current["version"] if current else None
    current_backtest = _read_json(paths.PREDICTIONS_DIR / "backtest.json")

    with file_lock(REFRESH_LOCK, REFRESH_LOCK_WAIT_S, purpose="retrain gate: train"):
        phase_started = time.monotonic()
        _run(log, "ml", "f1ml.features")
        _phase_done(log, report, "features", phase_started)
        phase_started = time.monotonic()
        _run(log, "ml", "f1ml.train", *ensemble)
        _phase_done(log, report, "train", phase_started)
        candidate = _read_json(paths.MODELS_DIR / "latest.json")
        if current:
            _write_json(paths.MODELS_DIR / "latest.json", current)
    report["candidateModel"] = candidate["version"]
    _log(log, f"candidate {candidate['version']} trained; current model {report['currentModel']} stays live")

    staging = STAGING_DIR / candidate["version"]
    if staging.exists():
        shutil.rmtree(staging)
    script = str(Path(__file__).resolve())
    staging_text = str(staging)
    command = [sys.executable, script, "--backtest-into", staging_text, *ensemble]
    phase_started = time.monotonic()
    _run_command(log, command, ML_DIR)
    _phase_done(log, report, "backtest", phase_started)
    candidate_backtest = _read_json(staging / "predictions" / "backtest.json")

    comparison = compare_backtests(current_backtest, candidate_backtest)
    report["comparison"] = comparison
    if no_promote:
        verdict = "promote" if comparison["better_or_equal"] else "reject"
        report["decision"] = f"would {verdict}"
        worse_text = ", ".join(comparison["worse"]) or "nothing"
        report["reason"] = f"dry run (--no-promote); worse on: {worse_text}"
        _log(log, f"dry run: would {verdict}; {report['currentModel']} stays, nothing promoted")
    elif comparison["better_or_equal"]:
        promote(log, candidate, staging)
        report["decision"] = "promoted"
        report["reason"] = "candidate is not worse on every criterion"
    else:
        report["decision"] = "rejected"
        report["reason"] = "worse on " + ", ".join(comparison["worse"])
        _log(log, f"rejected: {report['reason']}; keeping {report['currentModel']}")
    report["finishedAt"] = _now_iso()
    return report


def run_staged_backtest(staging: Path, ensemble: list[str]) -> int:
    """Child process: f1ml.backtest with every output redirected into `staging`."""
    predictions = staging / "predictions"
    paths.PREDICTIONS_DIR = predictions
    paths.HISTORY_DIR = predictions / "history"
    paths.REPORTS_DIR = staging / "reports"
    for folder in (paths.PREDICTIONS_DIR, paths.HISTORY_DIR, paths.REPORTS_DIR):
        folder.mkdir(parents=True, exist_ok=True)
    from f1ml import backtest

    sys.argv = ["f1ml.backtest", *ensemble]
    backtest.main()
    return 0


def compare_backtests(current: dict | None, candidate: dict) -> dict:
    """Mean metrics over the races both backtests cover, and which criteria got worse."""
    if not current:
        return {"better_or_equal": True, "worse": [], "races": 0, "note": "no current backtest"}
    current_races = {race["raceId"]: race for race in current["races"]}
    candidate_races = {race["raceId"]: race for race in candidate["races"]}
    current_ids = set(current_races)
    candidate_ids = set(candidate_races)
    common = sorted(current_ids & candidate_ids)
    rows = []
    worse = []
    for stage, metric, direction in CRITERIA:
        before = _mean_metric(current_races, common, stage, metric)
        after = _mean_metric(candidate_races, common, stage, metric)
        delta = after - before
        regressed = direction * delta < -EPSILON
        if regressed:
            worse.append(f"{stage} {metric}")
        row = {"stage": stage, "metric": metric, "current": round(before, 5),
               "candidate": round(after, 5), "delta": round(delta, 5), "worse": regressed}
        rows.append(row)
    return {"better_or_equal": not worse, "worse": worse, "races": len(common), "metrics": rows}


def promote(log, candidate: dict, staging: Path) -> None:
    with file_lock(REFRESH_LOCK, REFRESH_LOCK_WAIT_S, purpose="retrain gate: promote"):
        _write_json(paths.MODELS_DIR / "latest.json", candidate)
        staged_predictions = staging / "predictions"
        shutil.copy2(staged_predictions / "backtest.json", paths.PREDICTIONS_DIR / "backtest.json")
        for history_file in sorted((staged_predictions / "history").glob("*.json")):
            shutil.copy2(history_file, paths.HISTORY_DIR / history_file.name)
        for report_file in sorted((staging / "reports").glob("backtest_*")):
            shutil.copy2(report_file, paths.REPORTS_DIR / report_file.name)
        _log(log, f"promoted {candidate['version']}; running f1ml.predict")
        _run(log, "ml", "f1ml.predict")


def not_due_reason() -> str:
    """Why the gate should not run now, or "" when there are results the model has not seen."""
    if _bulk_download_running():
        return "the FastF1 bulk download process is still running"
    latest = _latest_results_race_id()
    trained_through = _trained_through_race_id()
    if trained_through >= latest:
        return f"the model is up to date (trained through {trained_through})"
    previous = _read_json(GATE_REPORT) or {}
    finished = previous.get("decision") in ("promoted", "rejected")
    if finished and previous.get("resultsThroughRaceId") == latest:
        return f"already ran for {latest} on {previous.get('finishedAt')} ({previous.get('decision')})"
    return ""


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------


def _phase_done(log, report: dict, name: str, started: float) -> None:
    seconds = round(time.monotonic() - started, 1)
    report["phaseSeconds"][name] = seconds
    _log(log, f"phase {name}: {seconds:.0f}s")


def _mean_metric(races: dict, race_ids: list[int], stage: str, metric: str) -> float:
    values = [races[race_id]["stages"][stage][metric] for race_id in race_ids]
    return sum(values) / len(values) if values else 0.0


def _rebuild_fastf1_tables(log) -> None:
    laps_path = paths.processed("ff1_laps")
    built_at = laps_path.stat().st_mtime if laps_path.exists() else 0.0
    fastf1_root = paths.RAW_DIR / "fastf1"
    newer = [meta for meta in fastf1_root.glob("*/*/meta.json") if meta.stat().st_mtime > built_at]
    if not newer:
        _log(log, "ff1 tables are up to date")
        return
    count = len(newer)
    _log(log, f"{count} FastF1 sessions are newer than ff1_laps: rebuilding the tables")
    _run(log, "pipeline", "f1p.fastf1.build_tables")


def _latest_results_race_id() -> int:
    import pandas as pd

    results = pd.read_parquet(paths.processed("results"), columns=["raceId"])
    return int(results["raceId"].max())


def _trained_through_race_id() -> int:
    latest = _read_json(paths.MODELS_DIR / "latest.json")
    if not latest:
        return 0
    meta_path = ML_DIR / latest["path"] / "meta.json"
    meta = _read_json(meta_path) or {}
    return int(meta.get("trainedThroughRaceId", 0))


def _bulk_download_running() -> bool:
    running = pipeline_processes("f1p.fastf1.download")
    return bool(running)


def _ensemble_arguments(args: argparse.Namespace) -> list[str]:
    """--seed / --gbm-bags / --nn-seeds as given, to pass on to f1ml.train and the backtest."""
    arguments = ["--seed", str(args.seed)]
    if args.gbm_bags:
        arguments += ["--gbm-bags", str(args.gbm_bags)]
    if args.nn_seeds:
        arguments += ["--nn-seeds", str(args.nn_seeds)]
    return arguments


def _run(log, project: str, module: str, *extra: str) -> None:
    venv = V2_DIR / project / ".venv"
    python = venv / "Scripts" / "python.exe" if os.name == "nt" else venv / "bin" / "python"
    command = [str(python), "-m", module, *extra]
    cwd = V2_DIR / project
    _run_command(log, command, cwd)


def _run_command(log, command: list[str], cwd: Path) -> None:
    command_text = " ".join(command)
    _log(log, "$ " + command_text)
    env = dict(os.environ, PYTHONIOENCODING="utf-8", PYTHONUNBUFFERED="1")
    process = subprocess.Popen(command, cwd=cwd, env=env, stdout=subprocess.PIPE,
                               stderr=subprocess.STDOUT, text=True, encoding="utf-8",
                               errors="replace")
    for line in process.stdout:
        text = line.rstrip()
        _log(log, f"  {text}")
    exit_code = process.wait()
    if exit_code != 0:
        tail = " ".join(command[-2:])
        raise RuntimeError(f"{tail} exited {exit_code}")


def _log(log, text: str) -> None:
    stamp = datetime.now().strftime("%H:%M:%S")
    log.write(f"{stamp} {text}\n")
    log.flush()
    print(text, flush=True)


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
    text = json.dumps(payload, indent=2, default=str)
    temp_path.write_text(text, encoding="utf-8")
    temp_path.replace(path)


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--when-due", action="store_true",
                        help="only run when results are newer than the current model (scheduled task)")
    parser.add_argument("--no-promote", action="store_true",
                        help="dry run: train, backtest and compare, but never promote or forecast")
    parser.add_argument("--seed", type=int, default=0, help="seed block for training and backtest")
    parser.add_argument("--gbm-bags", type=int, help="XGBoost rankers averaged per model")
    parser.add_argument("--nn-seeds", type=int, help="set transformer networks averaged")
    parser.add_argument("--backtest-into", help=argparse.SUPPRESS)
    return parser.parse_args()


if __name__ == "__main__":
    sys.exit(main())
