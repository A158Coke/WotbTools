# -*- coding: utf-8 -*-
"""Derived map-geometry exporter selection tests (stdlib unittest)."""

import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from export_map_geometry_poc import (
    ExportMapGeometryError,
    collect_instances,
    iter_render_batches,
)


def mesh_entity():
    # Deliberately reverse archive-key insertion order. Correct batch-option lookup
    # must use the DAVA GenKeyFromIndex key rather than dict enumeration order.
    batches = {
        "0004": {"rb.datasource": 104},
        "0003": {"rb.datasource": 103},
        "0002": {"rb.datasource": 102},
        "0001": {"rb.datasource": 101},
        "0000": {"rb.datasource": 100},
    }
    render_object = {
        "##name": "Mesh",
        "ro.notShadowOnly": True,
        "ro.batches": batches,
        "rb0.lodIndex": -1,
        "rb0.switchIndex": -1,
        "rb1.lodIndex": 0,
        "rb1.switchIndex": -1,
        "rb2.lodIndex": -1,
        "rb2.switchIndex": 0,
        "rb3.lodIndex": 1,
        "rb3.switchIndex": 0,
        "rb4.lodIndex": 0,
        "rb4.switchIndex": 1,
    }
    return {
        "name": "nested-mesh.sc2",
        "components": {
            "0000": {
                "comp.typename": "RenderComponent",
                "rc.renderObj": render_object,
            },
            "0001": {
                "comp.typename": "TransformComponent",
                "tc.worldTranslation": [10.0, 20.0, 30.0],
                "tc.worldScale": [1.0, 1.0, 1.0],
                "tc.worldRotation": [0.0, 0.0, 0.0, 1.0],
            },
        },
    }


def render_object(entity):
    return entity["components"]["0000"]["rc.renderObj"]


class GeometryExporterSelectionTest(unittest.TestCase):
    def test_shared_lod_and_switch_batches_are_active(self):
        scene = {
            "#hierarchy": [
                {
                    "name": "parent",
                    "components": {},
                    "#hierarchy": [mesh_entity()],
                }
            ]
        }

        instances, skipped = collect_instances(scene, target_lod=0, target_switch=0)

        self.assertEqual({100, 101, 102}, {item["datasourceId"] for item in instances})
        self.assertEqual({0, 1, 2}, {item["batchIndex"] for item in instances})
        self.assertEqual(1, skipped["inactive_lod"])
        self.assertEqual(1, skipped["inactive_switch"])
        self.assertEqual(0, skipped["invisible_render_object"])
        self.assertEqual([10.0, 20.0, 30.0], instances[0]["worldTransform"]["translation"])

    def test_dava_visible_bit_controls_initial_scene_selection_not_name(self):
        visible = mesh_entity()
        visible["name"] = "misleading.sc2 State 1"
        render_object(visible)["ro.flags"] = 8193

        invisible = mesh_entity()
        invisible["name"] = "misleading.sc2 State 0"
        render_object(invisible)["ro.flags"] = 8192

        scene = {"#hierarchy": [visible, invisible]}
        instances, skipped = collect_instances(scene, target_lod=0, target_switch=0)

        self.assertEqual(3, len(instances))
        self.assertTrue(all(item["entityName"] == "misleading.sc2 State 1" for item in instances))
        self.assertEqual(1, skipped["invisible_render_object"])

    def test_missing_render_object_flags_default_to_visible(self):
        scene = {"#hierarchy": [mesh_entity()]}

        instances, skipped = collect_instances(scene, target_lod=0, target_switch=0)

        self.assertEqual(3, len(instances))
        self.assertEqual(0, skipped["invisible_render_object"])

    def test_rejects_non_integer_render_object_flags(self):
        entity = mesh_entity()
        render_object(entity)["ro.flags"] = "8193"
        scene = {"#hierarchy": [entity]}

        with self.assertRaisesRegex(ExportMapGeometryError, "ro.flags must be int"):
            collect_instances(scene, target_lod=0, target_switch=0)

    def test_numeric_archive_key_controls_render_batch_index(self):
        render = {
            "ro.batches": {
                "0007": {"rb.datasource": 7},
                "0002": {"rb.datasource": 2},
            }
        }
        self.assertEqual([7, 2], [index for index, _ in iter_render_batches(render)])

    def test_rejects_non_numeric_render_batch_key(self):
        render = {"ro.batches": {"bad": {"rb.datasource": 1}}}
        with self.assertRaisesRegex(ExportMapGeometryError, "non-numeric"):
            list(iter_render_batches(render))


if __name__ == "__main__":
    unittest.main()
