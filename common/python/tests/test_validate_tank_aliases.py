# -*- coding: utf-8 -*-
"""validate_tank_aliases.py unit tests + fail-closed gate for the committed dataset."""

import json
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import validate_tank_aliases as validator


KNOWN = {9297, 24577}


def validate(document, known=None):
    return validator.validate_tank_aliases(document, KNOWN if known is None else known)


class CommittedTankAliasesTest(unittest.TestCase):
    """The repository's own alias dataset must stay valid (CI fails closed on bad data)."""

    def test_committed_dataset_is_valid(self):
        document = validator.load_alias_document()
        known_tank_ids = validator.load_known_tank_ids()
        # Cross-tank duplicates are a diagnostic, not a failure; only the contract raises.
        warnings = validator.validate_tank_aliases(document, known_tank_ids)
        self.assertIsInstance(warnings, list)

    def test_vehicle_reference_is_offline_and_non_empty(self):
        known_tank_ids = validator.load_known_tank_ids()
        self.assertGreater(len(known_tank_ids), 100)
        # FV215b 183 — the seeded alias owner must resolve against the in-repo reference.
        self.assertIn(9297, known_tank_ids)

    def test_missing_vehicle_reference_fails(self):
        with tempfile.TemporaryDirectory() as empty:
            with self.assertRaises(FileNotFoundError):
                validator.load_known_tank_ids(empty)

    def test_missing_alias_file_fails(self):
        with tempfile.TemporaryDirectory() as empty:
            with self.assertRaisesRegex(RuntimeError, "TANK_ALIASES_FILE_MISSING"):
                validator.load_alias_document(empty)

    def test_loads_sparse_file_from_disk(self):
        with tempfile.TemporaryDirectory() as common_dir:
            self.write_alias_file(common_dir, '{"9297": ["大白兔"]}')
            self.assertEqual(validator.load_alias_document(common_dir), {"9297": ["大白兔"]})

    def test_duplicate_tank_id_keys_fail(self):
        # json.load alone would silently keep the last entry and drop a hand-written alias set.
        with tempfile.TemporaryDirectory() as common_dir:
            self.write_alias_file(common_dir, '{"9297": ["183"], "9297": ["大白兔"]}')
            with self.assertRaisesRegex(RuntimeError, "TANK_ALIASES_DUPLICATE_TANK_ID"):
                validator.load_alias_document(common_dir)

    def test_invalid_json_fails(self):
        with tempfile.TemporaryDirectory() as common_dir:
            self.write_alias_file(common_dir, '{"9297": ["183",]}')
            with self.assertRaises(json.JSONDecodeError):
                validator.load_alias_document(common_dir)

    @staticmethod
    def write_alias_file(common_dir, text):
        path = os.path.join(common_dir, validator.ALIAS_FILENAME)
        with open(path, "w", encoding="utf-8") as handle:
            handle.write(text)


class TankAliasContractTest(unittest.TestCase):
    def test_valid_sparse_file(self):
        self.assertEqual(validate({"9297": ["183", "大白兔", "Death Star"]}), [])

    def test_empty_document_is_valid(self):
        # 0 configured aliases is a legal state: every vehicle defaults to aliases=[].
        self.assertEqual(validate({}), [])

    def test_top_level_must_be_object(self):
        with self.assertRaisesRegex(RuntimeError, "TANK_ALIASES_NOT_OBJECT"):
            validate([{"id": 9297, "aliases": ["183"]}])

    def test_unknown_tank_id(self):
        with self.assertRaisesRegex(RuntimeError, "TANK_ALIASES_UNKNOWN_TANK_ID"):
            validate({"999999999": ["foo"]})

    def test_invalid_tank_id_keys(self):
        for key in ("abc", "0", "-1", "012", " 9297", "9297.0", "+9297", "９２９７"):
            with self.subTest(key=key):
                with self.assertRaisesRegex(RuntimeError, "TANK_ALIASES_INVALID_TANK_ID"):
                    validate({key: ["183"]})

    def test_value_must_be_array(self):
        with self.assertRaisesRegex(RuntimeError, "TANK_ALIASES_NOT_ARRAY"):
            validate({"9297": "183"})

    def test_empty_array_is_prohibited(self):
        with self.assertRaisesRegex(RuntimeError, "TANK_ALIASES_EMPTY_ARRAY"):
            validate({"9297": []})

    def test_alias_must_be_string(self):
        with self.assertRaisesRegex(RuntimeError, "TANK_ALIASES_ALIAS_NOT_STRING"):
            validate({"9297": [183]})

    def test_blank_alias_is_prohibited(self):
        for alias in ("", "   ", "\t"):
            with self.subTest(alias=alias):
                with self.assertRaisesRegex(RuntimeError, "TANK_ALIASES_BLANK_ALIAS"):
                    validate({"9297": [alias]})

    def test_duplicate_alias_within_one_tank(self):
        with self.assertRaisesRegex(RuntimeError, "TANK_ALIASES_DUPLICATE_ALIAS"):
            validate({"9297": ["183", "183"]})

    def test_case_insensitive_duplicate_within_one_tank(self):
        with self.assertRaisesRegex(RuntimeError, "TANK_ALIASES_DUPLICATE_ALIAS"):
            validate({"9297": ["Death Star", "death star"]})

    def test_cross_tank_duplicate_is_warning_only(self):
        warnings = validate({"9297": ["T95"], "24577": ["t95 "]})
        self.assertEqual(len(warnings), 1)
        self.assertIn("TANK_ALIASES_CROSS_TANK_DUPLICATE", warnings[0])
        self.assertIn("9297", warnings[0])
        self.assertIn("24577", warnings[0])


if __name__ == "__main__":
    unittest.main()
