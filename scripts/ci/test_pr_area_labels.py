"""Exercise advisory behavior, including overlapping and unknown areas."""

import importlib.util
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location("area_check", Path(__file__).with_name("check-pr-area-labels.py"))
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)
TAXONOMY = json.loads((ROOT / "deploy/observability/dev-metrics/area-taxonomy.json").read_text())


class AreaAdvisoryTest(unittest.TestCase):
    def warnings(self, *labels):
        return MODULE.check({"pull_request": {"labels": [{"name": label} for label in labels]}}, TAXONOMY)

    def test_multiple_known_areas_are_valid(self):
        self.assertEqual(self.warnings("area/infra", "area/observability"), [])

    def test_missing_area_is_advisory(self):
        self.assertEqual(len(self.warnings("bug")), 1)

    def test_unknown_area_does_not_satisfy_requirement(self):
        self.assertEqual(len(self.warnings("area/arbitrary")), 2)

    def test_known_plus_unknown_still_warns(self):
        self.assertEqual(len(self.warnings("area/docs", "area/arbitrary")), 1)

    def test_dispatch_context_is_ignored(self):
        self.assertEqual(MODULE.check({"inputs": {"pr_number": "633"}}, TAXONOMY), [])


if __name__ == "__main__":
    unittest.main()
