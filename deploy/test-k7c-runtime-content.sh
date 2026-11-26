#!/usr/bin/env bash
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
sync="$ROOT/deploy/tx/k7c-sync-runtime-content.sh"
installer="$ROOT/deploy/tx/install-staging-evidence.sh"
compose="$ROOT/deploy/tx/frontend-shadow.compose.yml"
replica="$ROOT/.github/workflows/frontend-replica.yml"
release="$ROOT/.github/workflows/android-release.yml"

fail(){ echo "$*" >&2; exit 1; }
for path in "$sync" "$installer" "$compose" "$replica" "$release"; do
  [ -f "$path" ] || fail "missing required file: $path"
done


grep -Fq 'K7C_RUNTIME_CONTENT_READY=PASS' "$sync"
grep -Fq 'http://10.20.0.1:8081' "$sync"
grep -Fq '/opt/wotb-tx2/runtime-content' "$sync"
grep -Fq 'apkUrl' "$sync"
! grep -Eq 'rsync|scp|ssh' "$sync"
! grep -Fq 'sponsor-config.json' "$sync"

grep -Fq '*.staging.json' "$sync"
! grep -Fq '"$RUNTIME_ROOT"/android-release/*.apk' "$sync"
carry_line="$(grep -nF 'for evidence in "$RUNTIME_ROOT"/android-release/*.staging.json' "$sync" | head -n1 | cut -d: -f1 || true)"
swap_line="$(grep -nF 'sudo mv "$stage" "$RUNTIME_ROOT"' "$sync" | head -n1 | cut -d: -f1 || true)"
if [ -z "$carry_line" ] || [ -z "$swap_line" ] || [ "$carry_line" -ge "$swap_line" ]; then
  fail "staging evidence must be carried over before the runtime tree swap"
fi

replica_step="$(awk '
  /^      - name: Pull TCR artifact and reconcile TX2$/ { inside = 1 }
  inside && /^      - name: / && !/Pull TCR artifact and reconcile TX2/ { inside = 0 }
  inside { print }
' "$replica")"
[ -n "$replica_step" ] || fail "frontend replica must reconcile TX2 in a single step (lock must cover the sync)"
printf '%s\n' "$replica_step" | grep -Fq 'exec 9>/opt/wotb-tx2/.deploy.lock' \
  || fail "the TX2 reconcile step must take the host deploy lock"
printf '%s\n' "$replica_step" | grep -Fq 'flock -n 9' \
  || fail "the TX2 reconcile step must acquire the host deploy lock"
printf '%s\n' "$replica_step" | grep -Fq 'bash "$incoming/k7c-sync-runtime-content.sh"' \
  || fail "the TX2 reconcile step must run the runtime sync itself"
lock_ln="$(printf '%s\n' "$replica_step" | grep -nF 'exec 9>/opt/wotb-tx2/.deploy.lock' | head -n1 | cut -d: -f1 || true)"
sync_ln="$(printf '%s\n' "$replica_step" | grep -nF 'bash "$incoming/k7c-sync-runtime-content.sh"' | head -n1 | cut -d: -f1 || true)"
if [ -z "$lock_ln" ] || [ -z "$sync_ln" ] || [ "$lock_ln" -ge "$sync_ln" ]; then
  fail "the host deploy lock must be taken before the runtime sync runs"
fi

python3 - "$ROOT" <<'PY'
import sys
from pathlib import Path
root = Path(sys.argv[1])
sys.path.insert(0, str(root / "scripts/android-release"))
import workflow_model
model = workflow_model.load(root)
stage_steps = model["jobs"]["stage"]["steps"]
def all_text(step):
    with_ = step.get("with") or {}
    return "\n".join((step.get("run") or "", with_.get("script") or "", with_.get("source") or "", with_.get("target") or ""))
stage_text = "\n".join(all_text(step) for step in stage_steps)
assert "install-staging-evidence.sh" in stage_text, "the release stage must install evidence through the installer"
assert "--lock /opt/wotb-tx/.deploy.lock" in stage_text, "the TX install must take the TX host deploy lock"
assert "--lock /opt/wotb-tx2/.deploy.lock" in stage_text, "the TX2 install must take the TX2 host deploy lock"
# 被服务目录只允许接收 publish 的 version.json（既有机制）；staging evidence 直接 scp 进去就是
# 2026-10-09 那个竞态。逐 step 比对 source/target，避免误伤 version.json 的直传。
served = ("/opt/wotb-tx/android-release", "/opt/wotb-tx2/runtime-content/android-release")
straight = []
for job_id in ("stage", "publish"):
    for step in model["jobs"][job_id]["steps"]:
        with_ = step.get("with") or {}
        target = with_.get("target") or ""
        if target and any(target.startswith(prefix) for prefix in served):
            straight.append((job_id, step.get("name"), with_.get("source"), target))
for job_id, name, source, target in straight:
    if "version.json" not in (source or ""):
        raise SystemExit(f"step {name!r} ({job_id}) uploads {source!r} straight into the served tree {target!r}")
print(f"served-tree uploads are manifest-only: {len(straight)} step(s)")
PY

grep -Fq '/opt/wotb-tx2/runtime-content/android-release:/usr/share/nginx/html/download/android:ro' "$compose"
! grep -Fiq 'sponsor' "$compose"


for cmd in curl flock python3 sha256sum; do command -v "$cmd" >/dev/null || fail "missing command: $cmd"; done
sudo -n true 2>/dev/null || fail "passwordless sudo is required (the runtime sync mutates its root through sudo)"

work="$(mktemp -d)"
server_pid=''
fixture_pids=''
cleanup(){ [ -z "$server_pid" ] || kill "$server_pid" 2>/dev/null || true; [ -z "$fixture_pids" ] || kill $fixture_pids 2>/dev/null || true; rm -rf "$work"; }
trap cleanup EXIT

