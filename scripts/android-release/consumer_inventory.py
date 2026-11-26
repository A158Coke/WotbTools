"""Read-only evidence for Android Agent asset consumers. See docs/operations/android-agent-consumers.md."""
import argparse
import json
import os
import re
import subprocess
import zipfile
from pathlib import Path

import android_contract as contract


def read_json(path):
    return json.loads(path.read_text(encoding="utf-8-sig"))


def remote_tags(lines):
    # ls-remote advertises both the tag object and its peeled commit for annotated tags.
    refs = {}
    for line in lines:
        sha, ref = line.split()
        match = re.fullmatch(r"refs/tags/android-v([0-9]+\.[0-9]+\.[0-9]+)(\^\{\})?", ref)
        if not match or not re.fullmatch(r"[0-9a-f]{40}", sha):
            raise ValueError(f"Unexpected Android tag ref: {ref}")
        if ref in refs:
            raise ValueError(f"Duplicate tag ref: {ref}")
        refs[ref] = sha
    if any(ref.endswith("^{}") and ref[:-3] not in refs for ref in refs):
        raise ValueError("Peeled tag has no advertised tag object")
    return {ref.removeprefix("refs/tags/android-v"): refs.get(ref + "^{}", sha)
            for ref, sha in refs.items() if not ref.endswith("^{}")}


def git_file(commit, path):
    return subprocess.check_output(["git", "show", f"{commit}:{path}"]).decode("utf-8")


def catalog(manifest, tags, historical):
    latest = manifest["latestVersionName"]
    ceiling = contract.version_code(contract.parse_version(latest))
    floor = manifest["minSupportedVersionCode"]
    if (type(floor) is not int or not 0 < floor <= ceiling or manifest["latestVersionCode"] != ceiling
            or latest not in tags or manifest["sourceSha"] != tags[latest]):
        raise ValueError("Production manifest and advertised release range disagree")
    if not set(historical) <= tags.keys():
        raise ValueError("Requested historical tag is absent")
    rows = []
    for version in sorted(tags, key=lambda s: contract.version_code(contract.parse_version(s))):
        code = contract.version_code(contract.parse_version(version))
        if not floor <= code <= ceiling and version not in historical:
            continue
        commit = tags[version]
        props = contract.properties(git_file(commit, "android/gradle.properties"))
        if props.get("wotbVersion") != version:
            raise ValueError(f"Tag and committed version disagree: {version}")
        bridge = json.loads(git_file(commit, "contracts/android-native-bridge.json"))
        if props.get("wotbNativeBridgeVersion") != str(bridge["bridgeVersion"]):
            raise ValueError(f"{version}: tagged Gradle and bridge contracts disagree")
        source = git_file(commit, "android/app/src/main/java/com/wotbtools/app/AgentAssetProxy.kt")
        rows.append({"version": version, "commit": commit, "tagOrigin": contract.parse_remote_asset_origin(source),
                     "bridge": bridge,
                     "pin": json.loads(git_file(commit, "deploy/agent/source.json"))})
    return {"manifest": manifest, "candidates": rows}


def verify_bundle(row, manifest, staging, apk):
    version = row["version"]
    # These are separate witnesses. Historical tags can move independently of published APKs.
    identity = contract.apk_bundle_identity(str(apk), row["bridge"], row["pin"], staging["sourceSha"], version)
    for field, value in identity.items():
        if staging.get(field) != value:
            raise ValueError(f"{version}: APK and staging disagree on {field}")
    size = apk.stat().st_size
    if "apkSizeBytes" in staging and staging["apkSizeBytes"] != size:
        raise ValueError(f"{version}: wrong staged APK length")
    if version == manifest["latestVersionName"]:
        for field, expected in (("sha256", identity["sha256"]), ("apkSizeBytes", size),
                                ("sourceSha", identity["sourceSha"]), ("latestVersionCode", identity["versionCode"]),
                                ("nativeBridgeVersion", identity["nativeBridgeVersion"]), ("apkUrl", identity["apkUrl"])):
            if manifest.get(field) != expected:
                raise ValueError(f"{version}: APK and live manifest disagree on {field}")
    if identity["assetOrigin"] != "/agent-assets":
        raise ValueError(f"{version}: bundle does not use the native Agent proxy")
    return {"version": version, "versionCode": identity["versionCode"], "tagCommit": row["commit"],
            "sourceSha": identity["sourceSha"], "tagMatchesStaging": row["commit"] == identity["sourceSha"],
            "apkSha256": identity["sha256"], "apkSizeBytes": size,
            "bundleManifestSha256": identity["bundleManifestSha256"], "bundleFileCount": identity["bundleFileCount"],
            "bundleAssetOrigin": identity["assetOrigin"], "tagOrigin": row["tagOrigin"]}


