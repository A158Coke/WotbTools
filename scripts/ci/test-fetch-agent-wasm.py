#!/usr/bin/env python3
"""scripts/fetch-agent-wasm.sh 下载器的故障注入测试（本地 HTTP fixture，不访问上游）。

每个用例在临时目录中复制 `scripts/fetch-agent-wasm.sh` 与 `scripts/agent-wasm-artifact.py`，
写入指向 127.0.0.1 fixture 的 `deploy/agent/source.json`，并把 `WOTB_GITHUB_API` 指向 fixture 的
`/api`，因此不会访问 GitHub，也不会触碰真实 `common/assets/wasm/`。

覆盖的下载路径：Release 元数据 → 按名称解析 Asset ID → Asset API 二进制下载（302 到对象存储）。
用例：API 正常；附件名不匹配；SHA256 错误（不得回退其他来源）；302 后目标连接失败再恢复
（签名参数不得出现在输出中）；403/404 截断立即失败；API 持续 5xx 达上限；以及原有的 429/503/404/
错误 SHA/连接失败场景。
"""
from __future__ import annotations

import collections
import hashlib
import http.server
import io
import json
import os
import pathlib
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import zipfile

ROOT = pathlib.Path(__file__).resolve().parent.parent  # scripts/
# Windows 上 subprocess 的 "bash" 会先命中 System32 的 WSL 启动器，故按 PATH 解析 Git Bash
BASH = shutil.which("bash") or "bash"
REF = "a" * 40
RELEASE = "v0.0.1"
ASSET = "wotb-replay-wasm-v0.0.1.zip"
ASSET_ID = 4242
OWNER_REPO = "o/n"
META_PATH = f"/api/repos/{OWNER_REPO}/releases/tags/{RELEASE}"
ASSET_PATH = f"/api/repos/{OWNER_REPO}/releases/assets/{ASSET_ID}"
BLOB_PATH = "/blob/signed"
DIRECT_PATH = f"/{OWNER_REPO}/releases/download/{RELEASE}/{ASSET}"  # 旧直链：不得被访问
SIG_SECRET = "SIGSECRET123"


def synthetic_zip() -> bytes:
    """固定内容（固定 entry 时间戳），保证 SHA 在各用例中一致。"""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        for name, data in (
            ("wotb_replay_wasm.js", b"// synthetic glue\n"),
            ("wotb_replay_wasm_bg.wasm", b"\x00asm\x01\x00\x00\x00"),
            ("fingerprint.json",
             json.dumps({"upstream_commit": REF, "tag": RELEASE, "bindgen": "test"}).encode()),
        ):
            z.writestr(zipfile.ZipInfo(name, date_time=(2020, 1, 1, 0, 0, 0)), data)
    return buf.getvalue()


GOOD_ZIP = synthetic_zip()


def meta_json(name: str = ASSET, tag: str = RELEASE, asset_id: int = ASSET_ID) -> bytes:
    return json.dumps({"tag_name": tag, "assets": [{"id": asset_id, "name": name}]}).encode()


def R(status: int, body: bytes = b"", declared: int | None = None, location: str | None = None) -> dict:
    """一个脚本化响应。declared 大于 body 时声明的 Content-Length 大于实际字节，随后断开（截断）。
    location 中的 {base} 会替换为 fixture 根地址。"""
    return {"status": status, "body": body, "declared": declared, "location": location}


class Fixture:
    """按路径返回脚本化响应；每条路径的序列耗尽后重复最后一项。未配置的路径返回 404。"""

    def __init__(self, routes: dict[str, list[dict]]):
        self.routes = {path: list(seq) for path, seq in routes.items()}
        self.hits: collections.Counter[str] = collections.Counter()
        self.base = ""
        fixture = self

        class Handler(http.server.BaseHTTPRequestHandler):
            def do_GET(self):  # noqa: N802
                path = self.path.split("?", 1)[0]
                fixture.hits[path] += 1
                seq = fixture.routes.get(path)
                if not seq:
                    entry = R(404, b"no route")
                else:
                    entry = seq[0] if len(seq) == 1 else seq.pop(0)
                body = entry["body"]
                declared = entry["declared"] if entry["declared"] is not None else len(body)
                self.send_response(entry["status"])
                if entry["location"]:
                    self.send_header("Location", entry["location"].replace("{base}", fixture.base))
                self.send_header("Content-Length", str(declared))
                self.end_headers()
                self.wfile.write(body)

            def log_message(self, *args):  # 静默
                pass

        self.server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)

    def __enter__(self) -> str:
        self.thread.start()
        self.base = f"http://127.0.0.1:{self.server.server_address[1]}"
        return self.base

    def __exit__(self, *exc) -> None:
        self.server.shutdown()
        self.server.server_close()


