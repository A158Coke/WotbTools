# -*- coding: utf-8 -*-
"""SCPG geometry decoder tests (stdlib unittest, no client assets)."""

import os
import struct
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from wotb_sc2 import Sc2ParseError
from wotb_scg import (
    decode_polygon_indices,
    decode_polygon_positions,
    polygon_group_id,
    polygon_group_vertex_stride,
    position_aabb,
)


def byte_array(payload: bytes):
    return {"$bytes": payload.hex()}


class ScgGeometryDecoderTest(unittest.TestCase):
    def test_decodes_interleaved_position_stream_and_uint16_indices(self):
        vertices = b"".join(
            (
                struct.pack("<ffff", 1.0, 2.0, 3.0, 99.0),
                struct.pack("<ffff", -4.0, 5.0, 6.0, 88.0),
                struct.pack("<ffff", 7.0, -8.0, 9.0, 77.0),
            )
        )
        group = {
            "#id": byte_array((123).to_bytes(8, "little")),
            "vertexFormat": 1,
            "vertexCount": 3,
            "vertices": byte_array(vertices),
            "indexFormat": 0,
            "indexCount": 3,
            "indices": byte_array(struct.pack("<HHH", 0, 2, 1)),
        }

        self.assertEqual(123, polygon_group_id(group))
        self.assertEqual(16, polygon_group_vertex_stride(group))
        self.assertEqual(
            [(1.0, 2.0, 3.0), (-4.0, 5.0, 6.0), (7.0, -8.0, 9.0)],
            decode_polygon_positions(group),
        )
        self.assertEqual([0, 2, 1], decode_polygon_indices(group))
        self.assertEqual(
            {"min": [-4.0, -8.0, 3.0], "max": [7.0, 5.0, 9.0]},
            position_aabb(decode_polygon_positions(group)),
        )

    def test_rejects_index_outside_local_vertex_array(self):
        group = {
            "vertexFormat": 1,
            "vertexCount": 1,
            "vertices": byte_array(struct.pack("<fff", 0.0, 0.0, 0.0)),
            "indexFormat": 0,
            "indexCount": 1,
            "indices": byte_array(struct.pack("<H", 1)),
        }

        with self.assertRaisesRegex(Sc2ParseError, "outside vertexCount"):
            decode_polygon_indices(group)

    def test_rejects_group_without_position_attribute(self):
        group = {
            "vertexFormat": 2,
            "vertexCount": 1,
            "vertices": byte_array(struct.pack("<fff", 0.0, 0.0, 1.0)),
            "indexFormat": 0,
            "indexCount": 1,
            "indices": byte_array(struct.pack("<H", 0)),
        }

        with self.assertRaisesRegex(Sc2ParseError, "EVF_VERTEX"):
            decode_polygon_positions(group)


if __name__ == "__main__":
    unittest.main()