def proxy_literal(lines, expected):
    descriptor = "Lcom/wotbtools/app/AgentAssetProxy;"
    inside = False
    classes = 0
    origins = set()
    for line in lines:
        section = re.match(r"\s*Class descriptor\s*:\s*'([^']+)'", line) if "Class descriptor" in line else None
        if section:
            inside = section[1] == descriptor
            classes += int(inside)
        elif inside:
            literal = re.search(r'\|[0-9a-f]+:\s+const-string(?:/jumbo)?\s+v\d+, "(https?://[^"]+)"', line)
            if literal:
                origins.add(literal[1])
    if classes != 1 or origins != {expected}:
        raise ValueError(f"Expected one AgentAssetProxy class loading only {expected}; found {classes} and {sorted(origins)}")
    return expected


def verify_native(apk, version, expected, build_tools):
    suffix = ".exe" if os.name == "nt" else ""
    badging = subprocess.check_output([build_tools / ("aapt" + suffix), "dump", "badging", apk])
    contract.validate_apk_version(badging.decode("utf-8", errors="replace"), version)
    with subprocess.Popen([build_tools / ("dexdump" + suffix), "-d", apk], stdout=subprocess.PIPE,
                          text=True, encoding="utf-8", errors="replace") as proc:
        origin = proxy_literal(proc.stdout, expected)
        if proc.wait():
            raise ValueError(f"{version}: dexdump failed")
    return origin


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    prepare = commands.add_parser("catalog", help="bind a production manifest to remote tags and committed inputs")
    prepare.add_argument("--manifest", type=Path, required=True)
    prepare.add_argument("--refs", type=Path, required=True, help="git ls-remote --tags origin 'refs/tags/android-v*'")
    prepare.add_argument("--historical", action="append", default=[])
    verify = commands.add_parser("verify", help="verify immutable release artifacts against a saved catalog")
    verify.add_argument("--catalog", type=Path, required=True)
    verify.add_argument("--releases", type=Path, required=True, help="directory with APKs and .staging.json records")
    verify.add_argument("--build-tools", type=Path, required=True)
    args = parser.parse_args()
    if args.command == "catalog":
        result = catalog(read_json(args.manifest), remote_tags(args.refs.read_text(encoding="utf-8-sig").splitlines()),
                         args.historical)
    else:
        data = read_json(args.catalog)
        result = []
        for row in data["candidates"]:
            version = row["version"]
            contract.parse_version(version)
            stem = f"wotbtools-android-v{version}"
            apk = args.releases / (stem + ".apk")
            try:
                staging = read_json(args.releases / (stem + ".staging.json"))
                receipt = verify_bundle(row, data["manifest"], staging, apk)
                receipt["dexOriginLiteral"] = verify_native(apk, version, row["tagOrigin"], args.build_tools)
            except (OSError, ValueError, KeyError, zipfile.BadZipFile, subprocess.SubprocessError, SystemExit) as exc:
                receipt = {"version": version, "error": "release contract rejected (see stderr)"
                           if isinstance(exc, SystemExit) else str(exc)}
            result.append(receipt)
        if not result or not any(r["version"] == data["manifest"]["latestVersionName"] for r in result):
            raise ValueError("Incomplete release catalog")
    print(json.dumps(result, indent=2))
    if args.command == "verify" and any(not r.get("tagMatchesStaging") for r in result):
        raise SystemExit(1)


if __name__ == "__main__":
    main()
