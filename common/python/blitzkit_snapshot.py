#!/usr/bin/env python3
"""Helpers for fail-closed reads of mutable BlitzKit definition resources."""

import hashlib

GAME_URL = "https://assets.blitzkit.app/definitions/game.pb"


def sha256_bytes(value):
    return hashlib.sha256(value).hexdigest()


def snapshot_hashes(snapshot):
    return {name: sha256_bytes(value) for name, value in snapshot.items()}


def fetch_stable_snapshot(resources, fetch_bytes, max_rounds=3):
    """Return resources only after two consecutive complete reads are byte-identical.

    BlitzKit exposes game.pb with the client game version, but no public manifest
    binding each definition protobuf to a release revision. We therefore use two
    defenses together: a stability barrier across the whole resource set and a
    recorded game version/hash identity for traceability. This is deliberately
    described as a stable snapshot, not an atomic release guarantee.
    """
    if max_rounds < 2:
        raise ValueError("max_rounds must be at least 2")

    previous_hashes = None
    history = []

    for _ in range(max_rounds):
        current = {name: fetch_bytes(url) for name, url in resources.items()}
        current_hashes = snapshot_hashes(current)
        history.append(current_hashes)
        if previous_hashes == current_hashes:
            return current, current_hashes
        previous_hashes = current_hashes

    before, after = history[-2], history[-1]
    changed = sorted(name for name in resources if before.get(name) != after.get(name))
    raise RuntimeError(
        "BLITZKIT_SNAPSHOT_UNSTABLE: no two consecutive complete reads matched; changed=%s hashes=%s"
        % (changed, history)
    )


def parse_game_version(game_pb, decode_protobuf, f1, as_str):
    root = decode_protobuf(game_pb)
    version = as_str(f1(root, 1, b""))
    if not version:
        raise RuntimeError("BLITZKIT_GAME_VERSION_MISSING")
    return version
