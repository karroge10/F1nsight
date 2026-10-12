"""F1nsight cloud state: the data a refresh needs, kept as assets of the GitHub release `state`.

    python cloud/state.py status                   # local, last pulled and remote hash per group
    python cloud/state.py pull                     # download and unpack every group
    python cloud/state.py pull --groups refresh-state,processed
    python cloud/state.py pull --skip refresh-state,processed
    python cloud/state.py push                     # upload the groups that changed since the pull
    python cloud/state.py push --groups model,predictions   # upload these if they differ (PC, after a retrain)
    python cloud/state.py push --all               # upload everything that differs (PC, the first seed)
    python cloud/state.py push --dry-run

Stdlib only plus the GitHub CLI (`gh`, logged in, or GH_TOKEN in Actions); run from anywhere.

The state is split into groups (GROUPS), each packed as one tar.gz (split into parts below the
2 GiB asset limit). A group's hash covers its file list, sizes and modification times, so an
unchanged group is never packed or uploaded again. A manifest asset, manifest-<utc time>.json,
lists the archive of every group; the newest manifest is the current state. A push uploads the
new archives first, then the new manifest, then deletes what neither of the two newest manifests
uses, so a run that is still downloading the previous state keeps its files.

Push is a merge per group: a group is uploaded only when it changed locally since the pull
(logs/cloud-state.json remembers what was pulled); every other group keeps whatever the remote
manifest has now, so a model the PC pushed during a cloud run is not overwritten by that run.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tarfile
import tempfile
from datetime import datetime, timezone
from pathlib import Path

V2_DIR = Path(__file__).resolve().parents[1]
BASELINE_PATH = V2_DIR / "logs" / "cloud-state.json"
RELEASE_TAG = "state"
RELEASE_TITLE = "Cloud refresh state"
RELEASE_NOTES = ("Data for the scheduled refresh in GitHub Actions (cloud/state.py). "
                 "Generated, do not edit.")
MANIFEST_PREFIX = "manifest-"
KEEP_MANIFESTS = 2
PART_BYTES = 1900 * 1024 * 1024
COMPRESS_LEVEL = 6
EXCLUDED_SUFFIXES = (".log", ".lock", ".tmp", ".pyc")
EXCLUDED_DIRS = ("__pycache__",)

# group name -> paths relative to v2. "model" is filled in from ml/models/latest.json.
GROUPS = {
    "refresh-state": ["logs/refresh_state.json"],
    "processed": ["data/processed"],
    "serve": ["data/serve"],
    "predictions": ["data/predictions"],
    "model": [],
    "raw-openf1": ["data/raw/openf1"],
    "raw-livetiming": ["data/raw/livetiming"],
    "raw-fastf1": ["data/raw/fastf1"],
    "raw-other": ["data/raw/f1db", "data/raw/fantasy", "data/raw/fia", "data/raw/jolpica",
                  "data/raw/openmeteo"],
}
MODEL_FILES = ["ml/models/latest.json", "ml/models/params.json",
               "ml/reports/backtest_driver_rows.parquet", "ml/reports/backtest_summary.json"]


def main() -> int:
    args = _parse_args()
    if args.command == "status":
        return status()
    selected = _group_list(args.groups)
    skipped = _group_list(args.skip) if args.skip else []
    groups = [name for name in selected if name not in skipped]
    if args.command == "pull":
        return pull(groups)
    explicit = args.all or bool(args.groups)
    return push(groups, explicit, args.dry_run)


def status() -> int:
    """One line per group: file count, size, local hash and whether it matches the remote."""
    remote = _remote_manifest() or {}
    remote_groups = remote.get("groups", {})
    baseline = _read_json(BASELINE_PATH) or {}
    print(f"remote manifest: {remote.get('name', 'none')}")
    for name in GROUPS:
        files = group_files(name)
        local_hash = group_hash(files)
        size = sum(path.stat().st_size for path in files)
        remote_entry = remote_groups.get(name, {})
        remote_hash = remote_entry.get("hash", "-")
        pulled = baseline.get(name, "-")
        state = "same" if local_hash == remote_hash else "differs"
        print(f"  {name:15s} {len(files):6d} files {size / 1e6:9.1f} MB  local {local_hash[:12]}  "
              f"pulled {pulled[:12]:12s}  remote {remote_hash[:12]:12s} {state}")
    return 0


def pull(groups: list[str]) -> int:
    """Download the selected groups of the newest manifest and unpack them over v2."""
    manifest = _remote_manifest()
    if manifest is None:
        print(f"state: release {RELEASE_TAG} has no manifest yet, nothing to pull", file=sys.stderr)
        return 1
    print(f"state: pulling {manifest['name']}")
    baseline = _read_json(BASELINE_PATH) or {}
    with tempfile.TemporaryDirectory(prefix="f1-state-") as temp:
        folder = Path(temp)
        for name in groups:
            entry = manifest["groups"].get(name)
            if entry is None:
                print(f"  {name}: not in the manifest, skipped")
                continue
            archive = _download_archive(entry, folder)
            _unpack(archive)
            archive.unlink()
            baseline[name] = entry["hash"]
            print(f"  {name}: {entry['bytes'] / 1e6:.1f} MB packed, {entry['files']} files")
    _write_json(BASELINE_PATH, baseline)
    return 0


def push(groups: list[str], explicit: bool, dry_run: bool) -> int:
    """Upload changed groups, then a new manifest; delete assets no recent manifest uses.

    `explicit` (--all or --groups): upload a group whenever it differs from the remote, even if
    it did not change here since the pull.
    """
    _ensure_release(dry_run)
    remote = _remote_manifest() or {"groups": {}}
    baseline = _read_json(BASELINE_PATH) or {}
    merged = dict(remote["groups"])
    uploads = []
    with tempfile.TemporaryDirectory(prefix="f1-state-") as temp:
        folder = Path(temp)
        for name in groups:
            files = group_files(name)
            local_hash = group_hash(files)
            remote_hash = remote["groups"].get(name, {}).get("hash")
            changed_here = explicit or baseline.get(name) != local_hash
            if not files or local_hash == remote_hash or not changed_here:
                continue
            print(f"  {name}: packing {len(files)} files")
            if dry_run:
                continue
            entry = _pack(name, files, local_hash, folder)
            _upload(entry["assets"], folder)
            merged[name] = entry
            uploads.append(name)
            baseline[name] = local_hash
    if dry_run:
        print("state: dry run, nothing uploaded")
        return 0
    if not uploads:
        print("state: nothing changed, no upload")
        return 0
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    manifest = {"name": f"{MANIFEST_PREFIX}{stamp}.json", "createdAt": stamp,
                "source": _source(), "groups": merged}
    _upload_manifest(manifest)
    _write_json(BASELINE_PATH, baseline)
    _delete_stale_assets()
    uploaded = ", ".join(uploads)
    print(f"state: pushed {manifest['name']} ({uploaded})")
    return 0


def group_files(name: str) -> list[Path]:
    """Every file of a group, sorted, without logs, locks and temporary files."""
    roots = _group_roots(name)
    files = []
    for root in roots:
        if root.is_file():
            files.append(root)
            continue
        if not root.is_dir():
            continue
        for path in root.rglob("*"):
            if path.is_file() and not _excluded(path):
                files.append(path)
    return sorted(files)


def group_hash(files: list[Path]) -> str:
    """Hash of relative paths, sizes and whole-second modification times."""
    digest = hashlib.sha256()
    for path in files:
        stat = path.stat()
        relative = path.relative_to(V2_DIR).as_posix()
        line = f"{relative}\t{stat.st_size}\t{int(stat.st_mtime)}\n"
        digest.update(line.encode("utf-8"))
    return digest.hexdigest()


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------


def _group_roots(name: str) -> list[Path]:
    if name != "model":
        return [V2_DIR / relative for relative in GROUPS[name]]
    roots = [V2_DIR / relative for relative in MODEL_FILES]
    latest = _read_json(V2_DIR / "ml" / "models" / "latest.json")
    if latest:
        folder = latest["path"].replace("\\", "/")
        roots.append(V2_DIR / "ml" / folder)
    return roots


def _excluded(path: Path) -> bool:
    if path.suffix in EXCLUDED_SUFFIXES:
        return True
    return any(part in EXCLUDED_DIRS for part in path.parts)


def _pack(name: str, files: list[Path], local_hash: str, folder: Path) -> dict:
    archive = folder / f"{name}-{local_hash[:12]}.tar.gz"
    with tarfile.open(archive, "w:gz", compresslevel=COMPRESS_LEVEL, format=tarfile.PAX_FORMAT) as tar:
        for path in files:
            relative = path.relative_to(V2_DIR).as_posix()
            tar.add(path, arcname=relative, recursive=False)
    size = archive.stat().st_size
    sha = _file_sha256(archive)
    assets = _split(archive)
    return {"hash": local_hash, "files": len(files), "bytes": size, "sha256": sha, "assets": assets}


def _split(archive: Path) -> list[str]:
    """Parts below the release asset limit; a small archive stays one asset."""
    size = archive.stat().st_size
    if size <= PART_BYTES:
        return [archive.name]
    names = []
    with archive.open("rb") as source:
        index = 0
        while True:
            chunk = source.read(PART_BYTES)
            if not chunk:
                break
            part = archive.with_name(f"{archive.name}.part{index:02d}")
            part.write_bytes(chunk)
            names.append(part.name)
            index += 1
    archive.unlink()
    return names


def _download_archive(entry: dict, folder: Path) -> Path:
    for asset in entry["assets"]:
        _gh("release", "download", RELEASE_TAG, "--pattern", asset, "--dir", str(folder), "--clobber")
    first = entry["assets"][0]
    archive_name = first.split(".part")[0]
    archive = folder / archive_name
    if len(entry["assets"]) > 1:
        with archive.open("wb") as target:
            for asset in entry["assets"]:
                part = folder / asset
                with part.open("rb") as source:
                    shutil.copyfileobj(source, target)
                part.unlink()
    sha = _file_sha256(archive)
    if sha != entry["sha256"]:
        raise SystemExit(f"state: {archive_name} is corrupt (sha256 {sha}, expected {entry['sha256']})")
    return archive


def _unpack(archive: Path) -> None:
    with tarfile.open(archive, "r:gz") as tar:
        tar.extractall(V2_DIR, filter="data")


def _upload(assets: list[str], folder: Path) -> None:
    paths = [str(folder / asset) for asset in assets]
    _gh("release", "upload", RELEASE_TAG, *paths, "--clobber")


def _upload_manifest(manifest: dict) -> None:
    with tempfile.TemporaryDirectory(prefix="f1-state-") as temp:
        path = Path(temp) / manifest["name"]
        text = json.dumps(manifest, indent=1)
        path.write_text(text, encoding="utf-8")
        _gh("release", "upload", RELEASE_TAG, str(path), "--clobber")


def _remote_manifest() -> dict | None:
    names = _manifest_names()
    if not names:
        return None
    with tempfile.TemporaryDirectory(prefix="f1-state-") as temp:
        newest = names[-1]
        _gh("release", "download", RELEASE_TAG, "--pattern", newest, "--dir", temp)
        path = Path(temp) / newest
        manifest = _read_json(path)
    manifest["name"] = newest
    return manifest


def _delete_stale_assets() -> None:
    names = _manifest_names()
    keep_manifests = names[-KEEP_MANIFESTS:]
    keep = set(keep_manifests)
    with tempfile.TemporaryDirectory(prefix="f1-state-") as temp:
        for name in keep_manifests:
            _gh("release", "download", RELEASE_TAG, "--pattern", name, "--dir", temp, "--clobber")
            path = Path(temp) / name
            manifest = _read_json(path)
            for entry in manifest["groups"].values():
                keep.update(entry["assets"])
    for asset in _asset_names():
        if asset not in keep:
            _gh("release", "delete-asset", RELEASE_TAG, asset, "--yes")


def _manifest_names() -> list[str]:
    names = _asset_names()
    manifests = [name for name in names if name.startswith(MANIFEST_PREFIX)]
    return sorted(manifests)


def _asset_names() -> list[str]:
    completed = _gh("release", "view", RELEASE_TAG, "--json", "assets", check=False)
    if completed.returncode != 0:
        return []
    payload = json.loads(completed.stdout)
    return [asset["name"] for asset in payload["assets"]]


def _ensure_release(dry_run: bool) -> None:
    exists = _gh("release", "view", RELEASE_TAG, "--json", "tagName", check=False)
    if exists.returncode == 0 or dry_run:
        return
    _gh("release", "create", RELEASE_TAG, "--title", RELEASE_TITLE, "--notes", RELEASE_NOTES,
        "--prerelease", "--latest=false")


def _gh(*arguments: str, check: bool = True) -> subprocess.CompletedProcess:
    command = ["gh", *arguments]
    completed = subprocess.run(command, cwd=V2_DIR, capture_output=True, text=True,
                               encoding="utf-8", errors="replace")
    if check and completed.returncode != 0:
        shown = " ".join(arguments[:3])
        raise SystemExit(f"state: gh {shown} failed: {completed.stderr.strip()}")
    return completed


def _source() -> str:
    run_id = os.environ.get("GITHUB_RUN_ID")
    if run_id:
        return f"actions run {run_id}"
    return "pc"


def _file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def _group_list(text: str | None) -> list[str]:
    if not text:
        return list(GROUPS)
    names = [part.strip() for part in text.split(",") if part.strip()]
    unknown = [name for name in names if name not in GROUPS]
    if unknown:
        raise SystemExit(f"unknown group(s) {unknown}; groups are {list(GROUPS)}")
    return names


def _read_json(path: Path):
    if not path.exists():
        return None
    text = path.read_text(encoding="utf-8")
    return json.loads(text)


def _write_json(path: Path, payload) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(payload, indent=1)
    path.write_text(text, encoding="utf-8")


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("command", choices=["status", "pull", "push"])
    group_names = ",".join(GROUPS)
    parser.add_argument("--groups", help=f"comma separated subset of {group_names}")
    parser.add_argument("--skip", help="comma separated groups to leave out")
    parser.add_argument("--all", action="store_true",
                        help="push: upload every group that differs from the remote, changed here or not")
    parser.add_argument("--dry-run", action="store_true", help="push: list what would be uploaded")
    return parser.parse_args()


if __name__ == "__main__":
    sys.exit(main())
