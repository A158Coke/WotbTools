#!/usr/bin/env bash
# K7C runtime-content 契约 + staging evidence 的存续不变量。
#
# 接线部分锁定输入/输出面、影子栈挂载与顺序；行为部分用**真实脚本跑真实流程**：整树替换后
# 「已 stage、未发布」版本的证据必须还在（2026-10-09 的发布故障：Replica 换树把它删掉，公开
# URL 变成按 origin 掷硬币，publish 404 fail closed），证据安装器必须与宿主部署锁互斥。
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

# ============================ 接线（静态） ============================

grep -Fq 'K7C_RUNTIME_CONTENT_READY=PASS' "$sync"
grep -Fq 'http://10.20.0.1:8081' "$sync"
grep -Fq '/opt/wotb-tx2/runtime-content' "$sync"
grep -Fq 'apkUrl' "$sync"
! grep -Eq 'rsync|scp|ssh' "$sync"
# Sponsor QR 内容已迁到对象存储资产面，不再是 host runtime content：同步脚本里再出现它即失败。
! grep -Fq 'sponsor-config.json' "$sync"

# staging evidence 的例外必须保持窄：树里只延续身份记录，不累积历史 APK（当前 APK 仍按
# version.json 现拉），且复制点必须早于整树替换——晚于 swap 等于没做。
grep -Fq '*.staging.json' "$sync"
! grep -Fq '"$RUNTIME_ROOT"/android-release/*.apk' "$sync"
carry_line="$(grep -nF 'for evidence in "$RUNTIME_ROOT"/android-release/*.staging.json' "$sync" | head -n1 | cut -d: -f1 || true)"
swap_line="$(grep -nF 'sudo mv "$stage" "$RUNTIME_ROOT"' "$sync" | head -n1 | cut -d: -f1 || true)"
if [ -z "$carry_line" ] || [ -z "$swap_line" ] || [ "$carry_line" -ge "$swap_line" ]; then
  fail "staging evidence must be carried over before the runtime tree swap"
fi

# 互斥的 Replica 侧：取 TX2 宿主锁与执行 sync 必须在**同一段远程脚本**里，且锁在前——
# 「安装不会落在扫描与换树之间」的唯一依据就是这个锁覆盖了 scan + swap。
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

# 互斥的另一侧：stage 必须经安装器在宿主锁下落位，而不是直接 scp 进被服务目录。
grep -Fq 'install-staging-evidence.sh' "$release" || fail "the release stage must install evidence through the installer"
grep -Fq -- '--lock /opt/wotb-tx/.deploy.lock' "$release" || fail "the TX install must take the TX host deploy lock"
grep -Fq -- '--lock /opt/wotb-tx2/.deploy.lock' "$release" || fail "the TX2 install must take the TX2 host deploy lock"
# 被服务目录只允许接收 publish 的 version.json（既有机制）；staging evidence 直接 scp 进去就是
# 2026-10-09 那个竞态。逐 step 比对 source/target，避免误伤 version.json 的直传。
python3 - "$release" <<'PY'
import re, sys
lines = open(sys.argv[1], encoding="utf-8").read().splitlines()
served = ("/opt/wotb-tx/android-release", "/opt/wotb-tx2/runtime-content/android-release")
cur = {"name": None, "source": None, "target": None}
steps = []
def flush():
    if cur["source"] or cur["target"]:
        steps.append(dict(cur))
for ln in lines:
    m = re.match(r"^      - name:\s*(.*)$", ln)
    if m:
        flush(); cur.update(name=m.group(1).strip() or None, source=None, target=None); continue
    if cur["name"] is None:
        continue
    m = re.match(r"^\s+source:\s*(.*)$", ln)
    if m: cur["source"] = m.group(1).strip(); continue
    m = re.match(r"^\s+target:\s*(.*)$", ln)
    if m: cur["target"] = m.group(1).strip()
flush()
straight = [s for s in steps if s["target"] and any(s["target"].startswith(p) for p in served)]
for s in straight:
    if "version.json" not in (s["source"] or ""):
        raise SystemExit(f"step {s['name']!r} uploads {s['source']!r} straight into the served tree {s['target']!r}")
print(f"served-tree uploads are manifest-only: {len(straight)} step(s)")
PY

grep -Fq '/opt/wotb-tx2/runtime-content/android-release:/usr/share/nginx/html/download/android:ro' "$compose"
# 赞助内容不再由影子栈挂载（资产面对象，见 docs/operations/agent-asset-origin.md）。
! grep -Fiq 'sponsor' "$compose"

# ============================ 行为（真实执行） ============================

for cmd in curl flock python3 sha256sum; do command -v "$cmd" >/dev/null || fail "missing command: $cmd"; done
sudo -n true 2>/dev/null || fail "passwordless sudo is required (the runtime sync mutates its root through sudo)"

