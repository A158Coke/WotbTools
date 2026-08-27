# -*- coding: utf-8 -*-
"""sync_tankopedia_snapshot.py item coverage tests."""

import os
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import sync_tankopedia_snapshot as sync


class TankopediaItemCoverageTest(unittest.TestCase):
    def test_known_applicable_item_passes(self):
        vehicles = {"1": {"id": 1}}
        item_defs = [{"id": 10, "name": "Known", "gameModeExclusive": False}]
        with patch.object(sync.ut, "item_allowed", return_value=True):
            self.assertTrue(
                sync.validate_item_catalog_coverage(vehicles, item_defs, {10: "KNOWN"}, "consumable")
            )

    def test_unknown_applicable_normal_item_fails_closed(self):
        vehicles = {"1": {"id": 1}, "2": {"id": 2}}
        item_defs = [{"id": 99, "name": "New item", "gameModeExclusive": False}]
        with patch.object(sync.ut, "item_allowed", return_value=True):
            with self.assertRaisesRegex(RuntimeError, "TANKOPEDIA_UNKNOWN_PROVISION_ID"):
                sync.validate_item_catalog_coverage(vehicles, item_defs, {}, "provision")

    def test_unknown_game_mode_exclusive_item_is_out_of_scope(self):
        vehicles = {"1": {"id": 1}}
        item_defs = [{"id": 99, "name": "Mode ability", "gameModeExclusive": True}]
        with patch.object(sync.ut, "item_allowed", side_effect=AssertionError("mode item must be skipped")):
            self.assertTrue(
                sync.validate_item_catalog_coverage(vehicles, item_defs, {}, "provision")
            )

    def test_unknown_item_irrelevant_to_business_tiers_is_allowed(self):
        vehicles = {"1": {"id": 1}}
        item_defs = [{"id": 99, "name": "Low-tier only", "gameModeExclusive": False}]
        with patch.object(sync.ut, "item_allowed", return_value=False):
            self.assertTrue(
                sync.validate_item_catalog_coverage(vehicles, item_defs, {}, "consumable")
            )


if __name__ == "__main__":
    unittest.main()