mkdir -p "$work/sync-bin"
export REAL_CURL="$(command -v curl)"
cat > "$work/sync-bin/curl" <<'CURL'
#!/usr/bin/env bash
for arg in "$@"; do [[ "$arg" != https://wotbtools.com/* ]] || exit 22; done
exec "$REAL_CURL" "$@"
CURL
chmod +x "$work/sync-bin/curl"

source_root="$work/source"; live_root="$work/runtime-content"
mkdir -p "$source_root/download/android" "$live_root/android-release"
printf 'fixture-apk-bytes\n' > "$source_root/download/android/wotbtools-android-v2.1.18.apk"
apk_sha="$(sha256sum "$source_root/download/android/wotbtools-android-v2.1.18.apk" | awk '{print $1}')"
python3 - "$source_root" "$apk_sha" <<'PY'
import json, pathlib, sys
root = pathlib.Path(sys.argv[1])
(root / "download/android/version.json").write_text(json.dumps({
    "schemaVersion": 1, "latestVersionCode": 2001018, "latestVersionName": "2.1.18",
    "apkUrl": "https://wotbtools.com/download/android/wotbtools-android-v2.1.18.apk",
    "sha256": sys.argv[2],
}, indent=2) + "\n", encoding="utf-8")
PY
printf '{"versionName":"2.1.18","versionCode":2001018}\n' > "$live_root/android-release/wotbtools-android-v2.1.18.staging.json"
printf 'stale-apk\n' > "$live_root/android-release/wotbtools-android-v2.1.17.apk"
printf 'delta-fixture\n' > "$work/delta"
delta_sha="$(sha256sum "$work/delta" | awk '{print $1}')"
delta_name="wotbtools-android-delta-4000000-4001000-$delta_sha.vcdiff"
cp "$work/delta" "$live_root/android-release/$delta_name"

port="$(python3 -c 'import socket;s=socket.socket();s.bind(("127.0.0.1",0));print(s.getsockname()[1]);s.close()')"
python3 -m http.server --directory "$source_root" --bind 127.0.0.1 "$port" >/dev/null 2>&1 &
server_pid=$!
for _ in $(seq 1 60); do
  curl -fsS "http://127.0.0.1:$port/download/android/version.json" >/dev/null 2>&1 && break
  sleep 0.1
done

PATH="$work/sync-bin:$PATH" K7C_RUNTIME_SOURCE_BASE="http://127.0.0.1:$port" K7C_RUNTIME_ROOT="$live_root" \
  bash "$sync" > "$work/sync.log" 2>&1 \
  || { cat "$work/sync.log" >&2; fail "the runtime sync must succeed against a valid source"; }
grep -Fq 'K7C_RUNTIME_CONTENT_READY=PASS' "$work/sync.log" \
  || { cat "$work/sync.log" >&2; fail "the runtime sync must report PASS"; }

[ -f "$live_root/android-release/wotbtools-android-v2.1.18.staging.json" ] \
  || fail "the tree rebuild must carry the unpublished staging evidence forward (2026-10-09 regression)"
cmp -s "$work/delta" "$live_root/android-release/$delta_name" || fail "the tree rebuild must preserve the exact immutable delta"
[ -f "$live_root/android-release/version.json" ] \
  || fail "the tree rebuild must refresh version.json from the authoritative source"
cmp -s "$live_root/android-release/wotbtools-android-v2.1.18.apk" "$source_root/download/android/wotbtools-android-v2.1.18.apk" \
  || fail "the tree rebuild must fetch the APK referenced by the manifest, byte for byte"
[ ! -e "$live_root/android-release/wotbtools-android-v2.1.17.apk" ] \
  || fail "historical APKs must not be carried into the rebuilt tree"
printf 'invalid immutable evidence' > "$live_root/android-release/wotbtools-android-v4.0.1.staging.json"
PATH="$work/sync-bin:$PATH" K7C_RUNTIME_SOURCE_BASE="http://127.0.0.1:$port" K7C_RUNTIME_ROOT="$live_root" \
  bash "$sync" > "$work/invalid-sync.log" 2>&1 && fail 'invalid evidence must stop the tree swap'
[ "$(cat "$live_root/android-release/wotbtools-android-v4.0.1.staging.json")" = 'invalid immutable evidence' ] \
  || fail 'invalid evidence must remain available for recovery'
rm "$live_root/android-release/wotbtools-android-v4.0.1.staging.json"

ln -s "$work/missing-evidence" "$live_root/android-release/wotbtools-android-v4.0.1.staging.json"
PATH="$work/sync-bin:$PATH" K7C_RUNTIME_SOURCE_BASE="http://127.0.0.1:$port" K7C_RUNTIME_ROOT="$live_root" \
  bash "$sync" > "$work/symlink-sync.log" 2>&1 && fail 'dangling evidence must stop the tree swap, not become missing'
[ -L "$live_root/android-release/wotbtools-android-v4.0.1.staging.json" ] || fail 'invalid evidence must not disappear during a rebuild'
rm "$live_root/android-release/wotbtools-android-v4.0.1.staging.json"

lock_dir="$work/lock"; incoming="$work/incoming"; served="$work/served"
mkdir -p "$lock_dir" "$incoming" "$served"
: > "$lock_dir/.deploy.lock"
printf '{"versionName":"2.1.19","versionCode":2001019}\n' > "$incoming/wotbtools-android-v2.1.19.staging.json"

flock "$lock_dir/.deploy.lock" -c 'sleep 4' &
holder_pid=$!
sleep 0.5
bash "$installer" --source "$incoming/wotbtools-android-v2.1.19.staging.json" \
  --dest-dir "$served" --lock "$lock_dir/.deploy.lock" > "$work/install.log" 2>&1 &
installer_pid=$!
sleep 1.5
[ ! -e "$served/wotbtools-android-v2.1.19.staging.json" ] \
  || fail "evidence must not become visible while the host deploy lock is held"
kill -0 "$installer_pid" 2>/dev/null \
  || { cat "$work/install.log" >&2; fail "the installer must wait for the host deploy lock, not skip or fail it"; }
wait "$installer_pid" || { cat "$work/install.log" >&2; fail "the installer must land the evidence once the lock is released"; }
wait "$holder_pid" 2>/dev/null || true

installed="$served/wotbtools-android-v2.1.19.staging.json"
[ -f "$installed" ] || fail "the installer must land the evidence under the host deploy lock"
[ "$(cat "$installed")" = '{"versionName":"2.1.19","versionCode":2001019}' ] \
  || fail "the installed evidence must keep its exact bytes"
[ "$(stat -c '%a' "$installed")" = '644' ] || fail "the installed evidence must be world-readable for nginx"

gap_lock_dir="$work/lock-gap"; gap_served="$work/served-gap"
mkdir -p "$gap_lock_dir" "$gap_served"; : > "$gap_lock_dir/.deploy.lock"
printf '{"versionName":"2.1.21","versionCode":2001021}\n' > "$incoming/wotbtools-android-v2.1.21.staging.json"
flock "$gap_lock_dir/.deploy.lock" -c 'sleep 6' &
gap_holder=$!
sleep 0.5
mv "$gap_served" "$gap_served.previous"
bash "$installer" --source "$incoming/wotbtools-android-v2.1.21.staging.json" \
  --dest-dir "$gap_served" --lock "$gap_lock_dir/.deploy.lock" > "$work/gap-install.log" 2>&1 &
gap_installer=$!
sleep 1.5
kill -0 "$gap_installer" 2>/dev/null \
  || { cat "$work/gap-install.log" >&2; fail "the installer must wait for the lock even while the served tree is swapped away (directory gap)"; }
mkdir -p "$gap_served"
wait "$gap_installer" || { cat "$work/gap-install.log" >&2; fail "the installer must land the evidence once the swap finishes and the lock is released"; }
wait "$gap_holder" 2>/dev/null || true
[ -f "$gap_served/wotbtools-android-v2.1.21.staging.json" ] \
  || fail "evidence must land in the freshly swapped tree after waiting out the directory gap"

printf '{"versionName":"2.1.20","versionCode":2001020}\n' > "$incoming/wotbtools-android-v2.1.20.staging.json"
bash "$installer" --source "$incoming/wotbtools-android-v2.1.20.staging.json" --dest-dir "$served" \
  --lock "$work/no-such.lock" >/dev/null 2>&1 \
  && fail "the installer must fail closed when the host deploy lock is missing (never create it)"
bash "$installer" --source "$incoming/wotbtools-android-v2.1.20.staging.json" --dest-dir "$work/no-such-dir" \
  --lock "$lock_dir/.deploy.lock" >/dev/null 2>&1 \
  && fail "the installer must fail closed when the served destination directory is missing"
printf 'not evidence\n' > "$incoming/random.txt"
bash "$installer" --source "$incoming/random.txt" --dest-dir "$served" --lock "$lock_dir/.deploy.lock" >/dev/null 2>&1 \
  && fail "the installer must refuse to install a non-evidence file"
[ ! -e "$served/random.txt" ] || fail "a refused install must leave the served tree untouched"

cp "$work/delta" "$incoming/$delta_name"
bash "$installer" --source "$incoming/$delta_name" --dest-dir "$served" --lock "$lock_dir/.deploy.lock" >/dev/null
cp "$work/delta" "$incoming/$delta_name"
bash "$installer" --source "$incoming/$delta_name" --dest-dir "$served" --lock "$lock_dir/.deploy.lock" >/dev/null
printf 'conflict\n' > "$served/$delta_name"
cp "$work/delta" "$incoming/$delta_name"
bash "$installer" --source "$incoming/$delta_name" --dest-dir "$served" --lock "$lock_dir/.deploy.lock" >/dev/null 2>&1 && fail "delta conflict must fail closed"
[ "$(cat "$served/$delta_name")" = conflict ] || fail "delta conflict must not overwrite existing bytes"
printf 'bad\n' > "$incoming/$delta_name"
bash "$installer" --source "$incoming/$delta_name" --dest-dir "$served" --lock "$lock_dir/.deploy.lock" >/dev/null 2>&1 && fail "delta with incorrect content-addressed hash must fail"
truncate -s 1073741824 "$served/wotbtools-android-delta-4001000-4002000-cap.vcdiff"
printf 'another delta\n' > "$work/new-delta"
new_sha="$(sha256sum "$work/new-delta" | awk '{print $1}')"
new_name="wotbtools-android-delta-4002000-4003000-$new_sha.vcdiff"
cp "$work/new-delta" "$incoming/$new_name"
bash "$installer" --source "$incoming/$new_name" --dest-dir "$served" --lock "$lock_dir/.deploy.lock" >/dev/null 2>&1 && fail "delta storage limit must fail closed"
[ ! -e "$served/$new_name" ] || fail "over-budget delta must not be installed"
[ -f "$served/wotbtools-android-delta-4001000-4002000-cap.vcdiff" ] || fail "storage cap must not delete existing files"

origin="$work/origins"; mkdir -p "$origin/tx1" "$origin/tx2" "$origin/bin"
: > "$origin/tx1.lock"; : > "$origin/tx2.lock"
cat > "$origin/bin/ssh" <<'SH'
#!/usr/bin/env bash
case "$*" in
  *user@tx1*) node=tx1 ;;
  *user@tx2*) node=tx2 ;;
  *) exit 255 ;;
