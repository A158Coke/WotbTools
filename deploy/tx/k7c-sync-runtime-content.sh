#!/usr/bin/env bash
# Populate TX2 frontend runtime content from the currently authoritative TX1 frontend.
# Run on TX2 before redeploying the shadow stack. This copies only the current public
# production surface: Android version.json + the APK referenced by that manifest.
# Historical APKs are not copied. (Sponsor QR content is not host content anymore — it is
# published to the object-storage asset plane, see docs/operations/agent-asset-origin.md.)
#
# `*.staging.json` 和内容寻址的增量补丁是例外：android-release 的 stage 会把「已 stage、未发布」版本的发布身份
# 装进这棵树，publish 会分别核验两台源站和公开 URL；wotbtools.com 由 Caddy 在 TX1/TX2 之间负载，
# 两台中缺一台就可能让 publish 拿到 404 而 fail closed。因此整树替换必须保留证据和增量补丁。
#
# **调用方必须已持有宿主部署锁**（Frontend Replica 在 /opt/wotb-tx2/.deploy.lock 下执行本脚本；
# 人工执行必须自备同一把锁：`WOTB_TX_DEPLOY_LOCK_FILE=/opt/wotb-tx2/.deploy.lock \
# bash deploy/tx/with-deploy-lock.sh bash k7c-sync-runtime-content.sh`）。stage 侧的证据安装器
# （deploy/tx/install-staging-evidence.sh）在同一把锁下原子落位，锁让「安装」与「扫描 → 换树」
# 互斥；只把复制点放在 swap 前一刻并不足够——「扫描结束后、换树前」落地的写入仍会随旧树进
# .previous（2026-10-09 评审 P1）。见 docs/android/release-process.md §证据的存续。
set -Eeuo pipefail

readonly SOURCE_BASE="${K7C_RUNTIME_SOURCE_BASE:-http://10.20.0.1:8081}"
readonly RUNTIME_ROOT="${K7C_RUNTIME_ROOT:-/opt/wotb-tx2/runtime-content}"
readonly CONNECT_TIMEOUT="${K7C_CONNECT_TIMEOUT_SEC:-3}"
readonly MAX_TIME="${K7C_MAX_TIME_SEC:-120}"
# 当前 APK 已达 210MB 量级；旧的 120s 单轮上限会在 ~53MB 处切断，且每轮从零重下
# （2026-11-23 Frontend Replica #361/#362）。APK 单独使用更长的单轮上限和整个 APK
# 阶段的总预算；预算同时覆盖两个源的 Range 探测、续传、重试与校验。version.json 等
# 小文件仍用 MAX_TIME。最坏情况 4×120s（小文件重试）+ 20min（APK 总预算）≈ 28min，
# 仍低于 Frontend Replica 的 35min job timeout。
readonly APK_MAX_TIME="${K7C_APK_MAX_TIME_SEC:-600}"
readonly APK_TOTAL_BUDGET="${K7C_APK_TOTAL_BUDGET_SEC:-1200}"
# 内网回退至少保留一个 APK 单次下载窗口，默认与单次上限相同。公网只能使用
# “总预算 - 内网预留”，因此即使调用方缩小总预算，公网也不会吃光 TX1 的时间。
readonly APK_INTERNAL_RESERVE="${K7C_APK_INTERNAL_RESERVE_SEC:-$APK_MAX_TIME}"
# 公网源单独封顶：公开链接探测成功但传输卡死时，不能让第一个源吃掉全部 APK
# 预算。默认 600s；实际公网 deadline 还会被“总预算 - 内网预留”截断（见下方）。
# TX1 实测约 53MB/120s，210MB 约 480s，默认 600s 足够一次完整内网下载。
readonly APK_PUBLIC_BUDGET="${K7C_APK_PUBLIC_BUDGET_SEC:-600}"
readonly APK_RETRIES="${K7C_APK_RETRIES:-3}"
readonly APK_RETRY_DELAY="${K7C_APK_RETRY_DELAY_SEC:-2}"
APK_DEADLINE=0

fail(){ echo "K7C runtime sync: FAIL: $*" >&2; exit 1; }

