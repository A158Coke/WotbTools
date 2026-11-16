"""Opaque auxiliary binary metadata reporting."""
from __future__ import annotations
import re
import struct
import zipfile
from typing import Any
from wotb_sc2 import Sc2ParseError
from _inspect_map_archive import normalize_member, resolve_auxiliary_member
from _inspect_map_data import add_sample


ASCII_RUN_RE = re.compile(rb"[\x20-\x7e]{4,}")


AUXILIARY_EXTENSIONS = {".mkm", ".lka"}


def inspect_auxiliary_resources(
    archive: zipfile.ZipFile,
    scene_member: zipfile.ZipInfo,
    report: dict[str, Any],
    sample_limit: int,
    decode_dvpl_fn,
) -> list[dict[str, Any]]:
    references = report["resourceReferences"]["unique"]
    results: list[dict[str, Any]] = []
    for reference in references:
        if reference["extension"] not in AUXILIARY_EXTENSIONS:
            continue
        value = str(reference["value"])
        member = resolve_auxiliary_member(archive, scene_member, value)
        if member is None:
            results.append(
                {
                    "reference": value,
                    "extension": reference["extension"],
                    "resolved": False,
                }
            )
            continue

        raw = archive.read(member)
        dvpl_footer = None
        if len(raw) >= 20 and raw[-4:] == b"DVPL":
            unpacked_size, packed_size, crc32, compression_raw, magic = struct.unpack_from(
                "<III4s4s", raw, len(raw) - 20
            )
            dvpl_footer = {
                "unpackedSize": unpacked_size,
                "packedSize": packed_size,
                "crc32": f"{crc32:08x}",
                "compressionType": compression_raw[0],
                "magic": magic.decode("ascii", errors="replace"),
            }

        try:
            decoded = (
                decode_dvpl_fn(raw)
                if normalize_member(member.filename).lower().endswith(".dvpl")
                else raw
            )
        except Sc2ParseError as error:
            results.append(
                {
                    "reference": value,
                    "extension": reference["extension"],
                    "resolved": True,
                    "archiveMember": normalize_member(member.filename),
                    "compressedBytes": member.compress_size,
                    "storedBytes": member.file_size,
                    "dvplFooter": dvpl_footer,
                    "decodeError": str(error),
                    "interpretation": "OPAQUE_BINARY_DECODE_BLOCKED",
                }
            )
            continue

        strings = []
        for match in ASCII_RUN_RE.finditer(decoded):
            value_text = match.group(0).decode("ascii", errors="replace")
            if value_text not in strings:
                add_sample(strings, value_text[:160], sample_limit)
        head_u32 = [
            struct.unpack_from("<I", decoded, offset)[0]
            for offset in range(0, min(len(decoded) - len(decoded) % 4, 32), 4)
        ]
        results.append(
            {
                "reference": value,
                "extension": reference["extension"],
                "resolved": True,
                "archiveMember": normalize_member(member.filename),
                "compressedBytes": member.compress_size,
                "storedBytes": member.file_size,
                "dvplFooter": dvpl_footer,
                "decodedBytes": len(decoded),
                "headHex": decoded[:64].hex(),
                "headAscii": "".join(chr(byte) if 32 <= byte <= 126 else "." for byte in decoded[:64]),
                "headUint32Le": head_u32,
                "asciiStringSamples": strings,
                "interpretation": "OPAQUE_BINARY_UNCLASSIFIED",
            }
        )
    return results
