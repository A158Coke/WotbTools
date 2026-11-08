#!/usr/bin/env python3
"""scripts/fetch-agent-wasm.sh 下载器的故障注入测试（本地 HTTP fixture，不访问上游）。

每个用例在临时目录中复制 `scripts/fetch-agent-wasm.sh` 与 `scripts/agent-wasm-artifact.py`，
写入指向 127.0.0.1 fixture 的 `deploy/agent/source.json`，因此不会触碰真实 `common/assets/wasm/`。
覆盖：200+正确 SHA 成功；429 后恢复；503 持续失败达上限；404 立即失败；200+错误 SHA 失败；
连接失败按上限重试后失败。
"""
from __future__ import annotations

import hashlib
import http.server
import io
import json
import os
import pathlib
import shutil
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
ROUTE = f"/releases/download/{RELEASE}/{ASSET}"


def synthetic_zip() -> bytes:
    """固定内容（固定 entry 时间戳），保证 run_case 计算的 SHA 与 fixture 返回字节一致。"""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("wotb_replay_wasm.js", "// synthetic glue\n")
        z.writestr("wotb_replay_wasm_bg.wasm", b"\x00asm\x01\x00\x00\x00")
        z.writestr(
            "fingerprint.json",
            json.dumps({"upstream_commit": REF, "tag": RELEASE, "bindgen": "test"}),
        )
    return buf.getvalue()


GOOD_ZIP = synthetic_zip()


class Fixture:
    """按路由顺序返回脚本化响应；序列耗尽后重复最后一个。

    条目为 (status, body) 或 (status, body, declared_len)：declared_len 大于 body 时声明的
    Content-Length 大于实际发送字节数，随后断开连接，模拟截断的错误响应。
    """

    def __init__(self, script: list[tuple]):
        self.script = list(script)
        self.hits = 0
        fixture = self

        class Handler(http.server.BaseHTTPRequestHandler):
            def do_GET(self):  # noqa: N802
                fixture.hits += 1
                entry = fixture.script[0] if len(fixture.script) == 1 else fixture.script.pop(0)
                status, body = entry[0], entry[1]
                declared = entry[2] if len(entry) > 2 else len(body)
                self.send_response(status)
                self.send_header("Content-Length", str(declared))
                self.end_headers()
                self.wfile.write(body)

            def log_message(self, *args):  # 静默
                pass

        self.server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)

    def __enter__(self):
        self.thread.start()
        return f"http://127.0.0.1:{self.server.server_address[1]}"

    def __exit__(self, *exc):
        self.server.shutdown()
        self.server.server_close()


def closed_port_url() -> str:
    import socket

    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
    return f"http://127.0.0.1:{port}"  # 已关闭，连接必然被拒绝


def run_case(name: str, script: list[tuple[int, bytes]] | None, sha: str | None,
             base: str | None = None, expect_ok: bool = True, expect_in_stderr: list[str] = (),
             expect_hits: int | None = None) -> None:
    zip_bytes = GOOD_ZIP
    good_sha = hashlib.sha256(zip_bytes).hexdigest()
    workdir = pathlib.Path(tempfile.mkdtemp(prefix=f"fetch-test-{name}-"))
    try:
        (workdir / "scripts").mkdir()
        shutil.copy(ROOT / "fetch-agent-wasm.sh", workdir / "scripts/fetch-agent-wasm.sh")
        shutil.copy(ROOT / "agent-wasm-artifact.py", workdir / "scripts/agent-wasm-artifact.py")
        (workdir / "deploy/agent").mkdir(parents=True)

        def write_source(repo_url: str) -> None:
            (workdir / "deploy/agent/source.json").write_text(json.dumps({
                "repo": repo_url,
                "ref": REF,
                "artifact": {"release": RELEASE, "asset": ASSET, "sha256": sha or good_sha},
            }), encoding="utf-8")

        env = dict(os.environ, WOTB_FETCH_RETRY_DELAY="0", PYTHONIOENCODING="utf-8")
        fixture_cm = None
        if script is not None:
            fixture_cm = Fixture(script)
            base = fixture_cm.__enter__()
        try:
            write_source(base or closed_port_url())
            proc = subprocess.run(
                [BASH, str(workdir / "scripts/fetch-agent-wasm.sh")],
                capture_output=True, encoding="utf-8", errors="replace", env=env, timeout=120,
                stdin=subprocess.DEVNULL,
            )
        finally:
            if fixture_cm is not None:
                hits = fixture_cm.hits
                fixture_cm.__exit__(None, None, None)
            else:
                hits = None

        wasm_dir = workdir / "common/assets/wasm" / REF
        ok = proc.returncode == 0
        problems = []
        if ok != expect_ok:
            problems.append(f"exit={proc.returncode}, expected ok={expect_ok}")
        if expect_ok and not (wasm_dir / "wotb_replay_wasm.js").is_file():
            problems.append("artifact not staged")
        if not expect_ok and (workdir / "common/assets/wasm").exists() and any((workdir / "common/assets/wasm").iterdir()):
            problems.append("failed download left staged artifact")
        if expect_hits is not None and hits != expect_hits:
            problems.append(f"HTTP requests={hits}, expected {expect_hits}")
        for needle in expect_in_stderr:
            if needle not in proc.stderr and needle not in proc.stdout:
                problems.append(f"missing output: {needle!r}")
        if problems:
            print(f"FAIL {name}: " + "; ".join(problems))
            print("---- stdout\n" + proc.stdout + "---- stderr\n" + proc.stderr)
            raise SystemExit(1)
        print(f"PASS {name} (exit={proc.returncode}, requests={hits})")
    finally:
        shutil.rmtree(workdir, ignore_errors=True)


def main() -> int:
    good = GOOD_ZIP
    run_case("200-correct-sha", [(200, good)], None, expect_ok=True, expect_hits=1,
             expect_in_stderr=["WASM 产物已就位"])
    run_case("429-then-200", [(429, b"slow down"), (200, good)], None, expect_ok=True,
             expect_hits=2, expect_in_stderr=["HTTP 429"])
    run_case("503-persistent-capped", [(503, b"unavailable")], None, expect_ok=False,
             expect_hits=5, expect_in_stderr=["HTTP 503", "已达重试上限"])
    run_case("404-permanent", [(404, b"not found")], None, expect_ok=False,
             expect_hits=1, expect_in_stderr=["HTTP 404", "永久错误"])
    # 已收到永久 HTTP 错误但响应体截断（curl 同时给出 HTTP 状态与非零 exit）：必须立即失败
    truncated = b"x" * 9  # 声明 100 字节，只发 9 字节后断开
    run_case("404-truncated-permanent", [(404, truncated, 100)], None, expect_ok=False,
             expect_hits=1, expect_in_stderr=["HTTP 404", "curl_exit=18", "永久错误"])
    run_case("403-truncated-permanent", [(403, truncated, 100)], None, expect_ok=False,
             expect_hits=1, expect_in_stderr=["HTTP 403", "curl_exit=18", "永久错误"])
    run_case("200-wrong-sha", [(200, good)], "0" * 64, expect_ok=False, expect_hits=1,
             expect_in_stderr=["SHA256 校验失败"])
    run_case("connection-refused-capped", None, None, expect_ok=False,
             expect_in_stderr=["curl_exit=7", "已达重试上限"])
    print("fetch-agent-wasm downloader tests: PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())
