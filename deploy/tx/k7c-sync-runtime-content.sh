#!/usr/bin/env bash
set -Eeuo pipefail

readonly SOURCE_BASE="${K7C_RUNTIME_SOURCE_BASE:-http://10.20.0.1:8081}"
readonly RUNTIME_ROOT="${K7C_RUNTIME_ROOT:-/opt/wotb-tx2/runtime-content}"
readonly CONNECT_TIMEOUT="${K7C_CONNECT_TIMEOUT_SEC:-3}"
readonly MAX_TIME="${K7C_MAX_TIME_SEC:-120}"
readonly APK_MAX_TIME="${K7C_APK_MAX_TIME_SEC:-600}"
readonly APK_TOTAL_BUDGET="${K7C_APK_TOTAL_BUDGET_SEC:-1200}"
readonly APK_INTERNAL_RESERVE="${K7C_APK_INTERNAL_RESERVE_SEC:-$APK_MAX_TIME}"
readonly APK_PUBLIC_BUDGET="${K7C_APK_PUBLIC_BUDGET_SEC:-600}"
readonly APK_RETRIES="${K7C_APK_RETRIES:-3}"
readonly APK_RETRY_DELAY="${K7C_APK_RETRY_DELAY_SEC:-2}"
APK_DEADLINE=0

fail(){ echo "K7C runtime sync: FAIL: $*" >&2; exit 1; }

validate_positive_seconds(){
  local name="$1" value="$2"
  [[ "$value" =~ ^[1-9][0-9]*$ ]] || fail "invalid $name: $value (expected positive decimal seconds without leading zeros)"
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

source_supports_range(){
  local url="$1" max_time="$2" headers
  headers="$(curl -fsSL --connect-timeout "$CONNECT_TIMEOUT" --max-time "$max_time" \
    -H 'Range: bytes=0-0' -D - -o /dev/null "$url" 2>/dev/null)" || return 1
  headers="${headers,,}"
  [[ "$headers" =~ http/[0-9.]+[[:space:]]206([[:space:]]|$) ]] || return 1
  [[ "$headers" =~ content-range:[[:space:]]*bytes[[:space:]]+0-0/[0-9]+ ]] || return 1
}

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

for evidence in "$RUNTIME_ROOT"/android-release/*.staging.json; do
  [ -e "$evidence" ] || [ -L "$evidence" ] || continue
  [ -f "$evidence" ] && [ ! -L "$evidence" ] && [ -r "$evidence" ] || fail "invalid immutable staging evidence file: $evidence"
  python3 -c 'import json,sys; json.load(open(sys.argv[1], encoding="utf-8"))' "$evidence" 2>/dev/null || fail "invalid immutable staging evidence: $evidence"
  cp "$evidence" "$stage/android-release/"
done

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
