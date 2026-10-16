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
CADDY_FRONTEND_UPSTREAM_VALUE="${CADDY_FRONTEND_UPSTREAM:-wotb-frontend:80}"
CADDY_FRONTEND_PEER_VALUE="${CADDY_FRONTEND_PEER:-wotb-frontend:80}"
CADDY_KEYCLOAK_UPSTREAM_VALUE="${CADDY_KEYCLOAK_UPSTREAM:-keycloak:8080}"

validate_tx_upstream() {
  local name="$1" value="$2" local_value="$3" wg_port="$4"
  case "$value" in
    "$local_value"|"10.20.0.1:$wg_port"|"10.20.0.3:$wg_port") return 0 ;;
    *)
      echo "ERROR: $name must be $local_value or a reviewed TX1/TX2 WireGuard endpoint on port $wg_port (found: $value)." >&2
      exit 1
      ;;
  esac
}

validate_tx_upstream CADDY_FRONTEND_UPSTREAM "$CADDY_FRONTEND_UPSTREAM_VALUE" wotb-frontend:80 8081
validate_tx_upstream CADDY_FRONTEND_PEER "$CADDY_FRONTEND_PEER_VALUE" wotb-frontend:80 8081
validate_tx_upstream CADDY_KEYCLOAK_UPSTREAM "$CADDY_KEYCLOAK_UPSTREAM_VALUE" keycloak:8080 8080

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
assert_upstream wotbtools.com '{$CADDY_FRONTEND_UPSTREAM}'
assert_upstream auth.wotbtools.com '{$CADDY_KEYCLOAK_UPSTREAM}'
assert_upstream monitor.wotbtools.com 10.20.0.2:3000
assert_upstream komodo.wotbtools.com 10.20.0.2:9120

# K7C frontend steady state is an exact two-peer pool. Assert the public catch-all
# carries both reviewed logical placeholders in order; adapted JSON below proves
# they become the exact runtime dial pair.
frontend_handle="$(handle_block wotbtools.com "")"
grep -qE '^[[:space:]]*reverse_proxy[[:space:]]+\{\$CADDY_FRONTEND_UPSTREAM\}[[:space:]]+\{\$CADDY_FRONTEND_PEER\}[[:space:]]*\{' <<<"$frontend_handle" \
  || { echo 'ERROR: wotbtools.com must reverse_proxy the reviewed two-peer frontend pool.' >&2; exit 1; }

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

# auth 站点的受控访问日志（2.1.0 取证能力，docs/auth/web-qq-diagnostics.md §3.4）：
# Caddy 的 `log` 不是 ordered HTTP handler——既不能进 `handle` 也不能进 `route`（两者都被
# caddy adapt 拒绝），因此它是**站点级**的。这里断言它存在并使用 filter 编码器；留存字段
# 与业务站点共用同一条断言（下方 assert_compliance_log_fields）。
#
# 这组断言**取代**了原先逐个删除 code / state / session_state / iss 的黑名单式检查：那条
# 口径挡不住真实流量——RP-initiated logout 把完整 ID token 作为 `id_token_hint` query 参数
# 发到本站点（Android 的 AuthManager.endSession 与 Web 的 keycloak-js 都是），授权回程的
# `Location` 响应头同样带 code / state。整体删除 uri 与响应头严格强于逐参数删除：原先被
# 点名的每个参数仍然不可能出现，而且下一个新参数也不会泄漏。
auth_site="$(site_block auth.wotbtools.com)"
[ -n "$auth_site" ] \
  || { echo 'ERROR: auth.wotbtools.com site block is missing.' >&2; exit 1; }
grep -qE '^[[:space:]]*log[[:space:]]*\{' <<<"$auth_site" \
  || { echo 'ERROR: auth.wotbtools.com must enable the controlled access log.' >&2; exit 1; }
grep -qE '^[[:space:]]*format[[:space:]]+filter[[:space:]]*\{' <<<"$auth_site" \
  || { echo 'ERROR: the auth access log must use the filter encoder (redaction before stdout).' >&2; exit 1; }
grep -qE '^[[:space:]]*wrap[[:space:]]+json[[:space:]]*$' <<<"$auth_site" \
  || { echo 'ERROR: the auth access log must wrap the json encoder.' >&2; exit 1; }
