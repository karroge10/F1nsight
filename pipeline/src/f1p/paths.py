"""Shared filesystem locations for the pipeline (see v2/SPEC.md)."""

from pathlib import Path

V2_DIR = Path(__file__).resolve().parents[3]
DATA_DIR = V2_DIR / "data"
RAW_DIR = DATA_DIR / "raw"
PROCESSED_DIR = DATA_DIR / "processed"
SERVE_DIR = DATA_DIR / "serve"
PREDICTIONS_DIR = DATA_DIR / "predictions"
FASTF1_CACHE_DIR = DATA_DIR / "fastf1_cache"


def raw_dir(source: str) -> Path:
    """Return data/raw/<source>, creating it if needed."""
    path = RAW_DIR / source
    path.mkdir(parents=True, exist_ok=True)
    return path


def processed_path(name: str) -> Path:
    """Return data/processed/<name>.parquet, creating the folder if needed."""
    PROCESSED_DIR.mkdir(parents=True, exist_ok=True)
    return PROCESSED_DIR / f"{name}.parquet"
