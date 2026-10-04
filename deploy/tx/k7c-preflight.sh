#!/usr/bin/env bash
# K7C read-only frontend cutover preflight.
#
# Run on TX1 before moving Caddy from the authoritative TX1 frontend to the
# Komodo-owned TX2 frontend shadow. This script never mutates containers,
# Compose state, runtime content, or Caddy routing.
set -Eeuo pipefail

readonly TX_RUNTIME_ROOT="${TX_RUNTIME_ROOT:-/opt/wotb-tx}"
readonly TX1_FRONTEND="${TX1_FRONTEND:-http://10.20.0.1:8081}"
readonly TX2_FRONTEND="${TX2_FRONTEND:-http://10.20.0.3:8081}"
readonly CONNECT_TIMEOUT="${K7C_CONNECT_TIMEOUT_SEC:-3}"
readonly MAX_TIME="${K7C_MAX_TIME_SEC:-15}"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

fail() {
  echo "K7C preflight: FAIL: $*" >&2
  exit 1
}

for cmd in curl docker find sort sha256sum cmp; do
  command -v "$cmd" >/dev/null 2>&1 || fail "required command not found: $cmd"
done

curl_common=(--connect-timeout "$CONNECT_TIMEOUT" --max-time "$MAX_TIME")

http_status() {
  local url="$1" status
  status="$(curl -sS "${curl_common[@]}" -o /dev/null -w '%{http_code}' "$url" || true)"
  [[ "$status" =~ ^[0-9]{3}$ ]] || fail "no HTTP status from $url"
  printf '%s' "$status"
}

fetch_file() {
  local url="$1" out="$2"
  curl -fsS "${curl_common[@]}" "$url" -o "$out"     || fail "unable to fetch $url"
}

compare_url_bytes() {
  local path="$1" label="$2"
  local left="$tmp/tx1-${label//[^A-Za-z0-9_.-]/_}"
  local right="$tmp/tx2-${label//[^A-Za-z0-9_.-]/_}"
  fetch_file "$TX1_FRONTEND$path" "$left"
  fetch_file "$TX2_FRONTEND$path" "$right"
  cmp -s "$left" "$right"     || fail "$label differs between TX1 and TX2 (tx1=$(sha256sum "$left" | awk '{print $1}'), tx2=$(sha256sum "$right" | awk '{print $1}'))"
  echo "K7C preflight: PASS: $label byte parity"
}

compare_runtime_file() {
  local local_file="$1" remote_path="$2" label="$3"
  local out="$tmp/runtime-${label//[^A-Za-z0-9_.-]/_}"
  if [ -f "$local_file" ]; then
    fetch_file "$TX2_FRONTEND$remote_path" "$out"
    cmp -s "$local_file" "$out"       || fail "$label differs from authoritative TX1 runtime content (local=$(sha256sum "$local_file" | awk '{print $1}'), tx2=$(sha256sum "$out" | awk '{print $1}'))"
    echo "K7C preflight: PASS: $label runtime-content parity"
  elif [ -e "$local_file" ]; then
    fail "$label source must be a regular file: $local_file"
  else
    local status
    status="$(http_status "$TX2_FRONTEND$remote_path")"
    [ "$status" = 404 ]       || fail "$label is absent on TX1 but TX2 returned HTTP $status"
    echo "K7C preflight: PASS: $label absent on both authoritative source and TX2"
  fi
}

compare_tree() {
  local local_dir="$1" remote_prefix="$2" label="$3"
  if [ ! -e "$local_dir" ]; then
    echo "K7C preflight: PASS: $label source directory absent; no authoritative files to compare"
    return
  fi
  [ -d "$local_dir" ] || fail "$label source must be a directory: $local_dir"

  local count=0 file rel encoded
  while IFS= read -r -d '' file; do
    count=$((count + 1))
    rel="${file#"$local_dir"/}"
    # Runtime filenames are deployment-owned and must be safe URL path segments.
    [[ "$rel" != *$'\n'* && "$rel" != *'?'* && "$rel" != *'#'* ]]       || fail "$label contains an unsafe filename for HTTP comparison: $rel"
    encoded="$remote_prefix/$rel"
    compare_runtime_file "$file" "$encoded" "$label/$rel"
  done < <(find "$local_dir" -type f -print0 | sort -z)

  echo "K7C preflight: PASS: $label authoritative file count=$count"
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
compare_runtime_file   "$TX_RUNTIME_ROOT/config/sponsor-config.json"   "/sponsor-config.json"   "sponsor-config.json"
compare_tree   "$TX_RUNTIME_ROOT/config/sponsor"   "/sponsor-assets"   "sponsor-assets"
compare_runtime_file   "$TX_RUNTIME_ROOT/android-release/version.json"   "/download/android/version.json"   "android-release/version.json"
compare_tree   "$TX_RUNTIME_ROOT/android-release"   "/download/android"   "android-release"

echo
echo "=== K7C ingress placement ==="
caddy_id="$(docker ps   --filter label=com.docker.compose.project=deploy   --filter label=com.docker.compose.service=caddy   --format '{{.ID}}' | head -n 1)"
[ -n "$caddy_id" ] || fail "running TX1 Caddy container not found"

caddy_frontend_upstream="$(docker inspect "$caddy_id"   --format '{{range .Config.Env}}{{println .}}{{end}}'   | sed -n 's/^CADDY_FRONTEND_UPSTREAM=//p' | tail -n 1)"
case "$caddy_frontend_upstream" in
  wotb-frontend:80|10.20.0.1:8081)
    echo "K7C preflight: PASS: Caddy still targets TX1 frontend ($caddy_frontend_upstream)"
    ;;
  10.20.0.3:8081)
    fail "Caddy already targets TX2; this preflight must complete before cutover"
    ;;
  *)
    fail "unexpected active Caddy frontend upstream: ${caddy_frontend_upstream:-<unset>}"
    ;;
esac

echo
echo "K7C_FRONTEND_CUTOVER_PREFLIGHT=PASS"
