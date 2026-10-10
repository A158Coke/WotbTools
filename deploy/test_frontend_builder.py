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
flock() { :; }
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
  printf '%s\n' "$1" >> "$CACHE_ROOT/docker.log"
  if [ "$1" = push ]; then : > "$CACHE_ROOT/pushed"; fi
}
build_publish "$SOURCE_SHA" ccr.ccs.tencentyun.com fixture https://assets.example.invalid "$AGENT_ARCHIVE" "$SPONSOR_BUNDLE" "$SPONSOR_FINGERPRINT"
printf 'CALLER resumed\n'
'''


class FrontendBuilderCleanupTest(unittest.TestCase):
    def run_case(self, mode="fresh", sponsor=True, fail_stage="", unsafe_bundle=False):
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
            }
            result = subprocess.run(["bash", "-c", FUNCTIONS + FIXTURE], env=env, text=True,
                                    capture_output=True, timeout=20)
            worktree_path = cache / "worktree.path"
            if worktree_path.exists():
                self.addCleanup(shutil.rmtree, worktree_path.read_text().strip(), True)
            diagnostic = result.stdout + result.stderr
            expected_status = 1 if unsafe_bundle else 17 if fail_stage else 0
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


if __name__ == "__main__":
    unittest.main()
