#!/usr/bin/env bash
set -Eeuo pipefail

readonly ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly WORK="$(mktemp -d)"
trap 'rm -rf -- "$WORK"' EXIT

mkdir -p "$WORK/bin"
cat > "$WORK/bin/tofu" <<'EOF'
#!/usr/bin/env bash
set -Eeuo pipefail
[ "$#" -eq 3 ] && [ "$1" = show ] && [ "$2" = -json ] || exit 2
cat "$3"
EOF
chmod 700 "$WORK/bin/tofu"

write_plan() {
  local name="$1" json="$2"
  printf '%s\n' "$json" > "$WORK/$name.tfplan"
}

assert_passes() {
  local name="$1"
  shift
  PATH="$WORK/bin:$PATH" bash "$ROOT/validate-plan.sh" "$WORK/$name.tfplan" "$@" >/dev/null
}

assert_rejects() {
  local name="$1"
  shift
  if PATH="$WORK/bin:$PATH" bash "$ROOT/validate-plan.sh" "$WORK/$name.tfplan" "$@" >/dev/null 2>&1; then
    echo "ERROR: $name should have been rejected." >&2
    exit 1
  fi
}

readonly CONTROL_ACL='{"permissions":[{"configure":"^$","write":"^wotb\\.jobs$","read":"^$"}]}'
readonly PARSER_ACL='{"permissions":[{"configure":"^$","write":"^wotb\\.jobs$","read":"^wotb\\.parser$"}]}'

write_plan initial-create "{\"resource_changes\":[
  {\"address\":\"rabbitmq_vhost.wotbtools\",\"change\":{\"actions\":[\"create\"]}},
  {\"address\":\"rabbitmq_user.control_api\",\"change\":{\"actions\":[\"create\"]}},
  {\"address\":\"rabbitmq_user.parser_worker\",\"change\":{\"actions\":[\"create\"]}},
  {\"address\":\"rabbitmq_permissions.control_api_publisher\",\"change\":{\"actions\":[\"create\"],\"after\":$CONTROL_ACL}},
  {\"address\":\"rabbitmq_permissions.parser_worker_consumer\",\"change\":{\"actions\":[\"create\"],\"after\":$PARSER_ACL}},
  {\"address\":\"rabbitmq_exchange.jobs\",\"change\":{\"actions\":[\"create\"]}},
  {\"address\":\"rabbitmq_queue.parser\",\"change\":{\"actions\":[\"create\"]}},
  {\"address\":\"rabbitmq_queue.parser_retry\",\"change\":{\"actions\":[\"create\"]}},
  {\"address\":\"rabbitmq_queue.parser_dlq\",\"change\":{\"actions\":[\"create\"]}},
  {\"address\":\"rabbitmq_binding.parser_request\",\"change\":{\"actions\":[\"create\"]}},
  {\"address\":\"rabbitmq_binding.parser_retry\",\"change\":{\"actions\":[\"create\"]}},
  {\"address\":\"rabbitmq_binding.parser_dead\",\"change\":{\"actions\":[\"create\"]}}
]}"

write_plan second-plan-noop "{\"resource_changes\":[
  {\"address\":\"rabbitmq_vhost.wotbtools\",\"change\":{\"actions\":[\"no-op\"]}},
  {\"address\":\"rabbitmq_user.control_api\",\"change\":{\"actions\":[\"no-op\"]}},
  {\"address\":\"rabbitmq_user.parser_worker\",\"change\":{\"actions\":[\"no-op\"]}},
  {\"address\":\"rabbitmq_permissions.control_api_publisher\",\"change\":{\"actions\":[\"no-op\"],\"after\":$CONTROL_ACL}},
  {\"address\":\"rabbitmq_permissions.parser_worker_consumer\",\"change\":{\"actions\":[\"no-op\"],\"after\":$PARSER_ACL}},
  {\"address\":\"rabbitmq_exchange.jobs\",\"change\":{\"actions\":[\"no-op\"]}},
  {\"address\":\"rabbitmq_queue.parser\",\"change\":{\"actions\":[\"no-op\"]}},
  {\"address\":\"rabbitmq_queue.parser_retry\",\"change\":{\"actions\":[\"no-op\"]}},
  {\"address\":\"rabbitmq_queue.parser_dlq\",\"change\":{\"actions\":[\"no-op\"]}},
  {\"address\":\"rabbitmq_binding.parser_request\",\"change\":{\"actions\":[\"no-op\"]}},
  {\"address\":\"rabbitmq_binding.parser_retry\",\"change\":{\"actions\":[\"no-op\"]}},
  {\"address\":\"rabbitmq_binding.parser_dead\",\"change\":{\"actions\":[\"no-op\"]}}
]}"

write_plan acl-tightening "{\"resource_changes\":[
  {\"address\":\"rabbitmq_permissions.control_api_publisher\",\"change\":{\"actions\":[\"update\"],\"after\":$CONTROL_ACL}},
  {\"address\":\"rabbitmq_permissions.parser_worker_consumer\",\"change\":{\"actions\":[\"update\"],\"after\":$PARSER_ACL}}
]}"

write_plan application-user-update '{"resource_changes":[{"address":"rabbitmq_user.control_api","change":{"actions":["update"]}},{"address":"rabbitmq_user.parser_worker","change":{"actions":["update"]}}]}'
write_plan queue-delete '{"resource_changes":[{"address":"rabbitmq_queue.parser","change":{"actions":["delete"]}}]}'
write_plan queue-replacement '{"resource_changes":[{"address":"rabbitmq_queue.parser","change":{"actions":["delete","create"]}}]}'
write_plan queue-update '{"resource_changes":[{"address":"rabbitmq_queue.parser","change":{"actions":["update"]}}]}'
write_plan exchange-update '{"resource_changes":[{"address":"rabbitmq_exchange.jobs","change":{"actions":["update"]}}]}'
write_plan binding-update '{"resource_changes":[{"address":"rabbitmq_binding.parser_request","change":{"actions":["update"]}}]}'
write_plan application-user-replacement '{"resource_changes":[{"address":"rabbitmq_user.parser_worker","change":{"actions":["delete","create"]}}]}'
write_plan unknown-resource '{"resource_changes":[{"address":"rabbitmq_queue.application_owned","change":{"actions":["create"]}}]}'
write_plan vhost-wide-acl '{"resource_changes":[{"address":"rabbitmq_permissions.control_api_publisher","change":{"actions":["update"],"after":{"permissions":[{"configure":"^$","write":".*","read":"^$"}]}}}]}'
write_plan configure-acl '{"resource_changes":[{"address":"rabbitmq_permissions.parser_worker_consumer","change":{"actions":["update"],"after":{"permissions":[{"configure":".*","write":"^wotb\\.jobs$","read":"^wotb\\.parser$"}]}}}]}'

assert_passes initial-create
assert_passes second-plan-noop --require-no-changes
assert_passes acl-tightening
assert_passes application-user-update
assert_rejects queue-delete
assert_rejects queue-replacement
assert_rejects queue-update
assert_rejects exchange-update
assert_rejects binding-update
assert_rejects application-user-replacement
assert_rejects unknown-resource
assert_rejects vhost-wide-acl
assert_rejects configure-acl
assert_rejects acl-tightening --require-no-changes

echo "RabbitMQ OpenTofu plan safety policy contract OK"
