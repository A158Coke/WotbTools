#!/usr/bin/env python3
"""Fail-closed locks for equipment whose numeric effects are not fully modeled."""

import hashlib

from update_equipment import item_by_code, parse_equipment_details

# Locked effects cannot be derived completely from BlitzKit calculation code. The live
# equipment protobuf contains description templates (often with %(...) placeholders),
# so wording fingerprints alone cannot prove numeric values. A reviewed game-version
# lock therefore forces manual re-review whenever BlitzKit moves to another client version.
REVIEWED_GAME_VERSION = "11.19.0"

# SHA-256 of the normalized English description templates observed from the live
# BlitzKit equipment.pb while reviewing WoTB 11.19. Any template change fails closed.
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


def normalize_description(description):
    return " ".join((description or "").lower().split())


def description_sha256(description):
    normalized = normalize_description(description)
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()


def validate_reviewed_game_version(game_version):
    if game_version != REVIEWED_GAME_VERSION:
        raise RuntimeError(
            "BLITZKIT_LOCKED_REVIEW_REQUIRED: reviewed_game_version=%s upstream_game_version=%s; "
            "manually review locked equipment effects before updating the lock"
            % (REVIEWED_GAME_VERSION, game_version)
        )
    return True


def validate_locked_contract(payload, details):
    for code, expected_hash in LOCKED_DESCRIPTION_SHA256.items():
        item = item_by_code(payload, code)
        detail = details.get(item["id"])
        if not detail:
            raise RuntimeError("BLITZKIT_EQUIPMENT_DESCRIPTION_MISSING: " + code)
        description = detail.get("description") or ""
        actual_hash = description_sha256(description)
        if actual_hash != expected_hash:
            raise RuntimeError(
                "BLITZKIT_LOCKED_DESCRIPTION_CHANGED: %s expected=%s actual=%s"
                % (code, expected_hash, actual_hash)
            )
    return True


def validate_locked_contract_from_pb(payload, equipment_pb):
    return validate_locked_contract(payload, parse_equipment_details(equipment_pb))
