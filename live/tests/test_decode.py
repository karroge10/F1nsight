import base64
import json
import zlib

from f1live.decode import (
    decode_feed,
    decode_z,
    format_utc,
    local_to_utc_ms,
    parse_archive_line,
    parse_utc,
)
from f1live.signalr import feed_frame, parse_frames

POSITION_SAMPLE = {
    "Position": [
        {
            "Timestamp": "2026-10-04T07:33:15.3566936Z",
            "Entries": {"1": {"Status": "OnTrack", "X": 1888, "Y": -929, "Z": 410}},
        }
    ]
}


def test_decode_z_inflates_raw_deflate_base64():
    encoded = _compress(POSITION_SAMPLE)
    assert decode_z(encoded) == POSITION_SAMPLE


def test_decode_feed_inflates_compressed_topics_and_drops_suffix():
    encoded = _compress(POSITION_SAMPLE)
    message = decode_feed("Position.z", encoded, "2026-10-04T07:33:18.150Z")
    assert message.topic == "Position"
    assert message.data == POSITION_SAMPLE
    assert message.utc == parse_utc("2026-10-04T07:33:18.150Z")


def test_decode_feed_keeps_plain_topics():
    message = decode_feed("TrackStatus", {"Status": "4"}, 1_000)
    assert message.topic == "TrackStatus"
    assert message.data == {"Status": "4"}
    assert message.utc == 1_000


def test_parse_utc_handles_seven_digit_fractions_and_offsets():
    assert parse_utc("2026-10-04T06:07:16.5613024Z") == parse_utc("2026-10-04T06:07:16.561Z")
    assert parse_utc("2026-10-04T07:30:00.136000+00:00") == parse_utc("2026-10-04T07:30:00.136Z")
    assert parse_utc("2026-10-04T06:19:14") == parse_utc("2026-10-04T06:19:14.000Z")
    assert format_utc(parse_utc("2026-10-04T06:19:14.250Z")) == "2026-10-04T06:19:14.250Z"


def test_local_to_utc_uses_gmt_offset():
    assert local_to_utc_ms("2026-10-04T15:00:00", "08:00:00") == parse_utc("2026-10-04T07:00:00Z")
    assert local_to_utc_ms("2026-10-25T15:00:00", "-05:00:00") == parse_utc("2026-10-25T20:00:00Z")


def test_parse_archive_line_strips_bom_and_reads_offset():
    offset, body = parse_archive_line('﻿01:02:03.456{"Status":"1"}\r\n')
    assert offset == ((1 * 60 + 2) * 60 + 3) * 1000 + 456
    assert json.loads(body) == {"Status": "1"}
    assert parse_archive_line("garbage") is None


def test_live_parser_reads_feed_invocations_including_compressed_payloads():
    encoded = _compress(POSITION_SAMPLE)
    text = feed_frame("Position.z", json.dumps(encoded), "2026-10-04T07:33:18.150Z")
    text += feed_frame("LapCount", '{"CurrentLap":5}', "2026-10-04T07:33:19.000Z")
    updates = parse_frames(text, snapshot_utc=0)
    assert [update.message.topic for update in updates] == ["Position", "LapCount"]
    assert updates[0].message.data == POSITION_SAMPLE
    assert not updates[0].replace


def test_live_parser_reads_subscribe_snapshot_in_dependency_order():
    completion = {
        "type": 3,
        "invocationId": "1",
        "result": {"TimingData": {"Lines": {}}, "SessionInfo": {"Name": "Race"}, "Position.z": _compress({})},
    }
    text = json.dumps(completion) + "\x1e"
    updates = parse_frames(text, snapshot_utc=42)
    topics = [update.message.topic for update in updates]
    assert topics[0] == "SessionInfo"
    assert set(topics) == {"SessionInfo", "TimingData", "Position"}
    assert all(update.replace and update.message.utc == 42 for update in updates)


def _compress(value) -> str:
    raw = json.dumps(value).encode()
    compressor = zlib.compressobj(wbits=-zlib.MAX_WBITS)
    deflated = compressor.compress(raw) + compressor.flush()
    return base64.b64encode(deflated).decode()
