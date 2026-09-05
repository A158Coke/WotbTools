# -*- coding: utf-8 -*-
"""Local Battle Playback 2.5D terrain export tests (no client assets required)."""

import os
import struct
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from export_playback_3d_assets import (
    decode_heightmap,
    extract_procedural_water_planes,
    playback_map_codes,
    semantic_targets,
)


def tiled_uint16_payload(rows, tile_size):
    size = len(rows)
    values = []
    block_count = size // tile_size
    for block_y in range(block_count):
        for block_x in range(block_count):
            for local_y in range(tile_size):
                y = block_y * tile_size + local_y
                start = block_x * tile_size
                values.extend(rows[y][start:start + tile_size])
    return struct.pack("<II", size, tile_size) + struct.pack(f"<{len(values)}H", *values)


def water_entity(*, translation_z=10.0, local_z=2.0, local_z_span=0.0, quaternion=None):
    half_span = local_z_span / 2.0
    bbox = struct.pack(
        "<6f",
        -100.0,
        -100.0,
        local_z - half_span,
        100.0,
        100.0,
        local_z + half_span,
    )
    return {
        "name": "Water",
        "components": {
            "0": {
                "comp.typename": "TransformComponent",
                "tc.worldTranslation": [0.0, 0.0, translation_z],
                "tc.worldScale": [1.0, 1.0, 1.0],
                "tc.worldRotation": quaternion or [0.0, 0.0, 0.0, 1.0],
            },
            "1": {
                "comp.typename": "RenderComponent",
                "rc.renderObj": {
                    "##name": "Water",
                    "bbox": {"$bytes": bbox.hex()},
                },
            },
        },
    }


class Playback25dAssetExportTest(unittest.TestCase):
    def test_known_replay_map_codes_resolve_to_client_map_ids(self):
        targets = semantic_targets()
        self.assertEqual("18_canal_cn", targets["canal"]["mapId"])
        self.assertEqual("14_port_pt", targets["port"]["mapId"])

    def test_all_registered_playback_maps_have_height_semantics(self):
        codes = playback_map_codes()
        targets = semantic_targets()
        self.assertEqual(29, len(codes))
        self.assertEqual(len(codes), len(set(codes)))
        self.assertEqual([], [code for code in codes if code not in targets])
        self.assertTrue(all((targets[code].get("sourceFiles") or {}).get("heightmap") for code in codes))

    def test_decodes_tiled_heightmap_to_world_z_row_major(self):
        rows = [
            [0, 1, 2, 3],
            [4, 5, 6, 7],
            [8, 9, 10, 11],
            [12, 13, 14, 15],
        ]
        payload = tiled_uint16_payload(rows, tile_size=2)
        size, tile_size, heights = decode_heightmap(
            payload,
            {
                "xMin": -2,
                "yMin": -2,
                "zMin": 0,
                "xMax": 2,
                "yMax": 2,
                "zMax": 65535,
            },
        )

        self.assertEqual(4, size)
        self.assertEqual(2, tile_size)
        self.assertEqual([float(value) for row in rows for value in row], heights)

    def test_rejects_invalid_heightmap_payload_size(self):
        with self.assertRaisesRegex(RuntimeError, "unexpected heightmap size"):
            decode_heightmap(
                struct.pack("<IIH", 4, 2, 1),
                {"zMin": 0, "zMax": 1},
            )

    def test_derives_horizontal_water_z_from_bbox_and_world_transform(self):
        scene = {"#hierarchy": [water_entity(translation_z=10.0, local_z=2.0)]}
        planes = extract_procedural_water_planes(scene)

        self.assertEqual(1, len(planes))
        self.assertEqual(12.0, planes[0]["zMeters"])
        self.assertEqual(
            "WATER_FLAT_BBOX_Z_PLUS_SC2_WORLD_TRANSFORM",
            planes[0]["evidence"],
        )

    def test_rejects_non_flat_or_tilted_water_metadata(self):
        scene = {
            "#hierarchy": [
                water_entity(local_z_span=1.0),
                water_entity(quaternion=[0.1, 0.0, 0.0, 0.995]),
            ]
        }
        self.assertEqual([], extract_procedural_water_planes(scene))

    def test_deduplicates_multiple_water_entities_at_same_level(self):
        scene = {
            "#hierarchy": [
                water_entity(translation_z=10.0, local_z=2.0),
                water_entity(translation_z=10.004, local_z=2.0),
            ]
        }
        planes = extract_procedural_water_planes(scene)
        self.assertEqual(1, len(planes))


if __name__ == "__main__":
    unittest.main()
