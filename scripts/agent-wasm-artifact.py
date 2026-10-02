#!/usr/bin/env python3
"""Agent WASM Release 附件的 ingest + fail-closed 校验（唯一实现）。

产物形状是 **commit-addressed 目录**，两个来源（Release 直取 / 源码自建）必须一致：

    common/assets/wasm/<upstream_commit>/
        wotb_replay_wasm.js
        wotb_replay_wasm_bg.wasm
        fingerprint.json      # {"upstream_commit", "tag", "bindgen"}

`fingerprint.json` 的 `upstream_commit` / `tag` 必须与 `deploy/agent/source.json`
的 `ref` / `artifact.release` 逐字段一致，否则构建直接失败（fail-closed）。

调用方：
    scripts/fetch-agent-wasm.sh        ingest  <zip> <ref> <release> <dest>
    scripts/build-agent-wasm.sh        verify  <fingerprint.json> <ref> <release>
    契约自测（fetch-agent-wasm.sh --self-test）  self-test <zip> <workdir>
"""
from __future__ import annotations

import json
import pathlib
import re
import shutil
import sys
import zipfile

# 产物文件名是前端 loader 与 nginx location 共同依赖的契约
JS_NAME = "wotb_replay_wasm.js"
WASM_NAME = "wotb_replay_wasm_bg.wasm"
FINGERPRINT_NAME = "fingerprint.json"

# dest 由 ref 拼出：只接受完整 SHA，杜绝 `..`/空白等路径注入
REF_RE = re.compile(r"[0-9a-f]{40}\Z")


class IngestError(Exception):
    """校验失败（fail-closed）：任何一个不一致都必须让构建停下来。"""


def load_fingerprint(path: pathlib.Path) -> dict:
    try:
        text = path.read_text(encoding="utf-8")
    except FileNotFoundError:
        raise IngestError(f"Agent 产物缺 {FINGERPRINT_NAME}: {path}")
    try:
        data = json.loads(text)
    except json.JSONDecodeError as exc:
        raise IngestError(f"{FINGERPRINT_NAME} 不是合法 JSON: {exc}")
    if not isinstance(data, dict):
        raise IngestError(f"{FINGERPRINT_NAME} 顶层必须是对象")
    return data


def verify_fingerprint(path: pathlib.Path, expect_commit: str, expect_tag: str) -> dict:
    """fingerprint.upstream_commit/tag 必须与 source.json 逐字段一致。"""
    fingerprint = load_fingerprint(path)
    actual_commit = fingerprint.get("upstream_commit")
    actual_tag = fingerprint.get("tag")
    if actual_commit != expect_commit:
        raise IngestError(
            f"{FINGERPRINT_NAME}.upstream_commit = {actual_commit!r}，"
            f"与 source.json ref = {expect_commit!r} 不一致"
        )
    if actual_tag != expect_tag:
        raise IngestError(
            f"{FINGERPRINT_NAME}.tag = {actual_tag!r}，"
            f"与 source.json artifact.release = {expect_tag!r} 不一致"
        )
    return fingerprint


def _extract_into(archive: pathlib.Path, dest: pathlib.Path) -> None:
    """解压到 dest，并拒绝任何逃出 dest 的条目（zip slip）。"""
    root = dest.resolve()
    try:
        with zipfile.ZipFile(archive) as archive_file:
            for member in archive_file.infolist():
                target = (dest / member.filename).resolve()
                if target != root and root not in target.parents:
                    raise IngestError(f"ZIP 条目逃出目标目录: {member.filename}")
            archive_file.extractall(dest)
    except zipfile.BadZipFile as exc:
        raise IngestError(f"Release 附件不是合法 ZIP: {exc}")


def ingest(archive: pathlib.Path, ref: str, release: str, dest: pathlib.Path) -> dict:
    if not REF_RE.fullmatch(ref or ""):
        raise IngestError(f"source.json ref 不是完整 40 位小写 commit SHA: {ref!r}")
    if not release:
        raise IngestError("source.json artifact.release 为空")

    # 旧清单先删：解压失败或产物缺清单时，不得沿用上一版的 fingerprint 通过校验
    fingerprint_path = dest / FINGERPRINT_NAME
    fingerprint_path.unlink(missing_ok=True)
    dest.mkdir(parents=True, exist_ok=True)
    _extract_into(archive, dest)

    verify_fingerprint(fingerprint_path, ref, release)
    for name in (JS_NAME, WASM_NAME):
        target = dest / name
        if not target.is_file() or target.stat().st_size == 0:
            raise IngestError(f"Agent 产物缺文件或为空: {target}")

    print(f"fingerprint 校验通过: {release} @ {ref}")
    return {"dir": str(dest), "ref": ref, "release": release}


