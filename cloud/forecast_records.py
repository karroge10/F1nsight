import argparse
import hashlib
import json
import math
import os
import shutil
import sqlite3
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
STAGES = ("pre-weekend", "post-practice", "post-qualifying")


def now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def timestamp(value):
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        raise ValueError("timestamp must include a timezone")
    return parsed


def read(path):
    return json.loads(path.read_text(encoding="utf-8"))


def write(path, payload):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(payload, ensure_ascii=False, indent=2, allow_nan=False), encoding="utf-8")
    temporary.replace(path)


def digest(payload):
    content = json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False)
    return hashlib.sha256(content.encode("utf-8")).hexdigest()


def forecast_path():
    return ROOT / "data/predictions/next.json"


def identity(payload):
    return {"generated-at": payload["generatedAt"], "model": payload["model"]["version"],
            "race": f"{payload['race']['season']}-{payload['race']['round']}",
            "stage": payload["race"]["stage"]}


def prepare():
    payload = read(forecast_path())
    identity(payload)
    write(ROOT / "site/public/forecast.json", payload)
    for path in (ROOT / "data/reports").glob("published-forecasts.*"):
        destination = ROOT / "site/public/reports" / path.name
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(path, destination)


def check_build():
    def local_fetch(url):
        route = urllib.parse.urlsplit(url).path.strip("/") or "index.html"
        return (ROOT / "site/out" / route).read_text(encoding="utf-8")
    check_site("https://export.invalid", read(forecast_path()), local_fetch)
    print("built home page and forecast JSON match the current forecast")


class ForecastMarker(HTMLParser):
    def __init__(self):
        super().__init__()
        self.markers = []

    def handle_starttag(self, tag, attrs):
        values = dict(attrs)
        if values.get("id") == "forecast-publication":
            self.markers.append({key: values.get("data-forecast-" + key) for key in
                                 ("generated-at", "model", "race", "stage")})


def fetch(url):
    request = urllib.request.Request(url, headers={"Cache-Control": "no-cache", "User-Agent": "f1nsight-verification"})
    with urllib.request.urlopen(request, timeout=30) as response:
        return response.read().decode("utf-8")


def check_site(base_url, payload, fetcher=fetch):
    parsed = urllib.parse.urlsplit(base_url)
    if parsed.scheme != "https" or not parsed.netloc or parsed.query or parsed.fragment:
        raise ValueError("publication URL must be an HTTPS origin")
    query = "?forecast=" + digest(payload)
    remote = json.loads(fetcher(base_url.rstrip("/") + "/forecast.json" + query))
    if digest(remote) != digest(payload):
        raise ValueError("deployed forecast differs from the forecast being published")
    parser = ForecastMarker()
    parser.feed(fetcher(base_url.rstrip("/") + "/" + query))
    if parser.markers != [identity(payload)]:
        raise ValueError("home page race, stage, model or forecast timestamp differs")


def verify(base_url, attempts=5, fetcher=fetch, sleeper=time.sleep):
    payload = read(forecast_path())
    for attempt in range(attempts):
        try:
            check_site(base_url, payload, fetcher)
            break
        except (OSError, ValueError) as error:
            if attempt + 1 == attempts:
                raise
            print(f"publication verification attempt {attempt + 1}: {error}")
            sleeper(10)
    race = payload["race"]
    record_id = digest(payload)
    path = ROOT / "data/published" / f"{race['season']}-{race['round']:02d}" / f"{record_id}.json"
    if not path.exists():
        record = {"schemaVersion": 1, "forecastHash": record_id, "verifiedAt": now(),
                  "siteUrl": base_url, "runUrl": run_url(), "forecast": payload}
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("x", encoding="utf-8") as stream:
            json.dump(record, stream, ensure_ascii=False, indent=2, allow_nan=False)
    receipt = {"forecastHash": record_id, "verifiedAt": now(), "siteUrl": base_url}
    write(ROOT / "logs/publication-verified.json", receipt)
    print(f"verified and archived {race['season']} R{race['round']} {race['stage']} {record_id[:12]}")
    return path


def run_url():
    repository = os.environ.get("GITHUB_REPOSITORY")
    run_id = os.environ.get("GITHUB_RUN_ID")
    return f"https://github.com/{repository}/actions/runs/{run_id}" if repository and run_id else None


def probabilities(values, ids):
    if not isinstance(values, dict) or set(values) != set(ids):
        return None
    numbers = [values[key] for key in ids]
    if any(not isinstance(value, (int, float)) or not math.isfinite(value) or value < 0 or value > 1
           for value in numbers):
        return None
    total = sum(numbers)
    if not math.isclose(total, 1, abs_tol=0.005):
        return None
    return {key: values[key] / total for key in ids}


def score(values, winner, ids):
    values = probabilities(values, ids)
    if values is None or winner not in values:
        return None
    chance = values[winner]
    return {"winnerProbability": chance, "logLoss": -math.log(max(chance, 1e-15)),
            "brier": sum((value - int(key == winner)) ** 2 for key, value in values.items()),
            "topPick": max(values, key=values.get), "winnerCorrect": max(values, key=values.get) == winner}