esac
[ "${UNREACHABLE_NODE:-}" != "$node" ] || exit 255
if [[ "$*" == *read-patch* ]]; then
  exec bash -s -- read-patch "$ORIGIN_TEST_ROOT/$node" "$ORIGIN_TEST_ROOT/$node.lock" "$EVIDENCE_PATCH_NAME" "$EVIDENCE_PATCH_SHA" "$EVIDENCE_PATCH_SIZE"
fi
exec bash -s -- read "$ORIGIN_TEST_ROOT/$node" "$ORIGIN_TEST_ROOT/$node.lock" "$EVIDENCE_TEST_NAME"
SH
chmod +x "$origin/bin/ssh"
export ORIGIN_TEST_ROOT="$origin" EVIDENCE_TEST_NAME=wotbtools-android-v4.0.1.staging.json
export TX1_SSH_HOST=tx1 TX2_SSH_HOST=tx2 TX1_SSH_USER=user TX2_SSH_USER=user TX1_SSH_PORT=22 TX2_SSH_PORT=22 TX1_SSH_KEY=fixture TX2_SSH_KEY=fixture
export RUNNER_TEMP="$work" PATH="$origin/bin:$PATH"
collector="$ROOT/scripts/android-release/staging-evidence.sh"
collect() { bash "$collector" "$1" "$EVIDENCE_TEST_NAME" "$origin/result"; }
[ "$(collect collect)" = 404 ] || fail 'both missing must permit a new full-only identity'
printf 'fixture' > "$origin/patch"
export EVIDENCE_PATCH_SHA="$(sha256sum "$origin/patch" | awk '{print $1}')" EVIDENCE_PATCH_SIZE=7
export EVIDENCE_PATCH_NAME="wotbtools-android-delta-4000000-4000001-$EVIDENCE_PATCH_SHA.vcdiff"
cp "$origin/patch" "$origin/tx1/$EVIDENCE_PATCH_NAME"; cp "$origin/patch" "$origin/tx2/$EVIDENCE_PATCH_NAME"
printf '{"patches":[{"url":"https://wotbtools.com/download/android/%s","sha256":"%s","size":%s}]}\n' "$EVIDENCE_PATCH_NAME" "$EVIDENCE_PATCH_SHA" "$EVIDENCE_PATCH_SIZE" > "$origin/tx1/$EVIDENCE_TEST_NAME"
[ "$(collect collect)" = 200 ] || fail 'partial stage must recover the existing identity'
cmp "$origin/result" "$origin/tx1/$EVIDENCE_TEST_NAME" || fail 'partial stage changed evidence'
collect collect-required >/dev/null 2>&1 && fail 'publish must require both origins'
cp "$origin/result" "$origin/tx2/$EVIDENCE_TEST_NAME"
[ "$(collect collect-required)" = 200 ] || fail 'identical origins must be idempotent'
printf 'bad' > "$origin/tx2/$EVIDENCE_PATCH_NAME"
collect collect-required >/dev/null 2>&1 && fail 'publish must reject an origin patch mismatch'
cp "$origin/patch" "$origin/tx2/$EVIDENCE_PATCH_NAME"
printf '{"patches":[]}\n' > "$origin/tx2/$EVIDENCE_TEST_NAME"
collect collect >/dev/null 2>&1 && fail 'conflicting origins must fail closed'
UNREACHABLE_NODE=tx2 collect collect >/dev/null 2>&1 && fail 'unreachable origin must not be treated as missing'
printf 'invalid' > "$origin/tx2/$EVIDENCE_TEST_NAME"
collect collect >/dev/null 2>&1 && fail 'invalid evidence must fail closed'

