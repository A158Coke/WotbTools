# -*- coding: utf-8 -*-
"""update_crew_skills.py unit tests (stdlib unittest, no network)."""

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


def sample_classes():
    return {
        0: ["light_a", "light_b", "light_c", "light_d"],
        1: ["medium_a", "medium_b", "medium_c", "medium_d"],
        2: ["heavy_a", "heavy_b", "heavy_c", "heavy_d"],
        3: ["td_a", "td_b", "td_c", "td_d"],
    }


class CrewSkillsTest(unittest.TestCase):
    def test_parse_and_build_document(self):
        classes = sample_classes()
        parsed = ucs.parse_skill_definitions(definitions(classes))
        self.assertEqual(classes, parsed)

        document = ucs.build_document(
            parsed,
            game_version="11.19.0",
            skills_hash="abc123",
            generated_at="2026-08-27T00:00:00Z",
        )
        self.assertEqual(16, document["meta"]["count"])
        self.assertEqual("11.19.0", document["meta"]["sourceGameVersion"])
        self.assertEqual("abc123", document["meta"]["sourceHash"])
        self.assertEqual(0, document["classes"]["light"]["classId"])
        self.assertEqual(
            "https://api.blitzkit.app/icons/skills/light_a.webp",
            document["classes"]["light"]["skills"][0]["icon"],
        )

    def test_existing_identical_skills_are_true_noop(self):
        classes = sample_classes()
        existing = ucs.build_document(
            classes,
            game_version="11.19.0",
            skills_hash="old-hash",
            generated_at="2026-08-20T00:00:00Z",
        )
        document, changed = ucs.reconcile_document(
            existing,
            classes,
            game_version="11.20.0",
            skills_hash="new-hash",
            generated_at="2026-08-27T00:00:00Z",
        )
        self.assertFalse(changed)
        self.assertIs(existing, document)
        self.assertEqual("2026-08-20T00:00:00Z", document["meta"]["generatedAt"])
        self.assertEqual("old-hash", document["meta"]["sourceHash"])

    def test_new_skill_is_imported(self):
        old_classes = sample_classes()
        new_classes = sample_classes()
        new_classes[0] = [*new_classes[0], "new_light_skill"]
        existing = ucs.build_document(
            old_classes,
            game_version="11.19.0",
            skills_hash="old-hash",
            generated_at="2026-08-20T00:00:00Z",
        )
        document, changed = ucs.reconcile_document(
            existing,
            new_classes,
            game_version="11.20.0",
            skills_hash="new-hash",
            generated_at="2026-08-27T00:00:00Z",
        )
        self.assertTrue(changed)
        self.assertEqual(17, document["meta"]["count"])
        self.assertEqual("new-hash", document["meta"]["sourceHash"])
        self.assertEqual("new_light_skill", document["classes"]["light"]["skills"][-1]["id"])

    def test_legacy_document_is_upgraded_once_with_trace_metadata(self):
        classes = sample_classes()
        legacy = ucs.build_document(classes, generated_at="2026-08-20T00:00:00Z")
        document, changed = ucs.reconcile_document(
            legacy,
            classes,
            game_version="11.19.0",
            skills_hash="abc123",
            generated_at="2026-08-27T00:00:00Z",
        )
        self.assertTrue(changed)
        self.assertEqual("11.19.0", document["meta"]["sourceGameVersion"])
        self.assertEqual("abc123", document["meta"]["sourceHash"])

    def test_rejects_duplicate_class_entry(self):
        data = field_bytes(1, class_entry(0, ["a", "b", "c", "d"])) + field_bytes(
            1, class_entry(0, ["e", "f", "g", "h"])
        )
        with self.assertRaisesRegex(ValueError, "duplicate tank class entry"):
            ucs.parse_skill_definitions(data)

    def test_rejects_missing_or_new_class(self):
        classes = sample_classes()
        del classes[3]
        with self.assertRaisesRegex(ValueError, "unexpected tank classes"):
            ucs.validate(classes)

        classes = sample_classes()
        classes[4] = ["new_a", "new_b", "new_c", "new_d"]
        with self.assertRaisesRegex(ValueError, "unexpected tank classes"):
            ucs.validate(classes)

    def test_rejects_suspiciously_small_class(self):
        classes = sample_classes()
        classes[0] = ["a", "b", "c"]
        with self.assertRaisesRegex(ValueError, "only 3 skills"):
            ucs.validate(classes)

    def test_rejects_invalid_skill_id(self):
        classes = sample_classes()
        classes[0][-1] = "Bad Skill"
        with self.assertRaisesRegex(ValueError, "invalid skill id"):
            ucs.validate(classes)

    def test_rejects_cross_class_duplicate(self):
        classes = sample_classes()
        classes[1][0] = classes[0][0]
        with self.assertRaisesRegex(ValueError, "multiple tank classes"):
            ucs.validate(classes)


if __name__ == "__main__":
    unittest.main()
