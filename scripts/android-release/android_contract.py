#!/usr/bin/env python3
"""Deterministic Android version and Native Bridge contract gates."""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

SEMVER = re.compile(r"^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$")


def fail(message: str) -> None:
    print(message, file=sys.stderr)
    raise SystemExit(1)


def parse_version(value: str) -> tuple[int, int, int]:
    match = SEMVER.fullmatch(value)
    if not match:
        fail(f"Invalid Android version: expected strict X.Y.Z, got {value!r}")
    parts = tuple(int(part) for part in match.groups())
    if len(str(parts[0])) > 4 or parts[1] > 999 or parts[2] > 999:
        fail(f"Android version segment out of range: {value!r}")
    code = version_code(parts)
    if not 1 <= code <= 2_100_000_000:
        fail(f"Android versionCode out of range: {code}")
    return parts


def version_code(parts: tuple[int, int, int]) -> int:
    major, minor, patch = parts
    return major * 1_000_000 + minor * 1_000 + patch


def properties(text: str) -> dict[str, str]:
    result: dict[str, str] = {}
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        result[key.strip()] = value.strip()
    return result


def load_json(path: str | Path) -> dict:
    return json.loads(Path(path).read_text(encoding="utf-8"))


def runtime_path(path: str) -> bool:
    path = path.replace("\\", "/")
    if not path.startswith("android/"):
        return False
    if "/src/test/" in path or "/src/testFixtures/" in path or "/src/androidTest/" in path:
        return False
    if path.startswith("android/app/src/main/"):
        return True
    if path in {
        "android/build.gradle.kts",
        "android/settings.gradle.kts",
        "android/gradle.properties",
        "android/gradle/libs.versions.toml",
    }:
        return True
    return path.startswith("android/gradle/") or path.endswith(("/build.gradle", ".gradle", ".gradle.kts", ".pro"))


def field_breaking(prefix: str, base: dict, head: dict, breaking: list[str]) -> None:
    for name, old in base.items():
        if name not in head:
            breaking.append(f"removed {prefix}.{name}")
            continue
        new = head[name]
        if old.get("type") != new.get("type"):
            breaking.append(f"changed type {prefix}.{name}: {old.get('type')} -> {new.get('type')}")
        if old.get("required", False) and not new.get("required", False):
            # Relaxing a requirement is backward compatible.
            continue
        if not old.get("required", False) and new.get("required", False):
            breaking.append(f"made field required {prefix}.{name}")
    for name, new in head.items():
        if name not in base and new.get("required", False):
            breaking.append(f"added required {prefix}.{name}")


def contract_breaking_changes(base: dict, head: dict) -> list[str]:
    breaking: list[str] = []
    if base.get("origin") != head.get("origin"):
        breaking.append("changed bridge origin")
    if not set(base.get("allowedOrigins", [])) <= set(head.get("allowedOrigins", [])):
        breaking.append("removed allowed bridge origin")
    for envelope in ("request", "response"):
        if base.get("rpc", {}).get(envelope) != head.get("rpc", {}).get(envelope):
            breaking.append(f"changed rpc envelope {envelope}")
    base_methods = base.get("methods", {})
    head_methods = head.get("methods", {})
    for name in base_methods:
        if name not in head_methods:
            breaking.append(f"removed method {name}")
            continue
        old_method, new_method = base_methods[name], head_methods[name]
        field_breaking(
            f"methods.{name}.request.fields",
            old_method.get("request", {}).get("fields", {}),
            new_method.get("request", {}).get("fields", {}),
            breaking,
        )
        old_response, new_response = old_method.get("response", {}), new_method.get("response", {})
        if old_response.get("type") != new_response.get("type"):
            breaking.append(f"changed response type {name}: {old_response.get('type')} -> {new_response.get('type')}")
        if old_response.get("nullable", False) and not new_response.get("nullable", False):
            breaking.append(f"response is no longer nullable {name}")
        field_breaking(
            f"methods.{name}.response.fields",
            old_response.get("fields", {}),
            new_response.get("fields", {}),
            breaking,
        )
    old_resources = base.get("syntheticResources", {})
    new_resources = head.get("syntheticResources", {})
    for name, old in old_resources.items():
        new = new_resources.get(name)
        if new is None:
            breaking.append(f"removed synthetic resource {name}")
            continue
        for key in ("method", "url", "failure"):
            if old.get(key) != new.get(key):
                breaking.append(f"changed synthetic resource {name}.{key}")
        old_headers = set(old.get("requiredHeaders", []))
        new_headers = set(new.get("requiredHeaders", []))
        if old_headers != new_headers:
            breaking.append(f"changed required synthetic headers {name}")
    return breaking


