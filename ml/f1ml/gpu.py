"""Sample GPU utilisation with nvidia-smi while a block of work runs."""

from __future__ import annotations

import subprocess
import threading
import time

QUERY = ["nvidia-smi", "--query-gpu=utilization.gpu,memory.used",
         "--format=csv,noheader,nounits"]


class GpuMonitor:
    """Context manager: `with GpuMonitor() as monitor: ...`, then `monitor.summary()`."""

    def __init__(self, interval: float = 1.0):
        self.interval = interval
        self.samples: list[tuple[float, float]] = []
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._run, daemon=True)
        self.started = 0.0
        self.elapsed = 0.0

    def __enter__(self) -> "GpuMonitor":
        self.started = time.time()
        self._thread.start()
        return self

    def __exit__(self, *exc) -> None:
        self._stop.set()
        self._thread.join(timeout=5)
        self.elapsed = time.time() - self.started

    def summary(self) -> dict:
        if not self.samples:
            return {"seconds": round(self.elapsed, 1), "samples": 0}
        utilisation = [s[0] for s in self.samples]
        memory = [s[1] for s in self.samples]
        busy = [u for u in utilisation if u > 5]
        return {
            "seconds": round(self.elapsed, 1),
            "samples": len(self.samples),
            "meanUtilisationPct": round(sum(utilisation) / len(utilisation), 1),
            "meanBusyUtilisationPct": round(sum(busy) / len(busy), 1) if busy else 0.0,
            "busyShare": round(len(busy) / len(utilisation), 3),
            "maxUtilisationPct": max(utilisation),
            "maxMemoryMiB": max(memory),
        }

    def _run(self) -> None:
        while not self._stop.is_set():
            sample = _sample()
            if sample is not None:
                self.samples.append(sample)
            self._stop.wait(self.interval)


def _sample() -> tuple[float, float] | None:
    try:
        output = subprocess.run(QUERY, capture_output=True, text=True, timeout=5).stdout
    except (OSError, subprocess.TimeoutExpired):
        return None
    first_line = output.strip().splitlines()[0] if output.strip() else ""
    parts = [part.strip() for part in first_line.split(",")]
    if len(parts) != 2:
        return None
    return float(parts[0]), float(parts[1])
