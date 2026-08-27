# -*- coding: utf-8 -*-
"""blitzkit_snapshot.py unit tests."""

import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from blitzkit_snapshot import fetch_stable_snapshot, parse_game_version


class StableSnapshotTest(unittest.TestCase):
    def test_two_identical_complete_reads_pass(self):
        values = {
            "game": [b"g1", b"g1"],
            "tanks": [b"t1", b"t1"],
            "equipment": [b"e1", b"e1"],
        }
        counters = {name: 0 for name in values}

        def fetch(url):
            index = counters[url]
            counters[url] += 1
            return values[url][index]

        snapshot, hashes = fetch_stable_snapshot(
            {name: name for name in values}, fetch, max_rounds=2
        )
        self.assertEqual(snapshot, {name: values[name][1] for name in values})
        self.assertEqual(set(hashes), set(values))

    def test_release_transition_fails_without_stable_round(self):
        values = {
            "game": [b"old-game", b"new-game"],
            "tanks": [b"old-tanks", b"new-tanks"],
            "equipment": [b"new-equipment", b"new-equipment"],
        }
        counters = {name: 0 for name in values}

        def fetch(url):
            index = counters[url]
            counters[url] += 1
            return values[url][index]

        with self.assertRaisesRegex(RuntimeError, "BLITZKIT_SNAPSHOT_UNSTABLE"):
            fetch_stable_snapshot(
                {name: name for name in values}, fetch, max_rounds=2
            )

    def test_transition_can_settle_on_next_complete_round(self):
        values = {
            "game": [b"old", b"new", b"new"],
            "tanks": [b"old", b"new", b"new"],
            "equipment": [b"new", b"new", b"new"],
        }
        counters = {name: 0 for name in values}

        def fetch(url):
            index = counters[url]
            counters[url] += 1
            return values[url][index]

        snapshot, _ = fetch_stable_snapshot(
            {name: name for name in values}, fetch, max_rounds=3
        )
        self.assertEqual(snapshot, {name: b"new" for name in values})

    def test_game_version_is_required(self):
        def decode(_):
            return {1: [b"11.20.0"]}

        def f1(message, field, default=None):
            values = message.get(field)
            return values[0] if values else default

        def as_str(value):
            return value.decode()

        self.assertEqual(
            parse_game_version(b"ignored", decode, f1, as_str),
            "11.20.0",
        )
        with self.assertRaisesRegex(RuntimeError, "BLITZKIT_GAME_VERSION_MISSING"):
            parse_game_version(b"ignored", lambda _: {}, f1, as_str)


if __name__ == "__main__":
    unittest.main()
