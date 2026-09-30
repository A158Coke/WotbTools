"""Capture geometry follows the semanticizer's active scene selection."""
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import extract_map_bases as extractor


def entity(kind, labels, x=0, y=0):
    return {"components": {
        "properties": {"comp.typename": "CustomPropertiesComponent",
                       "cpc.properties.archive": {"type": kind, "team": 1}},
        "labels": {"comp.typename": "LabelComponent", "lc.labels": labels},
        "transform": {"comp.typename": "TransformComponent",
                      "tc.worldTranslation": [x, y, 0]},
    }}


class MapBaseExtractionTest(unittest.TestCase):
    def extract(self, entities):
        with patch.object(extractor, "decode_dvpl", return_value=b"scene"), \
                patch.object(extractor, "read_sc2", return_value={"#hierarchy": entities}):
            return extractor.extract_map(b"scene", "neptune")

    def test_active_variant_excludes_secondary_controlpoints(self):
        points = [entity("spawnpoint", ["main"]) for _ in range(3)]
        points += [entity("controlpoint", ["main"], 49.5339, 8.5291),
                   entity("controlpoint", ["secondary"], -174.7717, 8.811),
                   entity("controlpoint", ["secondary"], 56.7256, 8.1217)]
        self.assertEqual([{"x": 49.5339, "y": 8.5291, "radius": None, "team": 1}],
                         self.extract(points)["assault"])

    def test_selection_includes_botspawn_like_semanticizer(self):
        points = [entity("botspawn", ["main"]) for _ in range(3)]
        points += [entity("controlpoint", ["main"], 1, 2),
                   entity("controlpoint", ["secondary"], 3, 4)]
        self.assertEqual(1, self.extract(points)["assault"][0]["x"])

    def test_unlabelled_scene_retains_controlpoint(self):
        self.assertEqual(1, len(self.extract([entity("controlpoint", [])])["assault"]))

    def test_identical_active_controlpoints_are_deduplicated(self):
        point = entity("controlpoint", ["main"], 49.5339, 8.5291)
        self.assertEqual(1, len(self.extract([point, point])["assault"]))


if __name__ == "__main__":
    unittest.main()