def closed_port_url() -> str:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
    return f"http://127.0.0.1:{port}"  # 已关闭，连接必然被拒绝


def run_case(name: str, routes_fn=None, *, sha: str | None = None, api_closed: bool = False,
             expect_ok: bool, expect_in_stderr=(), expect_hits: dict[str, int] | None = None,
             forbid=()) -> None:
    good_sha = hashlib.sha256(GOOD_ZIP).hexdigest()
    workdir = pathlib.Path(tempfile.mkdtemp(prefix=f"fetch-test-{name}-"))
    fixture = None
    try:
        (workdir / "scripts").mkdir()
        shutil.copy(ROOT / "fetch-agent-wasm.sh", workdir / "scripts/fetch-agent-wasm.sh")
        shutil.copy(ROOT / "agent-wasm-artifact.py", workdir / "scripts/agent-wasm-artifact.py")
        (workdir / "deploy/agent").mkdir(parents=True)

        closed = closed_port_url()
        base = closed
        api_base = closed
        if routes_fn is not None:
            fixture = Fixture(routes_fn(closed))
            base = fixture.__enter__()
            api_base = base + "/api"
        if api_closed:
            api_base = closed
        (workdir / "deploy/agent/source.json").write_text(json.dumps({
            "repo": f"{base}/{OWNER_REPO}",
            "ref": REF,
            "artifact": {"release": RELEASE, "asset": ASSET, "sha256": sha or good_sha},
        }), encoding="utf-8")

        env = dict(os.environ, WOTB_FETCH_RETRY_DELAY="0", PYTHONIOENCODING="utf-8",
                   WOTB_GITHUB_API=api_base)
        env.pop("GITHUB_TOKEN", None)
        try:
            proc = subprocess.run(
                [BASH, str(workdir / "scripts/fetch-agent-wasm.sh")],
                capture_output=True, encoding="utf-8", errors="replace", env=env, timeout=300,
                stdin=subprocess.DEVNULL,
            )
        finally:
            hits = collections.Counter(fixture.hits) if fixture else collections.Counter()
            if fixture:
                fixture.__exit__(None, None, None)

        output = proc.stdout + proc.stderr
        staged_root = workdir / "common/assets/wasm"
        problems = []
        if (proc.returncode == 0) != expect_ok:
            problems.append(f"exit={proc.returncode}, expected ok={expect_ok}")
        if expect_ok and not (staged_root / REF / "wotb_replay_wasm.js").is_file():
            problems.append("artifact not staged")
        if not expect_ok and staged_root.exists() and any(staged_root.iterdir()):
            problems.append("failed download left staged artifact")
        for path, count in (expect_hits or {}).items():
            if hits[path] != count:
                problems.append(f"requests to {path} = {hits[path]}, expected {count}")
        if expect_hits is not None and hits[DIRECT_PATH] != 0:
            problems.append("fell back to direct release URL")
        for needle in expect_in_stderr:
            if needle not in output:
                problems.append(f"missing output: {needle!r}")
        for secret in forbid:
            if secret in output:
                problems.append(f"output leaked {secret!r}")
        if problems:
            print(f"FAIL {name}: " + "; ".join(problems))
            print("---- stdout\n" + proc.stdout + "---- stderr\n" + proc.stderr)
            raise SystemExit(1)
        print(f"PASS {name} (exit={proc.returncode}, requests={dict(hits)})")
    finally:
        shutil.rmtree(workdir, ignore_errors=True)


def ok_routes(base_closed: str, **overrides) -> dict[str, list[dict]]:
    routes = {
        META_PATH: [R(200, meta_json())],
        ASSET_PATH: [R(302, location="{base}" + BLOB_PATH + f"?X-Amz-Signature={SIG_SECRET}")],
        BLOB_PATH: [R(200, GOOD_ZIP)],
        DIRECT_PATH: [R(200, GOOD_ZIP)],  # 若误回退到直链会被计数
    }
    routes.update(overrides)
    return routes


