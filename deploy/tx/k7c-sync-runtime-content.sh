#!/usr/bin/env bash
# Populate TX2 frontend runtime content from the currently authoritative TX1 frontend.
# Run on TX2 before redeploying the shadow stack. This copies only the current public
# production surface: Android version.json + the APK referenced by that manifest.
# Historical APKs are not copied. (Sponsor QR content is not host content anymore — it is
# published to the object-storage asset plane, see docs/operations/agent-asset-origin.md.)
#
# `*.staging.json` 是唯一例外：android-release 的 stage 会把「已 stage、未发布」版本的发布身份
# 装进这棵树，而 publish 只按公开 URL 校验它——wotbtools.com 由 Caddy 在 TX1/TX2 之间负载，
# 两台中缺一台就可能让 publish 拿到 404 而 fail closed。因此整树替换必须整份带走它。
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

fail(){ echo "K7C runtime sync: FAIL: $*" >&2; exit 1; }
for cmd in curl python3 install mktemp sha256sum; do command -v "$cmd" >/dev/null || fail "missing command: $cmd"; done

stage="$(mktemp -d "${RUNTIME_ROOT}.incoming.XXXXXX")"
trap 'rm -rf "$stage"' EXIT
mkdir -p "$stage/android-release"

# 大文件容错：跟随 302（APK 云盘直链卸载，见下方 APK 段）+ 瞬态失败重试（TX1↔TX2
# 隧道存在 ~10% 丢包窗口，单次 120s 拉满 15MB APK 会偶发超时——frontend replica
# 部署 2026-10-06 即因此失败）。--retry 对 timeout(28) 亦生效，每轮独立 max-time。
fetch(){
  local url="$1"
  case "$url" in http://*|https://*) ;; *) url="$SOURCE_BASE$url";; esac
  curl -fsSL --retry 3 --retry-delay 2 --retry-all-errors \
    --connect-timeout "$CONNECT_TIMEOUT" --max-time "$MAX_TIME" "$url" -o "$2"
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
# APK 大文件（~15MB）走公网域名拉取：Caddy 对 .apk 302 → 清华云盘直链（APK 下载
# 卸载，绕开 TX1 公网 5Mbps 与 TX1↔TX2 隧道丢包窗口）；云盘/网关不可用时回退内网
# SOURCE_BASE（隧道直拉，慢但可用）。两条路径同等受下方 sha256 校验约束。
# 预期 SHA 先行解析：每个候选源的成功条件 = **下载 + SHA 验证**（评审 P2——
# 仅凭 curl 退出码回退时，云盘返回 200 的损坏/非 APK 副本会让内网 origin 永不被
# 尝试，最终死于后置校验，即使 authoritative 源完整可用）
expected_sha="$(python3 - "$stage/android-release/version.json" <<'PY'
import json,sys
m=json.load(open(sys.argv[1]))
print(m.get('sha256') or m.get('apkSha256') or m.get('apkSha256Hex') or '')
PY
)"
fetch_verified(){
  local url="$1" dest="$2"
  fetch "$url" "$dest" || return 1
  if [ -n "$expected_sha" ]; then
    local actual
    actual="$(sha256sum "$dest" | awk '{print $1}')"
    [ "$actual" = "$expected_sha" ] || { echo "K7C runtime sync: sha256 mismatch from $url (got $actual, want $expected_sha)" >&2; return 1; }
  fi
}
fetch_verified "$apk_url" "$stage/android-release/$apk_name" \
  || fetch_verified "$apk_path" "$stage/android-release/$apk_name" \
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
# 只带走能解析的完整 JSON：锁 + 原子落位已保证「可见即完整」，这条是对历史/外来残留文件的兜底
# ——半截证据比没有更糟，它会让 publish 死在解析上，而不是给出「未 stage」这个已知且可处置的结论。
for evidence in "$RUNTIME_ROOT"/android-release/*.staging.json; do
  [ -e "$evidence" ] || continue
  python3 -c 'import json,sys; json.load(open(sys.argv[1], encoding="utf-8"))' "$evidence" 2>/dev/null || continue
  cp "$evidence" "$stage/android-release/"
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
