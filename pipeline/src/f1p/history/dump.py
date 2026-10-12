"""Download the public (14 day delayed) Jolpica-F1 CSV database dump.

The dump is only downloaded when the server advertises a file hash we do not have yet.
Each dump lives in raw/jolpica/dump/<uploaded date>_<hash prefix>/ and `current.json` points
at the one in use.
"""

from __future__ import annotations

import json
import shutil
import zipfile
from pathlib import Path

import httpx

from f1p.paths import raw_dir

DUMPS_OVERVIEW_URL = "https://api.jolpi.ca/data/dumps/download/"
DUMP_DOWNLOAD_URL = "https://api.jolpi.ca/data/dumps/download/delayed/?dump_type=csv"


def ensure_dump() -> Path:
    """Make sure the newest public CSV dump is on disk and return its csv folder."""
    dump_root = raw_dir("jolpica") / "dump"
    dump_root.mkdir(parents=True, exist_ok=True)
    current = _read_current(dump_root)
    advertised = _advertised_dump()

    if advertised is None:
        if current is None:
            raise RuntimeError("Jolpica dump overview unreachable and no dump on disk")
        print("  dump overview unreachable, keeping the dump already on disk")
        return dump_root / current["folder"] / "csv"

    if current and current["file_hash"] == advertised["file_hash"]:
        csv_dir = dump_root / current["folder"] / "csv"
        if csv_dir.exists():
            print(f"  dump {current['folder']} is current")
            return csv_dir

    folder = f"{advertised['uploaded_at'][:10]}_{advertised['file_hash'][:8]}"
    target = dump_root / folder
    print(f"  downloading Jolpica CSV dump {folder}")
    _download_and_extract(target)
    manifest = {"folder": folder, **advertised}
    current_path = dump_root / "current.json"
    manifest_text = json.dumps(manifest, indent=2)
    current_path.write_text(manifest_text, encoding="utf-8")
    _remove_old_dumps(dump_root, keep=folder)
    return target / "csv"


def current_dump_info() -> dict | None:
    dump_root = raw_dir("jolpica") / "dump"
    return _read_current(dump_root)


def _advertised_dump() -> dict | None:
    try:
        response = httpx.get(DUMPS_OVERVIEW_URL, timeout=60)
        response.raise_for_status()
    except httpx.HTTPError as error:
        print(f"  dump overview failed: {error}")
        return None
    overview = response.json()
    delayed = overview.get("delayed_dumps", {}).get("csv")
    if not delayed:
        return None
    return {
        "file_hash": delayed["file_hash"],
        "uploaded_at": delayed["uploaded_at"],
        "file_size": delayed["file_size"],
        "source_url": DUMP_DOWNLOAD_URL,
    }


def _download_and_extract(target: Path) -> None:
    target.mkdir(parents=True, exist_ok=True)
    zip_path = target / "jolpica-f1-csv.zip"
    partial_path = target / "jolpica-f1-csv.zip.part"
    with httpx.stream("GET", DUMP_DOWNLOAD_URL, follow_redirects=True, timeout=300) as response:
        response.raise_for_status()
        with partial_path.open("wb") as handle:
            for chunk in response.iter_bytes():
                handle.write(chunk)
    partial_path.replace(zip_path)
    csv_dir = target / "csv"
    if csv_dir.exists():
        shutil.rmtree(csv_dir)
    with zipfile.ZipFile(zip_path) as archive:
        archive.extractall(csv_dir)


def _read_current(dump_root: Path) -> dict | None:
    current_path = dump_root / "current.json"
    if not current_path.exists():
        return None
    text = current_path.read_text(encoding="utf-8")
    return json.loads(text)


def _remove_old_dumps(dump_root: Path, keep: str) -> None:
    for child in dump_root.iterdir():
        if child.is_dir() and child.name != keep:
            shutil.rmtree(child)
        if child.is_file() and child.suffix == ".zip":
            child.unlink()
