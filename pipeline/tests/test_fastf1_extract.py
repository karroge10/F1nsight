import json
from datetime import datetime, timedelta, timezone

import pandas as pd
import pytest
from fastf1.exceptions import DataNotLoadedError

from f1p.fastf1 import extract, incremental
from f1p.fastf1.common import SessionRef
from contextlib import nullcontext


class SessionWithoutMetadata:
    laps = pd.DataFrame({"DriverNumber": ["1"], "LapNumber": [1]})
    results = pd.DataFrame({"DriverNumber": ["1"], "Position": [1]})
    drivers = ["1"]

    @property
    def session_info(self):
        raise DataNotLoadedError("session info unavailable")


def test_session_export_keeps_available_tables_without_optional_metadata(monkeypatch, tmp_path):
    monkeypatch.setattr(extract, "session_dir", lambda ref: tmp_path)
    ref = SessionRef(2026, 18, "FP2", "Practice 2", "United States Grand Prix", "2026-10-23T21:00:00")

    meta = extract.write_session(SessionWithoutMetadata(), ref)

    assert meta["counts"]["laps"] == 1
    assert meta["counts"]["results"] == 1
    assert meta["sessionKey"] is None
    assert meta["circuitKey"] is None
    assert json.loads((tmp_path / "meta.json").read_text())["drivers"] == ["1"]
    assert len(pd.read_parquet(tmp_path / "laps.parquet")) == 1


def test_circuit_info_is_optional_when_session_metadata_is_missing():
    ref = SessionRef(2026, 18, "R", "Race", "United States Grand Prix", "2026-10-25T20:00:00")

    assert extract._circuit_info(SessionWithoutMetadata(), ref) == (None, None)


def test_empty_archives_stay_pending_after_the_partial_data_timeout():
    start = datetime(2026, 10, 23, 21, tzinfo=timezone.utc)
    ref = SessionRef(2026, 18, "FP2", "Practice 2", "United States Grand Prix", start.isoformat())

    assert incremental._should_wait(ref, ["laps", "results", "weather"], start + timedelta(days=1), False)


@pytest.mark.parametrize("problems", [["laps"], ["results"], ["laps", "results"]])
def test_missing_core_data_is_retried_even_after_timeout(problems):
    start = datetime(2026, 10, 23, 21, tzinfo=timezone.utc)
    ref = SessionRef(2026, 18, "FP2", "Practice 2", "United States Grand Prix", start.isoformat())
    assert incremental._should_wait(ref, problems, start + timedelta(days=1), False)


def test_unavailable_session_load_stays_pending(monkeypatch):
    class UnavailableSession:
        def load(self, **kwargs):
            raise DataNotLoadedError("archive not ready")

    ref = SessionRef(2026, 18, "FP2", "Practice 2", "United States Grand Prix", "2026-10-23T21:00:00")
    records = []
    monkeypatch.setattr(incremental, "session_claim", lambda ref: nullcontext(True))
    monkeypatch.setattr(incremental, "is_done", lambda ref: False)
    monkeypatch.setattr(incremental, "get_session", lambda ref: UnavailableSession())
    monkeypatch.setattr(incremental, "append_manifest", lambda *args, **kwargs: records.append((args, kwargs)))
    assert incremental.download_one(ref, datetime(2026, 10, 24, tzinfo=timezone.utc), False) == "pending"
    assert records[0][0][1] == "pending"


def test_old_partial_session_metadata_does_not_prevent_retry(monkeypatch, tmp_path):
    ref = SessionRef(2026, 18, "FP2", "Practice 2", "United States Grand Prix", "2026-10-23T21:00:00")
    monkeypatch.setattr(incremental, "is_done", lambda ref: True)
    monkeypatch.setattr(incremental, "session_dir", lambda ref: tmp_path)
    (tmp_path / "meta.json").write_text(json.dumps({"counts": {"laps": 3, "results": 0}}))
    assert not incremental._already_complete(ref)
    (tmp_path / "meta.json").write_text(json.dumps({"counts": {"laps": 3, "results": 2}}))
    assert incremental._already_complete(ref)


def test_session_export_uses_lap_driver_numbers_without_results(monkeypatch, tmp_path):
    class SessionWithoutResults(SessionWithoutMetadata):
        @property
        def results(self):
            raise DataNotLoadedError("results unavailable")

        @property
        def drivers(self):
            raise DataNotLoadedError("results unavailable")

    monkeypatch.setattr(extract, "session_dir", lambda ref: tmp_path)
    ref = SessionRef(2026, 18, "FP2", "Practice 2", "United States Grand Prix", "2026-10-23T21:00:00")

    meta = extract.write_session(SessionWithoutResults(), ref)

    assert meta["drivers"] == ["1"]
    assert meta["counts"]["laps"] == 1
    assert meta["counts"]["results"] == 0
