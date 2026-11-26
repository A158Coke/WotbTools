#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CFG="$ROOT/deploy/nginx/nginx.conf"
CONTAINER=wotb-nginx-android-test

cleanup() {
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  rm -rf "$HTML_ROOT" >/dev/null 2>&1 || true
}

HTML_ROOT="$(mktemp -d)"
trap cleanup EXIT

docker run --rm --add-host grafana:127.0.0.1 --add-host keycloak:127.0.0.1 --add-host wotb-backend:127.0.0.1 \
  -v "$CFG:/etc/nginx/conf.d/default.conf:ro" --entrypoint nginx nginx:alpine -t

grep -q 'location = /download/android {' "$CFG" \
  || { echo "FAIL: 'location = /download/android' must exist (SPA page route)" >&2; exit 1; }
grep -q 'location = /download/android/ {' "$CFG" \
  || { echo "FAIL: 'location = /download/android/' must exist (trailing-slash SPA page route)" >&2; exit 1; }
grep -q 'location = /download/android/version.json {' "$CFG" \
  || { echo "FAIL: version.json must have its own exact static location" >&2; exit 1; }
grep -q 'location /download/android/ {' "$CFG" \
  || { echo "FAIL: APK static prefix location must exist" >&2; exit 1; }
grep -q 'location = /.well-known/assetlinks.json' "$CFG" \
  || { echo "FAIL: assetlinks exact location must exist in the auth server block" >&2; exit 1; }

mkdir -p "$HTML_ROOT/download/android"
printf '<!doctype html><html><body>SPA-index</body></html>' > "$HTML_ROOT/index.html"
printf '{"latestVersionName":"1.0.0","apkUrl":"/download/android/wotbtools-android-v1.0.0.apk"}\n' \
  > "$HTML_ROOT/download/android/version.json"
head -c 2048 /dev/urandom > "$HTML_ROOT/download/android/wotbtools-android-v1.0.0.apk"
chmod -R a+rX "$HTML_ROOT"

docker run -d --name "$CONTAINER" \
  --add-host grafana:127.0.0.1 --add-host keycloak:127.0.0.1 --add-host wotb-backend:127.0.0.1 \
  -v "$CFG:/etc/nginx/conf.d/default.conf:ro" \
  -v "$HTML_ROOT:/usr/share/nginx/html:ro" \
  -p "127.0.0.1:18081:80" nginx:alpine >/dev/null

for i in $(seq 1 30); do
  if docker exec "$CONTAINER" nginx -t >/dev/null 2>&1 \
     && curl -s -o /dev/null -H 'Host: wotbtools.com' "http://127.0.0.1:18081/download/android"; then
    break
  fi
  sleep 1
done

code() { curl -s -o /dev/null -w '%{http_code}' -H 'Host: wotbtools.com' -H "X-Forwarded-For: $1" "http://127.0.0.1:18081/$2"; }
content() { curl -s -H 'Host: wotbtools.com' "http://127.0.0.1:18081/$1"; }
content_auth() { curl -s -H 'Host: auth.wotbtools.com' "http://127.0.0.1:18081/$1"; }

mkdir -p "$HTML_ROOT/.well-known"
printf '[{"relation":["delegate_permission/common.handle_all_urls"],"target":{"namespace":"android_app","package_name":"com.wotbtools.app","sha256_cert_fingerprints":["BD:1B:66:9D:79:93:51:A4:E5:96:BC:11:6B:8F:AE:08:43:29:AC:74:7A:F7:8D:EF:61:97:48:FC:B4:28:06:CE"]}}]\n' \
  > "$HTML_ROOT/.well-known/assetlinks.json"

[[ "$(code 9.9.9.1 download/android)" == "200" ]] \
  || { echo "FAIL: /download/android must return 200 (SPA)" >&2; exit 1; }
[[ "$(content "download/android")" == *"SPA-index"* ]] \
  || { echo "FAIL: /download/android must render index.html, not a 404 body" >&2; exit 1; }

[[ "$(code 9.9.9.1 download/android/)" == "200" ]] \
  || { echo "FAIL: /download/android/ must return 200 (SPA) and not be captured by static location" >&2; exit 1; }
[[ "$(content "download/android/")" == *"SPA-index"* ]] \
  || { echo "FAIL: /download/android/ must render index.html" >&2; exit 1; }

[[ "$(code 9.9.9.1 download/android/version.json)" == "200" ]] \
  || { echo "FAIL: /download/android/version.json must return a real static manifest (200)" >&2; exit 1; }
[[ "$(content "download/android/version.json")" == *"latestVersionName"* ]] \
  || { echo "FAIL: version.json must be the real manifest, not the SPA index" >&2; exit 1; }
curl -s -D - -o /dev/null -H 'Host: wotbtools.com' "http://127.0.0.1:18081/download/android/version.json" \
  | grep -qi 'cache-control: no-store' \
  || { echo "FAIL: version.json must be no-store" >&2; exit 1; }

[[ "$(code 9.9.9.1 download/android/wotbtools-android-v1.0.0.apk)" == "200" ]] \
  || { echo "FAIL: existing APK must return 200" >&2; exit 1; }
apk_bytes="$(content "download/android/wotbtools-android-v1.0.0.apk" | wc -c)"
[[ "$apk_bytes" == "2048" ]] \
  || { echo "FAIL: APK must be served as the real binary ($apk_bytes != 2048)" >&2; exit 1; }

[[ "$(code 9.9.9.1 download/android/nonexistent.apk)" == "404" ]] \
  || { echo "FAIL: nonexistent APK must return real 404" >&2; exit 1; }
[[ "$(content "download/android/nonexistent.apk")" != *"SPA-index"* ]] \
  || { echo "FAIL: nonexistent APK must not fallback to index.html" >&2; exit 1; }

auth_asset_code="$(curl -s -o /dev/null -w '%{http_code}' -H 'Host: auth.wotbtools.com' "http://127.0.0.1:18081/.well-known/assetlinks.json")"
[[ "$auth_asset_code" == "200" ]] \
  || { echo "FAIL: auth.wotbtools.com/.well-known/assetlinks.json must return 200 (static)" >&2; exit 1; }
[[ "$(content_auth ".well-known/assetlinks.json")" == *"delegate_permission/common.handle_all_urls"* ]] \
  || { echo "FAIL: assetlinks.json must be served as the real JSON, not proxied to keycloak" >&2; exit 1; }
curl -s -D - -o /dev/null -H 'Host: auth.wotbtools.com' "http://127.0.0.1:18081/.well-known/assetlinks.json" \
  | grep -qi 'content-type: application/json' \
  || { echo "FAIL: assetlinks.json must be served as application/json" >&2; exit 1; }

echo "OK: nginx -t passed; /download/android and /download/android/ -> SPA; version.json -> static manifest; APK -> static; nonexistent APK -> 404; auth assetlinks.json -> static application/json"
