"""Small WebSocket client: connect, record for a while, print message rates and samples.

  uv run python scripts/ws_client.py ws://127.0.0.1:8765/ws/live --seconds 20
  uv run python scripts/ws_client.py "ws://127.0.0.1:8765/ws/replay?season=2026&round=16&session=R&speed=4" \
      --seconds 20 --command '{"cmd":"seek","t":3600000}@8' --command '{"cmd":"speed","value":16}@12'
"""

import argparse
import asyncio
import json
import time
from collections import Counter

import websockets


def main() -> None:
    args = parse_args()
    asyncio.run(record(args.url, args.seconds, args.command, args.sample_chars))


async def record(url: str, seconds: float, commands: list[str], sample_chars: int) -> None:
    counts: Counter[str] = Counter()
    sizes: Counter[str] = Counter()
    samples: dict[str, str] = {}
    first_at: dict[str, float] = {}
    scheduled = [_parse_command(raw) for raw in commands]
    started = time.perf_counter()
    async with websockets.connect(url, max_size=None) as socket:
        while (elapsed := time.perf_counter() - started) < seconds:
            due = [item for item in scheduled if item[1] <= elapsed]
            for item in due:
                await socket.send(item[0])
                print(f"[{elapsed:5.1f}s] sent {item[0]}")
                scheduled.remove(item)
            try:
                text = await asyncio.wait_for(socket.recv(), 0.5)
            except TimeoutError:
                continue
            message = json.loads(text)
            kind = message.get("type", "?")
            counts[kind] += 1
            sizes[kind] += len(text)
            first_at.setdefault(kind, elapsed)
            if kind not in samples or kind in ("playback", "trackStatus"):
                samples[kind] = text[:sample_chars]
            if kind in ("playback", "trackStatus", "error", "loading"):
                print(f"[{elapsed:5.1f}s] {text[:200]}")
    duration = time.perf_counter() - started
    print(f"\n{sum(counts.values())} messages in {duration:.1f}s")
    for kind, count in counts.most_common():
        rate = count / duration
        average = sizes[kind] / count
        print(f"  {kind:12s} {count:6d}  {rate:6.2f}/s  avg {average:7.0f} bytes  first at {first_at[kind]:.1f}s")
    print("\nsamples:")
    for kind, text in samples.items():
        print(f"--- {kind}\n{text}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("url")
    parser.add_argument("--seconds", type=float, default=15)
    parser.add_argument("--command", action="append", default=[], help="JSON command @ seconds after connect")
    parser.add_argument("--sample-chars", type=int, default=700)
    return parser.parse_args()


def _parse_command(raw: str) -> tuple[str, float]:
    body, _, at = raw.rpartition("@")
    return body, float(at)


if __name__ == "__main__":
    main()
