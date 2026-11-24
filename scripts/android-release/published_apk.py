"""Resolve a repair target from the live manifest and the immutable staging record."""
import json
import os
import re
import subprocess
from urllib.request import urlopen


BASE = "https://wotbtools.com/download/android"


def read_record(name):
    with urlopen(f"{BASE}/{name}", timeout=30) as response:
        return json.load(response)


def published_identity(version):
    if not re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+", version):
        raise ValueError("Expected an explicit X.Y.Z version")
    name = f"wotbtools-android-v{version}.apk"
    manifest = read_record("version.json")
    if manifest["latestVersionName"] != version or manifest["apkUrl"] != f"{BASE}/{name}":
        raise ValueError("Requested version is not the current published full APK")

    staging = read_record(f"wotbtools-android-v{version}.staging.json")
    tag = f"android-v{version}"
    source = subprocess.check_output(
        ["git", "rev-parse", "--verify", f"refs/tags/{tag}^{{commit}}"], text=True
    ).strip()
    sha = manifest["sha256"]
    size = manifest["apkSizeBytes"]
    if not re.fullmatch(r"[a-f0-9]{64}", sha) or type(size) is not int or size <= 0:
        raise ValueError("Invalid production APK digest or size")
    expected = {
        "apkName": name, "apkUrl": manifest["apkUrl"], "tag": tag, "sourceSha": source,
        "versionName": version, "versionCode": manifest["latestVersionCode"],
        "apkSizeBytes": size, "sha256": sha,
    }
    if source != manifest["sourceSha"] or any(staging[k] != v for k, v in expected.items()):
        raise ValueError("Production manifest, release tag and staging evidence disagree")
    return {"name": name, "sha": sha, "size": size}


if __name__ == "__main__":
    identity = published_identity(os.environ["REQUESTED_VERSION"])
    with open(os.environ["GITHUB_OUTPUT"], "a", encoding="utf-8") as output:
        for key, value in identity.items():
            print(f"{key}={value}", file=output)
