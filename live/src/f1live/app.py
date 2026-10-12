"""FastAPI service: GET /status, GET /sessions, WS /ws/live, WS /ws/replay."""

import asyncio
import contextlib
import logging
import time
from contextlib import asynccontextmanager

import httpx
import orjson
from fastapi import FastAPI, HTTPException, Query, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from f1live import config
from f1live.decode import now_ms
from f1live.archive import ArchiveClient
from f1live.hub import LiveHub, SimulationOptions
from f1live.reference_source import ReferenceSource
from f1live.replay import RecordingCache, ReplayPlayer, tick_interval
from f1live.schedule import Schedule

log = logging.getLogger(__name__)


def create_app(simulation: SimulationOptions | None = None) -> FastAPI:
    @asynccontextmanager
    async def lifespan(app: FastAPI):
        http = httpx.AsyncClient(timeout=30.0, headers={"User-Agent": config.USER_AGENT}, follow_redirects=True)
        archive = ArchiveClient()
        app.state.http = http
        app.state.archive = archive
        app.state.schedule = Schedule(http, archive)
        app.state.recordings = RecordingCache(archive, http)
        app.state.references = ReferenceSource(archive)
        app.state.hub = LiveHub(http, archive, simulation, app.state.references)
        if simulation:
            await app.state.hub.start()
        yield
        await app.state.hub.stop()
        await archive.close()
        await http.aclose()

    app = FastAPI(title="F1 live relay", version="0.1.0", lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=config.CORS_ORIGINS,
        allow_origin_regex=config.CORS_ORIGIN_REGEX,
        allow_methods=["GET"],
        allow_headers=["*"],
    )

    @app.get("/status")
    async def status() -> dict:
        hub: LiveHub = app.state.hub
        result = await app.state.schedule.status()
        result["simulated"] = hub.simulation is not None
        if hub.sim_feed is not None:
            result["live"] = True
            result["session"] = hub.sim_feed.session.as_dict()
        result["hub"] = hub.status()
        return result

    @app.get("/sessions")
    async def sessions(season: int = Query(..., ge=2018, le=2100)) -> dict:
        try:
            listed = await app.state.archive.list_sessions(season)
        except httpx.HTTPStatusError as error:
            raise HTTPException(404, f"no archive index for {season}") from error
        now = now_ms()
        items = []
        for session in listed:
            if session.end_utc > now:
                continue
            item = session.as_dict()
            item["replay"] = None
            if session.round is not None:
                item["replay"] = f"/ws/replay?season={session.season}&round={session.round}&session={session.code}"
            items.append(item)
        return {"season": season, "sessions": items}

    @app.get("/health")
    async def health() -> dict:
        return {"ok": True}

    @app.websocket("/ws/live")
    async def ws_live(socket: WebSocket) -> None:
        await socket.accept()
        hub: LiveHub = app.state.hub
        try:
            client = await hub.subscribe()
        except Exception as error:
            log.exception("live hub failed to start")
            await _send_error(socket, error)
            await socket.close()
            return
        pumping = _pump(socket, client.queue)
        sender = asyncio.create_task(pumping)
        try:
            while True:
                await socket.receive_text()
        except WebSocketDisconnect:
            pass
        finally:
            hub.unsubscribe(client)
            sender.cancel()

    @app.websocket("/ws/replay")
    async def ws_replay(
        socket: WebSocket,
        season: int,
        round: int,
        session: str = "R",
        speed: float = 1.0,
        start: int | None = None,
        positions: str = "official",
    ) -> None:
        await socket.accept()
        await _send(socket, {"type": "loading", "season": season, "round": round, "session": session})
        try:
            recording = await app.state.recordings.get(season, round, session)
            reference = None
            if positions == "estimated":
                reference = await _estimate_reference(app.state.references, recording.session)
        except (LookupError, httpx.HTTPError) as error:
            await _send_error(socket, error)
            await socket.close()
            return
        player = ReplayPlayer(recording, speed=speed, start_t=start, estimate_with=reference)
        commands: asyncio.Queue[dict] = asyncio.Queue()
        reading = _read_commands(socket, commands)
        reader = asyncio.create_task(reading)
        interval = tick_interval()
        try:
            for message in player.start():
                await _send(socket, message)
            next_tick = time.perf_counter()
            while not reader.done():
                while not commands.empty():
                    command = commands.get_nowait()
                    for message in player.command(command):
                        await _send(socket, message)
                for message in player.tick():
                    await _send(socket, message)
                next_tick += interval
                remaining = next_tick - time.perf_counter()
                delay = max(0.0, remaining)
                await asyncio.sleep(delay)
        except (WebSocketDisconnect, RuntimeError):
            pass
        finally:
            reader.cancel()

    return app


async def _estimate_reference(references: ReferenceSource, session):
    """A reference from sessions before this one at the circuit (never the replayed session)."""
    reference = await references.best(
        session.circuit_key, session.season, session.start_utc, exclude_path=session.path
    )
    if reference is None:
        raise LookupError(f"no earlier session at circuit {session.circuit_key} to estimate positions from")
    return reference


async def _pump(socket: WebSocket, queue: asyncio.Queue) -> None:
    with contextlib.suppress(WebSocketDisconnect, RuntimeError):
        while True:
            text = await queue.get()
            await socket.send_text(text)


async def _read_commands(socket: WebSocket, commands: asyncio.Queue) -> None:
    with contextlib.suppress(WebSocketDisconnect, RuntimeError):
        while True:
            text = await socket.receive_text()
            try:
                command = orjson.loads(text)
            except orjson.JSONDecodeError:
                continue
            if isinstance(command, dict):
                commands.put_nowait(command)


async def _send(socket: WebSocket, message: dict) -> None:
    text = orjson.dumps(message).decode()
    await socket.send_text(text)


async def _send_error(socket: WebSocket, error: Exception) -> None:
    message = {"type": "error", "message": str(error)}
    await _send(socket, message)
