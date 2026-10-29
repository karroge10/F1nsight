import pytest

from f1p.fantasy.leader import leader_snapshot


def test_global_leader_uses_overall_score_and_matching_round():
    board = {"Value": {"leaderboard": [{"cur_rank": 2, "cur_points": 5200}, {"cur_rank": 1, "cur_points": 5268, "team_name": "JJ%20Lehto%203"}]}, "FeedTime": {"UTCTime": "10/26/2026 1:53:00 AM"}}
    constraints = {"Data": {"Value": {"LPTourGamedayId": 18, "GamedayId": 19}}}
    schedule = {"Data": {"Value": [{"GamedayId": 18, "MeetingNumber": 18, "Season": "2026"}]}}
    result = leader_snapshot(board, constraints, schedule)
    assert result["points"] == 5268
    assert result["round"] == 18
    assert result["team"] == "JJ Lehto 3"
    assert result["sourceUpdatedAt"] == "2026-10-26T01:53:00+00:00"


@pytest.mark.parametrize("rows", [[], [{"cur_rank": 2, "cur_points": 5000}]])
def test_missing_leader_is_not_replaced_by_another_rank(rows):
    assert leader_snapshot({"Value": {"leaderboard": rows}}, {"Data": {"Value": {"LPTourGamedayId": 18}}}, {"Data": {"Value": [{"GamedayId": 18, "MeetingNumber": 18, "Season": "2026"}]}}) is None


def test_unavailable_optional_leader_feed_does_not_abort_refresh(monkeypatch):
    import httpx
    from f1p.fantasy import leader
    from unittest.mock import Mock
    monkeypatch.setattr(leader, "get_json", Mock(side_effect=httpx.ConnectError("offline")))
    save = Mock()
    monkeypatch.setattr(leader, "save_json", save)
    assert leader.refresh_leader({}, {})["status"] == "unavailable"
    save.assert_not_called()
