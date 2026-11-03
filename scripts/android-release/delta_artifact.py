#!/usr/bin/env python3
"""绑定已签名 APK 与可选增量产物的身份；发布策略仍由 version.json 拥有。"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
from urllib.parse import urlsplit

ALGORITHM = "xdelta3-vcdiff"
MAX_DELTA_RATIO_DENOMINATOR = 10
MIN_BASE_CODE = 4_000_000  # 4.0.0 首次携带增量解码能力。
BASE_URL = "https://wotbtools.com/download/android/"
SHA = re.compile(r"^[0-9a-f]{64}$")
NAME = re.compile(r"^wotbtools-android-delta-([0-9]+)-([0-9]+)-([0-9a-f]{64})\.vcdiff$")


def digest(path):
    result = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            result.update(chunk)
    return result.hexdigest()


def integer(value):
    return type(value) is int and 0 < value <= 2_100_000_000


def validate(meta, target_code, target_sha, target_size):
    if not integer(target_code) or not SHA.fullmatch(target_sha) or not integer(target_size):
        raise ValueError("invalid target identity")
    size = meta.get("apkSizeBytes")
    patches = meta.get("patches", [])
    # 旧 staged evidence 不含增量字段；不得为旧证据猜测 patch 身份。
    if size is None and patches == [] and "apkSizeBytes" not in meta:
        return []
    if type(size) is not int or size != target_size or type(patches) is not list or len(patches) > 1:
        raise ValueError("invalid staged target size or patch list")
    seen = set()
    for patch in patches:
        if type(patch) is not dict:
            raise ValueError("invalid patch")
        source = patch.get("fromVersionCode")
        source_sha = patch.get("fromSha256")
        patch_sha = patch.get("sha256")
        patch_size = patch.get("size")
        url = patch.get("url")
        if not integer(source) or not MIN_BASE_CODE <= source < target_code or source in seen:
            raise ValueError("invalid patch base version")
        seen.add(source)
        if not isinstance(source_sha, str) or not SHA.fullmatch(source_sha):
            raise ValueError("invalid base sha")
        if not isinstance(patch_sha, str) or not SHA.fullmatch(patch_sha):
            raise ValueError("invalid patch sha")
        if type(patch_size) is not int or patch_size <= 0 or patch_size * MAX_DELTA_RATIO_DENOMINATOR > target_size:
            raise ValueError("patch size exceeds the release benefit limit")
        if patch.get("algorithm") != ALGORITHM or not isinstance(url, str):
            raise ValueError("unsupported patch algorithm or URL")
        parsed = urlsplit(url)
        if parsed.scheme != "https" or parsed.netloc != "wotbtools.com" or parsed.query or parsed.fragment:
            raise ValueError("untrusted patch URL")
        if not parsed.path.startswith("/download/android/"):
            raise ValueError("untrusted patch path")
        filename = parsed.path.removeprefix("/download/android/")
        match = NAME.fullmatch(filename)
        if not match or (int(match[1]), int(match[2]), match[3]) != (source, target_code, patch_sha):
            raise ValueError("patch URL does not bind source, target and bytes")
    return patches


def build(args):
    target = Path(args.target)
    target_size = target.stat().st_size
    target_sha = digest(target)
    metadata = {"apkSizeBytes": target_size, "patches": []}
    if target_sha != args.target_sha or not integer(args.target_code) or not integer(target_size):
        raise ValueError("target artifact identity mismatch")
    # 基础版本必须是已发布且有增量客户端的版本；旧客户端忽略字段但无法消费补丁。
    if args.base_manifest and args.base_file:
        base = json.loads(Path(args.base_manifest).read_text(encoding="utf-8"))
        code, sha = base.get("latestVersionCode"), base.get("sha256")
        if integer(code) and MIN_BASE_CODE <= code < args.target_code and isinstance(sha, str) and SHA.fullmatch(sha):
            if digest(args.base_file) != sha:
                raise ValueError("base artifact sha mismatch")
            with tempfile.TemporaryDirectory(prefix="android-delta-", dir=args.output_dir) as temp:
                patch = Path(temp) / "delta.vcdiff"
                rebuilt = Path(temp) / "target.apk"
                subprocess.run([args.xdelta, "-e", "-A", "-a", "-S", "none", "-s", args.base_file, str(target), str(patch)], check=True)
                with patch.open("rb") as stream:
                    header = stream.read(5)
                if header != bytes.fromhex("d6c3c40000"):
                    raise ValueError("patch uses an unsupported VCDIFF header")
                if patch.stat().st_size * MAX_DELTA_RATIO_DENOMINATOR <= target_size:
                    subprocess.run([args.xdelta, "-d", "-s", args.base_file, str(patch), str(rebuilt)], check=True)
                    if rebuilt.stat().st_size != target_size or digest(rebuilt) != target_sha:
                        raise ValueError("reconstructed target differs from signed APK")
                    patch_sha = digest(patch)
                    name = f"wotbtools-android-delta-{code}-{args.target_code}-{patch_sha}.vcdiff"
                    dest = Path(args.output_dir) / name
                    try:
                        os.link(patch, dest)
                    except FileExistsError:
                        if dest.stat().st_size != patch.stat().st_size or digest(dest) != patch_sha:
                            raise ValueError("immutable patch conflict")
                    metadata["patches"].append({"fromVersionCode": code, "fromSha256": sha,
                        "algorithm": ALGORITHM, "url": BASE_URL + name, "sha256": patch_sha,
                        "size": patch.stat().st_size})
    validate(metadata, args.target_code, target_sha, target_size)
    Path(args.output).write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")


def check(args):
    meta = json.loads(Path(args.evidence).read_text(encoding="utf-8"))
    target = Path(args.target)
    target_sha = digest(target)
    if target_sha != args.target_sha:
        raise ValueError("target APK sha mismatch")
    patches = validate(meta, args.target_code, target_sha, target.stat().st_size)
    if args.patch_dir:
        for patch in patches:
            path = Path(args.patch_dir) / urlsplit(patch["url"]).path.rsplit("/", 1)[-1]
            if not path.is_file() or path.stat().st_size != patch["size"] or digest(path) != patch["sha256"]:
                raise ValueError("patch bytes do not match staged identity")
            with path.open("rb") as stream:
                if stream.read(5) != bytes.fromhex("d6c3c40000"):
                    raise ValueError("staged patch uses an unsupported VCDIFF header")
    print(json.dumps({"apkSizeBytes": meta.get("apkSizeBytes"), "patches": patches}, separators=(",", ":")))


def main():
    p = argparse.ArgumentParser()
    commands = p.add_subparsers(dest="command", required=True)
    gen = commands.add_parser("build")
    for flag in ("target", "target-sha", "xdelta", "output-dir", "output"):
        gen.add_argument("--" + flag, required=True)
    gen.add_argument("--target-code", type=int, required=True)
    gen.add_argument("--base-manifest")
    gen.add_argument("--base-file")
    gen.set_defaults(func=build)
    verify = commands.add_parser("verify")
    for flag in ("target", "target-sha", "evidence"):
        verify.add_argument("--" + flag, required=True)
    verify.add_argument("--target-code", type=int, required=True)
    verify.add_argument("--patch-dir")
    verify.set_defaults(func=check)
    args = p.parse_args()
    try:
        args.func(args)
    except (OSError, ValueError, subprocess.CalledProcessError, json.JSONDecodeError) as exc:
        p.exit(1, f"delta artifact: {exc}\n")


if __name__ == "__main__":
    main()
