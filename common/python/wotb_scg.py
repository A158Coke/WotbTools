"""Minimal WoT Blitz / DAVA SCPG (.scg) reader for map-geometry research.

The outer DVPL layer is handled by :mod:`wotb_sc2`.  SCPG itself is a small
header followed by ``nodeCount`` DAVA KeyedArchives.  This module deliberately
reuses the repository's existing ``Reader`` / ``read_archive`` implementation
instead of introducing a second KeyedArchive decoder.

Reference format documentation:
https://github.com/Pyogenics/WOTBSCPGFormat/wiki/SCG-file-format
"""

from __future__ import annotations

from typing import Any

from wotb_sc2 import Reader, Sc2ParseError, read_archive


SCG_MAGIC = b"SCPG"
MAX_REASONABLE_NODE_COUNT = 1_000_000


def read_scg(raw: bytes) -> dict[str, Any]:
    """Decode an SCPG payload after DVPL decompression.

    Known WotB SCPG v1 layout:

    ``SCPG | uint32 version | uint32 nodeCount | uint32 nodeCount2 | KA...``

    The two node counts are expected to agree.  A mismatch is retained as a
    warning rather than silently choosing a different count.
    """

    reader = Reader(raw)
    if reader.take(4) != SCG_MAGIC:
        raise Sc2ParseError("Geometry resource is not an SCPG (.scg) payload")

    version = reader.u32()
    node_count = reader.u32()
    node_count2 = reader.u32()
    if node_count > MAX_REASONABLE_NODE_COUNT:
        raise Sc2ParseError(f"Unreasonable SCPG node count: {node_count}")

    warnings: list[str] = []
    if version != 1:
        warnings.append(f"SCPG version is {version}; public reference documents version 1")
    if node_count != node_count2:
        warnings.append(
            f"SCPG duplicated node counts differ: nodeCount={node_count}, nodeCount2={node_count2}"
        )

    polygon_groups = [read_archive(reader) for _ in range(node_count)]
    trailing_bytes = len(raw) - reader.offset
    if trailing_bytes:
        warnings.append(f"SCPG has {trailing_bytes} trailing bytes after declared polygon groups")

    return {
        "$metadata": {
            "version": version,
            "declaredNodeCount": node_count,
            "declaredNodeCount2": node_count2,
            "parsedBytes": reader.offset,
            "fileBytes": len(raw),
            "trailingBytes": trailing_bytes,
            "warnings": warnings,
        },
        "polygonGroups": polygon_groups,
    }
