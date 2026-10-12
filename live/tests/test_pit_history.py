from f1live import messages
from f1live.decode import FeedMessage
from f1live.state import SessionState

ORIGIN = 1_000_000


def _t(utc: int) -> int:
    return utc - ORIGIN


def _state_after_two_stops() -> SessionState:
    state = SessionState()
    state.apply(FeedMessage("TimingAppData", {"Lines": {"81": {"Stints": [{"Compound": "SOFT"}]}}}, ORIGIN))
    # Box time arrives first, the new stint a few seconds later.
    state.apply(FeedMessage("PitLaneTimeCollection", {"PitTimes": {"81": {"Duration": "22.1", "Lap": "12"}}}, ORIGIN + 500_000))
    state.apply(FeedMessage("TimingAppData", {"Lines": {"81": {"Stints": {"1": {"Compound": "HARD"}}}}}, ORIGIN + 504_000))
    # A second stop much later on lap 30, tyre change recorded without a box time.
    state.apply(FeedMessage("TimingData", {"Lines": {"81": {"NumberOfLaps": 29}}}, ORIGIN + 1_990_000))
    state.apply(FeedMessage("TimingAppData", {"Lines": {"81": {"Stints": {"2": {"Compound": "MEDIUM"}}}}}, ORIGIN + 2_000_000))
    return state


def test_pit_history_pairs_box_times_with_tyre_changes_oldest_first():
    state = _state_after_two_stops()
    history = messages.build_pit_history(state, _t(ORIGIN + 2_500_000), _t)
    assert history["type"] == "pitHistory"
    assert [stop["t"] for stop in history["stops"]] == [500_000, 2_000_000]
    first, second = history["stops"]
    assert first == {"t": 500_000, "number": 81, "duration": 22.1, "lap": 12, "compound": "HARD", "previous": "SOFT"}
    assert second["duration"] is None and second["compound"] == "MEDIUM" and second["previous"] == "HARD"
    assert second["lap"] == 30


def test_a_tyre_swap_on_the_grid_is_not_a_pit_stop():
    state = SessionState()
    state.apply(FeedMessage("TimingAppData", {"Lines": {"4": {"Stints": [{"Compound": "INTERMEDIATE"}]}}}, ORIGIN))
    state.apply(FeedMessage("TimingAppData", {"Lines": {"4": {"Stints": {"1": {"Compound": "MEDIUM"}}}}}, ORIGIN + 60_000))
    history = messages.build_pit_history(state, _t(ORIGIN + 120_000), _t)
    assert history["stops"] == []


def test_a_stint_entry_without_a_tyre_change_or_box_time_is_not_a_stop():
    state = SessionState()
    state.apply(FeedMessage("TimingAppData", {"Lines": {"1": {"Stints": [{"Compound": "INTERMEDIATE"}]}}}, ORIGIN))
    state.apply(FeedMessage("TimingAppData", {"Lines": {"1": {"Stints": {"1": {"Compound": "INTERMEDIATE", "TyresNotChanged": "1"}}}}}, ORIGIN + 1000))
    history = messages.build_pit_history(state, _t(ORIGIN + 2000), _t)
    assert history["stops"] == []


def test_history_is_complete_after_a_seek_that_skipped_the_live_notices():
    # Replaying up to a point drains the notices, but the state still remembers every stop.
    state = _state_after_two_stops()
    notices = state.apply(FeedMessage("WeatherData", {"AirTemp": "30"}, ORIGIN + 2_600_000))
    assert all(notice.kind != "pitStop" for notice in notices)
    history = messages.build_pit_history(state, _t(ORIGIN + 2_600_000), _t)
    assert len(history["stops"]) == 2
