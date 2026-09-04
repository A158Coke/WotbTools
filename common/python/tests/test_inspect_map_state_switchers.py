# -*- coding: utf-8 -*-
"""State-switcher research inspector tests (stdlib unittest, no client assets)."""

import os
import sys
import unittest
import zipfile

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from inspect_map_state_switchers import build_report


def mesh_entity(name: str, flags: int, datasource: int):
    return {
        "name": name,
        "components": {
            "0000": {"comp.typename": "TransformComponent"},
            "0001": {
                "comp.typename": "RenderComponent",
                "rc.renderObj": {
                    "##name": "Mesh",
                    "ro.flags": flags,
                    "ro.batchCount": 1,
                    "ro.batches": {
                        "0000": {"rb.datasource": datasource},
                    },
                    "rb0.lodIndex": 0,
                    "rb0.switchIndex": -1,
                },
            },
        },
    }


class StateSwitcherInspectorTest(unittest.TestCase):
    def test_reports_raw_state_switcher_and_child_visibility(self):
        scene = {
            "$metadata": {"version": 48},
            "#hierarchy": [
                {
                    "name": "CrateRoot",
                    "components": {
                        "0000": {
                            "comp.typename": "StateSwitcherComponent",
                            "ssc.state0": "crate_state0.sc2",
                            "ssc.customValue": 7,
                        }
                    },
                    "#hierarchy": [
                        {"name": "helper"},
                        mesh_entity("crate.sc2 State 0", 1, 100),
                        mesh_entity("crate.sc2 State 1", 0, 101),
                    ],
                }
            ],
        }
        member = zipfile.ZipInfo("Maps/99_test/99_test.sc2.dvpl")

        report = build_report(scene, "99_test", member, sample_limit=10)

        self.assertEqual(4, report["entityCountRecursive"])
        self.assertEqual(1, report["switchStateComponents"]["count"])
        component = report["switchStateComponents"]["records"][0]["components"][0]
        self.assertEqual("crate_state0.sc2", component["ssc.state0"])
        self.assertEqual(7, component["ssc.customValue"])

        groups = report["diagnosticStateNameSiblingGroups"]
        self.assertEqual(1, groups["count"])
        self.assertEqual(1, groups["visibilityCounts"]["state0:visible=True"])
        self.assertEqual(1, groups["visibilityCounts"]["state1:visible=False"])
        self.assertEqual(1, groups["batchSwitchCounts"]["state0:switch=-1"])
        self.assertEqual(1, groups["batchSwitchCounts"]["state1:switch=-1"])

        children = groups["records"][0]["children"]
        self.assertTrue(children[0]["render"]["visibleBitSet"])
        self.assertFalse(children[1]["render"]["visibleBitSet"])

    def test_reports_standard_switch_component_without_name_heuristic(self):
        scene = {
            "$metadata": {"version": 48},
            "#hierarchy": [
                {
                    "name": "SwitchRoot",
                    "components": {
                        "0000": {
                            "comp.typename": "SwitchComponent",
                            "sc.switchindex": 1,
                        }
                    },
                    "#hierarchy": [mesh_entity("ordinary-child", 1, 200)],
                }
            ],
        }
        member = zipfile.ZipInfo("Maps/99_test/99_test.sc2.dvpl")

        report = build_report(scene, "99_test", member, sample_limit=10)

        self.assertEqual(1, report["switchStateComponents"]["count"])
        component = report["switchStateComponents"]["records"][0]["components"][0]
        self.assertEqual(1, component["sc.switchindex"])
        self.assertEqual(0, report["diagnosticStateNameSiblingGroups"]["count"])


if __name__ == "__main__":
    unittest.main()
