from pathlib import Path
import re

from PIL import Image

MAPS_DIR = Path("frontend/src/assets/maps")
MAP_IMAGES = Path("frontend/src/data/mapImages.js")
MAP_DOC = Path("docs/reference/maps.md")
EXPECTED_MAP_COUNT = 28

paths = sorted(MAPS_DIR.glob("*.png"))
if len(paths) != EXPECTED_MAP_COUNT:
    raise RuntimeError(f"Expected {EXPECTED_MAP_COUNT} map PNGs, found {len(paths)}")

dimensions = {}
for path in paths:
    with Image.open(path) as image:
        dimensions[path.name] = image.size

js = MAP_IMAGES.read_text(encoding="utf-8")
imports = dict(re.findall(r"import\s+(\w+)\s+from\s+'\.\./assets/maps/([^']+)'", js))
if len(imports) != EXPECTED_MAP_COUNT:
    raise RuntimeError(f"Expected {EXPECTED_MAP_COUNT} map imports, found {len(imports)}")

registration = re.compile(
    r"(\w+): \{ src: (\w+), width: (\d+), height: (\d+), coordinateBounds: ([^}]+) \}"
)

updated_codes = []

def replace_registration(match):
    code, variable, _width, _height, bounds = match.groups()
    filename = imports.get(variable)
    if filename not in dimensions:
        return match.group(0)
    width, height = dimensions[filename]
    updated_codes.append(code)
    return (
        f"{code}: {{ src: {variable}, width: {width}, height: {height}, "
        f"coordinateBounds: {bounds} }}"
    )

new_js = registration.sub(replace_registration, js)
if len(updated_codes) != EXPECTED_MAP_COUNT:
    raise RuntimeError(
        f"Expected {EXPECTED_MAP_COUNT} registrations to update, updated {len(updated_codes)}"
    )
MAP_IMAGES.write_text(new_js, encoding="utf-8")

doc = MAP_DOC.read_text(encoding="utf-8")
for filename, (width, height) in dimensions.items():
    doc, replacements = re.subn(
        rf"{re.escape(filename)} \(\d+x\d+\)",
        f"{filename} ({width}x{height})",
        doc,
    )
    if replacements != 1:
        raise RuntimeError(
            f"{filename}: expected one catalog dimension entry, found {replacements}"
        )
MAP_DOC.write_text(doc, encoding="utf-8")

print(f"Updated registry and catalog dimensions for {EXPECTED_MAP_COUNT} map assets.")
