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
materialize_source() {
  SOURCE_DIR="$REPO_DIR"
  wait_for_gitee_sha "$1"
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

    def test_shallow_source_builds_and_cleans_up(self):
        """真实的 exact-SHA 兜底路径：浅取仓库能开 worktree、供 epoch，并被清理干净。"""
        with tempfile.TemporaryDirectory(prefix="frontend shallow fallback-") as directory:
            cache = Path(directory) / "cache"
            origin = Path(directory) / "origin"
            mirror = Path(directory) / "mirror"
            origin.mkdir()
            subprocess.run(["git", "init", "-q", "-b", "main", str(origin)], check=True)
            fetch = origin / "scripts/fetch-agent-wasm.sh"
            fetch.parent.mkdir()
            fetch.write_text(': > "$WOTB_TX_BUILD_CACHE_ROOT/fetched"\n')
            subprocess.run(["git", "-C", str(origin), "add", "."], check=True)
            subprocess.run([
                "git", "-C", str(origin), "-c", "user.name=Fixture",
                "-c", "user.email=fixture@example.invalid", "-c", "commit.gpgsign=false",
                "commit", "-qm", "fixture",
            ], check=True)
            sha = subprocess.check_output(["git", "-C", str(origin), "rev-parse", "HEAD"], text=True).strip()
            subprocess.run(["git", "-C", str(origin), "config", "uploadpack.allowAnySHA1InWant", "true"],
                           check=True)
            subprocess.run(["git", "init", "-q", "--bare", "-b", "main", str(mirror)], check=True)
            archive = Path(directory) / "agent.zip"
            archive.touch()

            fixture = r'''
validate_common() { :; }
flock() { :; }
timeout() { while [[ "$1" = --* ]]; do shift; done; shift; "$@"; }
lookup_remote_digest() { if [ -f "$CACHE_ROOT/pushed" ]; then printf 'sha256:%064d\n' 0; else return 10; fi; }
verify_agent_archive() { :; }
verify_frontend_image() { :; }
docker() { printf '%s\n' "$*" >> "$CACHE_ROOT/docker.log"; if [ "$1" = push ]; then : > "$CACHE_ROOT/pushed"; fi; }
build_publish "$SOURCE_SHA" ccr.ccs.tencentyun.com fixture https://assets.example.invalid "$AGENT_ARCHIVE" "" ""
printf 'CALLER resumed\n'
'''
            env = {
                **os.environ,
                "WOTB_TX_BUILD_CACHE_ROOT": str(cache),
                "WOTB_GITEE_REPO_URL": mirror.resolve().as_uri(),
                "WOTB_GITHUB_REPO_URL": origin.resolve().as_uri(),
                "SOURCE_SHA": sha, "AGENT_ARCHIVE": str(archive),
                "GITEE_WAIT_ATTEMPTS": "1", "GITEE_WAIT_INTERVAL_SECONDS": "1",
                "GITHUB_FETCH_ATTEMPTS": "1", "GITHUB_FETCH_TIMEOUT_SECONDS": "60",
                "KILL_AFTER_SECONDS": "10", "RETRY_BACKOFF_LATER_SECONDS": "1",
            }
            result = subprocess.run(["bash", "-s"], input=FUNCTIONS + fixture, env=env,
                                    text=True, capture_output=True, timeout=180)
            diagnostic = result.stdout + result.stderr
            self.assertEqual(result.returncode, 0, diagnostic)
            self.assertIn("source_transport=github-exact-sha", result.stdout, diagnostic)
            self.assertIn("CALLER resumed", result.stdout, diagnostic)
            # 浅取源同样供出确定性 epoch 与 WASM 注入。
            epoch = subprocess.check_output(
                ["git", "-C", str(origin), "show", "-s", "--format=%ct", sha], text=True).strip()
            docker_log = (cache / "docker.log").read_text()
            self.assertIn(f"--build-arg SOURCE_DATE_EPOCH={epoch}", docker_log, docker_log)
            self.assertTrue((cache / "fetched").exists(), diagnostic)
            # build 结束后不留浅取目录、不留注册的 worktree。
            self.assertFalse((cache / "source-shallow").exists(), diagnostic)
            worktrees = subprocess.check_output(
                ["git", "-C", str(origin), "worktree", "list", "--porcelain"], text=True)
            self.assertEqual(worktrees.count("worktree "), 1, worktrees)


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

    def test_lookup_treats_no_such_manifest_as_missing_tag(self):
        # TX2 的 docker manifest inspect 对缺失 tag 报 "no such manifest"，
        # 必须返回 10（触发构建），不能当成致命错误。
        fixture = '''
docker_image_digest() { printf 'no such manifest: repo:tag\\n' >&2; return 1; }
lookup_remote_digest repo:tag
'''
        result = subprocess.run(["bash", "-s"], input=FUNCTIONS + fixture, text=True,
                                capture_output=True, timeout=20)
        self.assertEqual(result.returncode, 10, result.stdout + result.stderr)


class FrontendBuilderSourceTransportTest(unittest.TestCase):
    """源物化：国内镜像优先，镜像落后时按 exact SHA 直取 GitHub。

    两条路径产出的源仓库必须同构（同一个 commit、可读同一棵树），并且都不拿到该
    commit 时必须 fail closed 而不是继续构建。
    """

    DRIVER = '''
materialize_source "$SOURCE_SHA"
printf 'SOURCE_DIR=%s\\n' "$SOURCE_DIR"
git -C "$SOURCE_DIR" cat-file -e "$SOURCE_SHA^{commit}"
git -C "$SOURCE_DIR" show "$SOURCE_SHA:marker.txt"
'''

    @staticmethod
    def display(value):
        # Git Bash 打印 POSIX 路径，Windows 上 Path 用反斜杠：两侧统一后再比较。
        return str(value).replace("\\", "/")

    def build_fixture(self, directory, mirror_has_sha):
        """真实 git 仓库：origin 是 GitHub 源，mirror 是"落后"的 Gitee 镜像。"""
        cache = Path(directory) / "cache"
        origin = Path(directory) / "origin"
        mirror = Path(directory) / "mirror"
        origin.mkdir()
        subprocess.run(["git", "init", "-q", "-b", "main", str(origin)], check=True)
        (origin / "marker.txt").write_text("fixture\n")
        subprocess.run(["git", "-C", str(origin), "add", "."], check=True)
        subprocess.run([
            "git", "-C", str(origin), "-c", "user.name=Fixture",
            "-c", "user.email=fixture@example.invalid", "-c", "commit.gpgsign=false",
            "commit", "-qm", "fixture",
        ], check=True)
        sha = subprocess.check_output(["git", "-C", str(origin), "rev-parse", "HEAD"], text=True).strip()
        # 按 SHA 浅取要求服务端显式放行未在 ref 中通告的 commit。
        subprocess.run(["git", "-C", str(origin), "config", "uploadpack.allowAnySHA1InWant", "true"],
                       check=True)
        if mirror_has_sha:
            subprocess.run(["git", "clone", "-q", "--bare", str(origin), str(mirror)], check=True)
        else:
            subprocess.run(["git", "init", "-q", "--bare", "-b", "main", str(mirror)], check=True)
        env = {
            **os.environ,
            "WOTB_TX_BUILD_CACHE_ROOT": str(cache),
            "WOTB_GITEE_REPO_URL": mirror.resolve().as_uri(),
            "WOTB_GITHUB_REPO_URL": origin.resolve().as_uri(),
            "SOURCE_SHA": sha,
            "GITEE_WAIT_ATTEMPTS": "1", "GITEE_WAIT_INTERVAL_SECONDS": "1",
            "GITHUB_FETCH_ATTEMPTS": "1", "GITHUB_FETCH_TIMEOUT_SECONDS": "60",
            "KILL_AFTER_SECONDS": "10", "RETRY_BACKOFF_LATER_SECONDS": "1",
        }
        result = subprocess.run(["bash", "-s"], input=FUNCTIONS + self.DRIVER, env=env,
                                text=True, capture_output=True, timeout=120)
        return cache, sha, result

    def test_mirror_hit_uses_the_domestic_clone(self):
        with tempfile.TemporaryDirectory() as directory:
            cache, sha, result = self.build_fixture(directory, mirror_has_sha=True)
            diagnostic = result.stdout + result.stderr
            self.assertEqual(result.returncode, 0, diagnostic)
            self.assertIn("source_transport=gitee-mirror", result.stdout, diagnostic)
            self.assertIn(self.display(cache / "repo"), self.display(result.stdout), diagnostic)
            self.assertNotIn("github_exact_fetch", result.stdout, diagnostic)
            self.assertIn("fixture", result.stdout, diagnostic)

    def test_lagging_mirror_falls_back_to_the_exact_sha(self):
        with tempfile.TemporaryDirectory() as directory:
            cache, sha, result = self.build_fixture(directory, mirror_has_sha=False)
            diagnostic = result.stdout + result.stderr
            self.assertEqual(result.returncode, 0, diagnostic)
            self.assertIn("gitee_sync result=LAG", result.stdout, diagnostic)
            self.assertIn("source_transport=github-exact-sha", result.stdout, diagnostic)
            self.assertIn(self.display(cache / "source-shallow"), self.display(result.stdout), diagnostic)
            self.assertIn(f"github_exact_fetch result=PASS source_sha={sha}", result.stdout, diagnostic)
            # 兜底仓与镜像仓同构：同一个 commit、同一棵树。
            self.assertIn("fixture", result.stdout, diagnostic)

    def test_missing_sha_everywhere_fails_closed(self):
        with tempfile.TemporaryDirectory() as directory:
            cache = Path(directory) / "cache"
            empty = Path(directory) / "empty"
            empty.mkdir()
            subprocess.run(["git", "init", "-q", str(empty)], check=True)
            env = {
                **os.environ,
                "WOTB_TX_BUILD_CACHE_ROOT": str(cache),
                "WOTB_GITEE_REPO_URL": empty.resolve().as_uri(),
                "WOTB_GITHUB_REPO_URL": empty.resolve().as_uri(),
                "SOURCE_SHA": "0" * 40,
                "GITEE_WAIT_ATTEMPTS": "1", "GITEE_WAIT_INTERVAL_SECONDS": "1",
                "GITHUB_FETCH_ATTEMPTS": "1", "GITHUB_FETCH_TIMEOUT_SECONDS": "60",
                "KILL_AFTER_SECONDS": "10", "RETRY_BACKOFF_LATER_SECONDS": "1",
            }
            result = subprocess.run(["bash", "-s"], input=FUNCTIONS + self.DRIVER, env=env,
                                    text=True, capture_output=True, timeout=120)
            diagnostic = result.stdout + result.stderr
            self.assertEqual(result.returncode, 1, diagnostic)
            self.assertIn("neither on Gitee main nor fetchable from GitHub", diagnostic)
            self.assertNotIn("SOURCE_DIR=", result.stdout, diagnostic)


if __name__ == "__main__":
    unittest.main()