concurrent="$work/concurrent"; mkdir -p "$concurrent/a" "$concurrent/b" "$concurrent/served"
: > "$concurrent/lock"
name=wotbtools-android-v4.0.2.staging.json
printf '{"patches":[1]}\n' > "$concurrent/a/$name"; cp "$concurrent/a/$name" "$concurrent/b/$name"
bash "$installer" --source "$concurrent/a/$name" --dest-dir "$concurrent/served" --lock "$concurrent/lock" > "$work/concurrent-a.log" 2>&1 & p1=$!
bash "$installer" --source "$concurrent/b/$name" --dest-dir "$concurrent/served" --lock "$concurrent/lock" > "$work/concurrent-b.log" 2>&1 & p2=$!
wait "$p1" || fail 'first identical concurrent install failed'; wait "$p2" || fail 'second identical concurrent install failed'
printf '{"patches":[]}\n' > "$concurrent/a/$name"
bash "$installer" --source "$concurrent/a/$name" --dest-dir "$concurrent/served" --lock "$concurrent/lock" >/dev/null 2>&1 && fail 'different evidence must not overwrite'
python3 -c 'import json,sys; assert json.load(open(sys.argv[1])) == {"patches":[1]}' "$concurrent/served/$name" || fail 'existing evidence changed or was partly written'
name=wotbtools-android-v4.0.3.staging.json
printf '{"patches":[1]}\n' > "$concurrent/a/$name"; printf '{"patches":[]}\n' > "$concurrent/b/$name"
bash "$installer" --source "$concurrent/a/$name" --dest-dir "$concurrent/served" --lock "$concurrent/lock" > "$work/conflict-a.log" 2>&1 & p1=$!
bash "$installer" --source "$concurrent/b/$name" --dest-dir "$concurrent/served" --lock "$concurrent/lock" > "$work/conflict-b.log" 2>&1 & p2=$!
successes=0
if wait "$p1"; then successes=$((successes+1)); fi
if wait "$p2"; then successes=$((successes+1)); fi
[ "$successes" -eq 1 ] || fail 'different concurrent evidence must have exactly one winner'
python3 -c 'import json,sys; assert json.load(open(sys.argv[1])) in ({"patches": [1]}, {"patches": []})' "$concurrent/served/$name" || fail 'concurrent winner must be complete JSON'


copy_test="$work/copy-failure"; mkdir -p "$copy_test/bin" "$copy_test/incoming" "$copy_test/served"
: > "$copy_test/lock"
export REAL_CP="$(command -v cp)" COPY_TEST_ROOT="$copy_test"
cat > "$copy_test/bin/cp" <<'CP'
#!/usr/bin/env bash
set -eu
[ "$1" != -- ] || shift
head -c 5 "$1" > "$2"
: > "$COPY_TEST_ROOT/copy-started"
while [ ! -e "$COPY_TEST_ROOT/copy-release" ]; do sleep 0.05; done
[ "${INJECT_COPY_FAILURE:-0}" = 0 ] || exit 1
exec "$REAL_CP" "$@"
CP
chmod +x "$copy_test/bin/cp"
name=wotbtools-android-v4.0.4.staging.json
printf '{"patches":[],"identity":"complete"}\n' > "$copy_test/incoming/$name"
for failure in 1 0; do
  rm -f "$copy_test/copy-started" "$copy_test/copy-release"
  PATH="$copy_test/bin:$PATH" INJECT_COPY_FAILURE="$failure" bash "$installer" \
    --source "$copy_test/incoming/$name" --dest-dir "$copy_test/served" --lock "$copy_test/lock" > "$work/copy-$failure.log" 2>&1 & copy_pid=$!
  for _ in $(seq 1 100); do [ ! -e "$copy_test/copy-started" ] || break; sleep 0.05; done
  [ -e "$copy_test/copy-started" ] || fail 'slow-copy injection did not start'
  [ ! -e "$copy_test/served/$name" ] || fail 'partial JSON became visible during copy'
  : > "$copy_test/copy-release"
  if [ "$failure" = 1 ]; then
    wait "$copy_pid" && fail 'injected copy failure was ignored'
    [ -f "$copy_test/incoming/$name" ] && [ ! -e "$copy_test/served/$name" ] || fail 'copy failure consumed input or published partial JSON'
  else
    wait "$copy_pid" || fail 'slow successful copy failed'
    python3 -c 'import json,sys; assert json.load(open(sys.argv[1]))["identity"] == "complete"' "$copy_test/served/$name"
  fi
  [ -z "$(find "$copy_test/served" -name '.android-evidence.*' -print -quit)" ] || fail 'installer leaked a partial scratch file'
done
bash "$installer" --source "$copy_test/served/$name" --dest-dir "$copy_test/served" --lock "$copy_test/lock" >/dev/null 2>&1 && fail 'served source must not be consumed'
ln "$copy_test/served/$name" "$copy_test/incoming/$name"
bash "$installer" --source "$copy_test/incoming/$name" --dest-dir "$copy_test/served" --lock "$copy_test/lock" >/dev/null 2>&1 && fail 'served hard-link alias must not be consumed'
[ -f "$copy_test/served/$name" ] || fail 'scratch alias removed served evidence'
rm "$copy_test/incoming/$name"
mkdir "$copy_test/served/dir.staging.json"
printf '{}\n' > "$copy_test/incoming/dir.staging.json"
bash "$installer" --source "$copy_test/incoming/dir.staging.json" --dest-dir "$copy_test/served" --lock "$copy_test/lock" >/dev/null 2>&1 && fail 'destination directory must fail closed'
[ -z "$(find "$copy_test/served/dir.staging.json" -mindepth 1 -print -quit)" ] || fail 'invalid directory destination was mutated'
if [ -d /dev/shm ] && [ -w /dev/shm ] && [ "$(stat -c %d /dev/shm)" != "$(stat -c %d "$work")" ]; then
  cross="$(mktemp -d /dev/shm/android-evidence-test.XXXXXXXX)"
  printf '{"crossFilesystem":true}\n' > "$cross/$name"
  if ! bash "$installer" --source "$cross/$name" --dest-dir "$served" --lock "$lock_dir/.deploy.lock" > "$work/crossfs.log" 2>&1; then
    rm -rf -- "$cross"; fail 'cross-filesystem evidence install failed'
  fi
  [ ! -e "$cross/$name" ] || fail 'cross-filesystem successful install did not consume scratch'
  rm -rf -- "$cross"
  python3 -c 'import json,sys; assert json.load(open(sys.argv[1])) == {"crossFilesystem":True}' "$served/$name"
