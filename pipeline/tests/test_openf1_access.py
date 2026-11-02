import io
import json

import httpx
import pytest

from f1p import refresh
from f1p.openf1 import download


def test_unauthenticated_access_defers_without_overwriting_cached_data(monkeypatch, tmp_path, capsys):
    target = tmp_path / "2026/meetings.json"
    target.parent.mkdir()
    target.write_text('[{"meeting_key": 1}]', encoding="utf-8")
    monkeypatch.setattr(download, "raw_dir", lambda source: tmp_path)
    monkeypatch.setattr(download, "_parse_args", lambda: type("Args", (), {"seasons": [2026], "refresh": True})())
    monkeypatch.setattr(download, "_throttle", lambda: None)
    real_client = httpx.Client
    transport = httpx.MockTransport(lambda request: httpx.Response(401, json={"detail": "Authentication required"}))
    monkeypatch.setattr(download.httpx, "Client", lambda **kwargs: real_client(transport=transport, **kwargs))
    download.main()
    output = capsys.readouterr().out
    details = json.loads(output.strip().splitlines()[-1].removeprefix("RESULT "))
    assert details["deferred"] is True
    assert json.loads(target.read_text()) == [{"meeting_key": 1}]
    assert not (tmp_path / "2026/sessions.json").exists()


def test_deferred_openf1_refresh_is_skipped_and_not_marked_fresh(monkeypatch, tmp_path):
    monkeypatch.setattr(refresh, "RAW_DIR", tmp_path)
    state = {"openf1": {"lastSuccess": "2026-10-01T00:00:00Z"}}
    runner = refresh.StepRunner(refresh.RunLog(io.StringIO()), state, False)
    monkeypatch.setattr(runner, "_run_module", lambda *args: 'RESULT {"deferred": true, "reason": "OpenF1 access restricted (HTTP 401); retry later"}')
    result = refresh.StepResult("openf1")
    runner.step_openf1(result)
    assert result.status == "skipped"
    assert "401" in result.reason
    assert state["openf1"]["lastSuccess"] == "2026-10-01T00:00:00Z"


def test_other_http_errors_are_not_hidden(monkeypatch):
    monkeypatch.setattr(download, "_throttle", lambda: None)
    with httpx.Client(transport=httpx.MockTransport(lambda request: httpx.Response(403))) as client:
        with pytest.raises(httpx.HTTPStatusError):
            download.fetch(client, "meetings", {"year": 2026})