# 预算必须是正整数；总预算必须大于内网预留，否则内网回退没有可执行窗口。
validate_positive_seconds(){
  local name="$1" value="$2"
  [[ "$value" =~ ^[0-9]+$ ]] || fail "invalid $name: $value (expected integer seconds)"
  [ "$value" -gt 0 ] || fail "invalid $name: $value (must be greater than 0)"
}
validate_positive_seconds K7C_APK_MAX_TIME_SEC "$APK_MAX_TIME"
validate_positive_seconds K7C_APK_TOTAL_BUDGET_SEC "$APK_TOTAL_BUDGET"
validate_positive_seconds K7C_APK_PUBLIC_BUDGET_SEC "$APK_PUBLIC_BUDGET"
validate_positive_seconds K7C_APK_INTERNAL_RESERVE_SEC "$APK_INTERNAL_RESERVE"
[ "$APK_TOTAL_BUDGET" -gt "$APK_INTERNAL_RESERVE" ] \
  || fail "K7C APK total budget (${APK_TOTAL_BUDGET}s) must exceed internal reserve (${APK_INTERNAL_RESERVE}s)"

for cmd in curl python3 install mktemp sha256sum; do command -v "$cmd" >/dev/null || fail "missing command: $cmd"; done

stage="$(mktemp -d "${RUNTIME_ROOT}.incoming.XXXXXX")"
trap 'rm -rf "$stage"' EXIT
mkdir -p "$stage/android-release"

# 小文件容错：跟随 302 + 瞬态失败重试（TX1↔TX2 隧道存在 ~10% 丢包窗口）。
# 只用于 version.json 等小文件；APK 走下方可续传的 apk_fetch，避免每轮从头下载。
fetch(){
  local url="$1"
  case "$url" in http://*|https://*) ;; *) url="$SOURCE_BASE$url";; esac
  curl -fsSL --retry 3 --retry-delay 2 --retry-all-errors \
    --connect-timeout "$CONNECT_TIMEOUT" --max-time "$MAX_TIME" "$url" -o "$2"
}

full_url(){
  case "$1" in
    http://*|https://*) printf '%s' "$1" ;;
    *) printf '%s%s' "$SOURCE_BASE" "$1" ;;
  esac
}

# 续传前先确认源真的支持 Range：必须对 bytes=0-0 返回 206 且 Content-Range 覆盖
# 0-0。只看 curl -C - 的退出码不够——忽略 Range 的 200 会被当成可续传。
source_supports_range(){
  local url="$1" max_time="$2" headers
  headers="$(curl -fsSL --connect-timeout "$CONNECT_TIMEOUT" --max-time "$max_time" \
    -H 'Range: bytes=0-0' -D - -o /dev/null "$url" 2>/dev/null)" || return 1
  headers="${headers,,}"
  [[ "$headers" =~ http/[0-9.]+[[:space:]]206([[:space:]]|$) ]] || return 1
  [[ "$headers" =~ content-range:[[:space:]]*bytes[[:space:]]+0-0/[0-9]+ ]] || return 1
}