def self_test(archive: pathlib.Path, workdir: pathlib.Path) -> None:
    """在临时目录里证明 ingest 的正确性（含各处 fail-closed）。

    正例用**自造的合成 ZIP**（清单与本用例的期望值一致），这样自测不依赖上游
    当前 pin 的 tag/commit；反例用真实 ZIP，其清单与任意非本 pin 的期望值必然不一致。
    """
    workdir.mkdir(parents=True, exist_ok=True)
    expect_commit = "a" * 40
    expect_tag = "v0.0.1"
    # 落位根目录固定为 <workdir>/wasm/，与真实 `common/assets/wasm/` 同构
    wasm_root = workdir / "wasm"
    synthetic = workdir / "synthetic.zip"
    with zipfile.ZipFile(synthetic, "w") as z:
        z.writestr(JS_NAME, "// synthetic wasm-bindgen glue\n")
        z.writestr(WASM_NAME, b"\x00asm\x01\x00\x00\x00")
        z.writestr(
            FINGERPRINT_NAME,
            json.dumps({"upstream_commit": expect_commit, "tag": expect_tag, "bindgen": "wasm-bindgen 0.0.0"}),
        )

    # 1) 匹配 fingerprint → PASS，且落位是 commit-addressed 目录
    dest = wasm_root / expect_commit
    ingest(synthetic, expect_commit, expect_tag, dest)
    for name in (JS_NAME, WASM_NAME, FINGERPRINT_NAME):
        assert (dest / name).is_file(), f"self-test: {name} 未落位"
    assert dest.parent == wasm_root, "self-test: 落位目录必须是 wasm/<ref>/"
    print(f"self-test PASS 落位: wasm/{expect_commit}/")

    # 2) 同一 ZIP + 期望 commit 不同 → FAIL（commit 不一致）
    try:
        ingest(synthetic, "b" * 40, expect_tag, wasm_root / ("b" * 40))
    except IngestError as exc:
        print(f"self-test PASS 拒绝 commit 不一致: {exc}")
    else:
        raise AssertionError("self-test: commit 不一致未被拒绝")

    # 3) 同一 ZIP + 期望 release 不同 → FAIL（release 不一致）
    try:
        ingest(synthetic, expect_commit, "v9.9.9", wasm_root / "release-mismatch")
    except IngestError as exc:
        print(f"self-test PASS 拒绝 release 不一致: {exc}")
    else:
        raise AssertionError("self-test: release 不一致未被拒绝")

    # 4) 真实 ZIP（任意非本 pin 期望值必然不一致）→ FAIL，证明校验真的在看产物清单
    real_commit, real_tag = "c" * 40, "v0.0.2"
    if archive.resolve() != synthetic.resolve():
        try:
            ingest(archive, real_commit, real_tag, wasm_root / real_commit)
        except IngestError as exc:
            print(f"self-test PASS 拒绝真实产物清单不匹配: {exc}")
        else:
            raise AssertionError("self-test: 真实产物清单不匹配未被拒绝")

    # 5) 清单缺失 / 非 JSON / 非对象 → FAIL（不得沿用旧清单）
    cases = (("missing", None), ("malformed", b"{not json"), ("not-object", b"[1, 2]"))
    for index, (label, content) in enumerate(cases):
        target = workdir / f"{label}-{'d' * 39}{index}"
        shutil.rmtree(target, ignore_errors=True)
        target.mkdir(parents=True)
        if content is not None:
            (target / FINGERPRINT_NAME).write_bytes(content)
        try:
            verify_fingerprint(target / FINGERPRINT_NAME, expect_commit, expect_tag)
        except IngestError as exc:
            print(f"self-test PASS 拒绝 {label} fingerprint: {exc}")
        else:
            raise AssertionError(f"self-test: {label} fingerprint 未被拒绝")

    # 6) ZIP 条目逃出目标目录 → FAIL（zip slip；不依赖调用方做路径消毒）
    escape_root = workdir / "escape"
    escape_root.mkdir(parents=True, exist_ok=True)
    escape_zip = workdir / "escape.zip"
    with zipfile.ZipFile(escape_zip, "w") as z:
        z.writestr("../../escaped.txt", "nope\n")
    try:
        ingest(escape_zip, expect_commit, expect_tag, escape_root / expect_commit)
    except IngestError as exc:
        print(f"self-test PASS 拒绝 zip slip: {exc}")
    else:
        raise AssertionError("self-test: ZIP 条目逃出目标目录未被拒绝")

    print("agent wasm artifact contract: PASS")


def main(argv: list[str]) -> int:
    if len(argv) < 2:
        print(__doc__, file=sys.stderr)
        return 2
    command = argv[1]
    try:
        if command == "ingest" and len(argv) == 6:
            ingest(pathlib.Path(argv[2]), argv[3], argv[4], pathlib.Path(argv[5]))
        elif command == "verify" and len(argv) == 5:
            verify_fingerprint(pathlib.Path(argv[2]), argv[3], argv[4])
            print(f"fingerprint 校验通过: {argv[4]} @ {argv[3]}")
        elif command == "self-test" and len(argv) == 4:
            self_test(pathlib.Path(argv[2]), pathlib.Path(argv[3]))
        else:
            print(__doc__, file=sys.stderr)
            return 2
    except IngestError as exc:
        print(f"FAIL: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
