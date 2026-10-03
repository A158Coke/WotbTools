#!/usr/bin/env bash
# Validate the staged TX Caddy configuration with the real runtime image before
# the live gateway is touched. The compose service definition is used so the
# validated file is exactly the one Compose will mount.
#
# First it asserts the public site inventory. Caddy is the only owner of public
# ingress, so a missing site or a wrong upstream is a production incident that
# must fail here - before the gateway is reloaded - instead of only showing up as
# a broken route afterwards. This is an independent statement of intent, not a
# restatement of whatever the Caddyfile happens to contain.
set -euo pipefail

INCOMING_DIR="${1:?usage: validate-caddy-config.sh <staged-tx-directory>}"
for required in Caddyfile common.compose.yml caddy.compose.yml; do
  [ -f "$INCOMING_DIR/$required" ] \
    || { echo "ERROR: staged Caddy input is missing: $INCOMING_DIR/$required" >&2; exit 1; }
done
CADDYFILE="$INCOMING_DIR/Caddyfile"

# site_block <host>: the body of the `<host> { ... }` site, honouring nested
# blocks. Matching is literal (`index(...) == 1`), so no regex escaping is needed.
site_block() {
  awk -v host="$1" '
    !inside && index($0, host " {") == 1 { inside = 1 }
    inside {
      depth += gsub(/\{/, "{")
      depth -= gsub(/\}/, "}")
      print
      if (depth <= 0) exit
    }
  ' "$CADDYFILE"
}

assert_upstream() {
  local host="$1" expected="$2" actual scope
  if [ "$host" = wotbtools.com ]; then
    scope="$(handle_block "$host" "")"
  else
    scope="$(site_block "$host")"
  fi
  actual="$(printf '%s\n' "$scope" \
    | sed -n 's/^[[:space:]]*reverse_proxy[[:space:]]\{1,\}\([^[:space:]]*\).*$/\1/p' \
    | head -n1)"
  [ "$actual" = "$expected" ] || {
    echo "ERROR: Caddy site $host must reverse_proxy $expected (found: ${actual:-<none>})." >&2
    exit 1
  }
}

# handle_block <host> <path>: the body of that host's `handle <path> { ... }`
# block, including the opening line and the closing brace of that same block.
# Directives are matched after trimming leading whitespace, so no regex escaping is
# needed for the path; the end is the brace that returns the block below its own
# opening depth.
handle_block() {
  awk -v host="$1" -v path="$2" '
    { trimmed = $0; sub(/^[ \t]+/, "", trimmed) }
    !in_host {
      if (!inside && index($0, host " {") == 1) { in_host = 1; host_depth = 0 }
    }
    !inside && in_host && trimmed == (path == "" ? "handle {" : "handle " path " {") {
      inside = 1
      depth = 1
      print
      next
    }
    {
      if (inside) {
        opens = gsub(/\{/, "{"); closes = gsub(/\}/, "}")
        depth += opens - closes
        print
        if (depth <= 0) exit
        next
      }
      if (in_host) {
        host_depth += gsub(/\{/, "{") - gsub(/\}/, "}")
        if (host_depth <= 0) exit
      }
    }
  ' "$CADDYFILE"
}

# Every public host this gateway owns. Yecao upstreams are always the WireGuard
# address 10.20.0.2; a public Yecao address here would bypass the private
# boundary that ai-service, Grafana, and Komodo Core rely on.
assert_upstream wotbtools.com wotb-frontend:80
assert_upstream auth.wotbtools.com keycloak:8080
assert_upstream monitor.wotbtools.com 10.20.0.2:3000
assert_upstream komodo.wotbtools.com 10.20.0.2:9120

site_block www.wotbtools.com \
  | grep -qE '^[[:space:]]*redir[[:space:]]+https://wotbtools\.com\{uri\}[[:space:]]+permanent[[:space:]]*$' \
  || { echo 'ERROR: www.wotbtools.com must permanently redirect to https://wotbtools.com.' >&2; exit 1; }

