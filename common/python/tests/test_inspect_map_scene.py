# -*- coding: utf-8 -*-
"""Scene-inspector regression tests (stdlib unittest, no client assets)."""

import os
import sys
import unittest
import zipfile
from unittest.mock import patch

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from inspect_map_scene import decode_scene_payload, inspect_scene


def scene_member(name="Maps/test/test.sc2"):
    member = zipfile.ZipInfo(name)
    member.file_size = 123
    member.compress_size = 123
    return member


class SceneInspectorRegressionTest(unittest.TestCase):
    def test_uncompressed_sc2_payload_is_not_sent_to_dvpl_decoder(self):
        raw = b"raw-sc2-payload"
        with patch("inspect_map_scene.decode_dvpl") as decoder:
            self.assertIs(raw, decode_scene_payload(raw, "Maps/test/test.sc2"))
            decoder.assert_not_called()

    def test_dvpl_scene_payload_uses_decoder(self):
        raw = b"wrapped"
        decoded = b"decoded"
        with patch("inspect_map_scene.decode_dvpl", return_value=decoded) as decoder:
            self.assertEqual(decoded, decode_scene_payload(raw, "Maps/test/test.sc2.dvpl"))
            decoder.assert_called_once_with(raw)

    def test_inspect_scene_recursively_counts_nested_entities_and_components(self):
        nested_render = {
            "name": "nested-mesh",
            "components": {
                "0000": {
                    "comp.typename": "RenderComponent",
                    "rc.renderObj": {
                        "##name": "Mesh",
                        "ro.batches": {
                            "0000": {"rb.datasource": 42},
                        },
                    },
                },
                "0001": {
                    "comp.typename": "CollisionTypeComponent",
                    "CollisionType": 6,
                },
            },
        }
        scene = {
            "$metadata": {},
            "#dataNodes": [],
            "#hierarchy": [
                {
                    "name": "parent",
                    "components": {},
                    "#hierarchy": [nested_render],
                }
            ],
        }

        report = inspect_scene(scene, scene_member(), sample_limit=10)

        self.assertEqual(3, report["schemaVersion"])
        self.assertEqual("recursive #hierarchy", report["sceneTraversal"]["mode"])
        self.assertEqual(2, report["entityCount"])
        self.assertEqual(1, report["componentTypeCounts"]["RenderComponent"])
        self.assertEqual(1, report["componentTypeCounts"]["CollisionTypeComponent"])
        self.assertEqual(1, report["renderObjectClassCounts"]["Mesh"])
        sample = report["targetComponentSamples"]["CollisionTypeComponent"][0]
        self.assertEqual("$.#hierarchy[0].#hierarchy[0]", sample["entityPath"])


if __name__ == "__main__":
    unittest.main()
