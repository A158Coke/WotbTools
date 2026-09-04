# -*- coding: utf-8 -*-
"""Scene-inspector regression tests (stdlib unittest, no client assets)."""

import io
import os
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from inspect_map_scene import (
    decode_scene_payload,
    inspect_scene,
    main,
    select_scene_member,
)


def scene_member(name="Maps/test/test.sc2"):
    member = zipfile.ZipInfo(name)
    member.file_size = 123
    member.compress_size = 123
    return member


def archive_with(*members: tuple[str, bytes]) -> zipfile.ZipFile:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        for name, payload in members:
            archive.writestr(name, payload)
    buffer.seek(0)
    archive = zipfile.ZipFile(buffer)
    archive._test_buffer = buffer  # type: ignore[attr-defined]
    return archive


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

    def test_default_selection_accepts_raw_sc2_exact_main(self):
        with archive_with(("Maps/99_test/99_test.sc2", b"raw")) as archive:
            member = select_scene_member(archive, "99_test", None)
        self.assertEqual("Maps/99_test/99_test.sc2", member.filename)

    def test_default_selection_accepts_single_raw_sc2_fallback(self):
        with archive_with(("Maps/99_test/alternate.sc2", b"raw")) as archive:
            member = select_scene_member(archive, "99_test", None)
        self.assertEqual("Maps/99_test/alternate.sc2", member.filename)

    def test_main_loads_default_raw_sc2_without_scene_override(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            archive_path = root / "Maps.zip"
            output_path = root / "report.json"
            with zipfile.ZipFile(archive_path, "w") as archive:
                archive.writestr("Maps/99_test/99_test.sc2", b"raw-scene")

            report = {
                "entityCount": 0,
                "dataNodes": {"polygonGroups": {"count": 0}},
                "resourceReferences": {"unique": []},
            }
            argv = [
                "inspect_map_scene.py",
                str(archive_path),
                "99_test",
                "--output",
                str(output_path),
            ]
            with (
                patch.object(sys, "argv", argv),
                patch("inspect_map_scene.read_sc2", return_value={}) as read_scene,
                patch("inspect_map_scene.inspect_scene", return_value=report),
                patch("inspect_map_scene.inspect_auxiliary_resources", return_value=[]),
            ):
                self.assertEqual(0, main())

            read_scene.assert_called_once_with(b"raw-scene")
            self.assertTrue(output_path.is_file())

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