def validate_native_sources(contract: dict, paths: list[str]) -> None:
    source = "\n".join(Path(path).read_text(encoding="utf-8") for path in paths)
    for method in contract.get("methods", {}):
        if f'"{method}"' not in source:
            fail(f"Native source does not implement contract method: {method}")
    origins = contract.get("allowedOrigins", [])
    for origin in origins:
        if origin not in source:
            fail(f"Native source is missing contract origin: {origin}")
    for resource in contract.get("syntheticResources", {}).values():
        if resource.get("url") and resource["url"] not in source:
            fail(f"Native source is missing synthetic resource URL: {resource['url']}")
        for header in resource.get("requiredHeaders", []):
            if header not in source:
                fail(f"Native source is missing synthetic resource header: {header}")


def contract_result(base: dict, head: dict) -> dict:
    breaking = contract_breaking_changes(base, head)
    return {
        "breaking": bool(breaking),
        "breakingChanges": breaking,
        "baseBridgeVersion": base.get("bridgeVersion"),
        "headBridgeVersion": head.get("bridgeVersion"),
    }


def command_version(args: argparse.Namespace) -> None:
    parts = parse_version(args.version)
    print(json.dumps({"versionName": args.version, "versionCode": version_code(parts), "tagName": f"android-v{args.version}", "apkName": f"wotbtools-android-v{args.version}.apk"}))


def command_validate(args: argparse.Namespace) -> None:
    contract = load_json(args.contract)
    props = properties(Path(args.gradle_properties).read_text(encoding="utf-8"))
    parts = parse_version(props.get("wotbVersion", ""))
    bridge = contract.get("bridgeVersion")
    if not isinstance(bridge, int) or bridge < 1:
        fail("bridgeVersion must be a positive integer")
    if props.get("wotbNativeBridgeVersion") != str(bridge):
        fail("gradle.properties bridge version does not match the JSON contract")
    source = Path(args.frontend).read_text(encoding="utf-8")
    match = re.search(r"SUPPORTED_NATIVE_BRIDGE_VERSION\s*=\s*(\d+)", source)
    if not match or int(match.group(1)) != bridge:
        fail("frontend supported Native Bridge version does not match the JSON contract")
    if args.native_source:
        validate_native_sources(contract, args.native_source)
    print(json.dumps({"versionName": props["wotbVersion"], "versionCode": version_code(parts), "bridgeVersion": bridge}))


def command_bump(args: argparse.Namespace) -> None:
    base = parse_version(args.base_version)
    head = parse_version(args.head_version)
    paths = [line.strip() for line in Path(args.paths).read_text(encoding="utf-8").splitlines() if line.strip()]
    changed = any(runtime_path(path) for path in paths)
    if changed and version_code(head) <= version_code(base):
        fail(f"Android runtime changed but versionCode did not increase: {args.base_version} -> {args.head_version}")
    print(json.dumps({"runtimeChanged": changed, "baseVersionCode": version_code(base), "headVersionCode": version_code(head)}))


def command_gate(args: argparse.Namespace) -> None:
    base = load_json(args.base_contract)
    head = load_json(args.head_contract)
    result = contract_result(base, head)
    base_version = parse_version(args.base_version)
    head_version = parse_version(args.head_version)
    paths = [line.strip() for line in Path(args.paths).read_text(encoding="utf-8").splitlines() if line.strip()]
    runtime_changed = any(runtime_path(path) for path in paths)
    if version_code(head_version) < version_code(base_version):
        fail("Android committed version cannot decrease")
    if runtime_changed and version_code(head_version) <= version_code(base_version) and not args.initial_version_baseline:
        fail("Android runtime changed but committed version did not increase")
    if result["breaking"] and int(result["headBridgeVersion"] or 0) <= int(result["baseBridgeVersion"] or 0):
        fail("Breaking Native Bridge changes require bridgeVersion to increase")
    if int(result["headBridgeVersion"] or 0) != int(args.frontend_version):
        fail("Frontend supported Native Bridge version does not match the head contract")
    result.update({"runtimeChanged": runtime_changed, "baseVersion": ".".join(map(str, base_version)), "headVersion": ".".join(map(str, head_version))})
    print(json.dumps(result, sort_keys=True))


def main() -> None:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)
    p = sub.add_parser("version"); p.add_argument("version"); p.set_defaults(func=command_version)
    p = sub.add_parser("validate"); p.add_argument("--contract", required=True); p.add_argument("--gradle-properties", required=True); p.add_argument("--frontend", required=True); p.add_argument("--native-source", action="append", default=[]); p.set_defaults(func=command_validate)
    p = sub.add_parser("version-bump"); p.add_argument("--base-version", required=True); p.add_argument("--head-version", required=True); p.add_argument("--paths", required=True); p.set_defaults(func=command_bump)
    p = sub.add_parser("gate"); p.add_argument("--base-contract", required=True); p.add_argument("--head-contract", required=True); p.add_argument("--base-version", required=True); p.add_argument("--head-version", required=True); p.add_argument("--paths", required=True); p.add_argument("--frontend-version", required=True, type=int); p.add_argument("--initial-version-baseline", action="store_true"); p.set_defaults(func=command_gate)
    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