else
  echo 'cross-filesystem fixture unavailable; cross-filesystem runtime verification not run'
fi




python3 - "$sync" <<'PY'
import re
import sys

text = open(sys.argv[1], encoding="utf-8").read()


def default(name):
    match = re.search(r"\b" + name + r":-(\d+)", text)
    assert match, name + " default missing"
    return int(match.group(1))


per_attempt = default("K7C_APK_MAX_TIME_SEC")
total = default("K7C_APK_TOTAL_BUDGET_SEC")
public = default("K7C_APK_PUBLIC_BUDGET_SEC")
small = default("K7C_MAX_TIME_SEC")
assert per_attempt > 120, per_attempt
assert total >= per_attempt, (total, per_attempt)
assert total <= 1500, total
assert 0 < public < total, (public, total)
assert total - per_attempt >= 1, (total, per_attempt)
assert public <= total - per_attempt, (public, total, per_attempt)
assert 4 * small + total <= 2100, (small, total)
for needle in ("K7C_APK_INTERNAL_RESERVE_SEC:-$APK_MAX_TIME", "capping public APK budget", "must exceed internal reserve", "without leading zeros", "-C -", "Range: bytes=0-0", "content-range", "sha256 mismatch"):
    assert needle in text, needle
print(f"APK timeout policy: per-attempt={per_attempt}s total={total}s public-budget={public}s internal-reserve={per_attempt}s small-file-worst={4 * small}s job-timeout=2100s")
PY

apk_fixtures="$work/apk-fixtures"
mkdir -p "$apk_fixtures"

cat > "$apk_fixtures/server.py" <<'PY'
#!/usr/bin/env python3
import http.server
import os
import pathlib
import socketserver
import sys
import time

root = pathlib.Path(sys.argv[1]).resolve()
log_path = pathlib.Path(sys.argv[2])
port = int(sys.argv[3])
truncate_once = {item for item in os.environ.get("TRUNCATE_ONCE", "").split(",") if item}
truncate_always = {item for item in os.environ.get("TRUNCATE_ALWAYS", "").split(",") if item}
stall = {item for item in os.environ.get("STALL", "").split(",") if item}
counts = {}
truncated = set()


