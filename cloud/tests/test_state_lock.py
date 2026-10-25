import json
import subprocess
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

from cloud import state


def completed(returncode=0, stdout="", stderr=""):
    return subprocess.CompletedProcess([], returncode, stdout, stderr)


class PushLockTests(unittest.TestCase):
    def test_lock_upload_is_claimed_by_its_token_after_ambiguous_failure(self):
        record = {"id": 17, "name": state.PUSH_LOCK_ASSET, "apiUrl": "https://api.test/assets/17"}
        calls = []

        def gh(*arguments, **kwargs):
            calls.append(arguments)
            if arguments[:2] == ("release", "upload"):
                return completed(1, stderr="HTTP 503")
            if arguments[:2] == ("release", "view"):
                return completed(stdout=json.dumps({"assets": [record]}))
            if arguments[:2] == ("release", "download"):
                folder = Path(arguments[6])
                (folder / state.PUSH_LOCK_ASSET).write_text(json.dumps(owner), encoding="utf-8")
                return completed()
            return completed()

        owner = {}
        with patch.object(state, "_gh", side_effect=gh), patch.object(state, "_asset_records", return_value=[record]):
            original = state._try_upload_lock
            def upload(lock_owner):
                owner.update(lock_owner)
                with patch.object(state, "_asset_records", return_value=[record]):
                    with patch.object(state, "_gh", side_effect=gh):
                        return original(lock_owner)
            with patch.object(state, "_try_upload_lock", side_effect=upload), \
                 patch.object(state, "_delete_asset_by_url") as delete:
                with state._push_lock(False):
                    pass
        delete.assert_called_once_with(record)
        upload_calls = [call for call in calls if call[:3] == ("release", "upload", "state")]
        self.assertTrue(upload_calls)
        self.assertNotIn("--clobber", upload_calls[0])

    def test_completed_actions_run_makes_lock_reclaimable(self):
        owner = {"runId": "123", "createdAt": datetime.now(timezone.utc).isoformat()}
        record = {"id": 8, "name": state.PUSH_LOCK_ASSET, "apiUrl": "https://api.test/assets/8",
                  "createdAt": datetime.now(timezone.utc).isoformat()}
        with patch.dict("os.environ", {"GITHUB_REPOSITORY": "org/repo"}), \
             patch.object(state, "_gh", return_value=completed(stdout='{"status":"completed"}')) as gh, \
             patch("cloud.state._read_json", return_value=owner):
            self.assertTrue(state._lock_is_stale(record))
        self.assertIn("repos/org/repo/actions/runs/123", gh.call_args.args)

    def test_unknown_actions_status_and_api_error_fail_closed(self):
        record = {"id": 8, "name": state.PUSH_LOCK_ASSET, "apiUrl": "https://api.test/assets/8",
                  "createdAt": datetime.now(timezone.utc).isoformat()}
        owner = {"runId": "123", "createdAt": datetime.now(timezone.utc).isoformat()}
        with patch.dict("os.environ", {"GITHUB_REPOSITORY": "org/repo"}), \
             patch("cloud.state._read_json", return_value=owner), \
             patch.object(state, "_gh", return_value=completed(stdout='{"status":"in_progress"}')):
            self.assertFalse(state._lock_is_stale(record))
        with patch.dict("os.environ", {"GITHUB_REPOSITORY": "org/repo"}), \
             patch("cloud.state._read_json", return_value=owner), \
             patch.object(state, "_gh", return_value=completed(1, stderr="offline")):
            self.assertFalse(state._lock_is_stale(record))

    def test_local_lock_expires_only_after_six_hours(self):
        record = {"id": 8, "name": state.PUSH_LOCK_ASSET, "apiUrl": "https://api.test/assets/8",
                  "createdAt": (datetime.now(timezone.utc) - timedelta(hours=7)).isoformat()}
        owner = {"createdAt": (datetime.now(timezone.utc) - timedelta(hours=7)).isoformat()}
        with patch("cloud.state._read_json", return_value=owner), patch.object(state, "_gh"):
            self.assertTrue(state._lock_is_stale(record))
        owner["createdAt"] = (datetime.now(timezone.utc) - timedelta(hours=5)).isoformat()
        record["createdAt"] = owner["createdAt"]
        with patch("cloud.state._read_json", return_value=owner), patch.object(state, "_gh"):
            self.assertFalse(state._lock_is_stale(record))

    def test_finally_delete_targets_asset_id_url_and_surfaces_failure(self):
        record = {"id": 91, "name": state.PUSH_LOCK_ASSET, "apiUrl": "https://api.test/assets/91"}
        with patch.object(state, "_asset_records", return_value=[]), \
             patch.object(state, "_try_upload_lock", return_value=record), \
             patch.object(state, "_delete_asset_by_url", side_effect=SystemExit("delete failed")) as delete:
            with self.assertRaisesRegex(SystemExit, "delete failed"):
                with state._push_lock(False):
                    pass
        delete.assert_called_once_with(record)

    def test_delete_uses_api_url_and_numeric_asset_id_not_asset_name(self):
        record = {"id": "RA_kwDOPbACjs4mBw1u", "name": state.PUSH_LOCK_ASSET, "apiUrl": "https://api.test/assets/91"}
        with patch.object(state, "_gh", return_value=completed()) as gh:
            state._delete_asset_by_url(record)
        self.assertEqual(gh.call_args.args, ("api", "--method", "DELETE", record["apiUrl"]))

    def test_active_lock_waits_then_fails_without_mutation(self):
        record = {"id": 91, "name": state.PUSH_LOCK_ASSET, "apiUrl": "https://api.test/assets/91"}
        with patch.object(state, "PUSH_LOCK_WAIT_S", 0.02), \
             patch.object(state, "PUSH_LOCK_POLL_S", 0.01), \
             patch.object(state, "_asset_records", return_value=[record]), \
             patch.object(state, "_lock_is_stale", return_value=False), \
             patch.object(state, "_try_upload_lock", return_value=None), \
             patch.object(state, "_delete_asset_by_url") as delete:
            with self.assertRaisesRegex(SystemExit, "timed out waiting"):
                with state._push_lock(False):
                    pass
        delete.assert_not_called()

    def test_stale_lock_is_deleted_by_id_before_new_owner_acquires(self):
        old = {"id": 91, "name": state.PUSH_LOCK_ASSET, "apiUrl": "https://api.test/assets/91",
               "createdAt": datetime.now(timezone.utc).isoformat()}
        new = {"id": 92, "name": state.PUSH_LOCK_ASSET, "apiUrl": "https://api.test/assets/92",
               "createdAt": datetime.now(timezone.utc).isoformat()}
        events = []
        inventory = [old]

        def delete(asset, **kwargs):
            events.append(("delete", asset["id"]))
            inventory.clear()

        def acquire(owner):
            events.append(("acquire", owner["token"]))
            inventory.append(new)
            return new

        with patch.object(state, "_asset_records", side_effect=lambda: list(inventory)), \
             patch.object(state, "_lock_is_stale", return_value=True), \
             patch.object(state, "_delete_asset_by_url", side_effect=delete), \
             patch.object(state, "_try_upload_lock", side_effect=acquire):
            with state._push_lock(False):
                pass
        self.assertEqual(events[0], ("delete", 91))
        self.assertEqual(events[1][0], "acquire")
        self.assertEqual(events[-1], ("delete", 92))

    def test_dry_run_never_acquires_or_uploads_lock(self):
        with patch.object(state, "_try_upload_lock") as upload, patch.object(state, "_asset_records") as assets:
            with state._push_lock(True):
                pass
        upload.assert_not_called()
        assets.assert_not_called()

    def test_another_contender_reclaiming_stale_lock_does_not_abort_push(self):
        old = {"id": "old", "name": state.PUSH_LOCK_ASSET, "apiUrl": "https://api.test/assets/91"}
        new = {"id": "new", "name": state.PUSH_LOCK_ASSET, "apiUrl": "https://api.test/assets/92"}
        with patch.object(state, "_asset_records", side_effect=[[old], []]), \
             patch.object(state, "_lock_is_stale", return_value=True), \
             patch.object(state, "_try_upload_lock", return_value=new), \
             patch.object(state, "_gh", side_effect=[completed(1, stderr="HTTP 404: Not Found"), completed()]) as gh:
            with state._push_lock(False):
                pass
        self.assertEqual([call.args[-1] for call in gh.call_args_list], [old["apiUrl"], new["apiUrl"]])


if __name__ == "__main__":
    unittest.main()
