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

write_plan initial-create '{"resource_changes":[{"address":"rabbitmq_vhost.wotbtools","change":{"actions":["create"]}},{"address":"rabbitmq_user.control_api","change":{"actions":["create"]}},{"address":"rabbitmq_user.parser_worker","change":{"actions":["create"]}},{"address":"rabbitmq_permissions.control_api_publisher","change":{"actions":["create"]}},{"address":"rabbitmq_permissions.parser_worker_consumer","change":{"actions":["create"]}}]}'
write_plan application-user-update '{"resource_changes":[{"address":"rabbitmq_user.control_api","change":{"actions":["update"]}},{"address":"rabbitmq_user.parser_worker","change":{"actions":["update"]}}]}'
write_plan delete '{"resource_changes":[{"address":"rabbitmq_user.control_api","change":{"actions":["delete"]}}]}'
write_plan replacement '{"resource_changes":[{"address":"rabbitmq_user.control_api","change":{"actions":["delete","create"]}}]}'
write_plan unknown-resource '{"resource_changes":[{"address":"rabbitmq_queue.application_owned","change":{"actions":["create"]}}]}'

assert_passes initial-create
assert_passes application-user-update
assert_rejects delete
assert_rejects replacement
assert_rejects unknown-resource
assert_rejects application-user-update --require-no-changes

echo "RabbitMQ OpenTofu plan safety policy contract OK"
