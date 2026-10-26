#!/usr/bin/env python3
"""Exercise the real frontend build function's cleanup without Docker or network."""
import hashlib
import io
import os
from pathlib import Path
import shutil
import subprocess
import tarfile
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]
BUILDER = ROOT / "deploy/tx/build-frontend-from-gitee.sh"
# Load production functions, replacing only external build/registry dependencies.
FUNCTIONS, SEPARATOR, _ = BUILDER.read_text().partition('[ "$#" -eq 8 ] || usage')
assert SEPARATOR, "frontend builder CLI entrypoint was not found"
FIXTURE = r'''
validate_common() { :; }
flock() {
  count=$(cat "$CACHE_ROOT/flock.count" 2>/dev/null || echo 0); count=$((count + 1))
  printf '%s
' "$count" > "$CACHE_ROOT/flock.count"
  if [ "${HOST_LOCK_BUSY:-0}" = 1 ] && [ "$count" -eq 2 ]; then return 1; fi
  return 0
}
timeout() { while [[ "$1" = --* ]]; do shift; done; shift; "$@"; }
sha256sum() {
  python3 -c 'import hashlib, pathlib, sys; print(hashlib.sha256(pathlib.Path(sys.argv[1]).read_bytes() if len(sys.argv) > 1 else sys.stdin.buffer.read()).hexdigest())' "$@"
}
mktemp() { command mktemp "$@" "$CACHE_ROOT/sponsor.XXXXXX"; }
wait_for_gitee_sha() {
  printf '%s\n' "$worktree" > "$CACHE_ROOT/worktree.path"
  if [ "$FAIL_STAGE" = sync ]; then exit 17; fi
}
lookup_remote_digest() {
  if [ "$BUILD_MODE" = reuse ] || [ -f "$CACHE_ROOT/pushed" ]; then
    printf 'sha256:%064d\n' 0
  else
    return 10
  fi
}
verify_agent_archive() { :; }
verify_frontend_image() {
  if [ "$FAIL_STAGE" = verify ]; then exit 17; fi
}
docker() {
  printf '%s\n' "$*" >> "$CACHE_ROOT/docker.log"
  if [ "$1" = push ]; then : > "$CACHE_ROOT/pushed"; fi
}
build_publish "$SOURCE_SHA" ccr.ccs.tencentyun.com fixture https://assets.example.invalid "$AGENT_ARCHIVE" "$SPONSOR_BUNDLE" "$SPONSOR_FINGERPRINT"
printf 'CALLER resumed\n'
'''


class FrontendBuilderCleanupTest(unittest.TestCase):
    def run_case(self, mode="fresh", sponsor=True, fail_stage="", unsafe_bundle=False,
                 host_lock=False, host_lock_busy=False):
        # Spaces and apostrophes also exercise the trap's captured path quoting.
        with tempfile.TemporaryDirectory(prefix="frontend builder's fixture-") as directory:
            cache = Path(directory) / "cache"
            repo = cache / "repo"
            repo.mkdir(parents=True)
            subprocess.run(["git", "init", "-q", str(repo)], check=True)
            fetch = repo / "scripts/fetch-agent-wasm.sh"
            fetch.parent.mkdir()
            fetch.write_text(': > "$WOTB_TX_BUILD_CACHE_ROOT/fetched"\n')
            subprocess.run(["git", "-C", str(repo), "add", "."], check=True)
            subprocess.run([
                "git", "-C", str(repo), "-c", "user.name=Fixture",
                "-c", "user.email=fixture@example.invalid", "-c", "commit.gpgsign=false",
                "commit", "-qm", "fixture",
            ], check=True)
            sha = subprocess.check_output(["git", "-C", str(repo), "rev-parse", "HEAD"], text=True).strip()
            archive = Path(directory) / "agent.zip"
            archive.touch()
            if host_lock:
                (cache / "host.lock").touch()
            bundle = Path(directory) / "sponsor.tar.gz"
            with tarfile.open(bundle, "w:gz") as tar:
                content = b'{"enabled": false, "methods": []}'
                entry = tarfile.TarInfo("../escape" if unsafe_bundle else "sponsor-config.json")
                entry.size = len(content)
                tar.addfile(entry, io.BytesIO(content))
            env = {
                **os.environ,
                "WOTB_TX_BUILD_CACHE_ROOT": str(cache), "SOURCE_SHA": sha,
                "AGENT_ARCHIVE": str(archive), "BUILD_MODE": mode, "FAIL_STAGE": fail_stage,
                "SPONSOR_BUNDLE": str(bundle) if sponsor else "",
                "SPONSOR_FINGERPRINT": hashlib.sha256(bundle.read_bytes()).hexdigest() if sponsor else "",
                "WOTB_BUILD_HOST_LOCK": str(cache / "host.lock") if host_lock else "",
                "HOST_LOCK_BUSY": "1" if host_lock_busy else "0",
            }
            result = subprocess.run(["bash", "-s"], input=FUNCTIONS + FIXTURE, env=env, text=True,
                                    capture_output=True, timeout=20)
            worktree_path = cache / "worktree.path"
            if worktree_path.exists():
                self.addCleanup(shutil.rmtree, worktree_path.read_text().strip(), True)
            diagnostic = result.stdout + result.stderr
            expected_status = 1 if (unsafe_bundle or host_lock_busy) else 17 if fail_stage else 0
            self.assertEqual(result.returncode, expected_status, diagnostic)
            self.assertNotIn("unbound variable", diagnostic)
            self.assertEqual(list(cache.glob("sponsor.*")), [], diagnostic)
            if worktree_path.exists():
                self.assertFalse(Path(worktree_path.read_text().strip()).exists(), diagnostic)
            worktrees = subprocess.check_output(["git", "-C", str(repo), "worktree", "list", "--porcelain"], text=True)
            self.assertEqual(worktrees.count("worktree "), 1, worktrees)
            if expected_status == 0:
                self.assertIn(f"RESULT reused={'true' if mode == 'reuse' else 'false'}", result.stdout)
                self.assertIn("RESULT wasm_verified=true", result.stdout)
                self.assertIn("CALLER resumed", result.stdout)
                self.assertEqual((cache / "fetched").exists(), mode == "fresh")
                self.assertEqual(int((cache / "flock.count").read_text()), 2 if host_lock else 1,
                                 "cache lock 与 host lock 必须按顺序各取一次")
                if mode == "fresh":
                    # 确定性构建身份：真实生产构建方必须把**源 commit 的 epoch** 作为
                    # SOURCE_DATE_EPOCH 传给 Docker（Docker 上下文无 .git，时间只能由脚本给）。
                    # 缺参、传错值（例如 wall-clock）都在这里被拦住。
                    epoch = subprocess.check_output(
                        ["git", "-C", str(repo), "show", "-s", "--format=%ct", sha], text=True).strip()
                    docker_log = (cache / "docker.log").read_text()
                    self.assertIn(f"--build-arg SOURCE_DATE_EPOCH={epoch}", docker_log, docker_log)
            else:
                self.assertNotIn("RESULT source_sha=", result.stdout)
                self.assertNotIn("CALLER resumed", result.stdout)
                self.assertFalse((cache / "pushed").exists())

    def test_fresh_build_cleanup(self):
        self.run_case()

    def test_build_without_sponsor_cleanup(self):
        self.run_case(sponsor=False)

    def test_reused_image_cleanup(self):
        self.run_case(mode="reuse")

    def test_sync_failure_preserves_status_and_cleans_sponsor(self):
        self.run_case(fail_stage="sync")

    def test_verification_failure_cleans_worktree_before_publish(self):
        self.run_case(fail_stage="verify")

    def test_unpack_failure_cleans_sponsor(self):
        self.run_case(unsafe_bundle=True)

    def test_host_lock_is_acquired_after_cache_lock(self):
        self.run_case(host_lock=True, sponsor=False)

    def test_host_lock_busy_fails_closed(self):
        self.run_case(host_lock=True, host_lock_busy=True, sponsor=False)


