"""Filesystem locations shared by every f1ml module (see SPEC.md)."""

from pathlib import Path

ML_DIR = Path(__file__).resolve().parents[1]
ROOT_DIR = ML_DIR.parent
DATA_DIR = ROOT_DIR / "data"
RAW_DIR = DATA_DIR / "raw"
PROCESSED_DIR = DATA_DIR / "processed"
PREDICTIONS_DIR = DATA_DIR / "predictions"
HISTORY_DIR = PREDICTIONS_DIR / "history"
PIPELINE_SRC = ROOT_DIR / "pipeline" / "src"
F1DB_ROOT = RAW_DIR / "f1db"
FANTASY_RAW = RAW_DIR / "fantasy"
CACHE_DIR = ML_DIR / "cache"
MODELS_DIR = ML_DIR / "models"
REPORTS_DIR = ML_DIR / "reports"
FEATURES_PATH = CACHE_DIR / "features.parquet"
EVENTS_PATH = CACHE_DIR / "events.parquet"
PARAMS_PATH = MODELS_DIR / "params.json"


def processed(name: str) -> Path:
    return PROCESSED_DIR / f"{name}.parquet"


def ensure_dirs() -> None:
    for path in (CACHE_DIR, MODELS_DIR, REPORTS_DIR, PREDICTIONS_DIR, HISTORY_DIR):
        path.mkdir(parents=True, exist_ok=True)
