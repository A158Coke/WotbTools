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
import textwrap
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

    def test_gitee_source_builds_and_cleans_up(self):
        """真实 Gitee exact-SHA 源能开 worktree、供 epoch，并被清理干净。"""
        with tempfile.TemporaryDirectory(prefix="frontend gitee source-") as directory:
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
            subprocess.run(["git", "clone", "-q", "--bare", str(origin), str(mirror)], check=True)
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
                "SOURCE_SHA": sha, "AGENT_ARCHIVE": str(archive),
                "GITEE_WAIT_ATTEMPTS": "1", "GITEE_WAIT_INTERVAL_SECONDS": "1",
                "KILL_AFTER_SECONDS": "10", "RETRY_BACKOFF_LATER_SECONDS": "1",
            }
            result = subprocess.run(["bash", "-s"], input=FUNCTIONS + fixture, env=env,
                                    text=True, capture_output=True, timeout=180)
            diagnostic = result.stdout + result.stderr
            self.assertEqual(result.returncode, 0, diagnostic)
            self.assertIn("source_transport=gitee-mirror", result.stdout, diagnostic)
            self.assertIn("CALLER resumed", result.stdout, diagnostic)
            # Gitee 源供出确定性 epoch 与 WASM 注入。
            epoch = subprocess.check_output(
                ["git", "-C", str(origin), "show", "-s", "--format=%ct", sha], text=True).strip()
            docker_log = (cache / "docker.log").read_text()
            self.assertIn(f"--build-arg SOURCE_DATE_EPOCH={epoch}", docker_log, docker_log)
            self.assertTrue((cache / "fetched").exists(), diagnostic)
            # build 结束后不留注册的 worktree。
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


class BuilderSourceTransportTest(unittest.TestCase):
    """两服务仅接受 Gitee main 历史中的 exact SHA，拒绝其他缓存对象。"""

    def run_source(self, owner, state):
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            origin, mirror, cache = (base / name for name in ("origin", "mirror", "cache"))
            subprocess.run(["git", "init", "-q", "-b", "main", str(origin)], check=True)
            (origin / "marker.txt").write_text("fixture\n")
            def commit():
                subprocess.run(["git", "-C", str(origin), "add", "."], check=True)
                subprocess.run(["git", "-C", str(origin), "-c", "user.name=Fixture",
                                "-c", "user.email=fixture@example.invalid", "-c", "commit.gpgsign=false",
                                "commit", "-qm", "fixture"], check=True)
                return subprocess.check_output(["git", "-C", str(origin), "rev-parse", "HEAD"], text=True).strip()
            first = commit()
            (origin / "marker.txt").write_text("second\n")
            second = commit()
            subprocess.run(["git", "clone", "-q", "--bare", str(origin), str(mirror)], check=True)
            sha = first if state == "ancestor" else second
            if state in ("lag", "off-main"):
                subprocess.run(["git", "-C", str(mirror), "update-ref", "refs/heads/main", first], check=True)
            if state == "off-main":
                # 对象已在缓存，但不在刚 fetch 的 main 历史里。
                repo = cache / "repo"
                repo.parent.mkdir()
                subprocess.run(["git", "clone", "-q", str(mirror), str(repo)], check=True)
                subprocess.run(["git", "-C", str(repo), "fetch", str(origin), second], check=True)
                subprocess.run(["git", "-C", str(repo), "remote", "set-url", "origin", mirror.resolve().as_uri()], check=True)
            if state == "unavailable":
                mirror = base / "missing"
            builder = ROOT / f"deploy/tx/build-{owner}-from-gitee.sh"
            delimiter = '[ "$#" -eq 8 ] || usage' if owner == "frontend" else '[ "$#" -eq 4 ] || usage'
            functions, separator, _ = builder.read_text().partition(delimiter)
            self.assertTrue(separator)
            env = {**os.environ, "WOTB_TX_BUILD_CACHE_ROOT": str(cache),
                   "WOTB_GITEE_REPO_URL": mirror.resolve().as_uri(), "SOURCE_SHA": sha,
                   "GITEE_WAIT_ATTEMPTS": "2", "GITEE_WAIT_INTERVAL_SECONDS": "1"}
            driver = r'''
sleep() { :; }
materialize_source "$SOURCE_SHA"
git -C "$SOURCE_DIR" show "$SOURCE_SHA:marker.txt"
printf 'SOURCE_READY\n'
'''
            if state not in ("hit", "ancestor"):
                # 运行真实 build_publish，证明取源失败在 registry lookup/build/push 之前中止。
                driver = r'''
validate_common() { :; }
flock() { :; }
lookup_remote_digest() { echo REGISTRY_REACHED; return 10; }
docker() { echo DOCKER_REACHED; }
''' + ('build_publish "$SOURCE_SHA" ccr.ccs.tencentyun.com fixture https://assets.example.invalid unused "" ""\n'
       if owner == "frontend" else 'build_publish "$SOURCE_SHA" ccr.ccs.tencentyun.com fixture\n')
            result = subprocess.run(["bash", "-s"], input=functions + driver, env=env,
                                    text=True, capture_output=True, timeout=30)
            diagnostic = result.stdout + result.stderr
            if state in ("hit", "ancestor"):
                self.assertEqual(result.returncode, 0, diagnostic)
                self.assertIn("source_transport=gitee-mirror", result.stdout)
                self.assertIn("fixture" if state == "ancestor" else "second", result.stdout)
                self.assertIn("SOURCE_READY", result.stdout)
            else:
                self.assertNotEqual(result.returncode, 0, diagnostic)
                self.assertIn("gitee_sync attempt=2/2", result.stdout)
                self.assertIn("source SHA did not reach Gitee main within the bounded wait", diagnostic)
                self.assertNotIn("SOURCE_READY", result.stdout)
                self.assertNotIn("source_transport=", result.stdout)
                self.assertNotIn("REGISTRY_REACHED", result.stdout)
                self.assertNotIn("DOCKER_REACHED", result.stdout)

    def test_both_builders_exact_sha_and_failure_contract(self):
        for owner in ("frontend", "business-api"):
            for state in ("hit", "ancestor", "lag", "off-main", "unavailable"):
                with self.subTest(owner=owner, state=state):
                    self.run_source(owner, state)