class FrontendBuilderDigestLookupTest(unittest.TestCase):
    """TX2 的发行版 Docker 没有 buildx：digest 查询必须回退到 docker manifest。"""

    def run_lookup(self, buildx_available):
        fixture = f'''
timeout() {{ while [[ "$1" = --* ]]; do shift; done; shift; "$@"; }}
docker() {{
  if [ "$1" = buildx ]; then
    if [ "$2" = version ]; then return {0 if buildx_available else 1}; fi
    if [ "$2" = imagetools ]; then printf 'sha256:%064d\\n' 5; return 0; fi
    return 1
  fi
  if [ "$1" = manifest ]; then
    printf '[{{"Descriptor":{{"digest":"sha256:%064d"}}}}]\\n' 7
    return 0
  fi
  return 1
}}
docker_image_digest repo:tag
'''
        result = subprocess.run(["bash", "-s"], input=FUNCTIONS + fixture, text=True,
                                capture_output=True, timeout=20)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        return result.stdout.strip()

    def test_buildx_path_uses_imagetools(self):
        self.assertEqual(self.run_lookup(buildx_available=True), "sha256:" + "0" * 63 + "5")

    def test_manifest_fallback_parses_descriptor_digest(self):
        self.assertEqual(self.run_lookup(buildx_available=False), "sha256:" + "0" * 63 + "7")

    def test_manifest_timeout_keeps_timeout_status(self):
        # 回归：fallback 不能把 timeout 的 124 变成 Python 空输入的 1，否则
        # lookup_remote_digest 的有界重试会失效。
        fixture = '''
timeout() { return 124; }
docker() { if [ "$1" = buildx ]; then return 1; fi; return 0; }
docker_image_digest repo:tag
'''
        result = subprocess.run(["bash", "-s"], input=FUNCTIONS + fixture, text=True,
                                capture_output=True, timeout=20)
        self.assertEqual(result.returncode, 124, result.stdout + result.stderr)
        self.assertEqual(result.stdout.strip(), "")

    def test_lookup_retries_after_timeout_then_succeeds(self):
        with tempfile.TemporaryDirectory() as directory:
            counter = Path(directory) / "lookup.count"
            fixture = f'''
docker_image_digest() {{
  count=$(cat "{counter}" 2>/dev/null || echo 0); count=$((count + 1))
  printf '%s\\n' "$count" > "{counter}"
  if [ "$count" -eq 1 ]; then return 124; fi
  printf 'sha256:%064d\\n' 9
}}
sleep() {{ :; }}
lookup_remote_digest repo:tag
'''
            result = subprocess.run(["bash", "-s"], input=FUNCTIONS + fixture, text=True,
                                    capture_output=True, timeout=20)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertEqual(result.stdout.strip(), "sha256:" + "0" * 63 + "9")
            self.assertEqual(counter.read_text().strip(), "2")


if __name__ == "__main__":
    unittest.main()
