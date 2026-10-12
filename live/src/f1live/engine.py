"""SessionEngine: the single place where feed messages become outgoing WebSocket messages.

Live, simulated live and replay all drive the same engine:
  ingest(message)  apply one decoded feed message (timing topics, positions, car data)
  tick(now_utc)    collect what to send now: discrete events, timing (if changed), a map frame
  snapshot(now)    everything a newly connected client needs to draw the current state
"""

from f1live import config, messages
from f1live.decode import FeedMessage
from f1live.estimator import PositionEstimator
from f1live.state import Notice, SessionState
from f1live.stores import PositionStore, TelemetryStore

# Where frame positions come from (init.positionsSource, frame.source).
OFFICIAL = "official"
OFFICIAL_DELAYED = "official-delayed"
ESTIMATED = "estimated"


class SessionEngine:
    def __init__(
        self,
        mode: str,
        render_delay_ms: int = 0,
        positions: PositionStore | None = None,
        telemetry: TelemetryStore | None = None,
        estimator: PositionEstimator | None = None,
    ) -> None:
        self.mode = mode
        self.render_delay_ms = render_delay_ms
        # Replay hands over fully loaded stores; live fills them as messages arrive.
        self.preloaded = positions is not None
        self.positions = positions or PositionStore()
        self.telemetry = telemetry or TelemetryStore()
        self.state = SessionState()
        # Fallbacks when the feed has no car positions: positions reconstructed from timing, and
        # the static archive's Position stream of the running session (set by the live hub).
        self.estimator = estimator
        self.delayed = None
        self.positions_source: str | None = None
        self.track: dict | None = None
        self.timeline: dict | None = None
        self.sources: dict = {"timing": None, "positions": None}
        self.origin: int | None = None
        self._outbox: list[dict] = []
        self._timing_dirty = False
        self._init_dirty = False
        self._tick_count = 0
        self._driver_numbers: frozenset = frozenset()

    def ingest(self, message: FeedMessage, replace: bool = False) -> None:
        if message.topic == "Position":
            if not self.preloaded:
                self.positions.add_message(message.data)
            return
        if message.topic == "CarData":
            if not self.preloaded:
                self.telemetry.add_message(message.data)
            return
        if self.origin is None:
            self.origin = message.utc
        if self.estimator is not None:
            self.estimator.ingest(message, replace=replace)
        notices = self.state.apply(message, replace=replace)
        for notice in notices:
            self._handle_notice(notice)

    def tick(self, now_utc: int) -> list[dict]:
        """Messages to send at wall/session time `now_utc` (one call per output tick)."""
        out = []
        self._update_positions_source(now_utc)
        if self._init_dirty:
            init = self.init_message()
            out.append(init)
            self._init_dirty = False
        out.extend(self._outbox)
        self._outbox.clear()
        self._tick_count += 1
        if self._timing_dirty and self._tick_count % config.TIMING_EVERY_TICKS == 0:
            timing = self.timing_message(now_utc)
            out.append(timing)
            self._timing_dirty = False
        frame = self.frame_message(now_utc - self.render_delay_ms)
        out.append(frame)
        return out

    def snapshot(self, now_utc: int) -> list[dict]:
        """Full state for a client that just connected (or after a replay seek)."""
        t = self.t(now_utc)
        self._update_positions_source(now_utc)
        rc_messages = self.state.race_control_messages()
        init = self.init_message()
        timing = self.timing_message(now_utc)
        track_status = messages.build_track_status(self.state, t)
        weather = messages.build_weather(self.state, t)
        race_control = messages.build_race_control(rc_messages, t, history=True)
        pit_history = messages.build_pit_history(self.state, t, self.t)
        frame = self.frame_message(now_utc - self.render_delay_ms)
        return [init, timing, track_status, weather, race_control, pit_history, frame]

    def drain(self) -> None:
        """Forget queued output (used after silently fast-forwarding a replay)."""
        self._outbox.clear()
        self._init_dirty = False
        self._timing_dirty = False

    def refresh_init(self) -> None:
        """Send a new init with the next tick (sources or the estimator reference changed)."""
        self._init_dirty = True

    def set_track(self, track: dict | None) -> None:
        self.track = track
        self._init_dirty = True

    def init_message(self) -> dict:
        sources = dict(self.sources)
        source = self.positions_source
        sources["positionsAvailable"] = source is not None
        sources["positionsSource"] = source
        if self.estimator is not None:
            sources["estimator"] = self.estimator.describe()
        if self.delayed is not None:
            sources["delayed"] = self.delayed.describe()
        return messages.build_init(
            self.state, self.origin or 0, self.mode, self.track, sources, self.timeline, source
        )

    def timing_message(self, now_utc: int) -> dict:
        t = self.t(now_utc)
        return messages.build_timing(self.state, t, now_utc, self.telemetry)

    def frame_message(self, render_utc: int) -> dict:
        """Car positions at `render_utc`, from the best available source."""
        source = self.positions_source
        if source == ESTIMATED:
            return self._estimated_frame(render_utc)
        if source == OFFICIAL_DELAYED:
            now = render_utc + self.render_delay_ms
            lag = self.delayed.render_lag_ms(now)
            shown = now - lag
            return self._recorded_frame(self.delayed.store, shown, OFFICIAL_DELAYED)
        return self._recorded_frame(self.positions, render_utc, source)

    def choose_positions_source(self, now_utc: int) -> str | None:
        """official if the feed has fresh positions, else the delayed archive stream when it is
        close enough to live, else the estimate from timing."""
        render_utc = now_utc - self.render_delay_ms
        if self.positions.has_data():
            fresh = self.positions.latest_utc() >= render_utc - config.OFFICIAL_FRESH_MS
            if self.preloaded or fresh:
                return OFFICIAL
        if self.delayed is not None and self.delayed.can_replace(now_utc):
            return OFFICIAL_DELAYED
        if self.estimator is not None and self.estimator.ready:
            return ESTIMATED
        return None

    def _recorded_frame(self, store: PositionStore, render_utc: int, source: str | None) -> dict:
        lines = self.state.timing_lines()
        numbers = set(self.state.drivers()) or set(store.numbers())
        cars = []
        for number in sorted(numbers, key=_number_key):
            sample = store.sample(number, render_utc)
            if sample is None:
                continue
            line = lines.get(number, {})
            telemetry = self.telemetry.at(number, render_utc)
            status = _car_status(line, sample.status, sample.age_ms)
            cars.append({
                "number": int(number),
                "x": round(sample.x),
                "y": round(sample.y),
                "status": status,
                "speed": telemetry[0] if telemetry else None,
            })
        return {"type": "frame", "t": self.t(render_utc), "source": source, "cars": cars}

    def _estimated_frame(self, render_utc: int) -> dict:
        lines = self.state.timing_lines()
        numbers = set(self.state.drivers()) or set(self.estimator.numbers())
        cars = []
        for number in sorted(numbers, key=_number_key):
            sample = self.estimator.sample(number, render_utc)
            if sample is None:
                continue
            line = lines.get(number, {})
            status = _car_status(line, "OnTrack", 0)
            if status == "onTrack" and sample.status in ("pit", "stopped", "retired"):
                status = sample.status
            cars.append({
                "number": int(number),
                "x": round(sample.x),
                "y": round(sample.y),
                "status": status,
                "speed": None,
            })
        return {"type": "frame", "t": self.t(render_utc), "source": ESTIMATED, "cars": cars}

    def t(self, utc: int) -> int:
        return utc - (self.origin or 0)

    def _update_positions_source(self, now_utc: int) -> None:
        source = self.choose_positions_source(now_utc)
        if source != self.positions_source:
            self.positions_source = source
            self._init_dirty = True

    def _handle_notice(self, notice: Notice) -> None:
        kind = notice.kind
        if kind == "timing":
            self._timing_dirty = True
        elif kind == "session":
            self._update_origin()
            self._init_dirty = True
        elif kind == "drivers":
            numbers = frozenset(self.state.drivers())
            if numbers != self._driver_numbers:
                self._driver_numbers = numbers
                self._init_dirty = True
        else:
            message = self._event_message(notice)
            if message is not None:
                self._outbox.append(message)
            if kind == "pitStop":
                self._timing_dirty = True

    def _event_message(self, notice: Notice) -> dict | None:
        t = self.t(notice.utc)
        kind = notice.kind
        if kind == "trackStatus":
            return messages.build_track_status(self.state, t)
        if kind == "weather":
            return messages.build_weather(self.state, t)
        if kind == "raceControl":
            return messages.build_race_control(notice.payload, t)
        if kind == "pitStop":
            return messages.build_pit_stop(notice.payload, t)
        if kind == "tyreChange":
            return messages.build_tyre_change(notice.payload, t)
        return None

    def _update_origin(self) -> None:
        start = self.state.session_start_utc()
        if start:
            self.origin = start


def _car_status(line: dict, position_status: str, age_ms: int) -> str:
    if line.get("Retired"):
        return "retired"
    if line.get("Stopped"):
        return "stopped"
    if line.get("InPit"):
        return "pit"
    if age_ms > config.STALE_AFTER_MS:
        return "stale"
    if position_status != "OnTrack":
        return "offTrack"
    return "onTrack"


def _number_key(number: str) -> int:
    return int(number) if number.isdigit() else 999