class GiteeMainSyncTest(unittest.TestCase):
    """执行 workflow 的原始 bash，以真实 Git refs 证明单 ref 与 lease 语义。"""

    def run_sync(self, case):
        workflow = (ROOT / ".github/workflows/gitee-mirror.yml").read_text(encoding="utf-8")
        script = textwrap.dedent(workflow.split("      - name: Sync and verify only Gitee main", 1)[1].split("        run: |\n", 1)[1])
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            source, target, upstream = (base / n for n in ("source", "gitee", "github"))
            def git(*args, cwd=None):
                return subprocess.check_output(["git", "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid",
                                                "-c", "commit.gpgsign=false", *args], cwd=cwd, text=True, stderr=subprocess.PIPE).strip()
            git("init", "-q", "-b", "main", str(source))
            (source / "marker").write_text("first")
            git("add", ".", cwd=source)
            git("commit", "-qm", "first", cwd=source)
            first = git("rev-parse", "HEAD", cwd=source)
            (source / "marker").write_text("second")
            git("commit", "-qam", "second", cwd=source)
            sha = git("rev-parse", "HEAD", cwd=source)
            race = git("commit-tree", "HEAD^{tree}", "-p", first, "-m", "racing writer", cwd=source)
            git("tag", "-a", "source-only", "-m", "must not be pushed", cwd=source)
            git("config", "push.followTags", "true", cwd=source)
            git("clone", "-q", "--bare", str(source), str(upstream))
            git("remote", "add", "origin", upstream.resolve().as_uri(), cwd=source)
            git("clone", "-q", "--bare", str(source), str(target))
            git("--git-dir", str(target), "update-ref", "-d", "refs/tags/source-only")
            git("--git-dir", str(target), "update-ref", "refs/heads/main", first)
            git("--git-dir", str(target), "update-ref", "refs/heads/asset-origin", first)
            git("--git-dir", str(target), "update-ref", "refs/heads/other", first)
            git("--git-dir", str(target), "update-ref", "refs/tags/preserved", first)
            if case == "empty":
                git("--git-dir", str(target), "update-ref", "-d", "refs/heads/main")
            if case == "stale":
                git("--git-dir", str(upstream), "update-ref", "refs/heads/main", first)
            before = git("--git-dir", str(target), "show-ref")
            env = {**os.environ, "SOURCE_SHA": sha, "GITEE_TOKEN": "fixture-token",
                   "GITEE_USERNAME": "fixture", "GITEE_REPO_URL": target.resolve().as_uri(),
                   "RUNNER_TEMP": str(base), "CASE": case, "RACE_SHA": race,
                   "TARGET_DIR": str(target), "FIXTURE_ROOT": str(base)}
            shim = r'''
timeout() { while [[ "$1" = --* ]]; do shift; done; shift; "$@"; }
git() {
  if [[ "$*" == *"ls-remote --refs $GITEE_REPO_URL refs/heads/main"* ]]; then
    count=$(cat "$FIXTURE_ROOT/reads" 2>/dev/null || echo 0)
    count=$((count + 1)); echo "$count" > "$FIXTURE_ROOT/reads"
    if [ "$CASE" = observation-error ]; then return 9; fi
    if [ "$CASE" = malformed ]; then printf 'not-a-sha\trefs/heads/main\n'; return; fi
    if [ "$CASE" = verify-mismatch ] && [ "$count" -eq 2 ]; then
      printf '%s\trefs/heads/main\n' "$RACE_SHA"; return
    fi
  fi
  if [[ " $* " == *" push "* ]] && [ "$CASE" = race ]; then
    command git --git-dir="$TARGET_DIR" update-ref refs/heads/main "$RACE_SHA"
  fi
  command git "$@"
}
'''
            result = subprocess.run(["bash", "-s"], input=shim + script, cwd=source, env=env,
                                    text=True, capture_output=True, timeout=30)
            diagnostic = result.stdout + result.stderr
            actual = git("--git-dir", str(target), "rev-parse", "refs/heads/main") if case != "empty" or result.returncode == 0 else ""
            if case in ("success", "empty"):
                self.assertEqual(result.returncode, 0, diagnostic)
                self.assertEqual(actual, sha)
                self.assertIn("gitee_main_sync result=PASS", result.stdout)
            else:
                self.assertNotEqual(result.returncode, 0, diagnostic)
                self.assertNotIn("gitee_main_sync result=PASS", result.stdout)
                self.assertEqual(actual, race if case == "race" else sha if case == "verify-mismatch" else first)
            after = git("--git-dir", str(target), "show-ref")
            without_main = lambda refs: [l for l in refs.splitlines() if not l.endswith(" refs/heads/main")]
            self.assertEqual(without_main(before), without_main(after))
            self.assertFalse((base / "gitee-main-askpass.sh").exists(), diagnostic)

    def test_main_invocation_guard(self):
        workflow = (ROOT / ".github/workflows/gitee-mirror.yml").read_text(encoding="utf-8")
        guard = textwrap.dedent(workflow.split("        run: |\n", 1)[1].split("      - uses:", 1)[0])
        for event, ref, accepted in (("push", "refs/heads/main", True),
                                     ("workflow_dispatch", "refs/heads/main", True),
                                     ("push", "refs/heads/other", False),
                                     ("pull_request", "refs/heads/main", False)):
            with self.subTest(event=event, ref=ref):
                result = subprocess.run(["bash", "-s"], input=guard,
                                        env={**os.environ, "EVENT_NAME": event, "EVENT_REF": ref},
                                        text=True, capture_output=True, timeout=10)
                self.assertEqual(result.returncode == 0, accepted, result.stdout + result.stderr)

    def test_sync_and_failure_contract(self):
        for case in ("success", "empty", "race", "stale", "verify-mismatch", "observation-error", "malformed"):
            with self.subTest(case=case):
                self.run_sync(case)


if __name__ == "__main__":
    unittest.main()
