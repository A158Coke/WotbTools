# -*- coding: utf-8 -*-
"""map_semanticizer.py 单元测试（标准库 unittest，无第三方依赖、无客户端资源）。

由仓库维护者手动运行（不接入 CI）：
    python -m unittest discover -s map-semanticizer/tests -p 'test_*.py'
"""

import json
import os
import pathlib
import struct
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import map_semanticizer as ms

REPO = pathlib.Path(__file__).resolve().parents[2]
SEMANTIC_DIR = REPO / "common" / "map-semantics"
MAP_NAMES_FILE = REPO / "common" / "map_names.json"

ALLOWED_RELATION_TYPES = {
    "ADJACENT_TO",
    "HIGHER_THAN",
    "CONTAINS_CONTROL_POINT",
    "CONTAINS_STRATEGIC_POINT",
}
FORBIDDEN_RELATION_TYPES = {
    "CONTROLS",
    "ENABLES_PRESSURE_AGAINST",
    "CROSS_FIRE",
    "GUARANTEED_LINE_OF_SIGHT",
    "GUARANTEED_TRAVERSABLE_ROUTE",
}


def point_entity(labels, point_type="spawnpoint"):
    return {
        "name": "point",
        "components": {
            "custom": {
                "comp.typename": "CustomPropertiesComponent",
                "cpc.properties.archive": {"type": point_type},
            },
            "labels": {"comp.typename": "LabelComponent", "lc.labels": list(labels)},
        },
    }


def semantic_documents():
    for path in sorted(SEMANTIC_DIR.glob("*.semantic.json")):
        yield path, json.loads(path.read_text(encoding="utf-8"))


class HeightmapTest(unittest.TestCase):
    def test_16x16_block_untiling(self):
        size = 16
        tile = 4
        target = [y * size + x for y in range(size) for x in range(size)]
        raw = bytearray(struct.pack("<II", size, tile))
        blocks = size // tile
        for block_y in range(blocks):
            for block_x in range(blocks):
                for local_y in range(tile):
                    for local_x in range(tile):
                        y = block_y * tile + local_y
                        x = block_x * tile + local_x
                        raw.extend(struct.pack("<H", target[y * size + x]))
        terrain = ms.load_heightmap(bytes(raw), (0, 0, 0, size, size, 10.0))
        scale = 10.0 / 65535.0
        for y in range(size):
            for x in range(size):
                expected = target[y * size + x] * scale
                self.assertAlmostEqual(terrain.heights[y * size + x], expected, places=3)


class VariantTest(unittest.TestCase):
    def test_detect_variant_prefers_max_point_label(self):
        entities = [point_entity(["cn0"]) for _ in range(33)]
        entities += [point_entity(["cn1"]) for _ in range(15)]
        self.assertEqual(ms.detect_variant(entities), "cn0")

    def test_detect_variant_none_for_unlabeled_points(self):
        entities = [point_entity([]) for _ in range(10)]
        self.assertIsNone(ms.detect_variant(entities))

    def test_matches_variant_unlabeled_scene_data(self):
        self.assertTrue(ms.matches_variant([], None))
        self.assertFalse(ms.matches_variant(["cn0"], None))
        self.assertTrue(ms.matches_variant(["cn0"], "cn0"))
        self.assertFalse(ms.matches_variant([], "cn0"))


class MapCodeDerivationTest(unittest.TestCase):
    def test_single_token_code_matches_token(self):
        names = json.loads(MAP_NAMES_FILE.read_text(encoding="utf-8")).keys()
        self.assertEqual(ms.derive_map_codes("18_canal_cn", names), ["canal"])

    def test_multi_token_code_matches_contiguous_subsequence(self):
        names = list(json.loads(MAP_NAMES_FILE.read_text(encoding="utf-8")).keys())
        codes = ms.derive_map_codes("02_desert_train_dt", names)
        self.assertEqual(codes, ["desert_train"])

    def test_subtokens_never_enter_map_codes_from_production_whitelist(self):
        names = list(json.loads(MAP_NAMES_FILE.read_text(encoding="utf-8")).keys())
        codes = ms.derive_map_codes("02_desert_train_dt", names)
        self.assertNotIn("train", codes)
        self.assertNotIn("desert", codes)

    def test_known_folder_alias_milibase_to_milbase(self):
        self.assertEqual(
            ms.derive_map_codes("24_milibase_mlb", ["milbase"]),
            ["milbase"],
        )


