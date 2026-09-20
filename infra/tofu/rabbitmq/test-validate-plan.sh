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
  local name="$1" expected="$2"
  shift 2
  local reason
  if reason="$(PATH="$WORK/bin:$PATH" bash "$ROOT/validate-plan.sh" "$WORK/$name.tfplan" "$@" 2>&1)"; then
    echo "ERROR: $name should have been rejected." >&2
    exit 1
  fi
  # A fixture that merely crashes the validator must never count as a rejection,
  # and each fixture must be refused by the policy rule it is written to cover.
  if ! grep -Fq -- "$expected" <<< "$reason"; then
    echo "ERROR: $name was not rejected by the expected policy rule." >&2
    echo "       expected to find: $expected" >&2
    printf '       actual: %s\n' "$reason" >&2
    exit 1
  fi
}

readonly CONTROL_ACL='{"permissions":[{"configure":"^$","write":"^wotb\\.jobs$","read":"^$"}]}'
readonly PARSER_ACL='{"permissions":[{"configure":"^$","write":"^wotb\\.jobs$","read":"^wotb\\.parser$"}]}'
readonly TAGS_RULE="application identity may not carry RabbitMQ tags"

# Post-plan user shapes carry the plaintext password because `password` is a
# sensitive provider attribute; the validator must never need to inspect it.
readonly CONTROL_USER='{"name":"control-api","password":"rotated-control-password","tags":[]}'
readonly PARSER_USER='{"name":"parser-worker","password":"rotated-parser-password","tags":[]}'
readonly USER_SENSITIVE='{"password":true,"tags":[]}'
readonly USER_UNKNOWN='{"id":true,"tags":[]}'

user_change() {
  local actions="$1" after="$2"
  printf '{"actions":[%s],"after":%s,"after_sensitive":%s,"after_unknown":%s}' \
    "$actions" "$after" "$USER_SENSITIVE" "$USER_UNKNOWN"
}

write_plan initial-create "{\"resource_changes\":[
  {\"address\":\"rabbitmq_vhost.wotbtools\",\"change\":{\"actions\":[\"create\"]}},
  {\"address\":\"rabbitmq_user.control_api\",\"change\":$(user_change '"create"' "$CONTROL_USER")},
  {\"address\":\"rabbitmq_user.parser_worker\",\"change\":$(user_change '"create"' "$PARSER_USER")},
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
  {\"address\":\"rabbitmq_user.control_api\",\"change\":$(user_change '"no-op"' "$CONTROL_USER")},
  {\"address\":\"rabbitmq_user.parser_worker\",\"change\":$(user_change '"no-op"' "$PARSER_USER")},
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

# The only allowed application-user update: credential rotation on the two
# known identities, with the tag set still empty.
write_plan application-user-password-update "{\"resource_changes\":[
  {\"address\":\"rabbitmq_user.control_api\",\"change\":$(user_change '"update"' "$CONTROL_USER")},
  {\"address\":\"rabbitmq_user.parser_worker\",\"change\":$(user_change '"update"' "$PARSER_USER")}
]}"

write_plan control-api-tags-management "{\"resource_changes\":[
  {\"address\":\"rabbitmq_user.control_api\",\"change\":$(user_change '"update"' '{"name":"control-api","password":"rotated","tags":["management"]}')}
]}"
write_plan parser-worker-tags-management "{\"resource_changes\":[
  {\"address\":\"rabbitmq_user.parser_worker\",\"change\":$(user_change '"update"' '{"name":"parser-worker","password":"rotated","tags":["management"]}')}
]}"
write_plan application-user-tags-administrator "{\"resource_changes\":[
  {\"address\":\"rabbitmq_user.parser_worker\",\"change\":$(user_change '"update"' '{"name":"parser-worker","password":"rotated","tags":["administrator"]}')}
]}"
write_plan application-user-tags-monitoring "{\"resource_changes\":[
  {\"address\":\"rabbitmq_user.control_api\",\"change\":$(user_change '"update"' '{"name":"control-api","password":"rotated","tags":["monitoring"]}')}
]}"
write_plan application-user-tags-unknown "{\"resource_changes\":[
  {\"address\":\"rabbitmq_user.control_api\",\"change\":{\"actions\":[\"update\"],\"after\":{\"name\":\"control-api\",\"password\":\"rotated\",\"tags\":null},\"after_sensitive\":$USER_SENSITIVE,\"after_unknown\":{\"id\":true,\"tags\":true}}}
]}"
write_plan application-user-create-with-tags "{\"resource_changes\":[
  {\"address\":\"rabbitmq_user.control_api\",\"change\":$(user_change '"create"' '{"name":"control-api","password":"rotated","tags":["management"]}')}
]}"
write_plan application-user-renamed "{\"resource_changes\":[
  {\"address\":\"rabbitmq_user.control_api\",\"change\":$(user_change '"update"' '{"name":"control-api-renamed","password":"rotated","tags":[]}')}
]}"
write_plan application-user-extra-attribute "{\"resource_changes\":[
  {\"address\":\"rabbitmq_user.parser_worker\",\"change\":{\"actions\":[\"update\"],\"after\":{\"name\":\"parser-worker\",\"password\":\"rotated\",\"tags\":[],\"limits\":{\"max-connections\":100}},\"after_sensitive\":$USER_SENSITIVE,\"after_unknown\":$USER_UNKNOWN}}
]}"
write_plan application-user-unknown-attribute "{\"resource_changes\":[
  {\"address\":\"rabbitmq_user.control_api\",\"change\":{\"actions\":[\"update\"],\"after\":$CONTROL_USER,\"after_sensitive\":$USER_SENSITIVE,\"after_unknown\":{\"id\":true,\"tags\":[],\"permissions\":true}}}
]}"

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
assert_passes application-user-password-update
assert_rejects control-api-tags-management "$TAGS_RULE"
assert_rejects parser-worker-tags-management "$TAGS_RULE"
assert_rejects application-user-tags-administrator "$TAGS_RULE"
assert_rejects application-user-tags-monitoring "$TAGS_RULE"
assert_rejects application-user-tags-unknown "$TAGS_RULE"
assert_rejects application-user-create-with-tags "$TAGS_RULE"
assert_rejects application-user-renamed "application identity must stay named control-api"
assert_rejects application-user-extra-attribute "unexpected application identity attribute(s): limits"
assert_rejects application-user-unknown-attribute "unexpected application identity attribute(s): permissions"
assert_rejects queue-delete "destructive RabbitMQ plan action"
assert_rejects queue-replacement "destructive RabbitMQ plan action"
assert_rejects queue-update "unsafe RabbitMQ plan action for rabbitmq_queue.parser"
assert_rejects exchange-update "unsafe RabbitMQ plan action for rabbitmq_exchange.jobs"
assert_rejects binding-update "unsafe RabbitMQ plan action for rabbitmq_binding.parser_request"
assert_rejects application-user-replacement "destructive RabbitMQ plan action"
assert_rejects unknown-resource "unexpected RabbitMQ OpenTofu resource"
assert_rejects vhost-wide-acl "may not hold a vhost-wide write ACL"
assert_rejects configure-acl "may not configure topology"
assert_rejects acl-tightening "second RabbitMQ OpenTofu plan is not clean" --require-no-changes

echo "RabbitMQ OpenTofu plan safety policy contract OK"