# 单个 APK 源的下载循环。source_deadline 是本源的截止时间：公网源由调用方传入
# 更早的 cap，确保内网回退仍有预算。每次进入都先清空目标文件：调用方只有在本源
# 校验失败后才会换源，绝不能让上一源的半截字节被 -C - 当成新源的续传起点。
apk_fetch(){
  local url dest source_deadline mode attempt rc remaining max_time offset delay
  url="$(full_url "$1")"
  dest="$2"
  source_deadline="$3"
  rm -f -- "$dest"
  : > "$dest"

  remaining=$((source_deadline - SECONDS))
  [ "$remaining" -gt 0 ] || { echo "K7C runtime sync: APK budget exhausted before $url" >&2; return 1; }
  max_time="$MAX_TIME"
  [ "$max_time" -le "$remaining" ] || max_time="$remaining"
  if source_supports_range "$url" "$max_time"; then
    mode=range
  else
    mode=full
  fi

  attempt=0
  while :; do
    attempt=$((attempt + 1))
    remaining=$((source_deadline - SECONDS))
    [ "$remaining" -gt 0 ] || { echo "K7C runtime sync: APK budget exhausted: $url" >&2; return 1; }
    max_time="$APK_MAX_TIME"
    [ "$max_time" -le "$remaining" ] || max_time="$remaining"

    if [ "$mode" = range ]; then
      offset="$(stat -c '%s' "$dest")"
      echo "K7C runtime sync: APK resume $url attempt=$attempt offset=$offset timeout=${max_time}s" >&2
      if curl -fsSL --connect-timeout "$CONNECT_TIMEOUT" --max-time "$max_time" \
        -C - "$url" -o "$dest"; then
        return 0
      else
        rc=$?
      fi
      if [ "$rc" -eq 33 ]; then
        echo "K7C runtime sync: source rejected resume, restarting from zero: $url" >&2
        rm -f -- "$dest"
        : > "$dest"
      fi
    else
      echo "K7C runtime sync: APK download $url attempt=$attempt (range unsupported, restart) timeout=${max_time}s" >&2
      if curl -fsSL --connect-timeout "$CONNECT_TIMEOUT" --max-time "$max_time" \
        "$url" -o "$dest"; then
        return 0
      fi
    fi

    [ "$attempt" -le "$APK_RETRIES" ] || return 1
    # 重试等待也受本源 deadline 约束，避免公网源在 cap 之外多占内网预算。
    remaining=$((source_deadline - SECONDS))
    [ "$remaining" -gt 0 ] || continue
    delay="$APK_RETRY_DELAY"
    [ "$delay" -le "$remaining" ] || delay="$remaining"
    sleep "$delay"
  done
}

fetch_apk_verified(){
  local url="$1" dest="$2" source_deadline="$3" actual
  apk_fetch "$url" "$dest" "$source_deadline" || { rm -f -- "$dest"; return 1; }
  actual="$(sha256sum "$dest" | awk '{print $1}')"
  [ "$actual" = "$expected_sha" ] || {
    echo "K7C runtime sync: sha256 mismatch from $url (got $actual, want $expected_sha)" >&2
    rm -f -- "$dest"
    return 1
  }
}

fetch /download/android/version.json "$stage/android-release/version.json" || fail "cannot fetch Android version.json"
apk_loc="$(python3 - "$stage/android-release/version.json" <<'PY'
import json, sys, urllib.parse
x=json.load(open(sys.argv[1]))
u=x.get('apkUrl') or x.get('url') or ''
p=urllib.parse.urlparse(u).path if '://' in u else u
prefix='/download/android/'
if not p.startswith(prefix): raise SystemExit(f'unsafe or missing apkUrl: {u!r}')
name=p[len(prefix):]
if not name or '/' in name or not name.endswith('.apk'): raise SystemExit(f'unsafe apk name: {name!r}')
host=(urllib.parse.urlparse(u).hostname or '') if '://' in u else ''
if '://' in u and host != 'wotbtools.com': raise SystemExit(f'untrusted apkUrl host: {u!r}')
print(u + '\t' + prefix + name)
PY
)"
apk_url="${apk_loc%%$'\t'*}"
apk_path="${apk_loc##*$'\t'}"
apk_name="${apk_path##*/}"
# APK 大文件（~210MB）走公网域名拉取：Caddy 对 .apk 302 → 清华云盘直链（APK 下载
# 卸载，绕开 TX1 公网 5Mbps 与 TX1↔TX2 隧道丢包窗口）；云盘/网关不可用时回退内网
# SOURCE_BASE（隧道直拉，慢但可用）。两条路径同等受下方 sha256 校验约束。
# 预期 SHA 先行解析：每个候选源的成功条件 = **下载 + SHA 验证**（评审 P2——
# 仅凭 curl 退出码回退时，云盘返回 200 的损坏/非 APK 副本会让内网 origin 永不被
# 尝试，最终死于后置校验，即使 authoritative 源完整可用）。SHA256 是安装前提：
# publish 始终写入 version.json，缺失或不合法即 fail closed，绝不安装未校验 APK。
expected_sha="$(python3 - "$stage/android-release/version.json" <<'PY'
import json,sys
m=json.load(open(sys.argv[1]))
print(m.get('sha256') or m.get('apkSha256') or m.get('apkSha256Hex') or '')
PY
)"
expected_sha="${expected_sha,,}"
[ -n "$expected_sha" ] || fail "Android version.json has no sha256; refusing to install an unverified APK: $apk_name"
[[ "$expected_sha" =~ ^[0-9a-f]{64}$ ]] || fail "invalid sha256 in Android version.json: $expected_sha"
apk_now=$SECONDS
APK_DEADLINE=$((apk_now + APK_TOTAL_BUDGET))
apk_public_cap="$APK_PUBLIC_BUDGET"
apk_public_limit=$((APK_TOTAL_BUDGET - APK_INTERNAL_RESERVE))
if [ "$apk_public_cap" -gt "$apk_public_limit" ]; then
  apk_public_cap="$apk_public_limit"
  echo "K7C runtime sync: capping public APK budget to ${apk_public_cap}s (reserve ${APK_INTERNAL_RESERVE}s for internal source, total ${APK_TOTAL_BUDGET}s)" >&2
