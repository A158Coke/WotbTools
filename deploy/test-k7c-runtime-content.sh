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
grep -Fq 'sponsor-config.json' "$sync"
grep -Fq 'apkUrl' "$sync"
! grep -Eq 'rsync|scp|ssh' "$sync"

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

grep -Fq '/opt/wotb-tx2/runtime-content/sponsor-config.json:/usr/share/nginx/html/sponsor-config.json:ro' "$compose"
grep -Fq '/opt/wotb-tx2/runtime-content/sponsor:/usr/share/nginx/html/sponsor-assets:ro' "$compose"
grep -Fq '/opt/wotb-tx2/runtime-content/android-release:/usr/share/nginx/html/download/android:ro' "$compose"

# ============================ 行为（真实执行） ============================

for cmd in curl flock python3 sha256sum; do command -v "$cmd" >/dev/null || fail "missing command: $cmd"; done
sudo -n true 2>/dev/null || fail "passwordless sudo is required (the runtime sync mutates its root through sudo)"

work="$(mktemp -d)"
server_pid=''
cleanup(){ [ -z "$server_pid" ] || kill "$server_pid" 2>/dev/null || true; rm -rf "$work"; }
trap cleanup EXIT

# --- 1) sync 脚本 E2E：整树替换必须带走未发布版本的证据（原故障回归），历史 APK 仍不带走 ---
source_root="$work/source"; live_root="$work/runtime-content"
mkdir -p "$source_root/download/android" "$live_root/android-release"
printf 'fixture-apk-bytes\n' > "$source_root/download/android/wotbtools-android-v2.1.18.apk"
apk_sha="$(sha256sum "$source_root/download/android/wotbtools-android-v2.1.18.apk" | awk '{print $1}')"
python3 - "$source_root" "$apk_sha" <<'PY'
import json, pathlib, sys
root = pathlib.Path(sys.argv[1])
(root / "sponsor-config.json").write_text("{}", encoding="utf-8")
(root / "download/android/version.json").write_text(json.dumps({
    "schemaVersion": 1, "latestVersionCode": 2001018, "latestVersionName": "2.1.18",
    "apkUrl": "https://wotbtools.com/download/android/wotbtools-android-v2.1.18.apk",
    "sha256": sys.argv[2],
}, indent=2) + "\n", encoding="utf-8")
PY
printf '{"versionName":"2.1.18","versionCode":2001018}\n' > "$live_root/android-release/wotbtools-android-v2.1.18.staging.json"
printf 'stale-apk\n' > "$live_root/android-release/wotbtools-android-v2.1.17.apk"

port="$(python3 -c 'import socket;s=socket.socket();s.bind(("127.0.0.1",0));print(s.getsockname()[1]);s.close()')"
python3 -m http.server --directory "$source_root" --bind 127.0.0.1 "$port" >/dev/null 2>&1 &
server_pid=$!
for _ in $(seq 1 60); do
  curl -fsS "http://127.0.0.1:$port/download/android/version.json" >/dev/null 2>&1 && break
  sleep 0.1
done

K7C_RUNTIME_SOURCE_BASE="http://127.0.0.1:$port" K7C_RUNTIME_ROOT="$live_root" \
  bash "$sync" > "$work/sync.log" 2>&1 \
  || { cat "$work/sync.log" >&2; fail "the runtime sync must succeed against a valid source"; }
grep -Fq 'K7C_RUNTIME_CONTENT_READY=PASS' "$work/sync.log" \
  || { cat "$work/sync.log" >&2; fail "the runtime sync must report PASS"; }

[ -f "$live_root/android-release/wotbtools-android-v2.1.18.staging.json" ] \
  || fail "the tree rebuild must carry the unpublished staging evidence forward (2026-10-09 regression)"
[ -f "$live_root/android-release/version.json" ] \
  || fail "the tree rebuild must refresh version.json from the authoritative source"
cmp -s "$live_root/android-release/wotbtools-android-v2.1.18.apk" "$source_root/download/android/wotbtools-android-v2.1.18.apk" \
  || fail "the tree rebuild must fetch the APK referenced by the manifest, byte for byte"
[ ! -e "$live_root/android-release/wotbtools-android-v2.1.17.apk" ] \
  || fail "historical APKs must not be carried into the rebuilt tree"

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

echo "K7C runtime content contract: PASS"