def main() -> int:
    truncated = b"x" * 9  # 声明 100 字节，只发 9 字节后断开

    run_case(
        "api-200-correct-sha",
        lambda closed: ok_routes(closed),
        expect_ok=True,
        expect_hits={META_PATH: 1, ASSET_PATH: 1, BLOB_PATH: 1},
        expect_in_stderr=["WASM 产物已就位"],
        forbid=[SIG_SECRET],
    )
    run_case(
        "api-asset-name-mismatch",
        lambda closed: ok_routes(closed, **{META_PATH: [R(200, meta_json(name="other.zip"))]}),
        expect_ok=False,
        expect_hits={META_PATH: 1, ASSET_PATH: 0},
        expect_in_stderr=["命中 0 个"],
    )
    run_case(
        "api-sha-mismatch-no-fallback",
        lambda closed: ok_routes(closed),
        sha="0" * 64,
        expect_ok=False,
        expect_hits={META_PATH: 1, ASSET_PATH: 1, BLOB_PATH: 1},
        expect_in_stderr=["SHA256 校验失败"],
        forbid=[SIG_SECRET],
    )
    run_case(
        "302-target-refused-then-ok",
        lambda closed: ok_routes(closed, **{ASSET_PATH: [
            R(302, location=closed + f"/x?X-Amz-Signature={SIG_SECRET}"),  # 跳转目标拒绝连接
            R(302, location="{base}" + BLOB_PATH + f"?X-Amz-Signature={SIG_SECRET}"),
        ]}),
        expect_ok=True,
        expect_hits={META_PATH: 1, ASSET_PATH: 2, BLOB_PATH: 1},
        expect_in_stderr=["curl_exit=7", "WASM 产物已就位"],
        forbid=[SIG_SECRET],
    )
    run_case(
        "asset-404-truncated-permanent",
        lambda closed: ok_routes(closed, **{ASSET_PATH: [R(404, truncated, 100)]}),
        expect_ok=False,
        expect_hits={META_PATH: 1, ASSET_PATH: 1, BLOB_PATH: 0},
        expect_in_stderr=["HTTP 404", "curl_exit=18", "永久错误"],
    )
    run_case(
        "asset-403-truncated-permanent",
        lambda closed: ok_routes(closed, **{ASSET_PATH: [R(403, truncated, 100)]}),
        expect_ok=False,
        expect_hits={META_PATH: 1, ASSET_PATH: 1, BLOB_PATH: 0},
        expect_in_stderr=["HTTP 403", "curl_exit=18", "永久错误"],
    )
    run_case(
        "api-5xx-persistent-capped",
        lambda closed: ok_routes(closed, **{META_PATH: [R(503, b"unavailable")]}),
        expect_ok=False,
        expect_hits={META_PATH: 5, ASSET_PATH: 0},
        expect_in_stderr=["HTTP 503", "已达重试上限"],
    )
    run_case(
        "asset-429-then-ok",
        lambda closed: ok_routes(closed, **{ASSET_PATH: [R(429, b"slow"), R(302, location="{base}" + BLOB_PATH)]}),
        expect_ok=True,
        expect_hits={META_PATH: 1, ASSET_PATH: 2, BLOB_PATH: 1},
        expect_in_stderr=["HTTP 429"],
    )
    run_case(
        "asset-503-persistent-capped",
        lambda closed: ok_routes(closed, **{ASSET_PATH: [R(503, b"unavailable")]}),
        expect_ok=False,
        expect_hits={META_PATH: 1, ASSET_PATH: 5, BLOB_PATH: 0},
        expect_in_stderr=["HTTP 503", "已达重试上限"],
    )
    run_case(
        "asset-404-permanent",
        lambda closed: ok_routes(closed, **{ASSET_PATH: [R(404, b"not found")]}),
        expect_ok=False,
        expect_hits={META_PATH: 1, ASSET_PATH: 1},
        expect_in_stderr=["HTTP 404", "永久错误"],
    )
    run_case(
        "api-unreachable-capped",
        None,
        api_closed=True,
        expect_ok=False,
        expect_in_stderr=["curl_exit=7", "已达重试上限"],
    )
    print("fetch-agent-wasm downloader tests: PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())
