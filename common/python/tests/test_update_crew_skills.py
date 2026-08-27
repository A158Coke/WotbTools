# -*- coding: utf-8 -*-
"""update_crew_skills.py 单元测试（标准库 unittest，无网络依赖）。"""

import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import update_crew_skills as ucs


def encode_varint(value):
    out = bytearray()
    while True:
        byte = value & 0x7F
        value >>= 7
        if value:
            out.append(byte | 0x80)
        else:
            out.append(byte)
            return bytes(out)


def field_varint(field, value):
    return encode_varint((field << 3) | 0) + encode_varint(value)


def field_bytes(field, value):
    value = bytes(value)
    return encode_varint((field << 3) | 2) + encode_varint(len(value)) + value


def skill_message(skill_ids):
    return b"".join(field_bytes(1, skill_id.encode()) for skill_id in skill_ids)


def class_entry(class_id, skill_ids):
    return field_varint(1, class_id) + field_bytes(2, skill_message(skill_ids))


def definitions(classes):
    return b"".join(
        field_bytes(1, class_entry(class_id, skill_ids))
        for class_id, skill_ids in classes.items()
    )


class CrewSkillsTest(unittest.TestCase):
    def test_parse_and_build_document(self):
        classes = {
            0: ["light_a", "light_b", "light_c", "light_d"],
            1: ["medium_a", "medium_b", "medium_c", "medium_d"],
            2: ["heavy_a", "heavy_b", "heavy_c", "heavy_d"],
            3: ["td_a", "td_b", "td_c", "td_d"],
        }
        parsed = ucs.parse_skill_definitions(definitions(classes))
        self.assertEqual(classes, parsed)

        document = ucs.build_document(parsed)
        self.assertEqual(16, document["meta"]["count"])
        self.assertEqual(0, document["classes"]["light"]["classId"])
        self.assertEqual(
            "https://api.blitzkit.app/icons/skills/light_a.webp",
            document["classes"]["light"]["skills"][0]["icon"],
        )

    def test_rejects_missing_class(self):
        classes = {
            0: ["a", "b", "c", "d"],
            1: ["e", "f", "g", "h"],
            2: ["i", "j", "k", "l"],
        }
        with self.assertRaisesRegex(ValueError, "unexpected tank classes"):
            ucs.validate(classes)

    def test_rejects_suspiciously_small_class(self):
        classes = {
            0: ["a", "b", "c"],
            1: ["d", "e", "f", "g"],
            2: ["h", "i", "j", "k"],
            3: ["l", "m", "n", "o"],
        }
        with self.assertRaisesRegex(ValueError, "only 3 skills"):
            ucs.validate(classes)

    def test_rejects_invalid_skill_id(self):
        classes = {
            0: ["a", "b", "c", "Bad Skill"],
            1: ["d", "e", "f", "g"],
            2: ["h", "i", "j", "k"],
            3: ["l", "m", "n", "o"],
        }
        with self.assertRaisesRegex(ValueError, "invalid skill id"):
            ucs.validate(classes)


if __name__ == "__main__":
    unittest.main()
