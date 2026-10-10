#!/usr/bin/env bash
# K7C read-only frontend cutover preflight.
set -Eeuo pipefail

readonly TX_RUNTIME_ROOT="${TX_RUNTIME_ROOT:-/opt/wotb-tx}"
readonly TX1_FRONTEND="${TX1_FRONTEND:-http://10.20.0.1:8081}"
readonly TX2_FRONTEND="${TX2_FRONTEND:-http://10.20.0.3:8081}"
readonly CONNECT_TIMEOUT="${K7C_CONNECT_TIMEOUT_SEC:-3}"
readonly MAX_TIME="${K7C_MAX_TIME_SEC:-120}"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

fail(){ echo "K7C preflight: FAIL: $*" >&2; exit 1; }
for cmd in curl docker sha256sum cmp python3; do command -v "$cmd" >/dev/null || fail "required command not found: $cmd"; done
curl_common=(--connect-timeout "$CONNECT_TIMEOUT" --max-time "$MAX_TIME")

http_status(){ local url="$1" status; status="$(curl -sS "${curl_common[@]}" -o /dev/null -w '%{http_code}' "$url" || true)"; [[ "$status" =~ ^[0-9]{3}$ ]] || fail "no HTTP status from $url"; printf '%s' "$status"; }
fetch_file(){ curl -fsS "${curl_common[@]}" "$1" -o "$2" || fail "unable to fetch $1"; }
compare_url_bytes(){
  local path="$1" label="$2" left="$tmp/tx1-${2//[^A-Za-z0-9_.-]/_}" right="$tmp/tx2-${2//[^A-Za-z0-9_.-]/_}"
  fetch_file "$TX1_FRONTEND$path" "$left"; fetch_file "$TX2_FRONTEND$path" "$right"
  cmp -s "$left" "$right" || fail "$label differs between TX1 and TX2 (tx1=$(sha256sum "$left"|awk '{print $1}'), tx2=$(sha256sum "$right"|awk '{print $1}'))"
  echo "K7C preflight: PASS: $label byte parity"
}
compare_runtime_file(){
  local local_file="$1" remote_path="$2" label="$3" out="$tmp/runtime-${3//[^A-Za-z0-9_.-]/_}"
  [ -f "$local_file" ] || fail "$label source missing or not a regular file: $local_file"
  fetch_file "$TX2_FRONTEND$remote_path" "$out"
  cmp -s "$local_file" "$out" || fail "$label differs from authoritative TX1 runtime content (tx1=$(sha256sum "$local_file"|awk '{print $1}'), tx2=$(sha256sum "$out"|awk '{print $1}'))"
  echo "K7C preflight: PASS: $label runtime-content parity"
}

echo "=== K7C frontend runtime ==="
[ "$(http_status "$TX1_FRONTEND/")" = 200 ] || fail "TX1 frontend root is not HTTP 200"
[ "$(http_status "$TX2_FRONTEND/")" = 200 ] || fail "TX2 frontend root is not HTTP 200"
[ "$(http_status "$TX2_FRONTEND/k7c-spa-probe")" = 200 ] || fail "TX2 SPA fallback is not HTTP 200"
[ "$(http_status "$TX2_FRONTEND/api/health")" = 200 ] || fail "TX2 -> Business API health path is not HTTP 200"
compare_url_bytes "/" "index"
compare_url_bytes "/version.json" "version.json"

echo
echo "=== K7C runtime content ==="
compare_runtime_file "$TX_RUNTIME_ROOT/android-release/version.json" "/download/android/version.json" "android-release/version.json"
apk_path="$(python3 - "$TX_RUNTIME_ROOT/android-release/version.json" <<'PY'
import json,sys,urllib.parse
x=json.load(open(sys.argv[1])); u=x.get('apkUrl') or x.get('url') or ''
p=urllib.parse.urlparse(u).path if '://' in u else u
prefix='/download/android/'
if not p.startswith(prefix): raise SystemExit(f'unsafe or missing apkUrl: {u!r}')
n=p[len(prefix):]
if not n or '/' in n or not n.endswith('.apk'): raise SystemExit(f'unsafe apk name: {n!r}')
print(prefix+n)
PY
)"
apk_name="${apk_path##*/}"
compare_runtime_file "$TX_RUNTIME_ROOT/android-release/$apk_name" "$apk_path" "android-release/$apk_name"

echo
echo "=== K7C ingress placement ==="
caddy_id="$(docker ps --filter label=com.docker.compose.project=deploy --filter label=com.docker.compose.service=caddy --format '{{.ID}}' | head -n1)"
[ -n "$caddy_id" ] || fail "running TX1 Caddy container not found"
caddy_frontend_upstream="$(docker inspect "$caddy_id" --format '{{range .Config.Env}}{{println .}}{{end}}' | sed -n 's/^CADDY_FRONTEND_UPSTREAM=//p' | tail -n1)"
case "$caddy_frontend_upstream" in
  wotb-frontend:80|10.20.0.1:8081) echo "K7C preflight: PASS: Caddy still targets TX1 frontend ($caddy_frontend_upstream)" ;;
  10.20.0.3:8081) fail "Caddy already targets TX2; this preflight must complete before cutover" ;;
  *) fail "unexpected active Caddy frontend upstream: ${caddy_frontend_upstream:-<unset>}" ;;
esac

echo
echo "K7C_FRONTEND_CUTOVER_PREFLIGHT=PASS"