# The TX-local readiness surface the runtime check drives must survive.
site_block 'http://caddy' | grep -q 'handle /_wotb/ready' \
  || { echo 'ERROR: the TX-local /_wotb/ready readiness surface is missing.' >&2; exit 1; }

# Android's OIDC App Link target must answer for itself, on that host only. The
# app is not always installed, and before this route existed such a browser landed
# on Keycloak's catch-all 404 - a dead end with no way back to the app. The minimal
# text assertion here states the intent (one Caddy-owned `handle` for that exact
# path, answering from Caddy rather than proxying); the response Caddy actually
# serves is asserted against the adapted configuration below, where the answer is
# unambiguous.
android_callback="$(handle_block auth.wotbtools.com /android/oauth/callback)"
[ -n "$android_callback" ] \
  || { echo 'ERROR: auth.wotbtools.com must declare handle /android/oauth/callback.' >&2; exit 1; }
android_handles="$(grep -cE '^[[:space:]]*handle[[:space:]]+/android/oauth/callback[[:space:]]*\{' <<<"$android_callback" || true)"
[ "$android_handles" = 1 ] \
  || { echo "ERROR: auth.wotbtools.com must declare handle /android/oauth/callback exactly once (found $android_handles)." >&2; exit 1; }
grep -qE '^[[:space:]]*respond[[:space:]]' <<<"$android_callback" \
  || { echo 'ERROR: /android/oauth/callback must answer with a respond directive.' >&2; exit 1; }
grep -qi 'reverse_proxy' <<<"$android_callback" \
  && { echo 'ERROR: the /android/oauth/callback handler must answer from Caddy, never reverse_proxy an upstream.' >&2; exit 1; }

# No upstream may exist beyond the reviewed set above.
unexpected="$(sed -n 's/^[[:space:]]*reverse_proxy[[:space:]]\{1,\}\([^[:space:]]*\).*$/\1/p' "$CADDYFILE" \
  | grep -vxE 'wotb-frontend:80|keycloak:8080|10\.20\.0\.2:3000|10\.20\.0\.2:9120|https://wotbtools-assets-1478073677\.cos\.ap-shanghai\.myqcloud\.com' || true)"
[ -z "$unexpected" ] || {
  echo "ERROR: unreviewed Caddy upstream(s): $(tr '\n' ' ' <<<"$unexpected")" >&2
  exit 1
}

# Yecao is reachable only over WireGuard, so its public address must never appear.
if grep -q '45\.136\.14\.101' "$CADDYFILE"; then
  echo 'ERROR: the Caddyfile references the Yecao public address; Yecao upstreams must use 10.20.0.2.' >&2
  exit 1
fi

# The published Caddy image declares no ENTRYPOINT, so `--entrypoint caddy` is
# what turns the `validate ...` argument list into a real executable; it also
# keeps this command correct if a future image starts declaring
# `ENTRYPOINT ["caddy"]` (which would make a plain `caddy validate ...` argument
# list run `caddy caddy`). The same invocation adapts the staged file to JSON, so
# the assertions below inspect the exact configuration Caddy will serve - the
# adapted routes, response bodies and status codes - instead of re-parsing
# Caddyfile text.
android_adapted_file="$(mktemp)"
android_adapted_doc="$(mktemp)"
android_validate_log="$(mktemp)"
trap 'rm -f -- "$android_adapted_file" "$android_adapted_doc" "$android_validate_log"' EXIT

# Fail closed when jq is absent: the adapted-route assertions below are the only
# proof of what this route actually answers.
command -v jq >/dev/null 2>&1 || {
  echo 'ERROR: jq is required to assert the adapted Caddy routes.' >&2
  exit 1
}

