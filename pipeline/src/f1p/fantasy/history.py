"""Download historical F1 Fantasy data from public archives (past seasons).

Sources (see data/raw/fantasy/README.md for licences):

- mzafram2001/f1-fantasy (GitHub, MIT): one JSON per round for 2023 onwards with
  price, round points, qualifying/sprint/race points and selection % per asset.
- EduardoFAFernandes/F1FantasyData (GitHub, GPL-3.0): hourly price snapshots of
  the previous game for 2021 (partial) and 2022.
- Internet Archive Wayback Machine: snapshots of the official
  feeds/drivers/<gameday>_en.json feed for 2023 to 2025 (season cumulative stat
  breakdowns, session points, prices), whatever was archived.
"""

import argparse
import json

from f1p.fantasy.http import get_bytes, get_json, save_bytes
from f1p.paths import raw_dir

MZAFRAM_REPO = "mzafram2001/f1-fantasy"
EDUARDO_REPO = "EduardoFAFernandes/F1FantasyData"
WAYBACK_CDX = "https://web.archive.org/cdx/search/cdx"
WAYBACK_FEED_PATTERN = "fantasy.formula1.com/feeds/drivers/*"
WAYBACK_SEASONS = (2023, 2024, 2025)


def fetch_all(refresh_current: bool = False) -> dict:
    """Download every historical source; existing files are skipped (idempotent)."""
    summary = {
        "mzafram": fetch_mzafram(refresh_current),
        "eduardo": fetch_eduardo(),
        "wayback": fetch_wayback_driver_feeds(),
    }
    return summary


def fetch_mzafram(refresh_current: bool = False) -> int:
    """Round files of mzafram2001/f1-fantasy; returns the number of files on disk."""
    out = raw_dir("fantasy") / "community" / "mzafram2001_f1-fantasy"
    tree = _github_tree(MZAFRAM_REPO)
    paths = [p for p in tree if p.startswith("data/") and p.endswith(".json")]
    newest_season = max(int(p.split("/")[1]) for p in paths)
    for path in paths:
        season = int(path.split("/")[1])
        target = out / path.removeprefix("data/")
        if target.exists() and not (refresh_current and season == newest_season):
            continue
        url = _raw_url(MZAFRAM_REPO, path)
        body = get_bytes(url)
        if body is not None:
            save_bytes(target, body)
    _save_licence(MZAFRAM_REPO, "LICENSE.md", out)
    return len(list(out.rglob("round_*.json")))


def fetch_eduardo() -> int:
    """2021 and 2022 hourly price snapshots (old game); returns files on disk."""
    out = raw_dir("fantasy") / "community" / "EduardoFAFernandes_F1FantasyData"
    for season in (2021, 2022):
        for name in ("prices.csv", "README.md"):
            target = out / str(season) / name
            if target.exists():
                continue
            url = _raw_url(EDUARDO_REPO, f"{season}/{name}")
            body = get_bytes(url)
            if body is not None:
                save_bytes(target, body)
    _save_licence(EDUARDO_REPO, "LICENSE", out)
    return len(list(out.rglob("prices.csv")))


def fetch_wayback_driver_feeds() -> int:
    """Wayback snapshots of the official per-gameday feed for past seasons."""
    out = raw_dir("fantasy") / "wayback"
    params = {
        "url": WAYBACK_FEED_PATTERN,
        "output": "json",
        "fl": "timestamp,original,statuscode",
        "filter": "statuscode:200",
    }
    rows = get_json(WAYBACK_CDX, params) or []
    snapshots = rows[1:]
    index_path = out / "cdx_index.json"
    out.mkdir(parents=True, exist_ok=True)
    index_text = json.dumps(snapshots, indent=0)
    index_path.write_text(index_text, encoding="utf-8")

    saved = 0
    for timestamp, original, _status in snapshots:
        season = int(timestamp[:4])
        if season not in WAYBACK_SEASONS:
            continue
        gameday = _gameday_from_feed_url(original)
        if gameday is None:
            continue
        target = out / str(season) / f"gd_{gameday:02d}_{timestamp}.json"
        if target.exists():
            saved += 1
            continue
        body = get_bytes(f"https://web.archive.org/web/{timestamp}id_/{original}")
        if body is None or not body.lstrip().startswith(b"{"):
            continue
        save_bytes(target, body)
        saved += 1
    return saved


def _github_tree(repo: str) -> list[str]:
    url = f"https://api.github.com/repos/{repo}/git/trees/HEAD"
    payload = get_json(url, {"recursive": "1"})
    blobs = [item["path"] for item in payload["tree"] if item["type"] == "blob"]
    return blobs


def _raw_url(repo: str, path: str) -> str:
    return f"https://raw.githubusercontent.com/{repo}/HEAD/{path}"


def _save_licence(repo: str, name: str, out) -> None:
    target = out / name
    if target.exists():
        return
    url = _raw_url(repo, name)
    body = get_bytes(url)
    if body is not None:
        save_bytes(target, body)


def _gameday_from_feed_url(url: str) -> int | None:
    """'.../feeds/drivers/10_en.json?buster=...' -> 10."""
    name = url.split("/feeds/drivers/")[-1].split("?")[0]
    head = name.split("_")[0]
    if not head.isdigit():
        return None
    return int(head)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--refresh-current", action="store_true",
                        help="re-download the newest season of the community archive")
    args = parser.parse_args()
    summary = fetch_all(refresh_current=args.refresh_current)
    print(summary)


if __name__ == "__main__":
    main()
