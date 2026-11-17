# -*- coding: utf-8 -*-
"""Map base extraction: variant-label filtering contract (stdlib unittest, no client assets)."""

import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from extract_map_bases import (  # noqa: E402
    ExtractError,
    SUPREMACY_BASE_IDS,
    base_variant_label,
    select_base_variant_points,
    variant_groups,
)


def _point(label, x=0.0, y=0.0, point_type="controlpoint"):
    return (point_type, {"type": point_type}, (x, y, 0.0), label)


class BaseVariantLabelTests(unittest.TestCase):
    def test_picks_smallest_numeric_suffix(self):
        points = [_point("nt2"), _point("nt0"), _point("nt1")]
        self.assertEqual(base_variant_label(points, "neptune"), "nt0")

    def test_unlabeled_points_have_no_base_variant(self):
        self.assertIsNone(base_variant_label([_point(None)], "holland"))

    def test_non_numeric_label_fails_closed(self):
        with self.assertRaises(ExtractError):
            base_variant_label([_point("winter")], "neptune")


class SelectBaseVariantPointsTests(unittest.TestCase):
    def test_keeps_base_variant_and_unlabeled_points_only(self):
        points = [
            _point("nt0", 49.5),
            _point("nt1", 56.7),
            _point("nt2", -174.8),
            _point(None, 10.0),
        ]
        selected = select_base_variant_points(points, "neptune")
        self.assertEqual([point[2][0] for point in selected], [49.5, 10.0])

    def test_all_unlabeled_points_are_common(self):
        points = [_point(None, 1.0), _point(None, 2.0)]
        selected = select_base_variant_points(points, "holland")
        self.assertEqual(len(selected), 2)


class VariantGroupsTests(unittest.TestCase):
    def test_groups_by_label_with_unlabeled_points_shared(self):
        strategic = lambda label, x: (
            "strategicpoint",
            {"type": "strategicpoint", "baseID": 0, "radius": 15.0},
            (x, 0.0, 0.0),
            label,
        )
        control = lambda label, x: (
            "controlpoint",
            {"type": "controlpoint", "team": 1},
            (x, 0.0, 0.0),
            label,
        )
        groups = variant_groups(
            [strategic("nt0", 1.0), strategic("nt1", 2.0), control(None, 3.0)],
            "neptune",
        )
        self.assertEqual(set(groups), {"nt0", "nt1"})
        self.assertEqual([base["x"] for base in groups["nt0"]["supremacy"]], [1.0])
        self.assertEqual([base["x"] for base in groups["nt1"]["supremacy"]], [2.0])
        self.assertEqual([base["x"] for base in groups["nt0"]["assault"]], [3.0])
        self.assertEqual(groups["nt0"]["supremacy"][0]["baseId"], SUPREMACY_BASE_IDS[0])

    def test_unlabeled_scene_has_no_variant_shell(self):
        self.assertEqual(variant_groups([_point(None)], "holland"), {})


if __name__ == "__main__":
    unittest.main()
