#!/usr/bin/env bash
# Validate the production Alloy config before a staged deployment is promoted.
set -euo pipefail

CONFIG_FILE="${1:?usage: validate-alloy-config.sh <config.alloy>}"
if [ ! -f "$CONFIG_FILE" ]; then
  echo "ERROR: Alloy config is missing: $CONFIG_FILE" >&2
  exit 1
fi

# Loki's match selector has its own LogQL string parser.  A backslash-escaped
# dot is rejected there, even though the same spelling is valid in the later
# regex stage.  Keep the selector's dot as a character class and reject the
# production failure spelling explicitly.
required_selector='selector            = "{container_name=\"wotb-frontend\"} !~ \"GET /download/android/[^ ]+[.]apk\""'
legacy_selector='GET /download/android/[^ ]+\\.apk'

if ! grep -Fq "$required_selector" "$CONFIG_FILE"; then
  echo "ERROR: Alloy Android download selector must use the LogQL-safe [.] form." >&2
  exit 1
fi
if grep -Fq "$legacy_selector" "$CONFIG_FILE"; then
  echo "ERROR: Alloy Android download selector contains the invalid \\. escape." >&2
  exit 1
fi

# --- TX compliance split (public-security self-assessment log retention) ------
# 只有 TX 车道采 Keycloak 与 Caddy，所以合规分流契约是 TX 配置专属的；Yecao 配置只服务
# 部署 canary，不承担这条链路。按路径判定而不是「配置里有没有 compliance」——后者是自我
# 实现的断言，删掉整个分支就自动通过了。
case "$CONFIG_FILE" in
*/deploy/tx/alloy/config.alloy)
  # alloy_block <declaration-first-line>: 该组件块的正文，按花括号配平截断。
  alloy_block() {
    awk -v head="$1" '
      !inside && index($0, head) == 1 { inside = 1 }
      inside {
        depth += gsub(/\{/, "{")
        depth -= gsub(/\}/, "}")
        print
        if (depth <= 0) exit
      }
    ' "$CONFIG_FILE"
  }

  compliance_block="$(alloy_block 'loki.process "compliance" {')"
  [ -n "$compliance_block" ] || {
    echo 'ERROR: the TX Alloy config must declare loki.process "compliance" (the 190-day retention selector).' >&2
    exit 1
  }
  grep -Fq 'forward_to = [loki.write.default.receiver]' <<<"$compliance_block" || {
    echo 'ERROR: the compliance processor must still forward every line to loki.write.default (it labels, it never replaces the existing stream).' >&2
    exit 1
  }

  # 两条安全日志源必须经过这个 processor，否则它们的行永远拿不到 compliance 标签，
  # Loki 会在 7 天后把登录与 API 访问证据删掉。
  for security_source in keycloak caddy; do
    grep -Fq 'forward_to = [loki.process.compliance.receiver]' \
      <<<"$(alloy_block "loki.source.docker \"$security_source\" {")" || {
      echo "ERROR: the TX ${security_source} log source must forward to loki.process.compliance." >&2
      exit 1
    }
  done

  # 标签值本身：Loki 的 retention_stream selector 是 {compliance="security"}，
  # security_kind 区分认证事件 / API 访问 / 认证域访问。
  grep -qE '^[[:space:]]*compliance[[:space:]]*=[[:space:]]*"security",?[[:space:]]*$' <<<"$compliance_block" || {
    echo 'ERROR: the compliance processor must label the security streams compliance="security".' >&2
    exit 1
  }
  grep -qE '^[[:space:]]*security_kind[[:space:]]*=[[:space:]]*"auth",?[[:space:]]*$' <<<"$compliance_block" || {
    echo 'ERROR: the Keycloak compliance branch must label its stream security_kind="auth".' >&2
    exit 1
  }
  grep -qE '^[[:space:]]*security_kind[[:space:]]*=[[:space:]]*"security_kind",?[[:space:]]*$' <<<"$compliance_block" || {
    echo 'ERROR: the Caddy compliance branch must promote the security_kind field Caddy writes into the line.' >&2
    exit 1
  }

  # 反向边界：普通产品日志绝不能拿到这个标签，否则整栈都变成 190 天留存。
  for ordinary_lane in 'loki.source.docker "backend" {' 'loki.source.docker "frontend" {' 'loki.process "android_download" {'; do
    if grep -q 'compliance' <<<"$(alloy_block "$ordinary_lane")"; then
      echo "ERROR: ordinary telemetry must never be labelled compliance: $ordinary_lane" >&2
      exit 1
    fi
  done

  # 跨层一致：jboss-logging listener 不受 realm 的 enabled_event_types 约束（那只过滤
  # 数据库 event store），所以 190 天留存的收窄只发生在这条 selector 里——它和 IaC 声明
  # 的事件清单必须逐一对应，否则「只记录我们真正需要的事件」就只是文档里的说法。
  # events.tf 是唯一事实源。生产 staging 只拷贝 deploy/tx 与本脚本，拿不到 infra/，
  # 此时跳过并说明：这条跨层断言的权威执行点是 PR CI 的完整检出。
  alloy_event_types="$(grep -oE '\(LOGIN[A-Z_|]*\)' "$CONFIG_FILE" | head -n1 | tr -d '()' | tr '|' '\n' | sort -u)"
  [ -n "$alloy_event_types" ] || {
    echo 'ERROR: the Keycloak compliance selector must enumerate the retained event types.' >&2
    exit 1
  }
  events_declaration="$(cd "$(dirname "$CONFIG_FILE")/../../.." 2>/dev/null && pwd)/infra/tofu/keycloak/events.tf"
  if [ -f "$events_declaration" ]; then
    declared_event_types="$(sed -n '/enabled_event_types = \[/,/^  \]/p' "$events_declaration" \
      | grep -oE '"[A-Z_]+"' | tr -d '"' | sort -u)"
    [ -n "$declared_event_types" ] || {
      echo "ERROR: could not read enabled_event_types from $events_declaration." >&2
      exit 1
    }
    if [ "$alloy_event_types" != "$declared_event_types" ]; then
      echo 'ERROR: the Alloy compliance selector and the declared Keycloak event list have drifted.' >&2
      echo "--- selector ($(tr '\n' ' ' <<<"$alloy_event_types"))" >&2
      echo "--- events.tf ($(tr '\n' ' ' <<<"$declared_event_types"))" >&2
      exit 1
    fi
  else
    echo "NOTE: $events_declaration is not part of this tree; the Keycloak event-list cross-check runs in PR CI."
  fi
  ;;
esac

docker run --rm --entrypoint alloy \
  -v "$CONFIG_FILE:/etc/alloy/config.alloy:ro" \
  grafana/alloy:v1.4.2 fmt -t /etc/alloy/config.alloy >/dev/null

echo "Alloy config contract and format OK: $CONFIG_FILE"
