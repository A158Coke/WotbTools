# -*- coding: utf-8 -*-
"""blitzkit_snapshot.py unit tests."""

import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from blitzkit_snapshot import fetch_stable_snapshot


class StableSnapshotTest(unittest.TestCase):
    def test_two_identical_complete_reads_pass(self):
        values = {
            "tanks": [b"t1", b"t1"],
            "equipment": [b"e1", b"e1"],
        }
        counters = {name: 0 for name in values}

        def fetch(url):
            name = url
            index = counters[name]
            counters[name] += 1
            return values[name][index]

        snapshot, hashes = fetch_stable_snapshot(
            {"tanks": "tanks", "equipment": "equipment"}, fetch, max_rounds=2
        )
        self.assertEqual(snapshot, {"tanks": b"t1", "equipment": b"e1"})
        self.assertEqual(set(hashes), {"tanks", "equipment"})

    def test_release_transition_fails_without_stable_round(self):
        values = {
            "tanks": [b"old-tanks", b"new-tanks"],
            "equipment": [b"new-equipment", b"new-equipment"],
        }
        counters = {name: 0 for name in values}

        def fetch(url):
            name = url
            index = counters[name]
            counters[name] += 1
            return values[name][index]

        with self.assertRaisesRegex(RuntimeError, "BLITZKIT_SNAPSHOT_UNSTABLE"):
            fetch_stable_snapshot(
                {"tanks": "tanks", "equipment": "equipment"}, fetch, max_rounds=2
            )

    def test_transition_can_settle_on_next_complete_round(self):
        values = {
            "tanks": [b"old", b"new", b"new"],
            "equipment": [b"new", b"new", b"new"],
        }
        counters = {name: 0 for name in values}

        def fetch(url):
            name = url
            index = counters[name]
            counters[name] += 1
            return values[name][index]

        snapshot, _ = fetch_stable_snapshot(
            {"tanks": "tanks", "equipment": "equipment"}, fetch, max_rounds=3
        )
        self.assertEqual(snapshot, {"tanks": b"new", "equipment": b"new"})


if __name__ == "__main__":
    unittest.main()
