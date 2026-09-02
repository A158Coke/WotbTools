import importlib.util
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch
from pathlib import Path


SCRIPT = Path(__file__).parents[1] / "cleanup-hundred-wargaming-api.py"
SPEC = importlib.util.spec_from_file_location("cleanup_hundred", SCRIPT)
MODULE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)


class FakeDb:
    def __init__(self):
        self.executed = []

    def query(self, sql, params=()):
        if "WHERE verification_source = %s GROUP BY status" in sql:
            return [("CURRENT", 1), ("REJECTED", 2)] if params == (MODULE.MANUAL,) else [("PENDING", 3)]
        if "SELECT COUNT(*) FROM hall_of_fame_record" in sql:
            return [(4,)]
        if "SELECT id FROM hundred_battle_submission" in sql:
            return [(11,), (12,)]
        if "SELECT sha256 FROM hundred_battle_replay_evidence WHERE submission_id" in sql:
            return [("a" * 64,), ("b" * 64,)]
        if "SELECT sha256 FROM hundred_battle_replay_evidence WHERE sha256" in sql:
            return [("a" * 64,)]
        if "SELECT replay_hash FROM hall_of_fame_record" in sql:
            return []
        raise AssertionError(f"unexpected query: {sql}")

    def execute(self, sql, params=()):
        self.executed.append((sql, tuple(params)))
        return 2


class ResumableApplyDb:
    """Minimal stateful DB fake for the committed-DB/filesystem retry contract."""

    def __init__(self):
        self.deleted = False
        self.executed = []

    def query(self, sql, params=()):
        if "WHERE verification_source = %s GROUP BY status" in sql:
            return [("CURRENT", 1)] if params == (MODULE.MANUAL,) else ([] if self.deleted else [("PENDING", 1)])
        if "SELECT COUNT(*) FROM hall_of_fame_record" in sql:
            return [(4,)]
        if "SELECT id FROM hundred_battle_submission" in sql:
            return [] if self.deleted else [(11,)]
        if "SELECT sha256 FROM hundred_battle_replay_evidence WHERE submission_id" in sql:
            return [] if self.deleted else [("b" * 64,)]
        if "SELECT sha256 FROM hundred_battle_replay_evidence WHERE sha256" in sql:
            # Before deletion the hash is still referenced by the WG evidence,
            # but the production query must exclude this batch's submission ID.
            return [] if "submission_id NOT IN" in sql else ([] if self.deleted else [("b" * 64,)])
        if "SELECT replay_hash FROM hall_of_fame_record" in sql:
            return []
        if "SELECT COUNT(*) FROM hundred_battle_submission WHERE verification_source" in sql:
            return [(0 if self.deleted else 1,)]
        if "JOIN hundred_battle_submission" in sql:
            return [(0,)]
        if "official_account_battle_count" in sql:
            return [(0,)]
        raise AssertionError(f"unexpected query: {sql}")

    def execute(self, sql, params=()):
        self.executed.append((sql, tuple(params)))
        if "DELETE FROM hundred_battle_submission" in sql:
            self.deleted = True
        return 1


