# -*- coding: utf-8 -*-
"""Metadata-only Water inspector tests (no client assets)."""

import os
import struct
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from inspect_map_water import decode_bbox, summarize_water


def byte_array(payload: bytes):
    return {"$bytes": payload.hex()}


class WaterInspectorTest(unittest.TestCase):
    def test_decodes_render_object_bbox_without_exporting_geometry(self):
        bbox = decode_bbox({"bbox": byte_array(struct.pack("<6f", -2, -3, 4, 5, 6, 4))})
        self.assertEqual([-2.0, -3.0, 4.0], bbox["min"])
        self.assertEqual([5.0, 6.0, 4.0], bbox["max"])

    def test_summarizes_water_metadata_and_transform(self):
        scene = {
            "#hierarchy": [
                {
                    "name": "WaterSurface",
                    "components": {
                        "0": {
                            "comp.typename": "TransformComponent",
                            "tc.worldTranslation": [10.0, 20.0, 3.5],
                            "tc.worldScale": [1.0, 1.0, 1.0],
                            "tc.worldRotation": [0.0, 0.0, 0.0, 1.0],
                        },
                        "1": {
                            "comp.typename": "RenderComponent",
                            "rc.renderObj": {
                                "##name": "Water",
                                "bbox": byte_array(struct.pack("<6f", -5, -7, 0, 5, 7, 0)),
                                "ro.batches": {"0": {"rb.datasource": 42}},
                            },
                        },
                    },
                }
            ]
        }

        waters = summarize_water(scene, {})
        self.assertEqual(1, len(waters))
        self.assertTrue(waters[0]["visible"])
        self.assertEqual([10.0, 20.0, 3.5], waters[0]["worldTransform"]["translation"])
        self.assertEqual(1, waters[0]["batchCount"])
        self.assertEqual(42, waters[0]["batches"][0]["datasourceId"])
        self.assertTrue(waters[0]["batches"][0]["activeAtRequestedState"])
        self.assertFalse(waters[0]["batches"][0]["polygonGroupFound"])


if __name__ == "__main__":
    unittest.main()