def evaluate(records, results):
    reports = []
    for race_id, actual in sorted(results.items()):
        winner = next((row["driverId"] for row in actual if row["position"] == 1), None)
        if winner is None:
            continue
        eligible = []
        excluded = []
        for record in records:
            payload = record["forecast"]
            race = payload["race"]
            if race["season"] * 100 + race["round"] != race_id:
                continue
            try:
                cutoff = timestamp(race["date"])
            except ValueError:
                excluded.append({"forecastHash": record["forecastHash"], "reason": "unknown-race-start"})
                continue
            if timestamp(record["verifiedAt"]) >= cutoff or timestamp(payload["generatedAt"]) >= cutoff:
                continue
            if record["forecastHash"] != digest(payload):
                raise ValueError("published forecast archive failed its hash check")
            eligible.append(record)
        stages = {}
        for stage in STAGES:
            candidates = [record for record in eligible if record["forecast"]["race"]["stage"] == stage]
            if not candidates:
                continue
            selected = max(candidates, key=lambda item: timestamp(item["verifiedAt"]))
            payload = selected["forecast"]
            ids = [row["driverId"] for row in payload["drivers"]]
            if set(ids) != {row["driverId"] for row in actual}:
                continue
            sources = payload.get("probabilitySources", {})
            published = {row["driverId"]: row["pWin"] for row in payload["drivers"]}
            stages[stage] = {"forecastHash": selected["forecastHash"], "verifiedAt": selected["verifiedAt"],
                             "generatedAt": payload["generatedAt"], "model": payload["model"]["version"],
                             "inputsUsed": payload["race"]["inputsUsed"],
                             "scores": {"model": score(sources.get("model"), winner, ids),
                                        "market": score(sources.get("market"), winner, ids),
                                        "published": score(published, winner, ids)}}
        reports.append({"raceId": race_id, "winner": winner, "stages": stages, "excludedForecasts": excluded,
                        "status": "scored" if stages else "no-published-pre-race-forecast"})
    return reports


def aggregate(reports):
    summary = {}
    for stage in STAGES:
        rows = [report["stages"][stage]["scores"] for report in reports if stage in report["stages"]]
        paired = [row for row in rows if all(row[source] is not None for source in ("model", "market", "published"))]
        summary[stage] = {"races": len(rows), "pairedRaces": len(paired), "sources": {}}
        for source in ("model", "market", "published"):
            values = [row[source] for row in paired]
            summary[stage]["sources"][source] = {
                metric: sum(value[metric] for value in values) / len(values) if values else None
                for metric in ("logLoss", "brier", "winnerCorrect")}
    return summary


def load_results():
    path = ROOT / "data/serve/f1.sqlite"
    with sqlite3.connect(path.as_uri() + "?mode=ro", uri=True) as connection:
        connection.row_factory = sqlite3.Row
        rows = connection.execute('SELECT raceId, driverId, COALESCE(position, positionOrder) AS position FROM results').fetchall()
    results = {}
    for row in rows:
        results.setdefault(int(row["raceId"]), []).append({"driverId": row["driverId"], "position": int(row["position"])})
    return results


def markdown(report):
    lines = ["# Published forecast results", "", f"Generated: {report['generatedAt']}", "",
             "Only verified forecasts published before the race start are scored. Backtests are excluded.", "",
             "Brier score is the sum across the full winner field. Lower Brier and log loss are better.", ""]
    for race in report["races"]:
        lines += [f"## {race['raceId']} | winner: {race['winner']}", ""]
        if not race["stages"]:
            lines += ["No verified pre-race forecast is available.", ""]
        if race.get("excludedForecasts"):
            lines += [f"Excluded {len(race['excludedForecasts'])} snapshots without a timezone-aware race start.", ""]
        for stage, value in race["stages"].items():
            lines += [f"### {stage}", "", f"Model: {value['model']}. Published: {value['verifiedAt']}.", "",
                      "| Source | Winner chance | Log loss | Brier |", "| --- | ---: | ---: | ---: |"]
            for source, metrics in value["scores"].items():
                lines.append(f"| {source} | unavailable | | |" if metrics is None else
                             f"| {source} | {metrics['winnerProbability']:.1%} | {metrics['logLoss']:.4f} | {metrics['brier']:.4f} |")
            lines.append("")
    lines += ["## Comparison across races", "", "All three sources use the same races for each stage.", ""]
    for stage, group in report["aggregate"].items():
        lines += [f"### {stage}: {group['pairedRaces']} comparable races", ""]
        for source, metrics in group["sources"].items():
            if metrics["logLoss"] is not None:
                lines.append(f"- {source}: log loss {metrics['logLoss']:.4f}, Brier {metrics['brier']:.4f}, winner accuracy {metrics['winnerCorrect']:.1%}")
        lines.append("")
    return "\n".join(lines)


def report():
    records = [read(path) for path in sorted((ROOT / "data/published").glob("*/*.json"))]
    results = load_results()
    seasons = {datetime.now(timezone.utc).year} | {item["forecast"]["race"]["season"] for item in records}
    results = {key: value for key, value in results.items() if key // 100 in seasons}
    races = evaluate(records, results)
    payload = {"schemaVersion": 1, "generatedAt": now(), "races": races, "aggregate": aggregate(races)}
    gate_path = ROOT / "ml/reports/retrain_gate.json"
    if gate_path.exists():
        gate = read(gate_path)
        payload["retrain"] = {key: gate.get(key) for key in
                              ("resultsThroughRaceId", "decision", "candidateModel", "reason", "finishedAt")}
    folder = ROOT / "data/reports"
    write(folder / "published-forecasts.json", payload)
    text = markdown(payload)
    (folder / "published-forecasts.md").write_text(text, encoding="utf-8")
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as stream:
            stream.write(text + "\n")
    print(f"race report: {len(races)} completed races, {sum(bool(race['stages']) for race in races)} with published forecasts")
    return payload


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=("prepare", "check-build", "verify", "report"))
    parser.add_argument("--url", default="https://f1nsight.pages.dev")
    args = parser.parse_args()
    if args.command == "prepare":
        prepare()
    elif args.command == "check-build":
        check_build()
    elif args.command == "verify":
        verify(args.url)
    else:
        report()


if __name__ == "__main__":
    main()
