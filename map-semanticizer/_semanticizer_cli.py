"""Command-line entry point for map semantic generation."""
from __future__ import annotations
import argparse
import json
import pathlib
import sys
import tempfile
import zipfile
from _semanticizer_binary import SemanticizerError
from _semanticizer_pipeline import semanticize


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Generate auditable WoT Blitz map semantics from SC2 + heightmap resources."
    )
    parser.add_argument("input", type=pathlib.Path, help="Map directory or ZIP file")
    parser.add_argument(
        "--output-dir", type=pathlib.Path, default=pathlib.Path("semantic-output")
    )
    parser.add_argument(
        "--variant",
        default="auto",
        help="Battle variant label (e.g. dt1/cn0); default: auto-detect from SC2 labels",
    )
    parser.add_argument("--grid-size", type=int, default=6, help="Grid cells per axis; default: 6")
    parser.add_argument("--map-id", help="Override the map id inferred from the SC2 filename")
    parser.add_argument(
        "--map-code",
        action="append",
        help="WotBTools internal map code (meta.json mapName, e.g. desert_train); repeatable",
    )
    parser.add_argument(
        "--map-names-file",
        type=pathlib.Path,
        help="common/map_names.json: derive mapCodes for each generated map in batch mode",
    )
    parser.add_argument("--display-name", help="Human-readable map name")
    parser.add_argument(
        "--batch",
        action="store_true",
        help="Treat input as a Maps root and process each immediate map directory",
    )
    return parser


def main() -> int:
    args = build_parser().parse_args()
    if not 3 <= args.grid_size <= 12:
        print("error: --grid-size must be between 3 and 12", file=sys.stderr)
        return 2
    source = args.input.expanduser().resolve()
    output_dir = args.output_dir.expanduser().resolve()
    try:
        if args.batch:
            if not source.is_dir():
                raise SemanticizerError("--batch requires a Maps directory")
            if args.map_id or args.display_name or args.map_code:
                raise SemanticizerError(
                    "--map-id, --display-name and --map-code cannot be used with --batch"
                )
            known_map_names = load_map_names(args.map_names_file)
            known_codes = list(known_map_names.keys())
            candidates = sorted(path for path in source.iterdir() if path.is_dir())
            processed = []
            failures = []
            for candidate in candidates:
                try:
                    json_path, text_path = semanticize(
                        candidate,
                        output_dir,
                        args.variant,
                        args.grid_size,
                        None,
                        None,
                        None,
                        known_codes,
                        known_map_names,
                    )
                    processed.append((json_path, text_path))
                    print(f"OK: {candidate.name} -> {text_path.name}")
                except (OSError, ValueError, SemanticizerError) as error:
                    failures.append((candidate.name, str(error)))
                    print(f"SKIP: {candidate.name}: {error}", file=sys.stderr)
            if not processed:
                raise SemanticizerError("No map directory was successfully processed")
            print(f"Processed: {len(processed)}; failed/skipped: {len(failures)}")
            return 1 if failures else 0
        if source.is_dir():
            json_path, text_path = semanticize(
                source,
                output_dir,
                args.variant,
                args.grid_size,
                args.map_id,
                args.display_name,
                args.map_code,
                None,
                None,
            )
        elif source.is_file() and source.suffix.lower() == ".zip":
            with tempfile.TemporaryDirectory(prefix="wotb-map-") as temporary:
                temporary_root = pathlib.Path(temporary)
                with zipfile.ZipFile(source) as archive:
                    archive.extractall(temporary_root)
                json_path, text_path = semanticize(
                    temporary_root,
                    output_dir,
                    args.variant,
                    args.grid_size,
                    args.map_id,
                    args.display_name,
                    args.map_code,
                    None,
                    None,
                )
        else:
            raise SemanticizerError(f"Input must be a map directory or ZIP: {source}")
    except (OSError, ValueError, zipfile.BadZipFile, SemanticizerError) as error:
        print(f"error: {error}", file=sys.stderr)
        return 1
    print(f"JSON: {json_path}")
    print(f"LLM text: {text_path}")
    return 0


def load_map_names(path: pathlib.Path | None) -> dict[str, dict[str, str]]:
    if path is None:
        return {}
    with path.open(encoding="utf-8") as handle:
        data = json.load(handle)
    if not isinstance(data, dict):
        raise SemanticizerError(f"--map-names-file must be a JSON object: {path}")
    return {str(key): value for key, value in data.items() if isinstance(value, dict)}
