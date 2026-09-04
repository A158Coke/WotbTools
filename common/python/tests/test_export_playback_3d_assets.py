# -*- coding: utf-8 -*-
"""Local Battle Playback 3D asset export tests (no client assets required)."""

import os
import struct
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from export_playback_3d_assets import decode_heightmap, semantic_targets


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


class Playback3dAssetExportTest(unittest.TestCase):
    def test_known_replay_map_codes_resolve_to_client_map_ids(self):
        targets = semantic_targets()
        self.assertEqual("18_canal_cn", targets["canal"]["mapId"])
        self.assertEqual("14_port_pt", targets["port"]["mapId"])

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


if __name__ == "__main__":
    unittest.main()
