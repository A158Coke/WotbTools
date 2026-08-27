#!/usr/bin/env python3
"""Fail-closed locks for equipment whose effects are not fully modeled.

The sync remains forward-compatible: unrelated new vehicles, presets, equipment,
or game versions are allowed. Only a partially modeled locked equipment item
changing its own upstream definition requires human review.
"""

import hashlib

from update_equipment import (
    as_int,
    decode_protobuf,
    f1,
    item_by_code,
    parse_equipment_details,
)

LOCKED_DESCRIPTION_SHA256 = {
    "SUPERCHARGER": "51344707bc61af4ae26a44a0cafe8bea5a672806724431dd8c0de6a6644f575a",
    "IMPROVED_VERTICAL_STABILIZER": "e99db56a71da9091425e87f0abfe79ed0093c956ea0da4354d281f829d365df6",
    "IMPROVED_SUSPENSION": "86c68c7d39be2a1111a4cec5edb04157651acbf78aafc798540c6c88bee56880",
    "IMPROVED_MODULES": "203575a1c698227f9328adb7adcc20eed98c94b12fe7c72e23408d60fe06006c",
    "DEFENSE_SYSTEM": "66170c6b2d7dbf32dd30c74b49cde61541a6eb471787f74671e43ca279d39dc2",
    "ENHANCED_TRACKS": "afd8eaa78b9325fd0b1d7d85717305fc64cf30d663f345d16779d5b9c7f06486",
    "TOOLBOX": "7a7c914b72b1fd0701c87fa52ea90933dc9b9bc98d94f5770f92cc751dd919e1",
    "CONSUMABLE_DELIVERY_SYSTEM": "388a9a50bed0d24c46128af2e6665555260dc4e9fdd4e1d7ff80a72690e6efdf",
    "HIGH_END_CONSUMABLES": "95ce345dddfd159bfe5234bc475a861e55480e738379bde0c43f28b792d53107",
}

# SHA-256 of each locked item's complete Equipment protobuf value from the live
# 11.19 data reviewed for this PR. Unlike a whole equipment.pb lock, these hashes
# allow unrelated upstream data to evolve while still catching hidden numeric or
# structural changes inside a partially modeled item even when its description
# template stays unchanged.
LOCKED_DEFINITION_SHA256 = {
    "CONSUMABLE_DELIVERY_SYSTEM": "94897e6bd56a9930bf5a92355cf36743db4c45af01c5c056362124e116a07a17",
    "DEFENSE_SYSTEM": "a722efc13b8b80392d439d4459fbf1798313d0feb76413917c41ef2db80ac53d",
    "ENHANCED_TRACKS": "1156329c9d2a7dc83fe5d2b21f016da64a92ed41bf9036e168b55492d7ffbfe7",
    "HIGH_END_CONSUMABLES": "cf2bcab609c5bd14f42ed2b88d5d7a90bcf50223a0e9911ee4898cf0a8990ee2",
    "IMPROVED_MODULES": "661735ec890c8cb0a347cbf5a50d44dd9cd7263570940b226df40fc8ca121dce",
    "IMPROVED_SUSPENSION": "bd079b80a695176b605cbb3b73bf0788486af7b9d709dcbce15032492030e6f0",
    "IMPROVED_VERTICAL_STABILIZER": "24b63d5f388efc99656b8cfb49e28a11392f0e09cccc94ede987ba0270e29e2c",
    "SUPERCHARGER": "0f2e9f23464d2c40946f7aa7e9298de68c952c0e88aea4eb447c2009868b5ae3",
    "TOOLBOX": "52fee812f9b6f29421a8f55eaa0f0f5634ac8e7f9a69796a5cd9d7f30c451322",
}


def normalize_description(description):
    return " ".join((description or "").lower().split())


def description_sha256(description):
    return hashlib.sha256(normalize_description(description).encode("utf-8")).hexdigest()


def locked_definition_hashes(payload, equipment_pb):
    raw_by_id = {}
    root = decode_protobuf(equipment_pb)
    for raw_entry in root.get(2, []):
        entry = decode_protobuf(raw_entry)
        equipment_id = as_int(f1(entry, 1))
        definition = f1(entry, 2, b"")
        if equipment_id is not None and isinstance(definition, (bytes, bytearray)):
            raw_by_id[equipment_id] = bytes(definition)

    result = {}
    for code in LOCKED_DEFINITION_SHA256:
        item = item_by_code(payload, code)
        definition = raw_by_id.get(item["id"])
        if definition is None:
            raise RuntimeError("BLITZKIT_LOCKED_DEFINITION_MISSING: " + code)
        result[code] = hashlib.sha256(definition).hexdigest()
    return result


def validate_locked_definition_contract(payload, equipment_pb):
    if set(LOCKED_DEFINITION_SHA256) != set(LOCKED_DESCRIPTION_SHA256):
        raise RuntimeError("LOCKED_EQUIPMENT_CONTRACT_CONFIG_MISMATCH")
    actual = locked_definition_hashes(payload, equipment_pb)
    for code, expected_hash in LOCKED_DEFINITION_SHA256.items():
        if actual[code] != expected_hash:
            raise RuntimeError(
                "BLITZKIT_LOCKED_DEFINITION_CHANGED: %s expected=%s actual=%s; "
                "review this locked item's complete effect model before updating the lock"
                % (code, expected_hash, actual[code])
            )
    return True


def validate_locked_description_contract(payload, details):
    for code, expected_hash in LOCKED_DESCRIPTION_SHA256.items():
        item = item_by_code(payload, code)
        detail = details.get(item["id"])
        if not detail:
            raise RuntimeError("BLITZKIT_EQUIPMENT_DESCRIPTION_MISSING: " + code)
        actual_hash = description_sha256(detail.get("description") or "")
        if actual_hash != expected_hash:
            raise RuntimeError(
                "BLITZKIT_LOCKED_DESCRIPTION_CHANGED: %s expected=%s actual=%s"
                % (code, expected_hash, actual_hash)
            )
    return True


def validate_locked_contract(payload, details):
    """Compatibility wrapper for description-only unit fixtures."""
    return validate_locked_description_contract(payload, details)


def validate_locked_contract_from_pb(payload, equipment_pb):
    validate_locked_definition_contract(payload, equipment_pb)
    return validate_locked_description_contract(payload, parse_equipment_details(equipment_pb))
