from pathlib import Path

from PIL import Image, ImageFilter

MAPS_DIR = Path("frontend/src/assets/maps")
SCALE = 2
EXPECTED_MAP_COUNT = 28

paths = sorted(MAPS_DIR.glob("*.png"))
if len(paths) != EXPECTED_MAP_COUNT:
    raise RuntimeError(f"Expected {EXPECTED_MAP_COUNT} map PNGs, found {len(paths)}")

for path in paths:
    with Image.open(path) as src:
        src.load()
        original_size = src.size
        target_size = (src.width * SCALE, src.height * SCALE)

        # Geometry-preserving enhancement only: deterministic 2x resampling plus
        # conservative sharpening. No generative/synthesis model is used.
        out = src.resize(target_size, Image.Resampling.LANCZOS)
        out = out.filter(ImageFilter.UnsharpMask(radius=1.0, percent=110, threshold=3))

        save_kwargs = {
            "format": "PNG",
            "optimize": True,
            "compress_level": 9,
        }
        if src.info.get("icc_profile"):
            save_kwargs["icc_profile"] = src.info["icc_profile"]
        if src.info.get("dpi"):
            save_kwargs["dpi"] = src.info["dpi"]
        out.save(path, **save_kwargs)

    with Image.open(path) as check:
        if check.size != target_size:
            raise RuntimeError(f"{path}: expected {target_size}, got {check.size}")
        if check.width / check.height != target_size[0] / target_size[1]:
            raise RuntimeError(f"{path}: aspect ratio changed")

    print(f"{path.name}: {original_size[0]}x{original_size[1]} -> {target_size[0]}x{target_size[1]}")

print(f"Upscaled {len(paths)} map assets to 2x HD dimensions.")
