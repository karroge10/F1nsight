"""Grid penalty detection: FIA decision text, the documents page, race control and the merge.

    uv run --no-sync --with pytest python -m pytest tests -q      (from pipeline)
"""

from __future__ import annotations

import pandas as pd

from f1p.penalties import fia, race_control, update

# Text as pypdf extracts it from 2026 Singapore Doc 20 (shortened).
SINGAPORE_DOC_20 = """2026 SINGAPORE GRAND PRIX
09 - 11 October 2026
From The Stewards
To The Team Manager,
Mercedes-AMG PETRONAS F1 Team
Document 20
The Stewards, having received a report from the Technical Delegate (document 19), have
considered the following matter and determine the following:
No / Driver 63 - George Russell
Competitor Mercedes-AMG PETRONAS F1 Team
Time 18:20
Fact The following Power Unit elements have been used:
5th Engine (ICE)
Infringement Breaches of Articles B8.2.2 (read with B8.2.3) of the FIA F1 Regulations.
Decision Drop of 40 grid positions in the next Race in which the driver participates.
Reason The penalty is imposed in accordance with Article B8.2.8 of the FIA F1 Regulations.
Decisions of the Stewards are taken independently of the FIA."""

SUMMONS = """No / Driver 44 - Lewis Hamilton
Reason Alleged breach of Appendix H, Article 2.5.5 b) of the International Sporting Code"""

NO_PENALTY = """No / Driver 3 - Max Verstappen
Session Sprint Qualifying
Fact Car 3 overtook Car 44 under single yellow flags.
Decision No penalty is applied.
Reason The Stewards heard from the driver."""

LISTING_2026 = """<li class="document-row key-20">  <a href="/system/files/decision-document/doc20.pdf" download>
<div class="title">
  Doc 20 - Infringement - Car 63 - Changes to PU elements
  </div>
  <div class="published">
  Published on <span class="date-display-single">09.10.26 14:03</span> CET  </div></a></li>"""

LISTING_2025 = """<li class="document-row key-70">
<div class="panelizer-view-mode node"><a href="/system/files/decision-document/doc70.pdf" download>
<div class="title"><div class="field-item even">Doc 70 - Championship Points</div></div></div>
<div class="panel-separator"></div><div class="published"><div class="field">
Published on <span>30.11.25 21:10</span> CET</div></div></a></li>"""


def test_decision_field_gives_the_penalty_kind_and_size():
    assert fia.classify_decision("Drop of 40 grid positions in the next Race.") == ("places", 40)
    assert fia.classify_decision("5 place grid penalty.") == ("places", 5)
    assert fia.classify_decision("Three-place grid drop for the Sprint.") == ("places", 3)
    assert fia.classify_decision("Required to start the Sprint from the pit lane.") == ("pit_lane", None)
    assert fia.classify_decision("Required to start from the back of the grid.") == ("back_of_grid", None)
    assert fia.classify_decision("No penalty is applied.") is None
    assert fia.classify_decision("Reprimand (driving). 10 second time penalty.") is None
    assert fia.classify_decision("5 place grid penalty, suspended for 12 months.") is None


def test_session_of_a_penalty():
    assert fia.applies_to_session("Drop of 3 grid positions for the Sprint.", "Sprint Qualifying") == "sprint"
    assert fia.applies_to_session("Drop of 40 grid positions in the next Race.", "") == "race"
    assert fia.applies_to_session("3 place grid penalty.", "Sprint Qualifying") == "sprint"
    assert fia.applies_to_session("3 place grid penalty.", "Qualifying") == "race"


def test_singapore_power_unit_decision_is_read():
    document = fia.Document(20, "Infringement - Car 63 - Changes to PU elements", "u", None)
    decisions = fia.parse_decisions(SINGAPORE_DOC_20, document)
    assert len(decisions) == 1
    decision = decisions[0]
    assert (decision.car_number, decision.kind, decision.places) == (63, "places", 40)
    assert decision.applies_to == "race"
    assert decision.category == "power_unit"
    assert decision.next_event is True
    assert fia.superseded_numbers(SINGAPORE_DOC_20) == []


def test_summons_and_no_penalty_documents_give_nothing():
    document = fia.Document(21, "Summons - Car 44", "u", None)
    assert fia.parse_decisions(SUMMONS, document) == []
    assert fia.parse_decisions(NO_PENALTY, document) == []


