import io
import json
import tarfile

import pytest

from cloud import state


def packed(tmp_path, payload, name="data/published/2026-18/hash.json"):
    path = tmp_path / "remote.tar.gz"
    content = json.dumps(payload).encode()
    with tarfile.open(path, "w:gz") as archive:
        member = tarfile.TarInfo(name)
        member.size = len(content)
        archive.addfile(member, io.BytesIO(content))
    return path


def test_merge_keeps_both_runners_snapshots_and_earliest_publication(monkeypatch, tmp_path):
    root = tmp_path / "repo"
    local = root / "data/published/2026-18/hash.json"
    local.parent.mkdir(parents=True)
    payload = {"forecastHash": "same", "forecast": {"race": 18}, "verifiedAt": "2026-10-25T19:00:00Z"}
    local.write_text(json.dumps(payload))
    remote = dict(payload, verifiedAt="2026-10-24T23:00:00Z")
    archive = packed(tmp_path, remote)
    monkeypatch.setattr(state, "ROOT_DIR", root)
    monkeypatch.setattr(state, "_download_archive", lambda entry, folder: archive)
    state._merge_published({}, tmp_path)
    assert json.loads(local.read_text())["verifiedAt"] == remote["verifiedAt"]
    other = packed(tmp_path, remote, "data/published/2026-18/other.json")
    monkeypatch.setattr(state, "_download_archive", lambda entry, folder: other)
    state._merge_published({}, tmp_path)
    assert local.exists() and local.with_name("other.json").exists()


def test_merge_refuses_to_overwrite_different_forecast(monkeypatch, tmp_path):
    root = tmp_path / "repo"
    local = root / "data/published/2026-18/hash.json"
    local.parent.mkdir(parents=True)
    local.write_text(json.dumps({"forecastHash": "same", "forecast": {"race": 17}}))
    archive = packed(tmp_path, {"forecastHash": "same", "forecast": {"race": 18}})
    monkeypatch.setattr(state, "ROOT_DIR", root)
    monkeypatch.setattr(state, "_download_archive", lambda entry, folder: archive)
    with pytest.raises(ValueError, match="conflicting"):
        state._merge_published({}, tmp_path)