# 退回黑名单式 query 过滤必须直接失败，而不是静默地只删掉几个已知参数。
if grep -qE '^[[:space:]]*request>uri[[:space:]]+query[[:space:]]*\{' <<<"$auth_site"; then
  echo 'ERROR: the auth access log must delete the whole uri, not filter named query parameters (id_token_hint carries a full ID token).' >&2
  exit 1
fi

# 合规安全日志（190 天留存，docs/operations/security-log-retention.md）。这里断言的是
# **意图声明**：哪条日志算安全日志、覆盖面收窄到哪里、留存哪些字段。适配后 JSON 的形状
# 断言在本文件下方（Caddy 真正会加载的配置）；真实请求级别的证明——/api/* 有日志、
# / 与 /assets/* 没有、query / Authorization / Cookie 的值不出现——由
# deploy/test-caddy-route-inventory.sh 的 runtime fixture 完成。三层缺一不可。
web_site="$(site_block wotbtools.com)"
[ -n "$web_site" ] || { echo 'ERROR: wotbtools.com site block is missing.' >&2; exit 1; }
grep -qE '^[[:space:]]*log[[:space:]]+security_api[[:space:]]*\{' <<<"$web_site" \
  || { echo 'ERROR: wotbtools.com must declare the named compliance access log: log security_api.' >&2; exit 1; }
# 字段白名单：原始 uri（含整个 query string）、全部请求头、全部响应头都必须在写 stdout
# 之前删掉，所以凭据、OAuth 参数与 id_token_hint 不可能进入这条长期留存的日志；删掉之后
# path 与 User-Agent 必须用 log_append 显式写回，否则取证日志里既没有访问目标也没有客户端
# 类型。两个站点同一条规则：谁进 compliance stream，谁就守这组字段。
assert_compliance_log_fields() {
  local host="$1" scope="$2" field
  for field in 'request>uri' 'request>headers' 'resp_headers'; do
    grep -qE "^[[:space:]]*${field}[[:space:]]+delete[[:space:]]*$" <<<"$scope" \
      || { echo "ERROR: the ${host} compliance access log must delete '${field}' before stdout." >&2; exit 1; }
  done
  grep -qE '^[[:space:]]*log_append[[:space:]]+path[[:space:]]+\{http[.]request[.]uri[.]path\}[[:space:]]*$' <<<"$scope" \
    || { echo "ERROR: ${host} must log_append the request path (the replacement for the deleted uri)." >&2; exit 1; }
  grep -qE '^[[:space:]]*log_append[[:space:]]+ua[[:space:]]+\{http[.]request[.]header[.]User-Agent\}[[:space:]]*$' <<<"$scope" \
    || { echo "ERROR: ${host} must log_append the User-Agent (the replacement for the deleted headers)." >&2; exit 1; }
  if grep -qE '^[[:space:]]*log_append[[:space:]]+[^[:space:]]+[[:space:]]+.*\{http[.]request[.]uri[.]query' <<<"$scope"; then
    echo "ERROR: the ${host} compliance access log must not re-append the query string." >&2
    exit 1
  fi
}
assert_compliance_log_fields wotbtools.com "$web_site"
assert_compliance_log_fields auth.wotbtools.com "$auth_site"
# 覆盖面：只有 /api/* 留存。真正的不变量是「跳过判定排在任何能终结请求的 handler 之前」
# ——由下方适配后 JSON 的顺序断言拥有；这里只锁住声明本身存在。
grep -qE '^[[:space:]]*@notApi[[:space:]]+not[[:space:]]+path[[:space:]]+/api/\*[[:space:]]*$' <<<"$web_site" \
  || { echo 'ERROR: wotbtools.com must declare the @notApi matcher as: not path /api/*' >&2; exit 1; }
grep -qE '^[[:space:]]*log_skip[[:space:]]+@notApi[[:space:]]*$' <<<"$web_site" \
  || { echo 'ERROR: wotbtools.com must log_skip @notApi so only /api/* enters the compliance log.' >&2; exit 1; }
# compliance / security_kind 是 Alloy 合规分流的唯一事实源（字段白名单见上方 helper）。
web_appended() {
  grep -qE "^[[:space:]]*log_append[[:space:]]+$1$" <<<"$web_site"
}
web_appended 'compliance[[:space:]]+security' \
  || { echo 'ERROR: wotbtools.com must log_append compliance security (the Alloy retention selector).' >&2; exit 1; }
