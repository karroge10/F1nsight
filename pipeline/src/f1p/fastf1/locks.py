"""Coordination between FastF1 processes that share data/raw/fastf1 and data/processed/ff1_*.

Three things can run at the same time: the long bulk download (`f1p.fastf1.download`), the
post-session incremental download (`f1p.fastf1.incremental`, started by the refresh) and a table
rebuild (`f1p.fastf1.build_tables`). Rules:

- `exclusive_lock(name)`: a lock file `data/raw/fastf1/<name>.lock` holding the owner's pid.
  build_tables takes `build_tables`, so two rebuilds never write the same parquet files.
- `session_claim(ref)`: a per-session lock file next to the session folder, so the bulk and the
  incremental download never load and write the same session at once.
- `fastf1_processes()`: other running FastF1 pipeline processes by command line, which also
  finds a bulk download started before these locks existed.
"""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

from f1p.fastf1.common import SessionRef, fastf1_root, session_dir
from f1p.locks import file_lock, pipeline_processes, release, try_create


@contextmanager
def exclusive_lock(name: str, wait_s: float = 0) -> Iterator[Path]:
    """Hold data/raw/fastf1/<name>.lock; wait up to wait_s for another live owner to finish."""
    path = fastf1_root() / f"{name}.lock"
    with file_lock(path, wait_s, purpose=name):
        yield path


@contextmanager
def session_claim(ref: SessionRef) -> Iterator[bool]:
    """Claim one session folder. Yields False (and claims nothing) if a live process holds it."""
    folder = session_dir(ref)
    path = folder.with_name(f"{folder.name}.lock")
    claimed = try_create(path, {"purpose": "session", "session": ref.key})
    try:
        yield claimed
    finally:
        if claimed:
            release(path)


def fastf1_processes(module: str = "f1p.fastf1.") -> list[dict]:
    """Running processes (other than this one) whose command line runs a FastF1 pipeline module."""
    return pipeline_processes(module)