if ! docker compose -p deploy \
  -f "$INCOMING_DIR/common.compose.yml" -f "$INCOMING_DIR/caddy.compose.yml" \
  run --rm --no-deps --entrypoint caddy caddy \
  adapt --config /etc/caddy/Caddyfile --adapter caddyfile > "$android_adapted_file" 2> "$android_validate_log"; then
  echo 'ERROR: the staged Caddy configuration could not be adapted by Caddy.' >&2
  cat "$android_validate_log" >&2
  exit 1
fi

# `caddy adapt` 把适配结果写到 stdout、日志写到 stderr，但 `docker compose run` 在部分版本/环境下
# 还会往 stdout 混入自己的输出（实测形态可以是一个裸数字），因此断言必须针对 **adapted JSON
# 文档**本身，而不是「stdout 恰好只有 JSON」这个假设：这里按 JSON 值流切开输入，取第一个对象，
# 并把被忽略的非对象值数量记下来（出现时能自解释，而不是让下一个人重新猜）。
if ! jq -s 'map(select(type == "object")) | first // empty' "$android_adapted_file" > "$android_adapted_doc"; then
  echo 'ERROR: the adapted Caddy output is not valid JSON.' >&2
  head -c 2000 "$android_adapted_file" >&2
  exit 1
fi
if [ ! -s "$android_adapted_doc" ]; then
  echo 'ERROR: Caddy produced no adapted JSON document for the staged configuration.' >&2
  head -c 2000 "$android_adapted_file" >&2
  exit 1
fi
android_noise="$(jq -s 'map(select(type != "object")) | length' "$android_adapted_file")"
if [ "$android_noise" != "0" ]; then
  echo "NOTE: ignored $android_noise non-object value(s) alongside the adapted JSON document."
fi

