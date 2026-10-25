import json
import subprocess
import unittest
from pathlib import Path
from unittest.mock import patch

from cloud import state


def completed(returncode=0, stdout="", stderr=""):
    return subprocess.CompletedProcess([], returncode, stdout, stderr)


class AssetInventoryTests(unittest.TestCase):
    def test_push_listing_failure_cannot_publish_partial_manifest(self):
        with patch.object(state, "_ensure_release"), \
             patch.object(state, "_gh", return_value=completed(1, stderr="network unavailable")), \
             patch.object(state, "_upload_manifest") as upload, \
             patch.object(state, "_delete_stale_assets") as cleanup:
            with self.assertRaisesRegex(SystemExit, "network unavailable"):
                state.push(["publication"], explicit=True, dry_run=False)
        upload.assert_not_called()
        cleanup.assert_not_called()

    def test_asset_listing_failure_raises_instead_of_returning_empty_inventory(self):
        with patch.object(state, "_gh", return_value=completed(1, stderr="network unavailable")):
            with self.assertRaisesRegex(SystemExit, "network unavailable"):
                state._asset_names()

    def test_cleanup_uses_one_inventory(self):
        inventory = ["manifest-new.json", "current.tar.gz", "orphan.tar.gz"]
        manifest = {"groups": {"processed": {"assets": ["current.tar.gz"]}}}
        calls = []

        def gh(*arguments, **kwargs):
            calls.append(arguments)
            if arguments[0:2] == ("release", "download"):
                name = arguments[4]
                folder = Path(arguments[6])
                (folder / name).write_text(json.dumps(manifest), encoding="utf-8")
            return completed(stdout=json.dumps({"assets": [{"name": name} for name in inventory]}))

        with patch.object(state, "_gh", side_effect=gh):
            state._delete_stale_assets()

        listings = [call for call in calls if call[:2] == ("release", "view") and "assets" in call]
        self.assertEqual(len(listings), 1)
        deletes = [call for call in calls if call[:2] == ("release", "delete-asset")]
        self.assertEqual([call[3] for call in deletes], ["orphan.tar.gz"])

    def test_cleanup_does_not_delete_when_inventory_has_no_manifests(self):
        calls = []

        def gh(*arguments, **kwargs):
            calls.append(arguments)
            return completed(stdout=json.dumps({"assets": [{"name": "archive.tar.gz"}]}))

        with patch.object(state, "_gh", side_effect=gh):
            state._delete_stale_assets()

        self.assertFalse(any(call[:2] == ("release", "delete-asset") for call in calls))

    def test_cleanup_does_not_delete_when_manifest_references_missing_asset(self):
        inventory = ["manifest-new.json", "orphan.tar.gz"]
        manifest = {"groups": {"processed": {"assets": ["missing.tar.gz"]}}}
        calls = []

        def gh(*arguments, **kwargs):
            calls.append(arguments)
            if arguments[0:2] == ("release", "download"):
                name = arguments[4]
                folder = Path(arguments[6])
                (folder / name).write_text(json.dumps(manifest), encoding="utf-8")
            return completed(stdout=json.dumps({"assets": [{"name": name} for name in inventory]}))

        with patch.object(state, "_gh", side_effect=gh):
            state._delete_stale_assets()

        self.assertFalse(any(call[:2] == ("release", "delete-asset") for call in calls))

    def test_release_creation_only_follows_a_not_found_response(self):
        calls = []

        def gh(*arguments, **kwargs):
            calls.append(arguments)
            if arguments[:2] == ("release", "view"):
                return completed(1, stderr="release not found")
            return completed()

        with patch.object(state, "_gh", side_effect=gh):
            state._ensure_release(False)

        self.assertEqual(calls[-1][:2], ("release", "create"))

    def test_release_view_auth_error_does_not_create_release(self):
        calls = []

        def gh(*arguments, **kwargs):
            calls.append(arguments)
            return completed(1, stderr="HTTP 401: Bad credentials")

        with patch.object(state, "_gh", side_effect=gh):
            with self.assertRaisesRegex(SystemExit, "Bad credentials"):
                state._ensure_release(False)

        self.assertFalse(any(call[:2] == ("release", "create") for call in calls))


if __name__ == "__main__":
    unittest.main()
