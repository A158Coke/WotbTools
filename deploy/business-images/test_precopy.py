from contextlib import closing, redirect_stdout
from hashlib import sha256
import io
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import patch
from uuid import uuid4

import precopy


class MemoryStore(dict):
    def keys(self, prefix):
        return (key for key in self if key.startswith(prefix))

    def get(self, key, limit):
        if key not in self:
            return None
        mime, body = self[key]
        return mime, body[:limit]

    def create(self, key, mime, body):
        if key in self:
            raise AssertionError("unexpected overwrite")
        self[key] = mime, body
        return True

    def check_destination(self):
        pass


class PrecopyTest(unittest.TestCase):
    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.manifest = Path(folder.name) / "images.sqlite"
        self.source, self.target = MemoryStore(), MemoryStore()
        self.topology = {"prefixes": {"cover": "covers/", "avatar": "avatars/"}}
        self.rows = []
        for p in (patch.object(precopy, "configuration", return_value=self.topology),
                  patch.object(precopy, "open_stores", return_value=(self.source, self.target)),
                  patch.object(precopy, "ledger", return_value=self.rows)):
            self.addCleanup(p.stop)
            p.start()

    def image(self, ns="cover", status="READY", refs=0, owner=True):
        uid = str(uuid4())
        key = self.topology["prefixes"][ns] + uid
        body = b"\x89PNG\r\n\x1a\n" + uid.encode()
        self.source[key] = ("image/png", body)
        self.rows.append((ns, uid, key, status, "image/png", len(body), sha256(body).hexdigest(),
                          refs, owner, "BROADCAST" if refs else None))
        return key

    def action(self, mode, *args, expected=0):
        out = io.StringIO()
        with redirect_stdout(out):
            self.assertEqual(expected, precopy.main([mode, str(self.manifest), *args]))
        return json.loads(out.getvalue())

    def state(self, key):
        with closing(sqlite3.connect(self.manifest)) as db:
            return db.execute("SELECT result,write_attempted,created_by_run,status FROM image "
                              "WHERE object_key=?", (key,)).fetchone()

    def test_copy_and_fresh_verification(self):
        attached = self.image(refs=1)
        ready = self.image("avatar")
        pending = self.image("avatar", "PENDING")
        absent = self.image(status="PENDING")
        del self.source[absent]
        self.target[attached] = self.source[attached]
        self.action("snapshot")
        self.action("verify", expected=1)
        self.assertEqual(set(self.target), {attached})
        self.action("copy")
        self.assertEqual(self.state(pending), ("verified", 1, 1, "PENDING"))
        self.assertEqual(self.state(absent), ("pending_absent", 0, 0, "PENDING"))
        self.assertEqual(self.state(attached), ("verified", 0, 0, "READY"))
        self.assertEqual(self.target[ready], self.source[ready])
        self.action("copy")
        self.target[ready] = ("image/jpeg", self.target[ready][1])
        self.action("verify", expected=1)
        self.assertEqual(self.state(ready)[0], "target_conflict")

    def test_failures_do_not_starve_batches_or_overwrite(self):
        conflict = self.image()
        self.target[conflict] = ("image/png", b"unexpected")
        ok = self.image()
        self.action("snapshot")
        for _ in range(2):
            self.action("copy", "--limit", "1", expected=1)
        self.assertEqual(self.state(conflict)[0], "target_conflict")
        self.assertEqual(self.target[conflict][1], b"unexpected")
        self.assertEqual(self.state(ok)[0], "verified")

    def test_lost_put_response_preserves_uncertain_ownership(self):
        key = self.image()
        self.action("snapshot")
        def lose_response(key, mime, body):
            self.target[key] = (mime, body)
            raise TimeoutError("sensitive signed URL")
        with patch.object(self.target, "create", side_effect=lose_response):
            report = self.action("copy", expected=1)
        self.assertNotIn("sensitive", json.dumps(report))
        self.action("copy")
        self.assertEqual(self.state(key), ("verified", 1, 0, "READY"))

    def test_conflicting_conditional_create_and_source_cleanup(self):
        race = self.image()
        gone = self.image()
        self.action("snapshot")
        del self.source[gone]
        def other_writer(key, mime, body):
            self.target[key] = (mime, b"different")
            return False
        with patch.object(self.target, "create", side_effect=other_writer):
            self.action("copy", expected=1)
        self.assertEqual(self.state(race)[:3], ("target_conflict", 1, 0))
        self.assertEqual(self.state(gone)[0], "source_missing_ready")

    def test_invalid_ownership_cross_namespace_and_source_bytes(self):
        wrong_season = self.image(refs=1, owner=False)
        bad_pending = self.image(status="PENDING", refs=1)
        wrong_key = self.image()
        self.rows[-1] = ("avatar", *self.rows[-1][1:])
        too_large = self.image()
        self.source[too_large] = ("image/png", self.source[too_large][1] + b"excess")
        unknown = "avatars/untracked"
        self.source[unknown] = ("image/jpeg", b"keep")
        self.action("snapshot")
        report = self.action("copy", expected=1)
        self.assertEqual(report["untracked_objects"], [{"side": "source", "namespace": "avatar", "count": 1},
                                                       {"side": "source", "namespace": "cover", "count": 1}])
        for key in (wrong_season, bad_pending, wrong_key):
            self.assertEqual(self.state(key)[0], "invalid_ledger")
        self.assertEqual(self.state(too_large)[0], "source_conflict")
        self.assertFalse(self.target)

    def test_failed_snapshot_cannot_be_used_or_overwritten(self):
        self.image()
        with patch.object(self.target, "keys", side_effect=PermissionError), self.assertRaises(PermissionError):
            self.action("snapshot")
        with self.assertRaises(ValueError):
            self.action("copy")
        with self.assertRaises(FileExistsError):
            self.action("snapshot")
        self.assertFalse(self.target)

    def test_topology_mismatch_fails_before_copy(self):
        self.image()
        self.action("snapshot")
        self.topology["OSS_BUCKET"] = "different"
        with self.assertRaises(ValueError):
            self.action("copy")
        self.assertFalse(self.target)


if __name__ == "__main__":
    unittest.main()
