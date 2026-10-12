from f1live.decode import FeedMessage
from f1live.merge import deep_merge
from f1live.state import SessionState


def test_nested_dicts_merge_and_untouched_keys_survive():
    state = {"Lines": {"1": {"Position": "1", "GapToLeader": "", "InPit": False}}}
    deep_merge(state, {"Lines": {"1": {"GapToLeader": "+1.2"}, "44": {"Position": "2"}}})
    assert state == {
        "Lines": {"1": {"Position": "1", "GapToLeader": "+1.2", "InPit": False}, "44": {"Position": "2"}}
    }


def test_index_keyed_delta_patches_a_list():
    state = {"Sectors": [{"Value": "28.1"}, {"Value": ""}, {"Value": ""}]}
    deep_merge(state, {"Sectors": {"1": {"Value": "33.4", "PersonalFastest": True}}})
    assert state["Sectors"][0] == {"Value": "28.1"}
    assert state["Sectors"][1] == {"Value": "33.4", "PersonalFastest": True}


def test_index_keyed_delta_grows_a_list():
    state = {"Stints": [{"Compound": "SOFT", "TotalLaps": 12}]}
    deep_merge(state, {"Stints": {"1": {"Compound": "HARD", "TotalLaps": 0}}})
    assert [stint["Compound"] for stint in state["Stints"]] == ["SOFT", "HARD"]
    deep_merge(state, {"Stints": {"1": {"TotalLaps": 3}}})
    assert state["Stints"][1] == {"Compound": "HARD", "TotalLaps": 3}


def test_deleted_keys_are_removed():
    state = {"PitTimes": {"11": {"Duration": "22.1"}, "4": {"Duration": "23.0"}}}
    deep_merge(state, {"PitTimes": {"_deleted": ["11"]}})
    assert state == {"PitTimes": {"4": {"Duration": "23.0"}}}


def test_state_never_aliases_message_data():
    delta = {"Lines": {"1": {"Sectors": [{"Value": "1"}]}}}
    state: dict = {}
    deep_merge(state, delta)
    deep_merge(state, {"Lines": {"1": {"Sectors": {"0": {"Value": "2"}}}}})
    assert delta == {"Lines": {"1": {"Sectors": [{"Value": "1"}]}}}


def test_session_state_reports_new_race_control_messages_once():
    state = SessionState()
    first = state.apply(FeedMessage("RaceControlMessages", {"Messages": [{"Message": "GREEN LIGHT"}]}, 1))
    second = state.apply(FeedMessage("RaceControlMessages", {"Messages": {"1": {"Message": "SAFETY CAR DEPLOYED"}}}, 2))
    assert [notice.payload[0]["Message"] for notice in first if notice.kind == "raceControl"] == ["GREEN LIGHT"]
    assert [notice.payload[0]["Message"] for notice in second if notice.kind == "raceControl"] == [
        "SAFETY CAR DEPLOYED"
    ]
    assert len(state.race_control_messages()) == 2


def test_session_state_detects_pit_stops_and_tyre_changes():
    state = SessionState()
    state.apply(FeedMessage("TimingAppData", {"Lines": {"4": {"Stints": [{"Compound": "MEDIUM", "TotalLaps": 0}]}}}, 1))
    notices = state.apply(
        FeedMessage("TimingAppData", {"Lines": {"4": {"Stints": {"1": {"Compound": "HARD", "TotalLaps": 0}}}}}, 2)
    )
    changes = [notice.payload for notice in notices if notice.kind == "tyreChange"]
    assert changes and changes[0]["previous"] == "MEDIUM" and changes[0]["compound"] == "HARD"

    pit = {"PitTimes": {"4": {"RacingNumber": "4", "Duration": "", "Lap": "20"}}}
    assert not [n for n in state.apply(FeedMessage("PitLaneTimeCollection", pit, 3)) if n.kind == "pitStop"]
    filled = {"PitTimes": {"4": {"Duration": "22.4"}}}
    stops = [n.payload for n in state.apply(FeedMessage("PitLaneTimeCollection", filled, 4)) if n.kind == "pitStop"]
    assert stops == [{"number": "4", "duration": "22.4", "lap": "20", "utc": 4}]
    again = state.apply(FeedMessage("PitLaneTimeCollection", filled, 5))
    assert not [n for n in again if n.kind == "pitStop"]


def test_lap_marks_track_lap_completions():
    state = SessionState()
    state.apply(FeedMessage("TimingData", {"Lines": {"1": {"NumberOfLaps": 1}}}, 100))
    state.apply(FeedMessage("TimingData", {"Lines": {"1": {"NumberOfLaps": 1, "GapToLeader": "+1"}}}, 150))
    state.apply(FeedMessage("TimingData", {"Lines": {"1": {"NumberOfLaps": 2}}}, 200))
    assert [(mark.utc, mark.laps) for mark in state.lap_marks["1"]] == [(100, 1), (200, 2)]
