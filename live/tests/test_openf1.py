from f1live.engine import SessionEngine
from f1live.openf1 import location_rows_to_message

ROWS = [
    {"date": "2026-10-04T07:30:00.136000+00:00", "driver_number": 1, "x": 1000, "y": -900, "z": 410},
    {"date": "2026-10-04T07:30:00.396000+00:00", "driver_number": 1, "x": 1100, "y": -900, "z": 410},
    {"date": "2026-10-04T07:30:00.200000+00:00", "driver_number": 44, "x": 0, "y": 0, "z": 0},
]


def test_openf1_rows_become_a_position_message_the_engine_interpolates():
    message = location_rows_to_message(ROWS)
    assert message.topic == "Position"
    engine = SessionEngine("live")
    engine.ingest(message)
    midway = message.utc - 130
    frame = engine.frame_message(midway)
    cars = {car["number"]: car for car in frame["cars"]}
    # Car 44 sent the (0, 0, 0) "no signal" sample and must not be drawn.
    assert set(cars) == {1}
    assert cars[1]["x"] == 1050 and cars[1]["y"] == -900
