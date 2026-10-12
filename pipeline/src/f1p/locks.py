"""Pid-owned lock files shared by the pipeline entry points (refresh, FastF1 tables, ...).

A lock is a file created with O_EXCL that holds the owner's pid. A lock whose pid is no longer
running is stale and is taken over, so a crashed run never blocks the next one.
"""

from __future__ import annotations

import ctypes
import json
import os
import subprocess
import time
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

POLL_S = 5
_PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
_STILL_ACTIVE = 259


class LockBusy(RuntimeError):
    """Raised when a lock is still held by a live process after the wait time."""


@contextmanager
def file_lock(path: Path, wait_s: float = 0, **info) -> Iterator[Path]:
    """Hold the lock file at `path`; wait up to wait_s for a live owner to let go."""
    deadline = time.monotonic() + wait_s
    while not try_create(path, info):
        if time.monotonic() >= deadline:
            owner = read_owner(path)
            owner_pid = owner.get("pid")
            owner_since = owner.get("since")
            raise LockBusy(f"{path.name} is held by pid {owner_pid} since {owner_since}")
        time.sleep(POLL_S)
    try:
        yield path
    finally:
        release(path)


def pipeline_processes(module: str) -> list[dict]:
    """Running Python processes (other than this one) whose command line contains `module`."""
    script = (
        "Get-CimInstance Win32_Process -Filter \"Name like 'python%'\" | "
        "Select-Object ProcessId, CommandLine | ConvertTo-Json -Compress"
    )
    command = ["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", script]
    try:
        completed = subprocess.run(command, capture_output=True, text=True, timeout=60, check=False)
    except (OSError, subprocess.TimeoutExpired):
        return []
    output = completed.stdout.strip()
    if not output:
        return []
    rows = json.loads(output)
    if isinstance(rows, dict):
        rows = [rows]
    own_pids = {os.getpid(), os.getppid()}
    found = []
    for row in rows:
        command_line = row.get("CommandLine") or ""
        if module not in command_line or row["ProcessId"] in own_pids:
            continue
        found.append({"pid": row["ProcessId"], "command": command_line})
    return _drop_launchers(found, module)


def try_create(path: Path, info: dict) -> bool:
    """Create the lock file atomically; take it over if its owner is dead. False if held."""
    path.parent.mkdir(parents=True, exist_ok=True)
    since = datetime.now(timezone.utc).isoformat(timespec="seconds")
    pid = os.getpid()
    payload = dict(info, pid=pid, since=since)
    text = json.dumps(payload)
    for _ in range(2):
        try:
            descriptor = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
        except FileExistsError:
            owner = read_owner(path)
            owner_text = owner.get("pid") or 0
            owner_pid = int(owner_text)
            if pid_alive(owner_pid):
                return False
            release(path)
            continue
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            handle.write(text)
        return True
    return False


def release(path: Path) -> None:
    try:
        path.unlink()
    except FileNotFoundError:
        pass


def read_owner(path: Path) -> dict:
    try:
        text = path.read_text(encoding="utf-8")
        return json.loads(text)
    except (OSError, ValueError):
        return {}


def pid_alive(pid: int) -> bool:
    """True if a process with this pid is running (Windows API, never signals the process)."""
    if pid <= 0:
        return False
    kernel32 = ctypes.windll.kernel32
    handle = kernel32.OpenProcess(_PROCESS_QUERY_LIMITED_INFORMATION, False, pid)
    if not handle:
        return False
    try:
        exit_code = ctypes.c_ulong()
        exit_code_ref = ctypes.byref(exit_code)
        ok = kernel32.GetExitCodeProcess(handle, exit_code_ref)
        return bool(ok) and exit_code.value == _STILL_ACTIVE
    finally:
        kernel32.CloseHandle(handle)


def _drop_launchers(found: list[dict], module: str) -> list[dict]:
    """uv starts a venv shim which starts the real interpreter: keep one row per command."""
    by_command: dict[str, dict] = {}
    for row in found:
        command_line = row["command"]
        start = command_line.find(module)
        key = command_line[start:]
        by_command.setdefault(key, row)
    unique = by_command.values()
    return list(unique)