fi
apk_public_deadline=$((apk_now + apk_public_cap))
fetch_apk_verified "$apk_url" "$stage/android-release/$apk_name" "$apk_public_deadline" \
  || fetch_apk_verified "$apk_path" "$stage/android-release/$apk_name" "$APK_DEADLINE" \
  || fail "cannot fetch current APK with matching sha256: $apk_name"

python3 - "$stage/android-release/version.json" "$stage/android-release/$apk_name" <<'PY'
import hashlib,json,sys
m=json.load(open(sys.argv[1])); p=sys.argv[2]
expected=m.get('sha256') or m.get('apkSha256') or m.get('apkSha256Hex')
if expected:
    actual=hashlib.sha256(open(p,'rb').read()).hexdigest()
    if actual.lower()!=str(expected).lower(): raise SystemExit(f'APK sha256 mismatch: expected={expected} actual={actual}')
PY

# 未发布版本的 staging evidence 只存在于这棵树里，整树替换前原样带走（见文件头；调用方须已持锁）。
# 无效证据不能被丢弃并误判为不存在：停止换树，保留原始字节以供恢复。
for evidence in "$RUNTIME_ROOT"/android-release/*.staging.json; do
  [ -e "$evidence" ] || [ -L "$evidence" ] || continue
  [ -f "$evidence" ] && [ ! -L "$evidence" ] && [ -r "$evidence" ] || fail "invalid immutable staging evidence file: $evidence"
  python3 -c 'import json,sys; json.load(open(sys.argv[1], encoding="utf-8"))' "$evidence" 2>/dev/null || fail "invalid immutable staging evidence: $evidence"
  cp "$evidence" "$stage/android-release/"
done

# 已 staged 的不可变增量须与 evidence 一同跨换树保留；文件名绑定 SHA，损坏不得进入新树。
for delta in "$RUNTIME_ROOT"/android-release/wotbtools-android-delta-*.vcdiff; do
  [ -e "$delta" ] || [ -L "$delta" ] || continue
  [ -f "$delta" ] && [ ! -L "$delta" ] && [ -r "$delta" ] || fail "invalid immutable delta file: $delta"
  name="${delta##*/}"
  [[ "$name" =~ ^wotbtools-android-delta-[0-9]+-[0-9]+-([0-9a-f]{64})\.vcdiff$ ]] \
    || fail "invalid delta filename: $name"
  expected_delta_sha="${BASH_REMATCH[1]}"
  [ "$(sha256sum "$delta" | awk '{print $1}')" = "$expected_delta_sha" ] \
    || fail "immutable delta sha mismatch: $name"
  cp "$delta" "$stage/android-release/$name"
done

sudo mkdir -p "$(dirname "$RUNTIME_ROOT")"
sudo rm -rf "${RUNTIME_ROOT}.previous"
if [ -e "$RUNTIME_ROOT" ]; then sudo mv "$RUNTIME_ROOT" "${RUNTIME_ROOT}.previous"; fi
sudo mv "$stage" "$RUNTIME_ROOT"
trap - EXIT
sudo find "$RUNTIME_ROOT" -type d -exec chmod 0755 {} +
sudo find "$RUNTIME_ROOT" -type f -exec chmod 0644 {} +

echo "K7C_RUNTIME_CONTENT_READY=PASS"
find "$RUNTIME_ROOT" -type f -printf '%P\n' | sort
