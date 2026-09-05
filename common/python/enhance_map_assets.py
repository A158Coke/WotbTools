#!/usr/bin/env python3
"""Conservative AI super-resolution for WotBTools tactical basemaps.

Original assets are never modified. Enhanced files are written to
``frontend/src/assets/maps-hd`` so the existing ``assets/maps`` directory remains
an exact rollback source.

This tool intentionally uses a small FSRCNN x2 super-resolution network instead
of a generative image model. Tactical-map geometry (roads, buildings, borders)
must remain spatially faithful; enhancement is limited to resolution recovery
plus a conservative unsharp pass.

Optional tooling dependencies (generation only, not application runtime):
    pip install opencv-contrib-python-headless pillow
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

import cv2
from PIL import Image, ImageFilter

REPO = Path(__file__).resolve().parents[2]
SOURCE_DIR = REPO / "frontend" / "src" / "assets" / "maps"
OUTPUT_DIR = REPO / "frontend" / "src" / "assets" / "maps-hd"
MANIFEST_PATH = OUTPUT_DIR / "manifest.json"


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def enhance(source: Path, target: Path, model_path: Path, quality: int) -> dict:
    image = cv2.imread(str(source), cv2.IMREAD_COLOR)
    if image is None:
        raise RuntimeError(f"Unable to decode source image: {source}")

    source_height, source_width = image.shape[:2]
    sr = cv2.dnn_superres.DnnSuperResImpl_create()
    sr.readModel(str(model_path))
    sr.setModel("fsrcnn", 2)
    upscaled = sr.upsample(image)

    # Small, deterministic sharpening pass. Avoid aggressive local contrast or
    # generative reconstruction because the tactical raster is authoritative for XY.
    rgb = cv2.cvtColor(upscaled, cv2.COLOR_BGR2RGB)
    pil = Image.fromarray(rgb)
    pil = pil.filter(ImageFilter.UnsharpMask(radius=1.0, percent=75, threshold=3))

    target.parent.mkdir(parents=True, exist_ok=True)
    pil.save(target, "WEBP", quality=quality, method=6, exact=True)

    with Image.open(target) as written:
        target_size = written.size

    return {
        "source": source.relative_to(REPO).as_posix(),
        "enhanced": target.relative_to(REPO).as_posix(),
        "method": "FSRCNN_X2_PLUS_CONSERVATIVE_UNSHARP",
        "sourcePixels": [source_width, source_height],
        "enhancedPixels": list(target_size),
        "sourceSha256": sha256(source),
        "enhancedSha256": sha256(target),
        "webpQuality": quality,
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("model", type=Path, help="Path to OpenCV FSRCNN_x2.pb")
    parser.add_argument("maps", nargs="*", help="Basemap stems or filenames; omit with --all")
    parser.add_argument("--all", action="store_true", help="Enhance every .webp in assets/maps")
    parser.add_argument("--quality", type=int, default=92)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    model_path = args.model.resolve()
    if not model_path.is_file():
        raise SystemExit(f"FSRCNN model not found: {model_path}")
    if not 1 <= args.quality <= 100:
        raise SystemExit("--quality must be 1..100")

    if args.all:
        sources = sorted(SOURCE_DIR.glob("*.webp"))
    else:
        if not args.maps:
            raise SystemExit("Provide one or more map names, or use --all")
        sources = []
        for name in args.maps:
            filename = name if name.endswith(".webp") else f"{name}.webp"
            source = SOURCE_DIR / filename
            if not source.is_file():
                raise SystemExit(f"Unknown basemap: {source}")
            sources.append(source)

    manifest = {
        "schemaVersion": 1,
        "policy": "ORIGINALS_PRESERVED_IN_ASSETS_MAPS",
        "entries": [],
    }
    if MANIFEST_PATH.is_file():
        try:
            previous = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
            if previous.get("schemaVersion") == 1:
                manifest = previous
        except (OSError, json.JSONDecodeError):
            pass

    entries_by_source = {entry["source"]: entry for entry in manifest.get("entries", [])}
    for source in sources:
        target = OUTPUT_DIR / source.name
        entry = enhance(source, target, model_path, args.quality)
        entries_by_source[entry["source"]] = entry
        print(
            f"{source.name}: {entry['sourcePixels'][0]}x{entry['sourcePixels'][1]} -> "
            f"{entry['enhancedPixels'][0]}x{entry['enhancedPixels'][1]}"
        )

    manifest["entries"] = [entries_by_source[key] for key in sorted(entries_by_source)]
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    MANIFEST_PATH.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"manifest -> {MANIFEST_PATH.relative_to(REPO)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