class Handler(http.server.BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *args):
        pass

    def do_GET(self):
        rel = self.path.split("?", 1)[0].lstrip("/")
        requested = self.headers.get("Range")
        with log_path.open("a", encoding="utf-8") as log:
            log.write(rel + "\t" + (requested or "") + "\n")
        counts[rel] = counts.get(rel, 0) + 1
        target = (root / rel).resolve()
        try:
            target.relative_to(root)
        except ValueError:
            self.send_error(403)
            return
        if not target.is_file():
            self.send_error(404)
            return
        data = target.read_bytes()
        size = len(data)
        start = 0
        end = size - 1
        status = 200
        if requested and requested.startswith("bytes="):
            spec = requested[len("bytes="):].split(",", 1)[0]
            first, _, last = spec.partition("-")
            if first == "":
                start = max(0, size - int(last or 0))
            else:
                start = int(first)
            if last:
                end = min(int(last), size - 1)
            if start >= size:
                self.send_response(416)
                self.send_header("Content-Range", "bytes */" + str(size))
                self.send_header("Content-Length", "0")
                self.end_headers()
                return
            status = 206
        body = data[start:end + 1]
        self.send_response(status)
        self.send_header("Content-Type", "application/octet-stream")
        if status == 206:
            self.send_header("Content-Range", "bytes " + str(start) + "-" + str(end) + "/" + str(size))
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Accept-Ranges", "bytes")
        self.end_headers()
        if rel in stall and requested != "bytes=0-0":
            try:
                self.wfile.write(body[:1024])
                self.wfile.flush()
            except (BrokenPipeError, ConnectionResetError):
                return
            time.sleep(30)
            return
        cut = None
        if rel in truncate_always:
            cut = max(1, len(body) // 4)
        elif rel in truncate_once and rel not in truncated and counts[rel] >= 2:
            truncated.add(rel)
            cut = max(1, len(body) // 4)
        if cut is not None:
            try:
                self.wfile.write(body[:cut])
                self.wfile.flush()
            except (BrokenPipeError, ConnectionResetError):
                return
            self.close_connection = True
            return
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass


class Server(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True


Server(("127.0.0.1", port), Handler).serve_forever()
PY

free_port(){
  python3 - <<'PY'
import socket
with socket.socket() as sock:
    sock.bind(("127.0.0.1", 0))
    print(sock.getsockname()[1])
PY
}

start_fixture(){
  local root="$1" log="$2" port="$3"
  shift 3
  printf 'health\n' > "$root/health.txt"
  env "$@" python3 "$apk_fixtures/server.py" "$root" "$log" "$port" &
  local pid=$!
  fixture_pids="$fixture_pids $pid"
  local _
  for _ in $(seq 1 100); do
    curl -fsS "http://127.0.0.1:$port/health.txt" >/dev/null 2>&1 && return 0
    sleep 0.05
  done
  return 1
}

make_apk(){
  local path="$1" marker="$2"
  mkdir -p "$(dirname "$path")"
  python3 - "$path" "$marker" <<'PY'
import sys
path, marker = sys.argv[1], sys.argv[2]
chunk = (marker * 65536).encode("ascii")
with open(path, "wb") as apk:
    for _ in range(64):
        apk.write(chunk)
PY
}

make_small_apk(){
  local path="$1" marker="$2"
  mkdir -p "$(dirname "$path")"
  python3 - "$path" "$marker" <<'PY'
import sys
path, marker = sys.argv[1], sys.argv[2]
with open(path, "wb") as apk:
    apk.write((marker * 262144).encode("ascii"))
PY
}

write_manifest(){
  local root="$1" name="$2" sha="$3"
  python3 - "$root" "$name" "$sha" <<'PY'
import json
import pathlib
import sys
root, name, sha = pathlib.Path(sys.argv[1]), sys.argv[2], sys.argv[3]
(root / "download/android/version.json").write_text(json.dumps({
    "schemaVersion": 1,
    "latestVersionCode": 990000,
    "latestVersionName": "9.9.0",
    "apkUrl": "https://wotbtools.com/download/android/" + name,
    "sha256": sha,
}, indent=2) + "\n", encoding="utf-8")
PY
}

sha_of(){ sha256sum "$1" | awk '{print $1}'; }

public_bin="$apk_fixtures/public-bin"
mkdir -p "$public_bin"
cat > "$public_bin/curl" <<'CURL'
#!/usr/bin/env bash
args=()
for arg in "$@"; do
  if [[ "$arg" == https://wotbtools.com/* ]]; then
    suffix="$(printf '%s' "$arg" | cut -d/ -f4-)"
    arg="http://127.0.0.1:$PUBLIC_FIXTURE_PORT/$suffix"
  fi
  args+=("$arg")
done
exec "$REAL_CURL" "${args[@]}"
CURL
chmod +x "$public_bin/curl"

resume_src="$apk_fixtures/resume-src"
resume_live="$apk_fixtures/resume-live"
resume_name=wotbtools-android-v9.1.0.apk
mkdir -p "$resume_src/download/android" "$resume_live/android-release"
make_apk "$resume_src/download/android/$resume_name" a
resume_sha="$(sha_of "$resume_src/download/android/$resume_name")"
resume_size="$(stat -c '%s' "$resume_src/download/android/$resume_name")"
write_manifest "$resume_src" "$resume_name" "$resume_sha"
resume_port="$(free_port)"
resume_log="$apk_fixtures/resume.log"
start_fixture "$resume_src" "$resume_log" "$resume_port" "TRUNCATE_ONCE=download/android/$resume_name" \
  || fail 'resume fixture server did not start'
PATH="$work/sync-bin:$PATH" \
  K7C_RUNTIME_SOURCE_BASE="http://127.0.0.1:$resume_port" \
  K7C_RUNTIME_ROOT="$resume_live" \
  K7C_APK_MAX_TIME_SEC=30 K7C_APK_TOTAL_BUDGET_SEC=60 K7C_APK_RETRIES=3 \
  K7C_APK_RETRY_DELAY_SEC=0 K7C_CONNECT_TIMEOUT_SEC=2 \
  bash "$sync" > "$apk_fixtures/resume-sync.log" 2>&1 \
  || { cat "$apk_fixtures/resume-sync.log" >&2; fail 'resume sync failed'; }
grep -Fq 'K7C_RUNTIME_CONTENT_READY=PASS' "$apk_fixtures/resume-sync.log" || fail 'resume sync did not finish'
[ "$(sha_of "$resume_live/android-release/$resume_name")" = "$resume_sha" ] || fail 'resumed APK sha mismatch'
cmp -s "$resume_src/download/android/$resume_name" "$resume_live/android-release/$resume_name" || fail 'resumed APK bytes differ'
python3 - "$resume_log" "$resume_name" "$resume_size" <<'PY'
import re
import sys
log, name, size = sys.argv[1], sys.argv[2], int(sys.argv[3])
prefix = "download/android/" + name
ranges = []
for line in open(log, encoding="utf-8"):
    rel, _, requested = line.rstrip("\n").partition("\t")
    if rel == prefix and requested != "bytes=0-0":
        ranges.append(requested)
offsets = []
for requested in ranges:
    match = re.match(r"bytes=(\d+)-", requested)
    if match:
        offsets.append(int(match.group(1)))
assert ranges, ranges
assert ranges[0] in ("", "bytes=0-"), ranges
assert size // 4 in offsets, (size // 4, offsets)
assert offsets == sorted(offsets), offsets
print(f"resume offsets: {offsets}")
PY

switch_src="$apk_fixtures/switch-src"
switch_public="$apk_fixtures/switch-public"
switch_live="$apk_fixtures/switch-live"
switch_name=wotbtools-android-v9.2.0.apk
mkdir -p "$switch_src/download/android" "$switch_public/download/android" "$switch_live/android-release"
make_apk "$switch_src/download/android/$switch_name" a
cp "$switch_src/download/android/$switch_name" "$switch_public/download/android/$switch_name"
switch_sha="$(sha_of "$switch_src/download/android/$switch_name")"
write_manifest "$switch_src" "$switch_name" "$switch_sha"
switch_port="$(free_port)"
public_port="$(free_port)"
switch_log="$apk_fixtures/switch-internal.log"
public_log="$apk_fixtures/switch-public.log"
start_fixture "$switch_src" "$switch_log" "$switch_port" || fail 'switch internal fixture did not start'
start_fixture "$switch_public" "$public_log" "$public_port" "TRUNCATE_ALWAYS=download/android/$switch_name" \
  || fail 'switch public fixture did not start'
PUBLIC_FIXTURE_PORT="$public_port" PATH="$public_bin:$PATH" \
  K7C_RUNTIME_SOURCE_BASE="http://127.0.0.1:$switch_port" \
  K7C_RUNTIME_ROOT="$switch_live" \
  K7C_APK_MAX_TIME_SEC=20 K7C_APK_TOTAL_BUDGET_SEC=60 K7C_APK_RETRIES=3 \
  K7C_APK_RETRY_DELAY_SEC=0 K7C_CONNECT_TIMEOUT_SEC=2 \
  bash "$sync" > "$apk_fixtures/switch-sync.log" 2>&1 \
  || { cat "$apk_fixtures/switch-sync.log" >&2; fail 'source switch sync failed'; }
[ "$(sha_of "$switch_live/android-release/$switch_name")" = "$switch_sha" ] || fail 'source switch APK sha mismatch'
python3 - "$public_log" "$switch_log" "$switch_name" <<'PY'
import re
import sys
public_log, internal_log, name = sys.argv[1], sys.argv[2], sys.argv[3]
prefix = "download/android/" + name


def offsets(path):
    result = []
    for line in open(path, encoding="utf-8"):
        rel, _, requested = line.rstrip("\n").partition("\t")
        if rel != prefix or requested == "bytes=0-0":
            continue
        match = re.match(r"bytes=(\d+)-", requested)
        result.append(int(match.group(1)) if match else 0)
    return result


public = offsets(public_log)
internal = offsets(internal_log)
assert len(public) >= 2, public
assert any(offset > 0 for offset in public), public
assert internal and all(offset == 0 for offset in internal), internal
print(f"source switch offsets: public={public} internal={internal}")
PY

stall_src="$apk_fixtures/stall-src"
stall_public="$apk_fixtures/stall-public"
stall_live="$apk_fixtures/stall-live"
stall_name=wotbtools-android-v9.2.1.apk
mkdir -p "$stall_src/download/android" "$stall_public/download/android" "$stall_live/android-release"
make_apk "$stall_src/download/android/$stall_name" a
cp "$stall_src/download/android/$stall_name" "$stall_public/download/android/$stall_name"
stall_sha="$(sha_of "$stall_src/download/android/$stall_name")"
write_manifest "$stall_src" "$stall_name" "$stall_sha"
stall_port="$(free_port)"
stall_public_port="$(free_port)"
stall_log="$apk_fixtures/stall-internal.log"
stall_public_log="$apk_fixtures/stall-public.log"
start_fixture "$stall_src" "$stall_log" "$stall_port" || fail 'stall internal fixture did not start'
start_fixture "$stall_public" "$stall_public_log" "$stall_public_port" "STALL=download/android/$stall_name" \
  || fail 'stall public fixture did not start'
PUBLIC_FIXTURE_PORT="$stall_public_port" PATH="$public_bin:$PATH" \
  K7C_RUNTIME_SOURCE_BASE="http://127.0.0.1:$stall_port" \
  K7C_RUNTIME_ROOT="$stall_live" \
  K7C_APK_MAX_TIME_SEC=1 K7C_APK_PUBLIC_BUDGET_SEC=2 K7C_APK_TOTAL_BUDGET_SEC=8 K7C_APK_RETRIES=3 \
  K7C_APK_RETRY_DELAY_SEC=0 K7C_CONNECT_TIMEOUT_SEC=2 \
  bash "$sync" > "$apk_fixtures/stall-sync.log" 2>&1 \
  || { cat "$apk_fixtures/stall-sync.log" >&2; fail 'public stall fallback sync failed'; }
grep -Fq 'K7C_RUNTIME_CONTENT_READY=PASS' "$apk_fixtures/stall-sync.log" || fail 'stall fallback sync did not finish'
grep -Fq 'APK budget exhausted' "$apk_fixtures/stall-sync.log" || fail 'public APK budget exhaustion was not recorded'
[ "$(sha_of "$stall_live/android-release/$stall_name")" = "$stall_sha" ] || fail 'stall fallback APK sha mismatch'
python3 - "$stall_public_log" "$stall_log" "$stall_name" <<'PY'
import re
import sys
public_log, internal_log, name = sys.argv[1], sys.argv[2], sys.argv[3]
prefix = "download/android/" + name


def offsets(path):
    result = []
    for line in open(path, encoding="utf-8"):
        rel, _, requested = line.rstrip("\n").partition("\t")
        if rel != prefix or requested == "bytes=0-0":
            continue
        match = re.match(r"bytes=(\d+)-", requested)
        result.append(int(match.group(1)) if match else 0)
    return result


public = offsets(public_log)
internal = offsets(internal_log)
assert len(public) >= 2, public
assert any(offset > 0 for offset in public), public
assert internal and all(offset == 0 for offset in internal), internal
print(f"public stall offsets: public={public} internal={internal}")
PY

custom_src="$apk_fixtures/custom-budget-src"
custom_public="$apk_fixtures/custom-budget-public"
custom_live="$apk_fixtures/custom-budget-live"
custom_name=wotbtools-android-v9.2.2.apk
mkdir -p "$custom_src/download/android" "$custom_public/download/android" "$custom_live/android-release"
make_small_apk "$custom_src/download/android/$custom_name" a
cp "$custom_src/download/android/$custom_name" "$custom_public/download/android/$custom_name"
custom_sha="$(sha_of "$custom_src/download/android/$custom_name")"
write_manifest "$custom_src" "$custom_name" "$custom_sha"
custom_port="$(free_port)"
custom_public_port="$(free_port)"
custom_log="$apk_fixtures/custom-budget-internal.log"
custom_public_log="$apk_fixtures/custom-budget-public.log"
start_fixture "$custom_src" "$custom_log" "$custom_port" || fail 'custom budget internal fixture did not start'
start_fixture "$custom_public" "$custom_public_log" "$custom_public_port" "STALL=download/android/$custom_name" \
  || fail 'custom budget public fixture did not start'
PUBLIC_FIXTURE_PORT="$custom_public_port" PATH="$public_bin:$PATH" \
  K7C_RUNTIME_SOURCE_BASE="http://127.0.0.1:$custom_port" \
  K7C_RUNTIME_ROOT="$custom_live" \
  K7C_APK_MAX_TIME_SEC=1 K7C_APK_TOTAL_BUDGET_SEC=2 K7C_APK_RETRIES=3 \
  K7C_APK_RETRY_DELAY_SEC=0 K7C_CONNECT_TIMEOUT_SEC=2 \
  bash "$sync" > "$apk_fixtures/custom-budget-sync.log" 2>&1 \
  || { cat "$apk_fixtures/custom-budget-sync.log" >&2; fail 'custom budget fallback sync failed'; }
grep -Fq 'K7C_RUNTIME_CONTENT_READY=PASS' "$apk_fixtures/custom-budget-sync.log" || fail 'custom budget sync did not finish'
grep -Fq 'capping public APK budget' "$apk_fixtures/custom-budget-sync.log" || fail 'public APK budget was not capped to the internal reserve'
grep -Fq 'APK budget exhausted' "$apk_fixtures/custom-budget-sync.log" || fail 'public APK budget exhaustion was not recorded'
[ "$(sha_of "$custom_live/android-release/$custom_name")" = "$custom_sha" ] || fail 'custom budget fallback APK sha mismatch'
python3 - "$custom_public_log" "$custom_log" "$custom_name" <<'PY'
import re
import sys
public_log, internal_log, name = sys.argv[1], sys.argv[2], sys.argv[3]
prefix = "download/android/" + name


def offsets(path):
    result = []
    for line in open(path, encoding="utf-8"):
        rel, _, requested = line.rstrip(chr(10)).partition(chr(9))
        if rel != prefix or requested == "bytes=0-0":
            continue
        match = re.match(r"bytes=([0-9]+)-", requested)
        result.append(int(match.group(1)) if match else 0)
    return result


public = offsets(public_log)
internal = offsets(internal_log)
assert public, public
assert internal and all(offset == 0 for offset in internal), internal
print(f"custom budget offsets: public={public} internal={internal}")
PY

invalid_live="$apk_fixtures/invalid-budget-live"
mkdir -p "$invalid_live/android-release"
if K7C_RUNTIME_ROOT="$invalid_live" K7C_APK_MAX_TIME_SEC=600 K7C_APK_TOTAL_BUDGET_SEC=300 \
  bash "$sync" > "$apk_fixtures/invalid-budget-sync.log" 2>&1; then
  fail 'invalid APK budget configuration was accepted'
fi
grep -Fq 'must exceed internal reserve' "$apk_fixtures/invalid-budget-sync.log" || fail 'invalid budget configuration was not explained'
grep -Fq 'K7C_RUNTIME_CONTENT_READY=PASS' "$apk_fixtures/invalid-budget-sync.log" && fail 'invalid budget configuration reported PASS'

for budget in 08 0600; do
  zero_live="$apk_fixtures/leading-zero-$budget-live"
  zero_log="$apk_fixtures/leading-zero-$budget.log"
  mkdir -p "$zero_live/android-release"
  if K7C_RUNTIME_ROOT="$zero_live" K7C_APK_MAX_TIME_SEC=1 K7C_APK_TOTAL_BUDGET_SEC="$budget" \
    bash "$sync" > "$zero_log" 2>&1; then
    fail "leading-zero budget $budget was accepted"
  fi
  grep -Fq 'without leading zeros' "$zero_log" || fail "leading-zero budget $budget was not rejected as a format error"
  grep -Fq 'cannot fetch Android version.json' "$zero_log" && fail "leading-zero budget $budget failed after network I/O"
done

wrong_src="$apk_fixtures/wrong-src"
wrong_public="$apk_fixtures/wrong-public"
wrong_live="$apk_fixtures/wrong-live"
wrong_name=wotbtools-android-v9.3.0.apk
mkdir -p "$wrong_src/download/android" "$wrong_public/download/android" "$wrong_live/android-release"
make_apk "$wrong_src/download/android/$wrong_name" a
make_apk "$wrong_public/download/android/$wrong_name" b
wrong_sha="$(sha_of "$wrong_src/download/android/$wrong_name")"
write_manifest "$wrong_src" "$wrong_name" "$wrong_sha"
wrong_port="$(free_port)"
bad_public_port="$(free_port)"
wrong_log="$apk_fixtures/wrong-internal.log"
bad_public_log="$apk_fixtures/wrong-public.log"
start_fixture "$wrong_src" "$wrong_log" "$wrong_port" || fail 'wrong internal fixture did not start'
start_fixture "$wrong_public" "$bad_public_log" "$bad_public_port" || fail 'wrong public fixture did not start'
PUBLIC_FIXTURE_PORT="$bad_public_port" PATH="$public_bin:$PATH" \
  K7C_RUNTIME_SOURCE_BASE="http://127.0.0.1:$wrong_port" \
  K7C_RUNTIME_ROOT="$wrong_live" \
  K7C_APK_MAX_TIME_SEC=20 K7C_APK_TOTAL_BUDGET_SEC=60 K7C_APK_RETRIES=2 \
  K7C_APK_RETRY_DELAY_SEC=0 K7C_CONNECT_TIMEOUT_SEC=2 \
  bash "$sync" > "$apk_fixtures/wrong-sync.log" 2>&1 \
  || { cat "$apk_fixtures/wrong-sync.log" >&2; fail 'checksum fallback sync failed'; }
grep -Fq "sha256 mismatch from https://wotbtools.com/download/android/$wrong_name" "$apk_fixtures/wrong-sync.log" \
  || fail 'public checksum mismatch was not recorded'
[ "$(sha_of "$wrong_live/android-release/$wrong_name")" = "$wrong_sha" ] || fail 'checksum fallback APK sha mismatch'
python3 - "$bad_public_log" "$wrong_log" "$wrong_name" <<'PY'
import re
import sys
public_log, internal_log, name = sys.argv[1], sys.argv[2], sys.argv[3]
prefix = "download/android/" + name


def offsets(path):
    result = []
    for line in open(path, encoding="utf-8"):
        rel, _, requested = line.rstrip("\n").partition("\t")
        if rel != prefix or requested == "bytes=0-0":
            continue
        match = re.match(r"bytes=(\d+)-", requested)
        result.append(int(match.group(1)) if match else 0)
    return result


public = offsets(public_log)
internal = offsets(internal_log)
assert len(public) == 1, public
assert internal and all(offset == 0 for offset in internal), internal
print(f"checksum fallback offsets: public={public} internal={internal}")
PY

mismatch_src="$apk_fixtures/mismatch-src"
mismatch_live="$apk_fixtures/mismatch-live"
mismatch_name=wotbtools-android-v9.4.0.apk
mkdir -p "$mismatch_src/download/android" "$mismatch_live/android-release"
make_apk "$mismatch_src/download/android/$mismatch_name" b
make_apk "$mismatch_src/download/android/expected.apk" a
mismatch_sha="$(sha_of "$mismatch_src/download/android/expected.apk")"
write_manifest "$mismatch_src" "$mismatch_name" "$mismatch_sha"
printf 'keep-me\n' > "$mismatch_live/android-release/keep.txt"
printf '{"old":true}\n' > "$mismatch_live/android-release/version.json"
mismatch_port="$(free_port)"
start_fixture "$mismatch_src" "$apk_fixtures/mismatch.log" "$mismatch_port" \
  || fail 'mismatch fixture did not start'
if PATH="$work/sync-bin:$PATH" \
  K7C_RUNTIME_SOURCE_BASE="http://127.0.0.1:$mismatch_port" \
  K7C_RUNTIME_ROOT="$mismatch_live" \
  K7C_APK_MAX_TIME_SEC=20 K7C_APK_TOTAL_BUDGET_SEC=30 K7C_APK_RETRIES=1 \
  K7C_APK_RETRY_DELAY_SEC=0 K7C_CONNECT_TIMEOUT_SEC=2 \
  bash "$sync" > "$apk_fixtures/mismatch-sync.log" 2>&1; then
  fail 'checksum-invalid sole source was installed'
fi
grep -Fq 'sha256 mismatch' "$apk_fixtures/mismatch-sync.log" || fail 'sole-source mismatch was not recorded'
grep -Fq 'K7C_RUNTIME_CONTENT_READY=PASS' "$apk_fixtures/mismatch-sync.log" && fail 'failed sync reported PASS'
[ "$(cat "$mismatch_live/android-release/keep.txt")" = 'keep-me' ] || fail 'failed sync mutated existing runtime tree'
[ "$(cat "$mismatch_live/android-release/version.json")" = '{"old":true}' ] || fail 'failed sync replaced existing manifest'
[ -z "$(find "$apk_fixtures" -maxdepth 1 -name 'mismatch-live.incoming.*' -print -quit)" ] || fail 'failed sync left an incoming stage'

missing_src="$apk_fixtures/missing-src"
missing_live="$apk_fixtures/missing-live"
missing_name=wotbtools-android-v9.5.0.apk
mkdir -p "$missing_src/download/android" "$missing_live/android-release"
make_apk "$missing_src/download/android/$missing_name" a
write_manifest "$missing_src" "$missing_name" ""
printf 'keep-me\n' > "$missing_live/android-release/keep.txt"
missing_port="$(free_port)"
missing_log="$apk_fixtures/missing.log"
start_fixture "$missing_src" "$missing_log" "$missing_port" || fail 'missing-sha fixture did not start'
if PATH="$work/sync-bin:$PATH" \
  K7C_RUNTIME_SOURCE_BASE="http://127.0.0.1:$missing_port" \
  K7C_RUNTIME_ROOT="$missing_live" \
  K7C_APK_MAX_TIME_SEC=20 K7C_APK_TOTAL_BUDGET_SEC=30 K7C_APK_RETRIES=1 \
  K7C_APK_RETRY_DELAY_SEC=0 K7C_CONNECT_TIMEOUT_SEC=2 \
  bash "$sync" > "$apk_fixtures/missing-sync.log" 2>&1; then
  fail 'manifest without sha256 was accepted'
fi
grep -Fq 'no sha256' "$apk_fixtures/missing-sync.log" || fail 'missing sha256 was not reported'
if grep -Fq "download/android/$missing_name" "$missing_log"; then
  fail 'APK was requested before sha256 validation'
fi
[ "$(cat "$missing_live/android-release/keep.txt")" = 'keep-me' ] || fail 'missing-sha sync mutated existing runtime tree'


echo "K7C runtime content contract: PASS"
