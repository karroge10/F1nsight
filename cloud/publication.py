import argparse
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
STATE = ROOT / "logs" / "publication.json"


def read(path):
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}


def model_version():
    model = read(ROOT / "ml" / "models" / "latest.json")
    return model.get("version") or model.get("path", "").replace("\\", "/").split("/")[-1]


def needed():
    state = read(STATE)
    return bool(state.get("pending") or state.get("model") != model_version())


def update(pending):
    state = read(STATE)
    state["pending"] = pending
    if not pending:
        forecast = read(ROOT / "data" / "predictions" / "next.json")
        state["model"] = forecast.get("model", {}).get("version")
    STATE.parent.mkdir(parents=True, exist_ok=True)
    STATE.write_text(json.dumps(state, indent=1), encoding="utf-8")


def retry_prediction():
    path = ROOT / "logs" / "refresh_state.json"
    state = read(path)
    state.setdefault("predict", {}).pop("fingerprint", None)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(state, indent=1), encoding="utf-8")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=["needed", "start", "finish", "retry"])
    args = parser.parse_args()
    if args.command == "needed":
        print("true" if needed() else "false")
    elif args.command == "retry":
        retry_prediction()
    else:
        update(args.command == "start")
