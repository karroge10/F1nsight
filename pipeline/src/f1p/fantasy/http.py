"""Small polite HTTP helper shared by the fantasy downloaders."""

import json
import time
from pathlib import Path

import httpx

USER_AGENT = "f1nsight research pipeline (public data only)"
REQUEST_PAUSE_S = 0.35
MAX_ATTEMPTS = 4

_client: httpx.Client | None = None


def get_bytes(url: str, params: dict | None = None) -> bytes | None:
    """GET a URL and return the body, or None on 403/404 (feed does not exist)."""
    client = _get_client()
    for attempt in range(MAX_ATTEMPTS):
        time.sleep(REQUEST_PAUSE_S)
        try:
            response = client.get(url, params=params)
        except httpx.HTTPError:
            _backoff(attempt)
            continue
        if response.status_code in (403, 404):
            return None
        if response.status_code == 429 or response.status_code >= 500:
            _backoff(attempt)
            continue
        response.raise_for_status()
        return response.content
    raise RuntimeError(f"giving up on {url}")


def get_json(url: str, params: dict | None = None):
    """GET a URL and parse JSON, or None when the feed does not exist."""
    body = get_bytes(url, params)
    if body is None:
        return None
    return json.loads(body)


def save_json(path: Path, payload) -> None:
    """Write JSON atomically (tmp file then rename) so partial files never appear."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    text = json.dumps(payload, ensure_ascii=False, indent=1)
    tmp.write_text(text, encoding="utf-8")
    tmp.replace(path)


def save_bytes(path: Path, body: bytes) -> None:
    """Write raw bytes atomically."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_bytes(body)
    tmp.replace(path)


def _get_client() -> httpx.Client:
    global _client
    if _client is None:
        headers = {"User-Agent": USER_AGENT, "Accept": "application/json, text/plain, */*"}
        _client = httpx.Client(headers=headers, timeout=60, follow_redirects=True)
    return _client


def _backoff(attempt: int) -> None:
    time.sleep(2 ** (attempt + 1))
