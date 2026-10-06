#!/usr/bin/env python3
"""Deterministic Android version and Native Bridge contract gates."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
import zipfile
from datetime import datetime, timezone
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


def frontend_bridge_versions(source: str) -> list[int]:
    array_match = re.search(
        r"SUPPORTED_NATIVE_BRIDGE_VERSIONS\s*=\s*Object\.freeze\(\[([^\]]*)\]\)",
        source,
    )
    if array_match:
        return [int(value) for value in re.findall(r"\b[0-9]+\b", array_match.group(1))]
    legacy_match = re.search(r"SUPPORTED_NATIVE_BRIDGE_VERSION\s*=\s*(\d+)", source)
    return [int(legacy_match.group(1))] if legacy_match else []


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
    # Bridge v2 returns the resource URI in pending metadata. The reviewed local
    # runtime adds an origin while retaining both production compatibility origins;
    # it does not change the RPC or resource path/header/method semantics.
    local_origin_addition = (
        base.get("bridgeVersion") == head.get("bridgeVersion") == 2
        and base.get("origin") == "https://wotbtools.com"
        and head.get("origin") == "https://appassets.androidplatform.net"
        and {base["origin"], head["origin"], "https://www.wotbtools.com"}
        <= set(head.get("allowedOrigins", []))
    )
    if base.get("origin") != head.get("origin") and not local_origin_addition:
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
                if (key == "url" and name == "pendingReplay" and local_origin_addition
                        and old.get("url") == base["origin"] + "/__native/replay-pending"
                        and new.get("url") == head["origin"] + "/__native/replay-pending"):
                    continue
                breaking.append(f"changed synthetic resource {name}.{key}")
        old_headers = set(old.get("requiredHeaders", []))
        new_headers = set(new.get("requiredHeaders", []))
        if old_headers != new_headers:
            breaking.append(f"changed required synthetic headers {name}")
    return breaking


def auth_surface(contract: dict) -> tuple[list[str], list[str], list[str]]:
    """The auth-owned part of the contract: methods, capabilities, and event globals."""
    methods = [name for name in contract.get("methods", {}) if name.startswith("auth")]
    capabilities = [name for name in contract.get("capabilities", []) if "auth" in name]
    globals_ = [
        event["global"]
        for event in contract.get("events", {}).values()
        if isinstance(event, dict) and event.get("global")
    ]
    return methods, capabilities, globals_


def validate_native_sources(contract: dict, paths: list[str]) -> None:
    source = "\n".join(Path(path).read_text(encoding="utf-8") for path in paths)
    # Resolve the actual canonical Kotlin reference, rather than demanding that
    # Native duplicate a full URL literal in ReplayIntentHandler.
    local = re.search(r'const\s+val\s+LOCAL_APP_ORIGIN\s*=\s*"([^"]+)"', source)
    resource_source = source
    if local:
        resource_source = re.sub(
            r'MainActivity\.LOCAL_APP_ORIGIN\s*\+\s*"([^"]+)"',
            lambda match: '"' + local.group(1) + match.group(1) + '"',
            source,
        )
    for method in contract.get("methods", {}):
        if f'"{method}"' not in source:
            fail(f"Native source does not implement contract method: {method}")
    origins = contract.get("allowedOrigins", [])
    for origin in origins:
        if origin not in source:
            fail(f"Native source is missing contract origin: {origin}")
    for capability in contract.get("capabilities", []):
        if capability not in source:
            fail(f"Native source does not advertise contract capability: {capability}")
    for event in contract.get("events", {}).values():
        if event.get("global") and event["global"] not in source:
            fail(f"Native source does not emit contract event: {event['global']}")
    for resource in contract.get("syntheticResources", {}).values():
        if resource.get("url") and resource["url"] not in resource_source:
            fail(f"Native source is missing synthetic resource URL: {resource['url']}")
        for header in resource.get("requiredHeaders", []):
            if header not in source:
                fail(f"Native source is missing synthetic resource header: {header}")


def validate_frontend_sources(contract: dict, paths: list[str]) -> None:
    """The browser client must declare the same native-auth surface the contract publishes.

    Only the auth-owned surface is asserted: the replay/update methods keep their own
    declarations. This is what makes "an Android shell never falls back to keycloak-js"
    a deterministic gate instead of a review convention.
    """
    source = "\n".join(Path(path).read_text(encoding="utf-8") for path in paths)
    methods, capabilities, globals_ = auth_surface(contract)
    for method in methods:
        if f"'{method}'" not in source and f'"{method}"' not in source:
            fail(f"Frontend source does not declare contract method: {method}")
    for capability in capabilities:
        if f"'{capability}'" not in source and f'"{capability}"' not in source:
            fail(f"Frontend source does not declare contract capability: {capability}")
    for name in globals_:
        if name not in source:
            fail(f"Frontend source does not handle contract event: {name}")


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
    supported_versions = frontend_bridge_versions(source)
    if bridge not in supported_versions:
        fail("frontend supported Native Bridge versions do not include the JSON contract")
    if args.native_source:
        validate_native_sources(contract, args.native_source)
    if args.frontend_source:
        validate_frontend_sources(contract, args.frontend_source)
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
    frontend_versions = {int(value) for value in args.frontend_versions.split(",") if value}
    if int(result["headBridgeVersion"] or 0) not in frontend_versions:
        fail("Frontend supported Native Bridge versions do not include the head contract")
    result.update({
        "runtimeChanged": runtime_changed,
        "baseVersion": ".".join(map(str, base_version)),
        "headVersion": ".".join(map(str, head_version)),
        "frontendBridgeVersions": sorted(frontend_versions),
    })
    print(json.dumps(result, sort_keys=True))


def apk_bundle_identity(apk_path: str, contract: dict, pin: dict, source: str, version: str) -> dict:
    """Prove the bundle from APK bytes, rather than trusting a workspace manifest."""
    if not re.fullmatch(r"[0-9a-f]{40}", source):
        fail("APK source must be a full commit SHA")
    with zipfile.ZipFile(apk_path) as apk:
        entries = [name for name in apk.namelist() if name.startswith("assets/web/") and not name.endswith("/")]
        if len(entries) != len(set(entries)):
            fail("APK bundle contains duplicate paths")
        manifest_bytes = apk.read("assets/web/bundle-manifest.json")
        manifest = json.loads(manifest_bytes)
        expected = {
            "schemaVersion": 2, "target": "android", "buildCommit": source,
            "runtimeOrigin": contract["origin"], "apiOrigin": "https://wotbtools.com",
            # /agent-assets 是本机路径：资产由 AgentAssetProxy 在 shouldInterceptRequest
            # 里原生直连对象存储（docs/operations/agent-asset-origin.md）。原生代码不受
            # CORS 约束，因此这里不允许也不需要回退到生产网关反代。
            "assetOrigin": "/agent-assets", "entry": "index.html",
            "agentWasm": {"commit": pin["ref"], "release": pin["artifact"]["release"]},
        }
        if contract["origin"] != "https://appassets.androidplatform.net":
            fail("APK runtime contract must use the trusted local origin")
        for key, value in expected.items():
            if manifest.get(key) != value:
                fail(f"APK bundle identity mismatch: {key}")
        runtime = manifest.get("nativeRuntime", {})
        if not isinstance(runtime, dict):
            fail("APK bundle must declare its native runtime")
        auth_methods, _, _ = auth_surface(contract)
        auth_event = contract.get("events", {}).get("authChanged", {}).get("global")
        if (runtime.get("supportedBridgeVersions") != [contract["bridgeVersion"]]
                or runtime.get("nativeAuthCapability") != "native-auth"
                or sorted(runtime.get("nativeAuthMethods", [])) != sorted(auth_methods)
                or runtime.get("authChangedGlobal") != auth_event):
            fail("APK native-auth / bridge surface does not match the staged contract")
        records = manifest.get("files", [])
        paths = [record["path"] for record in records]
        actual = {name[len("assets/web/"):] for name in entries} - {"bundle-manifest.json"}
        if len(paths) != len(set(paths)) or set(paths) != actual or manifest.get("fileCount") != len(actual):
            fail("APK bundle file inventory does not match its manifest")
        total = 0
        for record in records:
            data = apk.read("assets/web/" + record["path"])
            if record.get("size") != len(data) or record.get("sha256") != hashlib.sha256(data).hexdigest():
                fail(f"APK bundle file integrity mismatch: {record['path']}")
            total += len(data)
        if manifest.get("totalBytes") != total:
            fail("APK bundle total byte count does not match its manifest")
        for name, digest_key in [("index.html", "entrySha256"), (f"wasm/{pin['ref']}/wotb_replay_wasm_bg.wasm", "agentWasmSha256")]:
            if hashlib.sha256(apk.read("assets/web/" + name)).hexdigest() != manifest.get(digest_key):
                fail(f"APK bundle required file hash mismatch: {name}")
        apk.read(f"assets/web/wasm/{pin['ref']}/wotb_replay_wasm.js")
    with open(apk_path, "rb") as apk_file:
        apk_sha = hashlib.sha256(apk_file.read()).hexdigest()
    apk_name = f"wotbtools-android-v{version}.apk"
    return {
        "schemaVersion": 2, "versionCode": version_code(parse_version(version)), "versionName": version,
        "nativeBridgeVersion": contract["bridgeVersion"], "sourceSha": source,
        "tag": f"android-v{version}", "apkName": apk_name,
        "apkUrl": f"https://wotbtools.com/download/android/{apk_name}",
        "sha256": apk_sha,
        "bundleManifestSha256": hashlib.sha256(manifest_bytes).hexdigest(),
        "bundleFileCount": len(entries), "agentWasmRelease": pin["artifact"]["release"],
        "agentWasmCommit": pin["ref"], "runtimeOrigin": manifest["runtimeOrigin"],
        "apiOrigin": manifest["apiOrigin"], "assetOrigin": manifest["assetOrigin"], "nativeRuntime": runtime,
    }


def command_bundle(args: argparse.Namespace) -> None:
    validate_apk_version(Path(args.badging).read_text(encoding="utf-8"), args.version)
    identity = apk_bundle_identity(args.apk, load_json(args.contract), load_json(args.pin), args.source, args.version)
    if args.evidence:
        evidence = load_json(args.evidence)
        for key, value in identity.items():
            if evidence.get(key) != value:
                fail(f"Staging evidence does not match APK bytes: {key}")
        try:
            datetime.strptime(evidence["stagedAt"], "%Y-%m-%dT%H:%M:%SZ")
        except (KeyError, ValueError, TypeError):
            fail("Staging evidence has no valid stagedAt timestamp")
        identity = evidence
    else:
        identity["stagedAt"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    result = json.dumps(identity, indent=2) + "\n"
    if args.output:
        Path(args.output).write_text(result, encoding="utf-8")
    else:
        print(result, end="")


def validate_apk_version(badging: str, version: str) -> None:
    package = re.search(r"^package: name='([^']+)' versionCode='([0-9]+)' versionName='([^']+)'", badging, re.MULTILINE)
    if not package or package.groups() != ("com.wotbtools.app", str(version_code(parse_version(version))), version):
        fail("APK AndroidManifest package/version differs from the committed release")


def validate_cors(status: int, headers: dict, origin: str, methods: list[str], request_headers: list[str], expected_status: int | None = None) -> None:
    if (expected_status is None and not 200 <= status < 300) or (expected_status is not None and status != expected_status):
        fail(f"CORS readiness returned HTTP {status}")
    if headers.get("access-control-allow-origin") != origin:
        fail("CORS readiness must return the exact trusted local origin")
    if headers.get("access-control-allow-credentials", "").lower() == "true":
        fail("Native Bearer API must not enable credentialed CORS")
    exposed = {value.strip().lower() for value in headers.get("access-control-expose-headers", "").split(",")}
    if not {"content-disposition", "x-request-id", "x-map-meta"}.issubset(exposed):
        fail("CORS readiness is missing required exposed response headers")
    allowed_methods = {value.strip().upper() for value in headers.get("access-control-allow-methods", "").split(",")}
    allowed_headers = {value.strip().lower() for value in headers.get("access-control-allow-headers", "").split(",")}
    if not set(methods).issubset(allowed_methods) or not set(request_headers).issubset(allowed_headers):
        fail("CORS readiness is missing required methods or headers")


def command_cors(args: argparse.Namespace) -> None:
    headers = {}
    for line in Path(args.headers).read_text(encoding="utf-8").splitlines():
        if line.startswith("HTTP/"):
            headers = {}  # curl may include an intermediary CONNECT response.
        elif ":" in line:
            name, value = line.split(":", 1)
            name = name.lower().strip()
            headers[name] = headers.get(name, "") + (", " if name in headers else "") + value.strip()
    validate_cors(int(args.status), headers, args.origin, args.methods.split(",") if args.methods else [], args.request_headers.split(",") if args.request_headers else [], args.expected_status)
    print("Exact-origin CORS readiness verified")


def main() -> None:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)
    p = sub.add_parser("bundle"); p.add_argument("--apk", required=True); p.add_argument("--badging", required=True); p.add_argument("--contract", required=True); p.add_argument("--pin", required=True); p.add_argument("--source", required=True); p.add_argument("--version", required=True); p.add_argument("--evidence"); p.add_argument("--output"); p.set_defaults(func=command_bundle)
    p = sub.add_parser("cors"); p.add_argument("--headers", required=True); p.add_argument("--status", required=True); p.add_argument("--origin", required=True); p.add_argument("--methods", default=""); p.add_argument("--request-headers", default=""); p.add_argument("--expected-status", type=int); p.set_defaults(func=command_cors)
    p = sub.add_parser("version"); p.add_argument("version"); p.set_defaults(func=command_version)
    p = sub.add_parser("validate"); p.add_argument("--contract", required=True); p.add_argument("--gradle-properties", required=True); p.add_argument("--frontend", required=True); p.add_argument("--native-source", action="append", default=[]); p.add_argument("--frontend-source", action="append", default=[]); p.set_defaults(func=command_validate)
    p = sub.add_parser("version-bump"); p.add_argument("--base-version", required=True); p.add_argument("--head-version", required=True); p.add_argument("--paths", required=True); p.set_defaults(func=command_bump)
    p = sub.add_parser("gate"); p.add_argument("--base-contract", required=True); p.add_argument("--head-contract", required=True); p.add_argument("--base-version", required=True); p.add_argument("--head-version", required=True); p.add_argument("--paths", required=True); p.add_argument("--frontend-versions", required=True); p.add_argument("--initial-version-baseline", action="store_true"); p.set_defaults(func=command_gate)
    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
