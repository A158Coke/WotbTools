#!/usr/bin/env python3
"""Helpers for fail-closed reads of mutable BlitzKit definition resources."""

import hashlib


def sha256_bytes(value):
    return hashlib.sha256(value).hexdigest()


def snapshot_hashes(snapshot):
    return {name: sha256_bytes(value) for name, value in snapshot.items()}


def fetch_stable_snapshot(resources, fetch_bytes, max_rounds=3):
    """Return a set of resources only after two consecutive full reads are byte-identical.

    BlitzKit's public definitions CDN does not currently expose a repository-side release
    manifest that this project can pin. The safest available boundary is therefore a
    stability barrier: read the entire resource set repeatedly and accept it only when
    two consecutive complete sets have identical per-resource SHA-256 hashes.

    If a release rolls out between files or between rounds, at least one hash changes and
    the sync aborts/retries instead of publishing a mixed transition snapshot.
    """
    if max_rounds < 2:
        raise ValueError("max_rounds must be at least 2")

    previous = None
    previous_hashes = None
    history = []

    for _ in range(max_rounds):
        current = {name: fetch_bytes(url) for name, url in resources.items()}
        current_hashes = snapshot_hashes(current)
        history.append(current_hashes)
        if previous_hashes == current_hashes:
            return current, current_hashes
        previous = current
        previous_hashes = current_hashes

    changed = []
    if len(history) >= 2:
        before, after = history[-2], history[-1]
        changed = sorted(name for name in resources if before.get(name) != after.get(name))
    raise RuntimeError(
        "BLITZKIT_SNAPSHOT_UNSTABLE: no two consecutive complete reads matched; changed=%s hashes=%s"
        % (changed, history)
    )
