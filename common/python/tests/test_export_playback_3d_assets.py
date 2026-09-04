# -*- coding: utf-8 -*-
"""Local Battle Playback 3D asset export tests (no client assets required)."""

import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from export_playback_3d_assets import semantic_targets


class Playback3dAssetExportTest(unittest.TestCase):
    def test_known_replay_map_codes_resolve_to_client_map_ids(self):
        targets = semantic_targets()
        self.assertEqual("18_canal_cn", targets["canal"]["mapId"])
        self.assertEqual("14_port_pt", targets["port"]["mapId"])


if __name__ == "__main__":
    unittest.main()
