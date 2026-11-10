"""Pid-owned lock files shared by the pipeline entry points (refresh, FastF1 tables, ...).

A lock is a file created with O_EXCL that holds the owner's pid. A lock whose pid is no longer
running is stale and is taken over, so a crashed run never blocks the next one. Takeover happens
under a short-lived guard file and re-reads the owner first, so two runs that both saw the same
dead owner cannot delete each other's fresh lock.
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
# A takeover only deletes one file; a guard older than this was left by a crashed takeover.
GUARD_STALE_S = 60
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
    rows = _windows_processes() if os.name == "nt" else _posix_processes()
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
        except PermissionError:
            # Windows: another process is deleting or reading the file right now. Treat as held.
            return False
        except FileExistsError:
            owner = read_owner(path)
            if _owner_alive(owner):
                return False
            if not _remove_if_owner(path, owner):
                return False
            continue
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            handle.write(text)
        return True
    return False


def release(path: Path) -> None:
    """Delete the lock, but only if this process still owns it."""
    owner = read_owner(path)
    if owner and owner.get("pid") != os.getpid():
        return
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
    """True if a process with this pid is running (never signals the process)."""
    if pid <= 0:
        return False
    if os.name != "nt":
        return _posix_pid_alive(pid)
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


def _owner_alive(owner: dict) -> bool:
    owner_text = owner.get("pid") or 0
    owner_pid = int(owner_text)
    return pid_alive(owner_pid)


def _remove_if_owner(path: Path, seen: dict) -> bool:
    """Delete a stale lock only if it still holds the dead owner we saw. False if another run is taking it over."""
    guard = path.with_name(path.name + ".takeover")
    if not _take_guard(guard):
        return False
    try:
        current = read_owner(path)
        if current != seen or _owner_alive(current):
            return True
        try:
            path.unlink()
        except (FileNotFoundError, PermissionError):
            pass
        return True
    finally:
        try:
            guard.unlink()
        except (FileNotFoundError, PermissionError):
            pass


def _take_guard(guard: Path) -> bool:
    for _ in range(2):
        try:
            descriptor = os.open(guard, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
        except PermissionError:
            return False
        except FileExistsError:
            try:
                age = time.time() - guard.stat().st_mtime
            except (FileNotFoundError, PermissionError):
                continue
            if age < GUARD_STALE_S:
                return False
            try:
                guard.unlink()
            except (FileNotFoundError, PermissionError):
                pass
            continue
        os.close(descriptor)
        return True
    return False


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


def _windows_processes() -> list[dict]:
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
    return [rows] if isinstance(rows, dict) else rows


def _posix_processes() -> list[dict]:
    """Same rows as on Windows, from /proc (Linux, the GitHub Actions refresh)."""
    rows = []
    for folder in Path("/proc").glob("[0-9]*"):
        try:
            raw = (folder / "cmdline").read_bytes()
        except OSError:
            continue
        command_line = raw.replace(b"\x00", b" ").decode("utf-8", "replace").strip()
        if "python" in command_line:
            rows.append({"ProcessId": int(folder.name), "CommandLine": command_line})
    return rows


def _posix_pid_alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True