class CleanupToolTest(unittest.TestCase):
    def test_default_main_is_read_only_dry_run(self):
        db = FakeDb()
        connection = Mock()
        with patch.object(MODULE, "load_connection", return_value=connection), \
                patch.object(MODULE, "Database", return_value=db), \
                patch("builtins.print") as print_mock:
            self.assertEqual(MODULE.main(["--dsn", "unused"]), 0)
        connection.commit.assert_not_called()
        self.assertEqual(db.executed, [])
        self.assertTrue(any("DRY-RUN" in str(call) for call in print_mock.call_args_list))

    def test_inspect_is_read_only_and_does_not_expose_identifiers(self):
        db = FakeDb()
        report, baseline, ids, hashes = MODULE.inspect(db)
        self.assertEqual(report.submission_count, 3)
        self.assertEqual(report.evidence_count, 2)
        self.assertEqual(len(hashes), 2)
        self.assertEqual(ids, [11, 12])
        self.assertEqual(baseline.hall_of_fame_rows, 4)
        self.assertEqual(db.executed, [])

    def test_delete_rows_uses_fk_order_and_fixed_source_guard(self):
        db = FakeDb()
        MODULE.delete_rows(db, [11, 12])
        self.assertEqual(len(db.executed), 2)
        self.assertIn("hundred_battle_replay_evidence", db.executed[0][0])
        self.assertIn("hundred_battle_submission", db.executed[1][0])
        self.assertEqual(db.executed[1][1][-1], MODULE.SOURCE)

    def test_only_unreferenced_hash_file_is_removed(self):
        db = FakeDb()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / ("a" * 64 + ".wotbreplay")).write_bytes(b"shared")
            (root / ("b" * 64 + ".wotbreplay")).write_bytes(b"retired")
            result = MODULE.remove_unreferenced_files(db, root, {"a" * 64, "b" * 64})
            self.assertEqual(result, (1, 1, 1, 0))
            self.assertTrue((root / ("a" * 64 + ".wotbreplay")).exists())
            self.assertFalse((root / ("b" * 64 + ".wotbreplay")).exists())

    def test_apply_requires_exact_confirmation(self):
        self.assertEqual(MODULE.main(["--apply", "--dsn", "unused", "--confirm", "wrong"]), 2)

    def test_committed_db_failure_resumes_file_delete_from_manifest(self):
        db = ResumableApplyDb()
        connection = Mock()
        digest = "b" * 64
        with tempfile.TemporaryDirectory() as directory:
            replay_dir = Path(directory)
            replay_file = replay_dir / f"{digest}.wotbreplay"
            replay_file.write_bytes(b"retired")
            manifest = replay_dir / "cleanup.json"
            argv = ["--apply", "--dsn", "unused", "--confirm", MODULE.CONFIRMATION,
                    "--replay-dir", str(replay_dir), "--manifest", str(manifest)]

            with patch.object(MODULE, "load_connection", return_value=connection), \
                    patch.object(MODULE, "Database", return_value=db), \
                    patch.object(Path, "unlink", side_effect=OSError("filesystem unavailable")):
                self.assertEqual(MODULE.main(argv), 1)

            self.assertTrue(connection.commit.called)
            self.assertTrue(replay_file.exists())
            self.assertTrue(manifest.exists())
            payload = MODULE.json.loads(manifest.read_text(encoding="utf-8"))
            self.assertEqual(set(payload), {"hashes", "replay_dir", "source", "version"})
            self.assertEqual(payload["hashes"], [digest])
            self.assertNotIn("accountId", manifest.read_text(encoding="utf-8"))
            self.assertNotIn("nickname", manifest.read_text(encoding="utf-8"))

            with patch.object(MODULE, "load_connection", return_value=connection), \
                    patch.object(MODULE, "Database", return_value=db), \
                    patch("builtins.print") as print_mock:
                self.assertEqual(MODULE.main(argv), 0)

            self.assertFalse(replay_file.exists())
            self.assertFalse(manifest.exists())
            self.assertTrue(any("Cleanup verification: PASS" in str(call)
                                for call in print_mock.call_args_list))

    def test_apply_deletes_wg_only_hash_even_while_wg_evidence_exists(self):
        db = ResumableApplyDb()
        connection = Mock()
        digest = "b" * 64
        with tempfile.TemporaryDirectory() as directory:
            replay_dir = Path(directory)
            replay_file = replay_dir / f"{digest}.wotbreplay"
            replay_file.write_bytes(b"wg-only")
            manifest = replay_dir / "cleanup.json"
            argv = ["--apply", "--dsn", "unused", "--confirm", MODULE.CONFIRMATION,
                    "--replay-dir", str(replay_dir), "--manifest", str(manifest)]

            with patch.object(MODULE, "load_connection", return_value=connection), \
                    patch.object(MODULE, "Database", return_value=db):
                self.assertEqual(MODULE.main(argv), 0)

            self.assertFalse(replay_file.exists())
            self.assertFalse(manifest.exists())

    def test_apply_preserves_wg_manual_shared_hash(self):
        class SharedApplyDb(ResumableApplyDb):
            shared = "c" * 64

            def query(self, sql, params=()):
                if "SELECT sha256 FROM hundred_battle_replay_evidence WHERE submission_id" in sql:
                    return [] if self.deleted else [("b" * 64,), (self.shared,)]
                if "SELECT sha256 FROM hundred_battle_replay_evidence WHERE sha256" in sql:
                    # The shared hash is the MANUAL reference. A query that fails
                    # to exclude the WG batch would incorrectly return both hashes.
                    return [(self.shared,)] if "submission_id NOT IN" in sql else (
                        [] if self.deleted else [("b" * 64,), (self.shared,)])
                return super().query(sql, params)

        db = SharedApplyDb()
        connection = Mock()
        wg_digest = "b" * 64
        shared_digest = db.shared
        with tempfile.TemporaryDirectory() as directory:
            replay_dir = Path(directory)
            wg_file = replay_dir / f"{wg_digest}.wotbreplay"
            shared_file = replay_dir / f"{shared_digest}.wotbreplay"
            wg_file.write_bytes(b"wg-only")
            shared_file.write_bytes(b"manual-shared")
            manifest = replay_dir / "cleanup.json"
            argv = ["--apply", "--dsn", "unused", "--confirm", MODULE.CONFIRMATION,
                    "--replay-dir", str(replay_dir), "--manifest", str(manifest)]

            with patch.object(MODULE, "load_connection", return_value=connection), \
                    patch.object(MODULE, "Database", return_value=db):
                self.assertEqual(MODULE.main(argv), 0)

            self.assertFalse(wg_file.exists())
            self.assertTrue(shared_file.exists())
            self.assertFalse(manifest.exists())


if __name__ == "__main__":
    unittest.main()