# The Android callback route in the adapted configuration, not in the text: exactly
# one route matching that exact path on that exact host, ordered before the single
# catch-all that still proxies the realm to keycloak:8080, answering from Caddy
# (never reverse_proxy), with a 200 status and a body that tells the user to return
# to the app. `all_handlers` walks every nesting level, so a handler hidden one
# level deeper is still found and a proxying one can never hide.
if ! jq -e '
  def all_handlers: .. | objects | select(has("handler"));
  def has_callback: ((.match // []) | map(.path? // []) | flatten | index("/android/oauth/callback")) != null;
  .apps.http.servers.srv0.routes
  | map(select([.match[]?.host[]?] | index("auth.wotbtools.com")))
  | .[0].handle[0].routes as $host_routes
  | [$host_routes[] | select(has_callback)] as $callback
  | [$host_routes[] | select((.match // []) == [])] as $catch_all
  | ([$callback[] | all_handlers | select(.handler == "static_response")] | length) as $answers
  | ([$callback[] | all_handlers
      | select(.handler == "static_response")
      | select(
          ((.status_code // 200) == 200)
          and ((.body // "") | contains("WotBTools App"))
          and ((.body // "") | contains("https://wotbtools.com/download/android"))
        )
     ] | length) as $answered
  | ($callback | length) == 1
    and ($catch_all | length) == 1
    and ([$host_routes | to_entries[] | select(.value | has_callback) | .key][0]
         < [$host_routes | to_entries[] | select((.value.match // []) == []) | .key][0])
    and ($answers == 1)
    and ($answered == 1)
    and (any($callback[] | all_handlers; .handler == "reverse_proxy") | not)
' "$android_adapted_doc" >/dev/null; then
  echo 'ERROR: the adapted Caddy configuration does not serve /android/oauth/callback as a 200 Caddy-owned page that tells the user to return to the WotBTools app (or it is not ordered before the auth.wotbtools.com catch-all).' >&2
  # 失败时必须能自解释：把该 host 的路由形状（match + handler 类型）打到 stderr，
  # 而不是只留一句结论让人重新跑一遍去猜。
  echo '--- adapted auth.wotbtools.com route shape ---' >&2
  jq -c '
    [.apps.http.servers.srv0.routes[] | select([.match[]?.host[]?] | index("auth.wotbtools.com"))]
    | .[0].handle[0].routes
    | map({match: (.match // []), handlers: ([.. | objects | select(has("handler")) | .handler] | unique)})
  ' "$android_adapted_doc" >&2 || head -c 2000 "$android_adapted_doc" >&2
  exit 1
fi

# Inspect Caddy's real adapted handlers: preflight must precede every proxy.
python3 - "$android_adapted_doc" <<'PY_CORS'
import json, sys

def walk(node):
    if isinstance(node, dict):
        yield node
        for value in node.values(): yield from walk(value)
    elif isinstance(node, list):
        for value in node: yield from walk(value)

origin = "https://appassets.androidplatform.net"
doc = json.load(open(sys.argv[1]))
host = next(node for node in walk(doc) if node.get("match") == [{"host": ["wotbtools.com"]}])
nodes = list(walk(host))
paths = ["/api/*", "/agent-assets/*", "/download/android/version.json"]
try:
    cors = next(node for node in nodes if node.get("match") == [{"header": {"Origin": [origin]}, "path": paths}])
    headers = next(node["response"]["set"] for node in walk(cors) if node.get("handler") == "headers")
    assert headers["Access-Control-Allow-Origin"] == [origin]
    assert set(headers["Access-Control-Allow-Methods"][0].replace(" ", "").split(",")) == {"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"}
    assert set(headers["Access-Control-Allow-Headers"][0].lower().replace(" ", "").split(",")) == {"authorization", "content-type", "content-encoding", "accept"}
    assert {"content-disposition", "x-request-id", "x-map-meta"}.issubset(set(headers["Access-Control-Expose-Headers"][0].lower().replace(" ", "").split(",")))
    preflight = next(node for node in nodes if node.get("match") == [{"header": {"Origin": [origin]}, "method": ["OPTIONS"], "path": paths}])
    assert any(node.get("handler") == "static_response" and node.get("status_code") == 204 for node in walk(preflight))
    proxy_position = next(i for i, node in enumerate(nodes) if node.get("handler") == "reverse_proxy")
    assert next(i for i, node in enumerate(nodes) if node is preflight) < proxy_position
    gateway = next(node for node in nodes if node.get("match") == [{"path": ["/agent-assets/*"]}])
    # handle directives within route preserve source order. Require the gateway
    # and Web catch-all to be siblings in the same mutually exclusive group.
    siblings = next(node["routes"] for node in nodes if any(route is gateway for route in node.get("routes", [])))
    catchall = next(route for route in siblings if not route.get("match") and any(child.get("handler") == "reverse_proxy" and child.get("upstreams") == [{"dial": "wotb-frontend:80"}] for child in walk(route)))
    assert gateway.get("group") and gateway["group"] == catchall.get("group")
    assert siblings.index(gateway) < siblings.index(catchall)
    assert any(node.get("strip_path_prefix") == "/agent-assets" for node in walk(gateway))
    proxy = next(node for node in walk(gateway) if node.get("handler") == "reverse_proxy")
    assert proxy["upstreams"] == [{"dial": "wotbtools-assets-1478073677.cos.ap-shanghai.myqcloud.com:443"}]
    for node in nodes:
        for operation in ("set", "add"):
            values = node.get("response", {}).get(operation, {})
            assert "Access-Control-Allow-Credentials" not in values
            assert "*" not in values.get("Access-Control-Allow-Origin", [])
except (StopIteration, AssertionError, KeyError):
    raise SystemExit("ERROR: adapted Android CORS must be exact-origin, non-credentialed, pre-auth, with the reviewed asset gateway")
PY_CORS

docker compose -p deploy \
  -f "$INCOMING_DIR/common.compose.yml" -f "$INCOMING_DIR/caddy.compose.yml" \
  run --rm --no-deps --entrypoint caddy caddy \
  validate --config /etc/caddy/Caddyfile --adapter caddyfile

echo "Caddy staged configuration OK: $INCOMING_DIR"
