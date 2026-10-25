import importlib.util
import json
from pathlib import Path


spec = importlib.util.spec_from_file_location("publication", Path(__file__).parents[1] / "publication.py")
publication = importlib.util.module_from_spec(spec)
spec.loader.exec_module(publication)


def setup_state(monkeypatch, tmp_path):
    monkeypatch.setattr(publication, "ROOT", tmp_path)
    monkeypatch.setattr(publication, "STATE", tmp_path / "logs" / "publication.json")
    model = tmp_path / "ml" / "models" / "latest.json"
    model.parent.mkdir(parents=True)
    model.write_text(json.dumps({"path": "models\\v1"}))
    forecast = tmp_path / "data" / "predictions" / "next.json"
    forecast.parent.mkdir(parents=True)
    forecast.write_text(json.dumps({"model": {"version": "v1"}}))
    return model


def test_failed_deploy_remains_due_across_runs(monkeypatch, tmp_path):
    setup_state(monkeypatch, tmp_path)
    publication.update(False)
    assert not publication.needed()
    publication.update(True)
    assert publication.needed()
    assert publication.needed()
    publication.update(False)
    assert not publication.needed()


def test_promoted_model_recovers_without_dispatch(monkeypatch, tmp_path):
    model = setup_state(monkeypatch, tmp_path)
    publication.update(False)
    model.write_text(json.dumps({"path": "models/v2"}))
    assert publication.needed()
    publication.update(True)
    assert publication.needed()
    publication.update(False)
    assert publication.needed()
    forecast = tmp_path / "data" / "predictions" / "next.json"
    forecast.write_text(json.dumps({"model": {"version": "v2"}}))
    publication.update(False)
    assert not publication.needed()


def test_missing_publication_is_due(monkeypatch, tmp_path):
    setup_state(monkeypatch, tmp_path)
    assert publication.needed()


def test_recovery_recomputes_forecast_without_forcing_other_sources(monkeypatch, tmp_path):
    setup_state(monkeypatch, tmp_path)
    path = tmp_path / "logs" / "refresh_state.json"
    path.parent.mkdir(parents=True)
    path.write_text(json.dumps({"predict": {"fingerprint": "old", "lastSuccess": "today"},
                                "cloud": {"checkedThrough": "today"}, "history": {"ok": True}}))
    publication.retry_prediction()
    state = json.loads(path.read_text())
    assert "fingerprint" not in state["predict"]
    assert state["predict"]["lastSuccess"] == "today"
    assert state["history"] == {"ok": True}
    assert state["cloud"] == {"checkedThrough": "today"}