web_appended 'security_kind[[:space:]]+api_access' \
  || { echo 'ERROR: wotbtools.com must log_append security_kind api_access.' >&2; exit 1; }
# 认证域的受控访问日志同样进入 190 天 security stream，因此也必须带这两个分流标记。
grep -qE '^[[:space:]]*log_append[[:space:]]+compliance[[:space:]]+security[[:space:]]*$' <<<"$auth_site" \
  || { echo 'ERROR: auth.wotbtools.com must log_append compliance security.' >&2; exit 1; }
grep -qE '^[[:space:]]*log_append[[:space:]]+security_kind[[:space:]]+auth_access[[:space:]]*$' <<<"$auth_site" \
  || { echo 'ERROR: auth.wotbtools.com must log_append security_kind auth_access.' >&2; exit 1; }

# No first-position upstream may exist beyond the reviewed set above. The second
# frontend peer is asserted explicitly by the exact two-peer directive above and
# by the adapted runtime dial list below.
unexpected="$(sed -n 's/^[[:space:]]*reverse_proxy[[:space:]]\{1,\}\([^[:space:]]*\).*$/\1/p' "$CADDYFILE" \
  | grep -vxF -e '{$CADDY_FRONTEND_UPSTREAM}' -e '{$CADDY_KEYCLOAK_UPSTREAM}' \
      -e '10.20.0.2:3000' -e '10.20.0.2:9120' \
      -e 'https://wotbtools-assets-1478073677.cos.ap-shanghai.myqcloud.com' || true)"
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
# catch-all that still proxies the realm to the configured Keycloak logical endpoint, answering from Caddy
# (never reverse_proxy), with a 200 status and a body that tells the user to return
# to the app. `all_handlers` walks every nesting level, so a handler hidden one
# level deeper is still found and a proxying one can never hide.
# The catch-all is identified by what it does (a match-less route that proxies), not
# by the mere absence of a matcher: site-level handlers that legitimately apply to
# every request - `log_append` for the compliance access log - also adapt to
# match-less routes, and they are not catch-alls. Counting those as catch-alls would
# reject a correct configuration while still letting a second *proxying* catch-all
# through, which is the shape this rule actually exists to catch.
if ! jq -e '
  def all_handlers: .. | objects | select(has("handler"));
  def has_callback: ((.match // []) | map(.path? // []) | flatten | index("/android/oauth/callback")) != null;
  .apps.http.servers.srv0.routes
  | map(select([.match[]?.host[]?] | index("auth.wotbtools.com")))
  | .[0].handle[0].routes as $host_routes
  | [$host_routes[] | select(has_callback)] as $callback
  | [$host_routes[]
     | select(((.match // []) == []) and (any(all_handlers; .handler == "reverse_proxy")))] as $catch_all
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
         < [$host_routes | to_entries[]
            | select(((.value.match // []) == [])
                     and (.value | any(all_handlers; .handler == "reverse_proxy")))
            | .key][0])
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
WOTB_EXPECTED_FRONTEND_DIAL="$CADDY_FRONTEND_UPSTREAM_VALUE" \
WOTB_EXPECTED_FRONTEND_PEER_DIAL="$CADDY_FRONTEND_PEER_VALUE" \
python3 - "$android_adapted_doc" <<'PY_CORS'
import json
import os, sys

def walk(node):
    if isinstance(node, dict):
        yield node
        for value in node.values(): yield from walk(value)
    elif isinstance(node, list):
        for value in node: yield from walk(value)

# Android 2.x System WebView origin + Android 3.0+ GeckoView LocalRuntimeServer origin
# (android/app/src/main/java/com/wotbtools/app/MainActivity.kt LOCAL_APP_ORIGIN).
origins = ["https://appassets.androidplatform.net", "http://127.0.0.1:21653"]
doc = json.load(open(sys.argv[1]))
host = next(node for node in walk(doc) if node.get("match") == [{"host": ["wotbtools.com"]}])
nodes = list(walk(host))
paths = ["/api/*", "/agent-assets/*", "/download/android/version.json"]
try:
    proxy_position = next(i for i, node in enumerate(nodes) if node.get("handler") == "reverse_proxy")
    for origin in origins:
        cors = next(node for node in nodes if node.get("match") == [{"header": {"Origin": [origin]}, "path": paths}])
        headers = next(node["response"]["set"] for node in walk(cors) if node.get("handler") == "headers")
        assert headers["Access-Control-Allow-Origin"] == [origin]
        assert set(headers["Access-Control-Allow-Methods"][0].replace(" ", "").split(",")) == {"GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"}
        assert set(headers["Access-Control-Allow-Headers"][0].lower().replace(" ", "").split(",")) == {"authorization", "content-type", "content-encoding", "accept"}
        assert {"content-disposition", "x-request-id", "x-map-meta", "x-tournament-default-rules"}.issubset(set(headers["Access-Control-Expose-Headers"][0].lower().replace(" ", "").split(",")))
        preflight = next(node for node in nodes if node.get("match") == [{"header": {"Origin": [origin]}, "method": ["OPTIONS"], "path": paths}])
        assert any(node.get("handler") == "static_response" and node.get("status_code") == 204 for node in walk(preflight))
        assert next(i for i, node in enumerate(nodes) if node is preflight) < proxy_position
    gateway = next(node for node in nodes if node.get("match") == [{"path": ["/agent-assets/*"]}])
    # handle directives within route preserve source order. Require the gateway
    # and Web catch-all to be siblings in the same mutually exclusive group.
    siblings = next(node["routes"] for node in nodes if any(route is gateway for route in node.get("routes", [])))
    expected_dial = os.environ.get("WOTB_EXPECTED_FRONTEND_DIAL") or "wotb-frontend:80"
    expected_peer_dial = os.environ.get("WOTB_EXPECTED_FRONTEND_PEER_DIAL") or "wotb-frontend:80"
    expected_upstreams = [{"dial": expected_dial}, {"dial": expected_peer_dial}]
    catchall = next(
        route for route in siblings
        if not route.get("match")
        and any(
            child.get("handler") == "reverse_proxy"
            and child.get("upstreams") == expected_upstreams
            for child in walk(route)
        )
    )
    assert gateway.get("group") and gateway["group"] == catchall.get("group")
    assert siblings.index(gateway) < siblings.index(catchall)
    assert any(node.get("strip_path_prefix") == "/agent-assets" for node in walk(gateway))
    proxy = next(node for node in walk(gateway) if node.get("handler") == "reverse_proxy")
    assert proxy["upstreams"] == [{"dial": "wotbtools-assets-1478073677.cos.ap-shanghai.myqcloud.com:443"}]
    frontend_proxy = next(
        node for node in walk(catchall)
        if node.get("handler") == "reverse_proxy" and node.get("upstreams") == expected_upstreams
    )
    health_checks = frontend_proxy.get("health_checks", {}).get("active", {})
    assert health_checks.get("uri") == "/version.json"
    assert health_checks.get("interval") == 10_000_000_000
    assert health_checks.get("timeout") == 3_000_000_000
    for node in nodes:
        for operation in ("set", "add"):
            values = node.get("response", {}).get(operation, {})
            assert "Access-Control-Allow-Credentials" not in values
            assert "*" not in values.get("Access-Control-Allow-Origin", [])
except (StopIteration, AssertionError, KeyError):
    raise SystemExit("ERROR: adapted Android CORS / K7C frontend pool must be exact-origin, non-credentialed, pre-auth, with the reviewed asset gateway and exact two-peer health-checked frontend pool")
PY_CORS

# Inspect Caddy's real adapted logging configuration. The text assertions above
# state the intent; this states what Caddy will actually load: one named access
# logger per reviewed host, the compliance logger's field deletions, the default
# logger excluding both access loggers (so a compliance line is never duplicated
# into the 7-day stream), and the log_skip route ordered ahead of everything that
# can terminate a request (the APK redirect and the Android preflight responses).
python3 - "$android_adapted_doc" <<'PY_COMPLIANCE_LOG'
import json
import sys

def walk(node):
    if isinstance(node, dict):
        yield node
        for value in node.values(): yield from walk(value)
    elif isinstance(node, list):
        for value in node: yield from walk(value)

doc = json.load(open(sys.argv[1], encoding="utf-8"))
try:
    logs = doc["logging"]["logs"]
    compliance = logs["security_api"]
    assert compliance["include"] == ["http.log.access.security_api"], compliance.get("include")
    assert compliance["writer"] == {"output": "stdout"}, compliance.get("writer")
    encoder = compliance["encoder"]
    assert encoder["format"] == "filter" and encoder["wrap"]["format"] == "json", encoder
    # The whitelist is enforced by deletion: no raw uri (hence no query string),
    # no request headers (hence no Authorization / Cookie) and no response headers.
    for field in ("request>uri", "request>headers", "resp_headers"):
        assert encoder["fields"][field] == {"filter": "delete"}, (field, encoder["fields"].get(field))
    # Both access loggers must be excluded from `default`: Caddy would otherwise
    # write every compliance line a second time into the untagged stream, where it
    # would be kept for 7 days without the field filter ever being applied.
    excluded = set(logs["default"]["exclude"])
    assert "http.log.access.security_api" in excluded, excluded
    auth_logger = next(name for name, value in logs.items()
                       if name != "security_api"
                       and "http.log.access." + name in excluded
                       and value.get("include"))
    # The auth domain is in the same 190-day stream, so it must carry the same field
    # whitelist. A named-parameter query filter there would keep `id_token_hint` - a
    # full ID token - for 190 days, which is exactly what this log promises not to do.
    auth_fields = logs[auth_logger]["encoder"]["fields"]
    for field in ("request>uri", "request>headers", "resp_headers"):
        assert auth_fields[field] == {"filter": "delete"}, (auth_logger, field, auth_fields.get(field))
    server = next(server for server in doc["apps"]["http"]["servers"].values()
                  if "wotbtools.com" in server.get("logs", {}).get("logger_names", {}))
    logger_names = server["logs"]["logger_names"]
    assert logger_names["wotbtools.com"] == ["security_api"], logger_names
    assert logger_names["auth.wotbtools.com"] == [auth_logger], logger_names

    host = next(node for node in walk(server["routes"])
                if node.get("match") == [{"host": ["wotbtools.com"]}])
    site_routes = host["handle"][0]["routes"]
    skip_index = next(i for i, route in enumerate(site_routes)
                      if route.get("match") == [{"not": [{"path": ["/api/*"]}]}]
                      and any(handler.get("handler") == "vars" and handler.get("log_skip") is True
                              for handler in walk(route)))
    # Everything that answers or proxies must come after the skip decision.
    terminal = {"reverse_proxy", "static_response", "file_server"}
    first_terminal = next(i for i, route in enumerate(site_routes)
                          if any(handler.get("handler") in terminal for handler in walk(route)))
    assert skip_index < first_terminal, (skip_index, first_terminal)
    appended = {handler["key"]: handler["value"]
                for handler in walk(host) if handler.get("handler") == "log_append"}
    assert appended == {
        "compliance": "security",
        "security_kind": "api_access",
        "path": "{http.request.uri.path}",
        "ua": "{http.request.header.User-Agent}",
    }, appended

    auth_host = next(node for node in walk(server["routes"])
                     if node.get("match") == [{"host": ["auth.wotbtools.com"]}])
    auth_appended = {handler["key"]: handler["value"]
                     for handler in walk(auth_host) if handler.get("handler") == "log_append"}
    assert auth_appended == {
        "compliance": "security",
        "security_kind": "auth_access",
        "path": "{http.request.uri.path}",
        "ua": "{http.request.header.User-Agent}",
    }, auth_appended
except (StopIteration, AssertionError, KeyError) as error:
    raise SystemExit(
        "ERROR: the adapted Caddy configuration does not carry the reviewed compliance access log "
        "(named logger with the uri/headers/resp_headers deletions, both access loggers excluded "
        "from the default stream, log_skip for non-/api/* ordered before every responder, and the "
        f"exact log_append field set on both hosts): {error!r}"
    )
PY_COMPLIANCE_LOG

docker compose -p deploy \
  -f "$INCOMING_DIR/common.compose.yml" -f "$INCOMING_DIR/caddy.compose.yml" \
  run --rm --no-deps --entrypoint caddy caddy \
  validate --config /etc/caddy/Caddyfile --adapter caddyfile

echo "Caddy staged configuration OK: $INCOMING_DIR"