class DataIntegrityTest(unittest.TestCase):
    def test_all_semantic_files_parse_and_have_required_sections(self):
        docs = list(semantic_documents())
        self.assertGreaterEqual(len(docs), 33)
        for path, doc in docs:
            self.assertIn("mapId", doc)
            self.assertIn("areas", doc)
            self.assertIn("relationships", doc)
            self.assertIn("spawnSemantics", doc)
            self.assertIn("verified", doc)
            self.assertIn("source", doc)
            self.assertTrue(doc["areas"], path.name)

    def test_area_confidence_is_preserved(self):
        for path, doc in semantic_documents():
            for area_id, area in doc["areas"].items():
                confidence = area.get("confidence", {})
                self.assertIn("geometry", confidence, path.name + ":" + area_id)
                self.assertIn("objectPositions", confidence, path.name + ":" + area_id)
                self.assertIn("objectCategories", confidence, path.name + ":" + area_id)
                self.assertIn("areaBoundary", confidence, path.name + ":" + area_id)
                self.assertIn("favorsAndRisks", confidence, path.name + ":" + area_id)

    def test_relationships_reference_existing_areas(self):
        for path, doc in semantic_documents():
            areas = set(doc["areas"])
            for relation in doc["relationships"]:
                self.assertIn(relation["from"], areas, path.name)
                if relation["type"] in ("ADJACENT_TO", "HIGHER_THAN"):
                    self.assertIn(relation["to"], areas, path.name)

    def test_forbidden_relationship_types_absent(self):
        for path, doc in semantic_documents():
            types = {relation["type"] for relation in doc["relationships"]}
            self.assertTrue(types.issubset(ALLOWED_RELATION_TYPES), path.name + ": " + str(types))
            for forbidden in sorted(FORBIDDEN_RELATION_TYPES):
                self.assertIn(forbidden, doc["notGeneratedWithoutFurtherEvidence"], path.name)

    def test_grid_regions_only_1_to_9_and_cells_agree(self):
        for path, doc in semantic_documents():
            cells_by_id = {cell["id"]: cell for cell in doc["analysisGrid"]["cells"]}
            for area_id, area in doc["areas"].items():
                for region in area["gridRegions"]:
                    self.assertTrue(1 <= region <= 9, path.name + ":" + area_id)
                expected = sorted(
                    {cells_by_id[cell_id]["nineGridRegion"] for cell_id in area["gridCells"]}
                )
                self.assertEqual(area["gridRegions"], expected, path.name + ":" + area_id)

    def test_every_production_map_code_covered_exactly_once(self):
        names = json.loads(MAP_NAMES_FILE.read_text(encoding="utf-8"))
        docs = {path.name: json.loads(path.read_text(encoding="utf-8"))
                for path in SEMANTIC_DIR.glob("*.semantic.json")}
        for map_code in names:
            matches = []
            for name, doc in docs.items():
                if map_code in doc.get("mapCodes", []):
                    matches.append(name)
                elif map_code in ms.derive_map_codes(doc["mapId"], [map_code]):
                    matches.append(name)
            self.assertEqual(
                len(set(matches)), 1,
                f"{map_code} must be covered by exactly one semantic file: {sorted(set(matches))}",
            )

    def test_coordinate_validation_uses_p90_not_mae(self):
        milibase = json.loads(
            (SEMANTIC_DIR / "24_milibase_mlb.semantic.json").read_text(encoding="utf-8")
        )
        validation = milibase["terrain"]["coordinateValidation"]
        self.assertGreater(validation["meanAbsoluteDeltaMeters"], 1.0)
        self.assertLess(validation["p90AbsoluteDeltaMeters"], 0.5)
        self.assertTrue(ms.coordinate_validation_passed(milibase["terrain"]))

        high_mae_low_p90 = {
            "coordinateValidation": {
                "sampleCount": 32,
                "meanAbsoluteDeltaMeters": 1.45,
                "p90AbsoluteDeltaMeters": 0.08,
            }
        }
        self.assertTrue(ms.coordinate_validation_passed(high_mae_low_p90))

        bad_p90 = {
            "coordinateValidation": {
                "sampleCount": 32,
                "meanAbsoluteDeltaMeters": 0.1,
                "p90AbsoluteDeltaMeters": 2.0,
            }
        }
        self.assertFalse(ms.coordinate_validation_passed(bad_p90))
        self.assertFalse(ms.coordinate_validation_passed({}))


if __name__ == "__main__":
    unittest.main()