def test_superseding_documents():
    text = "This decision supersedes Document 20.\nDecision Drop of 30 grid positions."
    assert fia.superseded_numbers(text) == [20]
    text = "Document 31 is hereby withdrawn."
    assert fia.superseded_numbers(text) == [31]
    first = fia.Document(20, "Infringement - Car 63 - PU elements", "a", None)
    later = fia.Document(25, "Infringement - Car 63 - PU elements (Corrected)", "b", None)
    other = fia.Document(26, "Infringement - Car 3 - PU elements", "c", None)
    assert fia._corrected_titles([first, other, later]) == {20}


def test_documents_page_in_both_markups():
    rows = fia.parse_listing(LISTING_2026)
    assert rows[0].number == 20
    assert rows[0].title == "Infringement - Car 63 - Changes to PU elements"
    assert rows[0].url.endswith("/doc20.pdf")
    assert rows[0].published_utc == "2026-10-09T12:03+00:00"
    old = fia.parse_listing(LISTING_2025)
    assert (old[0].number, old[0].title) == (70, "Championship Points")
    assert old[0].published_utc == "2025-11-30T20:10+00:00"


def test_event_name_matching():
    events = {"São Paulo Grand Prix": "/sp", "Singapore Grand Prix": "/sg",
              "Bahrain Grand Prix in Malaysia": "/bm"}
    assert fia.match_event(events, "Singapore Grand Prix") == "/sg"
    assert fia.match_event(events, "Sao Paulo Grand Prix") == "/sp"
    assert fia.match_event(events, "Bahrain Grand Prix") == "/bm"


def test_race_control_messages():
    parsed = race_control.parse_message("FIA STEWARDS: 5 PLACE GRID PENALTY FOR CAR 3 (VER) - CAUSING A COLLISION")
    assert parsed == {"carNumber": 3, "kind": "places", "places": 5, "appliesTo": "race"}
    parsed = race_control.parse_message("CAR 44 (HAM) TO START THE SPRINT FROM THE PIT LANE")
    assert parsed["kind"] == "pit_lane" and parsed["appliesTo"] == "sprint"
    assert race_control.parse_message("FIA STEWARDS: 5 PLACE GRID PENALTY FOR CAR 3 UNDER INVESTIGATION") is None
    assert race_control.parse_message("5 SECOND TIME PENALTY FOR CAR 31 (OCO) - INACCURATE GRID POSITION") is None
    assert race_control.parse_message("YELLOW IN PIT LANE") is None


def test_manual_wins_and_race_control_only_fills_gaps():
    race = pd.Series({"season": 2026, "round": 17, "raceUtc": pd.Timestamp("2026-10-11 12:00")})
    fia_row = update._row(race, "russell", 63, "places", 40, "power_unit", "race", "fia", 20,
                          "PU", None, "", "Drop of 40", None)
    duplicate = update._row(race, "russell", 63, "places", 10, "other", "race", "race_control",
                            None, "msg", None, "Q", "msg", None)
    control = update._row(race, "max_verstappen", 3, "places", 5, "other", "race", "race_control",
                          None, "msg", None, "Q", "msg", None)
    manual = {**update._row(race, "max_verstappen", 3, "none", None, "other", "race", "manual",
                            None, "cleared", None, None, "cleared", None)}
    table = update.combine([fia_row], [duplicate, control], [], race)
    assert table[["driverId", "source"]].values.tolist() == [["max_verstappen", "race_control"],
                                                             ["russell", "fia"]]
    table = update.combine([fia_row], [duplicate, control], [manual], race)
    assert table["driverId"].tolist() == ["russell"]


def test_next_race_decisions_move_to_the_following_event():
    document = fia.Document(51, "Infringement - Car 5 - Causing a collision", "u",
                            "2025-11-23T05:41+00:00")
    race_decision = fia.Decision(5, "x", "places", 5, "race", "other", "Race", True, document, "")
    assert update._for_following_event(race_decision, "2025-11-23T04:00+00:00") is True
    power_unit = fia.Decision(63, "x", "places", 40, "race", "power_unit", "", True,
                              fia.Document(20, "PU", "u", "2026-10-09T12:03+00:00"), "")
    assert update._for_following_event(power_unit, "2026-10-11T12:00+00:00") is False


def test_following_races_are_the_next_ones_in_order():
    races = pd.DataFrame({"round": [3, 1, 4, 2, 5],
                          "raceUtc": pd.to_datetime(["2026-03-29", "2026-03-08", "2026-05-03",
                                                     "2026-03-15", "2026-05-24"])})
    race = races[races["round"] == 2].iloc[0]
    following = update.following_races(races, race, 2)
    assert [int(record["round"]) for record in following] == [3, 4]