work="$(mktemp -d)"
server_pid=''
cleanup(){ [ -z "$server_pid" ] || kill "$server_pid" 2>/dev/null || true; rm -rf "$work"; }
trap cleanup EXIT

# 同步只消费本机 HTTP fixture；禁止测试探测真实公开 APK。
mkdir -p "$work/sync-bin"
export REAL_CURL="$(command -v curl)"
cat > "$work/sync-bin/curl" <<'CURL'
#!/usr/bin/env bash
for arg in "$@"; do [[ "$arg" != https://wotbtools.com/* ]] || exit 22; done
exec "$REAL_CURL" "$@"
CURL
chmod +x "$work/sync-bin/curl"

# --- 1) sync 脚本 E2E：整树替换必须带走未发布版本的证据（原故障回归），历史 APK 仍不带走 ---
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

# --- 2) 安装器：宿主锁下原子落位；锁被占住时不可见、不落位；缺锁/缺目录/非证据文件 fail closed ---
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

# --- 2b) 目录空窗（评审 P2）：Replica 两次 mv 之间服务目录短暂不存在，安装器必须等锁而不是当场退出 ---
gap_lock_dir="$work/lock-gap"; gap_served="$work/served-gap"
mkdir -p "$gap_lock_dir" "$gap_served"; : > "$gap_lock_dir/.deploy.lock"
printf '{"versionName":"2.1.21","versionCode":2001021}\n' > "$incoming/wotbtools-android-v2.1.21.staging.json"
flock "$gap_lock_dir/.deploy.lock" -c 'sleep 6' &
gap_holder=$!
sleep 0.5
mv "$gap_served" "$gap_served.previous"   # 换树第一步：整棵树（含被服务目录）被移走
bash "$installer" --source "$incoming/wotbtools-android-v2.1.21.staging.json" \
  --dest-dir "$gap_served" --lock "$gap_lock_dir/.deploy.lock" > "$work/gap-install.log" 2>&1 &
gap_installer=$!
sleep 1.5
kill -0 "$gap_installer" 2>/dev/null \
  || { cat "$work/gap-install.log" >&2; fail "the installer must wait for the lock even while the served tree is swapped away (directory gap)"; }
mkdir -p "$gap_served"                    # 换树第二步：新树就位
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

# Delta installs are idempotent and cannot overwrite an existing name.
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
# 稀疏文件模拟达到保留上限：新补丁不得落位，既有内容不得删除。
truncate -s 1073741824 "$served/wotbtools-android-delta-4001000-4002000-cap.vcdiff"
printf 'another delta\n' > "$work/new-delta"
new_sha="$(sha256sum "$work/new-delta" | awk '{print $1}')"
new_name="wotbtools-android-delta-4002000-4003000-$new_sha.vcdiff"
cp "$work/new-delta" "$incoming/$new_name"
bash "$installer" --source "$incoming/$new_name" --dest-dir "$served" --lock "$lock_dir/.deploy.lock" >/dev/null 2>&1 && fail "delta storage limit must fail closed"
[ ! -e "$served/$new_name" ] || fail "over-budget delta must not be installed"
[ -f "$served/wotbtools-android-delta-4001000-4002000-cap.vcdiff" ] || fail "storage cap must not delete existing files"

# Exercise origin classification over the real locked reader with a local SSH transport.
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

# Two concurrent installs of the same filename: equal bytes succeed, unequal bytes never clobber.
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


# 安装中的复制允许中断，但公开文件不得出现半截 JSON；失败必须保留输入并清理临时文件。
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
# 中转文件误指向线上文件或其硬链接，不得成功后把线上产物删除。
bash "$installer" --source "$copy_test/served/$name" --dest-dir "$copy_test/served" --lock "$copy_test/lock" >/dev/null 2>&1 && fail 'served source must not be consumed'
ln "$copy_test/served/$name" "$copy_test/incoming/$name"
bash "$installer" --source "$copy_test/incoming/$name" --dest-dir "$copy_test/served" --lock "$copy_test/lock" >/dev/null 2>&1 && fail 'served hard-link alias must not be consumed'
[ -f "$copy_test/served/$name" ] || fail 'scratch alias removed served evidence'
rm "$copy_test/incoming/$name"
# 目标即便是目录，也不可被 ln 当作目标目录写入。
mkdir "$copy_test/served/dir.staging.json"
printf '{}\n' > "$copy_test/incoming/dir.staging.json"
bash "$installer" --source "$copy_test/incoming/dir.staging.json" --dest-dir "$copy_test/served" --lock "$copy_test/lock" >/dev/null 2>&1 && fail 'destination directory must fail closed'
[ -z "$(find "$copy_test/served/dir.staging.json" -mindepth 1 -print -quit)" ] || fail 'invalid directory destination was mutated'
# Linux CI 的 /dev/shm 与默认 /tmp 通常位于不同文件系统；可用时实际跨文件系统安装。
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

echo "K7C runtime content contract: PASS"
